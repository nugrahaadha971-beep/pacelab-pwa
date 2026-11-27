import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWeekRange, weekDays } from './weekDays.ts';

test('weekDays: 7 hari berurutan melewati pergantian bulan dan tahun', () => {
  const d = weekDays('2026-12-29');
  assert.deepEqual(d.map((x) => x.iso), [
    '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04',
  ]);
  assert.deepEqual(d.map((x) => x.dayLabel), ['Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min', 'Sen']);
});

test('weekDays: tidak terpengaruh zona waktu (hari selalu bertambah tepat 1)', () => {
  const d = weekDays('2027-03-27');
  assert.equal(d[1].iso, '2027-03-28');
  assert.equal(d[6].iso, '2027-04-02');
});

test('formatWeekRange: satu tahun vs lintas tahun', () => {
  assert.equal(formatWeekRange('2026-12-14', '2026-12-20'), '14 Des – 20 Des 2026');
  assert.equal(formatWeekRange('2026-12-29', '2027-01-04'), '29 Des 2026 – 4 Jan 2027');
});
