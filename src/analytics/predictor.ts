import type { Workout, RaceDistance } from './types';

export const RACE_KM = { '5K': 5, '10K': 10, '21.1K': 21.0975, '42.2K': 42.195 } as const;

const DAY_MS = 86_400_000;
const RIEGEL_EXP = 1.06;
const BEST_WINDOW_DAYS = 42;
const LOAD_WINDOW_DAYS = 28;
const MIN_BASE_KM = 5;
// ASUMSI: blueprint tidak menetapkan besaran penalti; konstanta ini bisa disetel.
const VOLUME_PENALTY_MAX = 0.12;
const LONGRUN_PENALTY_MAX = 0.08;

/**
 * Ambang penalti. Blueprint menyebut ambang 10K (25 km), tetapi teks penalti hanya
 * untuk 21,1K dan 42,2K, sehingga 10K sengaja tidak dikenai penalti.
 * 18 km untuk 21,1K adalah ASUMSI (blueprint hanya menyebut 30 km untuk marathon).
 */
export const PENALTY_RULES: Partial<Record<RaceDistance, { weeklyKm: number; longRunKm: number }>> = {
  '21.1K': { weeklyKm: 45, longRunKm: 18 },
  '42.2K': { weeklyKm: 65, longRunKm: 30 },
};

/** Riegel: T2 = T1 × (D2 / D1)^1,06 */
export function riegelProject(t1Sec: number, d1Km: number, d2Km: number): number {
  return t1Sec * Math.pow(d2Km / d1Km, RIEGEL_EXP);
}

export function penaltyPct(target: RaceDistance, workouts: Workout[], now: number): number {
  const rule = PENALTY_RULES[target];
  if (!rule) return 0;
  const load = workouts.filter((w) => w.date > now - LOAD_WINDOW_DAYS * DAY_MS && w.date <= now);
  const weeklyKm = load.reduce((s, w) => s + w.distanceKm, 0) / (LOAD_WINDOW_DAYS / 7);
  const longRunKm = load
    .filter((w) => w.workoutType === 'long_run')
    .reduce((m, w) => Math.max(m, w.distanceKm), 0);
  const volShort = Math.max(0, 1 - weeklyKm / rule.weeklyKm);
  const lrShort = Math.max(0, 1 - longRunKm / rule.longRunKm);
  return VOLUME_PENALTY_MAX * volShort + LONGRUN_PENALTY_MAX * lrShort;
}

export interface Prediction {
  distance: RaceDistance;
  baseSec: number;
  penaltyPct: number;
  finalSec: number;
  basisDate: number;
}

/**
 * Basis Riegel = sesi ≥ 5 km dalam 42 hari terakhir yang memberi proyeksi tercepat.
 * Penalti daya tahan diterapkan setelahnya.
 */
export function predictAll(workouts: Workout[], now: number): Record<RaceDistance, Prediction | null> {
  const basis = workouts.filter(
    (w) => w.date > now - BEST_WINDOW_DAYS * DAY_MS && w.date <= now && w.distanceKm >= MIN_BASE_KM && w.durationSec > 0,
  );
  const out = {} as Record<RaceDistance, Prediction | null>;
  for (const d of Object.keys(RACE_KM) as RaceDistance[]) {
    let best: { t: number; date: number } | null = null;
    for (const w of basis) {
      const t = riegelProject(w.durationSec, w.distanceKm, RACE_KM[d]);
      if (best === null || t < best.t) best = { t, date: w.date };
    }
    if (best === null) {
      out[d] = null;
      continue;
    }
    const pen = penaltyPct(d, workouts, now);
    out[d] = { distance: d, baseSec: best.t, penaltyPct: pen, finalSec: best.t * (1 + pen), basisDate: best.date };
  }
  return out;
}

/** Titik tengah rentang %VO2max Daniels: 59–74, 75–84, 83–88, 95–100. */
export const ZONE_FRACTION = { easy: 0.665, marathon: 0.795, threshold: 0.855, interval: 0.975 } as const;

/** VDOT (Daniels): VO2 = −4,60 + 0,182258·v + 0,000104·v²; dibagi % VO2max menurut durasi t (menit). */
export function vdot(distanceM: number, timeSec: number): number {
  const t = timeSec / 60;
  const v = distanceM / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pct;
}

/** Kecepatan (m/menit) yang menghasilkan VO2 = fraction × VDOT (selesaikan persamaan kuadrat). */
export function velocityFor(V: number, fraction: number): number {
  const a = 0.000104, b = 0.182258;
  return (-b + Math.sqrt(b * b + 4 * a * (4.6 + fraction * V))) / (2 * a);
}

/** VDOT terbaik dari sesi ≥ 3 km dalam 42 hari terakhir. */
export function currentVdot(workouts: Workout[], now: number): number | null {
  const vals = workouts
    .filter((w) => w.date > now - BEST_WINDOW_DAYS * DAY_MS && w.date <= now && w.distanceKm >= 3 && w.durationSec > 0)
    .map((w) => vdot(w.distanceKm * 1000, w.durationSec));
  return vals.length ? Math.max(...vals) : null;
}
