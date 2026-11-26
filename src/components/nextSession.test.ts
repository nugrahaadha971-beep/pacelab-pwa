import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { UserProfile, Workout } from '../analytics/types.ts';
import { DAY_MS } from '../analytics/workload.ts';
import { addCustomSession, applyPresetTemplate, DEFAULT_SCHEDULE_STATE, isoFromLocal } from '../plans/schedule.ts';
import { saveScheduleState } from '../plans/scheduleStore.ts';
import { nextSession } from './nextSession.ts';

// localStorage tiruan: lingkungan tes Node tidak punya penyimpanan browser.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

const NOW = Date.now();
const TODAY = isoFromLocal(NOW);

const profile = (age: number, targetRaceDate = NOW + 70 * DAY_MS): UserProfile => ({
  id: 'default',
  age,
  restingHr: 55,
  maxHr: 180,
  targetDistance: '5K',
  targetRaceDate,
  targetTimeSec: 1500,
});

const run = (daysAgo: number, o: Partial<Workout> = {}): Workout => ({
  date: NOW - daysAgo * DAY_MS,
  source: 'manual',
  workoutType: 'easy',
  distanceKm: 4,
  durationSec: 2480,
  avgPaceSecPerKm: 620,
  avgHr: 138,
  maxHr: 150,
  avgCadence: null,
  elevationGain: null,
  rpe: null,
  laps: [],
  ...o,
});

beforeEach(() => store.clear());

test('jadwal kalender dasar tanpa planMode menghasilkan sesi berikutnya dan rentang HR dari maxHr/usia', () => {
  const n = nextSession(profile(40), [], NOW);
  assert.ok(n);
  assert.ok(n.session.kind === 'recovery' || n.session.kind === 'long' || n.session.kind === 'race');
  assert.deepEqual(n.hr, [128, 148], 'HR zona mudah 71–82% dari maxHr 180');
  if (n.session.kind === 'recovery' || n.session.kind === 'long') {
    assert.notEqual(n.paceText, null);
  }
});

test('sesi kustom pengguna diprioritaskan pada tanggal hari ini dengan HR, pace, dan durasi sesuai input', () => {
  const st = addCustomSession(DEFAULT_SCHEDULE_STATE, {
    date: TODAY,
    kind: 'speed',
    name: 'Tempo Kustom Hari Ini',
    durationMin: 38,
    distanceKm: 6,
    hr: [155, 168],
    pace: [265, 285],
  });
  saveScheduleState(st);

  // Beban 4 minggu seimbang agar ACWR tetap di zona sweet_spot (tidak memicu penyesuaian high_load)
  const balanced = [run(2), run(9), run(16), run(23)];
  const n = nextSession(profile(35), balanced, NOW);
  assert.ok(n);
  assert.equal(n.isToday, true);
  assert.equal(n.dayLabel, 'Hari ini');
  assert.equal(n.session.name, 'Tempo Kustom Hari Ini');
  assert.deepEqual(n.hr, [155, 168]);
  assert.equal(n.paceText, '4:25–4:45 /km');
  assert.equal(n.durationMin, 38);
});

test('mode customOnly kosong mengembalikan null agar Beranda mengarahkan ke tab Program', () => {
  const emptySt = applyPresetTemplate(DEFAULT_SCHEDULE_STATE, 'empty', { todayIso: TODAY });
  saveScheduleState(emptySt);

  const n = nextSession(profile(35), [], NOW);
  assert.equal(n, null);
});

test('sesi kustom tetap terbaca meski targetRaceDate belum diatur', () => {
  const st = addCustomSession(DEFAULT_SCHEDULE_STATE, {
    date: TODAY,
    kind: 'recovery',
    name: 'Easy Mandiri',
    durationMin: 25,
    hr: [128, 142],
  });
  saveScheduleState(st);

  const n = nextSession(profile(35, 0), [], NOW);
  assert.ok(n);
  assert.equal(n.session.name, 'Easy Mandiri');
  assert.deepEqual(n.hr, [128, 142]);
  assert.equal(n.durationMin, 25);
});
