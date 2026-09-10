import crypto from "node:crypto";
import { processWebhook } from "../../src/services/pipeline.js";

// Netlify recognizes the -background suffix and returns the background invocation immediately.
export const config = { background: true };

function validSignature(event) {
  const secretValue = process.env.REPLICATE_WEBHOOK_SECRET;
  if (!secretValue) return true;
  const id = event.headers?.["webhook-id"] || event.headers?.["Webhook-Id"];
  const timestamp = event.headers?.["webhook-timestamp"] || event.headers?.["Webhook-Timestamp"];
  const signature = event.headers?.["webhook-signature"] || event.headers?.["Webhook-Signature"];
  if (!id || !timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const secret = secretValue.replace(/^whsec_/, "");
  const expected = crypto.createHmac("sha256", Buffer.from(secret, "base64")).update(`${id}.${timestamp}.${body}`).digest("base64");
  return signature.split(" ").some(part => {
    const [, value] = part.split(",", 2);
    if (!value) return false;
    const a = Buffer.from(value), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export default async (event) => {
  try {
    if (!validSignature(event)) return { statusCode: 401, body: "Invalid webhook signature." };
    const bodyText = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "{}");
    const payload = JSON.parse(bodyText);
    const params = event.queryStringParameters || {};
    await processWebhook(payload, params.scene, params.job);
  } catch (error) {
    console.error("Replicate webhook background error", error);
  }
  return { statusCode: 202, body: "accepted" };
};
