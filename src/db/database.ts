import Dexie, { type Table } from 'dexie';
import type { UserProfile, Workout } from '../analytics/types';
import { mergeWorkouts, parseBackup, PREF_KEYS } from './validate';
import { ALL_LOCAL_KEYS } from './localKeys';
import { loadScheduleState, saveScheduleState } from '../plans/scheduleStore.ts';

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

export type ImportMode = 'replace' | 'merge';

function readPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PREF_KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v != null) out[k] = v;
    } catch {
      /* abaikan */
    }
  }
  return out;
}

export async function exportBackup(): Promise<string> {
  const [workouts, profiles] = await Promise.all([db.workouts.toArray(), db.userProfile.toArray()]);
  return JSON.stringify(
    {
      app: 'pacelab',
      version: 3,
      exportedAt: Date.now(),
      workouts,
      userProfile: profiles,
      schedule: loadScheduleState(),
      prefs: readPrefs(),
    },
    null,
    2,
  );
}

/** Memulihkan cadangan dalam mode 'replace' (ganti semua) atau 'merge' (gabung sesi tanpa duplikat). */
export async function importBackup(
  json: string,
  mode: ImportMode = 'replace',
): Promise<{ workouts: number; skipped: number; profile: boolean; schedule: boolean; prefs: boolean }> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Berkas bukan JSON yang valid.');
  }
  const { workouts, profile, skipped, schedule, prefs } = parseBackup(data);
  let added = workouts.length;
  let profileRestored = false;

  await db.transaction('rw', db.workouts, db.userProfile, async () => {
    if (mode === 'replace') {
      await db.workouts.clear();
      if (workouts.length) await db.workouts.bulkAdd(workouts);
      if (profile) {
        await db.userProfile.put(profile);
        profileRestored = true;
      }
    } else {
      const existing = await db.workouts.toArray();
      const fresh = mergeWorkouts(existing, workouts);
      if (fresh.length) await db.workouts.bulkAdd(fresh);
      added = fresh.length;
      if (profile && !(await db.userProfile.get('default'))) {
        await db.userProfile.put(profile);
        profileRestored = true;
      }
    }
  });

  const scheduleApplied = mode === 'replace' && schedule !== null;
  if (scheduleApplied && schedule) saveScheduleState(schedule);

  const prefsApplied = mode === 'replace' && prefs !== null;
  if (prefsApplied && prefs) {
    for (const [k, v] of Object.entries(prefs)) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* abaikan */
      }
    }
  }

  return {
    workouts: added,
    skipped,
    profile: profileRestored,
    schedule: scheduleApplied,
    prefs: prefsApplied,
  };
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', db.workouts, db.userProfile, async () => {
    await db.workouts.clear();
    await db.userProfile.clear();
  });
  for (const k of ALL_LOCAL_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* abaikan */
    }
  }
}
