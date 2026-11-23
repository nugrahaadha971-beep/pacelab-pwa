import { test } from 'node:test';
import assert from 'node:assert/strict';
import { best5kSec, normalizePlanMode, resolvePlan, selectBestPlan } from './planSelector.ts';
import { DAY_MS } from '../analytics/workload.ts';
import type { Workout } from '../analytics/types.ts';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const P = { maxHr: 182 };
const wk = (daysAgo: number, o: Partial<Workout> = {}): Workout => ({
  date: NOW - daysAgo * DAY_MS, source: 'manual', workoutType: 'easy', distanceKm: 3, durationSec: 1200, avgPaceSecPerKm: 400,
  avgHr: 135, maxHr: 160, avgCadence: null, elevationGain: null, rpe: null, laps: [], ...o,
});
/** n sesi dalam 28 hari terakhir. */
const sessions = (n: number, o: Partial<Workout> = {}) => Array.from({ length: n }, (_, i) => wk(1 + i * (27 / n), o));
const fit = (o: Partial<Workout> = {}) => sessions(12, o); // 3 sesi/minggu

test('Nike: 5K < 40:00, frekuensi ≥ 3/minggu, HR santai stabil < 80% HR maks', () => {
  const r = selectBestPlan(fit(), P, { now: NOW, projected5kSec: 2300 });
  assert.equal(r.plan, 'nike5k');
  assert.ok(r.reasons.length >= 3);
  assert.ok(Math.abs(r.metrics.weeklyFreq - 3) < 1e-9);
});

test('Progresif (syarat 1): 5K ≥ 40:00 (tepat 2400 detik)', () => {
  assert.equal(selectBestPlan(fit(), P, { now: NOW, projected5kSec: 2400 }).plan, 'progressive5k');
  assert.equal(selectBestPlan(fit(), P, { now: NOW, projected5kSec: 2399 }).plan, 'nike5k');
  const r = selectBestPlan(fit(), P, { now: NOW, projected5kSec: 2914 }); // 48:34
  assert.equal(r.plan, 'progressive5k');
  assert.match(r.reasons.join(' '), /48:34/);
  assert.match(r.reasons.join(' '), /40:00/);
});

test('Progresif (syarat 2): frekuensi 28 hari < 3 sesi/minggu', () => {
  const r = selectBestPlan(sessions(11), P, { now: NOW, projected5kSec: 2000 }); // 2,75/minggu
  assert.equal(r.plan, 'progressive5k');
  assert.match(r.reasons[0], /2,8 sesi\/minggu/);
  assert.equal(selectBestPlan([], P, { now: NOW, projected5kSec: 2000 }).plan, 'progressive5k');
  const old = [wk(40), wk(41), wk(50)];
  assert.equal(selectBestPlan(old, P, { now: NOW, projected5kSec: 2000 }).metrics.weeklyFreq, 0, 'di luar 28 hari tidak dihitung');
});

test('Progresif (syarat 3): HR sesi Easy terakhir > 80% HR maks (tepat 80% tidak)', () => {
  const hi = [wk(0.5, { avgHr: 146 }), ...sessions(11).slice(1)]; // 146/182 = 80,2%
  const r = selectBestPlan([...hi, ...sessions(2)], P, { now: NOW, projected5kSec: 2000 });
  assert.equal(r.plan, 'progressive5k');
  assert.match(r.reasons.join(' '), /80%/);
  const eq = [wk(0.5, { avgHr: 145.6 }), ...fit()];
  assert.equal(selectBestPlan(eq, P, { now: NOW, projected5kSec: 2000 }).plan, 'nike5k');
});

test('Progresif (syarat 3): cardiac drift sesi Easy terakhir > 5%', () => {
  const laps = [120, 120, 130, 130].map((hr, i) => ({ km: i + 1, paceSec: 360, avgHr: hr })); // drift ≈ 7,7%
  const r = selectBestPlan([wk(0.5, { laps, avgHr: 125 }), ...fit()], P, { now: NOW, projected5kSec: 2000 });
  assert.equal(r.plan, 'progressive5k');
  assert.match(r.reasons.join(' '), /drift/i);
  const stable = [120, 120, 121, 121].map((hr, i) => ({ km: i + 1, paceSec: 360, avgHr: hr }));
  assert.equal(selectBestPlan([wk(0.5, { laps: stable, avgHr: 120 }), ...fit()], P, { now: NOW, projected5kSec: 2000 }).plan, 'nike5k');
});

test('Sesi Easy terakhir dipilih berdasarkan tipe; tanpa sesi Easy memakai sesi terakhir (ditandai)', () => {
  const ws = [wk(0.2, { workoutType: 'interval', avgHr: 170 }), wk(2, { avgHr: 130 }), ...sessions(11).slice(2)];
  const r = selectBestPlan(ws, P, { now: NOW, projected5kSec: 2000 });
  assert.equal(r.metrics.easySessionIsFallback, false);
  assert.ok(Math.abs((r.metrics.easyHrPct ?? 0) - 130 / 182) < 1e-9);
  const noEasy = selectBestPlan(sessions(12, { workoutType: 'long_run', avgHr: 160 }), P, { now: NOW, projected5kSec: 2000 });
  assert.equal(noEasy.metrics.easySessionIsFallback, true);
  assert.equal(noEasy.plan, 'progressive5k');
});

test('Data kurang: 5K tidak bisa diproyeksikan → jalur aman Progresif; tanpa HR dianggap tidak melanggar', () => {
  assert.equal(selectBestPlan(fit(), P, { now: NOW, projected5kSec: null }).plan, 'progressive5k');
  const noHr = selectBestPlan(fit({ avgHr: null, laps: [] }), P, { now: NOW, projected5kSec: 2000 });
  assert.equal(noHr.plan, 'nike5k');
  assert.match(noHr.reasons.join(' '), /dianggap stabil/);
  assert.equal(selectBestPlan(fit(), { maxHr: 0 }, { now: NOW, projected5kSec: 2000 }).plan, 'nike5k');
});

test('best5kSec: memakai yang lebih cepat antara proyeksi dan catatan 5K aktual (dinormalkan ke 5 km)', () => {
  assert.equal(best5kSec([], 2400), 2400);
  assert.equal(best5kSec([], null), null);
  assert.equal(best5kSec([wk(3, { distanceKm: 5, durationSec: 2200 })], 2400), 2200);
  assert.equal(best5kSec([wk(3, { distanceKm: 5.1, durationSec: 2550 })], 2400), 2400);
  assert.equal(best5kSec([wk(3, { distanceKm: 3, durationSec: 1000 })], null), null, '3 km bukan catatan 5K');
});

test('Kontrol pengguna: mode manual menang atas rekomendasi; mode tersimpan dinormalkan', () => {
  const sel = selectBestPlan(fit(), P, { now: NOW, projected5kSec: 2914 });
  assert.equal(resolvePlan('auto', sel), 'progressive5k');
  assert.equal(resolvePlan('nike5k', sel), 'nike5k');
  assert.equal(resolvePlan('progressive5k', selectBestPlan(fit(), P, { now: NOW, projected5kSec: 2000 })), 'progressive5k');
  assert.equal(normalizePlanMode('nike5k'), 'nike5k');
  assert.equal(normalizePlanMode('progressive5k'), 'progressive5k');
  assert.equal(normalizePlanMode('auto'), 'auto');
  assert.equal(normalizePlanMode('x'), 'auto');
  assert.equal(normalizePlanMode(null), 'auto');
});
