import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHrZoneTable, calcHrZonePresetRange, detectPeakHr, formatHrWithZone, zoneRestingHr } from './hrZones.ts';
import { getZoneBpm } from './workoutTypes.ts';

test('zoneRestingHr: hrr memakai Resting HR, hrmax mengembalikan null', () => {
  assert.equal(zoneRestingHr({ restingHr: 58 }), 58);
  assert.equal(zoneRestingHr({ restingHr: 58, hrMethod: 'hrr' }), 58);
  assert.equal(zoneRestingHr({ restingHr: 58, hrMethod: 'hrmax' }), null);
});

test('buildHrZoneTable: Karvonen 182/55 (cocok dengan preset yang sudah ada) vs % HRmaks', () => {
  const hrr = buildHrZoneTable(182, 55, 'hrr');
  assert.equal(hrr.length, 5);
  assert.deepEqual([hrr[1].min, hrr[1].max, hrr[1].method], [131, 144, 'hrr']);
  assert.equal(hrr[1].pctLabel, '60–70% HRR');
  const mx = buildHrZoneTable(182, 55, 'hrmax');
  assert.deepEqual([mx[1].min, mx[1].max, mx[1].method], [109, 127, 'max']);
  assert.equal(mx[1].pctLabel, '60–70% HRmaks');
});

test('buildHrZoneTable: Resting HR tidak valid → jatuh ke % HRmaks; HR maks tidak valid → kosong', () => {
  assert.equal(buildHrZoneTable(182, 0, 'hrr')[1].method, 'max');
  assert.equal(buildHrZoneTable(182, 190, 'hrr')[1].method, 'max');
  assert.deepEqual(buildHrZoneTable(0, 55, 'hrr'), []);
  assert.deepEqual(buildHrZoneTable(null, 55), []);
});

test('hrmax: formatHrWithZone memakai % HRmaks ketika Resting HR diganti zoneRestingHr', () => {
  const p = { restingHr: 55, hrMethod: 'hrmax' as const };
  const z = calcHrZonePresetRange(2, 182, zoneRestingHr(p));
  assert.equal(z?.method, 'max');
  assert.equal(formatHrWithZone([109, 127], undefined, 182, zoneRestingHr(p)), 'Zona 2 · 109–127 bpm');
});

test('getZoneBpm memakai % HRmaks ketika restingHr null (hrmax) dan HRR ketika valid', () => {
  assert.deepEqual(getZoneBpm(2, 182, 55), [131, 144]);
  assert.deepEqual(getZoneBpm(2, 182, null), [109, 127]);
  assert.deepEqual(getZoneBpm(4, 182, null), [146, 164]);
});

test('detectPeakHr: abaikan lonjakan sensor, nilai di luar rentang, dan data kosong', () => {
  assert.equal(detectPeakHr([]), null);
  assert.equal(detectPeakHr([{ maxHr: null }, {}]), null);
  assert.equal(detectPeakHr([{ maxHr: 188 }]), 188);
  assert.equal(detectPeakHr([{ maxHr: 188 }, { maxHr: 185 }, { maxHr: 170 }]), 188);
  // lonjakan 223 hanya di satu sesi → pakai tertinggi kedua
  assert.equal(detectPeakHr([{ maxHr: 223 }, { maxHr: 188 }, { maxHr: 185 }]), 188);
  // di luar 120–230 diabaikan
  assert.equal(detectPeakHr([{ maxHr: 250 }, { maxHr: 90 }, { maxHr: 176 }]), 176);
  // pelari dengan HR maks rendah tidak ikut terbuang (panduan lama membuang < 140)
  assert.equal(detectPeakHr([{ maxHr: 135 }, { maxHr: 132 }]), 135);
});
