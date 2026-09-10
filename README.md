# INOVA VISION v5.8.2

Netlify Free Local renderer.

## v5.8.2 blank-video fix
- Scene rendering no longer uses `zoompan`.
- Uploaded photos are looped directly into 720x1280 video frames using a simple scale/crop/fps filter.
- This avoids MP4 files that finish successfully but contain invisible/blank video frames on some ffmpeg-static builds.
- `drawtext` and `drawbox` remain disabled because the deployed ffmpeg-static build does not provide those filters.
- Netlify Blobs are materialized directly for uploaded photos, voice and music.
- No Replicate dependency or webhook.


## v5.8.2 MP4 delivery fix
- Dedicated Netlify Blob function returns MP4 as base64 binary response.
- Supports HEAD and HTTP Range requests (206 Partial Content).
- Prevents serverless-http from corrupting binary video bytes.
- Final MP4 is validated before the job can become COMPLETED.
- Android/Chrome video element uses a cache-busted MP4 source and graceful playback error fallback.
