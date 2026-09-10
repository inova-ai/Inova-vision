# INOVA VISION v5.8.3

Netlify Free Local renderer.

## Real render fix
- The JPEG is explicitly looped as the FFmpeg video input for the entire scene duration.
- Silent audio is now a separate second input.
- Voice audio is padded/cut to the requested duration.
- Each scene is validated for duration and frame count before being stored.
- The final MP4 is validated for duration and frame count before COMPLETED is written.
- MP4 delivery uses the dedicated Netlify Blob function with base64 binary responses and Range/206 support.
- The browser player uses the same-origin `/api/blob` URL.
