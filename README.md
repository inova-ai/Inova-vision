# INOVA VISION AI — Vercel Edition 6.2.0

Migrated from Netlify to Vercel, with Vercel Blob delivery for uploaded media and final MP4 files.

## Vercel setup
1. Import this ZIP as a new Vercel project.
2. Deploy once.
3. Open the project in Vercel → **Storage** → create/connect a **Vercel Blob** store.
4. The store must use **Public** access because the browser plays the final MP4 directly from the Blob CDN.
5. Redeploy after connecting the store if Vercel asks you to.

The current `@vercel/blob` SDK supports Vercel OIDC authentication, so a long-lived `BLOB_READ_WRITE_TOKEN` is not necessarily required when the Blob store is connected to the same Vercel project. The code also supports the token if one is supplied.

## Render architecture
- Node.js 22 Vercel Function
- FFmpeg local renderer
- `waitUntil()` for the asynchronous render worker
- Vercel Blob for jobs, source uploads, scene MP4s and final MP4
- Final MP4 is returned as the real Vercel Blob CDN URL instead of being buffered through an API proxy
- H.264 + AAC + yuv420p + faststart + 30 FPS validation
- Photo → Video and Video → Video editing remain available
- Prompt-based video filters remain available

The project keeps the existing 4 MB server upload guard because Vercel server-side function request bodies are limited to about 4.5 MB. For larger source videos, a future client-direct Blob upload can remove that bottleneck.


## Optional AI Video
Set `MAGIC_HOUR_API_KEY` in Vercel to enable Wan 2.2 Image-to-Video. The UI supports Auto, AI, and Local Free. Auto falls back to Local Free if AI is unavailable or fails.


## V13 — Blob Operations Optimized

- Menghapus seluruh `Blob list()` dari health/job lookup.
- Status job memakai satu JSON Blob yang dibaca dengan `get()`; progress/step yang sering berubah hanya disimpan di memory selama worker berjalan.
- Persist job hanya pada milestone penting: job dibuat, perubahan status penting, scene selesai, compose, completed/failed.
- Voice Edge TTS tidak lagi di-upload ke Blob per scene; audio disimpan sementara di `/tmp`.
- Scene MP4 tidak lagi di-upload satu per satu ke Blob; scene disimpan sementara dan langsung di-compose. Hanya `final.mp4` yang dipersist ke Blob.
- Mode Local/Free tidak lagi meng-upload foto sumber ke Blob; foto diproses dari `/tmp`.
- Video sumber dan musik juga diproses dari `/tmp` selama worker.
- Mode AI tetap meng-upload foto sumber ke Blob karena provider AI membutuhkan URL gambar publik.
- Polling UI diperlonggar menjadi 2,5 detik untuk mengurangi read operations.

V13 ditujukan untuk menurunkan Advanced Blob Operations secara drastis pada Hobby. Vercel saat ini memasukkan upload sebagai advanced operation dan Hobby memiliki 2.000 advanced operations/bulan.


## V6.6 AI Photo 3-View / Triptych

V6.6 adds an **AI Photo 3-View** tool. The first uploaded product photo can be transformed into one vertical 9:16 catalog-style triptych: front view, back view, and 3/4 view. A product-angle preset is also available.

The feature uses Magic Hour AI Image Editor with `qwen-edit` by default. Configure `MAGIC_HOUR_API_KEY` in Vercel. The default 640px output keeps AI credits lower.

### Blob operation budget

The triptych endpoint intentionally performs only two Vercel Blob advanced operations per result: **1 source upload + 1 final output upload**. It does not use Blob `list()`, job-state polling writes, scene uploads, or per-scene voice uploads.
