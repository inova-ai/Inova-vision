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

function parseRange(value, total) {
  if (!value) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!m) return { invalid: true };
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? total - 1 : Number(m[2]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= total || end < start) return { invalid: true };
  return { start, end: Math.min(end, total - 1) };
}

export default async (req) => {
  const method = String(req.method || 'GET').toUpperCase();
  const url = new URL(req.url, 'https://netlify.local');
  const key = String(url.searchParams.get('key') || '');

  if (!['GET', 'HEAD'].includes(method)) return new Response('', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (invalidKey(key)) return new Response(JSON.stringify({ error: 'Invalid blob key.' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  try {
    const data = await getBlobStore().get(key, { type: 'arrayBuffer' });
    if (data == null) return new Response(JSON.stringify({ error: 'Blob tidak ditemukan.' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

    const buffer = Buffer.from(data);
    const type = contentType(key);
    const baseHeaders = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': key.endsWith('.mp4') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    };

    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...baseHeaders, 'Content-Length': String(buffer.length) } });
    }

    const range = key.endsWith('.mp4') ? parseRange(req.headers.get('range'), buffer.length) : null;
    if (range?.invalid) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${buffer.length}` } });
    }

    if (range) {
      const chunk = buffer.subarray(range.start, range.end + 1);
      return new Response(chunk, { status: 206, headers: {
        ...baseHeaders,
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${range.start}-${range.end}/${buffer.length}`
      } });
    }

    return new Response(buffer, { status: 200, headers: { ...baseHeaders, 'Content-Length': String(buffer.length) } });
  } catch (error) {
    console.error('Blob function error:', error?.stack || error?.message || error);
    return new Response(JSON.stringify({ error: 'Gagal membaca blob.' }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
};
