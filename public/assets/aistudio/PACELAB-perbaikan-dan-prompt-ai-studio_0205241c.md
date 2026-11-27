# PACELAB v2.3.0 — Daftar Bug, Perbaikan & Update Fitur

Hasil audit `pacelab-pwa-main.zip` (104 berkas, 26 Nov 2026). Semua kode di bawah ditulis untuk struktur repo apa adanya (React 18 + Vite + TS + Dexie + Express/Gemini).

**Legenda verifikasi**

- ✅ **Diuji** — bug direproduksi dengan skrip sebelum diperbaiki, lalu `npm test` lulus setelah perbaikan (salinan proyek: 193 tes awal → **200 tes lulus**, 0 gagal).
- 🔎 **Dibaca dari kode** — logikanya jelas bermasalah, tetapi belum dijalankan. `node_modules` tidak ada dan jaringan nonaktif, jadi `tsc` / `vite build` tidak bisa saya jalankan. Jalankan `npm run lint` setelah menempel kode.

## Ringkasan

| ID | Tingkat | Masalah | Verifikasi |
|---|---|---|---|
| BUG-01 | Tinggi | ACWR pengguna baru = 4,0 → "Kelelahan tinggi", sesi Speed diganti Recovery | ✅ |
| BUG-02 | Tinggi | Form manual menerima durasi 00:00:00 → sesi hilang diam-diam saat restore | ✅ |
| BUG-03 | Tinggi | Restore tidak melaporkan sesi yang dilewati | 🔎 |
| BUG-04 | Tinggi | "Hapus semua data lokal" membiarkan API key Gemini, cache AI, sepatu, dll. | 🔎 |
| BUG-05 | Tinggi | Cadangan JSON tidak memuat sepatu & preferensi | ✅ (validasi) / 🔎 (database.ts) |
| BUG-06 | Sedang | Pace lap GPX/FIT ikut waktu berhenti → drift & pacing salah | ✅ GPX / 🔎 FIT |
| BUG-07 | Sedang | Cadence selalu dikali 2 (perangkat yang sudah spm jadi ±340) | ✅ |
| BUG-08 | Sedang | Layar "Memuat data latihan…" macet jika IndexedDB gagal | 🔎 |
| BUG-09 | Tinggi (deploy) | `npm start` menjalankan dev server Vite | 🔎 |
| BUG-10 | Sedang | Cache AI Coach basi saat profil/target/RPE berubah | 🔎 |
| BUG-11 | Sedang | Timeout 10 detik per model terlalu pendek | 🔎 |
| BUG-12 | Sedang | `server.ts`: model hard-coded, deteksi error rapuh, tanpa rate limit & sanitasi | 🔎 |
| IMP-01 | Rendah | Endpoint `/api/...` absolut salah di subpath GitHub Pages | 🔎 |
| IMP-02 | Sedang | Font DM Sans & JetBrains Mono dari Google CDN → tidak offline | 🔎 |
| IMP-03 | Sedang | FIT/GPX sepeda atau renang terimpor sebagai lari | 🔎 |
| IMP-04 | Sedang | TRIMP hanya koefisien pria | ✅ |
| IMP-05 | Rendah | Profil tanpa batas rentang (usia 500, max HR 999) | 🔎 |
| IMP-06 | Rendah | Kunci `'pacelab.k5'` ditulis manual di 3 berkas | ✅ |
| IMP-07 | Sedang | CI tidak deterministik (tidak ada `package-lock.json`, Node 20 vs 22) | 🔎 |
| IMP-08 | Rendah | Cardiac drift dihitung untuk semua jenis sesi | 🔎 (saran) |
| FEAT-01 | — | Restore mode "Gabung" + salinan pengaman otomatis | 🔎 |
| FEAT-02 | — | Edit sesi lengkap di Riwayat (tanggal, jarak, durasi, RPE) | 🔎 |
| FEAT-03 | — | Penyimpanan persisten + pengingat backup | 🔎 |
| FEAT-04 | — | Notifikasi "versi baru tersedia" untuk PWA | 🔎 |
| FEAT-05 | — | Indikator "mengumpulkan data" untuk ACWR | 🔎 |

---

# A. BUG

## BUG-01 — ACWR pengguna baru selalu "Kelelahan tinggi" ✅

**Berkas:** `src/analytics/workload.ts` (`acwr`). Efek berantai: `adaptiveEngine.ts` memakai rasio ini (`highLoad`), sehingga sesi Speed pertama diganti Recovery; `coachAdvice` menyarankan istirahat.

**Bukti (skrip):** 3 sesi dalam 5 hari, tidak ada riwayat lain → `ratio: 4`, `status: 'high_fatigue'`. Penyebab: `chronicWeekly = total28 / 4` walau riwayat baru 5 hari.

**Perbaikan:** bagi baseline dengan jumlah minggu riwayat yang benar-benar ada (maks 4) dan jangan nilai ACWR bila riwayat < 14 hari.

```ts
// src/analytics/workload.ts — taruh const di atas komentar JSDoc acwr
export const ACWR_MIN_HISTORY_DAYS = 14;

export function acwr(workouts: Workout[], p: HrProfile, now: number): Acwr {
  const past = workouts.filter((w) => w.date <= now);
  const sumDays = (days: number) =>
    past.filter((w) => w.date > now - days * DAY_MS).reduce((s, w) => s + sessionTrimp(w, p), 0);
  const acute = sumDays(7);
  const firstDate = past.reduce((m, w) => Math.min(m, w.date), Infinity);
  // +1: hari pertama dihitung (28 sesi harian = tepat 4 minggu).
  const historyDays = Number.isFinite(firstDate) ? (now - firstDate) / DAY_MS + 1 : 0;
  // Baseline kronis dibagi jumlah minggu riwayat yang ada (maks 4), bukan selalu 4.
  const weeks = Math.min(4, historyDays / 7);
  const chronicWeekly = weeks > 0 ? sumDays(28) / weeks : 0;
  if (chronicWeekly <= 0 || historyDays < ACWR_MIN_HISTORY_DAYS) {
    return { acute, chronicWeekly, ratio: null, status: 'unknown' };
  }
  const ratio = acute / chronicWeekly;
  const status: AcwrStatus = ratio < 0.8 ? 'undertraining' : ratio <= 1.3 ? 'sweet_spot' : 'high_fatigue';
  return { acute, chronicWeekly, ratio, status };
}
```

**Tes baru** (tambahkan ke `src/analytics/analytics.test.ts`):

```ts
test('ACWR: pengguna baru (< 14 hari riwayat) tidak dinilai Kelelahan tinggi', () => {
  const now = Date.UTC(2026, 10, 26);
  const p = { restingHr: 55, maxHr: 185 };
  const mk = (d: number) => ({ date: now - d * DAY_MS, durationSec: 1800, avgHr: 140, rpe: 5 }) as never;
  const baru = acwr([mk(1), mk(3), mk(5)], p, now);
  assert.equal(baru.ratio, null);
  assert.equal(baru.status, 'unknown');
  const stabil = acwr(Array.from({ length: 14 }, (_, i) => mk(i * 2 + 0.5)), p, now);
  assert.equal(stabil.status, 'sweet_spot');
});
```

Tes lama `ACWR beban konstan = 1,0` tetap lulus (28 sesi harian = tepat 4 minggu).

---

## BUG-02 — Durasi 0 dan pace mustahil diterima form manual ✅

**Berkas:** `src/components/QuickLog.tsx` (`onManual`), `src/components/Profil.tsx` (`save`).

**Bukti:** `parseDuration('00:00:00')` mengembalikan `0` (bukan `null`), sehingga lolos validasi `durationSec == null`. Sesi tersimpan dengan pace 0. Saat cadangan dipulihkan, `normalizeWorkout` menolak `durationSec: 0` → **sesi hilang tanpa pemberitahuan** (lihat BUG-03).

```ts
// QuickLog.tsx — di atas komponen
const MIN_PACE_SEC = 120;  // 2:00 /km
const MAX_PACE_SEC = 1200; // 20:00 /km

// QuickLog.tsx — ganti blok validasi di onManual
const durationSec = parseDuration(duration);
const distanceKm = Number(distance.replace(',', '.'));
const next: Errs = {};
if (!date || date > today) next.date = 'Tanggal tidak valid.';
if (durationSec == null || durationSec <= 0) next.duration = 'Durasi harus lebih dari 00:00:00 (jam:menit:detik).';
if (!(distanceKm > 0) || distanceKm > 300) next.distance = 'Jarak harus antara 0 dan 300 km.';
if (!next.duration && !next.distance && durationSec != null) {
  const pace = durationSec / distanceKm;
  if (pace < MIN_PACE_SEC || pace > MAX_PACE_SEC) {
    next.duration = 'Pace tidak masuk akal (harus 2:00–20:00 /km). Periksa durasi dan jarak.';
  }
}
if (rpe == null) next.rpe = 'Pilih skala RPE (1–10).';
```

```ts
// Profil.tsx — di save(): waktu target juga tidak boleh 0
if (targetTimeSec == null || targetTimeSec <= 0) next.targetTime = 'Format jam:menit:detik, contoh 00:50:00 (lebih dari 0).';
```

---

## BUG-03 — Restore tidak melaporkan sesi yang dilewati 🔎

**Berkas:** `src/components/Profil.tsx` (`doImport`). README v2.0 menyebut sesi rusak "dilaporkan", tetapi UI hanya menampilkan `N sesi dipulihkan.` dan mengabaikan `skipped`, `profile`, `schedule`.

```ts
const doImport = async () => {
  const file = pendingImport;
  setPendingImport(null);
  if (!file) return;
  try {
    const r = await importBackup(await file.text());
    const parts = [`${r.workouts} sesi dipulihkan`];
    if (r.skipped > 0) parts.push(`${r.skipped} sesi rusak dilewati`);
    if (!r.profile) parts.push('profil lama dipertahankan (cadangan tidak memuat profil valid)');
    setBackupMsg({ text: parts.join('; ') + '.', ok: true });
    onSaved();
  } catch (err) {
    setBackupMsg({ text: err instanceof Error ? err.message : 'Gagal mengimpor.', ok: false });
  }
};
```

---

## BUG-04 — "Hapus semua data lokal" tidak menghapus semuanya 🔎

**Berkas:** `src/db/database.ts` (`clearAll`) hanya menghapus tabel Dexie dan `pacelab.schedule`. Tertinggal di perangkat: **API key Gemini**, model, cache AI (`pacelab_gemini_api_key`, `pacelab_gemini_model`, `pacelab_ai_coach_cache`), sepatu (`pacelab_shoes`, `pacelab_shoe`), mode program, penyesuaian MAF, input 5K.

Buat satu sumber daftar kunci (lihat juga BUG-05 dan IMP-06):

```ts
// src/db/localKeys.ts (BARU)
import { SCHEDULE_KEY, PLAN_MODE_KEY, MAF_ADJ_KEY } from '../plans/scheduleStore.ts';
import { SHOES_KEY, SHOE_KEY } from '../plans/shoeStore.ts';
import { K5_KEY } from '../plans/k5Store.ts';
import {
  AI_COACH_CACHE_STORAGE_KEY,
  GEMINI_API_KEY_STORAGE_KEY,
  GEMINI_MODEL_STORAGE_KEY,
} from '../analytics/aiCoach.ts';

/** Semua kunci localStorage milik PACELAB. Dihapus oleh "Hapus semua data lokal". */
export const ALL_LOCAL_KEYS: readonly string[] = [
  SCHEDULE_KEY, SHOES_KEY, SHOE_KEY, PLAN_MODE_KEY, MAF_ADJ_KEY, K5_KEY,
  GEMINI_API_KEY_STORAGE_KEY, GEMINI_MODEL_STORAGE_KEY, AI_COACH_CACHE_STORAGE_KEY,
];
```

`clearAll` lengkap ada di bagian BUG-05. Ubah juga teks konfirmasi di `Profil.tsx`:

```tsx
<p>Semua sesi, profil, jadwal, data sepatu, dan API key Gemini di perangkat ini akan dihapus permanen.</p>
```

---

## BUG-05 — Cadangan tidak memuat sepatu & preferensi ✅/🔎

Sepatu (`pacelab_shoes`), mode program, penyesuaian MAF, dan input 5K ada di `localStorage` tetapi tidak ikut `exportBackup`. Setelah restore di perangkat baru, `shoeId` pada sesi menunjuk ke sepatu yang tidak ada dan kilometer sepatu hilang. **API key Gemini sengaja tidak diekspor.**

**1) `src/plans/k5Store.ts` (BARU, juga untuk IMP-06)** ✅

```ts
export const K5_KEY = 'pacelab.k5';

/** Input waktu 5K (teks HH:MM:SS / MM:SS) yang dipakai Program, Riwayat, dan Beranda. */
export function loadK5(): string | null {
  try { return localStorage.getItem(K5_KEY); } catch { return null; }
}

export function saveK5(value: string): void {
  try { localStorage.setItem(K5_KEY, value); } catch { /* penyimpanan tidak tersedia: abaikan */ }
}
```

**2) `src/db/validate.ts`** ✅ — tambahkan sebelum `parseBackup`, ganti `ParsedBackup` dan baris `return` di `parseBackup`:

```ts
/** Preferensi localStorage yang ikut cadangan. API key Gemini sengaja TIDAK ikut. */
export const PREF_KEYS = ['pacelab_shoes', 'pacelab.planMode', 'pacelab.mafAdj', 'pacelab.k5'] as const;
const MAX_PREF_LEN = 200_000;

export function normalizePrefs(raw: unknown): Record<string, string> | null {
  if (!isObj(raw)) return null;
  const out: Record<string, string> = {};
  for (const k of PREF_KEYS) {
    const v = raw[k];
    if (typeof v === 'string' && v.length <= MAX_PREF_LEN) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface ParsedBackup {
  workouts: Workout[];
  profile: UserProfile | null;
  skipped: number;
  schedule: ScheduleState | null;
  prefs: Record<string, string> | null;
}

// di akhir parseBackup:
return {
  workouts, profile: normalizeProfile(rawProfile), skipped,
  schedule: normalizeScheduleState(data.schedule), prefs: normalizePrefs(data.prefs),
};
```

**3) `src/db/database.ts`** 🔎 — ganti `exportBackup`, `importBackup`, `clearAll` dan impor di bagian atas:

```ts
import { parseBackup, PREF_KEYS } from './validate';
import { ALL_LOCAL_KEYS } from './localKeys';
import { loadScheduleState, saveScheduleState } from '../plans/scheduleStore.ts';

function readPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PREF_KEYS) {
    try { const v = localStorage.getItem(k); if (v != null) out[k] = v; } catch { /* abaikan */ }
  }
  return out;
}

export async function exportBackup(): Promise<string> {
  const [workouts, profiles] = await Promise.all([db.workouts.toArray(), db.userProfile.toArray()]);
  return JSON.stringify({
    app: 'pacelab', version: 3, exportedAt: Date.now(),
    workouts, userProfile: profiles, schedule: loadScheduleState(), prefs: readPrefs(),
  }, null, 2);
}

export async function importBackup(json: string): Promise<{
  workouts: number; skipped: number; profile: boolean; schedule: boolean; prefs: boolean;
}> {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('Berkas bukan JSON yang valid.'); }
  const { workouts, profile, skipped, schedule, prefs } = parseBackup(data);
  await db.transaction('rw', db.workouts, db.userProfile, async () => {
    await db.workouts.clear();
    if (workouts.length) await db.workouts.bulkAdd(workouts);
    if (profile) await db.userProfile.put(profile);
  });
  if (schedule) saveScheduleState(schedule);
  if (prefs) {
    for (const [k, v] of Object.entries(prefs)) {
      try { localStorage.setItem(k, v); } catch { /* abaikan */ }
    }
  }
  return { workouts: workouts.length, skipped, profile: profile !== null, schedule: schedule !== null, prefs: prefs !== null };
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', db.workouts, db.userProfile, async () => {
    await db.workouts.clear();
    await db.userProfile.clear();
  });
  for (const k of ALL_LOCAL_KEYS) {
    try { localStorage.removeItem(k); } catch { /* abaikan */ }
  }
}
```

Cadangan lama (versi 1 dan 2) tetap bisa diimpor: `prefs` bernilai `null`.

**Tes baru** (`src/db/validate.test.ts`) ✅:

```ts
test('parseBackup membaca prefs (sepatu, mode, k5) dan membuang kunci asing seperti API key', () => {
  const r = parseBackup({
    app: 'pacelab', workouts: [],
    prefs: { pacelab_shoes: '[]', 'pacelab.k5': '00:25:00', pacelab_gemini_api_key: 'RAHASIA', x: 1 },
  });
  assert.deepEqual(r.prefs, { pacelab_shoes: '[]', 'pacelab.k5': '00:25:00' });
  assert.equal(parseBackup({ app: 'pacelab', workouts: [] }).prefs, null);
});

test('PREF_KEYS sinkron dengan konstanta kunci penyimpanan', async () => {
  const { PREF_KEYS } = await import('./validate.ts');
  const { SHOES_KEY } = await import('../plans/shoeStore.ts');
  const { PLAN_MODE_KEY, MAF_ADJ_KEY } = await import('../plans/scheduleStore.ts');
  const { K5_KEY } = await import('../plans/k5Store.ts');
  assert.deepEqual([...PREF_KEYS].sort(), [SHOES_KEY, PLAN_MODE_KEY, MAF_ADJ_KEY, K5_KEY].sort());
});
```

---

## BUG-06 — Pace lap ikut waktu berhenti ✅ (GPX) / 🔎 (FIT)

**Berkas:** `src/parsers/gpxParser.ts`, `src/parsers/fitParser.ts`.

**Bukti (GPX sintetis, 5:00/km, berhenti 120 dtk di km ke-1):** pace lap = `[420, 300]` padahal seharusnya `[300, 300]`. Durasi total sudah memakai waktu bergerak, tetapi pace lap memakai waktu jam dinding. Akibatnya `cardiacDrift`, pacing paruh pertama/kedua, dan grafik pace salah setiap kali ada lampu merah atau auto-pause.

```diff
// gpxParser.ts
   let lapStart = pts[0].t;
+  let lapMoving = 0;
...
     if (isMoving) {
       moving += dt;
+      lapMoving += dt;
...
       laps.push({
         km: laps.length + 1,
-        paceSec: ((b.t - lapStart) / 1000) * (1000 / lapDist),
+        paceSec: (lapMoving > 0 ? lapMoving : (b.t - lapStart) / 1000) * (1000 / lapDist),
...
       lapStart = b.t;
+      lapMoving = 0;
```

FIT — ganti blok "Split per km" dengan versi yang mengabaikan jeda (🔎: lulus tes yang ada; belum diuji dengan berkas Garmin/Coros asli):

```ts
const laps: LapSplit[] = [];
let lapD0 = 0, lapT0 = tsList[0], hrSum = 0, hrN = 0;
let prevTs: number | undefined, prevD: number | undefined, lapPaused = 0;
for (const r of records) {
  if (r.ts === undefined || r.dist === undefined) continue;
  const d = r.dist / 100;
  if (prevTs !== undefined && prevD !== undefined) {
    const dt = r.ts - prevTs;
    // Jeda/auto-pause: waktu berjalan tetapi jarak nyaris tidak bertambah. Jangan ikut pace lap.
    if (dt > 10 && (d - prevD) / dt < 0.5) lapPaused += dt;
  }
  prevTs = r.ts; prevD = d;
  if (r.hr !== undefined) { hrSum += r.hr; hrN++; }
  if (d - lapD0 >= 1000 && lapT0 !== undefined) {
    laps.push({
      km: laps.length + 1,
      paceSec: ((r.ts - lapT0 - lapPaused) * 1000) / (d - lapD0),
      avgHr: hrN ? Math.round(hrSum / hrN) : null,
    });
    lapD0 = d; lapT0 = r.ts; hrSum = 0; hrN = 0; lapPaused = 0;
  }
}
```

**Tes baru** (`src/parsers/gpxParser.test.ts`, berkas ini memakai `it`):

```ts
it('pace lap memakai waktu bergerak: berhenti 120 dtk tidak menggelembungkan lap', () => {
  const pts: GpxPoint[] = [];
  let t = Date.UTC(2026, 10, 1);
  let lat = -6.2;
  const push = () => pts.push({ lat, lon: 106.8, ele: 10, t, hr: 150, cad: 85 });
  push();
  for (let s = 0; s < 900; s++) {
    if (s === 150) for (let k = 0; k < 120; k++) { t += 1000; push(); } // berhenti
    lat += 1000 / 300 / 111_320; t += 1000; push();
  }
  const r = analyzeGpxPoints(pts);
  for (const l of r.laps) assert.ok(Math.abs(l.paceSec - 300) < 3, `pace lap ${l.paceSec}`);
});
```

---

## BUG-07 — Cadence selalu dikali 2 ✅

Cadence per kaki (Garmin, ±80–95) memang perlu ×2. Tetapi perangkat/aplikasi yang sudah mengekspor spm (±170) menjadi ±340, dan deteksi lari/jalan (`b.cad * 2 >= 145`) ikut salah.

```ts
// gpxParser.ts — di atas const R
/** Cadence per kaki (≈ 60–100) dikali 2; nilai ≥ 120 dianggap sudah spm. */
export const toSpm = (raw: number): number => (raw >= 120 ? raw : raw * 2);

// isRun
const isRun = speed >= 1.8 || (b.cad != null && toSpm(b.cad) >= 145);

// return analyzeGpxPoints
avgCadence: cadN ? Math.round(toSpm(cadSum / cadN)) : null,
```

```ts
// fitParser.ts
avgCadence: cadPerFoot != null ? Math.round(cadPerFoot >= 120 ? cadPerFoot : cadPerFoot * 2) : null,
```

**Tes baru** (`gpxParser.test.ts`):

```ts
it('cadence yang sudah spm (≥ 120) tidak dikali 2 lagi', () => {
  const pts: GpxPoint[] = Array.from({ length: 400 }, (_, i) => ({
    lat: -6.2 + (i * 3.3) / 111_320, lon: 106.8, ele: 10, t: Date.UTC(2026, 10, 1) + i * 1000, hr: 150, cad: 172,
  }));
  assert.equal(analyzeGpxPoints(pts).avgCadence, 172);
});
```

---

## BUG-08 — Layar "Memuat data latihan…" macet bila IndexedDB gagal 🔎

**Berkas:** `src/App.tsx`. `reload()` tidak punya `try/catch`; mode privat Firefox, kuota penuh, atau database korup membuat `profile` tetap `undefined` selamanya.

```tsx
const [loadError, setLoadError] = useState<string | null>(null);

const reload = async () => {
  try {
    const [p, w] = await Promise.all([db.userProfile.get('default'), db.workouts.toArray()]);
    setProfile(p ?? null);
    setWorkouts(w);
    setLoadError(null);
  } catch (err) {
    setLoadError(err instanceof Error ? err.message : 'Penyimpanan lokal tidak dapat dibuka.');
  }
};

// sebelum `if (profile === undefined)`
if (loadError) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#09090B] px-6 text-center text-zinc-300">
      <p className="text-sm font-semibold text-rose-400">Gagal membuka penyimpanan lokal.</p>
      <p className="max-w-sm text-xs text-zinc-400">
        {loadError} Jika memakai mode privat, buka PACELAB di jendela biasa. Data tidak dihapus.
      </p>
      <button
        type="button"
        onClick={() => void reload()}
        className="min-h-[44px] rounded-2xl bg-[#BEF264] px-5 font-display text-sm font-extrabold text-[#09090B]"
      >
        Coba lagi
      </button>
    </div>
  );
}
```

---

## BUG-09 — `npm start` menjalankan dev server Vite 🔎

**Berkas:** `package.json`, `server.ts`. Cabang produksi aktif hanya jika `NODE_ENV === 'production'`, tetapi `"start": "node server.ts"` tidak menyetelnya. Hasilnya `vite` (devDependency) dimuat di produksi. Selain itu `node server.ts` butuh Node ≥ 22.6 dengan flag (default baru sejak 23.6).

```json
"scripts": {
  "dev": "tsx server.ts --dev",
  "start": "tsx server.ts",
```

```ts
// server.ts
import fs from 'node:fs';

const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

// ... ganti `if (process.env.NODE_ENV !== 'production') {`
if (isDev) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error('Folder dist/ belum ada. Jalankan "npm run build" sebelum "npm start".');
    process.exit(1);
  }
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}
```

---

## BUG-10 — Cache AI Coach basi 🔎

**Berkas:** `src/analytics/aiCoach.ts`. Hash cache hanya `jumlah sesi | tanggal terbaru | ACWR`. Mengubah jenis sesi, RPE, target lomba, kurikulum, atau usia tidak membatalkan cache, sehingga saran AI lama tetap tampil.

```ts
type CacheCtx = Pick<AiCoachContext, 'workouts' | 'acwr' | 'now'> &
  Partial<Pick<AiCoachContext, 'profile' | 'curriculum' | 'programTitle'>>;

export function buildAiCoachCacheHash(ctx: CacheCtx): string {
  const cutoff = ctx.now;
  const relevant = cutoff == null ? ctx.workouts : ctx.workouts.filter((w) => w.date <= cutoff);
  const latestDate = relevant.reduce((max, w) => (w.date > max ? w.date : max), 0);
  const acwrVal =
    ctx.acwr.ratio != null && Number.isFinite(ctx.acwr.ratio) ? ctx.acwr.ratio.toFixed(2) : ctx.acwr.status;
  const sig = relevant
    .map((w) => `${w.date}:${w.workoutType}:${w.rpe ?? ''}:${w.avgHr ?? ''}:${w.distanceKm.toFixed(2)}:${Math.round(w.durationSec)}`)
    .join(',');
  const p = ctx.profile;
  return fnv1aHash(
    [relevant.length, latestDate, acwrVal, p?.age, p?.targetDistance, p?.targetRaceDate, ctx.curriculum, ctx.programTitle, sig].join('|'),
  );
}
```

Ganti tipe parameter `loadCachedAiCoachAnalysis` dan `saveCachedAiCoachAnalysis` menjadi `CacheCtx`. Pemanggil yang sudah mengirim `AiCoachContext` utuh otomatis ikut memakai profil dan kurikulum.

---

## BUG-11 — Timeout 10 detik per model 🔎

**Berkas:** `src/analytics/aiCoach.ts`. `REQUEST_TIMEOUT_MS = 10_000` berlaku **per model**, dengan 4 model + daftar model sebagai cadangan. Respons terstruktur Gemini sering lebih dari 10 detik, jadi pengguna melihat "timeout" berulang. Pesan "10 detik" juga ditulis manual di dua tempat. Respons non-OK dari model yang dilewati tidak pernah dibaca/ditutup.

```ts
export const REQUEST_TIMEOUT_MS = 30_000;
const TOTAL_BUDGET_MS = 75_000;
const secText = (ms: number) => `${Math.round(ms / 1000)} detik`;

// callGenerateContent, di catch:
throw new AiCoachError('timeout', `Permintaan ke Gemini melewati batas waktu ${secText(timeoutMs)}. Silakan coba lagi.`);

// callGeminiText, sebelum tryCandidates:
const deadline = Date.now() + TOTAL_BUDGET_MS;

// di dalam loop tryCandidates, awal iterasi:
if (Date.now() > deadline) return;

// sebelum `res = attempt;` — tutup body respons yang akan digantikan:
(res as Response | null)?.body?.cancel().catch(() => undefined);

// pesan timeout akhir:
new AiCoachError('timeout', `Permintaan ke Gemini melewati batas waktu ${secText(timeoutMs)}. Silakan coba lagi.`)
```

---

## BUG-12 — `server.ts`: model hard-coded, error rapuh, tanpa rate limit/sanitasi 🔎

Masalah di `/api/race-day-analyze`:

1. `MODEL = 'gemini-4-hydrogen'` ditulis mati, berbeda dari rantai model di `aiCoach.ts` (`gemini-3.8-flash-lite`, `gemini-2.5-…`). Saya tidak bisa memverifikasi ketersediaan model mana pun di akun Anda — jadikan konfigurasi dan beri cadangan.
2. Status error dideteksi dengan `msg.includes('429')` — rapuh.
3. Endpoint publik memakai kunci server tanpa pembatasan → siapa pun bisa menghabiskan kuota.
4. Teks dari klien (`primaryShoeSummary`, `acwrStatus`, dll.) langsung masuk ke prompt (prompt injection).
5. `JSON.parse` yang gagal dilaporkan sebagai error API biasa, dan pesan error mentah dikirim ke klien.

```ts
import type { NextFunction, Request, Response } from 'express';
import { GoogleGenAI, Type, type GenerateContentConfig } from '@google/genai';

// Contoh .env: GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite  (urut prioritas)
const MODELS = (process.env.GEMINI_MODELS ?? process.env.GEMINI_MODEL ?? 'gemini-4-hydrogen')
  .split(',').map((m) => m.trim()).filter(Boolean);

const ALLOWED_DISTANCES = new Set(['5K', '10K', '21.1K', '42.2K']);
const clean = (v: unknown, max = 80): string | null =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) || null : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sanitizeSnapshot(raw: RaceDayRequestBody['snapshot']) {
  if (!raw || !ALLOWED_DISTANCES.has(String(raw.targetDistance)) || num(raw.estimatedFinishSec) == null) return null;
  return {
    targetDistance: String(raw.targetDistance),
    raceDateIso: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.raceDateIso)) ? String(raw.raceDateIso) : null,
    daysToRace: num(raw.daysToRace),
    estimatedFinishTime: clean(raw.estimatedFinishTime, 12),
    estimatedFinishSec: num(raw.estimatedFinishSec) as number,
    targetPacePerKm: clean(raw.targetPacePerKm, 12),
    acwrRatio: num(raw.acwrRatio),
    acwrStatus: clean(raw.acwrStatus, 20),
    avgDriftPct: num(raw.avgDriftPct),
    efRecent: num(raw.efRecent),
    efChangePct: num(raw.efChangePct),
    mafHr: num(raw.mafHr),
    mafPacePerKm: clean(raw.mafPacePerKm, 12),
    raceHrRange: clean(raw.raceHrRange, 20),
    weeklyKm28: num(raw.weeklyKm28) ?? 0,
    longestRunKm28: num(raw.longestRunKm28) ?? 0,
    primaryShoeSummary: clean(raw.primaryShoeSummary, 80),
    sessionsCount: num(raw.sessionsCount) ?? 0,
  };
}

// Pembatas laju sederhana (10 permintaan/menit/IP). Untuk multi-instance, pakai penyimpanan bersama.
const hits = new Map<string, { n: number; reset: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const key = req.ip ?? 'anon';
  const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + 60_000 }); return next(); }
  if (++h.n > 10) {
    res.status(429).json({ code: 'rate_limited', error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
    return;
  }
  next();
}

function httpStatusOf(err: unknown): number {
  const direct = (err as { status?: unknown } | null)?.status;
  if (typeof direct === 'number') return direct;
  const m = err instanceof Error ? /\b([45]\d{2})\b/.exec(err.message) : null;
  return m ? Number(m[1]) : 502;
}

async function generateWithFallback(ai: GoogleGenAI, contents: string, config: GenerateContentConfig) {
  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      return { response: await ai.models.generateContent({ model, contents, config }), model };
    } catch (err) {
      lastErr = err;
      if (![400, 404, 429, 503].includes(httpStatusOf(err))) throw err;
    }
  }
  throw lastErr;
}
```

Pemakaian di handler:

```ts
app.set('trust proxy', 1); // di belakang proxy (AI Studio/Cloud Run) agar req.ip benar
app.post('/api/race-day-analyze', rateLimit, async (req, res) => {
  const ai = createGeminiClient();
  if (!ai) { /* tetap seperti semula (503 missing_key) */ return; }

  const s = sanitizeSnapshot((req.body as RaceDayRequestBody | undefined)?.snapshot);
  if (!s) {
    res.status(400).json({ code: 'bad_request', error: 'Payload snapshot lomba tidak lengkap atau tidak valid.' });
    return;
  }
  // ... bangun `prompt` seperti semula (nama field `s.*` sama), lalu:

  try {
    const { response, model } = await generateWithFallback(ai, prompt, config /* objek config yang sama */);
    const raw = (response.text ?? '').trim();
    if (!raw) { res.status(502).json({ code: 'empty_response', error: 'Gemini mengembalikan respons kosong.' }); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { res.status(502).json({ code: 'invalid_json', error: 'Respons AI bukan JSON valid.' }); return; }
    res.json({ analysis: parsed, model });
  } catch (err) {
    console.error('[race-day-analyze]', err); // detail hanya di log server
    const status = httpStatusOf(err);
    if (status === 429) { res.status(429).json({ code: 'quota_exceeded', error: 'Kuota AI habis. Coba lagi nanti.' }); return; }
    if (status === 401 || status === 403) { res.status(403).json({ code: 'invalid_key', error: 'API key server ditolak.' }); return; }
    res.status(502).json({ code: 'api_error', error: 'Layanan AI sedang bermasalah.' });
  }
});
```

Pindahkan objek `config` (systemInstruction, responseMimeType, responseSchema) ke `const config: GenerateContentConfig = {...}` di atas `try`.

---

# B. PENINGKATAN

## IMP-01 — Endpoint relatif 🔎

`src/analytics/raceDayAnalyzer.ts`: `fetchFn('/api/race-day-analyze', …)` menunjuk ke akar domain, bukan subpath `https://user.github.io/repo/`. Di GitHub Pages memang tidak ada server (sudah jatuh ke analisis lokal dengan baik), tetapi untuk server Express di subpath gunakan path relatif. Tidak ada tes yang mengunci URL ini.

```ts
const res = await fetchFn('api/race-day-analyze', {
```

## IMP-02 — Font offline 🔎

`index.html` memuat DM Sans, JetBrains Mono, dan Space Grotesk dari Google CDN, sementara hanya Plus Jakarta Sans yang dibundel. Saat offline (klaim "offline-first") tipografi berubah ke font sistem.

```bash
npm i @fontsource/dm-sans @fontsource/jetbrains-mono
```

```ts
// src/main.tsx — tambahkan di samping impor Plus Jakarta Sans
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/800.css';
```

Hapus tiga tag `<link>` ke `fonts.googleapis.com` / `fonts.gstatic.com` di `index.html`, dan ganti `font-family:'Space Grotesk',sans-serif` pada teks splash menjadi `'Plus Jakarta Sans',system-ui,sans-serif`. `vite-plugin-pwa` sudah menyertakan `woff2` di `globPatterns`, jadi font ikut di-precache.

## IMP-03 — Tolak aktivitas non-lari 🔎

FIT dan GPX sepeda/renang saat ini diimpor sebagai lari, mencemari TRIMP, EF, dan prediksi. Belum diuji dengan berkas asli.

```ts
// fitParser.ts
const F_SESSION_SPORT = 5;
// FIT sport: 0 generic, 1 running, 11 walking, 17 hiking. Sepeda (2), renang (5), dll. ditolak.
const ALLOWED_SPORTS = new Set([0, 1, 11, 17]);

// setelah `const sess: Vals = sessions[0] ?? {};`
const sport = sess[F_SESSION_SPORT];
if (sport !== undefined && !ALLOWED_SPORTS.has(sport)) {
  throw new Error('Berkas FIT ini bukan aktivitas lari/jalan (mis. sepeda atau renang).');
}
```

```ts
// gpxParser.ts — di parseGpx, setelah pengecekan parsererror
const trk = doc.getElementsByTagName('trk')[0];
const trkType = trk ? (child(trk, 'type') ?? '').toLowerCase() : '';
if (/cycl|bik|ride|swim|row|ski/.test(trkType)) {
  throw new Error(`Berkas GPX ini tampaknya bukan lari (jenis: ${trkType}).`);
}
```

## IMP-04 — TRIMP untuk wanita ✅

`banisterTrimp` memakai koefisien pria (0,64 dan 1,92) untuk semua orang. Koefisien wanita: 0,86 dan 1,67. Data lama tetap sama karena default `'male'`.

```ts
// src/analytics/types.ts
export type Sex = 'male' | 'female';
// di UserProfile:
/** Memilih koefisien Banister TRIMP. Kosong = 'male' (perilaku lama). */
sex?: Sex;
```

```ts
// src/analytics/workload.ts
import type { Workout, UserProfile, WorkoutDraft, LapSplit, Sex } from './types';

type HrProfile = Pick<UserProfile, 'restingHr' | 'maxHr'> & { sex?: Sex };
const TRIMP_COEF = { male: { a: 0.64, b: 1.92 }, female: { a: 0.86, b: 1.67 } } as const;

export function banisterTrimp(durationMin: number, avgHr: number, restingHr: number, maxHr: number, sex: Sex = 'male'): number {
  const { a, b } = TRIMP_COEF[sex];
  const dhr = Math.min(1, Math.max(0, (avgHr - restingHr) / (maxHr - restingHr)));
  return durationMin * dhr * a * Math.exp(b * dhr);
}

// di sessionTrimp:
if (w.avgHr != null && p.maxHr > p.restingHr) return banisterTrimp(min, w.avgHr, p.restingHr, p.maxHr, p.sex);
```

```ts
// src/db/validate.ts — di normalizeProfile, setelah weeklyTargetKm
...(raw.sex === 'male' || raw.sex === 'female' ? { sex: raw.sex } : {}),
```

```tsx
// Profil.tsx — field baru di form (dan simpan: sex: (f.get('sex') as Sex) || 'male')
<SelectField label="Jenis kelamin" hint="Dipakai untuk rumus beban latihan (TRIMP)." name="sex" defaultValue={profile?.sex ?? 'male'}>
  <option value="male">Pria</option>
  <option value="female">Wanita</option>
</SelectField>
```

**Tes baru** (`analytics.test.ts`):

```ts
test('Banister TRIMP wanita memakai koefisien 0,86 / 1,67 dan default tetap pria', () => {
  const pria = banisterTrimp(60, 150, 55, 185);
  const wanita = banisterTrimp(60, 150, 55, 185, 'female');
  assert.equal(pria, banisterTrimp(60, 150, 55, 185, 'male'));
  assert.notEqual(pria, wanita);
  const dhr = (150 - 55) / (185 - 55);
  assert.ok(Math.abs(wanita - 60 * dhr * 0.86 * Math.exp(1.67 * dhr)) < 1e-9);
});
```

## IMP-05 — Rentang profil 🔎

```ts
// Profil.tsx — save()
if (!(age >= 10 && age <= 100)) next.age = 'Usia harus 10–100 tahun.';
if (!(restingHr >= 30 && restingHr <= 120)) next.restingHr = 'Resting HR harus 30–120 bpm.';
if (!(maxHr > restingHr && maxHr <= 230)) next.maxHr = 'Max HR harus lebih tinggi dari Resting HR dan paling tinggi 230 bpm.';
```

## IMP-06 — Satu konstanta untuk input 5K ✅

`'pacelab.k5'` ditulis manual di `TrainingPlan.tsx` (`STORE_KEY`), `Riwayat.tsx`, dan `nextSession.ts`. Pakai `src/plans/k5Store.ts` dari BUG-05.

```ts
// Riwayat.tsx dan nextSession.ts
import { loadK5 } from '../plans/k5Store';        // nextSession.ts: '../plans/k5Store.ts'
const saved = loadK5();                            // ganti blok try/localStorage.getItem('pacelab.k5')

// TrainingPlan.tsx
import { K5_KEY, loadK5, saveK5 } from '../plans/k5Store';
// hapus `const STORE_KEY = 'pacelab.k5'`; baca dengan loadK5(), tulis dengan saveK5(v)
```

## IMP-07 — CI deterministik 🔎

Repo memiliki `bun.lock` tetapi workflow memakai `npm install` (tanpa `package-lock.json`) dan membangun dengan Node 20 sementara tes memakai Node 22.

```bash
npm install --package-lock-only   # buat package-lock.json, lalu commit
```

```yaml
# .github/workflows/deploy.yml — job build
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
- run: npm ci
- run: npm run build
```

Pilih satu pengelola paket (hapus `bun.lock` bila memakai npm) agar lockfile tidak bercabang.

## IMP-08 — Cardiac drift hanya untuk sesi stabil 🔎 (saran)

`cardiacDrift` dipakai pada sesi apa pun: `adaptiveEngine.gatherAdaptiveInput` (sesi terakhir, apa pun jenisnya), `raceDayAnalyzer`, `sessionAnalysis`. Uji saya dengan pola interval bolak-balik justru menghasilkan drift kecil (1,2 %) karena saling meniadakan, jadi ini **bukan bug terbukti**. Namun fartlek atau interval progresif tetap bisa menghasilkan angka yang tidak bermakna dan memicu aturan "Easy +12 dtk/km". Saran:

```ts
// workload.ts
const STEADY: readonly string[] = ['easy', 'long_run'];
export function steadyDrift(w: Pick<Workout, 'workoutType' | 'laps'>): number | null {
  return STEADY.includes(w.workoutType) ? cardiacDrift(w.laps) : null;
}
// adaptiveEngine.ts: lastDriftPct: steadyDrift(last)
// raceDayAnalyzer.ts: .map((w) => steadyDrift(w))
```

Terapkan hanya jika sesuai maksud produk; tes adaptif yang memakai sesi non-easy sebagai "sesi terakhir" perlu disesuaikan.

---

# C. UPDATE FITUR

## FEAT-01 — Restore mode "Gabung" + salinan pengaman 🔎

Saat ini restore **mengganti** seluruh sesi tanpa jalan kembali. Tambahkan mode gabung (melewati duplikat memakai `isDuplicate` yang sudah ada) dan unduh otomatis cadangan saat ini sebelum mengganti.

```ts
// database.ts
import { isDuplicate, parseBackup, PREF_KEYS } from './validate';
export type ImportMode = 'replace' | 'merge';

export async function importBackup(json: string, mode: ImportMode = 'replace') {
  // ... parse seperti BUG-05
  let added = workouts.length;
  await db.transaction('rw', db.workouts, db.userProfile, async () => {
    if (mode === 'replace') {
      await db.workouts.clear();
      if (workouts.length) await db.workouts.bulkAdd(workouts);
      if (profile) await db.userProfile.put(profile);
    } else {
      const all = await db.workouts.toArray();
      const fresh: Workout[] = [];
      for (const w of workouts) {
        if (!isDuplicate(all, w)) { all.push(w); fresh.push(w); }
      }
      if (fresh.length) await db.workouts.bulkAdd(fresh);
      added = fresh.length;
      if (profile && !(await db.userProfile.get('default'))) await db.userProfile.put(profile);
    }
  });
  // ... jadwal & prefs hanya diterapkan pada mode 'replace'
  return { workouts: added, skipped, profile: profile !== null, schedule: schedule !== null, prefs: prefs !== null };
}
```

```tsx
// Profil.tsx — state + dialog
const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');

<ConfirmDialog id="impor" title="Pulihkan dari cadangan?" confirmLabel="Ya, pulihkan" onConfirm={doImport} onCancel={() => setPendingImport(null)}>
  <p>Berkas: <strong>{pendingImport.name}</strong></p>
  <div role="radiogroup" aria-label="Mode pemulihan" className="mt-2 space-y-2 text-sm">
    <label className="flex items-start gap-2">
      <input type="radio" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} />
      <span><strong>Gabung</strong> — tambahkan sesi baru, lewati duplikat.</span>
    </label>
    <label className="flex items-start gap-2">
      <input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
      <span><strong>Ganti semua</strong> — hapus sesi saat ini (salinan pengaman diunduh otomatis).</span>
    </label>
  </div>
</ConfirmDialog>

// doImport: if (importMode === 'replace') await exportJson();  // salinan pengaman, lalu importBackup(text, importMode)
```

## FEAT-02 — Edit sesi lengkap 🔎

`Riwayat.tsx` hanya bisa mengubah catatan, jenis, dan sepatu. Salah ketik RPE, jarak, durasi, atau tanggal berarti harus menghapus dan mencatat ulang. Untuk sesi impor (FIT/GPX), jarak dan durasi dikunci karena `laps` bergantung padanya.

```ts
// src/db/workoutEdit.ts (BARU)
import { db } from './database';
import { finalizeWorkout } from '../analytics/workload';
import type { UserProfile, Workout, WorkoutType } from '../analytics/types';

export interface WorkoutEdit {
  date: number; distanceKm: number; durationSec: number;
  rpe: number | null; workoutType: WorkoutType; note: string; shoeId?: string;
}

export async function editWorkout(w: Workout, e: WorkoutEdit, profile: UserProfile): Promise<void> {
  if (w.id == null) throw new Error('Sesi tidak punya id.');
  if (!(e.distanceKm > 0) || !(e.durationSec > 0)) throw new Error('Jarak dan durasi harus lebih dari 0.');
  const pace = e.durationSec / e.distanceKm;
  if (pace < 120 || pace > 1200) throw new Error('Pace tidak masuk akal (2:00–20:00 /km).');
  if (w.source !== 'manual' && (e.distanceKm !== w.distanceKm || e.durationSec !== w.durationSec)) {
    throw new Error('Jarak dan durasi sesi impor tidak dapat diubah.');
  }
  const { id: _id, trimp: _t, efficiencyFactor: _ef, ...draft } = w;
  const next = finalizeWorkout(
    { ...draft, ...e, note: e.note.trim() || undefined, avgPaceSecPerKm: pace },
    profile,
  );
  await db.workouts.put({ ...next, id: w.id });
}
```

TRIMP dan EF dihitung ulang lewat `finalizeWorkout`, sehingga ACWR dan tren ikut benar.

## FEAT-03 — Penyimpanan persisten + pengingat backup 🔎

Seluruh data ada di IndexedDB. Browser (terutama iOS Safari dan perangkat dengan ruang sempit) dapat membersihkannya.

```ts
// src/main.tsx
void navigator.storage?.persist?.().catch(() => undefined);
```

```ts
// src/db/backupReminder.ts (BARU)
export const BACKUP_KEY = 'pacelab.lastBackup'; // tambahkan ke ALL_LOCAL_KEYS di localKeys.ts

export function markBackupDone(): void {
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* abaikan */ }
}

export function backupOverdue(workoutCount: number, now = Date.now(), days = 14): boolean {
  if (workoutCount === 0) return false;
  try {
    const t = Number(localStorage.getItem(BACKUP_KEY));
    return !t || now - t > days * 86_400_000;
  } catch { return false; }
}
```

Panggil `markBackupDone()` di akhir `exportJson` (Profil.tsx), dan di `Beranda.tsx` tampilkan banner bila `backupOverdue(workouts.length)`: "Terakhir mencadangkan > 14 hari lalu. Buka Profil → Cadangan."

## FEAT-04 — Notifikasi versi baru PWA 🔎

`registerType: 'autoUpdate'` memuat ulang diam-diam; pengguna bisa kehilangan isian form yang belum disimpan.

```ts
// vite.config.ts
VitePWA({ registerType: 'prompt', manifest: false, workbox: { globPatterns: ['**/*.{js,css,html,png,svg,json,woff2}'] } })
```

```ts
// src/main.tsx
const updateSW = registerSW({
  onNeedRefresh() {
    if (window.confirm('Versi baru PACELAB tersedia. Muat ulang sekarang?')) void updateSW(true);
  },
});
```

Ganti `window.confirm` dengan toast bila ada komponen toast.

## FEAT-05 — Indikator "mengumpulkan data" untuk ACWR 🔎

Akibat BUG-01, pengguna baru kini melihat status `unknown`. Beri tahu alasannya.

```ts
// workload.ts
export function acwrHistoryDays(workouts: Workout[], now: number): number {
  const first = workouts.filter((w) => w.date <= now).reduce((m, w) => Math.min(m, w.date), Infinity);
  return Number.isFinite(first) ? Math.floor((now - first) / DAY_MS) + 1 : 0;
}
```

```tsx
// AcwrGauge / CoachCard: bila status === 'unknown'
<p className="text-xs text-zinc-400">
  Mengumpulkan data beban latihan ({Math.min(acwrHistoryDays(workouts, Date.now()), ACWR_MIN_HISTORY_DAYS)}/{ACWR_MIN_HISTORY_DAYS} hari).
  ACWR muncul setelah {ACWR_MIN_HISTORY_DAYS} hari riwayat.
</p>
```

---

# D. Catatan lain (tanpa kode)

- **TRIMP bercampur skala:** sesi ber-HR memakai Banister, sesi tanpa HR memakai Session-RPE (menit × RPE). Keduanya dijumlahkan dalam satu ACWR padahal skalanya berbeda. Putuskan: normalisasi RPE ke skala Banister, atau tampilkan keterangan di kartu ACWR.
- **Konteks program dihitung di 4 tempat** (`nextSession`, `CoachCard`, `Analitik`, `TrainingPlan`) — README sendiri mengakuinya. Pindahkan ke satu helper `buildProgramContext` sebelum menambah fitur program lagi.
- **Dexie baru `version(1)`.** Saat nanti menambah indeks/tabel, tulis `this.version(2).stores({...}).upgrade(...)`; jangan mengubah `version(1)`.
- **README** berjudul "v1.4.0-offline" padahal `package.json` 2.3.0 dan README mencatat sampai v2.3.0. Rapikan judul dan tambahkan catatan v2.3.1.
- **`manifest.json`** memakai `"purpose": "any maskable"` pada satu ikon SVG. Pisahkan menjadi entri `any` dan `maskable` agar tidak memicu peringatan Lighthouse.
- **Satu lapisan AI:** ada dua jalur — BYO-key di browser (`aiCoach.ts`) dan proxy server (`/api/race-day-analyze`) dengan model berbeda. Pertimbangkan satu modul klien yang memilih proxy bila tersedia, lalu BYO-key.

---

# E. Urutan pengerjaan

1. **Tahap 1 (data & kebenaran hasil):** BUG-01, 02, 03, 04, 05 → `npm test`.
2. **Tahap 2 (parser, ketahanan, deploy):** BUG-06, 07, 08, 09, 10, 11, 12.
3. **Tahap 3 (peningkatan):** IMP-01 … IMP-08.
4. **Tahap 4 (fitur):** FEAT-01 … FEAT-05.

Setelah tiap tahap: `npm run lint` dan `npm test` (Node ≥ 22.6).

---

# F. Prompt untuk Google AI Studio

Cara pakai: tempel **seluruh isi dokumen ini** ke AI Studio sebagai konteks (atau, jika AI Studio Anda mendukung menambah berkas ke proyek, simpan sebagai `PERBAIKAN.md` di akar proyek), lalu kirim **Prompt Tahap 1**. Setelah selesai dan diperiksa, kirim prompt tahap berikutnya satu per satu.

## Prompt Tahap 1

```text
Kamu adalah engineer senior TypeScript/React. Proyek ini adalah PACELAB v2.3.0 (React 18 + Vite + TypeScript strict + Dexie/IndexedDB + Tailwind + Express server.ts dengan Gemini server-side). Dokumen "PACELAB v2.3.0 — Daftar Bug, Perbaikan & Update Fitur" di atas adalah hasil audit kode yang sudah memuat kode acuan.

TUGAS TAHAP 1: terapkan BUG-01, BUG-02, BUG-03, BUG-04, dan BUG-05 persis sesuai bagian A dokumen.

ATURAN WAJIB
1. Gunakan kode di dokumen sebagai acuan. Jika ada ketidakcocokan tipe atau nama dengan kode sebenarnya, sesuaikan seminimal mungkin TANPA mengubah perilaku yang dimaksud. Jangan menambah fitur di luar tahap ini.
2. Seluruh teks UI tetap Bahasa Indonesia. Pertahankan gaya Tailwind yang ada (warna #BEF264, #09090B, komponen di src/components/ui.tsx).
3. Modul yang diuji lewat "node --experimental-strip-types" (src/analytics, src/parsers, src/plans, src/db/validate.ts, src/components/*.ts non-tsx) harus tetap bisa diimpor oleh Node: gunakan impor berekstensi ".ts" antar-modul di folder tersebut dan jangan mengimpor modul React/DOM/Dexie dari dalamnya.
4. Jangan mengubah "Keputusan desain MAF (terkunci)" di README.
5. Cadangan JSON versi 1 dan 2 harus tetap bisa diimpor. API key Gemini TIDAK BOLEH masuk ke cadangan.
6. Jangan menghapus atau melemahkan tes yang ada. Tambahkan tes baru yang disebut di dokumen (ACWR pengguna baru; parseBackup prefs; sinkronisasi PREF_KEYS dengan konstanta kunci).
7. Jangan menambah dependency baru pada tahap ini.
8. Buat berkas baru: src/plans/k5Store.ts dan src/db/localKeys.ts. Ganti ketiga pemakaian string 'pacelab.k5' (TrainingPlan.tsx, Riwayat.tsx, nextSession.ts) dengan loadK5/saveK5/K5_KEY (IMP-06 ikut dikerjakan karena BUG-05 bergantung padanya).

LANGKAH
a. Ubah berkas satu per satu sesuai dokumen. Tampilkan daftar berkas yang diubah/dibuat.
b. Pastikan tidak ada error TypeScript (strict). Perbaiki sampai bersih.
c. Perbarui README: tambahkan bagian "v2.3.1" yang merangkum perubahan tahap ini, termasuk batas yang diketahui (ACWR baru dinilai setelah 14 hari riwayat; baseline kronis dibagi jumlah minggu riwayat, maksimal 4). Naikkan versi package.json ke 2.3.1.
d. Di akhir, laporkan: berkas yang berubah, tes yang ditambahkan, dan hal yang tidak bisa kamu verifikasi.

JANGAN lanjut ke BUG-06 dan seterusnya. Tunggu perintah "lanjut Tahap 2".
```

## Prompt Tahap 2

```text
Lanjut Tahap 2. Terapkan BUG-06, BUG-07, BUG-08, BUG-09, BUG-10, BUG-11, dan BUG-12 sesuai bagian A dokumen, dengan aturan wajib yang sama seperti Tahap 1.

Catatan khusus:
- BUG-06/07: tambahkan tes GPX baru (pace lap tanpa waktu berhenti; cadence yang sudah spm). Perubahan FIT tidak boleh merusak fitParser.test.ts. Berkas gpxParser.test.ts memakai "it" dari node:test, bukan "test".
- BUG-09: dev memakai "tsx server.ts --dev", start memakai "tsx server.ts". Pastikan "npm run dev" tetap berfungsi untuk preview AI Studio.
- BUG-12: nama model Gemini harus bisa dikonfigurasi lewat GEMINI_MODELS (daftar dipisah koma). Jangan mengarang nama model; tetap pakai default yang sudah ada di server.ts sebagai entri pertama dan jelaskan di README cara mengubahnya. Tambahkan GEMINI_MODELS ke .env.example. Detail error mentah jangan dikirim ke klien; cukup di console.error server.
- Setelah selesai, jalankan pemeriksaan tipe dan tes, lalu laporkan hasilnya jujur (termasuk bila ada yang tidak bisa dijalankan).

Tunggu perintah "lanjut Tahap 3".
```

## Prompt Tahap 3

```text
Lanjut Tahap 3. Terapkan IMP-01 sampai IMP-08 dari bagian B dokumen.

Catatan khusus:
- IMP-02: tambahkan @fontsource/dm-sans dan @fontsource/jetbrains-mono, hapus tag Google Fonts dari index.html, dan pastikan tampilan splash tetap rapi.
- IMP-03: tolak FIT/GPX non-lari dengan pesan Bahasa Indonesia. Jangan menolak berkas yang tidak memuat informasi jenis olahraga.
- IMP-04: tambah field "sex" opsional pada profil (default 'male' agar perilaku lama tidak berubah), form Profil, normalizeProfile, dan tes.
- IMP-07: ubah workflow CI sesuai dokumen; jelaskan di README bahwa package-lock.json harus dibuat dengan "npm install --package-lock-only" lalu di-commit.
- IMP-08 bersifat saran: kerjakan HANYA jika menurutmu tidak merusak tes; jika ada tes adaptif yang perlu diubah, jelaskan alasannya dan ubah seminimal mungkin.

Laporkan berkas yang berubah dan hasil tes. Tunggu perintah "lanjut Tahap 4".
```

## Prompt Tahap 4

```text
Lanjut Tahap 4. Terapkan FEAT-01 sampai FEAT-05 dari bagian C dokumen.

Catatan khusus:
- FEAT-01: mode Gabung memakai isDuplicate yang sudah ada; mode Ganti semua mengunduh cadangan saat ini terlebih dahulu. Tambahkan tes untuk logika gabung yang bisa diuji tanpa DOM.
- FEAT-02: sesi impor (fit/gpx) tidak boleh mengubah jarak/durasi. Setelah edit, TRIMP dan EF harus dihitung ulang lewat finalizeWorkout.
- FEAT-03: tambahkan BACKUP_KEY ke ALL_LOCAL_KEYS di src/db/localKeys.ts agar ikut terhapus oleh "Hapus semua data lokal".
- FEAT-04: gunakan registerType 'prompt'; bila repo sudah punya komponen toast/dialog, pakai itu, bukan window.confirm.
- FEAT-05: tampilkan indikator hanya ketika status ACWR 'unknown'.

Di akhir: perbarui README (v2.3.2 atau 2.4.0), jalankan pemeriksaan tipe dan seluruh tes, lalu laporkan hasil dan hal yang belum bisa diverifikasi.
```
