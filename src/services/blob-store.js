import { put, get, list } from '@vercel/blob';

// Vercel Blob adapter. The store must be created in Vercel with PUBLIC access
// because finished MP4s are delivered directly by the Blob CDN to the browser.
function token() { return process.env.BLOB_READ_WRITE_TOKEN || undefined; }
function options(access = 'public') { return { access, ...(token() ? { token: token() } : {}) }; }

export function hasBlobCredentials() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function checkBlobConnection() {
  try {
    await list({ prefix: '__health__', limit: 1, ...(token() ? { token: token() } : {}) });
    return { ok: true, error: null };
  } catch (error) {
    const message = error?.message || String(error);
    console.error('Vercel Blob connection check failed:', message);
    return { ok: false, error: message };
  }
}

export function blobPublicUrl(pathname) {
  // Kept for compatibility. New blobs return their real Vercel Blob CDN URL.
  return pathname ? `/api/blob?key=${encodeURIComponent(pathname)}` : null;
}

export async function putBlob(pathname, data, contentType, optionsExtra = {}) {
  try {
    const blob = await put(pathname, data, {
      ...options('public'),
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: Number(optionsExtra.cacheControlMaxAge || 86400)
    });
    return { url: blob.url, pathname: blob.pathname, contentType: blob.contentType || contentType };
  } catch (error) {
    throw new Error(`Vercel Blob gagal menyimpan file: ${error?.message || error}`);
  }
}

export async function getBlob(pathname, type = 'arrayBuffer') {
  const result = await get(pathname, options('public'));
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  if (type === 'json') return JSON.parse(await new Response(result.stream).text());
  if (type === 'text') return await new Response(result.stream).text();
  return await new Response(result.stream).arrayBuffer();
}

export async function getBlobUrl(pathname) {
  const result = await get(pathname, options('public'));
  return result?.blob?.url || null;
}

export async function readBlobJson(pathname) {
  try { return await getBlob(pathname, 'json'); } catch { return null; }
}

export async function deleteBlob(pathname) {
  try {
    const { del } = await import('@vercel/blob');
    await del(pathname, { token: token() });
  } catch {}
}
