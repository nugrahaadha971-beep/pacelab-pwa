import { db } from './database';
import { finalizeWorkout } from '../analytics/workload';
import type { UserProfile, Workout, WorkoutType } from '../analytics/types';

export interface WorkoutEdit {
  date: number;
  distanceKm: number;
  durationSec: number;
  rpe: number | null;
  workoutType: WorkoutType;
  note: string;
  shoeId?: string;
}

export async function editWorkout(
  w: Workout,
  e: WorkoutEdit,
  profile: UserProfile,
): Promise<Workout> {
  if (w.id == null) throw new Error('Sesi tidak punya id.');
  if (!Number.isFinite(e.date) || e.date <= 0) throw new Error('Tanggal sesi tidak valid.');
  if (!Number.isFinite(e.distanceKm) || e.distanceKm <= 0 || e.distanceKm > 300) {
    throw new Error('Jarak harus antara 0 dan 300 km.');
  }
  if (!Number.isFinite(e.durationSec) || e.durationSec <= 0) {
    throw new Error('Durasi harus lebih dari 0.');
  }
  const pace = e.durationSec / e.distanceKm;
  if (pace < 120 || pace > 1200) {
    throw new Error('Pace tidak masuk akal (harus 2:00–20:00 /km).');
  }
  if (w.source !== 'manual' && (e.distanceKm !== w.distanceKm || e.durationSec !== w.durationSec)) {
    throw new Error('Jarak dan durasi sesi impor tidak dapat diubah.');
  }
  if (e.rpe != null && (!Number.isInteger(e.rpe) || e.rpe < 1 || e.rpe > 10)) {
    throw new Error('Skala RPE harus antara 1 sampai 10.');
  }
  const { id: _id, trimp: _t, efficiencyFactor: _ef, ...draft } = w;
  const next = finalizeWorkout(
    {
      ...draft,
      date: e.date,
      distanceKm: e.distanceKm,
      durationSec: Math.round(e.durationSec),
      rpe: e.rpe,
      workoutType: e.workoutType,
      note: e.note.trim() || undefined,
      shoeId: e.shoeId || undefined,
      avgPaceSecPerKm: pace,
    },
    profile,
  );
  const updated: Workout = { ...next, id: w.id };
  await db.workouts.put(updated);
  return updated;
}
