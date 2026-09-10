import Replicate from "replicate";
let client;
function getClient() { if (!process.env.REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN belum diisi."); client ||= new Replicate({ auth: process.env.REPLICATE_API_TOKEN }); return client; }
export async function cancelPrediction(predictionId) { return getClient().predictions.cancel(predictionId); }
export async function createScenePrediction({ imageUrl, imageDataUri, prompt, duration, webhookUrl, sceneNumber, jobId, audioUrl }) {
  const replicate = getClient();
  const owner = process.env.REPLICATE_MODEL_OWNER || "wan-video";
  const name = process.env.REPLICATE_MODEL_NAME || "wan-2.5-i2v";
  const input = {
    image: imageUrl || imageDataUri,
    prompt,
    duration: Math.max(5, Math.min(10, Number(duration) || 5)),
    resolution: process.env.VIDEO_RESOLUTION || "720p",
    negative_prompt: "warped product, duplicate product, extra objects, unreadable logo, deformed packaging, flicker, changing product identity",
    enable_prompt_expansion: true
  };
  if (audioUrl) input.audio = audioUrl;
  return replicate.predictions.create({ model: `${owner}/${name}`, input, webhook: `${webhookUrl}?scene=${sceneNumber}&job=${encodeURIComponent(jobId||"")}`, webhook_events_filter: ["start", "completed", "failed", "canceled"] });
}
