# INOVA VISION v6.1.0

Netlify Free Local renderer.

## Real render fix
- The JPEG is explicitly looped as the FFmpeg video input for the entire scene duration.
- Silent audio is now a separate second input.
- Voice audio is padded/cut to the requested duration.
- Each scene is validated for duration and frame count before being stored.
- The final MP4 is validated for duration and frame count before COMPLETED is written.
- MP4 delivery uses the dedicated Netlify Blob function with base64 binary responses and Range/206 support.
- The browser player uses the same-origin `/api/blob` URL.

## Free Motion Engine

This version is designed to run without a paid video-generation API.

- **Video generation cost:** Rp0/API fee.
- Uses FFmpeg to create subtle camera motion from the original product photo.
- Ken-Burns trajectories vary per scene: push-in, lateral drift, vertical drift, and a gentle push/pull.
- The source image is never AI-regenerated, so product shape, packaging, logo and visible text remain much more stable than generative I2V.
- Output is normalized to H.264/AAC, 30 fps, `yuv420p`, and `+faststart` for Android/Chrome playback.
- Voice remains on the free local/edge-TTS path already used by the project.

### Important

This is **not generative AI video**. It is the free option that prioritizes product fidelity. It cannot create new hand/object movement like a true I2V model, but it avoids the common AI problem of changing the product between frames.


## v6.1.0 — Prompt + Video Editor + MP4 hardening
- Added a user prompt field for creative/edit instructions.
- Added **Edit Video** input mode in addition to Photo → Video.
- Video editing runs locally with FFmpeg and can apply prompt keywords for brightness, contrast, grayscale, sharpening, mirror, cinematic/vintage look, vignette, and speed.
- Source video audio is preserved unless the prompt asks for mute/silent.
- Final MP4 is re-encoded as H.264/AAC, 30 fps, yuv420p, +faststart and validated before the job can become COMPLETED.
- The preview/download URL gets a cache-busting query so an old broken render cannot be reused by the browser.
- Netlify Functions remain limited to small uploads; this build keeps the upload limit conservative at 3 MB per file / 4 MB total.
