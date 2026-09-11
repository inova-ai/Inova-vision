import fs from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";

const TMP_ROOT = "/tmp/inova-voice";

function validateAudio(file){
  return new Promise((resolve,reject)=>{
    const ff=spawn(ffmpegPath,["-v","error","-i",file,"-f","null","-"]);
    let err="";
    ff.stderr.on("data",d=>err+=d.toString());
    ff.on("close",code=>code===0?resolve():reject(new Error(err.slice(-1200)||"Audio TTS tidak valid.")));
    ff.on("error",reject);
  });
}

/**
 * Free TTS: Microsoft Edge online TTS via node-edge-tts.
 * The package is loaded lazily so a TTS/runtime incompatibility can never
 * crash the Netlify function at startup; video generation can continue silent.
 */
export async function createVoiceover({ text, jobId, sceneIndex, targetSeconds = 5 }) {
  if (!text?.trim()) return null;

  const dir = path.join(TMP_ROOT, jobId);
  const output = path.join(dir, `voice-${sceneIndex}.mp3`);
  const voice = process.env.FREE_TTS_VOICE || "id-ID-GadisNeural";
  const rate = process.env.FREE_TTS_RATE || "+0%";
  const volume = process.env.FREE_TTS_VOLUME || "+0%";

  try {
    const mod = await import("node-edge-tts");
    const EdgeTTS = mod.EdgeTTS || mod.default?.EdgeTTS || mod.default;
    if (typeof EdgeTTS !== "function") throw new Error("node-edge-tts EdgeTTS export tidak tersedia di runtime.");

    await fs.mkdir(dir, { recursive: true });
    const tts = new EdgeTTS({
      voice,
      lang: "id-ID",
      outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      rate,
      volume
    });
    await tts.ttsPromise(String(text).trim(), output);

    const audio = await fs.readFile(output);
    if (!audio.length) throw new Error("TTS menghasilkan file audio kosong.");
    await validateAudio(output);

    return { _localPath: output, provider: "edge-tts", voice, targetSeconds };
  } catch (error) {
    console.warn("Free TTS unavailable; continuing without voice:", error?.message || error);
    return null;
  } finally {
    // The pipeline owns cleanup after the whole job finishes. Keeping the local
    // MP3 stays in /tmp and is removed after the job; no remote upload per scene.
  }
}
