# INOVA VISION v5.8.0

FFmpeg compatibility fix for Netlify.

- Removes all `drawtext` and `drawbox` filters from final composition because the deployed `ffmpeg-static` binary reports `No such filter: drawtext`.
- Final compose now uses only `format=yuv420p` for video filtering, plus the existing audio mixing path.
- No Replicate webhook or `processWebhook` export is used.
- Source photos/audio are materialized from Netlify Blobs and validated before rendering.
- Subtitles/CTA text remain in the job data/UI but are not burned into the MP4 by FFmpeg.
