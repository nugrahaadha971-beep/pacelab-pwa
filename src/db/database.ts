import Dexie, { type Table } from 'dexie';
import type { UserProfile, Workout } from '../analytics/types';
import { parseBackup } from './validate';
import { loadScheduleState, saveScheduleState, SCHEDULE_KEY } from '../plans/scheduleStore.ts';

class PacelabDB extends Dexie {
  workouts!: Table<Workout, number>;
  userProfile!: Table<UserProfile, string>;

  constructor() {
    super('pacelab');
    this.version(1).stores({
      workouts: '++id, date, source, workoutType',
      userProfile: 'id',
    });
  }
}

export const db = new PacelabDB();

export async function exportBackup(): Promise<string> {
  const [workouts, profiles] = await Promise.all([db.workouts.toArray(), db.userProfile.toArray()]);
  return JSON.stringify({ app: 'pacelab', version: 2, exportedAt: Date.now(), workouts, userProfile: profiles, schedule: loadScheduleState() }, null, 2);
}

/** Mengganti seluruh sesi dengan isi cadangan. Profil lama dipertahankan bila cadangan tidak memuat profil yang valid. */
export async function importBackup(json: string): Promise<{ workouts: number; skipped: number; profile: boolean; schedule: boolean }> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Berkas bukan JSON yang valid.');
  }
  const { workouts, profile, skipped, schedule } = parseBackup(data);
  await db.transaction('rw', db.workouts, db.userProfile, async () => {
    await db.workouts.clear();
    if (workouts.length) await db.workouts.bulkAdd(workouts);
    if (profile) await db.userProfile.put(profile);
  });
  if (schedule) saveScheduleState(schedule);
  return { workouts: workouts.length, skipped, profile: profile !== null, schedule: schedule !== null };
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', db.workouts, db.userProfile, async () => {
    await db.workouts.clear();
    await db.userProfile.clear();
  });
  try { localStorage.removeItem(SCHEDULE_KEY); } catch { /* abaikan */ }
}
