import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { saveJob, updateJob, getJob } from "./job-store.js";
import { buildCreativePrompt, buildStoryboard, buildSceneScript } from "./creative-engine.js";
import { createScenePrediction, cancelPrediction } from "./replicate-video.js";
import { generateCreativePlan } from "./ai-script.js";
import { createVoiceover } from "./voice.js";
import { putBlob } from "./blob-store.js";
import ffmpegPath from "ffmpeg-static";

const TMP_ROOT = "/tmp/inova-vision";
async function jobTmp(id){const dir=path.join(TMP_ROOT,id);await fs.mkdir(dir,{recursive:true});return dir;}
function runFfmpeg(args){return new Promise((resolve,reject)=>{const ff=spawn(ffmpegPath,args);let err="";ff.stderr.on("data",d=>err+=d.toString());ff.on("close",c=>c===0?resolve():reject(new Error(`FFmpeg gagal: ${err.slice(-1800)}`)));});}
function ts(sec){const ms=Math.max(0,Math.round(sec*1000));const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),x=ms%1000;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(x).padStart(3,"0")}`;}
function escapeDraw(s){return String(s||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/:/g,"\\:").replace(/,/g,"\\,").replace(/\[/g,"\\[").replace(/\]/g,"\\]").replace(/\n/g,"\\n");}
function wrap(s,max=38){const words=String(s||"").trim().split(/\s+/);const out=[];let line="";for(const w of words){if((line+" "+w).trim().length>max&&line){out.push(line);line=w;}else line=(line?line+" ":"")+w;}if(line)out.push(line);return out.slice(0,3).join("\n");}

export async function startScene(job, sceneIndex){
  const storyboardScene=job.storyboard[sceneIndex];
  const runtimeScene=job.scenes?.[sceneIndex] || {};
  const scene={...storyboardScene,...runtimeScene};
  const webhookBase=(job.publicBaseUrl||process.env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
  if(!webhookBase) throw new Error("PUBLIC_BASE_URL belum dikonfigurasi dan Netlify URL tidak tersedia.");
  const webhookUrl=`${webhookBase}/api/webhooks/replicate`;
  const selected = job.photos?.[Number(scene.imageIndex)||0] || job.photos?.[0] || {};
  let voice=runtimeScene.voice||null;
  if(!voice) voice=await createVoiceover({text:scene.script||buildSceneScript({productName:job.productName,style:job.style,cta:job.cta,scene}),jobId:job.id,sceneIndex,targetSeconds:scene.duration});
  const shot=scene.shot||{};
  const shotPrompt=`${job.prompt} Scene ${scene.scene}/${scene.title}: ${scene.direction}
SHOT PLAN: shot type ${shot.shotType||"hero"}; camera movement ${shot.cameraMovement||"slow push-in"}; composition ${shot.composition||"product centered and fully visible"}; lighting ${shot.lighting||"clean commercial lighting"}; pacing ${shot.pacing||"clear product emphasis"}.
Execute only realistic camera motion. Preserve exact product identity, shape, colors, branding placement and visible details. Do not morph, duplicate, replace or redesign the product.`;
  const prediction=await createScenePrediction({imageUrl:selected.imageUrl || job.imageUrl,imageDataUri:selected.imageDataUri || job.imageDataUri,prompt:shotPrompt,duration:scene.duration,webhookUrl,sceneNumber:sceneIndex,jobId:job.id,audioUrl:voice?.url||null});
  job.scenes[sceneIndex]={...job.scenes[sceneIndex],predictionId:prediction.id,voice,status:"generating",progress:20,attempt:(job.scenes[sceneIndex].attempt||0)+1};
  await updateJob(job.id,{status:"generating",step:`Generating scene ${sceneIndex+1}/${job.sceneCount} · foto #${(scene.imageIndex ?? 0)+1} · ${scene.shot?.cameraMovement || "camera motion"}`,progress:Math.round((job.scenes.filter(s=>s.status==="completed").length/job.sceneCount)*80)+10,scenes:job.scenes});
  await putBlob(`indexes/prediction-${prediction.id}.json`,JSON.stringify({jobId:job.id,sceneIndex}),"application/json",{cacheControlMaxAge:86400});
}
async function downloadFile(url,target){const r=await fetch(url);if(!r.ok)throw new Error(`Gagal mengambil output scene: HTTP ${r.status}`);await fs.writeFile(target,Buffer.from(await r.arrayBuffer()));}

async function compose(job){
  const dir=await jobTmp(job.id);
  const listFile=path.join(dir,"concat.txt");
  const silentPath=path.join(dir,"silent.mp4");
  const finalPath=path.join(dir,"final.mp4");
  const sceneFiles=[];
  for(let i=0;i<job.sceneCount;i++){
    const url=job.scenes[i]?.outputUrl;
    if(!url) throw new Error(`Output scene ${i+1} tidak ditemukan.`);
    const target=path.join(dir,`scene-${i}.mp4`);
    await downloadFile(url,target);
    sceneFiles.push(target);
  }
  await fs.writeFile(listFile,sceneFiles.map(file=>`file '${file.replace(/'/g,"'\\''")}'`).join("\n"));
  await runFfmpeg(["-y","-f","concat","-safe","0","-i",listFile,"-c:v","libx264","-preset","veryfast","-crf","20","-c:a","aac","-b:a","128k","-movflags","+faststart",silentPath]);
  const filters=[];let cursor=0;
  for(const sc of job.scenes){
    const start=cursor,end=cursor+Number(sc.duration||5);
    const txt=escapeDraw(wrap(sc.script||sc.title));
    filters.push(`drawbox=x=28:y=h-205:w=w-56:h=150:color=black@0.62:t=fill:enable='between(t,${start},${end})'`);
    filters.push(`drawtext=font='DejaVu Sans':text='${txt}':fontcolor=white:fontsize=34:line_spacing=8:x=(w-text_w)/2:y=h-180:enable='between(t,${start},${end})'`);
    cursor=end;
  }
  if(job.cta?.trim()){
    const start=Math.max(0,job.duration-3);const txt=escapeDraw(wrap(job.cta.trim(),42));
    filters.push(`drawbox=x=36:y=h-145:w=w-72:h=92:color=0x0B0B0B@0.88:t=fill:enable='gte(t,${start})'`);
    filters.push(`drawtext=font='DejaVu Sans':text='${txt}':fontcolor=0xF4D58D:fontsize=36:line_spacing=6:x=(w-text_w)/2:y=h-120:enable='gte(t,${start})'`);
  }
  const vf=filters.join(",");
  let music=null;
  if(job.musicUrl){music=path.join(dir,"music"+path.extname(job.musicName||".mp3"));await downloadFile(job.musicUrl,music);}
  const volume=Number(process.env.MUSIC_VOLUME||0.10);
  let args;
  if(music){
    args=["-y","-i",silentPath,"-stream_loop","-1","-i",music,"-filter_complex",`[1:a]volume=${volume},atrim=0:${job.duration}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]`,"-map","0:v:0","-map","[a]","-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","20","-c:a","aac","-b:a","128k","-movflags","+faststart",finalPath];
  } else {
    args=["-y","-i",silentPath,"-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","20","-c:a","aac","-b:a","128k","-movflags","+faststart",finalPath];
  }
  await runFfmpeg(args);
  const finalBuffer=await fs.readFile(finalPath);
  const blob=await putBlob(`outputs/${job.id}/final.mp4`,finalBuffer,"video/mp4",{cacheControlMaxAge:31536000});
  await fs.rm(dir,{recursive:true,force:true});
  return blob.url;
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
    photoRecords.push({imageUrl:blob.url,imageDataUri:null,name:photo.originalname||""});
  }
  const scripts=await generateCreativePlan({
    productName,style,cta,storyboard,
    imageDataUris:[],
    imageUrls:photoRecords.map(x=>x.imageUrl),
    sourcePhotoCount:photoRecords.length
  });
  let musicUrl=null;
  if(musicFile?.buffer){
    const ext=path.extname(musicFile.originalname||".mp3")||".mp3";
    const blob=await putBlob(`uploads/${id}/music${ext}`,musicFile.buffer,musicFile.mimetype||"audio/mpeg",{cacheControlMaxAge:86400});
    musicUrl=blob.url;
  }
  const job={id,status:"queued",progress:3,step:"AI menganalisis semua foto & membuat creative blueprint",productName:productName||"",style:style||"ugc",duration:total,cta:cta||"",prompt,storyboard,sceneCount:storyboard.length,musicUrl,musicName:musicFile?.originalname||"",imageUrl:photoRecords[0]?.imageUrl,imageDataUri:null,sourcePhotoCount:photos.length,
    photos:photoRecords,
    scenes:storyboard.map((s,i)=>({scene:i+1,title:s.title,duration:s.duration,status:"queued",progress:0,script:scripts[i]?.script||"",imageIndex:scripts[i]?.imageIndex||0,shot:scripts[i]?.shot||null,attempt:0})),
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),publicBaseUrl:baseUrl};
  // Persist the newly-created job before any update/startScene call.
  // Previously updateJob() was called before the job existed in Blobs,
  // which returned null and caused the frontend to read data.job.id from null.
  await saveJob(job);
  try{
    await updateJob(id,{status:"analyzing",progress:8,step:"AI menganalisis foto produk & menyiapkan scene 1"});
    await startScene(await getJob(id),0);
  }catch(e){await updateJob(id,{status:"failed",progress:0,step:e.message});}
  return await getJob(id);
}

export async function processWebhook(payload,sceneIndexRaw,jobIdRaw){
  const id=payload?.id,sceneIndex=Number(sceneIndexRaw);if(!id||!Number.isInteger(sceneIndex))return null;
  let job=null;
  // The prediction ID is checked against the durable job stored in Blob.
  // The webhook URL already carries the scene index, so no filesystem scan is needed.
  // Prefer the job id carried in the webhook URL. This removes a race where
  // Replicate can deliver a very fast webhook before the prediction index is written.
  if(jobIdRaw) job=await getJob(jobIdRaw);
  if(!job){
    const { readBlobJson } = await import("./blob-store.js");
    const index = await readBlobJson(`indexes/prediction-${id}.json`);
    if(index?.jobId) job=await getJob(index.jobId);
  }
  if(!job)return null;
  if(job.scenes?.[sceneIndex]?.predictionId!==id)return null;
  if(payload.status==="failed"||payload.status==="canceled"){
    const scene=job.scenes[sceneIndex];
    if(scene.attempt<2&&job.status!=="failed"){await updateJob(job.id,{step:`Scene ${sceneIndex+1} gagal · retry otomatis ${scene.attempt}/2`});try{await startScene(await getJob(job.id),sceneIndex);return getJob(job.id);}catch(e){return updateJob(job.id,{status:"failed",progress:0,step:e.message});}}
    return updateJob(job.id,{status:"failed",progress:0,step:`Scene ${sceneIndex+1} gagal setelah retry: ${payload.error||payload.status}`});
  }
  if(payload.status!=="succeeded")return updateJob(job.id,{step:`Generating scene ${sceneIndex+1}/${job.sceneCount} · foto #${(scene.imageIndex ?? 0)+1} · ${scene.shot?.cameraMovement || "camera motion"}`});
  const output=Array.isArray(payload.output)?payload.output[0]:payload.output;if(!output)return updateJob(job.id,{status:"failed",progress:0,step:`Scene ${sceneIndex+1} tidak memiliki output.`});
  const dir=await jobTmp(job.id); const scenePath=path.join(dir,`scene-${sceneIndex}.mp4`); await downloadFile(output,scenePath); const sceneBlob=await putBlob(`outputs/${job.id}/scene-${sceneIndex}.mp4`,await fs.readFile(scenePath),"video/mp4",{cacheControlMaxAge:86400}); job.scenes[sceneIndex].status="completed";job.scenes[sceneIndex].progress=100;job.scenes[sceneIndex].outputUrl=sceneBlob.url; await fs.rm(scenePath,{force:true});
  const next=sceneIndex+1;if(next<job.sceneCount){await updateJob(job.id,{scenes:job.scenes,progress:Math.round(((sceneIndex+1)/job.sceneCount)*85),step:`Scene ${sceneIndex+1}/${job.sceneCount} selesai · memulai scene ${next+1}/${job.sceneCount}`});try{await startScene(await getJob(job.id),next);}catch(e){await updateJob(job.id,{status:"failed",progress:0,step:e.message});}return getJob(job.id);}
  try{await updateJob(job.id,{scenes:job.scenes,status:"composing",progress:92,step:"Burn-in subtitle, CTA end-card & audio mixing"});const finalUrl=await compose(await getJob(job.id));return updateJob(job.id,{status:"completed",progress:100,step:"Video final selesai · subtitle burn-in + CTA + audio",outputUrl:finalUrl,completedAt:new Date().toISOString()});}catch(e){return updateJob(job.id,{status:"failed",progress:0,step:e.message});}
}
export async function cancelPipelineJob(job){for(const s of job.scenes||[]){if(s.predictionId&&s.status==="generating"){try{await cancelPrediction(s.predictionId);}catch(e){console.warn("Cancel prediction:",e.message);}}}return updateJob(job.id,{status:"failed",progress:0,step:"Dibatalkan oleh pengguna"});}
