# INOVA VISION — Free Local Video Engine 5.7.0

INOVA VISION membuat video affiliate 9:16 dari foto produk tanpa layanan video berbayar.

## Mesin gratis
- **FFmpeg lokal** untuk membuat scene dengan zoom/pan/camera motion sederhana.
- **Edge TTS** melalui `node-edge-tts` untuk voice Bahasa Indonesia tanpa API key.
- **Script + shot plan fallback lokal**, jadi `OPENAI_API_KEY` tidak wajib.
- **Netlify Blobs** untuk menyimpan foto, audio, scene MP4, dan final MP4.
- OpenAI hanya **opsional** untuk creative planning yang lebih pintar.

## Alur
Foto produk → storyboard → voice gratis → render scene 9:16 → subtitle → CTA → musik opsional → MP4 final.

## Environment Variable
Yang dibutuhkan:
- Netlify Blobs harus aktif/tersedia pada site.
- `OPENAI_API_KEY` **opsional**.
- `FREE_TTS_VOICE` opsional, default `id-ID-GadisNeural`.
- `FREE_TTS_RATE` opsional, default `+0%`.
- `FREE_TTS_VOLUME` opsional, default `+0%`.
- `MUSIC_VOLUME` opsional, default `0.10`.

Tidak ada API video berbayar yang diperlukan.

## Catatan
Renderer lokal tidak menghasilkan frame AI baru seperti model I2V. Gerakan dibuat dari foto asli dengan efek kamera yang stabil, sehingga identitas produk tidak berubah dan biaya API video = Rp0.
