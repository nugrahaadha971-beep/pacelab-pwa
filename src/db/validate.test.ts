import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDuplicate, normalizeProfile, normalizeWorkout, parseBackup } from './validate.ts';

const W = { date: 1_700_000_000_000, source: 'fit', workoutType: 'easy', distanceKm: 5, durationSec: 1500 };
const P = { id: 'default', age: 30, restingHr: 55, maxHr: 187, targetDistance: '10K', targetRaceDate: 0, targetTimeSec: 3000 };

test('normalizeWorkout: field minimal diterima, pace dihitung, laps default kosong', () => {
  const w = normalizeWorkout(W);
  assert.ok(w);
  assert.equal(w.avgPaceSecPerKm, 300);
  assert.deepEqual(w.laps, []);
  assert.equal(w.avgHr, null);
});

test('normalizeWorkout: tolak jarak ≤ 0, jenis tidak dikenal, dan bukan objek', () => {
  assert.equal(normalizeWorkout({ ...W, distanceKm: 0 }), null);
  assert.equal(normalizeWorkout({ ...W, workoutType: 'yoga' }), null);
  assert.equal(normalizeWorkout('x'), null);
});

test('normalizeWorkout: catatan dan lap valid dipertahankan, lap rusak dibuang', () => {
  const w = normalizeWorkout({ ...W, note: 'tes', laps: [{ km: 1, paceSec: 300, avgHr: 140 }, { km: 'x' }] });
  assert.equal(w?.note, 'tes');
  assert.equal(w?.laps.length, 1);
  assert.equal(w?.laps[0].avgHr, 140);
});

test('normalizeProfile: Max HR harus > Resting HR; weeklyTargetKm opsional', () => {
  assert.equal(normalizeProfile({ ...P, maxHr: 50 }), null);
  assert.equal(normalizeProfile(P)?.weeklyTargetKm, undefined);
  assert.equal(normalizeProfile({ ...P, weeklyTargetKm: 40 })?.weeklyTargetKm, 40);
});

test('parseBackup: tolak berkas asing; hitung sesi yang dilewati; profil dari array', () => {
  assert.throws(() => parseBackup({ app: 'lain', workouts: [] }), /tidak valid/);
  const r = parseBackup({ app: 'pacelab', workouts: [W, { bad: true }], userProfile: [P] });
  assert.equal(r.workouts.length, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.profile?.age, 30);
});

test('isDuplicate: toleransi 2 menit dan 0,1 km', () => {
  const ex = [{ date: 1_000_000, distanceKm: 5 }];
  assert.equal(isDuplicate(ex, { date: 1_000_000 + 60_000, distanceKm: 5.05 }), true);
  assert.equal(isDuplicate(ex, { date: 1_000_000 + 300_000, distanceKm: 5 }), false);
  assert.equal(isDuplicate(ex, { date: 1_000_000, distanceKm: 6 }), false);
});
