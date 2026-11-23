import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceBucket, filterWorkouts, weeklyKm } from './historyFilter.ts';
import type { Workout } from '../analytics/types';

const T = { '5K': 5, '10K': 10, '21.1K': 21.0975, '42.2K': 42.195 };
const DAY = 86_400_000;
const w = (o: Partial<Workout>): Workout => ({
  date: 0, source: 'fit', workoutType: 'easy', distanceKm: 5, durationSec: 1500, avgPaceSecPerKm: 300,
  avgHr: null, maxHr: null, avgCadence: null, elevationGain: null, rpe: null, laps: [], ...o,
});

test('distanceBucket: 5,2 km → 5K; 7 km → null', () => {
  assert.equal(distanceBucket(5.2, T), '5K');
  assert.equal(distanceBucket(7, T), null);
});

test('filterWorkouts: jarak, sumber, dan catatan', () => {
  const ws = [
    w({ distanceKm: 5, source: 'fit', note: 'Interval di lapangan' }),
    w({ distanceKm: 10, source: 'manual' }),
    w({ distanceKm: 5.1, source: 'gpx' }),
  ];
  assert.equal(filterWorkouts(ws, { q: '', dist: '5K', source: 'all' }, T).length, 2);
  assert.equal(filterWorkouts(ws, { q: 'lapangan', dist: 'all', source: 'all' }, T).length, 1);
  assert.equal(filterWorkouts(ws, { q: '', dist: 'all', source: 'manual' }, T).length, 1);
});

test('weeklyKm: sesi minggu ini masuk bucket terakhir', () => {
  const now = 100 * DAY;
  const r = weeklyKm([w({ date: now - DAY, distanceKm: 8 })], now, 4);
  assert.equal(r[3].km, 8);
  assert.equal(r[0].km, 0);
});

test('filterWorkouts: jenis sesi', () => {
  const ws = [w({ workoutType: 'tempo' }), w({ workoutType: 'easy' })];
  assert.equal(filterWorkouts(ws, { q: '', dist: 'all', source: 'all', type: 'tempo' }, T).length, 1);
  assert.equal(filterWorkouts(ws, { q: '', dist: 'all', source: 'all', type: 'all' }, T).length, 2);
});
