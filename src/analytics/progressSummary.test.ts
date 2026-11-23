import test from 'node:test';
import assert from 'node:assert/strict';
import type { Workout } from './types.ts';
import { compareProgress, summarizeWindow } from './progressSummary.ts';
import { DAY_MS } from './workload.ts';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

let seq = 0;
function makeWorkout(overrides: Partial<Workout>): Workout {
  return {
    id: ++seq,
    date: NOW - DAY_MS,
    source: 'fit',
    workoutType: 'easy',
    distanceKm: 5,
    durationSec: 3000, // 10:00 /km
    avgPaceSecPerKm: 600,
    avgHr: 145,
    maxHr: 162,
    avgCadence: 164,
    elevationGain: 20,
    rpe: 4,
    laps: [],
    ...overrides,
  };
}

test('compareProgress menghitung delta jarak, pace easy, dan efisiensi antar periode', () => {
  const workouts: Workout[] = [
    // Periode sebelumnya (8–14 hari lalu): pace 630 dtk/km, HR 148
    makeWorkout({ date: NOW - 10 * DAY_MS, distanceKm: 4, durationSec: 2520, avgPaceSecPerKm: 630, avgHr: 148 }),
    makeWorkout({ date: NOW - 8 * DAY_MS, distanceKm: 4, durationSec: 2520, avgPaceSecPerKm: 630, avgHr: 148 }),
    // Periode berjalan (1–7 hari lalu): pace lebih cepat 600 dtk/km, HR turun 142
    makeWorkout({ date: NOW - 4 * DAY_MS, distanceKm: 5, durationSec: 3000, avgPaceSecPerKm: 600, avgHr: 142 }),
    makeWorkout({ date: NOW - 2 * DAY_MS, distanceKm: 5, durationSec: 3000, avgPaceSecPerKm: 600, avgHr: 142 }),
  ];

  const res = compareProgress(workouts, NOW, 7);

  assert.equal(res.current.sessions, 2);
  assert.equal(res.current.totalKm, 10);
  assert.equal(res.previous.totalKm, 8);
  assert.equal(res.kmDeltaPct, 25);
  assert.equal(res.easyPaceDeltaSec, -30);
  assert.ok(res.efDeltaPct != null && res.efDeltaPct > 5);
  assert.match(res.headline, /Efisiensi aerobik naik/);
});

test('compareProgress mendeteksi proporsi intensitas tinggi (< 75% easy)', () => {
  const workouts: Workout[] = [
    makeWorkout({ date: NOW - 3 * DAY_MS, workoutType: 'easy', durationSec: 1200 }),
    makeWorkout({ date: NOW - 2 * DAY_MS, workoutType: 'tempo', durationSec: 1800 }),
    makeWorkout({ date: NOW - 1 * DAY_MS, workoutType: 'interval', durationSec: 1800 }),
  ];

  const res = compareProgress(workouts, NOW, 7);

  assert.equal(res.intensityStatus, 'too_hard');
  assert.equal(Math.round(res.current.easySharePct ?? 0), 25);
  assert.equal(Math.round(res.current.qualitySharePct ?? 0), 75);
});

// ── Tes tambahan (kasus tepi) ────────────────────────────────────────────────

test('tanpa data: headline "belum ada sesi", semua delta null, status intensitas insufficient', () => {
  const res = compareProgress([], NOW, 28);
  assert.equal(res.current.sessions, 0);
  assert.equal(res.headline, 'Belum ada sesi tercatat dalam 28 hari terakhir.');
  assert.equal(res.kmDeltaPct, null);
  assert.equal(res.efDeltaPct, null);
  assert.equal(res.easyPaceDeltaSec, null);
  assert.equal(res.hrDeltaBpm, null);
  assert.equal(res.cadenceDeltaSpm, null);
  assert.equal(res.current.bestPaceSec, null);
  assert.equal(res.current.bestVdot, null);
  assert.equal(res.current.longestKm, 0);
  assert.equal(res.intensityStatus, 'insufficient');
  assert.deepEqual(res.series, []);
});

test('tanpa periode pembanding: delta null tetapi ringkasan periode aktif tetap terisi', () => {
  const res = compareProgress([makeWorkout({ date: NOW - 2 * DAY_MS }), makeWorkout({ date: NOW - 3 * DAY_MS })], NOW, 7);
  assert.equal(res.previous.sessions, 0);
  assert.equal(res.kmDeltaPct, null);
  assert.equal(res.easyPaceDeltaSec, null);
  assert.equal(res.headline, 'Tercatat 2 sesi (10.0 km) dalam 7 hari terakhir.');
});

test('batas jendela: (mulai, akhir] — tepat di batas awal tidak dihitung, tepat di "sekarang" dihitung', () => {
  const ws = [
    makeWorkout({ date: NOW - 7 * DAY_MS }), // tepat batas awal → masuk periode sebelumnya
    makeWorkout({ date: NOW }),
    makeWorkout({ date: NOW + DAY_MS }), // masa depan → diabaikan
  ];
  const res = compareProgress(ws, NOW, 7);
  assert.equal(res.current.sessions, 1);
  assert.equal(res.previous.sessions, 1);
});

test('delta HR santai, kadens, dan cardiac drift dari lap', () => {
  const laps = [140, 140, 150, 150].map((hr, i) => ({ km: i + 1, paceSec: 600, avgHr: hr }));
  const ws = [
    makeWorkout({ date: NOW - 10 * DAY_MS, avgHr: 148, avgCadence: 160 }),
    makeWorkout({ date: NOW - 3 * DAY_MS, avgHr: 142, avgCadence: 168, laps }),
  ];
  const res = compareProgress(ws, NOW, 7);
  assert.equal(res.hrDeltaBpm, -6);
  assert.equal(res.cadenceDeltaSpm, 8);
  assert.ok(Math.abs((res.current.avgDriftPct ?? 0) - 6.6667) < 0.001);
  assert.equal(res.previous.avgDriftPct, null, 'tanpa lap → drift null');
});

test('intensitas: seimbang (75–92%), fondasi (> 92%), dan data kurang (1 sesi)', () => {
  const bal = compareProgress([
    makeWorkout({ date: NOW - 3 * DAY_MS, durationSec: 3000 }),
    makeWorkout({ date: NOW - 2 * DAY_MS, workoutType: 'tempo', durationSec: 600 }),
  ], NOW, 7);
  assert.equal(bal.intensityStatus, 'balanced'); // 3000/3600 = 83%
  const base = compareProgress([
    makeWorkout({ date: NOW - 3 * DAY_MS }),
    makeWorkout({ date: NOW - 2 * DAY_MS, workoutType: 'long_run' }),
  ], NOW, 7);
  assert.equal(base.intensityStatus, 'base_building');
  assert.equal(Math.round(base.current.easySharePct ?? 0), 100);
  const one = compareProgress([makeWorkout({ date: NOW - 3 * DAY_MS })], NOW, 7);
  assert.equal(one.intensityStatus, 'insufficient');
});

test('series: urut tanggal; pace/EF/drift hanya sesi santai; VDOT hanya sesi ≥ 3 km', () => {
  const ws = [
    makeWorkout({ date: NOW - 1 * DAY_MS, workoutType: 'interval', distanceKm: 4, durationSec: 1500, avgPaceSecPerKm: 375 }),
    makeWorkout({ date: NOW - 5 * DAY_MS, workoutType: 'easy' }),
    makeWorkout({ date: NOW - 3 * DAY_MS, workoutType: 'tempo', distanceKm: 2, durationSec: 600, avgPaceSecPerKm: 300 }),
  ];
  const s = compareProgress(ws, NOW, 7).series;
  assert.deepEqual(s.map((p) => p.workoutType), ['easy', 'tempo', 'interval']);
  assert.equal(s[0].easyPaceSec, 600);
  assert.ok(s[0].ef != null && s[0].vdotScore != null);
  assert.equal(s[1].easyPaceSec, null);
  assert.equal(s[1].ef, null);
  assert.equal(s[1].vdotScore, null, '2 km < 3 km');
  assert.equal(s[2].easyPaceSec, null);
  assert.ok(s[2].vdotScore != null && s[2].vdotScore > (s[0].vdotScore as number), 'sesi cepat → VDOT lebih tinggi');
});

test('summarizeWindow: pace tercepat mengabaikan pace tidak valid (0); frekuensi per minggu', () => {
  const ws = [
    makeWorkout({ date: NOW - 2 * DAY_MS, avgPaceSecPerKm: 0 }),
    makeWorkout({ date: NOW - 3 * DAY_MS, avgPaceSecPerKm: 540 }),
    makeWorkout({ date: NOW - 4 * DAY_MS, avgPaceSecPerKm: 600 }),
    makeWorkout({ date: NOW - 5 * DAY_MS, avgPaceSecPerKm: 620 }),
  ];
  const p = summarizeWindow(ws, NOW - 14 * DAY_MS, NOW, 14);
  assert.equal(p.bestPaceSec, 540);
  assert.equal(p.sessions, 4);
  assert.equal(p.sessionsPerWeek, 2);
  assert.equal(p.longestKm, 5);
});
