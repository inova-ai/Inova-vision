# INOVA VISION 6.7.1 — Supabase Storage (No Vercel Blob)

Versi ini memindahkan penyimpanan permanen INOVA VISION dari Vercel Blob ke **Supabase**.
Vercel tetap dipakai sebagai hosting/API dan FFmpeg tetap memproses file sementara di `/tmp`.

## Yang berubah

- **Vercel Blob dihapus dari package dan source code.**
- Foto/video final disimpan di **Supabase Storage**.
- Status job disimpan di **Supabase Postgres** (`public.inova_jobs`) agar polling tetap bekerja lintas Vercel Function instance.
- Scene MP4 dan audio TTS tetap lokal di `/tmp` selama render; tidak ada upload per scene.
- Mode AI Video mengunggah foto sumber ke Supabase agar Magic Hour dapat mengambil URL publik.
- AI Photo 3-View juga memakai Supabase untuk foto sumber + hasil final.
- Tidak ada `@vercel/blob`, `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, atau OIDC Blob yang dibutuhkan lagi.

## Setup Supabase — wajib satu kali

1. Buat project di Supabase.
2. Buka **SQL Editor** dan jalankan isi `supabase-schema.sql`.
3. Di Vercel → Project → Settings → Environment Variables, tambahkan:
   - `SUPABASE_URL` = URL project Supabase, contoh `https://xxxx.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = **service_role key** dari Supabase. Simpan sebagai server secret; jangan pernah ditaruh di frontend.
   - `SUPABASE_STORAGE_BUCKET` = `inova-vision` (opsional; default sudah `inova-vision`)
4. Deploy ulang Vercel.

Aplikasi akan membuat bucket `inova-vision` jika belum ada dan memastikan bucket bersifat **Public**, karena URL hasil perlu bisa dibaca browser dan provider AI.

## Magic Hour (opsional)

Untuk AI Video dan AI Photo 3-View, tambahkan:

- `MAGIC_HOUR_API_KEY`
- `MAGIC_HOUR_VIDEO_MODEL` (opsional, default `wan-2.2`)
- `MAGIC_HOUR_IMAGE_MODEL` (opsional, default `qwen-edit`)
- `MAGIC_HOUR_IMAGE_RESOLUTION` (opsional, default `640px`)

Tanpa Magic Hour, Local Free Motion tetap bisa digunakan.

## OpenAI (opsional)

- `OPENAI_API_KEY` hanya diperlukan bila ingin creative plan berbasis OpenAI. Tanpa key, aplikasi memakai local fallback.

## Cek koneksi

Buka `/api/health`. Pada versi benar, respons akan menunjukkan:

- `storageProvider: "supabase"`
- `supabaseStorage: true`
- `blobStorage: false`
- `blobRemoved: true`

Jika `supabaseStorage` masih `false`, periksa `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` di Environment Variables lalu deploy ulang.

## Batas upload

Jalur upload server masih memakai batas konservatif 3 MB per file dan total sekitar 4 MB agar aman terhadap batas request serverless. Penyimpanan permanen tidak lagi menggunakan Vercel Blob.
