import type { RaceDistance, Source, UserProfile, Workout, WorkoutType } from '../analytics/types';
import { normalizeScheduleState } from '../plans/schedule.ts';
import type { ScheduleState } from '../plans/schedule.ts';

const SOURCES: readonly string[] = ['fit', 'gpx', 'manual'];
const TYPES: readonly string[] = ['easy', 'tempo', 'interval', 'long_run', 'race'];
const DISTANCES: readonly string[] = ['5K', '10K', '21.1K', '42.2K'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Validasi + normalisasi satu sesi dari cadangan. Mengembalikan null bila tidak layak dipakai. */
export function normalizeWorkout(raw: unknown): Workout | null {
  if (!isObj(raw)) return null;
  if (!pos(raw.date) || !pos(raw.distanceKm) || !pos(raw.durationSec)) return null;
  if (typeof raw.source !== 'string' || !SOURCES.includes(raw.source)) return null;
  if (typeof raw.workoutType !== 'string' || !TYPES.includes(raw.workoutType)) return null;

  const laps: Workout['laps'] = [];
  if (Array.isArray(raw.laps)) {
    for (const l of raw.laps) {
      if (isObj(l) && pos(l.km) && pos(l.paceSec)) laps.push({ km: l.km, paceSec: l.paceSec, avgHr: numOrNull(l.avgHr) });
    }
  }

  return {
    date: raw.date,
    source: raw.source as Source,
    workoutType: raw.workoutType as WorkoutType,
    distanceKm: raw.distanceKm,
    durationSec: raw.durationSec,
    avgPaceSecPerKm: pos(raw.avgPaceSecPerKm) ? raw.avgPaceSecPerKm : raw.durationSec / raw.distanceKm,
    avgHr: numOrNull(raw.avgHr),
    maxHr: numOrNull(raw.maxHr),
    avgCadence: numOrNull(raw.avgCadence),
    elevationGain: numOrNull(raw.elevationGain),
    rpe: numOrNull(raw.rpe),
    trimp: numOrNull(raw.trimp),
    efficiencyFactor: numOrNull(raw.efficiencyFactor),
    laps,
    ...(typeof raw.note === 'string' && raw.note ? { note: raw.note } : {}),
  };
}

export function normalizeProfile(raw: unknown): UserProfile | null {
  if (!isObj(raw)) return null;
  if (!pos(raw.age) || !pos(raw.restingHr) || !pos(raw.maxHr) || raw.maxHr <= raw.restingHr) return null;
  if (typeof raw.targetDistance !== 'string' || !DISTANCES.includes(raw.targetDistance)) return null;
  if (!pos(raw.targetTimeSec)) return null;
  return {
    id: 'default',
    age: raw.age,
    restingHr: raw.restingHr,
    maxHr: raw.maxHr,
    targetDistance: raw.targetDistance as RaceDistance,
    targetRaceDate: typeof raw.targetRaceDate === 'number' && Number.isFinite(raw.targetRaceDate) ? raw.targetRaceDate : 0,
    targetTimeSec: raw.targetTimeSec,
    ...(pos(raw.weeklyTargetKm) ? { weeklyTargetKm: raw.weeklyTargetKm } : {}),
  };
}

export interface ParsedBackup { workouts: Workout[]; profile: UserProfile | null; skipped: number; schedule: ScheduleState | null }

export function parseBackup(data: unknown): ParsedBackup {
  if (!isObj(data) || data.app !== 'pacelab' || !Array.isArray(data.workouts)) {
    throw new Error('Berkas cadangan tidak valid.');
  }
  const workouts: Workout[] = [];
  let skipped = 0;
  for (const raw of data.workouts) {
    const w = normalizeWorkout(raw);
    if (w) workouts.push(w);
    else skipped++;
  }
  const rawProfile = Array.isArray(data.userProfile) ? data.userProfile[0] : data.userProfile;
  return { workouts, profile: normalizeProfile(rawProfile), skipped, schedule: normalizeScheduleState(data.schedule) };
}

type Key = Pick<Workout, 'date' | 'distanceKm'>;

/** Sesi dianggap sama bila mulainya berselisih ≤ 2 menit dan jaraknya ≤ 0,1 km (FIT dan GPX dari lari yang sama). */
export function isDuplicate(existing: Key[], d: Key): boolean {
  return existing.some((w) => Math.abs(w.date - d.date) <= 120_000 && Math.abs(w.distanceKm - d.distanceKm) <= 0.1);
}
