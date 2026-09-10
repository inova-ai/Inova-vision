import { getStore } from '@netlify/blobs';

const STORE_NAME = process.env.NETLIFY_BLOB_STORE || 'inova-vision-ai';

function store() {
  // Inside Netlify Functions the SDK can use the injected Blobs context.
  // If the site context is not injected, explicitly provide the site ID/token
  // when they are available as environment variables.
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: STORE_NAME, siteID, token });
  return getStore(STORE_NAME);
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '');
}

export function hasBlobCredentials() {
  return Boolean(
    process.env.NETLIFY_BLOBS_CONTEXT ||
    ((process.env.NETLIFY_SITE_ID || process.env.SITE_ID) &&
      (process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN))
  );
}

export async function checkBlobConnection() {
  try {
    await store().list({ prefix: '__health__', paginate: false });
    return { ok: true, error: null };
  } catch (error) {
    const message = error?.message || String(error);
    console.error('Netlify Blobs connection check failed:', message);
    return { ok: false, error: message };
  }
}

export function blobPublicUrl(pathname) {
  // Always use same-origin URLs. PUBLIC_BASE_URL can point at an older
  // Netlify deploy/domain and would make newly rendered videos load from the
  // wrong deployment. The current site will route /api/blob to the blob
  // function.
  if (!pathname) return null;
  return `/api/blob?key=${encodeURIComponent(pathname)}`;
}

export async function putBlob(pathname, data, contentType, options = {}) {
  try {
    const metadata = { contentType, ...(options.metadata || {}) };
    await store().set(pathname, data, { metadata });
    const url = blobPublicUrl(pathname);
    if (!url) throw new Error('PUBLIC_BASE_URL belum dikonfigurasi di Netlify Environment Variables.');
    return { url, pathname, contentType };
  } catch (error) {
    throw new Error(`Netlify Blobs gagal menyimpan file: ${error?.message || error}`);
  }
}

export async function getBlob(pathname, type = 'arrayBuffer') {
  return store().get(pathname, { type });
}

export async function getBlobUrl(pathname) {
  return blobPublicUrl(pathname);
}

export async function readBlobJson(pathname) {
  try {
    return await store().get(pathname, { type: 'json' });
  } catch {
    return null;
  }
}

export async function deleteBlob(pathname) {
  try { await store().delete(pathname); } catch {}
}
