import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitUntil } from "@vercel/functions";
import multer from "multer";
import { createPipelineJob, processPipelineJob, cancelPipelineJob } from "./src/services/pipeline.js";
import { getJob, updateJob } from "./src/services/job-store.js";
import { hasBlobCredentials, checkBlobConnection, getBlob, getBlobAuthInfo } from "./src/services/blob-store.js";
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
  const blobCheck = await checkBlobConnection();
  const blobStorage = blobCheck.ok;
  const blobAuth = getBlobAuthInfo();
  const scriptAI = Boolean(process.env.OPENAI_API_KEY);
  res.json({
    ok: true,
    service: "INOVA VISION AI",
    version: "6.3.4-vercel-job-consistency-fix",
    engine: "local-free-motion",
    configured: blobStorage,
    replicateRemoved: true,
    blobStorage,
    blobConfigured: blobStorage,
    blobAuthMode: blobStorage ? blobAuth.mode : blobAuth.mode,
    blobEnvironment: {
      vercelRuntime: Boolean(process.env.VERCEL),
      blobReadWriteToken: blobAuth.blobReadWriteToken,
      blobStoreId: blobAuth.blobStoreId,
      vercelOidcToken: blobAuth.vercelOidcToken
    },
    blobError: blobCheck.error,
    scriptAI,
    scriptMode: scriptAI ? "optional-openai" : "local-fallback",
    ready: blobStorage,
    videoAI: false,
    videoAIConfigured: false,
    videoAIProvider: null,
    videoAIModel: null,
    videoFallback: true,
    videoFallbackMode: "local-free-motion-9x16",
    hosting: "vercel",
    voiceAI: true,
    voiceProvider: "free-edge-tts",
    voiceConfigured: true
  });
});
app.get("/api/styles", (_req, res) => res.json(getStyleList()));

app.get("/api/blob", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key || key.startsWith("/") || key.includes("..")) return res.status(400).json({ error: "Invalid blob key." });
    const { getBlobUrl } = await import("./src/services/blob-store.js");
    const url = await getBlobUrl(key);
    if (!url) return res.status(404).json({ error: "Blob tidak ditemukan." });
    return res.redirect(302, url);
  } catch (e) {
    console.error("Blob redirect error", e);
    return res.status(500).json({ error: "Gagal membaca blob." });
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
      musicFile: req.files.music?.[0] || null,
      baseUrl
    });
    // Vercel has no Netlify-style background function endpoint. Keep the HTTP
    // response fast, but explicitly extend the Function lifecycle with
    // waitUntil() so FFmpeg is not killed immediately after 202 is returned.
    waitUntil(
      processPipelineJob(job.id).catch(async (workerError) => {
        console.error("Vercel render worker failed:", workerError?.stack || workerError);
        try {
          await updateJob(job.id, { status: "failed", progress: 0, step: `Worker render gagal: ${workerError?.message || "unknown error"}` });
        } catch (persistError) {
          console.error("Failed to persist worker error:", persistError);
        }
      })
    );
    res.status(202).json({ job: await getJob(job.id) });
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
