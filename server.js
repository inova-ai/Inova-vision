import "dotenv/config";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import { createPipelineJob, processWebhook, cancelPipelineJob } from "./src/services/pipeline.js";
import { getJob } from "./src/services/job-store.js";
import { hasBlobCredentials, checkBlobConnection, getBlob } from "./src/services/blob-store.js";
import { getStyleList } from "./src/services/creative-engine.js";

const app = express();
// Netlify Functions have a binary request limit of about 4.5 MB; keep the server-side upload path conservative.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 9 } });

app.post("/api/webhooks/replicate", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
  try {
    if (process.env.REPLICATE_WEBHOOK_SECRET) {
      const id = req.get("webhook-id");
      const timestamp = req.get("webhook-timestamp");
      const signature = req.get("webhook-signature");
      if (!id || !timestamp || !signature) return res.status(401).json({ error: "Webhook signature headers missing." });
      const age = Math.abs(Date.now() / 1000 - Number(timestamp));
      if (!Number.isFinite(age) || age > 300) return res.status(401).json({ error: "Webhook timestamp expired." });
      const secret = process.env.REPLICATE_WEBHOOK_SECRET.replace(/^whsec_/, "");
      const signed = `${id}.${timestamp}.${req.body.toString("utf8")}`;
      const expected = crypto.createHmac("sha256", Buffer.from(secret, "base64")).update(signed).digest("base64");
      const valid = signature.split(" ").some(part => {
        const [, value] = part.split(",", 2);
        if (!value) return false;
        const a = Buffer.from(value), b = Buffer.from(expected);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      });
      if (!valid) return res.status(401).json({ error: "Invalid webhook signature." });
    }
    const payload = JSON.parse(req.body.toString("utf8"));
    const result = await processWebhook(payload, req.query.scene, req.query.job);
    return res.json({ received: true, matched: Boolean(result) });
  } catch (e) {
    console.error("Replicate webhook error", e);
    return res.status(500).json({ error: e.message });
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", async (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  const blobCheck = await checkBlobConnection();
  const blobStorage = blobCheck.ok;
  const replicateToken = String(process.env.REPLICATE_API_TOKEN || "").trim();
  let replicateApiReachable = false;
  let replicateError = null;
  if (replicateToken) {
    try {
      const rr = await fetch("https://api.replicate.com/v1/account", {
        headers: { Authorization: `Bearer ${replicateToken}`, Accept: "application/json" }
      });
      replicateApiReachable = rr.ok;
      if (!rr.ok) replicateError = `Replicate HTTP ${rr.status}`;
    } catch (e) {
      replicateError = e?.message || "Replicate API tidak dapat dihubungi.";
    }
  } else {
    replicateError = "REPLICATE_API_TOKEN tidak terlihat oleh Netlify Function runtime.";
  }
  const netlifyBlobs = Boolean(process.env.NETLIFY || process.env.NETLIFY_SITE_ID || process.env.NETLIFY_BLOBS_CONTEXT);
  res.json({
    ok: true,
    service: "INOVA VISION AI",
    version: "5.6.9",
    configured: Boolean(replicateToken),
    replicateTokenPresent: Boolean(replicateToken),
    replicateApiReachable,
    replicateError,
    webhookSecurity: Boolean(process.env.REPLICATE_WEBHOOK_SECRET),
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
    scriptAI: Boolean(process.env.OPENAI_API_KEY),
    ready: Boolean(replicateToken) && replicateApiReachable && blobStorage && Boolean(process.env.OPENAI_API_KEY),
    videoFallback: true,
    videoFallbackMode: "local-image-motion",
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
    const type = key.endsWith(".mp4") ? "video/mp4" : key.endsWith(".mp3") ? "audio/mpeg" : key.endsWith(".wav") ? "audio/wav" : key.endsWith(".json") ? "application/json" : key.match(/\.(png)$/i) ? "image/png" : key.match(/\.(webp)$/i) ? "image/webp" : "image/jpeg";
    res.set("Content-Type", type);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(Buffer.from(data));
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
      const workerUrl = `${baseUrl}/.netlify/functions/process-job-background`;
      const workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id })
      });
      if (!workerResponse.ok) console.warn("Background worker trigger returned", workerResponse.status);
    } catch (workerError) {
      console.warn("Background worker trigger failed:", workerError?.message || workerError);
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
