import type { Workout } from './types.ts';
import { vdot } from './predictor.ts';
import { cardiacDrift, DAY_MS, efficiencyFactor } from './workload.ts';

export interface PeriodStats {
  sessions: number;
  totalKm: number;
  totalMin: number;
  sessionsPerWeek: number;
  easyAvgPaceSec: number | null;
  easyAvgHr: number | null;
  avgEf: number | null;
  avgCadence: number | null;
  avgDriftPct: number | null;
  easySharePct: number | null;
  qualitySharePct: number | null;
  longestKm: number;
  bestPaceSec: number | null;
  bestVdot: number | null;
}

export interface ProgressSeriesPoint {
  date: number;
  workoutType: Workout['workoutType'];
  distanceKm: number;
  easyPaceSec: number | null;
  ef: number | null;
  vdotScore: number | null;
  driftPct: number | null;
}

export interface ProgressComparison {
  days: number;
  current: PeriodStats;
  previous: PeriodStats;
  kmDeltaPct: number | null;
  efDeltaPct: number | null;
  easyPaceDeltaSec: number | null; // negatif = lebih cepat (membaik)
  hrDeltaBpm: number | null;       // negatif = detak jantung lebih hemat
  cadenceDeltaSpm: number | null;  // positif = langkah lebih efisien
  headline: string;
  intensityStatus: 'insufficient' | 'balanced' | 'too_hard' | 'base_building';
  intensityNote: string;
  series: ProgressSeriesPoint[];
}

/** Tipe sesi berintensitas rendah (aerobik santai). `WorkoutType` belum punya 'recovery'. */
const LOW_INTENSITY_TYPES = new Set<Workout['workoutType']>(['easy', 'long_run']);

const avg = (nums: number[]): number | null =>
  nums.length > 0 ? nums.reduce((sum, n) => sum + n, 0) / nums.length : null;

/** Ringkas sesi pada jendela waktu (startMs, endMs]. */
export function summarizeWindow(
  workouts: Workout[],
  startMs: number,
  endMs: number,
  windowDays: number,
): PeriodStats {
  const list = workouts.filter((w) => w.date > startMs && w.date <= endMs);
  const easyRuns = list.filter((w) => LOW_INTENSITY_TYPES.has(w.workoutType));

  const totalKm = list.reduce((s, w) => s + w.distanceKm, 0);
  const totalMin = list.reduce((s, w) => s + w.durationSec / 60, 0);
  const easyMin = easyRuns.reduce((s, w) => s + w.durationSec / 60, 0);

  const efVals = easyRuns
    .map((w) => w.efficiencyFactor ?? efficiencyFactor(w))
    .filter((v): v is number => v != null && Number.isFinite(v));

  const driftVals = easyRuns
    .map((w) => cardiacDrift(w.laps))
    .filter((v): v is number => v != null && Number.isFinite(v));

  const cadVals = list
    .map((w) => w.avgCadence)
    .filter((v): v is number => v != null && v > 0);

  const hrVals = easyRuns
    .map((w) => w.avgHr)
    .filter((v): v is number => v != null && v > 0);

  const vdotVals = list
    .filter((w) => w.distanceKm >= 3 && w.durationSec > 0)
    .map((w) => vdot(w.distanceKm * 1000, w.durationSec))
    .filter((v) => Number.isFinite(v) && v > 0);

  // Pace 0/tidak valid (data rusak) tidak boleh menjadi "pace tercepat".
  const paces = list.map((w) => w.avgPaceSecPerKm).filter((p) => Number.isFinite(p) && p > 0);

  const weeks = Math.max(1, windowDays / 7);
  const easySharePct = totalMin > 0 ? (easyMin / totalMin) * 100 : null;
  const qualitySharePct = easySharePct != null ? Math.max(0, 100 - easySharePct) : null;

  return {
    sessions: list.length,
    totalKm,
    totalMin,
    sessionsPerWeek: list.length / weeks,
    easyAvgPaceSec: avg(easyRuns.map((w) => w.avgPaceSecPerKm)),
    easyAvgHr: avg(hrVals),
    avgEf: avg(efVals),
    avgCadence: avg(cadVals),
    avgDriftPct: avg(driftVals),
    easySharePct,
    qualitySharePct,
    longestKm: list.reduce((m, w) => Math.max(m, w.distanceKm), 0),
    bestPaceSec: paces.length > 0 ? Math.min(...paces) : null,
    bestVdot: vdotVals.length > 0 ? Math.max(...vdotVals) : null,
  };
}

/** Bandingkan `days` hari terakhir dengan `days` hari sebelumnya. */
export function compareProgress(
  workouts: Workout[],
  now: number,
  days: number,
): ProgressComparison {
  const curStart = now - days * DAY_MS;
  const prevStart = curStart - days * DAY_MS;

  const current = summarizeWindow(workouts, curStart, now, days);
  const previous = summarizeWindow(workouts, prevStart, curStart, days);

  const kmDeltaPct =
    previous.totalKm > 0
      ? ((current.totalKm - previous.totalKm) / previous.totalKm) * 100
      : null;

  const efDeltaPct =
    current.avgEf != null && previous.avgEf != null && previous.avgEf > 0
      ? ((current.avgEf - previous.avgEf) / previous.avgEf) * 100
      : null;

  const easyPaceDeltaSec =
    current.easyAvgPaceSec != null && previous.easyAvgPaceSec != null
      ? current.easyAvgPaceSec - previous.easyAvgPaceSec
      : null;

  const hrDeltaBpm =
    current.easyAvgHr != null && previous.easyAvgHr != null
      ? current.easyAvgHr - previous.easyAvgHr
      : null;

  const cadenceDeltaSpm =
    current.avgCadence != null && previous.avgCadence != null
      ? current.avgCadence - previous.avgCadence
      : null;

  // Kesimpulan otomatis 1 kalimat
  let headline =
    current.sessions === 0
      ? `Belum ada sesi tercatat dalam ${days} hari terakhir.`
      : `Tercatat ${current.sessions} sesi (${current.totalKm.toFixed(1)} km) dalam ${days} hari terakhir.`;

  if (efDeltaPct != null && efDeltaPct >= 2) {
    const paceExtra =
      easyPaceDeltaSec != null && easyPaceDeltaSec <= -3
        ? ` — pace santai lebih cepat ${Math.abs(Math.round(easyPaceDeltaSec))} dtk/km`
        : '';
    headline = `Efisiensi aerobik naik +${efDeltaPct.toFixed(1)}% dibanding ${days} hari lalu${paceExtra}.`;
  } else if (easyPaceDeltaSec != null && easyPaceDeltaSec <= -4) {
    headline = `Pace lari santai lebih cepat ${Math.abs(Math.round(easyPaceDeltaSec))} dtk/km dibanding periode sebelumnya.`;
  } else if (kmDeltaPct != null && kmDeltaPct >= 10) {
    headline = `Volume jarak meningkat +${kmDeltaPct.toFixed(0)}% dengan konsistensi ${current.sessions} sesi.`;
  } else if (efDeltaPct != null && efDeltaPct <= -3) {
    headline = `Efisiensi aerobik turun ${Math.abs(efDeltaPct).toFixed(1)}% — perhatikan pemulihan dan cuaca lari.`;
  }

  // Evaluasi keseimbangan intensitas 80/20
  let intensityStatus: ProgressComparison['intensityStatus'] = 'insufficient';
  let intensityNote = 'Catat minimal 2 sesi untuk melihat proporsi lari santai vs. cepat.';

  if (current.sessions >= 2 && current.easySharePct != null) {
    if (current.easySharePct >= 75 && current.easySharePct <= 92) {
      intensityStatus = 'balanced';
      intensityNote = 'Ideal — mayoritas waktu di zona aerobik santai sehingga pemulihan tetap terjaga.';
    } else if (current.easySharePct < 75) {
      intensityStatus = 'too_hard';
      intensityNote = 'Porsi lari cepat cukup tinggi — tambahkan Easy Run agar tidak kelelahan menumpuk.';
    } else {
      intensityStatus = 'base_building';
      intensityNote = 'Fokus penuh membangun fondasi aerobik dasar (sangat baik di fase awal program).';
    }
  }

  // Deret data titik per sesi pada periode aktif untuk grafik tren
  const series: ProgressSeriesPoint[] = workouts
    .filter((w) => w.date > curStart && w.date <= now)
    .sort((a, b) => a.date - b.date)
    .map((w) => {
      const isLow = LOW_INTENSITY_TYPES.has(w.workoutType);
      return {
        date: w.date,
        workoutType: w.workoutType,
        distanceKm: w.distanceKm,
        easyPaceSec: isLow ? w.avgPaceSecPerKm : null,
        ef: isLow ? (w.efficiencyFactor ?? efficiencyFactor(w)) : null,
        vdotScore: w.distanceKm >= 3 && w.durationSec > 0 ? vdot(w.distanceKm * 1000, w.durationSec) : null,
        driftPct: isLow ? cardiacDrift(w.laps) : null,
      };
    });

  return {
    days,
    current,
    previous,
    kmDeltaPct,
    efDeltaPct,
    easyPaceDeltaSec,
    hrDeltaBpm,
    cadenceDeltaSpm,
    headline,
    intensityStatus,
    intensityNote,
    series,
  };
}
