import "dotenv/config";
import express from "express";
import multer from "multer";
import { createPipelineJob, cancelPipelineJob } from "./src/services/pipeline.js";
import { getJob, updateJob } from "./src/services/job-store.js";
import { hasBlobCredentials, checkBlobConnection, getBlob } from "./src/services/blob-store.js";
import { getStyleList } from "./src/services/creative-engine.js";

const app = express();
// Netlify Functions have a binary request limit of about 4.5 MB; keep the server-side upload path conservative.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 9 } });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", async (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  const blobCheck = await checkBlobConnection();
  const blobStorage = blobCheck.ok;
  const netlifyBlobs = Boolean(process.env.NETLIFY || process.env.NETLIFY_SITE_ID || process.env.NETLIFY_BLOBS_CONTEXT);
  const scriptAI = Boolean(process.env.OPENAI_API_KEY);
  res.json({
    ok: true,
    service: "INOVA VISION AI",
    version: "6.0.0-free-motion",
    engine: "local-free-motion",
    configured: blobStorage,
    replicateRemoved: true,
    blobStorage,
    blobConfigured: blobStorage,
    blobAuthMode: netlifyBlobs ? "netlify-blobs" : "not-detected",
    blobEnvironment: {
      netlifyRuntime: Boolean(process.env.NETLIFY),
      netlifySiteId: Boolean(process.env.NETLIFY_SITE_ID || process.env.SITE_ID),
      blobsContext: Boolean(process.env.NETLIFY_BLOBS_CONTEXT),
      explicitAuth: Boolean((process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN) && (process.env.NETLIFY_SITE_ID || process.env.SITE_ID))
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
    const data = await getBlob(key, "arrayBuffer");
    if (data == null) return res.status(404).json({ error: "Blob tidak ditemukan." });
    const buffer = Buffer.from(data);
    const type = key.endsWith(".mp4") ? "video/mp4" : key.endsWith(".mp3") ? "audio/mpeg" : key.endsWith(".wav") ? "audio/wav" : key.endsWith(".json") ? "application/json" : key.match(/\.(png)$/i) ? "image/png" : key.match(/\.(webp)$/i) ? "image/webp" : "image/jpeg";
    res.set("Content-Type", type);
    res.set("Accept-Ranges", "bytes");
    res.set("Cache-Control", key.endsWith(".mp4") ? "public, max-age=31536000, immutable" : "public, max-age=86400");
    if (req.method === "HEAD") return res.set("Content-Length", String(buffer.length)).status(200).end();
    const rawRange = req.get("range");
    if (rawRange && key.endsWith(".mp4")) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(rawRange.trim());
      if (!m) return res.status(416).set("Content-Range", `bytes */${buffer.length}`).end();
      let start = m[1] ? Number(m[1]) : Math.max(0, buffer.length - Number(m[2] || 0));
      let end = m[2] ? Number(m[2]) : buffer.length - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= buffer.length || end < start) return res.status(416).set("Content-Range", `bytes */${buffer.length}`).end();
      end = Math.min(end, buffer.length - 1);
      const chunk = buffer.subarray(start, end + 1);
      return res.status(206).set({"Content-Range": `bytes ${start}-${end}/${buffer.length}`, "Content-Length": String(chunk.length)}).send(chunk);
    }
    res.set("Content-Length", String(buffer.length));
    return res.send(buffer);
  } catch (e) {
    console.error("Blob proxy error", e);
    return res.status(500).json({ error: "Gagal membaca blob." });
  }
});

app.post("/api/jobs", upload.fields([{ name: "photos", maxCount: 8 }, { name: "music", maxCount: 1 }]), async (req, res) => {
  try {
    if (!req.files?.photos?.length) return res.status(400).json({ error: "Upload minimal 1 foto produk." });
    const allFiles = [...(req.files.photos || []), ...(req.files.music || [])];
    const totalBytes = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    if (totalBytes > 4 * 1024 * 1024) {
      return res.status(413).json({ error: "Total upload maksimal 4 MB pada jalur server. Kompres foto atau upload lebih sedikit foto." });
    }
    const photos = req.files.photos.filter(f => f.mimetype?.startsWith("image/"));
    if (!photos.length) return res.status(400).json({ error: "File harus berupa gambar produk." });
    const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const job = await createPipelineJob({
      photos,
      productName: req.body.productName,
      style: req.body.style,
      duration: req.body.duration,
      cta: req.body.cta,
      musicFile: req.files.music?.[0] || null,
      baseUrl
    });
    // Start rendering in a Netlify Background Function so the upload request
    // returns immediately. This prevents long AI/FFmpeg work from turning a
    // successfully-created job into a frontend "Gagal membuat job" timeout.
    try {
      const workerUrl = `${baseUrl}/.netlify/functions/process-job`;
      const workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "cache-control": "no-cache" },
        body: JSON.stringify({ jobId: job.id })
      });
      if (!workerResponse.ok) {
        const detail = await workerResponse.text().catch(() => "");
        throw new Error(`Background worker HTTP ${workerResponse.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }
    } catch (workerError) {
      console.error("Background worker trigger failed:", workerError?.message || workerError);
      await updateJob(job.id, { status: "failed", progress: 0, step: `Worker render tidak bisa dimulai: ${workerError?.message || "unknown error"}` });
    }
    res.status(202).json({ job: await getJob(job.id) });
  } catch (e) {
    console.error("Create job error", e);
    res.status(500).json({ error: e.message || "Gagal membuat job." });
  }
});

app.get("/api/jobs/:id", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job tidak ditemukan." });
  res.json({ job });
});
app.post("/api/jobs/:id/cancel", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job tidak ditemukan." });
  res.json({ job: await cancelPipelineJob(job) });
});


export default app;
