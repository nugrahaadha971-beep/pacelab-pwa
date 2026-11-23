import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tanakaMaxHr, banisterTrimp, sessionTrimp, acwr, efficiencyFactor, efTrend, DAY_MS } from './workload.ts';
import { riegelProject, predictAll } from './predictor.ts';
import { parseDuration } from '../parsers/manual.ts';
import type { Workout } from './types';

const HR = { restingHr: 50, maxHr: 187 };
const mk = (o: Partial<Workout>): Workout => ({
  date: 0, source: 'manual', workoutType: 'easy', distanceKm: 5, durationSec: 1500, avgPaceSecPerKm: 300,
  avgHr: 140, maxHr: null, avgCadence: null, elevationGain: null, rpe: 4, laps: [], ...o,
});

test('Tanaka: usia 30 → 187 bpm', () => assert.equal(tanakaMaxHr(30), 187));

test('Banister: ΔHR 0 → 0; ΔHR 1 → durasi × 0,64 × e^1,92', () => {
  assert.equal(banisterTrimp(60, 50, 50, 187), 0);
  assert.ok(Math.abs(banisterTrimp(60, 187, 50, 187) - 60 * 0.64 * Math.exp(1.92)) < 1e-9);
});

test('Session-RPE tanpa HR: 50 menit × RPE 6 = 300', () => {
  assert.equal(sessionTrimp({ durationSec: 3000, avgHr: null, rpe: 6 }, HR), 300);
});

test('ACWR beban konstan = 1,0 (kronis = total 28 hari ÷ 4)', () => {
  const now = 1000 * DAY_MS;
  const ws = Array.from({ length: 28 }, (_, i) => mk({ date: now - i * DAY_MS, rpe: null, avgHr: null, durationSec: 6000 }));
  // 6000 dtk = 100 menit; pakai RPE agar TRIMP = 100 × RPE
  const ws2 = ws.map((w) => ({ ...w, rpe: 1 }));
  const r = acwr(ws2, HR, now);
  assert.equal(r.acute, 700);
  assert.equal(r.chronicWeekly, 700);
  assert.equal(r.ratio, 1);
  assert.equal(r.status, 'sweet_spot');
});

test('ACWR tanpa data kronis → unknown', () => {
  assert.equal(acwr([], HR, 1000 * DAY_MS).status, 'unknown');
});

test('EF = (m/menit) ÷ HR', () => {
  assert.equal(efficiencyFactor({ distanceKm: 10, durationSec: 3000, avgHr: 150 })?.toFixed(4), '1.3333');
});

test('Tren EF naik ≥ 2% → Kapasitas Aerobik Meningkat', () => {
  const now = 500 * DAY_MS;
  const ws = [mk({ date: now - 20 * DAY_MS, efficiencyFactor: 1.4 }), mk({ date: now - 3 * DAY_MS, efficiencyFactor: 1.45 })];
  const t = efTrend(ws, now);
  assert.ok(t.changePct != null && t.changePct > 3.5);
  assert.equal(t.improving, true);
});

test('Riegel: 5K 21:40 → 10K ≈ 45:09', () => {
  assert.ok(Math.abs(riegelProject(1300, 5, 10) - 2709) < 2);
});

test('Prediksi: penalti hanya untuk 21,1K & 42,2K', () => {
  const now = 100 * DAY_MS;
  const ws = [mk({ date: now - 2 * DAY_MS, distanceKm: 10, durationSec: 2700, workoutType: 'easy' })];
  const p = predictAll(ws, now);
  assert.equal(p['5K']!.penaltyPct, 0);
  assert.equal(p['5K']!.finalSec, p['5K']!.baseSec);
  assert.ok(p['42.2K']!.penaltyPct > 0.15);
  assert.ok(p['42.2K']!.finalSec > p['42.2K']!.baseSec);
});

test('Parser durasi HH:MM:SS dan MM:SS', () => {
  assert.equal(parseDuration('1:05:30'), 3930);
  assert.equal(parseDuration('45:15'), 2715);
  assert.equal(parseDuration('1:75:00'), null);
  assert.equal(parseDuration(''), null);
});
