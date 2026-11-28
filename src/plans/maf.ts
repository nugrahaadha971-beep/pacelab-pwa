// Program MAF (Maximum Aerobic Function, metode Phil Maffetone). Murni (tanpa UI).
// Semua lari dilakukan di zona detak jantung MAF; pace adalah hasil, bukan target.
import { cardiacDrift } from '../analytics/workload.ts';
import { RACE_KM } from '../analytics/predictor.ts';
import type { RaceDistance, Workout } from '../analytics/types.ts';
import { hrRange, MAF_BAND_BPM } from './hrZones.ts';
import type { TemplateSession, TemplateWeek } from './progressive5k.ts';

// ───────────────────────── Rumus 180 ─────────────────────────

/** Penyesuaian kondisi menurut rumus 180 Maffetone. */
export type MafAdjustment = -10 | -5 | 0 | 5;

export const MAF_ADJUSTMENTS: ReadonlyArray<{ value: MafAdjustment; label: string }> = [
  { value: -10, label: 'Baru pulih dari sakit/operasi berat, atau rutin minum obat (−10)' },
  { value: -5, label: 'Cedera, performa menurun, sering flu/pilek (> 2 kali/tahun), atau alergi (−5)' },
  { value: 0, label: 'Berlatih teratur sampai 2 tahun, atau baru mulai, tanpa masalah (0)' },
  { value: 5, label: 'Berlatih > 2 tahun tanpa cedera dan terus membaik (+5)' },
];

export const normalizeMafAdj = (raw: unknown): MafAdjustment =>
  raw === -10 || raw === -5 || raw === 5 ? raw : 0;

/** Usia ≤ 16: dipakai 165 tetap (bukan 180 − usia). Usia tidak valid → null. */
export const MAF_YOUTH_AGE = 16;
export const MAF_YOUTH_HR = 165;

/**
 * HR MAF = 180 − usia + penyesuaian (usia ≤ 16 → 165 + penyesuaian). Usia dibulatkan dulu agar sama dengan teks rumus.
 * Tambahan untuk usia > 65 tidak otomatis.
 */
export function mafHr(age: number | null | undefined, adj: MafAdjustment = 0): number | null {
  if (age == null || !Number.isFinite(age) || age < 5 || age > 100) return null;
  const a = Math.round(age);
  return (a <= MAF_YOUTH_AGE ? MAF_YOUTH_HR : 180 - a) + adj;
}

/** Teks rumus untuk ditampilkan, mis. "180 − 40 + 5 = 145" atau "165 (usia ≤ 16) − 5 = 160". Null bila usia tidak valid. */
export function mafFormula(age: number | null | undefined, adj: MafAdjustment = 0): string | null {
  const maf = mafHr(age, adj);
  if (maf == null) return null;
  const a = Math.round(age as number);
  const base = a <= MAF_YOUTH_AGE ? `${MAF_YOUTH_HR} (usia ≤ ${MAF_YOUTH_AGE})` : `180 − ${a}`;
  const term = adj === 0 ? '' : ` ${adj > 0 ? '+' : '−'} ${Math.abs(adj)}`;
  return `${base}${term} = ${maf}`;
}

/** Zona latihan: HR MAF turun 10 bpm → HR MAF. */
export const mafZone = (maf: number): [number, number] => [maf - MAF_BAND_BPM, maf];

export const MAF_RULE =
  'Jaga detak jantung di antara batas bawah dan MAF. Jika melewati MAF (tanjakan, panas), perlambat atau jalan sampai turun—jangan mengejar pace.';

// ───────────────────────── MAF Test & pelacakan ─────────────────────────

export const MAF_MIN_KM = 3;
/** ASUMSI: HR rata-rata sesi dianggap "di zona MAF" bila −5…+3 bpm dari HR MAF. */
export const MAF_TOL_LOW = 5;
export const MAF_TOL_HIGH = 3;

export interface MafPoint {
  date: number;
  distanceKm: number;
  avgHr: number;
  paceSecPerKm: number;
  driftPct: number | null;
}

/**
 * Sesi ≥ 3 km dengan HR rata-rata di sekitar HR MAF dianggap data pace-di-zona-MAF: MAF Test maupun lari biasa
 * di zona yang sama. Yang menentukan adalah HR rata-rata, bukan jenis sesi, karena MAF Test bisa dicatat sebagai
 * Easy, Tempo, Interval, atau Long run. Race dikecualikan karena dimaksudkan sebagai usaha maksimal, bukan pengukuran
 * di zona. Urut dari yang terlama.
 */
export function mafTests(workouts: Workout[], maf: number | null): MafPoint[] {
  if (maf == null) return [];
  return workouts
    .filter((w) => w.workoutType !== 'race'
      && w.distanceKm >= MAF_MIN_KM && w.durationSec > 0 && w.avgHr != null
      && w.avgHr >= maf - MAF_TOL_LOW && w.avgHr <= maf + MAF_TOL_HIGH)
    .sort((a, b) => a.date - b.date)
    .map((w) => ({
      date: w.date, distanceKm: w.distanceKm, avgHr: w.avgHr as number,
      paceSecPerKm: w.avgPaceSecPerKm > 0 ? w.avgPaceSecPerKm : w.durationSec / w.distanceKm,
      driftPct: cardiacDrift(w.laps),
    }));
}

/** Pace (dtk/km) catatan di zona MAF yang paling baru; null bila belum ada. Dipakai konteks Pelatih AI. */
export function latestMafPaceSec(
  workouts: Workout[],
  age: number | null | undefined,
  adj: MafAdjustment = 0,
  now?: number,
): number | null {
  const pool = now == null ? workouts : workouts.filter((w) => w.date <= now);
  const pts = mafTests(pool, mafHr(age, adj));
  return pts.length > 0 ? pts[pts.length - 1].paceSecPerKm : null;
}

/**
 * firstPace / lastPace adalah rata-rata `window` sampel pertama / terakhir (window = 1 bila hanya 2–3 catatan,
 * sehingga itu sama dengan pace pertama dan terakhir).
 */
export interface MafTrend { firstPace: number; lastPace: number; deltaSec: number; count: number; window: number }

/** Jumlah sampel di tiap ujung tren: min(3, ⌊n/2⌋). 2–3 catatan → 1; 4–5 → 2; ≥ 6 → 3. Ujungnya tidak pernah tumpang tindih. */
export const mafTrendWindow = (n: number): number => Math.min(3, Math.floor(n / 2));

const avgPace = (ps: MafPoint[]): number => ps.reduce((s, p) => s + p.paceSecPerKm, 0) / ps.length;

/**
 * Selisih pace awal → terbaru (negatif = makin cepat di HR yang sama = fondasi aerobik membaik).
 * Dengan ≥ 4 catatan, dibandingkan rata-rata sampel awal vs sampel terbaru agar satu sesi anomali
 * (panas, kurang tidur) tidak menentukan arah tren.
 */
export function mafTrend(points: MafPoint[]): MafTrend | null {
  const n = points.length;
  if (n < 2) return null;
  const k = mafTrendWindow(n);
  const firstPace = avgPace(points.slice(0, k));
  const lastPace = avgPace(points.slice(n - k));
  return { firstPace, lastPace, deltaSec: lastPace - firstPace, count: n, window: k };
}

// ───────────────────────── Kurikulum MAF 12 minggu ─────────────────────────

const SAT = 6;
const WARM = "Pemanasan 10–15': jalan cepat, lalu lari sangat pelan sampai HR masuk zona MAF";
const COOL = "Pendinginan 5–10': jalan santai";
/** ASUMSI: pace nominal untuk memperkirakan total durasi MAF Test 5 km (bukan target). */
const NOMINAL_TEST_SEC_KM = 600;

const run = (min: number, kind: 'recovery' | 'long' = 'recovery', label = 'di zona MAF'): TemplateSession => ({
  kind, zone: 'maf', durationMin: min, name: `${min}' ${label}`,
  steps: [WARM, `Lari ${min} menit dengan HR di antara batas bawah dan MAF. Jika HR melewati MAF, perlambat atau jalan sampai HR turun.`, COOL],
});
const long = (min: number) => run(min, 'long', 'Long Run di zona MAF');
const shake = (min: number) => run(min, 'recovery', 'shake-out di zona MAF');
const test = (): TemplateSession => ({
  kind: 'speed', zone: 'maf', test: 'maf', fixedWeekday: SAT,
  durationMin: Math.round(15 + (5 * NOMINAL_TEST_SEC_KM) / 60 + 5),
  name: 'MAF Test 5 km',
  steps: [
    "Pemanasan 15': jalan cepat, lalu lari makin cepat sampai HR mencapai MAF",
    'Lari 5 km dengan HR stabil di MAF (jangan lebih). Catat waktu tiap km; km terakhir biasanya paling lambat.',
    "Pendinginan 5': jalan santai",
  ],
});

/** Tiap minggu: 3 lari MAF + 1 Long Run (Sel/Kam/Sab/Min). Minggu 4 dan 8 ringan + MAF Test (Sabtu). Minggu 12 = taper + lomba. */
export const MAF_5K: TemplateWeek[] = [
  { title: 'Fondasi Aerobik MAF', sessions: [run(30), run(30), run(30), long(45)] },
  { title: 'Fondasi Aerobik MAF', sessions: [run(30), run(30), run(35), long(50)] },
  { title: 'Fondasi Aerobik MAF', sessions: [run(30), run(35), run(35), long(55)] },
  { title: 'Ringan + MAF Test', deload: true, sessions: [run(30), run(30), test(), long(40)] },
  { title: 'Fondasi Aerobik MAF', sessions: [run(35), run(35), run(40), long(60)] },
  { title: 'Fondasi Aerobik MAF', sessions: [run(40), run(40), run(40), long(65)] },
  { title: 'Fondasi Aerobik MAF', sessions: [run(40), run(45), run(45), long(70)] },
  { title: 'Ringan + MAF Test', deload: true, sessions: [run(35), run(35), test(), long(45)] },
  { title: 'Fondasi Aerobik MAF', sessions: [run(45), run(45), run(50), long(75)] },
  { title: 'Fondasi Aerobik MAF', sessions: [run(45), run(50), run(50), long(80)] },
  { title: 'Fondasi Aerobik MAF', sessions: [run(40), run(40), run(45), long(70)] },
  { title: 'Taper & Lomba', sessions: [run(30), run(20), shake(15)] },
];

export const MAF_RACE_STEPS = [
  'Hari lomba bukan sesi zona MAF: HR akan melewati MAF dan itu wajar. Km 1 sedikit lebih lambat dari pace target, km tengah stabil, keluarkan sisa tenaga di km akhir.',
  'Program MAF membangun fondasi aerobik. Manfaat penuhnya biasanya terlihat setelah 3–6 bulan, jadi catat pace MAF Test sebagai ukuran kemajuan, bukan hanya waktu lomba.',
];

// ───────────────────────── Proyeksi race & lini masa adaptasi ─────────────────────────

/** Tanda awal adaptasi MAF: 3–6 minggu (drift turun, pace di HR yang sama membaik ~15–30 dtk/km). */
export const MAF_EARLY_WEEKS: readonly [number, number] = [3, 6];
export const MAF_EARLY_GAIN_SEC: readonly [number, number] = [15, 30];
/** Adaptasi penuh: 3–6 bulan (12–24 minggu). */
export const MAF_FULL_WEEKS: readonly [number, number] = [12, 24];
/** ASUMSI: lomba 5K ≈ 1,5–2,5 mnt/km lebih cepat dari pace aerobik MAF. */
export const MAF_RACE_OFFSET_SEC: readonly [number, number] = [150, 90];
/** Eksponen skala jarak: pace lomba ke jarak lain = pace 5K × (km / 5) ** 0.06. */
export const MAF_DISTANCE_EXPONENT = 0.06;
/** ASUMSI konservatif: pace MAF membaik 12 dtk/km per 4 minggu latihan konsisten. */
export const MAF_GAIN_SEC_PER_BLOCK = 12;
export const MAF_GAIN_BLOCK_WEEKS = 4;
/** Simulasi hari lomba baru dibuat bila tersisa minimal sekian minggu. */
export const MAF_SIM_MIN_WEEKS = 4;

export interface MafRaceOutlookParams {
  mafPaceSecPerKm: number | null;
  maxHr: number | null;
  targetDistance: RaceDistance;
  weeksRemaining: number | null;
}

/** Rentang [cepat, lambat]; pace dtk/km, waktu dtk. */
export type SecRange = [number, number];

export interface MafRaceProjection {
  /** Pace lomba dengan kondisi saat ini. */
  paceNow: SecRange;
  timeNow: SecRange;
  /** Simulasi hari lomba; null bila sisa minggu < 4. */
  raceDay: { gainSecPerKm: number; pace: SecRange; time: SecRange } | null;
}

export interface MafRaceOutlook {
  timeline: {
    earlyWeeks: readonly [number, number];
    earlyGainSec: readonly [number, number];
    fullWeeks: readonly [number, number];
    /** Catatan sisa minggu menuju lomba; null bila tidak ada tanggal lomba. */
    weeksNote: string | null;
  };
  /** 90–95% HR maks; null bila HR maks belum diisi. */
  raceHr: [number, number] | null;
  splits: { km1: string; middle: string; finish: string };
  /** Null bila belum ada catatan pace MAF ≥ 3 km. */
  projection: MafRaceProjection | null;
}

/** Pace lomba [cepat, lambat] dari pace MAF: basis 5K lalu diskalakan ke jarak target. */
function projectPace(mafPace: number, distance: RaceDistance): SecRange {
  const scale = (RACE_KM[distance] / 5) ** MAF_DISTANCE_EXPONENT;
  return [Math.round((mafPace - MAF_RACE_OFFSET_SEC[0]) * scale), Math.round((mafPace - MAF_RACE_OFFSET_SEC[1]) * scale)];
}

const toTime = (pace: SecRange, distance: RaceDistance): SecRange =>
  [Math.round(pace[0] * RACE_KM[distance]), Math.round(pace[1] * RACE_KM[distance])];

function weeksNote(weeks: number | null): string | null {
  if (weeks == null || !Number.isFinite(weeks)) return null;
  if (weeks <= 0) return 'Hari lomba sudah tiba atau terlewat.';
  const w = Math.round(weeks);
  if (w < MAF_EARLY_WEEKS[0]) return `Tersisa ${w} minggu menuju lomba: terlalu singkat untuk melihat adaptasi MAF. Fokus menjaga HR di zona dan tiba segar.`;
  if (w < MAF_FULL_WEEKS[0]) return `Tersisa ${w} minggu menuju lomba: cukup untuk tanda awal adaptasi, belum untuk adaptasi penuh (${MAF_FULL_WEEKS[0]}–${MAF_FULL_WEEKS[1]} minggu).`;
  return `Tersisa ${w} minggu menuju lomba: cukup waktu untuk adaptasi aerobik penuh (${MAF_FULL_WEEKS[0]}–${MAF_FULL_WEEKS[1]} minggu).`;
}

/**
 * Lini masa adaptasi MAF, target HR lomba, dan proyeksi pace/waktu lomba. Murni; tidak mengubah kurikulum.
 * Proyeksi adalah perkiraan kasar dari pace aerobik MAF, bukan prediksi pasti.
 */
export function mafRaceOutlook(params: MafRaceOutlookParams): MafRaceOutlook {
  const { mafPaceSecPerKm, maxHr, targetDistance, weeksRemaining } = params;
  const weeks = weeksRemaining != null && Number.isFinite(weeksRemaining) ? weeksRemaining : null;
  const raceHr = hrRange('race', maxHr);

  let projection: MafRaceProjection | null = null;
  if (mafPaceSecPerKm != null && Number.isFinite(mafPaceSecPerKm) && mafPaceSecPerKm > 0) {
    const paceNow = projectPace(mafPaceSecPerKm, targetDistance);
    let raceDay: MafRaceProjection['raceDay'] = null;
    if (weeks != null && weeks >= MAF_SIM_MIN_WEEKS) {
      // Blok 4 minggu penuh; dibatasi 24 minggu (batas atas adaptasi penuh) agar proyeksi tidak berlebihan.
      const blocks = Math.floor(Math.min(weeks, MAF_FULL_WEEKS[1]) / MAF_GAIN_BLOCK_WEEKS);
      const gain = blocks * MAF_GAIN_SEC_PER_BLOCK;
      const pace = projectPace(mafPaceSecPerKm - gain, targetDistance);
      raceDay = { gainSecPerKm: gain, pace, time: toTime(pace, targetDistance) };
    }
    projection = { paceNow, timeNow: toTime(paceNow, targetDistance), raceDay };
  }

  return {
    timeline: { earlyWeeks: MAF_EARLY_WEEKS, earlyGainSec: MAF_EARLY_GAIN_SEC, fullWeeks: MAF_FULL_WEEKS, weeksNote: weeksNote(weeks) },
    raceHr,
    splits: {
      km1: 'Km 1: terkendali, HR sedikit di atas MAF; jangan terpancing start cepat.',
      middle: raceHr ? `Km tengah: stabil di zona race (${raceHr[0]}–${raceHr[1]} bpm).` : 'Km tengah: stabil di zona race (90–95% HR maks).',
      finish: 'Km akhir: all-out, keluarkan semua sisa tenaga.',
    },
    projection,
  };
}
