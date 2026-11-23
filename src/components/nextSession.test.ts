import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { UserProfile, Workout } from '../analytics/types.ts';
import { DAY_MS } from '../analytics/workload.ts';
import { fmtRangeKm } from '../plans/pace.ts';
import { nextSession } from './nextSession.ts';

// localStorage tiruan: lingkungan tes Node tidak punya penyimpanan browser.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

const NOW = Date.now();
// Lomba 70 hari dari sekarang: kalender mundur selalu memakai 12 minggu terakhir kurikulum (tanpa bergantung pada tanggal hari ini).
const profile = (age: number): UserProfile => ({
  id: 'default', age, restingHr: 55, maxHr: 180, targetDistance: '5K',
  targetRaceDate: NOW + 70 * DAY_MS, targetTimeSec: 1500,
});
const run = (daysAgo: number, o: Partial<Workout> = {}): Workout => ({
  date: NOW - daysAgo * DAY_MS, source: 'manual', workoutType: 'easy', distanceKm: 4, durationSec: 2480,
  avgPaceSecPerKm: 620, avgHr: 138, maxHr: 150, avgCadence: null, elevationGain: null, rpe: null, laps: [], ...o,
});

beforeEach(() => store.clear());

test('MAF tanpa catatan zona MAF: hr dari HR MAF, pace kosong (bukan pace VDOT)', () => {
  store.set('pacelab.planMode', 'maf');
  const n = nextSession(profile(40), [], NOW);
  assert.ok(n);
  assert.equal(n.session.zone, 'maf');
  assert.deepEqual(n.hr, [130, 140], 'HR MAF 180 − 40 = 140, zona 130–140');
  assert.equal(n.paceText, null, 'patokan pace belum ada; UI menampilkan "Sesuai HR"');
});

test('MAF dengan catatan zona MAF: pace patokan = catatan terakhir (+ penyesuaian adaptif sesi)', () => {
  store.set('pacelab.planMode', 'maf');
  const n = nextSession(profile(40), [run(1)], NOW);
  assert.ok(n);
  assert.equal(n.session.zone, 'maf');
  assert.equal(n.paceText, fmtRangeKm(620 + (n.session.paceDeltaSec ?? 0)));
});

test('penyesuaian kondisi MAF (−10) menggeser batas HR sesi MAF', () => {
  store.set('pacelab.planMode', 'maf');
  store.set('pacelab.mafAdj', '-10');
  const n = nextSession(profile(40), [], NOW);
  assert.deepEqual(n?.hr, [120, 130], 'HR MAF 130 → zona 120–130');
});

test('usia belum diisi: hr dan pace kosong, tidak ada angka tebakan', () => {
  store.set('pacelab.planMode', 'maf');
  const n = nextSession(profile(0), [run(1)], NOW);
  assert.ok(n);
  assert.equal(n.hr, null);
  assert.equal(n.paceText, null);
});

test('program non-MAF tidak berubah: sesi Easy tetap punya pace target', () => {
  store.set('pacelab.planMode', 'progressive5k');
  const n = nextSession(profile(40), [], NOW);
  assert.ok(n);
  assert.notEqual(n.session.zone, 'maf');
  assert.ok(n.session.kind === 'recovery' || n.session.kind === 'long' || n.session.kind === 'speed', n.session.kind);
  if (n.session.kind === 'recovery' || n.session.kind === 'long') assert.notEqual(n.paceText, null);
});
