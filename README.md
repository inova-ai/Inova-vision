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
