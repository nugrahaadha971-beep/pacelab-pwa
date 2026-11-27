import type { Workout, UserProfile, WorkoutDraft, LapSplit, Sex } from './types';

export const DAY_MS = 86_400_000;
export const EF_IMPROVEMENT_PCT = 2;
const AEROBIC: readonly string[] = ['easy', 'long_run'];
const TRIMP_COEF = {
  male: { a: 0.64, b: 1.92 },
  female: { a: 0.86, b: 1.67 },
} as const;

type HrProfile = Pick<UserProfile, 'restingHr' | 'maxHr'> & { sex?: Sex };

/** Tanaka et al. (2001): 208 − 0,7 × usia */
export function tanakaMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

/** Banister TRIMP: pria (0,64 / 1,92), wanita (0,86 / 1,67); default 'male'. */
export function banisterTrimp(
  durationMin: number,
  avgHr: number,
  restingHr: number,
  maxHr: number,
  sex: Sex = 'male',
): number {
  const { a, b } = TRIMP_COEF[sex];
  const dhr = Math.min(1, Math.max(0, (avgHr - restingHr) / (maxHr - restingHr)));
  return durationMin * dhr * a * Math.exp(b * dhr);
}

/** Banister bila ada HR; Session-RPE (durasi × RPE) bila tidak. */
export function sessionTrimp(w: Pick<Workout, 'durationSec' | 'avgHr' | 'rpe'>, p: HrProfile): number {
  const min = w.durationSec / 60;
  if (w.avgHr != null && p.maxHr > p.restingHr) return banisterTrimp(min, w.avgHr, p.restingHr, p.maxHr, p.sex);
  if (w.rpe != null) return min * w.rpe;
  return 0;
}

/** Efficiency Factor = kecepatan (m/menit) ÷ rata-rata HR */
export function efficiencyFactor(w: Pick<Workout, 'distanceKm' | 'durationSec' | 'avgHr'>): number | null {
  if (w.avgHr == null || w.avgHr <= 0 || w.durationSec <= 0) return null;
  const speedMPerMin = (w.distanceKm * 1000) / (w.durationSec / 60);
  return speedMPerMin / w.avgHr;
}

export function finalizeWorkout(draft: WorkoutDraft, p: HrProfile | null): Workout {
  return {
    ...draft,
    trimp: p ? sessionTrimp(draft, p) : null,
    efficiencyFactor: efficiencyFactor(draft),
  };
}

export type AcwrStatus = 'unknown' | 'undertraining' | 'sweet_spot' | 'high_fatigue';
export interface Acwr { acute: number; chronicWeekly: number; ratio: number | null; status: AcwrStatus }

export const ACWR_MIN_HISTORY_DAYS = 14;

export function acwrHistoryDays(workouts: Workout[], now: number): number {
  const first = workouts.filter((w) => w.date <= now).reduce((m, w) => Math.min(m, w.date), Infinity);
  return Number.isFinite(first) ? Math.floor((now - first) / DAY_MS) + 1 : 0;
}

/**
 * ACWR = beban 7 hari ÷ rata-rata mingguan dari riwayat yang tersedia (maks 28 hari / 4 minggu).
 * Pengguna dengan riwayat < 14 hari berstatus 'unknown' agar tidak dinilai kelelahan semu.
 */
export function acwr(workouts: Workout[], p: HrProfile, now: number): Acwr {
  const past = workouts.filter((w) => w.date <= now);
  const sumDays = (days: number) =>
    past.filter((w) => w.date > now - days * DAY_MS).reduce((s, w) => s + sessionTrimp(w, p), 0);
  const acute = sumDays(7);
  const firstDate = past.reduce((m, w) => Math.min(m, w.date), Infinity);
  // +1: hari pertama dihitung (28 sesi harian = tepat 4 minggu).
  const historyDays = Number.isFinite(firstDate) ? (now - firstDate) / DAY_MS + 1 : 0;
  const weeks = Math.min(4, historyDays / 7);
  const chronicWeekly = weeks > 0 ? sumDays(28) / weeks : 0;
  if (chronicWeekly <= 0 || historyDays < ACWR_MIN_HISTORY_DAYS) {
    return { acute, chronicWeekly, ratio: null, status: 'unknown' };
  }
  const ratio = acute / chronicWeekly;
  const status: AcwrStatus = ratio < 0.8 ? 'undertraining' : ratio <= 1.3 ? 'sweet_spot' : 'high_fatigue';
  return { acute, chronicWeekly, ratio, status };
}

export interface EfTrend { recent: number | null; prior: number | null; changePct: number | null; improving: boolean }

/** Rata-rata EF 14 hari terakhir vs 14 hari sebelumnya, hanya sesi aerobik. */
export function efTrend(workouts: Workout[], now: number): EfTrend {
  const avg = (fromDays: number, toDays: number) => {
    const vals = workouts
      .filter((w) => AEROBIC.includes(w.workoutType) && w.date > now - fromDays * DAY_MS && w.date <= now - toDays * DAY_MS)
      .map((w) => w.efficiencyFactor ?? efficiencyFactor(w))
      .filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const recent = avg(14, 0);
  const prior = avg(28, 14);
  if (recent == null || prior == null || prior <= 0) return { recent, prior, changePct: null, improving: false };
  const changePct = ((recent - prior) / prior) * 100;
  return { recent, prior, changePct, improving: changePct >= EF_IMPROVEMENT_PCT };
}

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

/**
 * Cardiac drift = penurunan EF antara paruh pertama dan kedua lap (aerobic decoupling).
 * Positif = efisiensi turun. Butuh minimal 4 lap dengan HR.
 */
export function cardiacDrift(laps: LapSplit[]): number | null {
  const u = laps.filter((l): l is LapSplit & { avgHr: number } => l.avgHr != null && l.paceSec > 0);
  if (u.length < 4) return null;
  const h = Math.floor(u.length / 2);
  const ef = (ls: typeof u) => (60000 / avg(ls.map((l) => l.paceSec))) / avg(ls.map((l) => l.avgHr));
  const e1 = ef(u.slice(0, h)), e2 = ef(u.slice(h));
  return ((e1 - e2) / e1) * 100;
}

const STEADY: readonly string[] = ['easy', 'long_run'];

/** Hitung cardiac drift hanya untuk sesi aerobik stabil (Easy & Long Run). */
export function steadyDrift(w: Pick<Workout, 'workoutType' | 'laps'>): number | null {
  return STEADY.includes(w.workoutType) ? cardiacDrift(w.laps) : null;
}
