# INOVA VISION v5.8.1

Netlify Free Local renderer.

## v5.8.1 blank-video fix
- Scene rendering no longer uses `zoompan`.
- Uploaded photos are looped directly into 720x1280 video frames using a simple scale/crop/fps filter.
- This avoids MP4 files that finish successfully but contain invisible/blank video frames on some ffmpeg-static builds.
- `drawtext` and `drawbox` remain disabled because the deployed ffmpeg-static build does not provide those filters.
- Netlify Blobs are materialized directly for uploaded photos, voice and music.
- No Replicate dependency or webhook.
