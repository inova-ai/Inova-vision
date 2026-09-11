import crypto from "node:crypto";
import { uploadStorage } from "./supabase-store.js";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function extractDownloadUrl(project) {
  const candidates = [
    project?.downloads?.[0]?.url,
    project?.downloads?.[0]?.download_url,
    project?.download_url,
    project?.url,
    project?.result?.url,
    project?.result?.download_url,
    project?.outputs?.[0]?.url,
    project?.outputs?.[0]?.download_url
  ];
  return candidates.find(x => typeof x === "string" && /^https?:\/\//i.test(x)) || null;
}

function triptychPrompt(mode, customPrompt) {
  const base = mode === "product-angles"
    ? `Create ONE polished vertical 9:16 ecommerce product catalog image from the reference photo. Arrange exactly three clean vertical panels side-by-side: left = front/hero angle, center = back/rear angle, right = 3/4 side angle. Keep the EXACT same product, design, colors, patterns, materials, proportions, labels and branding. Use a clean bright studio background and soft realistic commercial lighting. If a model is present, keep the same person, face, hair and clothing identity while changing only the pose/view. Do not add extra products, people, text, logos, watermarks, borders or invented product details.`
    : `Create ONE polished vertical 9:16 fashion/product catalog triptych from the reference photo, matching a professional three-view catalog sheet. Arrange exactly three full-height vertical panels side-by-side with narrow clean dividers: left = front view standing naturally, center = back view, right = 3/4 side or relaxed seated pose. Keep the EXACT same subject/product identity, face, hairstyle, clothing, colors, patterns, material, fit, proportions and details. If the reference contains a person, preserve the same person and outfit; if it is product-only, preserve the same product and create three useful catalog angles. Use a clean light studio background and soft realistic commercial lighting. Do not add extra people, garments, products, text, watermark, logos or invented details.`;
  const extra = String(customPrompt || "").trim();
  return extra ? `${base} Additional user instruction: ${extra}` : base;
}

async function createPhotoTriptych({ photo, mode = "fashion-triptych", customPrompt = "" }) {
  const token = process.env.MAGIC_HOUR_API_KEY;
  if (!token) throw new Error("MAGIC_HOUR_API_KEY belum dikonfigurasi.");

  const id = crypto.randomUUID();
  const ext = (photo.originalname?.match(/\.[a-z0-9]+$/i)?.[0] || ".jpg").toLowerCase();

  // One Supabase Storage write: make the source image publicly fetchable by Magic Hour.
  const source = await uploadStorage(`photo-ai/${id}/source${ext}`, photo.buffer, photo.mimetype || "image/jpeg");

  const model = process.env.MAGIC_HOUR_IMAGE_MODEL || "qwen-edit";
  const resolution = process.env.MAGIC_HOUR_IMAGE_RESOLUTION || "640px";
  const create = await fetch("https://api.magichour.ai/v1/ai-image-editor", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      name: `INOVA VISION 3-View ${id}`,
      image_count: 1,
      model,
      aspect_ratio: "9:16",
      resolution,
      style: { prompt: triptychPrompt(mode, customPrompt) },
      assets: { image_file_paths: [source.url] }
    })
  });

  const created = await create.json().catch(() => ({}));
  if (!create.ok) {
    const msg = created?.message || created?.error?.message || created?.code || JSON.stringify(created).slice(0, 500);
    throw new Error(`Magic Hour AI Photo HTTP ${create.status}: ${msg}`);
  }
  if (!created.id) throw new Error("Magic Hour tidak mengembalikan project ID.");

  let project = created;
  let outputUrl = extractDownloadUrl(project);
  const deadline = Date.now() + 240000;

  while (!outputUrl && Date.now() < deadline) {
    await sleep(2500);
    const statusRes = await fetch(`https://api.magichour.ai/v1/image-projects/${encodeURIComponent(created.id)}`, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
    });
    project = await statusRes.json().catch(() => ({}));
    if (!statusRes.ok) {
      const msg = project?.message || project?.error?.message || JSON.stringify(project).slice(0, 400);
      throw new Error(`Magic Hour status HTTP ${statusRes.status}: ${msg}`);
    }
    const status = String(project?.status || project?.state || "").toLowerCase();
    if (["failed", "error", "canceled", "cancelled"].includes(status)) {
      throw new Error(project?.error?.message || project?.message || `AI Photo gagal dengan status ${status}.`);
    }
    outputUrl = extractDownloadUrl(project);
  }

  if (!outputUrl) throw new Error("AI Photo belum selesai dalam batas waktu. Coba lagi dengan foto lebih kecil.");

  const imageRes = await fetch(outputUrl);
  if (!imageRes.ok) throw new Error(`Gagal mengambil hasil AI Photo: HTTP ${imageRes.status}`);
  const outputBuffer = Buffer.from(await imageRes.arrayBuffer());
  if (!outputBuffer.length) throw new Error("Hasil AI Photo kosong.");
  const outputContentType = String(imageRes.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
  const outputExt = outputContentType.includes("png") ? ".png" : outputContentType.includes("webp") ? ".webp" : ".jpg";

  // Only the final result is kept permanently in Supabase Storage.
  const final = await uploadStorage(`photo-ai/${id}/triptych${outputExt}`, outputBuffer, outputContentType);

  return {
    ok: true,
    id,
    outputUrl: final.url,
    outputPathname: final.pathname,
    mode,
    model,
    resolution,
    outputContentType,
    creditsCharged: created.credits_charged ?? project.credits_charged ?? null,
    storageProvider: "supabase", storageWrites: 2
  };
}

export { createPhotoTriptych };
