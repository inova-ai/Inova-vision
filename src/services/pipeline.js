import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { saveJob, updateJob, getJob } from "./job-store.js";
import { buildCreativePrompt, buildStoryboard, buildSceneScript } from "./creative-engine.js";
import { generateCreativePlan } from "./ai-script.js";
import { createVoiceover } from "./voice.js";
import { putBlob, getBlob } from "./blob-store.js";
import ffmpegPath from "ffmpeg-static";

// INOVA VISION FREE ENGINE
// No Replicate, no paid I2V API. Every scene is rendered locally with FFmpeg
// from the uploaded product photo, optional free Edge TTS voice, subtitles,
// CTA and optional music. The AI creative plan is also optional: if no
// OPENAI_API_KEY is configured, deterministic local scripts/shots are used.
const TMP_ROOT = "/tmp/inova-vision";
async function jobTmp(id){const dir=path.join(TMP_ROOT,id);await fs.mkdir(dir,{recursive:true});return dir;}
function runFfmpeg(args){return new Promise((resolve,reject)=>{const ff=spawn(ffmpegPath,args);let err="";ff.stderr.on("data",d=>err+=d.toString());ff.on("close",c=>c===0?resolve():reject(new Error(`FFmpeg gagal: ${err.slice(-1800)}`)));ff.on("error",e=>reject(e));});}
async function downloadFile(url,target){
  const r=await fetch(url);
  if(!r.ok) throw new Error(`Gagal mengambil media: HTTP ${r.status}`);
  const data=Buffer.from(await r.arrayBuffer());
  if(!data.length) throw new Error("Media kosong saat diunduh.");
  await fs.writeFile(target,data);
  return data;
}

async function materializeBlob(pathname,target){
  if(!pathname) return false;
  const data=await getBlob(pathname,"arrayBuffer");
  if(data==null) throw new Error(`Blob media tidak ditemukan: ${pathname}`);
  const buffer=Buffer.from(data);
  if(!buffer.length) throw new Error(`Blob media kosong: ${pathname}`);
  await fs.writeFile(target,buffer);
  return true;
}

function runFfmpegResult(args){
  return new Promise((resolve,reject)=>{
    const ff=spawn(ffmpegPath,args);
    let err="";
    ff.stderr.on("data",d=>err+=d.toString());
    ff.on("close",c=>c===0?resolve():reject(new Error(err.slice(-1800)||"FFmpeg media validation gagal.")));
    ff.on("error",reject);
  });
}

async function validateMedia(filePath,label){
  try{
    await runFfmpegResult(["-v","error","-i",filePath,"-f","null","-"]);
  }catch(e){
    throw new Error(`${label} rusak/tidak valid: ${e?.message||e}`);
  }
}

function motionFilter(sceneIndex, duration){
  const fps=30;
  const frames=Math.max(1,Math.round(duration*fps));
  const movements=[
    "zoompan=z='min(zoom+0.0007,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    "zoompan=z='if(lte(zoom,1.0),1.08,max(zoom-0.0007,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    "zoompan=z='min(zoom+0.0005,1.06)':x='if(gte(iw-iw/zoom,0),(iw-iw/zoom)*on/${frames},0)':y='ih/2-(ih/zoom/2)'",
    "zoompan=z='min(zoom+0.0005,1.06)':x='if(gte(iw-iw/zoom,0),(iw-iw/zoom)*(1-on/${frames}),0)':y='ih/2-(ih/zoom/2)'"
  ];
  return `${movements[sceneIndex%movements.length]}:d=${frames}:s=720x1280:fps=${fps}`;
}

async function renderLocalScene(job, sceneIndex){
  const scene=job.scenes[sceneIndex];
  const selected=job.photos?.[Number(scene?.imageIndex)||0]||job.photos?.[0]||{};
  const imageUrl=selected.imageUrl||job.imageUrl;
  if(!imageUrl) throw new Error(`Foto produk untuk scene ${sceneIndex+1} tidak tersedia.`);

  const dir=await jobTmp(job.id);
  const imagePath=path.join(dir,`image-${sceneIndex}.jpg`);
  const voicePath=path.join(dir,`voice-${sceneIndex}.mp3`);
  const scenePath=path.join(dir,`scene-${sceneIndex}.mp4`);
  try {
    if(selected.imagePath) await materializeBlob(selected.imagePath,imagePath);
    else await downloadFile(imageUrl,imagePath);
    await validateMedia(imagePath,`Foto scene ${sceneIndex+1}`);
    let voice=scene.voice||null;
    if(!voice){
      voice=await createVoiceover({
        text:scene.script||buildSceneScript({productName:job.productName,style:job.style,cta:job.cta,scene:job.storyboard[sceneIndex]}),
        jobId:job.id,sceneIndex,targetSeconds:scene.duration
      });
    }
    if(voice?.pathname) await materializeBlob(voice.pathname,voicePath);
    else if(voice?.url) await downloadFile(voice.url,voicePath);
    if(voice && (voice.pathname || voice.url)) await validateMedia(voicePath,`Voice scene ${sceneIndex+1}`);

    const duration=Math.max(1,Number(scene.duration)||5);
    // 9:16 vertical output. Scale/crop first, then apply subtle camera motion.
    const vf=`scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,${motionFilter(sceneIndex,duration)},format=yuv420p`;
    const args=voice?.url
      ? ["-y","-loop","1","-i",imagePath,"-i",voicePath,"-vf",vf,"-t",String(duration),"-map","0:v:0","-map","1:a:0","-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","96k","-shortest","-movflags","+faststart",scenePath]
      : ["-y","-loop","1","-f","lavfi","-i","anullsrc=channel_layout=stereo:sample_rate=44100","-i",imagePath,"-vf",vf,"-t",String(duration),"-map","1:v:0","-map","0:a:0","-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","96k","-movflags","+faststart",scenePath];
    await runFfmpeg(args);
    const blob=await putBlob(`outputs/${job.id}/scene-${sceneIndex}.mp4`,await fs.readFile(scenePath),"video/mp4",{cacheControlMaxAge:86400});
    return {outputUrl:blob.url,outputPathname:blob.pathname,voice,renderMode:"local-free"};
  } finally {
    await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

async function compose(job){
  const dir=await jobTmp(job.id);
  const listFile=path.join(dir,"concat.txt");
  const silentPath=path.join(dir,"silent.mp4");
  const finalPath=path.join(dir,"final.mp4");
  try {
    const sceneFiles=[];
    for(let i=0;i<job.sceneCount;i++){
      const url=job.scenes[i]?.outputUrl;
      if(!url) throw new Error(`Output scene ${i+1} tidak ditemukan.`);
      const target=path.join(dir,`scene-${i}.mp4`);
      const pathname=job.scenes[i]?.outputPathname;
      if(pathname) await materializeBlob(pathname,target); else await downloadFile(url,target);
      await validateMedia(target,`Video scene ${i+1}`);
      sceneFiles.push(target);
    }
    await fs.writeFile(listFile,sceneFiles.map(file=>`file '${file.replace(/'/g,"'\\''")}'`).join("\n"));
    try{await runFfmpeg(["-y","-f","concat","-safe","0","-i",listFile,"-c","copy","-movflags","+faststart",silentPath]);}
    catch{await runFfmpeg(["-y","-f","concat","-safe","0","-i",listFile,"-c:v","libx264","-preset","veryfast","-crf","22","-c:a","aac","-b:a","96k","-movflags","+faststart",silentPath]);}

    // IMPORTANT: the Netlify ffmpeg-static binary used by this app does not
    // include the drawtext filter. Do not add drawtext/drawbox here: doing so
    // makes the final compose fail with "No such filter: drawtext".
    // Subtitles/CTA remain available as metadata for the UI, while the video
    // render itself uses only universally available scale/crop/format filters.
    const vf="format=yuv420p";
    let music=null;
    if(job.musicUrl || job.musicPathname){
      music=path.join(dir,"music"+path.extname(job.musicName||".mp3"));
      if(job.musicPathname) await materializeBlob(job.musicPathname,music); else await downloadFile(job.musicUrl,music);
      await validateMedia(music,"Musik");
    }
    const volume=Math.min(1,Math.max(0,Number(process.env.MUSIC_VOLUME||0.10)));
    const args=music
      ? ["-y","-i",silentPath,"-stream_loop","-1","-i",music,"-filter_complex",`[1:a]volume=${volume},atrim=0:${job.duration}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]`,"-map","0:v:0","-map","[a]","-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","22","-c:a","aac","-b:a","96k","-movflags","+faststart",finalPath]
      : ["-y","-i",silentPath,"-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","22","-c:a","aac","-b:a","96k","-movflags","+faststart",finalPath];
    await runFfmpeg(args);
    const blob=await putBlob(`outputs/${job.id}/final.mp4`,await fs.readFile(finalPath),"video/mp4",{cacheControlMaxAge:31536000});
    return blob.url;
  } finally {await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}

export async function createPipelineJob({photos,musicFile,productName,style,duration,cta,baseUrl}){
  const id=crypto.randomUUID();
  const total=Number(duration)||15;
  const storyboard=buildStoryboard({productName,style,duration:total});
  const prompt=buildCreativePrompt({productName,style,duration:total,cta});
  const photoRecords=[];
  for(const [i,photo] of photos.entries()){
    const ext=path.extname(photo.originalname||"").toLowerCase()||".jpg";
    const blob=await putBlob(`uploads/${id}/product-${i}${ext}`,photo.buffer,photo.mimetype||"image/jpeg",{cacheControlMaxAge:86400});
    photoRecords.push({imageUrl:blob.url,imagePath:blob.pathname,imageDataUri:null,name:photo.originalname||""});
  }
  const scripts=await generateCreativePlan({productName,style,cta,storyboard,imageDataUris:[],imageUrls:photoRecords.map(x=>x.imageUrl),sourcePhotoCount:photoRecords.length});
  let musicUrl=null;
  let musicPathname=null;
  if(musicFile?.buffer){
    const ext=path.extname(musicFile.originalname||".mp3")||".mp3";
    const blob=await putBlob(`uploads/${id}/music${ext}`,musicFile.buffer,musicFile.mimetype||"audio/mpeg",{cacheControlMaxAge:86400});
    musicUrl=blob.url;
    musicPathname=blob.pathname;
  }
  const job={
    id,status:"queued",progress:3,step:"Job dibuat · Free Local Video Engine siap merender",
    productName:productName||"",style:style||"ugc",duration:total,cta:cta||"",prompt,
    storyboard,sceneCount:storyboard.length,musicUrl,musicPathname,musicName:musicFile?.originalname||"",
    imageUrl:photoRecords[0]?.imageUrl,imageDataUri:null,sourcePhotoCount:photos.length,photos:photoRecords,
    scenes:storyboard.map((s,i)=>({scene:i+1,title:s.title,duration:s.duration,status:"queued",progress:0,script:scripts[i]?.script||"",imageIndex:scripts[i]?.imageIndex||0,shot:scripts[i]?.shot||null,attempt:0,renderMode:"local-free"})),
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),publicBaseUrl:baseUrl,engine:"local-free"
  };
  await saveJob(job);return getJob(id);
}

export async function processPipelineJob(jobId){
  let job=await getJob(jobId);
  if(!job) throw new Error("Job tidak ditemukan.");
  if(job.status==="completed") return job;
  await updateJob(jobId,{status:"rendering",progress:5,step:`Free Local Engine aktif · ${job.sceneCount} scene`});
  try{
    for(let i=0;i<job.sceneCount;i++){
      job=await getJob(jobId);
      if(job.status==="failed") throw new Error(job.step||"Job gagal.");
      await updateJob(jobId,{status:"rendering",progress:Math.max(8,Math.round((i/job.sceneCount)*85)),step:`Render lokal scene ${i+1}/${job.sceneCount} · tanpa Replicate`});
      const result=await renderLocalScene(job,i);
      job=await getJob(jobId);
      const scenes=[...job.scenes];
      scenes[i]={...scenes[i],...result,status:"completed",progress:100};
      await updateJob(jobId,{scenes,progress:Math.min(88,Math.round(((i+1)/job.sceneCount)*85)),step:`Scene ${i+1}/${job.sceneCount} selesai · local-free`,status:i+1===job.sceneCount?"composing":"rendering"});
    }
    job=await getJob(jobId);
    await updateJob(jobId,{status:"composing",progress:92,step:"Menyusun video final · audio + video"});
    const finalUrl=await compose(await getJob(jobId));
    return updateJob(jobId,{status:"completed",progress:100,step:"Video final selesai · 100% local/free renderer",outputUrl:finalUrl,completedAt:new Date().toISOString(),renderMode:"local-free",engine:"local-free"});
  }catch(e){
    await updateJob(jobId,{status:"failed",progress:0,step:`Local renderer gagal: ${e?.message||"Unknown error"}`});
    throw e;
  }
}

export async function cancelPipelineJob(job){
  return updateJob(job.id,{status:"failed",progress:0,step:"Dibatalkan oleh pengguna"});
}
