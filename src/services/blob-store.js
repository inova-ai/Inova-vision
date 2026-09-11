import { put, get, del } from '@vercel/blob';

// Vercel Blob adapter supporting both legacy static tokens and the 2026 OIDC flow.
// New Vercel Blob stores normally use BLOB_STORE_ID + VERCEL_OIDC_TOKEN.
function staticToken() { return process.env.BLOB_READ_WRITE_TOKEN || undefined; }
function storeId() { return process.env.BLOB_STORE_ID || undefined; }
function oidcToken() { return process.env.VERCEL_OIDC_TOKEN || undefined; }

function authOptions() {
  const token = staticToken();
  if (token) return { token };

  // Explicit OIDC credentials make the adapter work with projects connected to
  // a Vercel Blob store without requiring a long-lived read/write token.
  const oidc = oidcToken();
  const store = storeId();
  if (oidc && store) return { oidcToken: oidc, storeId: store };

  // Let the current @vercel/blob SDK auto-detect Vercel's runtime OIDC
  // credentials when they are injected by the platform.
  return {};
}

function options(access = 'public') {
  return { access, ...authOptions() };
}

export function getBlobAuthInfo() {
  const token = Boolean(staticToken());
  const store = Boolean(storeId());
  const oidc = Boolean(oidcToken());
  return {
    mode: token ? 'vercel-blob-token' : (store ? 'oidc' : 'not-detected'),
    blobReadWriteToken: token,
    blobStoreId: store,
    vercelOidcToken: oidc
  };
}

export function hasBlobCredentials() {
  const auth = getBlobAuthInfo();
  return auth.blobReadWriteToken || auth.blobStoreId;
}

export async function checkBlobConnection() {
  // Do not call Blob list() from health checks: list is an advanced operation.
  // Credential presence is enough for the health endpoint; real reads/writes
  // still surface their own errors when an actual job uses Blob.
  if (hasBlobCredentials()) return { ok: true, error: null };
  return { ok: false, error: 'Vercel Blob credentials/OIDC belum terdeteksi.' };
}

export function blobPublicUrl(pathname) {
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
  const result = await get(pathname, { ...options('public'), useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  if (type === 'json') return JSON.parse(await new Response(result.stream).text());
  if (type === 'text') return await new Response(result.stream).text();
  return await new Response(result.stream).arrayBuffer();
}

export async function getBlobUrl(pathname) {
  const result = await get(pathname, { ...options('public'), useCache: false });
  return result?.blob?.url || null;
}

export async function readBlobJson(pathname) {
  try { return await getBlob(pathname, 'json'); } catch { return null; }
}

export async function deleteBlob(pathname) {
  try { await del(pathname, authOptions()); } catch {}
}
