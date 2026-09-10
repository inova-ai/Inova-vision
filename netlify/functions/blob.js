import { getStore } from '@netlify/blobs';

const STORE_NAME = process.env.NETLIFY_BLOB_STORE || 'inova-vision-ai';

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: STORE_NAME, siteID, token });
  return getStore(STORE_NAME);
}

function contentType(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function invalidKey(key) {
  return !key || key.startsWith('/') || key.includes('..') || key.includes('\\') || /[\u0000-\u001f]/.test(key);
}

function rangeFor(rangeHeader, total) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) return { invalid: true };

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, total - suffixLength);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || end < start) {
    return { invalid: true };
  }
  end = Math.min(end, total - 1);
  return { start, end };
}

export default async (req) => {
  const method = String(req.method || 'GET').toUpperCase();
  const url = new URL(req.url, 'https://netlify.local');
  const key = String(url.searchParams.get('key') || '');

  if (!['GET', 'HEAD'].includes(method)) {
    return { statusCode: 405, headers: { Allow: 'GET, HEAD' }, body: '' };
  }
  if (invalidKey(key)) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'Invalid blob key.' }) };
  }

  try {
    // Netlify Blobs returns an ArrayBuffer. Converting it to Buffer and then
    // explicitly base64-encoding the function response is important: the
    // normal serverless-http adapter can otherwise corrupt binary MP4 bytes.
    const data = await getBlobStore().get(key, { type: 'arrayBuffer' });
    if (data == null) {
      return { statusCode: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'Blob tidak ditemukan.' }) };
    }

    const buffer = Buffer.from(data);
    const total = buffer.length;
    const type = contentType(key);
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': key.endsWith('.mp4') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    };

    if (method === 'HEAD') {
      headers['Content-Length'] = String(total);
      return { statusCode: 200, headers, body: '' };
    }

    const requestedRange = rangeFor(req.headers?.range || req.headers?.Range, total);
    if (requestedRange?.invalid) {
      headers['Content-Range'] = `bytes */${total}`;
      return { statusCode: 416, headers, body: '' };
    }

    if (!requestedRange) {
      headers['Content-Length'] = String(total);
      return { statusCode: 200, headers, isBase64Encoded: true, body: buffer.toString('base64') };
    }

    const { start, end } = requestedRange;
    const chunk = buffer.subarray(start, end + 1);
    headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    headers['Content-Length'] = String(chunk.length);
    return { statusCode: 206, headers, isBase64Encoded: true, body: chunk.toString('base64') };
  } catch (error) {
    console.error('Blob function error:', error?.stack || error?.message || error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'Gagal membaca blob.' }) };
  }
};
