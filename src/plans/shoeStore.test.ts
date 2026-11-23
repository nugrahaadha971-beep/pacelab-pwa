import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addShoe,
  calcAllShoesMileage,
  calcShoeMileage,
  DEFAULT_SHOE,
  deleteShoe,
  migrateLegacyShoe,
  normalizeShoeConfig,
  normalizeShoeList,
  parseKmInput,
  retireShoe,
  setDefaultShoe,
  updateShoeKm,
  type ShoeItem,
} from './shoeStore.ts';

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

  it('migrateLegacyShoe memigrasikan data pacelab_shoe lama menjadi ShoeItem pertama dengan isDefault: true', () => {
    const migrated = migrateLegacyShoe({ name: 'ASICS Cumulus', initialKm: 120, maxKm: 750 });
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0].name, 'ASICS Cumulus');
    assert.equal(migrated[0].initialKm, 120);
    assert.equal(migrated[0].maxKm, 750);
    assert.equal(migrated[0].isDefault, true);
  });

  it('calcAllShoesMileage hanya menjumlahkan sesi dengan shoeId === shoe.id (tidak mengaitkan sesi lama tanpa shoeId)', () => {
    const shoes: ShoeItem[] = [
      { id: 's1', name: 'Daily Trainer', initialKm: 50, maxKm: 800, isDefault: true },
      { id: 's2', name: 'Tempo Shoe', initialKm: 580, maxKm: 800, isDefault: false },
      { id: 's3', name: 'Old Shoe', initialKm: 790, maxKm: 800, isDefault: false, retired: true },
    ];
    const workouts = [
      { distanceKm: 10 }, // tanpa shoeId -> TIDAK boleh dijumlahkan otomatis ke s1
      { distanceKm: 15, shoeId: 's1' },
      { distanceKm: 20, shoeId: 's2' }, // 580 + 20 = 600 (75% -> warn)
      { distanceKm: 5, shoeId: 's3' }, // sepatu retired tidak tampil & tidak masuk default
    ];

    const res = calcAllShoesMileage(workouts, shoes);
    assert.equal(res.length, 2);
    assert.equal(res[0].shoe.id, 's1');
    assert.equal(res[0].loggedKm, 15);
    assert.equal(res[0].totalKm, 65);
    assert.equal(res[0].status, 'good');

    assert.equal(res[1].shoe.id, 's2');
    assert.equal(res[1].loggedKm, 20);
    assert.equal(res[1].totalKm, 600);
    assert.equal(res[1].remainingKm, 200);
    assert.equal(res[1].pct, 75);
    assert.equal(res[1].status, 'warn');
  });

  it('parseKmInput, addShoe, dan updateShoeKm menormalisasi koma ke titik dan menjaga presisi 2 desimal (misal 2.19 km)', () => {
    assert.equal(parseKmInput('2,19'), 2.19);
    assert.equal(parseKmInput(' 2.194 '), 2.19);
    assert.equal(parseKmInput('2.196'), 2.2);
    assert.equal(parseKmInput('abc'), null);

    let list = addShoe([], { name: 'Novablast 5', initialKm: '2,19', maxKm: 800 });
    assert.equal(list[0].initialKm, 2.19);

    // Meski ada riwayat lari lama tanpa shoeId, sepatu baru tetap menunjukkan 2.19 km
    const oldRuns = [{ distanceKm: 42.2 }, { distanceKm: 10 }];
    const mileage = calcAllShoesMileage(oldRuns, list);
    assert.equal(mileage[0].totalKm, 2.19);
    assert.equal(mileage[0].remainingKm, 797.81);

    // Edit KM manual
    list = updateShoeKm(list, list[0].id, '14,55');
    assert.equal(list[0].initialKm, 14.55);
    assert.equal(calcAllShoesMileage(oldRuns, list)[0].totalKm, 14.55);
  });

  it('addShoe, setDefaultShoe, retireShoe, dan deleteShoe selalu menjaga tepat satu sepatu aktif utama', () => {
    let list = addShoe([], { name: 'Peg 41', initialKm: 0, maxKm: 800 });
    assert.equal(list.length, 1);
    assert.equal(list[0].isDefault, true);

    list = addShoe(list, { name: 'Vaporfly', initialKm: 10, maxKm: 400 });
    assert.equal(list.length, 2);
    assert.equal(list[0].isDefault, true);
    assert.equal(list[1].isDefault, false);

    list = setDefaultShoe(list, list[1].id);
    assert.equal(list[0].isDefault, false);
    assert.equal(list[1].isDefault, true);

    list = retireShoe(list, list[1].id);
    assert.equal(list[1].retired, true);
    assert.equal(list[1].isDefault, false);
    assert.equal(list[0].isDefault, true);

    list = deleteShoe(list, list[0].id);
    assert.equal(list.filter((s) => !s.retired).length, 0);
    assert.equal(normalizeShoeList(list).every((s) => !s.isDefault), true);
  });
});
