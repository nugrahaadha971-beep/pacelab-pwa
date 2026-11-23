import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vdot, velocityFor, ZONE_FRACTION } from './predictor.ts';
import { cardiacDrift } from './workload.ts';
import { coachAdvice } from './coachEngine.ts';

const LAPS = [
  { km: 1, paceSec: 360, avgHr: 120 }, { km: 2, paceSec: 360, avgHr: 120 },
  { km: 3, paceSec: 360, avgHr: 130 }, { km: 4, paceSec: 360, avgHr: 130 },
];
const base = { acwrRatio: 1, efImproving: false, lastType: 'easy' as const, daysSinceLast: 2, lastDrift: null };

test('VDOT 5K 20:00 ≈ 49,8', () => assert.ok(Math.abs(vdot(5000, 1200) - 49.8) < 0.2));

test('velocityFor: VO2 = fraksi × VDOT', () => {
  const v = velocityFor(50, 0.8);
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  assert.ok(Math.abs(vo2 - 40) < 1e-6);
});

test('zona pace berurutan easy < marathon < threshold < interval', () => {
  assert.ok(ZONE_FRACTION.easy < ZONE_FRACTION.marathon && ZONE_FRACTION.marathon < ZONE_FRACTION.threshold && ZONE_FRACTION.threshold < ZONE_FRACTION.interval);
});

test('cardiac drift: HR 120 → 130 pada pace sama ≈ 7,7%', () => {
  assert.ok(Math.abs((cardiacDrift(LAPS) ?? NaN) - 7.69) < 0.1);
});

test('cardiac drift: kurang dari 4 lap → null', () => assert.equal(cardiacDrift(LAPS.slice(0, 3)), null));

test('kelelahan tinggi + sesi keras kemarin → istirahat', () => {
  const a = coachAdvice({ ...base, acwrStatus: 'high_fatigue', acwrRatio: 1.5, lastType: 'tempo', daysSinceLast: 1 });
  assert.equal(a.session, 'rest');
});

test('beban rendah → Easy Run +10 menit', () => {
  const a = coachAdvice({ ...base, acwrStatus: 'undertraining', acwrRatio: 0.6 });
  assert.equal(a.session, 'easy');
  assert.equal(a.durationAddMin, 10);
});

test('beban optimal, sesi terakhir easy → tempo', () => {
  assert.equal(coachAdvice({ ...base, acwrStatus: 'sweet_spot' }).session, 'tempo');
});

test('drift di atas ambang muncul di saran; EF membaik → catatan', () => {
  const a = coachAdvice({ ...base, acwrStatus: 'sweet_spot', lastDrift: 8, efImproving: true });
  assert.match(a.detail, /Cardiac drift/);
  assert.equal(a.efNote, 'Kapasitas Aerobik Meningkat');
});

// ── Program MAF: saran tidak pernah berupa Tempo/interval ─────────────────

const MAF = { curriculum: 'maf' as const };

test('MAF: beban optimal → easy, bukan tempo (sesi terakhir easy)', () => {
  assert.equal(coachAdvice({ ...base, acwrStatus: 'sweet_spot', ...MAF }).session, 'easy');
});

test('MAF: beban optimal setelah sesi keras kemarin → tetap easy', () => {
  assert.equal(coachAdvice({ ...base, acwrStatus: 'sweet_spot', lastType: 'tempo', daysSinceLast: 1, ...MAF }).session, 'easy');
});

test('MAF: beban rendah → easy +10 menit; detail menekankan zona HR MAF, tanpa saran Tempo', () => {
  const a = coachAdvice({ ...base, acwrStatus: 'undertraining', acwrRatio: 0.6, ...MAF });
  assert.equal(a.session, 'easy');
  assert.equal(a.durationAddMin, 10);
  assert.match(a.detail, /zona HR MAF/);
  assert.doesNotMatch(a.detail, /Tempo/);
});

test('MAF: kelelahan tinggi tetap istirahat/recovery seperti biasa', () => {
  assert.equal(coachAdvice({ ...base, acwrStatus: 'high_fatigue', acwrRatio: 1.5, lastType: 'tempo', daysSinceLast: 1, ...MAF }).session, 'rest');
  assert.equal(coachAdvice({ ...base, acwrStatus: 'high_fatigue', acwrRatio: 1.5, ...MAF }).session, 'recovery');
});

test('MAF: tidak pernah tempo atau interval, untuk status, riwayat sesi, dan jarak waktu apa pun', () => {
  const statuses = ['unknown', 'undertraining', 'sweet_spot', 'high_fatigue'] as const;
  const types = [null, 'easy', 'long_run', 'tempo', 'interval', 'race'] as const;
  for (const acwrStatus of statuses) for (const lastType of types) for (const daysSinceLast of [0, 1, 5, null]) {
    const a = coachAdvice({ ...base, acwrStatus, lastType, daysSinceLast, lastDrift: 8, efImproving: true, ...MAF });
    assert.ok(a.session !== 'tempo' && a.session !== 'interval', `${acwrStatus}/${lastType}/${daysSinceLast}: ${a.session}`);
  }
});

test('tanpa MAF (Nike/Progresif atau tidak diisi): saran lama tidak berubah', () => {
  assert.equal(coachAdvice({ ...base, acwrStatus: 'sweet_spot' }).session, 'tempo');
  assert.equal(coachAdvice({ ...base, acwrStatus: 'sweet_spot', curriculum: 'nike5k' }).session, 'tempo');
  assert.equal(coachAdvice({ ...base, acwrStatus: 'sweet_spot', curriculum: 'progressive5k' }).session, 'tempo');
  const u = coachAdvice({ ...base, acwrStatus: 'undertraining', acwrRatio: 0.6, curriculum: 'progressive5k' });
  assert.match(u.detail, /sesi Tempo/);
});
