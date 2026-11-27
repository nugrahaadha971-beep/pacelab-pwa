import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDuplicate, mergeWorkouts, normalizeProfile, normalizeWorkout, parseBackup, PREF_KEYS } from './validate.ts';

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

test('normalizeProfile: menerima sex male/female dan mengabaikan nilai tidak dikenal', () => {
  assert.equal(normalizeProfile({ ...P, sex: 'female' })?.sex, 'female');
  assert.equal(normalizeProfile({ ...P, sex: 'male' })?.sex, 'male');
  assert.equal(normalizeProfile({ ...P, sex: 'other' })?.sex, undefined);
});

test('parseBackup membaca prefs (sepatu, mode, k5) dan membuang kunci asing seperti API key', () => {
  const r = parseBackup({
    app: 'pacelab',
    workouts: [],
    prefs: { pacelab_shoes: '[]', 'pacelab.k5': '00:25:00', pacelab_gemini_api_key: 'RAHASIA', x: 1 },
  });
  assert.deepEqual(r.prefs, { pacelab_shoes: '[]', 'pacelab.k5': '00:25:00' });
  assert.equal(parseBackup({ app: 'pacelab', workouts: [] }).prefs, null);
});

test('PREF_KEYS sinkron dengan konstanta kunci penyimpanan', async () => {
  const { SHOES_KEY } = await import('../plans/shoeStore.ts');
  const { PLAN_MODE_KEY, MAF_ADJ_KEY } = await import('../plans/scheduleStore.ts');
  const { K5_KEY } = await import('../plans/k5Store.ts');
  assert.deepEqual([...PREF_KEYS].sort(), [SHOES_KEY, PLAN_MODE_KEY, MAF_ADJ_KEY, K5_KEY].sort());
});

test('mergeWorkouts: menggabungkan sesi baru dan melewati duplikat', () => {
  const base = normalizeWorkout(W)!;
  const dup = normalizeWorkout({ ...W, date: W.date + 60_000, distanceKm: 5.05 })!;
  const fresh = normalizeWorkout({ ...W, date: W.date + 86_400_000, distanceKm: 8 })!;
  const added = mergeWorkouts([base], [dup, fresh]);
  assert.equal(added.length, 1);
  assert.equal(added[0].distanceKm, 8);
});

test('normalizeProfile menjaga hrMethod yang valid dan membuang yang lain', () => {
  assert.equal(normalizeProfile({ ...P, hrMethod: 'hrmax' })?.hrMethod, 'hrmax');
  assert.equal(normalizeProfile({ ...P, hrMethod: 'hrr' })?.hrMethod, 'hrr');
  assert.equal(normalizeProfile({ ...P, hrMethod: 'x' })?.hrMethod, undefined);
  assert.equal(normalizeProfile(P)?.hrMethod, undefined);
});

