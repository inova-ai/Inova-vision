import { getStore } from '@netlify/blobs';

const STORE_NAME = process.env.NETLIFY_BLOB_STORE || 'inova-vision-ai';

function store() {
  return getStore(STORE_NAME);
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

export function hasBlobCredentials() {
  // Netlify Blobs is provisioned at the site level; the SDK receives the
  // site context automatically inside Netlify Functions.
  return Boolean(process.env.NETLIFY || process.env.NETLIFY_SITE_ID || process.env.NETLIFY_BLOBS_CONTEXT);
}

export async function checkBlobConnection() {
  try {
    await store().list({ prefix: '__health__', paginate: false });
    return true;
  } catch (error) {
    console.error('Netlify Blobs connection check failed:', error?.message || error);
    return false;
  }
}

export function blobPublicUrl(pathname) {
  const base = publicBaseUrl();
  if (!base) return null;
  return `${base}/api/blob?key=${encodeURIComponent(pathname)}`;
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
