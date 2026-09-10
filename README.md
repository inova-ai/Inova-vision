# INOVA VISION AI v5.6.1 — NETLIFY READY

Versi ini dipindahkan dari Vercel ke Netlify. Tidak membutuhkan Vercel Blob atau @vercel/blob.

## Struktur deploy
- `public/` → website/PWA
- `netlify/functions/api.js` → API utama
- `netlify/functions/replicate-webhook.js` → Replicate webhook Background Function
- `netlify.toml` → routing/build/functions
- `src/` → pipeline AI/video

## Environment Variables di Netlify
Wajib:
- `OPENAI_API_KEY`
- `REPLICATE_API_TOKEN`
- `PUBLIC_BASE_URL` = URL Netlify production (opsional; sistem juga mencoba `URL`/`DEPLOY_PRIME_URL`)

Untuk keamanan webhook:
- `REPLICATE_WEBHOOK_SECRET`

Opsional:
- `OPENAI_SCRIPT_MODEL`
- `NETLIFY_BLOB_STORE` (default `inova-vision-ai`)
- `VIDEO_RESOLUTION`
- `REPLICATE_MODEL_OWNER`
- `REPLICATE_MODEL_NAME`
- `MUSIC_VOLUME`
- `FREE_TTS_VOICE`
- `FREE_TTS_RATE`
- `FREE_TTS_VOLUME`

## Netlify Blobs
File job, foto, audio, scene video, dan final MP4 disimpan di Netlify Blobs. Netlify Functions membaca/menulis store secara langsung. Media diberikan ke Replicate melalui endpoint `/api/blob` milik situs Netlify.

## Replicate webhook
Set webhook Replicate ke:
`https://DOMAIN-NETLIFY-KAMU.netlify.app/api/webhooks/replicate`

Netlify meneruskannya ke Background Function agar proses webhook dan FFmpeg tidak terhenti oleh batas function sinkron. Netlify Background Functions dapat berjalan hingga 15 menit. 

## Deploy
1. Upload project ini ke GitHub atau gunakan Netlify Drop.
2. Netlify Build settings: publish directory `public`, functions directory `netlify/functions` (sudah ada di `netlify.toml`).
3. Isi Environment Variables.
4. Deploy ulang.
5. Buka `/api/health` dan pastikan `version` 5.6.0, `blobStorage:true`, `scriptAI:true`, `configured:true`, dan `ready:true`.
