import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Workout } from '../analytics/types.ts';
import { aggregateHrZones, classifyHrZone, formatZoneBpmRange, formatZoneDuration } from './hrZoneDistribution.ts';

const baseWorkout = (o: Partial<Workout>): Workout => ({
  date: 1_700_000_000_000,
  source: 'gpx',
  workoutType: 'easy',
  distanceKm: 5,
  durationSec: 1800,
  avgPaceSecPerKm: 360,
  avgHr: null,
  maxHr: null,
  avgCadence: null,
  elevationGain: null,
  rpe: null,
  laps: [],
  ...o,
});

test('classifyHrZone: memetakan persen HRmaks ke Z1–Z5 dengan tepat', () => {
  assert.equal(classifyHrZone(110, 200), 0); // 55% -> Z1
  assert.equal(classifyHrZone(130, 200), 1); // 65% -> Z2
  assert.equal(classifyHrZone(150, 200), 2); // 75% -> Z3
  assert.equal(classifyHrZone(170, 200), 3); // 85% -> Z4
  assert.equal(classifyHrZone(185, 200), 4); // 92.5% -> Z5
});

test('aggregateHrZones: membobot hrZonePct berdasarkan durasi sesi dan total 100%', () => {
  const workouts = [
    baseWorkout({ durationSec: 1800, hrZonePct: [10, 80, 10, 0, 0] }), // 30m: 3m Z1, 24m Z2, 3m Z3
    baseWorkout({ durationSec: 1800, hrZonePct: [0, 20, 40, 30, 10] }), // 30m: 6m Z2, 12m Z3, 9m Z4, 3m Z5
  ];
  const res = aggregateHrZones(workouts, 190);
  assert.equal(res.totalSeconds, 3600);
  assert.equal(res.measuredSessions, 2);
  assert.equal(res.exactSessions, 2);
  assert.equal(res.estimatedSessions, 0);
  assert.equal(res.zones[0].pct, 5);
  assert.equal(res.zones[1].pct, 50);
  assert.equal(res.zones[2].pct, 25);
  assert.equal(res.zones[3].pct, 15);
  assert.equal(res.zones[4].pct, 5);
  assert.equal(res.aerobicPct, 55);
  assert.equal(res.dominantZone?.code, 'Z2');
});

test('aggregateHrZones: fallback ke lap avgHr lalu session avgHr bila hrZonePct kosong', () => {
  const workouts = [
    baseWorkout({
      source: 'fit',
      durationSec: 1200,
      laps: [
        { km: 1, paceSec: 300, avgHr: 130 }, // Z2 (65% of 200)
        { km: 2, paceSec: 300, avgHr: 170 }, // Z4 (85% of 200)
      ],
    }),
    baseWorkout({
      source: 'manual',
      durationSec: 1200,
      avgHr: 150, // Z3 (75% of 200)
      laps: [],
    }),
  ];
  const res = aggregateHrZones(workouts, 200);
  assert.equal(res.measuredSessions, 2);
  assert.equal(res.exactSessions, 0);
  assert.equal(res.estimatedSessions, 2);
  assert.equal(res.zones[1].pct, 25);
  assert.equal(res.zones[2].pct, 50);
  assert.equal(res.zones[3].pct, 25);
});

test('aggregateHrZones: mengembalikan totalSeconds = 0 bila tidak ada data HR', () => {
  const res = aggregateHrZones([baseWorkout({ avgHr: null, laps: [] })], 190);
  assert.equal(res.totalSeconds, 0);
  assert.equal(res.measuredSessions, 0);
  assert.equal(res.dominantZone, null);
});

test('formatZoneBpmRange & formatZoneDuration: memformat rentang bpm dan durasi dengan rapi', () => {
  assert.equal(formatZoneBpmRange(1, 200), '120–139 bpm');
  assert.equal(formatZoneBpmRange(4, 200), '≥ 180 bpm');
  assert.equal(formatZoneBpmRange(0, null), null);
  assert.equal(formatZoneDuration(2700), '45 mnt');
  assert.equal(formatZoneDuration(5400), '1j 30m');
});
