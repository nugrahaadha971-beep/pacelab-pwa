# PACELAB — Refactor Karvonen HRR (VERSI KOREKSI)

Koreksi atas `PACELAB_Full_Refactor___Karvonen_HRR_Guide.md`, dicocokkan dengan kode repo `pacelab-pwa-main.zip` (v2.3.0) yang sebenarnya.

**Legenda:** ✅ dijalankan/diuji · 🔎 dibaca dari kode (belum dijalankan)

## 0. Ringkasan

1. **Panduan lama tidak aman dipakai apa adanya.** Langkah "terapkan file" menimpa `src/plans/hrZones.ts` yang sudah ada. ✅ Saya coba: **9 berkas tes gagal** (`does not provide an export named 'MAF_BAND_BPM'`), dan build ikut rusak karena 6 modul lain mengimpornya.
2. **Sebagian besar isi panduan sudah ada di repo** (daftar di bagian 1). Yang benar-benar belum ada hanya: `hrMethod`, kartu zona di Profil, deteksi HR maks dari rekor sesi, dan `WeekStrip`.
3. **Kode panduan punya bug sendiri** (bagian 2), antara lain input angka yang tidak bisa diketik, `220 − usia` yang menimpa Max HR, dan modal yang menampilkan data sesi sebelumnya.
4. Dokumen ini berisi **hanya selisihnya**, sudah dikoreksi dan diuji: **202 tes lulus** (193 tes bawaan + 9 tes baru).

---

## 1. Konflik dengan repo (kritis)

| # | Panduan lama | Kenyataan di repo | Koreksi |
|---|---|---|---|
| 1 | Menimpa `src/plans/hrZones.ts` (72 baris) | Sudah ada (±200 baris): `Zone`, `hrRange`, `HR_ZONES`, `MAF_BAND_BPM`, `resolveMaxHr`, `calcHrZonePresetRange` (Karvonen), `formatHrWithZone`, `detectHrZoneLabel`, `speedHrSegments`. Dipakai `schedule.ts`, `maf.ts`, `adaptiveEngine.ts`, `progressive5k.ts`, `workoutBuilder.ts`, Beranda, TrainingPlan ✅ | **Tambahkan** fungsi baru di akhir berkas, jangan timpa |
| 2 | Buat `workoutTypes.ts` dan `WorkoutBuilderModal.tsx` | Sudah ada `plans/workoutBuilder.ts` dan `components/WorkoutStepBuilder.tsx` (1.035 baris). Nama tipe bentrok (`SingleStep`, `RepeatBlock`, `WorkoutBlock`, `WORKOUT_PRESETS` bentuknya beda: objek vs array). Versi repo sudah punya normalisasi, id unik, estimasi pace per zona, dan bar profil berbasis estimasi detik | **Jangan dibuat.** Hapus dari rencana |
| 3 | "Tambahkan `restingHr?: number`" | `UserProfile.restingHr: number` sudah ada dan wajib | Jangan dijadikan opsional. Yang baru hanya `hrMethod?` |
| 4 | Langkah 2–4 (Beranda `onNavigate`, Program menyatu, `PlanSession.structuredSteps`, hapus kurikulum) | Sudah ada (`Beranda` menerima `onNavigate`, `Program.tsx` hanya tab jadwal/analisa, `structuredSteps` ada di `PlanSession`) | Jangan dikerjakan ulang |
| 5 | `hrMethod` hanya disebut di tipe | `normalizeProfile` (`db/validate.ts`) membuang field yang tidak dikenal, dan `Profil.save()` memakai `db.userProfile.put({...})` eksplisit → **`hrMethod` hilang saat restore cadangan dan saat menyimpan profil** | Ubah keduanya (bagian 4) |
| 6 | `import { HrMethod, getZoneBpm } from './hrZones'` | Modul di `src/plans` diuji dengan `node --experimental-strip-types`. ✅ Tanpa `.ts` → `ERR_MODULE_NOT_FOUND`; dengan `.ts` tetapi tanpa `type` → `SyntaxError ... does not provide an export` | Pakai `import type` dan ekstensi `.ts` di modul yang dites Node |
| 7 | "% HRR default di seluruh aplikasi" | Sesi hasil `buildPlan` memakai `hrRange()` berbasis **% HRmaks** (easy 71–82 %, interval 90–96 %), jadi tidak membaca `hrMethod`/Resting HR | 🔎 Tidak saya ubah: itu keputusan produk dan mengubah angka di `schedule.test.ts`. Lihat bagian 6 |
| 8 | Perbarui `schedule.test.ts` dan `aiCoach.test.ts` | Skrip `test` di `package.json` berisi **daftar berkas eksplisit** | Tes baru harus didaftarkan (bagian 4.9) |

---

## 2. Bug di kode panduan

| File panduan | Bug | Dampak |
|---|---|---|
| `HrZoneCard` | `onChange` memanggil `Math.max(120, Number(...))` di setiap ketukan | Mengetik "185" mustahil: setelah "1" nilainya langsung jadi 120. Usia ("3" → 10) dan Resting HR ("5" → 35) sama. Input kosong menyimpan `NaN` |
| `HrZoneCard` | Ubah usia → `maxHr: 220 − usia` | Menimpa Max HR hasil input/rekor FIT setiap usia berubah. Repo memakai Tanaka (208 − 0,7 × usia) dengan opsi "otomatis" |
| `HrZoneCard` | Menduplikasi input usia, Max HR, Resting HR | Profil sudah punya ketiganya; dua sumber kebenaran |
| `hrZones.calculateHrZones` | `Math.max(40, maxHr − restingHr)` | Menyamarkan HRR yang tidak valid. Repo: bila Max ≤ Resting, jatuh ke % HRmaks |
| `detectPeakHrFromActivities` | Mengambil nilai maksimum mentah, abaikan `< 140` | Satu lonjakan sensor optik (mis. 223 bpm) menggeser semua zona. Pelari dengan HR maks rendah (lansia) terbuang |
| `workoutTypes.summarizeWorkout` | Satu pace tetap (390 dtk/km) untuk semua langkah; `durationValue` 0 dianggap langkah "open" (+300 dtk) | Jarak interval dan recovery salah. (Versi repo sudah memperbaikinya) |
| `workoutTypes.formatTarget` | Pace tidak dibulatkan | Tampil "5:0.5" bila detik pecahan |
| `WorkoutBuilderModal` | State dibuat sekali dari `initialData`, padahal komponen tetap terpasang saat `isOpen=false` | Membuka sesi kedua menampilkan data sesi pertama |
| `WorkoutBuilderModal` | `flexGrow: durationValue` mencampur detik dan meter | Bar profil salah (800 m vs 90 dtk → rasio 9:1) |
| `WorkoutBuilderModal` | Default Custom HR ditulis mati 168/181; ganti target selalu mereset `hrZone: 2` | Nilai di input tidak sinkron dengan state |
| `WorkoutBuilderModal` | Tidak validasi tanggal kosong, tanpa langkah, min > max; tanpa `role="dialog"`/ESC; `90vh` | Sesi kosong tersimpan; modal tidak aksesibel di ponsel |
| `WeekStrip` | Kategori `'easy'`, padahal repo memakai `SessionKind` (`'recovery'`) | Tidak cocok dengan `PlanSession.kind`; titik tidak berwarna |
| `WeekStrip` | `todayIso` dari `new Date()` tiap render; `setDate` pada tanggal lokal | Tidak konsisten dengan `todayStr()` aplikasi, tidak bisa dites, rawan DST |
| `WeekStrip` | Hari setelah tanggal lomba tetap aktif; tombol tanpa `aria-pressed`/label | Bisa memilih hari tanpa jadwal; pembaca layar tidak tahu isi hari |

---

## 3. Prompt revisi untuk AI Coding Agent

```text
Konteks: repo pacelab-pwa v2.3.0 (React 18 + Vite + TypeScript strict + Dexie). Sebagian besar refactor SUDAH ADA:
Beranda dengan onNavigate, Program.tsx (tab jadwal/analisa), plans/workoutBuilder.ts + components/WorkoutStepBuilder.tsx,
plans/hrZones.ts (preset Karvonen), dan PlanSession.structuredSteps.

TUGAS: tambahkan HANYA hal berikut, sesuai bagian 4 dokumen koreksi.
1. UserProfile.hrMethod?: 'hrr' | 'hrmax' (kosong = 'hrr'). Pertahankan di normalizeProfile dan di Profil.save().
2. Tambahan di plans/hrZones.ts (jangan timpa berkas): zoneRestingHr, buildHrZoneTable, detectPeakHr.
3. Ganti semua pemakaian profile.restingHr untuk zona (Beranda, TrainingPlan, Program) dengan zoneRestingHr(profile).
   Prop restingHr di Program.tsx dan WorkoutStepBuilder.tsx menjadi number | null.
4. Kartu HrZoneCard di Profil (presentasional, tanpa input usia/Max HR/Resting HR sendiri), dengan toggle % HRR / % HRmaks
   dan tombol "pakai HR maks dari rekor sesi".
5. WeekStrip di TrainingPlan: memilih hari menyaring daftar sesi, tetapi total km mingguan tetap memakai seluruh sesi.

LARANGAN
- Jangan menimpa atau menulis ulang berkas yang sudah ada. Jangan membuat workoutTypes.ts atau WorkoutBuilderModal.tsx.
- Jangan mengubah hrRange()/HR_ZONES (zona sesi otomatis berbasis % HRmaks) dan jangan mengubah keputusan desain MAF di README.
- Di src/plans, src/analytics, src/db, dan src/components/*.ts: impor antar modul pakai ekstensi ".ts" dan "import type" untuk tipe.
- Teks UI Bahasa Indonesia; pakai gaya yang ada (sport-card, #BEF264, #09090B).

VERIFIKASI
- Daftarkan tes baru di skrip "test" package.json (daftar berkas eksplisit).
- Jalankan: npm run typecheck && npm test && npm run build. Hasil harus 0 error. Laporkan jujur bila ada yang tidak bisa dijalankan.
```

---

## 4. Kode koreksi

### 4.1 `src/analytics/types.ts` 🔎

```diff
--- a/src/analytics/types.ts
+++ b/src/analytics/types.ts
@@ -1,5 +1,7 @@
 export type RaceDistance = '5K' | '10K' | '21.1K' | '42.2K';
 export type Source = 'fit' | 'gpx' | 'manual';
+/** Cara menghitung zona HR: Karvonen (% HRR, default) atau % HRmaks. */
+export type HrMethod = 'hrr' | 'hrmax';
 export type WorkoutType = 'easy' | 'tempo' | 'interval' | 'long_run' | 'race';
 
 export interface LapSplit { km: number; paceSec: number; avgHr: number | null }
@@ -42,4 +44,6 @@
   targetRaceDate: number;
   targetTimeSec: number;
   weeklyTargetKm?: number;
+  /** Kosong = 'hrr' (Karvonen). 'hrmax' mengabaikan Resting HR untuk zona. */
+  hrMethod?: HrMethod;
 }
```

### 4.2 `src/db/validate.ts` ✅

```diff
--- a/src/db/validate.ts
+++ b/src/db/validate.ts
@@ -74,6 +74,7 @@
     targetRaceDate: typeof raw.targetRaceDate === 'number' && Number.isFinite(raw.targetRaceDate) ? raw.targetRaceDate : 0,
     targetTimeSec: raw.targetTimeSec,
     ...(pos(raw.weeklyTargetKm) ? { weeklyTargetKm: raw.weeklyTargetKm } : {}),
+    ...(raw.hrMethod === 'hrr' || raw.hrMethod === 'hrmax' ? { hrMethod: raw.hrMethod } : {}),
   };
 }
 
```

### 4.3 `src/plans/hrZones.ts` — TAMBAHKAN di akhir berkas (jangan timpa) ✅

Ganti baris impor di bagian atas berkas, lalu tempel blok ini di paling bawah:

```diff
-import type { UserProfile, Workout } from '../analytics/types.ts';
+import type { HrMethod, UserProfile, Workout } from '../analytics/types.ts';
+
+export type { HrMethod };
```

```ts
/**
 * Resting HR yang dipakai untuk zona. Metode '% HRmaks' mengembalikan null sehingga semua fungsi di
 * atas (calcHrZonePresetRange, formatHrWithZone, speedHrSegments, resolveStepHrRange) otomatis
 * jatuh ke % HRmaks tanpa perubahan tanda tangan.
 */
export function zoneRestingHr(p: { restingHr: number; hrMethod?: HrMethod }): number | null {
  return p.hrMethod === 'hrmax' ? null : p.restingHr;
}

export interface HrZoneRow {
  zone: HrZoneNumber;
  code: HrZonePreset['code'];
  name: string;
  /** Mis. "60–70% HRR" atau "60–70% HRmaks". */
  pctLabel: string;
  min: number;
  max: number;
  method: 'hrr' | 'max';
}

/** Tabel Z1–Z5 untuk kartu Profil. Kosong bila HR maks belum valid. */
export function buildHrZoneTable(
  maxHr: number | null | undefined,
  restingHr: number | null | undefined,
  method: HrMethod = 'hrr',
): HrZoneRow[] {
  const rest = method === 'hrmax' ? null : restingHr;
  return HR_ZONE_PRESETS.flatMap((p) => {
    const r = calcHrZonePresetRange(p.zone, maxHr, rest);
    if (!r) return [];
    const suffix = r.method === 'hrr' ? 'HRR' : 'HRmaks';
    return [{ zone: p.zone, code: p.code, name: p.name, pctLabel: `${p.pctLabel} ${suffix}`, min: r.min, max: r.max, method: r.method }];
  });
}

/**
 * HR maks aktual dari rekor sesi (FIT/GPX). Lonjakan sensor optik (mis. 223 bpm sekali) tidak boleh
 * langsung menjadi HR maks: bila nilai tertinggi lebih dari 5 bpm di atas nilai tertinggi kedua,
 * pakai nilai kedua. Nilai di luar 120–230 bpm diabaikan.
 */
export function detectPeakHr(workouts: ReadonlyArray<{ maxHr?: number | null }>): number | null {
  const peaks = workouts
    .map((w) => w.maxHr)
    .filter((h): h is number => typeof h === 'number' && Number.isFinite(h) && h >= 120 && h <= 230)
    .sort((a, b) => b - a);
  if (peaks.length === 0) return null;
  if (peaks.length >= 2 && peaks[0] - peaks[1] > 5) return peaks[1];
  return peaks[0];
}
```

Tidak ada tanda tangan fungsi lama yang berubah. Metode `hrmax` bekerja dengan mengirim `restingHr = null`, sehingga `calcHrZonePresetRange`, `formatHrWithZone`, `speedHrSegments`, dan `resolveStepHrRange` otomatis memakai % HRmaks.

### 4.4 `src/components/weekDays.ts` (BARU) ✅

```ts
// Util tanggal untuk WeekStrip. Murni (tanpa DOM) dan memakai UTC agar tidak terpengaruh zona waktu/DST.
import type { IsoDate } from '../plans/schedule.ts';

export const DAY_SHORT_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
export const MONTH_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

function utc(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoOf(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export interface WeekDay {
  iso: IsoDate;
  dayLabel: string;
  dayOfMonth: number;
}

/** `count` hari berurutan mulai dari `startIso` (bukan harus Senin: minggu program bisa mulai kapan saja). */
export function weekDays(startIso: IsoDate, count = 7): WeekDay[] {
  const start = utc(startIso);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return { iso: isoOf(d), dayLabel: DAY_SHORT_ID[d.getUTCDay()], dayOfMonth: d.getUTCDate() };
  });
}

/** "14 Des – 20 Des 2026"; tahun ditulis di kedua ujung bila rentang melintasi pergantian tahun. */
export function formatWeekRange(startIso: IsoDate, endIso: IsoDate): string {
  const a = utc(startIso);
  const b = utc(endIso);
  const left = `${a.getUTCDate()} ${MONTH_SHORT_ID[a.getUTCMonth()]}`;
  const right = `${b.getUTCDate()} ${MONTH_SHORT_ID[b.getUTCMonth()]}`;
  return a.getUTCFullYear() === b.getUTCFullYear()
    ? `${left} – ${right} ${b.getUTCFullYear()}`
    : `${left} ${a.getUTCFullYear()} – ${right} ${b.getUTCFullYear()}`;
}
```

### 4.5 `src/components/HrZoneCard.tsx` (BARU) 🔎

```tsx
import { useMemo } from 'react';
import { buildHrZoneTable } from '../plans/hrZones';
import type { HrMethod } from '../plans/hrZones';

interface HrZoneCardProps {
  /** Nilai yang sedang dipakai form Profil (bukan data tersimpan), supaya tabel langsung berubah. */
  maxHr: number | null;
  restingHr: number | null;
  method: HrMethod;
  /** HR maks tertinggi yang terekam di sesi FIT/GPX (lihat detectPeakHr). */
  detectedMaxHr?: number | null;
  onMethodChange: (method: HrMethod) => void;
  onUseDetected?: (bpm: number) => void;
}

const ZONE_BADGE: Record<number, string> = {
  1: 'border-zinc-600 bg-zinc-800 text-zinc-200',
  2: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  3: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  4: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  5: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

const METHODS: ReadonlyArray<{ value: HrMethod; label: string }> = [
  { value: 'hrr', label: '% HRR' },
  { value: 'hrmax', label: '% HRmaks' },
];

export function HrZoneCard({
  maxHr,
  restingHr,
  method,
  detectedMaxHr,
  onMethodChange,
  onUseDetected,
}: HrZoneCardProps) {
  const rows = useMemo(() => buildHrZoneTable(maxHr, restingHr, method), [maxHr, restingHr, method]);
  const validHrr = maxHr != null && restingHr != null && restingHr > 0 && maxHr > restingHr;
  const fallsBack = method === 'hrr' && rows.length > 0 && rows[0].method === 'max';
  const showDetected = detectedMaxHr != null && maxHr != null && detectedMaxHr > maxHr && onUseDetected;

  return (
    <section className="sport-card space-y-3 p-5" aria-labelledby="zona-hr-judul">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="zona-hr-judul" className="font-display text-base font-bold text-white">
            Zona Detak Jantung
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            {method === 'hrr' && validHrr && maxHr != null && restingHr != null
              ? `Karvonen · cadangan HR (HRR) ${maxHr - restingHr} bpm`
              : method === 'hrr'
                ? 'Karvonen · isi Resting HR dan Max HR yang valid'
                : 'Persentase dari HR maksimal'}
          </p>
        </div>
        <div role="radiogroup" aria-label="Metode zona" className="flex shrink-0 rounded-xl border border-white/10 bg-[#09090B] p-0.5 text-xs">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={method === m.value}
              onClick={() => onMethodChange(m.value)}
              className={`min-h-[36px] rounded-lg px-3 font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                method === m.value ? 'bg-[#BEF264] text-[#09090B]' : 'text-zinc-400'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {fallsBack && (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Resting HR belum valid, jadi zona sementara memakai % HRmaks.
        </p>
      )}

      {showDetected && (
        <button
          type="button"
          onClick={() => onUseDetected(detectedMaxHr)}
          className="min-h-[44px] w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          Rekor sesi mencatat HR maks <b>{detectedMaxHr} bpm</b> (lebih tinggi dari Max HR sekarang). Ketuk untuk memakainya.
        </button>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">Isi Max HR pada kartu di atas untuk melihat zona.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((z) => (
            <li
              key={z.zone}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#09090B]/80 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${ZONE_BADGE[z.zone]}`}>{z.code}</span>
                <div>
                  <div className="font-semibold tabular-nums text-zinc-100">
                    {z.min}–{z.max} bpm
                  </div>
                  <div className="text-[10px] text-zinc-400">{z.pctLabel}</div>
                </div>
              </div>
              <span className="text-right text-[11px] text-zinc-400">{z.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

### 4.6 `src/components/WeekStrip.tsx` (BARU) 🔎

```tsx
import { formatWeekRange, weekDays } from './weekDays';
import type { IsoDate } from '../plans/schedule';
import type { SessionKind } from '../plans/nike5k';

export interface WeekStripSession {
  id: string;
  date: IsoDate;
  kind: SessionKind;
}

interface WeekStripProps {
  weekStartIso: IsoDate;
  /** Hari setelah tanggal ini (mis. minggu terakhir sebelum lomba) ditampilkan redup dan tidak bisa dipilih. */
  weekEndIso?: IsoDate;
  todayIso: IsoDate;
  selectedDate: IsoDate | null;
  sessions: WeekStripSession[];
  onSelectDate: (iso: IsoDate | null) => void;
  /** Panah minggu hanya tampil bila diberikan (di Program, pemilih minggu sudah ada di atasnya). */
  onShiftWeek?: (delta: -1 | 1) => void;
  canShiftPrev?: boolean;
  canShiftNext?: boolean;
}

const DOT_COLOR: Record<SessionKind, string> = {
  recovery: 'bg-emerald-400',
  long: 'bg-purple-400',
  speed: 'bg-sky-400',
  race: 'bg-amber-400',
};

const KIND_ID: Record<SessionKind, string> = {
  recovery: 'Easy',
  long: 'Long Run',
  speed: 'Speed',
  race: 'Lomba',
};

const ARROW =
  'flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#09090B] text-zinc-300 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]';

export function WeekStrip({
  weekStartIso,
  weekEndIso,
  todayIso,
  selectedDate,
  sessions,
  onSelectDate,
  onShiftWeek,
  canShiftPrev = true,
  canShiftNext = true,
}: WeekStripProps) {
  const days = weekDays(weekStartIso);
  const lastIso = weekEndIso ?? days[days.length - 1].iso;

  return (
    <div className="sport-card space-y-2.5 p-3" role="group" aria-label="Pilih hari dalam minggu ini">
      <div className="flex items-center justify-between gap-2">
        {onShiftWeek ? (
          <button type="button" onClick={() => onShiftWeek(-1)} disabled={!canShiftPrev} aria-label="Minggu sebelumnya" className={ARROW}>
            ‹
          </button>
        ) : (
          <span className="w-11" aria-hidden />
        )}
        <div className="text-xs font-bold text-zinc-100">{formatWeekRange(weekStartIso, lastIso)}</div>
        {onShiftWeek ? (
          <button type="button" onClick={() => onShiftWeek(1)} disabled={!canShiftNext} aria-label="Minggu berikutnya" className={ARROW}>
            ›
          </button>
        ) : (
          <span className="w-11" aria-hidden />
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const dots = sessions.filter((s) => s.date === d.iso);
          const outside = d.iso > lastIso;
          const isSelected = selectedDate === d.iso;
          const isToday = d.iso === todayIso;
          const sessionText =
            dots.length === 0 ? 'tidak ada sesi' : dots.map((s) => KIND_ID[s.kind]).join(', ');

          return (
            <button
              key={d.iso}
              type="button"
              disabled={outside}
              aria-pressed={isSelected}
              aria-label={`${d.dayLabel} ${d.dayOfMonth}${isToday ? ', hari ini' : ''}, ${sessionText}`}
              onClick={() => onSelectDate(isSelected ? null : d.iso)}
              className={`flex min-h-[56px] flex-col items-center justify-center rounded-xl border py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] disabled:opacity-30 ${
                isSelected
                  ? 'border-[#BEF264] bg-[#BEF264]/15 text-white'
                  : isToday
                    ? 'border-zinc-500 bg-zinc-800/80 text-zinc-100'
                    : 'border-white/5 bg-[#09090B] text-zinc-400'
              }`}
            >
              <span className={`text-[10px] ${isToday ? 'font-bold text-[#BEF264]' : ''}`}>{d.dayLabel}</span>
              <span className="my-0.5 text-sm font-extrabold tabular-nums text-zinc-100">{d.dayOfMonth}</span>
              <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                {dots.map((s) => (
                  <span key={s.id} className={`h-1.5 w-1.5 rounded-full ${DOT_COLOR[s.kind]}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="flex items-center justify-between border-t border-white/10 pt-2 text-xs">
          <span className="text-zinc-400">Menampilkan satu hari</span>
          <button
            type="button"
            onClick={() => onSelectDate(null)}
            className="min-h-[44px] px-2 font-semibold text-[#BEF264] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            Semua hari
          </button>
        </div>
      )}
    </div>
  );
}
```

### 4.7 Integrasi di `Profil.tsx` 🔎

```diff
--- a/src/components/Profil.tsx
+++ b/src/components/Profil.tsx
@@ -3,7 +3,9 @@
 import { clearAll, db, exportBackup, importBackup } from '../db/database';
 import { tanakaMaxHr } from '../analytics/workload';
 import { clearGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey } from '../analytics/aiCoach';
-import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
+import type { HrMethod, RaceDistance, UserProfile, Workout } from '../analytics/types';
+import { detectPeakHr } from '../plans/hrZones';
+import { HrZoneCard } from './HrZoneCard';
 import {
   addShoe,
   calcAllShoesMileage,
@@ -53,6 +55,8 @@
   const [age, setAge] = useState(profile?.age ?? 0);
   const [auto, setAuto] = useState(() => !profile || profile.maxHr === tanakaMaxHr(profile.age));
   const [maxHrText, setMaxHrText] = useState(String(profile?.maxHr ?? ''));
+  const [restingText, setRestingText] = useState(String(profile?.restingHr ?? ''));
+  const [hrMethod, setHrMethod] = useState<HrMethod>(profile?.hrMethod ?? 'hrr');
   const [pendingImport, setPendingImport] = useState<File | null>(null);
   const [askWipe, setAskWipe] = useState(false);
   const [geminiKey, setGeminiKey] = useState(() => loadGeminiApiKey());
@@ -68,10 +72,13 @@
   const [editingShoeKm, setEditingShoeKm] = useState('');
   const [shoeMsg, setShoeMsg] = useState<Msg | null>(null);
 
+  const liveMaxHr = auto ? (age > 0 ? tanakaMaxHr(age) : null) : Number(maxHrText) > 0 ? Number(maxHrText) : null;
+  const liveRestingHr = Number(restingText) > 0 ? Number(restingText) : null;
+
   const save = async (e: FormEvent<HTMLFormElement>) => {
     e.preventDefault();
     const f = new FormData(e.currentTarget);
-    const restingHr = Number(f.get('restingHr'));
+    const restingHr = Number(restingText);
     const maxHr = auto ? tanakaMaxHr(age) : Number(maxHrText);
     const targetTimeSec = parseDuration(String(f.get('targetTime')));
     const weeklyRaw = String(f.get('weeklyTargetKm') ?? '').trim().replace(',', '.');
@@ -89,7 +96,7 @@
 
     try {
       await db.userProfile.put({
-        id: 'default', age, restingHr, maxHr,
+        id: 'default', age, restingHr, maxHr, hrMethod,
         targetDistance: f.get('target') as RaceDistance,
         targetRaceDate: Date.parse(String(f.get('raceDate'))) || 0,
         targetTimeSec,
@@ -243,7 +250,7 @@
 
         <div className="grid grid-cols-2 gap-3">
           <Field label="Usia" hint="Tahun" type="number" inputMode="numeric" value={age || ''} onChange={(e) => setAge(Number(e.target.value))} error={errs.age} />
-          <Field label="Resting HR" term="bpm" name="restingHr" type="number" inputMode="numeric" defaultValue={profile?.restingHr} error={errs.restingHr} />
+          <Field label="Resting HR" term="bpm" type="number" inputMode="numeric" value={restingText} onChange={(e) => setRestingText(e.target.value)} error={errs.restingHr} />
         </div>
 
         <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold text-zinc-200">
@@ -299,6 +306,15 @@
         <PrimaryButton type="submit">Simpan profil</PrimaryButton>
       </form>
 
+      <HrZoneCard
+        maxHr={liveMaxHr}
+        restingHr={liveRestingHr}
+        method={hrMethod}
+        detectedMaxHr={detectPeakHr(workouts)}
+        onMethodChange={setHrMethod}
+        onUseDetected={(bpm) => { setAuto(false); setMaxHrText(String(bpm)); }}
+      />
+
       {/* Kartu 2: Pelatih AI (Gemini) */}
       <section className="space-y-3 sport-card p-5" aria-labelledby="gemini-coach-judul">
         <div className="flex items-center justify-between gap-2">
```

### 4.8 Integrasi di Beranda, TrainingPlan, Program, WorkoutStepBuilder 🔎

```diff
--- a/src/components/Beranda.tsx
+++ b/src/components/Beranda.tsx
@@ -3,7 +3,7 @@
 import type { UserProfile, Workout } from '../analytics/types';
 import { DAY_MS } from '../analytics/workload';
 import { stripMarkdown } from '../analytics/raceDayAnalyzer';
-import { formatHrWithZone, resolveMaxHr, ZONE_LABEL } from '../plans/hrZones';
+import { formatHrWithZone, resolveMaxHr, ZONE_LABEL, zoneRestingHr } from '../plans/hrZones';
 import { formatDateId, isoFromRaceTs, remaining } from '../plans/schedule';
 import { calcAllShoesMileage, loadShoes } from '../plans/shoeStore';
 import { fmtHms, todayStr } from './format';
@@ -72,7 +72,7 @@
   const maxHr = resolveMaxHr(profile, workouts);
   const hrTuple: [number, number] | null =
     next && s && next.hr ? [next.hr[0], s.hr?.[1] ?? next.hr[1]] : null;
-  const formattedHr = next && s ? formatHrWithZone(hrTuple, s.zone, maxHr, profile.restingHr) : null;
+  const formattedHr = next && s ? formatHrWithZone(hrTuple, s.zone, maxHr, zoneRestingHr(profile)) : null;
 
   const targetHrText =
     next && s
```

```diff
--- a/src/components/TrainingPlan.tsx
+++ b/src/components/TrainingPlan.tsx
@@ -33,7 +33,7 @@
   intervalPaceRange,
   weekPace,
 } from '../plans/adaptiveEngine';
-import { formatHrWithZone, resolveMaxHr, speedHrSegments, ZONE_LABEL } from '../plans/hrZones';
+import { formatHrWithZone, resolveMaxHr, speedHrSegments, ZONE_LABEL, zoneRestingHr } from '../plans/hrZones';
 import { fmtKm, fmtPace, fmtRangeKm, nearestRow, paceSecPerKm } from '../plans/pace';
 import {
   addDays,
@@ -58,7 +58,7 @@
   toggleDone,
   WEEKDAY_SHORT,
 } from '../plans/schedule';
-import type { Phase, PlanSession, ScheduleState } from '../plans/schedule';
+import type { IsoDate, Phase, PlanSession, ScheduleState } from '../plans/schedule';
 import { parseDuration } from '../parsers/manual';
 import { fmtHms, todayStr } from './format';
 import AiLoader from './AiLoader';
@@ -66,6 +66,7 @@
 import { StructuredStepsView } from './WorkoutStepBuilder';
 import { KIND_BORDER, KIND_LABEL } from './sessionMeta';
 import { Button, Field } from './ui';
+import { WeekStrip } from './WeekStrip';
 
 const PHASE_LABEL: Record<Phase, string> = {
   base: 'Base Building',
@@ -230,6 +231,11 @@
   onEditCustomSession,
 }: Props) {
   const [weekIdx, setWeekIdx] = useState(0);
+  const [selectedDay, setSelectedDay] = useState<IsoDate | null>(null);
+  const goWeek = (i: number) => {
+    setWeekIdx(i);
+    setSelectedDay(null);
+  };
   const [settings, setSettings] = useState(false);
   const [k5Text, setK5Text] = useState(
     () => loadSaved() ?? (defaultK5Sec != null ? fmtHms(defaultK5Sec) : ''),
@@ -377,6 +383,14 @@
   }
 
   const visibleRawSessions = week ? week.sessions : standaloneSessions;
+  const stripSessions = visibleRawSessions.map((raw) => {
+    const s = byId.get(raw.id) ?? raw;
+    return { id: s.id, date: s.date, kind: s.kind };
+  });
+  // Daftar mengikuti hari terpilih; total km mingguan (weekKm) tetap memakai seluruh sesi minggu ini.
+  const shownSessions = selectedDay
+    ? visibleRawSessions.filter((raw) => (byId.get(raw.id) ?? raw).date === selectedDay)
+    : visibleRawSessions;
 
   const goalPaceFor = (s: PlanSession): number | null =>
     s.kind === 'race'
@@ -571,7 +585,7 @@
         <div className="flex items-center gap-1.5">
           <button
             type="button"
-            onClick={() => setWeekIdx(wi - 1)}
+            onClick={() => goWeek(wi - 1)}
             disabled={wi <= 0}
             aria-label="Minggu sebelumnya"
             className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#121215] text-zinc-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
@@ -580,7 +594,7 @@
           </button>
           <select
             value={wi}
-            onChange={(e) => setWeekIdx(Number(e.target.value))}
+            onChange={(e) => goWeek(Number(e.target.value))}
             aria-label="Pilih minggu"
             className="min-h-[44px] min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#121215] px-3 text-sm text-zinc-100 focus:border-[#BEF264] focus:outline-none focus:ring-2 focus:ring-[#BEF264]/35"
           >
@@ -592,7 +606,7 @@
           </select>
           <button
             type="button"
-            onClick={() => setWeekIdx(wi + 1)}
+            onClick={() => goWeek(wi + 1)}
             disabled={wi >= plan.weeks.length - 1}
             aria-label="Minggu berikutnya"
             className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#121215] text-zinc-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
@@ -602,11 +616,24 @@
         </div>
       )}
 
+      {plan && week && (
+        <WeekStrip
+          weekStartIso={week.startIso}
+          weekEndIso={week.endIso}
+          todayIso={todayIso}
+          selectedDate={selectedDay}
+          sessions={stripSessions}
+          onSelectDate={setSelectedDay}
+        />
+      )}
+
       {/* Daftar Sesi Minggu Ini */}
       <section className="space-y-3" aria-label="Sesi minggu ini">
-        {visibleRawSessions.length === 0 ? (
+        {shownSessions.length === 0 ? (
           <div className="sport-card border-dashed border-white/15 p-5 text-center">
-            <p className="text-sm text-zinc-300">Belum ada sesi latihan pada minggu ini.</p>
+            <p className="text-sm text-zinc-300">
+              {selectedDay ? 'Tidak ada sesi pada hari yang dipilih.' : 'Belum ada sesi latihan pada minggu ini.'}
+            </p>
             {onAddCustomSession && (
               <button
                 type="button"
@@ -619,7 +646,7 @@
             )}
           </div>
         ) : (
-          visibleRawSessions.map((raw) => {
+          shownSessions.map((raw) => {
             const s = (byId.get(raw.id) ?? raw) as PlanSession;
             const isDone = done.has(s.id);
             const auto = autoCompleted(s, workoutDays, todayIso);
@@ -676,7 +703,7 @@
                 : `${fmtPace(s.pace[0])}–${fmtPace(s.pace[1])} /km`
               : null;
 
-            const formattedHr = formatHrWithZone(s.hr, s.zone, maxHr, profile.restingHr);
+            const formattedHr = formatHrWithZone(s.hr, s.zone, maxHr, zoneRestingHr(profile));
 
             const targetPaceOrHr = formattedHr
               ? formattedHr
@@ -801,7 +828,7 @@
                       <StructuredStepsView
                         blocks={s.structuredSteps}
                         maxHr={maxHr}
-                        restingHr={profile.restingHr}
+                        restingHr={zoneRestingHr(profile)}
                         referencePaceSecPerKm={easyPace}
                       />
                     ) : (
@@ -815,7 +842,7 @@
                               {speedHrSegments({
                                 sessionHr: s.hr,
                                 maxHr,
-                                restingHr: profile.restingHr,
+                                restingHr: zoneRestingHr(profile),
                               }).map((seg) => (
                                 <div
                                   key={seg.id}
@@ -1010,7 +1037,7 @@
                     {s.durationMin != null && <span>{s.durationMin} mnt</span>}
                     {s.hr && (
                       <span>
-                        {formatHrWithZone(s.hr, s.zone, maxHr, profile.restingHr)}
+                        {formatHrWithZone(s.hr, s.zone, maxHr, zoneRestingHr(profile))}
                       </span>
                     )}
                   </div>
```

```diff
--- a/src/components/Program.tsx
+++ b/src/components/Program.tsx
@@ -10,7 +10,7 @@
   velocityFor,
   ZONE_FRACTION,
 } from '../analytics/predictor';
-import { resolveMaxHr } from '../plans/hrZones';
+import { resolveMaxHr, zoneRestingHr } from '../plans/hrZones';
 import { fmtPace } from '../plans/pace';
 import type { SessionKind } from '../plans/nike5k';
 import {
@@ -101,7 +101,7 @@
   initialSession?: PlanSession;
   defaultDate: string;
   maxHr: number | null;
-  restingHr: number;
+  restingHr: number | null;
   easyPaceSecPerKm: number;
   onClose: () => void;
   onSave: (payload: CustomSessionInput) => void;
@@ -656,7 +656,7 @@
           initialSession={sessionModal.mode === 'edit' ? sessionModal.session : undefined}
           defaultDate={todayIso}
           maxHr={maxHr}
-          restingHr={profile.restingHr}
+          restingHr={zoneRestingHr(profile)}
           easyPaceSecPerKm={easyPace}
           onClose={() => setSessionModal(null)}
           onSave={handleSaveCustomSession}
```

```diff
--- a/src/components/WorkoutStepBuilder.tsx
+++ b/src/components/WorkoutStepBuilder.tsx
@@ -279,7 +279,7 @@
   canMoveDown: boolean;
   canDelete: boolean;
   maxHr: number | null;
-  restingHr: number;
+  restingHr: number | null;
   onToggleExpand: () => void;
   onChange: (next: SingleStep) => void;
   onMoveUp: () => void;
@@ -763,7 +763,7 @@
   onChange: (next: WorkoutBlock[]) => void;
   onApplyPreset: (preset: WorkoutPresetTemplate) => void;
   maxHr: number | null;
-  restingHr: number;
+  restingHr: number | null;
 }
 
 export function WorkoutStepBuilder({
```

### 4.9 Tes baru ✅

Tambahkan di akhir daftar pada skrip `test` di `package.json` (jangan hapus yang lama):

```text
 src/plans/hrZones.test.ts src/components/weekDays.test.ts
```

`src/plans/hrZones.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHrZoneTable, calcHrZonePresetRange, detectPeakHr, formatHrWithZone, zoneRestingHr } from './hrZones.ts';

test('zoneRestingHr: hrr memakai Resting HR, hrmax mengembalikan null', () => {
  assert.equal(zoneRestingHr({ restingHr: 58 }), 58);
  assert.equal(zoneRestingHr({ restingHr: 58, hrMethod: 'hrr' }), 58);
  assert.equal(zoneRestingHr({ restingHr: 58, hrMethod: 'hrmax' }), null);
});

test('buildHrZoneTable: Karvonen 182/55 (cocok dengan preset yang sudah ada) vs % HRmaks', () => {
  const hrr = buildHrZoneTable(182, 55, 'hrr');
  assert.equal(hrr.length, 5);
  assert.deepEqual([hrr[1].min, hrr[1].max, hrr[1].method], [131, 144, 'hrr']);
  assert.equal(hrr[1].pctLabel, '60–70% HRR');
  const mx = buildHrZoneTable(182, 55, 'hrmax');
  assert.deepEqual([mx[1].min, mx[1].max, mx[1].method], [109, 127, 'max']);
  assert.equal(mx[1].pctLabel, '60–70% HRmaks');
});

test('buildHrZoneTable: Resting HR tidak valid → jatuh ke % HRmaks; HR maks tidak valid → kosong', () => {
  assert.equal(buildHrZoneTable(182, 0, 'hrr')[1].method, 'max');
  assert.equal(buildHrZoneTable(182, 190, 'hrr')[1].method, 'max');
  assert.deepEqual(buildHrZoneTable(0, 55, 'hrr'), []);
  assert.deepEqual(buildHrZoneTable(null, 55), []);
});

test('hrmax: formatHrWithZone memakai % HRmaks ketika Resting HR diganti zoneRestingHr', () => {
  const p = { restingHr: 55, hrMethod: 'hrmax' as const };
  const z = calcHrZonePresetRange(2, 182, zoneRestingHr(p));
  assert.equal(z?.method, 'max');
  assert.equal(formatHrWithZone([109, 127], undefined, 182, zoneRestingHr(p)), 'Zona 2 · 109–127 bpm');
});

test('detectPeakHr: abaikan lonjakan sensor, nilai di luar rentang, dan data kosong', () => {
  assert.equal(detectPeakHr([]), null);
  assert.equal(detectPeakHr([{ maxHr: null }, {}]), null);
  assert.equal(detectPeakHr([{ maxHr: 188 }]), 188);
  assert.equal(detectPeakHr([{ maxHr: 188 }, { maxHr: 185 }, { maxHr: 170 }]), 188);
  // lonjakan 223 hanya di satu sesi → pakai tertinggi kedua
  assert.equal(detectPeakHr([{ maxHr: 223 }, { maxHr: 188 }, { maxHr: 185 }]), 188);
  // di luar 120–230 diabaikan
  assert.equal(detectPeakHr([{ maxHr: 250 }, { maxHr: 90 }, { maxHr: 176 }]), 176);
  // pelari dengan HR maks rendah tidak ikut terbuang (panduan lama membuang < 140)
  assert.equal(detectPeakHr([{ maxHr: 135 }, { maxHr: 132 }]), 135);
});
```

`src/components/weekDays.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWeekRange, weekDays } from './weekDays.ts';

test('weekDays: 7 hari berurutan melewati pergantian bulan dan tahun', () => {
  const d = weekDays('2026-12-29');
  assert.deepEqual(d.map((x) => x.iso), [
    '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04',
  ]);
  assert.deepEqual(d.map((x) => x.dayLabel), ['Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min', 'Sen']);
});

test('weekDays: tidak terpengaruh zona waktu (hari selalu bertambah tepat 1)', () => {
  const d = weekDays('2027-03-27');
  assert.equal(d[1].iso, '2027-03-28');
  assert.equal(d[6].iso, '2027-04-02');
});

test('formatWeekRange: satu tahun vs lintas tahun', () => {
  assert.equal(formatWeekRange('2026-12-14', '2026-12-20'), '14 Des – 20 Des 2026');
  assert.equal(formatWeekRange('2026-12-29', '2027-01-04'), '29 Des 2026 – 4 Jan 2027');
});
```

Tambahkan di akhir `src/db/validate.test.ts`:

```ts
test('normalizeProfile menjaga hrMethod yang valid dan membuang yang lain', () => {
  assert.equal(normalizeProfile({ ...P, hrMethod: 'hrmax' })?.hrMethod, 'hrmax');
  assert.equal(normalizeProfile({ ...P, hrMethod: 'hrr' })?.hrMethod, 'hrr');
  assert.equal(normalizeProfile({ ...P, hrMethod: 'x' })?.hrMethod, undefined);
  assert.equal(normalizeProfile(P)?.hrMethod, undefined);
});
```

---

## 5. Hasil verifikasi dan batasannya

- ✅ `npm test` pada salinan koreksi: **202 lulus, 0 gagal** (193 bawaan + 9 baru: 5 zona/HR maks, 3 tanggal, 1 profil).
- ✅ Bukti panduan lama merusak: menimpa `hrZones.ts` dengan versinya → 9 berkas tes gagal.
- 🔎 **Pemeriksaan tipe belum penuh.** `node_modules` tidak ada dan jaringan nonaktif, jadi `tsc`/`vite build` asli tidak bisa dijalankan. Saya memeriksa dengan modul `react`, `dexie`, `lucide-react` yang dibuat "any": **tidak ada error tipe baru** selain artefak shim itu sendiri (mis. parameter `useMemo`/`useState` yang jadi `any`). Jalankan `npm run typecheck && npm run build` di mesin Anda.
- 🔎 **Komponen UI belum dirender** (`HrZoneCard`, `WeekStrip`, perubahan Profil/TrainingPlan). Logikanya sudah diekstrak ke fungsi murni yang diuji, tetapi tampilan perlu dicoba di ponsel.

## 6. Tidak dikerjakan (perlu keputusan Anda)

1. **Zona sesi otomatis masih % HRmaks.** `hrRange('easy' | 'interval')` tidak membaca `hrMethod`. Menyamakannya dengan Karvonen mengubah target bpm semua jadwal dan beberapa tes. Bila Anda ingin, putuskan dulu: petakan `easy` ke Z2 HRR dan `interval` ke Z4 HRR?
2. **Kondisi "Isi Minggu AI"** (Normal / Habis Shift Malam / Cuaca Panas): panduan hanya menyebut tombolnya tanpa kode, dan repo belum punya parameter kondisi di prompt AI.
3. **Pindah "Evaluasi AI Hasil Program" ke Analitik:** tanpa kode di panduan; saat ini dipanggil dari `TrainingPlan.tsx`.
4. **MAF dan Progresif/Nike:** panduan meminta menghapus pilihan kurikulum, sedangkan README menyebut keputusan desain MAF "terkunci". Repo sudah memakai mode `custom`; saya tidak menyentuhnya.
