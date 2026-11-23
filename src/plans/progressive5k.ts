// Kurikulum Progresif 5K (Lari-Jalan & HR-First), 11 minggu. L = lari, J = jalan.
// Data murni; penjadwalan dan skala mengikuti weeksRemaining ada di schedule.ts.
import type { SessionKind } from './nike5k.ts';
import type { Zone } from './hrZones.ts';

export type TestKind = '3k' | '5k' | 'maf';

export interface TemplateSession {
  kind: SessionKind;
  name: string;
  steps: string[];
  zone: Zone;
  /** Total menit termasuk strides, tanpa pemanasan/pendinginan jalan 5' (interval/tes: sudah termasuk 10'+10'). */
  durationMin: number;
  test?: TestKind;
  /** Jarak ulangan (km) untuk sesi interval; dipakai kalibrasi pace dari Tes 3K. */
  repKm?: number;
  /** Hari tetap (0 = Min … 6 = Sab); tes selalu Sabtu. */
  fixedWeekday?: number;
}
export interface TemplateWeek { title: string; deload?: boolean; sessions: TemplateSession[] }

const SAT = 6;
const WARM = "Pemanasan: 5' jalan cepat + drill ringan";
const COOL = "Pendinginan: 5' jalan";
const WARM10 = "Pemanasan: 10' (jalan cepat + lari mudah + 2 strides)";
const COOL10 = "Pendinginan: 10' jalan";
/** ASUMSI: pace nominal untuk memperkirakan total durasi sesi interval/tes (bukan target pace). */
const NOMINAL_INTERVAL_SEC_KM = 480;
const NOMINAL_TEST3K_SEC_KM = 540;
const NOMINAL_TEST5K_SEC_KM = 520;

const dec = (x: number) => String(x).replace('.', ',');
const repLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${dec(km)} km`);
const STRIDES = (n: number) => `Strides: ${n} × (20" cepat rileks / 40" jalan). HR boleh diabaikan (terlalu singkat).`;

/** n×(run' L / walk' J). */
const walkRunReps = (reps: number, run: number, walk: number, kind: SessionKind = 'recovery'): TemplateSession => ({
  kind, zone: 'easy', durationMin: reps * (run + walk), name: `${reps}×(${run}' Lari / ${walk}' Jalan)`,
  steps: [WARM, `Ulangi ${reps} kali: lari pelan ${run} menit, lalu jalan ${walk} menit.`, COOL],
});
/** total' (run' L / walk' J) diulang sampai total menit tercapai. */
const walkRunTotal = (total: number, run: number, walk: number, kind: SessionKind = 'recovery'): TemplateSession => ({
  kind, zone: 'easy', durationMin: total, name: `${total}' (${run}' Lari / ${walk}' Jalan)`,
  steps: [WARM, `Lari pelan ${run} menit, jalan ${walk} menit; ulangi sampai total ${total} menit.`, COOL],
});
const continuous = (min: number): TemplateSession => ({
  kind: 'recovery', zone: 'easy', durationMin: min, name: `${min}' lari kontinu (mudah)`,
  steps: [WARM, `Lari terus ${min} menit dengan pelan. Jalan hanya jika HR melewati batas atas zona mudah atau Anda tidak bisa bicara kalimat penuh.`, COOL],
});
const easy = (min: number, strides = 0, kind: SessionKind = 'recovery', label = 'mudah'): TemplateSession => ({
  kind, zone: 'easy', durationMin: min + strides, name: strides ? `${min}' ${label} + ${strides} strides` : `${min}' ${label}`,
  steps: strides ? [WARM, `Lari ${label} ${min} menit (bisa bicara kalimat penuh).`, STRIDES(strides), COOL] : [WARM, `Lari ${label} ${min} menit (bisa bicara kalimat penuh).`, COOL],
});
const reps = (n: number, km: number, rest: number, zone: 'interval' | 'race'): TemplateSession => ({
  kind: 'speed', zone, repKm: km,
  durationMin: Math.round(20 + (n * km * NOMINAL_INTERVAL_SEC_KM) / 60 + (n - 1) * rest),
  name: `${n}×${repLabel(km)}${zone === 'race' ? ' pace race' : ''}, jalan ${dec(rest)}'`,
  steps: [WARM10, `${n} × ${repLabel(km)} ${zone === 'race' ? 'di pace race (kecepatan target hari lomba)' : 'keras terkontrol'}; jalan ${dec(rest)} menit di antara ulangan.`, COOL10],
});
const test = (which: '3k' | '5k'): TemplateSession => ({
  kind: 'speed', zone: 'test', test: which, fixedWeekday: SAT,
  durationMin: Math.round(20 + (which === '3k' ? 3 * NOMINAL_TEST3K_SEC_KM : 5 * NOMINAL_TEST5K_SEC_KM) / 60),
  name: which === '3k' ? 'Tes 3K' : 'Tes 5K',
  steps: [WARM10, which === '3k' ? 'Lari 3 km keras tapi stabil: sekuat yang bisa dijaga sampai garis akhir.' : 'Lari 5 km sekeras yang bisa dijaga sampai garis akhir.', COOL10],
});

export const PROGRESSIVE_5K: TemplateWeek[] = [
  { title: 'Fondasi Lari-Jalan', sessions: [walkRunReps(6, 3, 1), walkRunTotal(25, 4, 1), walkRunTotal(25, 4, 1), walkRunTotal(40, 5, 1, 'long')] },
  { title: 'Fondasi Lari-Jalan', sessions: [walkRunReps(5, 5, 1), walkRunTotal(30, 6, 1), walkRunTotal(25, 5, 1), walkRunTotal(45, 6, 1, 'long')] },
  // Long Run 51' (bukan 50'): selisih ≥ 15 menit dari sesi Easy terpanjang minggu ini (3×(10'L/2'J) = 36').
  { title: 'Fondasi Lari-Jalan', sessions: [walkRunReps(3, 10, 2), walkRunTotal(30, 10, 1), walkRunTotal(25, 8, 1), walkRunTotal(51, 10, 1, 'long')] },
  { title: 'Fondasi · Ringan + Tes 3K', deload: true, sessions: [easy(20, 4), walkRunTotal(25, 10, 1), test('3k'), easy(30, 0, 'long')] },
  { title: 'Kecepatan & Daya Tahan', sessions: [reps(6, 0.4, 2, 'interval'), continuous(30), easy(25, 4), easy(55, 0, 'long')] },
  { title: 'Kecepatan & Daya Tahan', sessions: [reps(5, 0.6, 2, 'interval'), continuous(30), easy(30, 4), easy(60, 0, 'long')] },
  { title: 'Kecepatan & Daya Tahan', sessions: [reps(4, 0.8, 2.5, 'interval'), continuous(35), easy(30, 4), easy(65, 0, 'long')] },
  { title: 'Kecepatan · Ringan + Tes 5K', deload: true, sessions: [reps(4, 0.4, 2, 'interval'), easy(25), test('5k'), easy(30, 0, 'long')] },
  { title: 'Spesifik Lomba', sessions: [reps(3, 1, 2.5, 'race'), easy(30), easy(25, 4), easy(70, 0, 'long')] },
  { title: 'Spesifik Lomba', sessions: [reps(2, 1.6, 3, 'race'), easy(30), easy(25, 4), easy(60, 0, 'long')] },
  { title: 'Taper & Lomba', sessions: [reps(3, 0.8, 2, 'race'), easy(20, 4), easy(15, 3)] },
];

export const PROGRESSIVE_RACE_STEPS = [
  'Km 1 sengaja 5–10 detik lebih lambat dari pace target, km 2–4 stabil, km 5 keluarkan sisa tenaga.',
  'Pakai sepatu yang sudah dipakai latihan, makan karbohidrat cukup 2 hari sebelumnya, dan start sepagi mungkin.',
];

export const STRENGTH_NOTE = {
  title: 'Hari istirahat: penguatan 15–20 menit (opsional)',
  moves: ['Squat', 'Lunge', 'Calf raise satu kaki (berdiri)', 'Core berdiri / plank dinding'],
  how: '2–3 set × 10–12 pengulangan. Berhenti bila nyeri tajam, pusing, atau nyeri dada.',
};
