# PACELAB (v2.4.0)

## Status per fase
- **Fase 1** Scaffold Vite + React + TS, skema Dexie (`workouts`, `userProfile`), ekspor/impor JSON, layar profil. Tailwind belum dipasang.
- **Fase 2** Impor GPX (DOMParser, moving time, lap per km, HR, elevasi) dan input manual dengan validasi durasi serta RPE. **Parser FIT** sudah ada (`fitParser.ts`, decoder biner mandiri tanpa dependensi). Fase 2 selesai.
- **Fase 3** Engine analitik: Tanaka, Banister TRIMP, Session-RPE, EF + tren 14 hari, ACWR, Riegel + penalti volume dan long run. Ada tes unit. **VDOT** ada sejak v1.7 (rumus Daniels).
- **Fase 4** Konfigurasi PWA (`vite-plugin-pwa`, `manifest.json`, `base` GitHub Pages). **Belum ada**: lima tab penuh, grafik Recharts, styling mengikuti mockup, ikon PWA (`public/icons/`).

## Perbaikan terhadap blueprint
1. **ACWR**: baseline kronis = total 28 hari ÷ 4. Membagi total dengan 1 menghasilkan rasio ~0,25 untuk beban konstan.
2. **Penalti**: blueprint menyebut ambang 10K, tetapi teks penalti hanya untuk 21,1K dan 42,2K. 10K tidak dikenai penalti.
3. **Konstanta penalti** (12% volume, 8% long run) dan ambang long run 21,1K (18 km) tidak ada di blueprint. Keduanya ada di `predictor.ts` dan bisa disetel. Angka "+20 menit" di mockup tidak bisa direproduksi dari rumus dokumen.
4. **Durasi**: "JJ:MM:DD" diganti HH:MM:SS (MM:SS untuk target singkat).
5. **Basis Riegel**: "sesi performa terbaik 42 hari" diartikan sebagai sesi ≥ 5 km dengan proyeksi tercepat.
6. **Cadence GPX** dikali 2 (spm) karena banyak perangkat mencatat per kaki.

## Menjalankan
```
npm install
npm test        # butuh Node ≥ 22.6 (--experimental-strip-types)
npm run dev
npm run build
```
`base` sudah relatif (`./`), jadi tidak perlu disesuaikan dengan nama repositori. Lihat bagian "Deploy ke GitHub Pages" di bawah.

## v1.5.0 — Rencana 8 Minggu Nike Run Club 5K
- Data: `src/plans/nike5k.ts` (8 minggu + Hari-H). Urutan sesi mengikuti urutan teks PDF; PDF tidak mencantumkan nama hari.
- Pace: `src/plans/pace.ts` mencari baris Pace Chart terdekat dari 5K terbaru Anda, lalu mengisi target per langkah.
  Mile Pace = kolom mile best; Recovery & Long Run = recovery pace; Race Day = 5K avg mile pace; Best Pace = sesuai effort (tanpa angka).
- Kolom half marathon dan marathon tidak dipakai.
- Temuan di PDF: Minggu 1 (Tempo) langkahnya berjumlah 20:00, tetapi judulnya 15:00. Teks PDF menyebut dua recovery run per minggu, tetapi Minggu 1 memiliki tiga.
- Input 5K tidak disimpan; diisi ulang setiap buka layar.

## v1.6.0 — Fase 2 selesai (Parser FIT)
- `src/parsers/fitParser.ts`: membaca header, definisi/data pesan, header timestamp terkompresi, dan field developer (dilewati). Mengambil session (jarak, durasi, HR, elevasi) dan split per km dari record.
- Tes memakai berkas FIT sintetis. Belum diuji dengan berkas Garmin/Coros asli.
- Asumsi: cadence dikali 2 (sama dengan GPX); bila ada beberapa session, yang dipakai session pertama; CRC berkas belum divalidasi.

## v1.7.0 — Fase 3 selesai
- `workload.ts`: `cardiacDrift(laps)` = penurunan EF paruh pertama ke paruh kedua lap (aerobic decoupling). Butuh minimal 4 lap dengan HR.
- `predictor.ts`: `vdot()` (Daniels), `velocityFor()` untuk zona pace (titik tengah %VO2max: 66,5 / 79,5 / 85,5 / 97,5), `currentVdot()` dari sesi ≥ 3 km dalam 42 hari.
- `coachEngine.ts`: aturan blueprint 4.1 (catatan EF) dan 4.2 (ACWR → sesi berikutnya). Murni logika, tanpa dependensi UI.
- Asumsi yang perlu ditinjau: ambang drift 5%, durasi tambahan +10 menit untuk beban rendah, dan titik tengah zona Daniels.
- Fase 4 (grafik Recharts, lima tab, UI backup, ikon PWA) belum dikerjakan.

## v1.9.0 — Fase 4 tuntas
- `.github/workflows/deploy.yml`: build dan deploy otomatis ke GitHub Pages pada push ke `main`. Di pengaturan repositori, pilih Settings → Pages → Source: GitHub Actions. Commit `package-lock.json` agar `npm ci` dipakai; tanpa lockfile, workflow memakai `npm install`.
- Tes tidak dijalankan di workflow karena butuh Node 22+ (`--experimental-strip-types`), sedangkan workflow memakai Node 20.
- `UserProfile.weeklyTargetKm` dan `Workout.note` bersifat opsional, sehingga data lama tetap kompatibel.
- Filter kategori jarak memakai jarak lomba terdekat dengan selisih ≤ 10%. Sesi di luar itu hanya tampil di "Semua jarak".
- Riwayat: pencarian dibatasi pada catatan dan jenis sesi, karena sesi tidak punya judul.

## v2.0.0 — penyempurnaan
Perbaikan bug dari v1.9:
- Max HR manual tidak lagi tertimpa Tanaka saat profil disimpan ulang (checkbox otomatis hanya aktif bila nilai tersimpan memang hasil Tanaka).
- Impor FIT/GPX tanpa HR kini meminta RPE; sebelumnya beban (TRIMP) tercatat 0 tanpa peringatan.
- Impor memilih jenis sesi (sebelumnya selalu Easy, yang mencemari tren EF); jenis dan catatan bisa diubah di detail sesi.
- Impor berkas yang sama (atau FIT dan GPX dari lari yang sama) dilewati: waktu mulai ≤ 2 menit dan jarak ≤ 0,1 km.
- Input berkas direset setelah dipakai sehingga berkas yang sama bisa dipilih ulang.
- Sesi manual punya tanggal (tidak lagi selalu hari ini).
- Warna tema status bar disamakan dengan latar aplikasi; layar kembali ke atas saat pindah tab.

Tambahan:
- Jarum ACWR (gauge) dan pita zona 0,8–1,3 pada grafik ACWR.
- Filter jenis sesi di Riwayat; tombol "Hapus semua data lokal" di Profil.
- Impor cadangan divalidasi (`src/db/validate.ts`): sesi rusak dilewati dan dilaporkan; profil lama dipertahankan bila cadangan tidak memuat profil valid.
- Input 5K di Program tersimpan di localStorage (tidak ikut cadangan JSON) dan terisi awal dari prediksi Riegel.
- Ikon stopwatch baru, termasuk varian maskable.
- Workflow menjalankan tes (Node 22) sebelum build (Node 20). Hapus job `test` dan `needs: test` bila tidak diinginkan.
- `src/analytics`, `src/parsers`, dan `src/plans` tidak diubah dari v1.9.

## v2.1.0 — Pelatih Pemecah PB Adaptif dengan Jadwal Tanggal Nyata
Label statis "8 minggu lagi" dihapus. Tab **Program** kini memetakan rencana mundur dari `targetRaceDate`.

**Kalender mundur** (`src/plans/schedule.ts`)
- `daysRemaining = ceil((tanggal lomba − hari ini) / 86400000)`, `weeksRemaining = ceil(daysRemaining / 7)`, dihitung pada tanggal kalender (aman DST).
- `weeksRemaining > 8`: minggu awal = **Base Building** (Easy Run + Long Run, target volume naik maks +10%/minggu, berhenti di batas `weeklyTargetKm` profil → syarat volume 21,1K/42,2K → 50 km), lalu blok puncak 8 minggu (templat Nike).
- `weeksRemaining ≤ 8`: memakai N minggu **terakhir** templat Nike; sesi terakhir = **Hari Lomba / Uji PB** tepat di `targetRaceDate`; minggu terakhir = **Taper** (volume −35%, langkah pace speed dipertahankan).
- Minggu rencana adalah blok 7 hari yang dihitung mundur dari hari lomba (bukan Senin–Minggu).
- Tanggal lomba bisa diubah di atas tab Program (tersimpan ke profil, sinkron dengan Profil).

**Hari latihan & Adjust Jadwal**
- Pilih hari rutin (default Sel/Kam/Sab/Min, minimal 3). Long Run jatuh di Sab/Min pilihan; Speed tidak pernah bersebelahan dengan Long Run (termasuk lintas minggu). Bila hari terpilih tidak memungkinkan, Speed diturunkan jadi Easy Run dan ditandai. Bila hari lebih sedikit daripada sesi, Recovery dibuang lebih dulu.
- Geser semua ±1 hari, Reset, ubah tanggal per sesi, tukar sesi (dalam minggu yang sama). Hari lomba tidak ikut bergeser; sesi lain tidak bisa jatuh pada/setelah hari lomba.
- Disimpan di `localStorage` (`pacelab.schedule`) dan ikut diekspor/diimpor di cadangan JSON (field `schedule`, cadangan lama tanpa field itu tetap bisa diimpor).
- Auto-Complete: sesi berstatus Selesai bila ada catatan latihan pada tanggal itu (≤ hari ini); bisa juga dicentang manual.

**Mesin adaptif** (`src/plans/adaptiveEngine.ts`)
- Progresi pace: `weekPace = currentPace − (currentPace − targetPace) × (minggu / totalMinggu)`; `currentPace` = proyeksi Riegel. Kartu atas Program menampilkan gap waktu, label peluang, dan perbaikan per minggu yang dibutuhkan.
- Aturan setelah sesi terakhir (dievaluasi ulang setiap render, jadi hilang/berubah saat data baru masuk): ACWR > 1,3 → Speed berikutnya jadi Recovery Easy Run, −20% durasi; EF terakhir ≥ rata-rata EF 14 hari +3% → pace Speed berikutnya −4 dtk/km; drift > 5% → pace Easy berikutnya +12 dtk/km; ACWR < 0,8 dan drift ≤ 5% → Easy/Long berikutnya +10% (maks +10 menit).

**Keputusan/asumsi yang perlu ditinjau**
- "Sesi berikutnya" = sesi pertama dengan tanggal ≥ hari ini yang belum selesai, per jenis (Speed / Easy / Easy-atau-Long). Aturan 1 menang atas aturan 2 pada sesi yang sama.
- Rata-rata EF 14 hari = sesi ber-EF dalam 14 hari sebelum sesi terakhir, tidak termasuk sesi terakhir, semua jenis sesi (sama seperti spesifikasi; membandingkan EF antarintensitas bisa bias).
- Drift tidak diketahui (tanpa lap/HR) dianggap ≤ 5% untuk aturan 4.
- Bila proyeksi sudah lebih cepat dari target, pace ditahan di pace target (rumus apa adanya akan melambat).
- Estimasi durasi sesi Speed = jumlah langkah berdurasi, minimal 30 menit. Sesi bernama jarak dikonversi lewat easy pace (zona VDOT, default 6:00/km). Persen long run Base (35%), ambang label peluang (2/5/10%) juga asumsi.
- Blok puncak tetap templat Nike 5K walau jarak target lain; hint pace chart mengikuti input 5K, dan pace target PB mengikuti jarak target. Volume akhir Base bisa jauh di atas volume minggu pertama Nike; itu sifat templatnya.
- `PB` di sini = proyeksi Riegel saat ini (aplikasi belum menyimpan PB terpisah).
- `tsconfig.json`: `allowImportingTsExtensions` diaktifkan agar modul yang diuji lewat `node --experimental-strip-types` bisa saling impor.

## v2.1.1 — kartu latihan lebih jelas
- Setiap sesi Easy/Recovery/Long menampilkan **jarak (km)** dan **rentang pace (menit/km)**; sesi Speed menampilkan pace per langkah dalam /km. Mil tidak lagi ditampilkan.
- Penjelasan singkat tiap jenis latihan di kartu + kamus "Apa itu Easy, Recovery, dan Long Run?".
- Ringkasan total jarak per minggu.
- Pace santai memakai satu sumber (Pace Chart kolom recovery bila ada, jika tidak zona Easy VDOT) sehingga jarak, durasi, dan pace konsisten.
- Fase Base: volume awal minimal 10 km/minggu dan tiap Easy Run minimal 2 km (data 28 hari yang sangat sedikit tidak lagi menghasilkan lari 0,8 km). Angka ini asumsi (`MIN_BASE_WEEKLY_KM`, `MIN_EASY_KM`).

## v2.2.0 — Smart Plan Selector & Hybrid Curriculum
`nike5k.ts` tidak diubah. `src/analytics/`, `src/parsers/`, dan `src/db/` tidak disentuh pada versi ini (pilihan mode disimpan di `localStorage` `pacelab.planMode`, bukan di cadangan JSON).

**Kurikulum Progresif 5K** (`src/plans/progressive5k.ts`): 11 minggu lari-jalan (L/J) + HR-first sesuai PDF program (Fondasi 1–4, Kecepatan & Daya Tahan 5–8, Spesifik Lomba & Taper 9–11; Tes 3K Sabtu minggu 4, Tes 5K Sabtu minggu 8). Skala: sisa > 11 minggu → minggu awal Base Building; sisa < 11 minggu → memakai N minggu terakhir (fase Fondasi sebagian dilewati, kartu memberi peringatan). Race 5K tepat di `targetRaceDate`; shake-out sehari sebelum lomba dipertahankan.

**Pemilih** (`src/plans/planSelector.ts`, `selectBestPlan`): Progresif bila SALAH SATU — 5K terbaik/proyeksi ≥ 40:00; < 3 sesi/minggu (28 hari); HR rata-rata sesi Easy terakhir > 80% HR maks atau drift > 5%. Nike bila 5K < 40:00, ≥ 3 sesi/minggu, dan HR stabil. Mode `auto | progressive5k | nike5k` (default `auto`) dipilih lewat pill di atas tab Program, beserta alasan spesifik.

**HR-first**: easy/long 71–82% HR maks, interval 90–96%, race 90–95% (dibulatkan ke atas; HR maks 182 → 130–150 / 164–175 / 164–173) ditampilkan di samping pace /km beserta instruksi "utamakan HR".

**Kalibrasi Tes 3K**: sesi 2,8–3,2 km pada minggu tes dengan RPE ≥ 8 atau HR rata-rata ≥ 88% HR maks → proyeksi 5K = waktu 3K × 1,72; pace interval minggu berikutnya = pace 3K − 10–20 dtk/km (ulangan 400 m lebih dekat −20).

**Rasio Long Run vs Easy**: Long Run ≥ Easy/Recovery terpanjang + 1,5 km ATAU + 15 menit (dinaikkan seperlunya). Easy Base dikunci 2,0–2,5 km; Easy Nike maks 30 menit. Bonus beban rendah (ACWR < 0,8, +10% maks +10 menit) kini hanya ke Long Run berikutnya.

**Keputusan/asumsi yang perlu ditinjau**
- Long Run minggu 3 Progresif = 51' (spesifikasi 50') agar selisih ≥ 15 menit dari sesi Tue 3×(10'L/2'J) = 36'.
- Minggu deload (4 dan 8) dikecualikan dari aturan margin Long Run (long run sengaja ringan 30').
- Kurikulum Progresif tidak mengunci Recovery ≤ 30 menit dan tidak memangkas taper lagi (durasinya sudah ditetapkan kurikulum).
- Tes (Sabtu) boleh bersebelahan dengan Long Run Minggu karena Long Run setelahnya ringan; Speed biasa tetap tidak boleh.
- 5K "terbaik" = yang tercepat antara proyeksi Riegel dan catatan 5K aktual (4,9–5,2 km). Tanpa sesi bertipe Easy, sesi terakhir dipakai (ditandai di alasan). Data HR kosong dianggap tidak melanggar; 5K tak terproyeksi → Progresif.
- Zona `test` (88–95% HR maks) dan perkiraan durasi sesi interval/tes (pace nominal) adalah asumsi. Pace interval sebelum Tes 3K dicatat tidak ditampilkan (hanya HR dan "pace menuju PB").
- Pace race pada kartu memakai target waktu di Profil; sesuaikan bila target Anda belum realistis.

## Analitik Perkembangan (Tahap 9)
- `src/analytics/progressSummary.ts`: `compareProgress(workouts, now, days)` membandingkan `days` hari terakhir dengan `days` hari sebelumnya (jarak, pace santai, EF, HR santai, kadens, cardiac drift, porsi intensitas 80/20, deret per sesi untuk grafik). Murni dari data `Workout`; skema IndexedDB dan parser tidak berubah.
- `src/components/Analitik.tsx`: header + pemilih 7/28/90 hari → Ringkasan Perkembangan (kesimpulan 1 kalimat + 4 ubin KPI + terjemahan ke dtk/km dan bpm) → Keseimbangan Intensitas → Rasio Beban (gauge + tren) → Tren Pace Santai (sumbu Y terbalik) & VDOT → grafik EF dan volume mingguan (dipertahankan dari versi sebelumnya) → Pencapaian → Zona Pace & Prediksi Riegel.
- Penyimpangan kecil dari draf spesifikasi: `'recovery'` dihapus dari himpunan tipe santai (tidak ada di `WorkoutType`, akan error TypeScript); impor memakai ekstensi `.ts` (konvensi repo agar tes `node` jalan); "pace tercepat" mengabaikan pace tidak valid (0); label gauge ACWR diganti `Aman` / `Perlu hati-hati` / `Terlalu berat` (sebelumnya bahasa Inggris).

## Program MAF (Maffetone)
Program ketiga di samping Progresif 5K dan Nike 5K; dipilih lewat pill **MAF** di tab Program (tidak dipilih otomatis; rekomendasi otomatis tidak berubah).
- **Rumus** (`src/plans/maf.ts`): HR MAF = 180 − usia + penyesuaian (−10 sakit/operasi/obat rutin; −5 cedera, sering flu, alergi; 0 default; +5 > 2 tahun berlatih tanpa cedera dan terus membaik). Usia ≤ 16 memakai 165. Tambahan untuk usia > 65 tidak otomatis. Zona latihan = HR MAF − 10 → HR MAF. Usia diambil dari Profil; pilihan penyesuaian tersimpan di `localStorage` (`pacelab.mafAdj`), tidak masuk cadangan JSON.
- **Kurikulum 12 minggu**: 3 lari MAF + 1 Long Run per minggu (Sel/Kam/Sab/Min), volume naik ≤ 10%/minggu, minggu 4 dan 8 ringan + **MAF Test 5 km** (Sabtu), minggu 12 taper + lomba. Skala mengikuti sisa minggu: > 12 minggu → Base MAF di awal, < 12 → minggu terakhir kurikulum.
- **Kartu Zona MAF** (`MafCard.tsx`): HR MAF, zona, pilihan kondisi, dan pelacak **pace di zona MAF** (sesi apa pun selain race, ≥ 3 km, dengan HR rata-rata −5…+3 bpm dari HR MAF; selisih pace pertama → terakhir). MAF Test yang dicatat sebagai Tempo atau Interval tetap terhitung. Kartu sesi menampilkan detak jantung sebagai patokan utama dan pace hanya perkiraan.
- MAF Test tidak diperlakukan sebagai sesi kecepatan oleh mesin adaptif (tidak diubah jadi Recovery saat ACWR tinggi, pace tidak dipercepat). Sejak v2.2.1, ACWR > 1,3 memperpendek lari MAF berikutnya −20% (zona tetap); lihat v2.2.1.
- Asumsi yang bisa disetel: toleransi HR −5/+3 bpm, pengurangan −20% saat ACWR tinggi, perkiraan durasi MAF Test (pace nominal 10:00/km), pembagian durasi mingguan. Metode ini paling efektif sebagai fondasi 3–6 bulan; kartu memberi peringatan bahwa hasil lomba dalam 12 minggu bisa belum maksimal.

## v2.2.1 — Perbaikan evaluasi Program MAF
- **Beban tinggi di MAF**: sebelumnya ACWR > 1,3 tidak mengubah apa pun pada program MAF, karena tidak ada sesi Speed. Sekarang lari MAF berikutnya (bukan MAF Test) durasinya −20%, dengan alasan yang ditampilkan di kartu sesi. Zona detak jantung tidak berubah. Aturan Speed untuk program lain tidak berubah.
- **Pelacak pace MAF**: tidak lagi memfilter jenis sesi. Sesi apa pun selain race dengan HR rata-rata di zona MAF dihitung, sehingga MAF Test yang dicatat sebagai Tempo atau Interval tetap masuk.
- **Teks rumus**: "180 − usia" tidak lagi ditampilkan untuk usia ≤ 16. Kartu MAF menampilkan rumus yang benar (mis. "165 (usia ≤ 16) − 5 = 160"). Usia dibulatkan dulu di `mafHr` agar angka dan teks selalu sama.
- Test: 128 lulus (sebelumnya 124). Test lama yang mengunci perilaku lama (ACWR tanpa penyesuaian di MAF; interval tidak masuk pelacak) sudah diperbarui.
- Empat keputusan desain yang sebelumnya menunggu (pace perkiraan sebelum ada catatan, tren MAF, metrik pace di Analitik, kartu PB di mode MAF) diputuskan dan diterapkan di v2.2.2.

## v2.2.2 — Regresi Beranda MAF dan keputusan desain MAF
Perbaikan regresi di Beranda dan sinkronisasi dengan tab Jadwal:
- **Judul sesi MAF Test** kembali `MAF Test 5 km` (tidak lagi `Speed Run · MAF Test 5 km`).
- **Pace target di Beranda** untuk sesi zona MAF memakai patokan catatan MAF, bukan pace VDOT atau progresi cepat. Bila belum ada patokan, tampil `Sesuai HR`.
- **Detak jantung di Beranda** untuk program MAF kini ikut dihitung (sebelumnya `Isi di Profil` karena HR MAF tidak diteruskan ke jadwal).
- **Saran pelatih** (`coachAdvice`) menerima `curriculum`. Pada program MAF, status beban optimal dan rendah tidak pernah menyarankan Tempo; yang ditekankan adalah lari aerobik di zona HR MAF. Kurikulum yang dipakai sama dengan Beranda (mode manual menang, lalu rekomendasi otomatis dengan proyeksi 5K yang sama).
- Teks placeholder kartu MAF menyebut aturan usia ≤ 16.

### Keputusan desain MAF (terkunci)
Keempat keputusan di bawah berlaku. Fitur berikutnya, termasuk Evaluasi per Sesi, tidak boleh mengubahnya tanpa memperbarui bagian ini.

1. **Pace perkiraan sesi MAF tidak pernah memakai pace VDOT.** Tanpa catatan zona MAF ≥ 3 km, tampil `Sesuai HR (patokan pace muncul setelah 1 sesi MAF ≥ 3 km)` di Jadwal dan `Sesuai HR` di Beranda. Bila ada catatan, patokannya adalah catatan terakhir di zona MAF ditambah penyesuaian adaptif sesi. Pace tetap hasil, bukan target.

2. **Tren pace zona MAF** (`mafTrend`). Dengan 2–3 catatan, tren adalah selisih catatan pertama dan terakhir. Dengan ≥ 4 catatan, tren adalah selisih rata-rata `k` sampel awal dan rata-rata `k` sampel terbaru, dengan `k = min(3, ⌊n/2⌋)`. Rata-rata hanya **meredam** satu sesi anomali (panas, kurang tidur), tidak menghapusnya: sesi itu tetap ikut dengan bobot 1/k. Kartu MAF menyebut "rata-rata k catatan awal vs k terbaru" bila k > 1.

3. **Pace lari santai di Analitik** = rata-rata seluruh sesi easy dan long run pada periode aktif, tanpa filter batas HR MAF. Keterangan ini ditampilkan di kartu Ringkasan perkembangan. Untuk pace pada detak jantung yang sama, gunakan kartu Zona MAF.

4. **Kartu PB di mode MAF tetap tampil**, dengan aksen `border-l-sky-400` dan keterangan "Mode MAF fokus membangun fondasi aerobik lebih dulu; proyeksi PB tetap dihitung dari performa terbaik terkini." Proyeksi PB tidak dikaitkan dengan fase MAF. Ia dihitung ulang dari performa terbaik (Riegel) dalam jendela waktu, sehingga berubah saat catatan baru masuk.

Teknis: `nextSession.ts` memakai impor berekstensi `.ts` (konvensi repo) agar bisa dites dengan Node. Test baru: `src/components/nextSession.test.ts` (5 kasus, termasuk regresi pace VDOT dan HR MAF yang hilang).

Verifikasi: `npm test` 143 dari 143 lulus. Dua mutasi sementara (menghapus `mafHr` dari jadwal Beranda, dan menghapus cabang pace MAF) masing-masing membuat test gagal.

## v2.3.0 — Evaluasi per Sesi
Setiap sesi latihan kini dievaluasi terhadap zona targetnya, bukan hanya dicatat. Evaluasi tampil di tab **Analitik**:
- **Kartu "Evaluasi sesi terakhir"** di tab *Ringkasan*, di atas *Ringkasan perkembangan*: status, ringkasan, dan saran untuk sesi berikutnya.
- **Tab "Per Sesi"** (`SegmentedTabs`): ringkasan kepatuhan periode (% sesi sesuai target, jumlah perlu perhatian dan belum sesuai, rata-rata HR MAF dan drift), filter status, lalu kartu per sesi yang bisa dibuka (posisi HR terhadap zona, empat metrik inti, rincian pemeriksaan, grafik HR per km).

**Aturan evaluasi** (`src/analytics/sessionAnalysis.ts`, murni tanpa UI):
- *HR*: pada zona MAF dan mudah, HR rata-rata di atas batas atas berarti *belum sesuai*; lonjakan (HR puncak > batas + 4, atau ≥ 2 km di atas batas) berarti *perlu perhatian*. Zona intensitas tinggi memakai HR rata-rata, kecuali interval yang memakai HR puncak.
- *Drift* (cardiac drift): ≤ 5% aman; > 5% pada sesi aerobik berarti *perlu perhatian*.
- *Pacing*: perbandingan paruh pertama dan kedua lap; pada sesi aerobik, paruh kedua yang melambat demi menjaga HR dinilai positif.
- *Jadwal & EF*: durasi dibandingkan dengan rencana (85–120% dianggap sesuai); EF dibandingkan dengan rata-rata 28 hari.
- *Status*: `optimal` (sesuai target), `caution` (perlu penyesuaian), `off_target` (belum sesuai zona), `incomplete` (data HR belum lengkap).

**Konteks program** (`programContextFor` di `Analitik.tsx`): kurikulum, penyesuaian MAF pengguna (`loadMafAdj`), dan rencana sesi dibangun dengan cara yang sama seperti Beranda, termasuk penyesuaian adaptif. Dengan begitu, sesi yang dianalisis cocok dengan jadwal yang dilihat pengguna.

**Keputusan desain MAF (terkunci) tetap berlaku di v2.3.0:**
1. Pace perkiraan sesi MAF tidak memakai VDOT. Di Analitik, `mafPaceSecPerKm` bernilai `null` sampai ada catatan MAF ≥ 3 km; tidak pernah jatuh ke `easyPaceSecPerKm`.
2. Tren pace MAF tidak berubah (dibahas di v2.2.2).
3. Catatan "Pace lari santai = rata-rata seluruh sesi easy dan long run …" dipertahankan di kartu *Ringkasan perkembangan*.
4. Kartu PB di mode MAF memakai teks "Mode MAF fokus membangun fondasi aerobik lebih dulu; proyeksi PB tetap dihitung dari performa terbaik terkini."

**Perubahan teks MAF di analisis sesi:** label zona MAF dan pesan "isi usia" kini menyebut aturan usia ≤ 16: `(180 − usia; 165 untuk usia ≤ 16)`. Sesi MAF dengan usia ≤ 16 dievaluasi terhadap 165 bpm (zona 155–165).

**Keterbatasan yang diketahui:**
- `mafPaceSecPerKm` diteruskan ke analisis, tetapi `sessionAnalysis.ts` belum memakainya. Evaluasi sesi MAF berbasis zona HR. Pace MAF tetap dipantau di kartu Zona MAF.
- Konteks program sekarang dihitung di empat tempat (`nextSession`, `CoachCard`, `Analitik`, dan `TrainingPlan`) dengan logika yang mirip. Sebaiknya dipindahkan ke satu helper bersama.

**Tes:** `src/analytics/sessionAnalysis.test.ts` (12 kasus, termasuk usia ≤ 16 dan sesi MAF tanpa patokan pace VDOT). Dua mutasi sementara (label MAF lama, dan pemeriksaan pace VDOT untuk sesi MAF) masing-masing membuat test gagal.



## v2.3.1 — Perbaikan bug & keandalan inti
- **ACWR pengguna baru (`BUG-01`)**: baseline kronis 28 hari dibagi jumlah minggu riwayat yang tersedia (`Math.min(4, historyDays / 7)`) dan membutuhkan minimal 14 hari riwayat (`ACWR_MIN_HISTORY_DAYS = 14`) sebelum dinilai, sehingga pelari baru tidak otomatis berstatus `high_fatigue`.
- **Validasi input & cadangan (`BUG-02`..`BUG-05`)**: menolak durasi `0`, jarak `> 300 km`, dan pace di luar `2:00–20:00 /km`; melarang target waktu `0` dan mengatur batas rentang usia (`10–100`), Resting HR (`30–120`), Max HR (`> Resting HR`, maks `230`); melaporkan sesi rusak yang dilewati saat impor; menyertakan data sepatu & preferensi (`pacelab_shoes`, `pacelab.planMode`, `pacelab.mafAdj`, `pacelab.k5`) ke cadangan JSON v3 (`prefs`) tanpa mengekspor API key Gemini; memastikan "Hapus semua data lokal" membersihkan seluruh kunci di `ALL_LOCAL_KEYS` termasuk API key & cache AI.
- **Parser & ketahanan (`BUG-06`..`BUG-12`)**: pace lap GPX/FIT memakai waktu bergerak (mengabaikan jeda/auto-pause); deteksi spm (`toSpm`) tidak menggandakan cadence `>= 120`; pemuatan IndexedDB dibungkus `try/catch` dengan layar pemulihan; `npm start` menjalankan server produksi `tsx server.ts` sementara `npm run dev` memakai `tsx server.ts --dev`; cache Pelatih AI menyertakan tanda tangan sesi (jenis, RPE, HR, jarak, durasi), profil, dan program; batas waktu per model Gemini dinaikkan menjadi 30 detik (anggaran total 75 detik) dengan penutupan stream respons; `/api/race-day-analyze` mendukung `GEMINI_MODELS` (daftar dipisah koma, default `gemini-4-hydrogen`), sanitasi snapshot, pembatas laju per IP, dan tanpa membocorkan error mentah ke klien.
- **Konfigurasi model Gemini**: atur `GEMINI_MODELS=gemini-4-hydrogen,gemini-2.5-flash` di `.env` (urutan prioritas cadangan).

## v2.4.0 — Peningkatan & fitur baru
- **Peningkatan (`IMP-01`..`IMP-08`)**: endpoint relatif `'api/race-day-analyze'`; font `@fontsource/dm-sans` dan `@fontsource/jetbrains-mono` dibundel offline dan tag Google Fonts CDN dihapus; FIT/GPX non-lari (sepeda, renang, dayung, ski) ditolak saat jenis olahraga terdeteksi; opsi jenis kelamin (`male`/`female`) untuk koefisien Banister TRIMP (`0,86 / 1,67` untuk wanita); kunci `'pacelab.k5'` dipusatkan di `src/plans/k5Store.ts`; CI memakai Node 22 + `npm ci`; `steadyDrift` membatasi perhitungan cardiac drift pada sesi `easy` dan `long_run`.
- **Fitur (`FEAT-01`..`FEAT-05`)**:
  1. Mode restore **Gabung** (melewati duplikat via `isDuplicate`) dan unduh otomatis salinan pengaman sebelum **Ganti semua**.
  2. Edit sesi lengkap di Riwayat (tanggal, jarak, durasi untuk sesi manual, RPE 1–10, jenis sesi, sepatu, catatan) dengan hitung ulang TRIMP & EF otomatis lewat `finalizeWorkout`.
  3. Permintaan `navigator.storage.persist()` saat startup serta pengingat cadangan di Beranda bila ekspor terakhir > 14 hari.
  4. Pembaruan PWA berbasis prompt (`registerType: 'prompt'`) dengan banner non-blokir.
  5. Indikator progres `"Mengumpulkan data beban latihan (X/14 hari)"` saat ACWR berstatus `unknown`.

## Deploy ke GitHub Pages

1. Buat `package-lock.json` yang deterministik untuk CI (`npm ci`) lalu commit:
   ```bash
   npm install --package-lock-only
   ```
2. Buat repositori GitHub baru (kosong), lalu dari folder proyek ini:
   ```bash
   git init -b main
   git add .
   git commit -m "PACELAB v2.4.0"
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
3. Di GitHub: **Settings → Pages → Source: GitHub Actions**.
4. Push ke `main` memicu `.github/workflows/deploy.yml` (tes Node 22 → build Node 22 dengan `npm ci` → deploy). Setelah hijau, aplikasi berjalan di `https://<user>.github.io/<repo>/`.

Lokal: `npm install && npm test && npm run build && npm run preview`.

## Proyeksi Race & Lini Masa MAF (kartu Zona MAF)

`mafRaceOutlook` (`src/plans/maf.ts`, fungsi murni) menampilkan lini masa adaptasi (3–6 minggu awal, 3–6 bulan penuh, sisa minggu menuju lomba), target HR lomba (90–95% HR maks) dengan strategi split, serta estimasi pace/waktu finis. Asumsi: pace lomba 5K = pace MAF − 150…−90 dtk/km; jarak lain × (km/5)^0.06; simulasi hari lomba bila sisa ≥ 4 minggu dengan perbaikan 12 dtk/km per 4 minggu penuh (maks 24 minggu). Perkiraan kasar, bukan prediksi pasti.
