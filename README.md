# INOVA VISION v6.0.0

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
