# INOVA VISION v5.8.4

Netlify Free Local renderer.

## Real render fix
- The JPEG is explicitly looped as the FFmpeg video input for the entire scene duration.
- Silent audio is now a separate second input.
- Voice audio is padded/cut to the requested duration.
- Each scene is validated for duration and frame count before being stored.
- The final MP4 is validated for duration and frame count before COMPLETED is written.
- MP4 delivery uses the dedicated Netlify Blob function with base64 binary responses and Range/206 support.
- The browser player uses the same-origin `/api/blob` URL.


## v5.8.4 render stability
- Removed ffprobe-only `count_frames`, `select_streams`, and `show_entries` flags from the FFmpeg worker.
- Media probing now uses the bundled `ffmpeg-static` binary and its normal input probe.
- Final scene composition always re-encodes to H.264/AAC with normalized timestamps instead of fragile MP4 stream-copy concatenation.
- Final output is decoded and duration-checked before the job can be marked completed.
- MP4 remains delivered through the same-origin Blob endpoint with HTTP Range support for Android/Chrome playback.
