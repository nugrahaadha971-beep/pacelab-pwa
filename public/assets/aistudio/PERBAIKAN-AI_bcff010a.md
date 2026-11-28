# Perbaikan AI PACELAB

## 1. Cara kerja AI di aplikasi (ringkas)

Semua angka (ACWR, TRIMP, EF, drift, prediksi, zona HR) dihitung **lokal** dengan rumus. AI hanya menarasikan atau menyusun rencana dari angka itu; ia tidak menghitung.

| Fitur | Jalur | Apa yang dikirim | Hasil |
|---|---|---|---|
| Pelatih AI (kartu Beranda) | Browser → Gemini langsung, memakai **API key pengguna** di `localStorage` | Ringkasan agregat (ACWR, EF, pace MAF, target lomba) + 7 sesi terakhir | Teks poin; 1 entri cache |
| Susun rencana latihan | Browser → Gemini langsung | Profil, metrik, hari latihan, riwayat | JSON ketat → `PlanSession` |
| Evaluasi program | Browser → Gemini langsung | Rencana vs realisasi | JSON ketat |
| Analisis D-Day | Browser → **server** `/api/race-day-analyze` (API key server) | Ringkasan kesiapan lomba | JSON; bila gagal/offline → hitungan lokal berbasis aturan |

Dua jalur dan dua daftar model (klien vs server) masih terpisah. Itu tidak saya gabungkan.

## 2. Yang diperbaiki

| # | Masalah | Perbaikan | Verifikasi |
|---|---|---|---|
| 1 | Timeout 10 dtk **per model**, ada 4+ model → "timeout" berulang; respons model yang dilewati tidak ditutup | 30 dtk per permintaan, anggaran total 75 dtk, pesan memakai batas sebenarnya, koneksi lama dilepas (`aiCoach.ts`) | ✅ tes |
| 2 | Cache analisis basi: hash hanya `jumlah sesi \| tanggal terbaru \| ACWR`, jadi ubah jenis/RPE sesi, target lomba, atau program tidak membatalkan cache | Hash memuat profil, program, pace MAF, dan sidik jari tiap sesi. `CoachCard` memakai konteks yang sama untuk baca dan tulis cache, dan menghapus hasil lama bila data berubah | ✅ tes |
| 3 | `CoachCard` selalu mengirim `latestMafPaceSec: null`, sehingga AI selalu menulis "Belum ada catatan di zona MAF" | `latestMafPaceSec()` (`maf.ts`) mengambil pace MAF terbaru dari riwayat | ✅ tes |
| 4 | Server: model ditulis mati tanpa cadangan; pesan error mentah dikirim ke klien; tanpa batas laju; teks dari klien masuk prompt apa adanya; JSON rusak dilaporkan sebagai error API | Modul baru `src/server/raceDayAi.ts`: rantai model (`GEMINI_MODELS`), sanitasi, batas 10 permintaan/menit/IP, timeout 40 dtk, pesan error aman | ✅ logika murni diuji · 🔎 `server.ts` tidak dijalankan |
| 5 | Klien D-Day menyerah di 12 dtk (lebih pendek dari server); URL `/api/...` absolut | 45 dtk; `api/race-day-analyze` relatif | 🔎 |
| 6 | "Hapus semua data lokal" meninggalkan **API key Gemini**, model, cache AI, sepatu, mode program | `src/db/localKeys.ts` (`wipeLocalKeys`); teks dialog diperbarui | ✅ tes |

## 3. Cara pakai

- **Patch:** dari akar proyek, `patch -p1 < pacelab-perbaikan-ai.patch`
- **Zip:** ekstrak ke akar proyek (menimpa 11 berkas, menambah 4: `localKeys.ts`, `localKeys.test.ts`, `raceDayAi.ts`, `raceDayAi.test.ts`)
- Tes baru sudah didaftarkan di skrip `test` pada `package.json`.
- Opsional: isi `GEMINI_MODELS` di `.env` (contoh ada di `.env.example`).

## 4. Hasil verifikasi

- ✅ `npm test`: **207 lulus, 0 gagal** (193 bawaan + 14 baru). Patch diterapkan ke salinan asli bersih dan hasilnya sama.
- 🔎 `tsc` dan `vite build` asli belum bisa dijalankan (tidak ada `node_modules`). Dengan modul eksternal dibuat "any", jumlah error tipe **identik dengan sebelum perubahan (251 = 251)**, semuanya artefak shim. `server.ts` tidak ikut `tsconfig` (hanya `src`), jadi hanya sintaksnya yang saya periksa.
- 🔎 Tidak ada panggilan nyata ke Gemini dan UI belum dirender.

## 5. Belum diubah

1. **Nama model.** `gemini-4-hydrogen` (server) dan `gemini-3.8-…` (klien) tidak bisa saya pastikan ada di akun Anda. Server tetap mencobanya pertama, lalu model cadangan klien. Ganti lewat `GEMINI_MODELS`.
2. **API key pengguna disimpan polos di `localStorage`** (desain BYO-key). Risikonya ada bila terjadi XSS. Sekarang ikut terhapus saat "Hapus semua data lokal".
3. **Batas laju di memori** per instance server. Untuk beberapa instance perlu penyimpanan bersama.
4. **`npm start` masih menjalankan dev server Vite** karena `NODE_ENV` tidak diset (BUG-09 di dokumen sebelumnya). Itu memengaruhi server tempat endpoint AI berjalan.
