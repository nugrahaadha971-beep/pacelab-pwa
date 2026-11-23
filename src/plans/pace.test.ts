import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtPace, nearestRow, paceKeyFor, targetFor } from './pace.ts';
import { NIKE_5K_PLAN } from './nike5k.ts';

test('fmtPace', () => {
  assert.equal(fmtPace(330), '5:30');
  assert.equal(fmtPace(65), '1:05');
});

test('nearestRow: 5K 27:00 → baris mile best 8:00', () => {
  assert.equal(nearestRow(1620)[0], 480);
});

test('target 5K untuk 27:00 = 8:40/mi', () => {
  assert.match(targetFor('k5', nearestRow(1620)) ?? '', /^8:40\/mi/);
});

test('deteksi jenis pace dari teks PDF', () => {
  assert.equal(paceKeyFor('8 x 1:00 5K Pace'), 'k5');
  assert.equal(paceKeyFor('5:00 Recovery Run Pace'), 'rec');
  assert.equal(paceKeyFor('0:30 Best Pace'), 'best');
  assert.equal(paceKeyFor('23:00 Tempo Run: 12:00 pertama'), 'tempo');
  assert.equal(paceKeyFor('1:00 Recovery between all intervals'), null);
  assert.equal(paceKeyFor('Recovery 30 detik setelah set pertama'), null);
});

test('rencana: 8 minggu, Hari-H di minggu terakhir', () => {
  assert.equal(NIKE_5K_PLAN.length, 8);
  assert.equal(NIKE_5K_PLAN[7].sessions.at(-1)?.kind, 'race');
});

test('pace per km: konversi dari mil, delta, dan rentang', async () => {
  const { paceSecPerKm, fmtKm, fmtRangeKm } = await import('./pace.ts');
  const row = [420, 1425, 460, 475, 495, 560];
  assert.equal(fmtKm(paceSecPerKm('k5', row) as number), '4:46 /km');
  assert.equal(fmtKm(paceSecPerKm('k5', row, -4) as number), '4:42 /km');
  assert.equal(paceSecPerKm('best', row), null);
  assert.equal(paceSecPerKm(null, row), null);
  assert.equal(fmtRangeKm(360), '5:45–6:15 /km');
});
