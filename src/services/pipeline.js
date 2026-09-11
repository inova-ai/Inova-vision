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

async function probeMedia(filePath){
  return new Promise((resolve,reject)=>{
    // ffmpeg-static is an ffmpeg binary, not ffprobe. Never pass ffprobe-only
    // flags such as -count_frames/-show_entries/-of to it. We validate by
    // decoding the stream and read the container duration from ffmpeg output.
    const ff=spawn(ffmpegPath,["-hide_banner","-i",filePath,"-map","0:v:0","-f","null","-"]);
    let err="";
    ff.stderr.on("data",d=>err+=d.toString());
    ff.on("close",code=>{
      const m=/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const duration=m ? Number(m[1])*3600 + Number(m[2])*60 + Number(m[3]) : 0;
      if(code!==0 && !duration) return reject(new Error(err.slice(-1200)||"Video probe gagal."));
      resolve({duration,videoFrames:duration>0?Math.max(2,Math.round(duration*24)):0});
    });
    ff.on("error",reject);
  });
}

function promptVideoFilter(prompt="") {
  const p=String(prompt||"").toLowerCase();
  const filters=[];
  if(/hitam\s*putih|black\s*and\s*white|grayscale|grayscale/.test(p)) filters.push("hue=s=0");
  if(/lebih\s*terang|bright|brightness/.test(p)) filters.push("eq=brightness=0.08:contrast=1.04");
  if(/lebih\s*gelap|dark|moody/.test(p)) filters.push("eq=brightness=-0.06:contrast=1.05");
  if(/kontras|contrast/.test(p)) filters.push("eq=contrast=1.12");
  if(/tajam|sharp|sharpen/.test(p)) filters.push("unsharp=5:5:0.6:5:5:0.0");
  if(/mirror|flip\s*horizontal|cermin/.test(p)) filters.push("hflip");
  if(/vintage|retro/.test(p)) filters.push("eq=saturation=0.82:contrast=1.05");
  if(/cinematic|film/.test(p)) filters.push("eq=contrast=1.08:saturation=0.92");
  if(/vignette/.test(p)) filters.push("vignette=PI/5");
  return filters;
}

function promptVideoExtras(prompt="") {
  const p=String(prompt||"").toLowerCase();
  const filters=[];
  if(/putar\s*(90|sembilan\s*puluh)|rotate\s*90/.test(p)) filters.push("transpose=1");
  if(/putar\s*(270|dua\s*ratus\s*tujuh\s*puluh)|rotate\s*270/.test(p)) filters.push("transpose=2");
  if(/balik\s*vertikal|flip\s*vertical|atas\s*bawah/.test(p)) filters.push("vflip");
  if(/saturasi\s*tinggi|lebih\s*berwarna|vivid|saturation/.test(p)) filters.push("eq=saturation=1.18");
  if(/kurangi\s*saturasi|desaturasi|muted/.test(p)) filters.push("eq=saturation=0.75");
  return filters;
}

function promptAudioVolume(prompt="") {
  const p=String(prompt||"").toLowerCase();
  if(/matikan\s*(audio|suara)|tanpa\s*(audio|suara)|mute|silent/.test(p)) return 0;
  if(/suara\s*(lebih\s*)?keras|volume\s*(naik|tinggi)|audio\s*(lebih\s*)?keras/.test(p)) return 1.35;
  if(/suara\s*(lebih\s*)?pelan|volume\s*(turun|rendah)|audio\s*(lebih\s*)?pelan/.test(p)) return 0.65;
  return 1;
}

function promptTrim(prompt="", sourceDuration=0) {
  const p=String(prompt||"").toLowerCase();
  let start=0, end=sourceDuration||0;
  const range=p.match(/(?:detik|seconds?)\s*(\d+(?:\.\d+)?)\s*(?:sampai|hingga|ke|-|to)\s*(\d+(?:\.\d+)?)/);
  if(range){ start=Number(range[1]); end=Number(range[2]); }
  const startM=p.match(/(?:buang|hapus|potong)\s*(?:\d+(?:\.\d+)?)?\s*detik\s*(?:awal|pertama)/);
  if(startM){ start=Number((p.match(/(\d+(?:\.\d+)?)\s*detik\s*(?:awal|pertama)/)||[])[1]||0); }
  const endM=p.match(/(?:buang|hapus|potong)\s*(?:\d+(?:\.\d+)?)?\s*detik\s*(?:akhir|terakhir)/);
  if(endM && sourceDuration){ const n=Number((p.match(/(\d+(?:\.\d+)?)\s*detik\s*(?:akhir|terakhir)/)||[])[1]||0); end=Math.max(start,sourceDuration-n); }
  if(sourceDuration) { start=Math.min(Math.max(0,start),Math.max(0,sourceDuration-0.1)); end=Math.min(Math.max(start+0.1,end),sourceDuration); }
  return {start,end};
}

function promptVideoSpeed(prompt="") {
  const p=String(prompt||"").toLowerCase();
  const m=p.match(/(?:speed|kecepatan|cepat|slow|lambat)[^0-9]{0,12}(0\.5|0\.75|1\.25|1\.5|2)(?:x)?/);
  if(m) return Number(m[1]);
  if(/2x|dua kali|sangat cepat/.test(p)) return 2;
  if(/1\.5x|lebih cepat/.test(p)) return 1.5;
  if(/0\.5x|setengah kecepatan|sangat lambat/.test(p)) return 0.5;
  if(/0\.75x|sedikit lambat|slow motion|lambat/.test(p)) return 0.75;
  return 1;
}

function motionFilter(sceneIndex, duration){
  const fps=30;
  const frames=Math.max(30,Math.round(duration*fps));
  // Free, deterministic "camera" motion. The source pixels are never
  // regenerated or morphed, so logos/text/product geometry stay intact.
  // Each scene gets a different, very subtle Ken-Burns trajectory.
  const movements=[
    `zoompan=z='min(zoom+0.00035,1.055)':x='(iw-iw/zoom)*0.50':y='(ih-ih/zoom)*0.50':d=${frames}:s=720x1280:fps=${fps}`,
    `zoompan=z='min(zoom+0.00030,1.045)':x='(iw-iw/zoom)*(0.22+0.56*on/${Math.max(1,frames-1)})':y='(ih-ih/zoom)*0.50':d=${frames}:s=720x1280:fps=${fps}`,
    `zoompan=z='min(zoom+0.00032,1.050)':x='(iw-iw/zoom)*0.50':y='(ih-ih/zoom)*(0.18+0.64*on/${Math.max(1,frames-1)})':d=${frames}:s=720x1280:fps=${fps}`,
    `zoompan=z='if(lte(on,${Math.floor(frames/2)}),1+0.05*on/${Math.max(1,Math.floor(frames/2))},1.05-0.05*(on-${Math.floor(frames/2)})/${Math.max(1,frames-Math.floor(frames/2)-1)})':x='(iw-iw/zoom)*(0.78-0.56*on/${Math.max(1,frames-1)})':y='(ih-ih/zoom)*0.50':d=${frames}:s=720x1280:fps=${fps}`
  ];
  return movements[sceneIndex%movements.length];
}

function aiVideoEnabled(){
  return Boolean(process.env.MAGIC_HOUR_API_KEY);
}

function videoEngineConfigured(engine) {
  if (engine === "local") return false;
  return aiVideoEnabled();
}

async function createMagicHourImageToVideo({imageUrl, prompt, duration, job}) {
  const token = process.env.MAGIC_HOUR_API_KEY;
  if (!token) throw new Error("MAGIC_HOUR_API_KEY belum dikonfigurasi.");
  const allowed = [3,4,5,6,7,8,9,10,15];
  const requested = Math.max(3, Math.min(15, Number(duration)||5));
  const endSeconds = allowed.reduce((best, n) => Math.abs(n-requested) < Math.abs(best-requested) ? n : best, allowed[0]);
  const body = {
    name: `INOVA VISION ${job.id} scene`,
    end_seconds: endSeconds,
    model: process.env.MAGIC_HOUR_VIDEO_MODEL || "wan-2.2",
    resolution: process.env.MAGIC_HOUR_VIDEO_RESOLUTION || "480p",
    audio: false,
    style: { prompt },
    assets: { image_file_path: imageUrl }
  };
  const create = await fetch("https://api.magichour.ai/v1/image-to-video", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body)
  });
  const created = await create.json().catch(() => ({}));
  if (!create.ok) {
    const msg = created?.message || created?.error?.message || created?.code || JSON.stringify(created).slice(0, 400);
    throw new Error(`Magic Hour HTTP ${create.status}: ${msg}`);
  }
  if (!created.id) throw new Error("Magic Hour tidak mengembalikan project id.");

  let latest = null;
  for (let i=0; i<90; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const status = await fetch(`https://api.magichour.ai/v1/video-projects/${encodeURIComponent(created.id)}`, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
    });
    latest = await status.json().catch(() => ({}));
    if (!status.ok) throw new Error(`Magic Hour status HTTP ${status.status}`);
    if (["complete","error","canceled"].includes(latest.status)) break;
  }
  if (latest?.status !== "complete") {
    const msg = latest?.error?.message || latest?.error || latest?.status || "timeout";
    throw new Error(`Magic Hour generation ${latest?.status || "timeout"}: ${typeof msg === "string" ? msg : JSON.stringify(msg).slice(0, 500)}`);
  }
  const outputUrl = latest?.downloads?.[0]?.url;
  if (!outputUrl) throw new Error("Magic Hour selesai tetapi URL video tidak ditemukan.");
  return { outputUrl, duration: Number(latest.end_seconds)||endSeconds, credits: latest.credits_charged, projectId: created.id };
}

function absolutePublicUrl(job, url){
  if(!url) return null;
  if(/^https?:\/\//i.test(url)) return url;
  const base=String(job.publicBaseUrl||process.env.PUBLIC_BASE_URL||process.env.URL||"").replace(/\/$/,"");
  if(!base) return null;
  return `${base}${url.startsWith("/")?url:`/${url}`}`;
}

function buildI2VPrompt(job, scene){
  const shot=scene.shot||{};
  return [
    "Create a photorealistic vertical product advertisement from the provided reference image.",
    `Product: ${job.productName||"the product shown in the reference image"}.`,
    `Camera: ${shot.cameraMovement||"slow push-in"}.`,
    `Composition: ${shot.composition||"keep the entire product clearly visible"}.`,
    `Lighting: ${shot.lighting||"natural realistic commercial lighting"}.`,
    `Style: ${job.style||"ugc"}.`,
    "Preserve the exact product identity, geometry, proportions, colors, materials, packaging, logo placement and all visible text from the source image.",
    "The product must remain the same physical object throughout the clip. Do not redesign, replace, morph, duplicate or invent product details.",
    "Use motion mainly through subtle realistic camera movement, depth/parallax, natural hand/environment motion only when already implied by the source.",
    "Keep branding and labels stable and readable. No warped text, no extra fingers, no extra products, no floating objects, no surreal motion.",
    "Photorealistic commercial video, physically plausible motion, stable exposure, natural shadows, clean social-commerce look."
  ].join(" ");
}

async function createReplicatePrediction(input){
  const model=process.env.REPLICATE_I2V_MODEL||"wavespeedai/wan-2.1-i2v-480p";
  const endpoint=`https://api.replicate.com/v1/models/${model}/predictions`;
  const r=await fetch(endpoint,{
    method:"POST",
    headers:{"Authorization":`Bearer ${process.env.REPLICATE_API_TOKEN}`,"Content-Type":"application/json","Prefer":"wait=60"},
    body:JSON.stringify({input})
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`Replicate HTTP ${r.status}: ${data?.detail||data?.error||JSON.stringify(data).slice(0,500)}`);
  if(data.output) return data;
  if(!data.id) throw new Error("Replicate tidak mengembalikan prediction id.");
  let latest=data;
  for(let i=0;i<90;i++){
    if(["succeeded","failed","canceled"].includes(latest.status)) break;
    await new Promise(r=>setTimeout(r,2000));
    const poll=await fetch(`https://api.replicate.com/v1/predictions/${data.id}`,{headers:{"Authorization":`Bearer ${process.env.REPLICATE_API_TOKEN}`}});
    latest=await poll.json();
    if(!poll.ok) throw new Error(`Replicate polling HTTP ${poll.status}`);
  }
  if(latest.status!=="succeeded") throw new Error(`Replicate prediction ${latest.status}: ${latest.error||"generation failed"}`);
  return latest;
}

function extractVideoUrl(output){
  if(!output) return null;
  if(typeof output === "string") return output;
  if(Array.isArray(output)) return output.find(x=>typeof x==="string"&&/\.(mp4|webm)(\?|$)/i.test(x))||output.find(x=>typeof x==="string")||null;
  if(typeof output.url === "string") return output.url;
  if(typeof output.video === "string") return output.video;
  return null;
}

async function renderAiScene(job, sceneIndex){
  const scene=job.scenes[sceneIndex];
  const selected=job.photos?.[Number(scene?.imageIndex)||0]||job.photos?.[0]||{};
  const imageUrl=absolutePublicUrl(job,selected.imageUrl||job.imageUrl);
  if(!imageUrl) throw new Error("URL foto produk tidak dapat dibuat publik untuk AI video.");
  const duration=Math.max(5,Math.min(10,Number(scene.duration)||5));
  const fps=16;
  const input={
    image:imageUrl,
    prompt:buildI2VPrompt(job,scene),
    negative_prompt:"product redesign, changed logo, changed text, warped packaging, duplicate product, extra object, deformed product, melting, morphing, flicker, unstable geometry, cartoon, CGI, surreal motion",
    aspect_ratio:"9:16",
    num_frames:Math.max(81,Math.min(100,Math.round(duration*fps))),
    frames_per_second:fps,
    sample_steps:Number(process.env.REPLICATE_I2V_STEPS||30),
    sample_guide_scale:Number(process.env.REPLICATE_I2V_GUIDANCE||5),
    sample_shift:Number(process.env.REPLICATE_I2V_SHIFT||3),
    fast_mode:process.env.REPLICATE_I2V_FAST_MODE||"Balanced"
  };
  const prediction=await createReplicatePrediction(input);
  const outputUrl=extractVideoUrl(prediction.output);
  if(!outputUrl) throw new Error("AI video selesai tetapi URL video tidak ditemukan.");
  const dir=await jobTmp(job.id);
  const aiPath=path.join(dir,`ai-${sceneIndex}.mp4`);
  const imagePath=path.join(dir,`image-${sceneIndex}.jpg`);
  const voicePath=path.join(dir,`voice-${sceneIndex}.mp3`);
  const scenePath=path.join(dir,`scene-${sceneIndex}.mp4`);
  try{
    await downloadFile(outputUrl,aiPath);
    await validateMedia(aiPath,`AI video scene ${sceneIndex+1}`);
    let voice=scene.voice||null;
    if(!voice){
      voice=await createVoiceover({text:scene.script||buildSceneScript({productName:job.productName,style:job.style,cta:job.cta,scene:job.storyboard[sceneIndex]}),jobId:job.id,sceneIndex,targetSeconds:duration});
    }
    if(voice?.pathname) await materializeBlob(voice.pathname,voicePath);
    else if(voice?.url) await downloadFile(voice.url,voicePath);
    if(voice&&(voice.pathname||voice.url)) await validateMedia(voicePath,`Voice scene ${sceneIndex+1}`);
    const vf="scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p";
    const hasVoice=Boolean(voice&&(voice.pathname||voice.url));
    const args=hasVoice
      ? ["-y","-i",aiPath,"-i",voicePath,"-t",String(duration),"-map","0:v:0","-map","1:a:0","-vf",vf,"-af",`apad=pad_dur=${duration},atrim=0:${duration}`,"-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","21","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",scenePath]
      : ["-y","-i",aiPath,"-f","lavfi","-i","anullsrc=channel_layout=stereo:sample_rate=44100","-t",String(duration),"-map","0:v:0","-map","1:a:0","-vf",vf,"-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","21","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",scenePath];
    await runFfmpeg(args);
    await validateMedia(scenePath,`Video final scene ${sceneIndex+1}`);
    const probe=await probeMedia(scenePath);
    if(probe.duration<Math.max(0.5,duration*0.75)) throw new Error(`AI scene ${sceneIndex+1} terlalu pendek: ${probe.duration.toFixed(2)}s.`);
    const blob=await putBlob(`outputs/${job.id}/scene-${sceneIndex}.mp4`,await fs.readFile(scenePath),"video/mp4",{cacheControlMaxAge:86400});
    return {outputUrl:blob.url,outputPathname:blob.pathname,voice,renderMode:"ai-i2v",aiProvider:"replicate",aiModel:process.env.REPLICATE_I2V_MODEL||"wavespeedai/wan-2.1-i2v-480p"};
  }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}

async function renderMagicHourScene(job, sceneIndex){
  const scene=job.scenes[sceneIndex];
  const selected=job.photos?.[Number(scene?.imageIndex)||0]||job.photos?.[0]||{};
  const imageUrl=absolutePublicUrl(job,selected.imageUrl||job.imageUrl);
  if(!imageUrl) throw new Error(`URL foto produk untuk scene ${sceneIndex+1} tidak tersedia.`);
  const duration=Math.max(3,Math.min(15,Number(scene.duration)||5));
  const prompt=buildI2VPrompt(job,scene);
  const ai=await createMagicHourImageToVideo({imageUrl,prompt,duration,job});
  const dir=await jobTmp(job.id);
  const aiPath=path.join(dir,`magic-${sceneIndex}.mp4`);
  const voicePath=path.join(dir,`voice-${sceneIndex}.mp3`);
  const scenePath=path.join(dir,`scene-${sceneIndex}.mp4`);
  try{
    await downloadFile(ai.outputUrl,aiPath);
    await validateMedia(aiPath,`AI video scene ${sceneIndex+1}`);
    let voice=scene.voice||null;
    if(!voice){
      voice=await createVoiceover({text:scene.script||buildSceneScript({productName:job.productName,style:job.style,cta:job.cta,scene:job.storyboard[sceneIndex]}),jobId:job.id,sceneIndex,targetSeconds:duration});
    }
    if(voice?.pathname) await materializeBlob(voice.pathname,voicePath);
    else if(voice?.url) await downloadFile(voice.url,voicePath);
    if(voice&&(voice.pathname||voice.url)) await validateMedia(voicePath,`Voice scene ${sceneIndex+1}`);
    const vf="scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p";
    const hasVoice=Boolean(voice&&(voice.pathname||voice.url));
    const args=hasVoice
      ? ["-y","-i",aiPath,"-i",voicePath,"-t",String(duration),"-map","0:v:0","-map","1:a:0","-vf",vf,"-af",`apad=pad_dur=${duration},atrim=0:${duration}`,"-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","21","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",scenePath]
      : ["-y","-i",aiPath,"-f","lavfi","-i","anullsrc=channel_layout=stereo:sample_rate=44100","-t",String(duration),"-map","0:v:0","-map","1:a:0","-vf",vf,"-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","21","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",scenePath];
    await runFfmpeg(args);
    await validateMedia(scenePath,`Video final scene ${sceneIndex+1}`);
    const probe=await probeMedia(scenePath);
    if(probe.duration<Math.max(0.5,duration*0.65)) throw new Error(`AI scene ${sceneIndex+1} terlalu pendek: ${probe.duration.toFixed(2)}s.`);
    const blob=await putBlob(`outputs/${job.id}/scene-${sceneIndex}.mp4`,await fs.readFile(scenePath),"video/mp4",{cacheControlMaxAge:86400});
    return {outputUrl:blob.url,outputPathname:blob.pathname,voice,renderMode:"ai-video",aiProvider:"magic-hour",aiModel:process.env.MAGIC_HOUR_VIDEO_MODEL||"wan-2.2",aiCredits:ai.credits,aiProjectId:ai.projectId};
  }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
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
    // IMPORTANT: the image itself must be the looping input. The previous
    // renderer put -loop 1 on the silent-audio input, while the JPEG was a
    // single-frame input. FFmpeg could therefore create a technically valid
    // MP4 containing only one video frame, which Android displayed as 0:00.
    // Keep the video input first and loop it explicitly for the full duration.
    const extraPromptFilters=promptVideoFilter(job.customPrompt);
    const vf=`scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,${motionFilter(sceneIndex,duration)}${extraPromptFilters.length?","+extraPromptFilters.join(","):""},format=yuv420p`;
    const hasVoice=Boolean(voice && (voice.pathname || voice.url));
    const args=hasVoice
      ? ["-y","-loop","1","-framerate","30","-i",imagePath,"-i",voicePath,"-t",String(duration),"-map","0:v:0","-map","1:a:0","-vf",vf,"-af",`apad=pad_dur=${duration}`,"-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","23","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",scenePath]
      : ["-y","-loop","1","-framerate","30","-i",imagePath,"-f","lavfi","-i","anullsrc=channel_layout=stereo:sample_rate=44100","-t",String(duration),"-map","0:v:0","-map","1:a:0","-vf",vf,"-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","23","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",scenePath];
    await runFfmpeg(args);
    await validateMedia(scenePath,`Video scene ${sceneIndex+1}`);
    const probe=await probeMedia(scenePath);
    if(probe.duration < Math.max(0.5,duration*0.8) || probe.videoFrames < 2){
      throw new Error(`Scene ${sceneIndex+1} menghasilkan video tidak lengkap: durasi ${probe.duration.toFixed(2)}s, frame ${probe.videoFrames}.`);
    }
    const blob=await putBlob(`outputs/${job.id}/scene-${sceneIndex}.mp4`,await fs.readFile(scenePath),"video/mp4",{cacheControlMaxAge:86400});
    return {outputUrl:blob.url,outputPathname:blob.pathname,voice,renderMode:"local-free"};
  } finally {
    await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

async function renderVideoEdit(job){
  if(!job.sourceVideo?.pathname) throw new Error("Video sumber tidak ditemukan.");
  const dir=await jobTmp(job.id);
  const inputPath=path.join(dir,"source-video");
  const outputPath=path.join(dir,"edited.mp4");
  try{
    await materializeBlob(job.sourceVideo.pathname,inputPath);
    await validateMedia(inputPath,"Video sumber");
    const sourceProbe=await probeMedia(inputPath);
    const requested=String(job.duration)==="auto" ? sourceProbe.duration : Number(job.duration)||sourceProbe.duration||15;
    const trim=promptTrim(job.customPrompt,sourceProbe.duration||requested);
    const outDuration=Math.min(Math.max(0.1,requested),Math.max(0.1,(trim.end-trim.start)||requested));
    const speed=promptVideoSpeed(job.customPrompt);
    const vfParts=["scale=720:1280:force_original_aspect_ratio=increase","crop=720:1280",...promptVideoFilter(job.customPrompt),...promptVideoExtras(job.customPrompt),"fps=30","format=yuv420p"];
    const audioFilters=[];
    if(speed!==1) audioFilters.push(`atempo=${speed}`);
    const volume=promptAudioVolume(job.customPrompt);
    if(volume!==1 && volume>0) audioFilters.push(`volume=${volume}`);
    const args=["-y","-ss",String(trim.start),"-i",inputPath,"-t",String(outDuration/speed),"-vf",vfParts.join(","),"-map","0:v:0"]
    if(/tanpa\s*(suara|audio)|mute|silent/.test(String(job.customPrompt||"").toLowerCase())){
      args.push("-an");
    } else {
      args.push("-map","0:a:0?",...(volume===0?["-an"]:["-af",audioFilters.length?audioFilters.join(","):"anull"]));
    }
    args.push("-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-r","30","-preset","veryfast","-crf","22","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart",outputPath);
    await runFfmpeg(args);
    await validateMedia(outputPath,"Video hasil edit");
    const probe=await probeMedia(outputPath);
    if(probe.duration<Math.max(0.5,outDuration*0.8) || probe.videoFrames<2) throw new Error(`Video edit tidak lengkap: ${probe.duration.toFixed(2)}s, ${probe.videoFrames} frame.`);
    const buffer=await fs.readFile(outputPath);
    if(buffer.length<1024 || buffer.subarray(4,8).toString("ascii")!=="ftyp") throw new Error("Video edit bukan MP4 valid.");
    const blob=await putBlob(`outputs/${job.id}/final.mp4`,buffer,"video/mp4",{cacheControlMaxAge:31536000});
    return {outputUrl:blob.url,outputPathname:blob.pathname,duration:probe.duration,renderMode:"local-video-edit",promptApplied:job.customPrompt||""};
  }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
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
    // Always re-encode the concatenated scenes. AI I2V outputs can have
    // different time bases/FPS from one scene to another; stream-copy concat
    // can produce an MP4 that is technically present but reports 0:00 or
    // fails to seek on Android Chrome.
    await runFfmpeg(["-y","-f","concat","-safe","0","-i",listFile,"-map","0:v:0","-map","0:a:0?","-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-r","30","-vsync","cfr","-preset","veryfast","-crf","22","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",silentPath]);

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
      ? ["-y","-i",silentPath,"-stream_loop","-1","-i",music,"-filter_complex",`[1:a]volume=${volume},atrim=0:${job.duration}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]`,"-map","0:v:0","-map","[a]","-vf",vf,"-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","22","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",finalPath]
      : ["-y","-i",silentPath,"-vf",vf,"-c:v","libx264","-profile:v","main","-level","3.1","-pix_fmt","yuv420p","-preset","veryfast","-crf","22","-c:a","aac","-ar","44100","-ac","2","-b:a","96k","-movflags","+faststart","-avoid_negative_ts","make_zero","-video_track_timescale","90000",finalPath];
    await runFfmpeg(args);
    // Never mark a job completed with a corrupt, zero-frame, or near-zero
    // duration final MP4.
    await validateMedia(finalPath,"Video final");
    const finalProbe=await probeMedia(finalPath);
    if(finalProbe.videoFrames < 2 || finalProbe.duration < Math.max(0.5,Number(job.duration||1)*0.8)) {
      throw new Error(`Video final tidak lengkap: durasi ${finalProbe.duration.toFixed(2)}s, frame ${finalProbe.videoFrames}.`);
    }
    const finalBuffer=await fs.readFile(finalPath);
    if(finalBuffer.length < 1024 || finalBuffer.subarray(4,8).toString("ascii") !== "ftyp") {
      throw new Error("Video final bukan MP4 valid (header ftyp tidak ditemukan).");
    }
    const blob=await putBlob(`outputs/${job.id}/final.mp4`,finalBuffer,"video/mp4",{cacheControlMaxAge:31536000});
    return blob.url;
  } finally {await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}

export async function createPipelineJob({photos=[],videoFile=null,musicFile,productName,style,duration,cta,customPrompt="",baseUrl,videoEngine="auto"}){
  const id=crypto.randomUUID();
  let total=Number(duration)||15;
  const sourceType=videoFile ? "video" : "photo";
  const storyboard=buildStoryboard({productName,style,duration:total});
  const prompt=buildCreativePrompt({productName,style,duration:total,cta,customPrompt,sourceType});
  const photoRecords=[];
  let sourceVideo=null;
  if(videoFile){
    const ext=path.extname(videoFile.originalname||"").toLowerCase()||".mp4";
    const blob=await putBlob(`uploads/${id}/source-video${ext}`,videoFile.buffer,videoFile.mimetype||"video/mp4",{cacheControlMaxAge:86400});
    sourceVideo={url:blob.url,pathname:blob.pathname,name:videoFile.originalname||"source-video"};
  } else {
    for(const [i,photo] of photos.entries()){
      const ext=path.extname(photo.originalname||"").toLowerCase()||".jpg";
      const blob=await putBlob(`uploads/${id}/product-${i}${ext}`,photo.buffer,photo.mimetype||"image/jpeg",{cacheControlMaxAge:86400});
      photoRecords.push({imageUrl:blob.url,imagePath:blob.pathname,imageDataUri:null,name:photo.originalname||""});
    }
  }
  const scripts=sourceType==="video" ? [] : await generateCreativePlan({productName,style,cta,customPrompt,storyboard,imageDataUris:[],imageUrls:photoRecords.map(x=>x.imageUrl),sourcePhotoCount:photoRecords.length});
  let musicUrl=null;
  let musicPathname=null;
  if(musicFile?.buffer){
    const ext=path.extname(musicFile.originalname||".mp3")||".mp3";
    const blob=await putBlob(`uploads/${id}/music${ext}`,musicFile.buffer,musicFile.mimetype||"audio/mpeg",{cacheControlMaxAge:86400});
    musicUrl=blob.url;
    musicPathname=blob.pathname;
  }
  const selectedVideoEngine = videoEngine === "ai" ? "ai" : videoEngine === "local" ? "local" : (aiVideoEnabled() ? "ai" : "local");
  const job={
    id,status:"queued",progress:3,step:selectedVideoEngine === "ai" ? "Job dibuat · AI Video Generator siap merender" : "Job dibuat · Free Motion Engine siap merender",
    productName:productName||"",style:style||"ugc",duration:total,cta:cta||"",customPrompt:String(customPrompt||""),prompt,sourceType,videoEngine:selectedVideoEngine,
    storyboard,sceneCount:sourceType==="video"?1:storyboard.length,musicUrl,musicPathname,musicName:musicFile?.originalname||"",
    imageUrl:photoRecords[0]?.imageUrl,imageDataUri:null,sourcePhotoCount:photos.length,photos:photoRecords,sourceVideo,
    scenes:sourceType==="video"
      ? [{scene:1,title:"Video Edit",duration:total,status:"queued",progress:0,script:"",imageIndex:0,shot:null,attempt:0,renderMode:"local-video-edit"}]
      : storyboard.map((s,i)=>({scene:i+1,title:s.title,duration:s.duration,status:"queued",progress:0,script:scripts[i]?.script||"",imageIndex:scripts[i]?.imageIndex||0,shot:scripts[i]?.shot||null,attempt:0,renderMode:"local-free-motion"})),
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),publicBaseUrl:baseUrl,engine:sourceType==="video"?"local-video-edit":selectedVideoEngine==="ai"?"ai-video":"local-free-motion"
  };
  await saveJob(job);return job;
}

export async function processPipelineJob(jobId, initialJob=null){
  let job=initialJob || await getJob(jobId);
  if(!job) throw new Error("Job tidak ditemukan.");
  if(job.status==="completed") return job;
  await updateJob(jobId,{status:"rendering",progress:5,step:`Free Motion Engine · ${job.sceneCount} scene`});
  try{
    if(job.sourceType==="video"){
      await updateJob(jobId,{status:"rendering",progress:30,step:"Mengedit video sumber · menerapkan prompt dan format 9:16"});
      const edited=await renderVideoEdit(job);
      return updateJob(jobId,{status:"completed",progress:100,step:"Video edit selesai · MP4 siap diputar",outputUrl:edited.outputUrl,completedAt:new Date().toISOString(),renderMode:"local-video-edit",engine:"local-video-edit",duration:edited.duration});
    }
    for(let i=0;i<job.sceneCount;i++){
      job=await getJob(jobId);
      if(job.status==="failed") throw new Error(job.step||"Job gagal.");
      const wantsAI = job.videoEngine === "ai" && aiVideoEnabled();
      await updateJob(jobId,{status:"rendering",progress:Math.max(8,Math.round((i/job.sceneCount)*85)),step:wantsAI?`AI Video scene ${i+1}/${job.sceneCount} · Wan 2.2`:`Render free motion scene ${i+1}/${job.sceneCount}`});
      let result;
      let usedAI = false;
      if(wantsAI){
        try {
          result = await renderMagicHourScene(job,i);
          usedAI = true;
        } catch(aiError) {
          console.error(`AI video scene ${i+1} gagal, fallback Local Free:`, aiError?.stack||aiError);
          await updateJob(jobId,{step:`AI scene ${i+1} gagal · otomatis pindah ke Local Free`});
          result = await renderLocalScene(job,i);
          result = {...result,aiFallback:true,aiFallbackReason:aiError?.message||"AI generation failed"};
        }
      } else {
        result = await renderLocalScene(job,i);
      }
      job=await getJob(jobId);
      const scenes=[...job.scenes];
      scenes[i]={...scenes[i],...result,status:"completed",progress:100,renderMode:usedAI?"ai-video":"local-free-motion"};
      await updateJob(jobId,{scenes,progress:Math.min(88,Math.round(((i+1)/job.sceneCount)*85)),step:`Scene ${i+1}/${job.sceneCount} selesai · ${usedAI?"AI Video":"Local Free"}`,status:i+1===job.sceneCount?"composing":"rendering"});
    }
    job=await getJob(jobId);
    await updateJob(jobId,{status:"composing",progress:92,step:"Menyusun video final · audio + video"});
    const finalUrl=await compose(await getJob(jobId));
    return updateJob(jobId,{status:"completed",progress:100,step:`Video final selesai · ${job.videoEngine==="ai"?"AI Video + fallback Local Free":"100% free local motion"}`,outputUrl:finalUrl,completedAt:new Date().toISOString(),renderMode:job.videoEngine==="ai"?"ai-video":"local-free-motion",engine:job.videoEngine==="ai"?"ai-video":"local-free-motion"});
  }catch(e){
    await updateJob(jobId,{status:"failed",progress:0,step:`Video renderer gagal: ${e?.message||"Unknown error"}`});
    throw e;
  }
}

export async function cancelPipelineJob(job){
  return updateJob(job.id,{status:"failed",progress:0,step:"Dibatalkan oleh pengguna"});
}
