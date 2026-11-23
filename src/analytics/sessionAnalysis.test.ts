import test from 'node:test';
import assert from 'node:assert/strict';
import type { UserProfile, Workout } from './types.ts';
import { analyzeWorkoutPeriod, analyzeWorkoutSession } from './sessionAnalysis.ts';
import { DAY_MS } from './workload.ts';

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

const profile: UserProfile = {
  id: 'default',
  age: 25, // 180 - 25 = 155 bpm MAF
  restingHr: 55,
  maxHr: 190,
  targetDistance: '5K',
  targetRaceDate: Date.UTC(2027, 0, 31),
  targetTimeSec: 1620,
};

let seq = 0;
function makeWorkout(overrides: Partial<Workout>): Workout {
  return {
    id: ++seq,
    date: NOW - DAY_MS,
    source: 'fit',
    workoutType: 'easy',
    distanceKm: 5,
    durationSec: 2100, // 7:00 /km
    avgPaceSecPerKm: 420,
    avgHr: 150,
    maxHr: 154,
    avgCadence: 168,
    elevationGain: 15,
    rpe: 4,
    laps: [
      { km: 1, paceSec: 425, avgHr: 147 },
      { km: 2, paceSec: 420, avgHr: 149 },
      { km: 3, paceSec: 418, avgHr: 150 },
      { km: 4, paceSec: 418, avgHr: 151 },
      { km: 5, paceSec: 419, avgHr: 152 },
    ],
    ...overrides,
  };
}

test('MAF: sesi disiplin di zona 145-155 bpm dinilai optimal (Sudah sesuai target)', () => {
  const w = makeWorkout({ avgHr: 150, maxHr: 154 });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'maf', mafAdjustment: 0 });
  assert.equal(res.targetZone, 'maf');
  assert.deepEqual(res.targetHrRange, [145, 155]);
  assert.equal(res.status, 'optimal');
  assert.equal(res.verdictLabel, 'Sudah sesuai target');
  assert.match(res.summary, /sudah benar/i);
});

test('MAF: HR rata-rata melewati batas atas 155 bpm dinilai off_target', () => {
  const w = makeWorkout({ avgHr: 162, maxHr: 168 });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'maf', mafAdjustment: 0 });
  assert.equal(res.status, 'off_target');
  assert.equal(res.verdictLabel, 'Belum sesuai zona target');
  assert.match(res.summary, /\+7 bpm/);
  assert.match(res.nextAction, /155 bpm/);
});

test('MAF: HR rata-rata masuk zona (151 bpm) tapi maxHr loncat ke 164 bpm dinilai caution', () => {
  const w = makeWorkout({ avgHr: 151, maxHr: 164 });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'maf', mafAdjustment: 0 });
  assert.equal(res.status, 'caution');
  assert.equal(res.verdictLabel, 'Sudah baik, perlu penyesuaian');
  assert.match(res.summary, /164 bpm/);
});

test('MAF: melambat di paruh kedua demi menjaga HR tetap di zona MAF dinilai positif pada pacing', () => {
  const w = makeWorkout({
    avgHr: 151,
    maxHr: 155,
    laps: [
      { km: 1, paceSec: 400, avgHr: 149 },
      { km: 2, paceSec: 405, avgHr: 151 },
      { km: 3, paceSec: 430, avgHr: 152 },
      { km: 4, paceSec: 435, avgHr: 152 },
    ],
  });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'maf', mafAdjustment: 0 });
  const paceCheck = res.checks.find((c) => c.key === 'pacing');
  assert.ok(paceCheck);
  assert.equal(paceCheck.tone, 'good');
  assert.match(paceCheck.title, /menjaga HR/i);
});

test('MAF: cardiac drift > 5% memicu status caution meski rata-rata HR masuk zona', () => {
  const w = makeWorkout({
    avgHr: 150,
    maxHr: 155,
    laps: [
      { km: 1, paceSec: 420, avgHr: 145 },
      { km: 2, paceSec: 420, avgHr: 146 },
      { km: 3, paceSec: 420, avgHr: 154 },
      { km: 4, paceSec: 420, avgHr: 155 },
    ],
  });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'maf', mafAdjustment: 0 });
  assert.equal(res.status, 'caution');
  assert.ok((res.metrics.driftPct ?? 0) > 5);
});

test('Program lain (Nike/Progresif): Easy Run terlalu cepat (> 82% maxHr) dinilai off_target', () => {
  // maxHr 190 -> easy 71-82% = 135-156 bpm
  const w = makeWorkout({ workoutType: 'easy', avgHr: 165, maxHr: 172 });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'nike5k' });
  assert.equal(res.targetZone, 'easy');
  assert.deepEqual(res.targetHrRange, [135, 156]);
  assert.equal(res.status, 'off_target');
});

test('Sesi Interval: evaluasi memakai HR puncak lap karena jeda istirahat menurunkan HR rata-rata', () => {
  // maxHr 190 -> interval 90-96% = 171-183 bpm
  const w = makeWorkout({
    workoutType: 'interval',
    avgHr: 154,
    maxHr: 178,
    laps: [
      { km: 1, paceSec: 420, avgHr: 138 },
      { km: 2, paceSec: 270, avgHr: 176 },
      { km: 3, paceSec: 450, avgHr: 142 },
      { km: 4, paceSec: 268, avgHr: 178 },
    ],
  });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'nike5k' });
  assert.equal(res.targetZone, 'interval');
  assert.equal(res.status, 'optimal');
});

test('Sesi tanpa data HR menghasilkan status incomplete', () => {
  const w = makeWorkout({ source: 'manual', avgHr: null, maxHr: null, laps: [] });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'maf' });
  assert.equal(res.status, 'incomplete');
  assert.equal(res.verdictLabel, 'Data HR belum lengkap');
});

test('analyzeWorkoutPeriod menghitung persentase kepatuhan periode secara akurat', () => {
  const ws = [
    makeWorkout({ date: NOW - 1 * DAY_MS, avgHr: 150, maxHr: 154 }), // optimal
    makeWorkout({ date: NOW - 2 * DAY_MS, avgHr: 162, maxHr: 168 }), // off_target
    makeWorkout({ date: NOW - 3 * DAY_MS, avgHr: 149, maxHr: 153 }), // optimal
    makeWorkout({ date: NOW - 40 * DAY_MS, avgHr: 150, maxHr: 154 }), // di luar 28 hari
  ];
  const period = analyzeWorkoutPeriod(ws, NOW, 28, { profile, curriculum: 'maf' });
  assert.equal(period.summary.total, 3);
  assert.equal(period.summary.optimal, 2);
  assert.equal(period.summary.offTarget, 1);
  assert.equal(period.summary.compliancePct, 67);
});

// ── v2.3.0: aturan MAF usia ≤ 16 dan tanpa patokan pace VDOT ────────────────

test('MAF usia ≤ 16: batas HR memakai 165 bpm (zona 155–165); label & pesan menyebut aturan 165', () => {
  const young: UserProfile = { ...profile, age: 14 };
  const w = makeWorkout({ avgHr: 160, maxHr: 162 });
  const res = analyzeWorkoutSession(w, { profile: young, curriculum: 'maf', mafAdjustment: 0 });
  assert.equal(res.targetZone, 'maf');
  assert.deepEqual(res.targetHrRange, [155, 165]);
  assert.equal(res.status, 'optimal');
  assert.equal(res.targetZoneLabel, 'Zona MAF (180 − usia; 165 untuk usia ≤ 16)');
  // Usia tidak valid: tidak ada batas, dan pesan meminta usia dengan aturan yang sama.
  const noAge = analyzeWorkoutSession(w, { profile: { ...profile, age: 0 }, curriculum: 'maf', mafAdjustment: 0 });
  assert.equal(noAge.targetHrRange, null);
  const hrCheck = noAge.checks.find((c) => c.key === 'hr');
  assert.match(hrCheck?.detail ?? '', /\(180 − usia; 165 untuk usia ≤ 16\)/);
});

test('MAF tanpa catatan pace MAF (mafPaceSecPerKm null): dievaluasi dari zona HR, tidak memakai pace VDOT', () => {
  const w = makeWorkout({ avgHr: 150, maxHr: 154 }); // jenis easy, zona MAF 145–155 pada usia 25
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'maf', mafAdjustment: 0, mafPaceSecPerKm: null, easyPaceSecPerKm: 360 });
  assert.equal(res.targetZone, 'maf');
  assert.deepEqual(res.targetHrRange, [145, 155]);
  assert.equal(res.status, 'optimal');
  // Patokan VDOT (360 dtk/km = 6:00) tidak mengubah hasil apa pun dan tidak muncul di teks.
  const without = analyzeWorkoutSession(w, { profile, curriculum: 'maf', mafAdjustment: 0, mafPaceSecPerKm: null });
  assert.deepEqual(res.checks, without.checks);
  const text = [res.summary, res.nextAction, ...res.checks.flatMap((c) => [c.title, c.detail])].join(' ');
  assert.doesNotMatch(text, /patokan santai|6:00/);
});

test('sesi tanpa HR: ringkasan menampilkan durasi aktual dari durationSec (M:SS)', () => {
  const w = makeWorkout({ source: 'manual', avgHr: null, maxHr: null, laps: [], distanceKm: 1.5, durationSec: 485 });
  const res = analyzeWorkoutSession(w, { profile, curriculum: 'maf' });
  assert.equal(res.status, 'incomplete');
  assert.match(res.summary, /1\.50 km \(8:05\)/);
});
