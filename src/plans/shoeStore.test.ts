import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcShoeMileage, DEFAULT_SHOE, normalizeShoeConfig } from './shoeStore.ts';

const ts = (iso: string) => new Date(`${iso}T07:00:00`).getTime();

describe('shoeStore', () => {
  it('normalizeShoeConfig mengembalikan default aman saat input rusak', () => {
    assert.deepEqual(normalizeShoeConfig(null), DEFAULT_SHOE);
    assert.deepEqual(
      normalizeShoeConfig({ name: '  ASICS Cumulus  ', initialKm: -5, maxKm: 0, startDate: 'bukan-tanggal' }),
      { name: 'ASICS Cumulus', initialKm: 0, maxKm: 800, startDate: '' },
    );
  });

  it('calcShoeMileage menjumlahkan seluruh sesi jika startDate kosong dan menambahkan initialKm', () => {
    const workouts = [
      { date: ts('2026-10-01'), distanceKm: 5 },
      { date: ts('2026-10-10'), distanceKm: 10.5 },
    ];
    const res = calcShoeMileage(workouts, { name: 'Sepatu Utama', initialKm: 100, maxKm: 800, startDate: '' });
    assert.equal(res.totalKm, 115.5);
    assert.equal(res.remainingKm, 684.5);
    assert.equal(res.status, 'good');
  });

  it('calcShoeMileage memfilter sesi mulai dari startDate (>= startDate)', () => {
    const workouts = [
      { date: ts('2026-10-01'), distanceKm: 50 },
      { date: ts('2026-10-15'), distanceKm: 12 },
      { date: ts('2026-10-20'), distanceKm: 8 },
    ];
    const res = calcShoeMileage(workouts, { name: 'ASICS', initialKm: 10, maxKm: 800, startDate: '2026-10-15' });
    assert.equal(res.totalKm, 30);
    assert.equal(res.remainingKm, 770);
    assert.equal(res.status, 'good');
  });

  it('calcShoeMileage mengklasifikasikan status good (<75%), warn (75–94%), dan replace (>=95%)', () => {
    const good = calcShoeMileage([{ date: ts('2026-11-01'), distanceKm: 599 }], { name: 'A', initialKm: 0, maxKm: 800 });
    assert.equal(good.status, 'good');

    const warn = calcShoeMileage([{ date: ts('2026-11-01'), distanceKm: 600 }], { name: 'A', initialKm: 0, maxKm: 800 });
    assert.equal(warn.status, 'warn');
    assert.equal(warn.pct, 75);

    const warnHigh = calcShoeMileage([{ date: ts('2026-11-01'), distanceKm: 759 }], { name: 'A', initialKm: 0, maxKm: 800 });
    assert.equal(warnHigh.status, 'warn');

    const replace = calcShoeMileage([{ date: ts('2026-11-01'), distanceKm: 760 }], { name: 'A', initialKm: 0, maxKm: 800 });
    assert.equal(replace.status, 'replace');
    assert.equal(replace.pct, 95);

    const over = calcShoeMileage([{ date: ts('2026-11-01'), distanceKm: 850 }], { name: 'A', initialKm: 0, maxKm: 800 });
    assert.equal(over.status, 'replace');
    assert.equal(over.remainingKm, 0);
  });
});
