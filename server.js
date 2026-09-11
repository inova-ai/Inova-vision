import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitUntil } from "@vercel/functions";
import multer from "multer";
import { createPipelineJob, processPipelineJob, cancelPipelineJob } from "./src/services/pipeline.js";
import { getJob, updateJob } from "./src/services/job-store.js";
import { hasSupabaseCredentials, getSupabaseInfo } from "./src/services/supabase-store.js";
import { getStyleList } from "./src/services/creative-engine.js";

const app = express();
// Resolve static assets relative to this file, not process.cwd(). On Vercel
// the Express function can run with a different working directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, { maxAge: "1h", etag: true }));
// Netlify Functions have a binary request limit of about 4.5 MB; keep the server-side upload path conservative.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 10 } });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", async (_req, res) => {
  res.type("application/json");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  const supabase = getSupabaseInfo();
  const scriptAI = Boolean(process.env.OPENAI_API_KEY);
  const videoAI = Boolean(process.env.MAGIC_HOUR_API_KEY);
  res.json({
    ok: true,
    service: "INOVA VISION AI",
    version: "6.7.1-supabase-storage",
    engine: "local-free-motion",
    configured: supabase.configured,
    storageProvider: "supabase",
    supabaseStorage: supabase.configured,
    supabaseConfigured: supabase.configured,
    supabaseUrlConfigured: supabase.urlConfigured,
    supabaseServiceRoleConfigured: supabase.serviceRoleConfigured,
    supabaseBucket: supabase.bucket,
    blobStorage: false,
    blobRemoved: true,
    scriptAI,
    scriptMode: scriptAI ? "optional-openai" : "local-fallback",
    ready: supabase.configured,
    videoAI,
    videoAIConfigured: videoAI,
    videoAIProvider: videoAI ? "magic-hour" : null,
    videoAIModel: videoAI ? (process.env.MAGIC_HOUR_VIDEO_MODEL || "wan-2.2") : null,
    photoAI: videoAI,
    photoAIConfigured: videoAI,
    photoAIProvider: videoAI ? "magic-hour" : null,
    photoAIModel: videoAI ? (process.env.MAGIC_HOUR_IMAGE_MODEL || "qwen-edit") : null,
    photoAIOutput: videoAI ? (process.env.MAGIC_HOUR_IMAGE_RESOLUTION || "640px") : null,
    videoFallback: true,
    videoFallbackMode: "local-free-motion-9x16",
    videoEngineModes: ["auto","ai","local"],
    hosting: "vercel",
    voiceAI: true,
    voiceProvider: "free-edge-tts",
    voiceConfigured: true
  });
});
app.get("/api/styles", (_req, res) => res.json(getStyleList()));

// AI Photo 3-View / Triptych editor. Source and final files are stored in
// Supabase Storage; Vercel Blob is not used.
app.post("/api/photo-triptych", upload.single("photo"), async (req, res) => {
  try {
    const photo = req.file;
    if (!photo?.buffer?.length) return res.status(400).json({ error: "Upload 1 foto terlebih dahulu." });
    if (!photo.mimetype?.startsWith("image/")) return res.status(400).json({ error: "File harus berupa foto JPG, PNG, atau WEBP." });
    if (!process.env.MAGIC_HOUR_API_KEY) return res.status(503).json({ error: "AI Photo belum aktif. Tambahkan MAGIC_HOUR_API_KEY di Vercel Environment Variables." });
    if (photo.size > 3 * 1024 * 1024) return res.status(413).json({ error: "Foto maksimal 3 MB." });

    const { createPhotoTriptych } = await import("./src/services/photo-triptych.js");
    const result = await createPhotoTriptych({
      photo,
      mode: String(req.body?.mode || "fashion-triptych"),
      customPrompt: String(req.body?.prompt || "")
    });
    return res.json(result);
  } catch (e) {
    console.error("Photo triptych error", e?.stack || e);
    const status = /credits|402|quota|insufficient/i.test(String(e?.message || "")) ? 402 : 500;
    return res.status(status).json({ error: e?.message || "AI Photo gagal diproses." });
  }
});

app.post("/api/jobs", upload.fields([{ name: "photos", maxCount: 8 }, { name: "video", maxCount: 1 }, { name: "music", maxCount: 1 }]), async (req, res) => {
  try {
    const hasPhotos = Boolean(req.files?.photos?.length);
    const hasVideo = Boolean(req.files?.video?.length);
    if (!hasPhotos && !hasVideo) return res.status(400).json({ error: "Upload minimal 1 foto atau 1 video sumber." });
    if (hasPhotos && hasVideo) return res.status(400).json({ error: "Pilih mode Foto atau Edit Video, jangan upload keduanya sekaligus." });
    const allFiles = [...(req.files.photos || []), ...(req.files.video || []), ...(req.files.music || [])];
    const totalBytes = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    if (totalBytes > 4 * 1024 * 1024) {
      return res.status(413).json({ error: "Total upload maksimal 4 MB pada jalur server. Kompres foto atau upload lebih sedikit foto." });
    }
    const photos = (req.files.photos || []).filter(f => f.mimetype?.startsWith("image/"));
    const videoFile = (req.files.video || [])[0] || null;
    if (hasPhotos && !photos.length) return res.status(400).json({ error: "File foto harus berupa gambar (JPG, PNG, WEBP)." });
    if (hasVideo && !videoFile?.mimetype?.startsWith("video/")) return res.status(400).json({ error: "File edit harus berupa video MP4/WebM/MOV yang didukung FFmpeg." });
    const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const job = await createPipelineJob({
      photos,
      videoFile,
      customPrompt: req.body.customPrompt,
      productName: req.body.productName,
      style: req.body.style,
      duration: req.body.duration,
      cta: req.body.cta,
      videoEngine: req.body.videoEngine,
      musicFile: req.files.music?.[0] || null,
      baseUrl
    });
    // Vercel has no Netlify-style background function endpoint. Keep the HTTP
    // response fast, but explicitly extend the Function lifecycle with
    // waitUntil() so FFmpeg is not killed immediately after 202 is returned.
    waitUntil(
      processPipelineJob(job.id, job).catch(async (workerError) => {
        console.error("Vercel render worker failed:", workerError?.stack || workerError);
        try {
          await updateJob(job.id, { status: "failed", progress: 0, step: `Worker render gagal: ${workerError?.message || "unknown error"}` });
        } catch (persistError) {
          console.error("Failed to persist worker error:", persistError);
        }
      })
    );
    const publicJob = JSON.parse(JSON.stringify(job, (key, value) => {
      if (key === "_localPath" || key === "musicLocalPath") return undefined;
      return value;
    }));
    res.status(202).json({ job: publicJob });
  } catch (e) {
    console.error("Create job error", e);
    res.status(500).json({ error: e.message || "Gagal membuat job." });
  }
});

app.get("/api/jobs/:id", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job tidak ditemukan." });
  res.json({ job });
});
app.post("/api/jobs/:id/cancel", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job tidak ditemukan." });
  res.json({ job: await cancelPipelineJob(job) });
});


app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) return res.sendFile(path.join(publicDir, "index.html"));
  return next();
});

app.use((err, _req, res, _next) => {
  console.error("INOVA VISION error:", err?.stack || err);
  if (res.headersSent) return;
  res.status(500).json({ error: err?.message || "Internal server error" });
});

export default app;
