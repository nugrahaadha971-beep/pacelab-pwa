import type { RaceDistance, Source, Workout, WorkoutType } from '../analytics/types';

const DAY = 86_400_000;
export type DistFilter = 'all' | RaceDistance;
export type SourceFilter = 'all' | Source;
export type TypeFilter = 'all' | WorkoutType;
export interface HistoryFilter { q: string; dist: DistFilter; source: SourceFilter; type?: TypeFilter }
type RaceTable = Record<RaceDistance, number>;

/** Kelompokkan jarak ke jarak lomba terdekat bila selisihnya ≤ 10%. */
export function distanceBucket(km: number, table: RaceTable): RaceDistance | null {
  const hit = (Object.keys(table) as RaceDistance[]).find((d) => Math.abs(km - table[d]) / table[d] <= 0.1);
  return hit ?? null;
}

/** Cari di catatan dan jenis sesi; filter jarak, sumber data, dan jenis sesi. */
export function filterWorkouts(ws: Workout[], f: HistoryFilter, table: RaceTable): Workout[] {
  const q = f.q.trim().toLowerCase();
  return ws.filter((w) =>
    (f.dist === 'all' || distanceBucket(w.distanceKm, table) === f.dist) &&
    (f.source === 'all' || w.source === f.source) &&
    (f.type === undefined || f.type === 'all' || w.workoutType === f.type) &&
    (q === '' || `${w.note ?? ''} ${w.workoutType}`.toLowerCase().includes(q)));
}

/** Volume per minggu untuk `weeks` minggu terakhir, urutan lama → baru. */
export function weeklyKm(ws: Workout[], now: number, weeks: number) {
  return Array.from({ length: weeks }, (_, i) => {
    const end = now - (weeks - 1 - i) * 7 * DAY;
    const start = end - 7 * DAY;
    const km = ws.filter((w) => w.date > start && w.date <= end).reduce((s, w) => s + w.distanceKm, 0);
    return { label: `M${i + 1}`, km: Number(km.toFixed(1)) };
  });
}
