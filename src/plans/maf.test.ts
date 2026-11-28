import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mafFormula, mafHr, mafRaceOutlook, mafZone, mafTests, mafTrend, mafTrendWindow, MAF_5K, MAF_ADJUSTMENTS, normalizeMafAdj, MAF_TOL_HIGH, MAF_TOL_LOW } from './maf.ts';
import { buildPlan, flattenPlan, weekdayOf, dayNum } from './schedule.ts';
import type { PlanOptions, PlanSession } from './schedule.ts';
import { applyAdaptation } from './adaptiveEngine.ts';
import { hrRange } from './hrZones.ts';
import { normalizePlanMode, PLAN_LABEL, resolvePlan, selectBestPlan } from './planSelector.ts';
import { DAY_MS } from '../analytics/workload.ts';
import type { Workout } from '../analytics/types.ts';

// ── Rumus 180 ──────────────────────────────────────────────────────────────

test('HR MAF = 180 − usia, dengan penyesuaian −10 / −5 / 0 / +5', () => {
  assert.equal(mafHr(30), 150);
  assert.equal(mafHr(30, 0), 150);
  assert.equal(mafHr(30, -10), 140);
  assert.equal(mafHr(30, -5), 145);
  assert.equal(mafHr(30, 5), 155);
  assert.equal(mafHr(45, -5), 130);
  assert.equal(mafHr(34.6), 145, 'usia dibulatkan');
});

test('HR MAF: usia ≤ 16 memakai 165 tetap; usia tidak valid → null', () => {
  assert.equal(mafHr(16), 165);
  assert.equal(mafHr(12, -5), 160);
  assert.equal(mafHr(17), 163);
  assert.equal(mafHr(0), null);
  assert.equal(mafHr(150), null);
  assert.equal(mafHr(NaN), null);
  assert.equal(mafHr(null), null);
  assert.equal(mafHr(undefined), null);
});

test('teks rumus cocok dengan HR yang dihitung, termasuk usia ≤ 16 (tidak lagi "180 − 14 = 165")', () => {
  assert.equal(mafFormula(30), '180 − 30 = 150');
  assert.equal(mafFormula(30, -5), '180 − 30 − 5 = 145');
  assert.equal(mafFormula(40, 5), '180 − 40 + 5 = 145');
  assert.equal(mafFormula(14), '165 (usia ≤ 16) = 165');
  assert.equal(mafFormula(14, -5), '165 (usia ≤ 16) − 5 = 160');
  assert.equal(mafFormula(16.4), '165 (usia ≤ 16) = 165', 'usia dibulatkan dulu, sama dengan mafHr');
  assert.equal(mafFormula(null), null);
  assert.equal(mafFormula(NaN), null);
  // Konsistensi: teks dan angka selalu berasal dari usia yang sama.
  for (const age of [5.4, 14, 16, 16.4, 17, 30.5, 45, 64]) for (const adj of [-10, -5, 0, 5] as const) {
    const f = mafFormula(age, adj) as string;
    assert.equal(Number(f.slice(f.lastIndexOf('=') + 2)), mafHr(age, adj), `${age} ${adj}: ${f}`);
  }
});

test('zona MAF = HR MAF turun 10 bpm → HR MAF; hrRange("maf") memakai nilai absolut, bukan persen HR maks', () => {
  assert.deepEqual(mafZone(150), [140, 150]);
  assert.deepEqual(hrRange('maf', 182, 150), [140, 150]);
  assert.deepEqual(hrRange('maf', null, 150), [140, 150], 'tidak butuh HR maks');
  assert.equal(hrRange('maf', 182, null), null);
  assert.deepEqual(hrRange('easy', 182), [130, 150], 'zona lain tidak berubah');
});

test('opsi penyesuaian: 4 pilihan; nilai tersimpan yang tidak valid → 0', () => {
  assert.deepEqual(MAF_ADJUSTMENTS.map((a) => a.value), [-10, -5, 0, 5]);
  assert.equal(normalizeMafAdj(-10), -10);
  assert.equal(normalizeMafAdj(5), 5);
  assert.equal(normalizeMafAdj(7), 0);
  assert.equal(normalizeMafAdj(NaN), 0);
  assert.equal(normalizeMafAdj('x'), 0);
});

// ── MAF Test & pelacakan ───────────────────────────────────────────────────

const NOW = Date.parse('2026-12-20T12:00:00Z');
const wk = (daysAgo: number, o: Partial<Workout> = {}): Workout => ({
  date: NOW - daysAgo * DAY_MS, source: 'manual', workoutType: 'easy', distanceKm: 5, durationSec: 3000, avgPaceSecPerKm: 600,
  avgHr: 148, maxHr: 160, avgCadence: null, elevationGain: null, rpe: null, laps: [], ...o,
});

test('mafTests: sesi ≥ 3 km dengan HR rata-rata −5…+3 bpm dari HR MAF (jenis apa pun kecuali race); urut dari terlama', () => {
  assert.equal(MAF_TOL_LOW, 5);
  assert.equal(MAF_TOL_HIGH, 3);
  const ws = [
    wk(2, { avgHr: 153 }), // +3 → masuk
    wk(30, { avgHr: 145 }), // −5 → masuk
    wk(10, { avgHr: 154 }), // +4 → keluar
    wk(11, { avgHr: 144 }), // −6 → keluar
    wk(12, { distanceKm: 2.9, durationSec: 1700 }), // < 3 km → keluar
    wk(13, { workoutType: 'interval' }), // MAF Test yang dicatat sebagai Interval → masuk
    wk(3, { workoutType: 'tempo' }), // MAF Test yang dicatat sebagai Tempo → masuk
    wk(14, { workoutType: 'race' }), // race → keluar (usaha maksimal, bukan pengukuran di zona)
    wk(15, { avgHr: null }), // tanpa HR → keluar
    wk(5, { workoutType: 'long_run', distanceKm: 8, durationSec: 5000, avgPaceSecPerKm: 625 }),
  ];
  const t = mafTests(ws, 150);
  assert.deepEqual(t.map((p) => Math.round((NOW - p.date) / DAY_MS)), [30, 13, 5, 3, 2]);
  assert.equal(t[2].distanceKm, 8);
  assert.equal(mafTests(ws, null).length, 0);
});

test('MAF Test yang dicatat sebagai Tempo masuk tren: pace pertama → terakhir tetap terhitung', () => {
  const ws = [wk(30, { workoutType: 'tempo', avgPaceSecPerKm: 660 }), wk(2, { workoutType: 'tempo', avgPaceSecPerKm: 630 })];
  assert.deepEqual(mafTrend(mafTests(ws, 150)), { firstPace: 660, lastPace: 630, deltaSec: -30, count: 2, window: 1 });
});

test('mafTests: drift dari lap; mafTrend = selisih pace pertama → terakhir (negatif = membaik)', () => {
  const laps = [140, 140, 150, 150].map((hr, i) => ({ km: i + 1, paceSec: 600, avgHr: hr }));
  const p = mafTests([wk(30, { avgPaceSecPerKm: 660 }), wk(1, { avgPaceSecPerKm: 630, laps })], 150);
  assert.ok(Math.abs((p[1].driftPct ?? 0) - 6.6667) < 0.001);
  assert.equal(p[0].driftPct, null);
  const tr = mafTrend(p);
  assert.deepEqual(tr, { firstPace: 660, lastPace: 630, deltaSec: -30, count: 2, window: 1 });
  assert.equal(mafTrend([p[0]]), null);
  assert.equal(mafTrend([]), null);
});

// ── Tren pace: 2–3 catatan vs ≥ 4 catatan ──────────────────────────────────

const pts = (paces: number[]) => paces.map((p, i) => ({ date: NOW - (paces.length - i) * DAY_MS, distanceKm: 5, avgHr: 150, paceSecPerKm: p, driftPct: null }));

test('mafTrendWindow: min(3, ⌊n/2⌋) → 2–3 catatan = 1; 4–5 = 2; ≥ 6 = 3', () => {
  assert.deepEqual([2, 3, 4, 5, 6, 7, 12].map(mafTrendWindow), [1, 1, 2, 2, 3, 3, 3]);
});

test('mafTrend 2–3 catatan: deltaSec = last − first (titik tengah diabaikan)', () => {
  assert.deepEqual(mafTrend(pts([700, 300, 650])), { firstPace: 700, lastPace: 650, deltaSec: -50, count: 3, window: 1 });
  assert.deepEqual(mafTrend(pts([700, 690])), { firstPace: 700, lastPace: 690, deltaSec: -10, count: 2, window: 1 });
});

test('mafTrend ≥ 4 catatan: rata-rata sampel awal vs terbaru', () => {
  // 4 catatan: k = 2 → (700+690)/2 = 695 vs (600+580)/2 = 590
  const t4 = mafTrend(pts([700, 690, 600, 580]));
  assert.equal(t4?.window, 2);
  assert.equal(t4?.deltaSec, 590 - 695);
  // 6 catatan: k = 3. Sesi panas di awal (900) hanya diredam (dibagi k), tidak dihapus:
  // rata-rata awal = (900+600+590)/3 ≈ 696,7; rata-rata akhir = (585+580+575)/3 = 580.
  // first-vs-last akan memberi 575 − 900 = −325, yang sepenuhnya ditentukan sesi panas itu.
  const hot = mafTrend(pts([900, 600, 590, 585, 580, 575]));
  assert.equal(hot?.window, 3);
  assert.ok(Math.abs((hot?.firstPace ?? NaN) - (900 + 600 + 590) / 3) < 1e-9);
  assert.ok(Math.abs((hot?.lastPace ?? NaN) - 580) < 1e-9);
  assert.ok(Math.abs((hot?.deltaSec ?? NaN) - (580 - (900 + 600 + 590) / 3)) < 1e-9);
  assert.ok(Math.abs(hot!.deltaSec) < Math.abs(575 - 900), 'lebih kecil dari first-vs-last');
  // Tanpa anomali, arah tren sama dengan first-vs-last.
  assert.ok((mafTrend(pts([660, 650, 640, 630, 620, 610]))?.deltaSec ?? 0) < 0);
});

test('mafTrend: null untuk < 2 catatan, dan count tetap jumlah seluruh catatan', () => {
  assert.equal(mafTrend(pts([600])), null);
  assert.equal(mafTrend([]), null);
  assert.equal(mafTrend(pts([600, 599, 598, 597, 596]))?.count, 5);
});

// ── Kurikulum MAF 12 minggu ────────────────────────────────────────────────

const TODAY = '2026-11-15';
const opts = (o: Partial<PlanOptions> = {}): PlanOptions => ({
  raceIso: '2027-02-07', todayIso: TODAY, days: [2, 4, 6, 0], raceName: '5K · Hari Lomba',
  startWeeklyKm: 10, maxWeeklyKm: 40, easyPaceSecPerKm: 600, curriculum: 'maf', maxHr: 182, mafHr: 150, ...o,
});
const all = (p: ReturnType<typeof buildPlan>) => flattenPlan(p);
const mins = (s: { durationMin: number | null }[]) => s.reduce((a, b) => a + (b.durationMin ?? 0), 0);

test('templat MAF: 12 minggu; 4 sesi tiap minggu kecuali taper; MAF Test di minggu 4 dan 8', () => {
  assert.equal(MAF_5K.length, 12);
  assert.deepEqual(MAF_5K.slice(0, 11).map((w) => w.sessions.length), Array(11).fill(4));
  assert.equal(MAF_5K[11].sessions.length, 3);
  assert.deepEqual(MAF_5K.map((w, i) => (w.deload ? i + 1 : 0)).filter(Boolean), [4, 8]);
  assert.deepEqual(MAF_5K.map((w, i) => (w.sessions.some((s) => s.test === 'maf') ? i + 1 : 0)).filter(Boolean), [4, 8]);
  for (const w of MAF_5K) for (const s of w.sessions) assert.equal(s.zone, 'maf');
});

test('templat MAF: tanpa sesi anaerobik; hanya MAF Test yang berjenis speed', () => {
  for (const w of MAF_5K) for (const s of w.sessions) {
    if (s.kind === 'speed') assert.equal(s.test, 'maf');
    assert.ok(['recovery', 'long', 'speed'].includes(s.kind));
  }
});

test('templat MAF: volume menit naik ≤ 10%/minggu (dibanding minggu non-ringan sebelumnya)', () => {
  const total = MAF_5K.map((w) => w.sessions.reduce((a, s) => a + s.durationMin, 0));
  let prev = -1;
  for (let i = 0; i < 11; i++) {
    if (MAF_5K[i].deload) continue;
    if (prev > 0) assert.ok(total[i] <= prev * 1.1 + 1e-9, `minggu ${i + 1}: ${total[i]} vs ${prev}`);
    prev = total[i];
  }
});

test('templat MAF: Long Run ≥ lari MAF terpanjang + 15 menit pada minggu non-ringan', () => {
  for (const w of MAF_5K) {
    if (w.deload) continue;
    const lg = w.sessions.find((s) => s.kind === 'long');
    if (!lg) continue;
    const easyMax = Math.max(...w.sessions.filter((s) => s.kind === 'recovery').map((s) => s.durationMin));
    assert.ok(lg.durationMin - easyMax >= 15, w.title);
  }
});

test('buildPlan MAF: 12 minggu menuju 7 Feb 2027; minggu 1 = 16–22 Nov; hari Sel/Kam/Sab/Min', () => {
  const p = buildPlan(opts());
  assert.equal(p.weeksRemaining, 12);
  assert.equal(p.baseWeeks, 0);
  assert.equal(p.weeks.length, 12);
  assert.equal(p.weeks[0].startIso, '2026-11-16');
  assert.deepEqual(p.weeks[0].sessions.map((s) => s.date), ['2026-11-17', '2026-11-19', '2026-11-21', '2026-11-22']);
  assert.deepEqual(p.weeks[0].sessions.map((s) => s.durationMin), [30, 30, 30, 45]);
  assert.ok(all(p).filter((s) => s.kind !== 'race').every((s) => s.id.startsWith('m')));
});

test('buildPlan MAF: MAF Test Sabtu di minggu 4 (12 Des) dan minggu 8 (9 Jan); race tepat di tanggal lomba', () => {
  const p = buildPlan(opts());
  const tests = all(p).filter((s) => s.test === 'maf');
  assert.deepEqual(tests.map((s) => s.date), ['2026-12-12', '2027-01-09']);
  assert.ok(tests.every((s) => weekdayOf(s.date) === 6 && s.name === 'MAF Test 5 km'));
  const last = all(p).at(-1) as PlanSession;
  assert.equal(last.kind, 'race');
  assert.equal(last.date, '2027-02-07');
  assert.deepEqual(p.weeks[11].sessions.map((s) => s.date), ['2027-02-02', '2027-02-04', '2027-02-06', '2027-02-07']);
  assert.equal(p.weeks[11].phase, 'taper');
  assert.equal(p.weeks[11].sessions[1].durationMin, 20, 'taper tidak dipangkas dua kali');
});

test('buildPlan MAF: target bpm semua sesi MAF = zona MAF (140–150); race memakai zona race', () => {
  const p = buildPlan(opts());
  for (const s of all(p).filter((x) => x.kind !== 'race')) assert.deepEqual(s.hr, [140, 150], s.id);
  assert.deepEqual(all(p).at(-1)?.hr, [164, 173]);
  const adj = buildPlan(opts({ mafHr: 140 }));
  assert.deepEqual(adj.weeks[0].sessions[0].hr, [130, 140]);
  const noAge = buildPlan(opts({ mafHr: null }));
  assert.equal(noAge.weeks[0].sessions[0].hr, null);
});

test('buildPlan MAF: Long Run Minggu; skala mengikuti weeksRemaining (> 12 → Base MAF; < 12 → minggu terakhir)', () => {
  const p = buildPlan(opts());
  for (const w of p.weeks) { const lg = w.sessions.find((x) => x.kind === 'long'); if (lg) assert.equal(weekdayOf(lg.date), 0); }
  const long = buildPlan(opts({ raceIso: '2027-03-14' })); // 17 minggu
  assert.equal(long.baseWeeks, 5);
  assert.ok(long.weeks.slice(0, 5).every((w) => w.phase === 'base' && w.sessions.every((s) => s.zone === 'maf' && s.hr?.[1] === 150)));
  assert.equal(long.weeks[5].sessions[0].id, 'm0-0');
  assert.equal(all(long).at(-1)?.date, '2027-03-14');
  const short = buildPlan(opts({ raceIso: '2026-12-20' })); // 5 minggu
  assert.equal(short.weeks.length, 5);
  assert.equal(short.weeks[0].sessions[0].id.startsWith('m7-'), true);
  assert.equal(all(short).at(-1)?.kind, 'race');
});

test('buildPlan MAF: Base (sisa > 12 minggu) tetap memenuhi Long Run ≥ Easy + 1,5 km atau + 15 menit', () => {
  const p = buildPlan(opts({ raceIso: '2027-04-04', easyPaceSecPerKm: 541 }));
  for (const w of p.weeks.filter((x) => x.phase === 'base')) {
    const easy = w.sessions.filter((s) => s.kind === 'recovery');
    const lg = w.sessions.find((s) => s.kind === 'long');
    if (!lg || !easy.length) continue;
    const eKm = Math.max(...easy.map((s) => s.distanceKm as number)), eMin = Math.max(...easy.map((s) => s.durationMin as number));
    assert.ok((lg.distanceKm as number) - eKm >= 1.5 - 0.051 || (lg.durationMin as number) - eMin >= 15, `minggu ${w.weekNo}`);
  }
});

test('MAF Test tidak ikut aturan Speed: ACWR tinggi tidak mengubahnya jadi Recovery, EF naik tidak mempercepat pace', () => {
  const p = buildPlan(opts());
  const flat = all(p);
  const testS = flat.find((s) => s.test === 'maf') as PlanSession;
  const dec = { highLoad: true, efUp: true, efGainPct: 5, driftHigh: false, addVolume: false };
  const r = applyAdaptation(flat, dec, TODAY, new Set(), 182);
  const after = r.sessions.find((s) => s.id === testS.id) as PlanSession;
  assert.equal(after.kind, 'speed');
  assert.equal(after.paceDeltaSec, undefined);
  assert.equal(after.adjDurationMin, undefined);
  assert.ok(r.notes.every((n) => n.sessionId !== testS.id), 'MAF Test tidak pernah diberi catatan');
  // Bonus beban rendah tetap ke Long Run MAF berikutnya
  const r2 = applyAdaptation(flat, { highLoad: false, efUp: false, efGainPct: null, driftHigh: false, addVolume: true }, TODAY, new Set(), 182);
  assert.equal(r2.notes.length, 1);
  assert.equal(r2.sessions.find((s) => s.id === r2.notes[0].sessionId)?.kind, 'long');
});

test('ACWR tinggi di program MAF: lari MAF berikutnya −20% durasi, zona tetap; sesi lain tidak berubah', () => {
  const flat = all(buildPlan(opts()));
  const next = flat.find((s) => s.zone === 'maf' && s.test !== 'maf' && dayNum(s.date) >= dayNum(TODAY)) as PlanSession;
  const r = applyAdaptation(flat, { highLoad: true, efUp: false, efGainPct: null, driftHigh: false, addVolume: false }, TODAY, new Set(), 182);
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].code, 'high_load');
  assert.equal(r.notes[0].sessionId, next.id);
  assert.match(r.notes[0].reason, /ACWR di atas 1,3: durasi lari MAF berikutnya −20% \(30 menit → 24 menit\)/);
  const after = r.sessions.find((s) => s.id === next.id) as PlanSession;
  assert.equal(after.adjDurationMin, (next.durationMin as number) * 0.8);
  assert.deepEqual(after.hr, [140, 150], 'batas detak jantung tidak berubah');
  assert.equal(after.kind, next.kind, 'jenis sesi tetap');
  assert.equal(after.distanceKm, next.distanceKm, 'jarak asal tidak diubah; UI menghitung jarak dari durasi yang disesuaikan');
  for (const s of r.sessions) if (s.id !== next.id) assert.equal(s.adjDurationMin, undefined, s.id);
});

test('ACWR tinggi di program MAF melewati MAF Test: beban menyasar lari MAF sesudahnya, bukan tesnya', () => {
  const flat = all(buildPlan(opts()));
  const testS = flat.find((s) => s.test === 'maf') as PlanSession; // Sabtu 12 Des
  assert.equal(testS.date, '2026-12-12');
  const todayIso = '2026-12-11'; // Jumat: MAF Test adalah sesi berikutnya
  const expected = flat.find((s) => s.zone === 'maf' && s.test !== 'maf' && dayNum(s.date) > dayNum(testS.date)) as PlanSession;
  const r = applyAdaptation(flat, { highLoad: true, efUp: false, efGainPct: null, driftHigh: false, addVolume: false }, todayIso, new Set(), 182);
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].sessionId, expected.id, `${expected.date} bukan ${testS.date}`);
  assert.equal(r.sessions.find((s) => s.id === testS.id)?.adjDurationMin, undefined);
});

test('MAF tidak mengubah program lain: Nike & Progresif tetap sama; mode manual "maf" dikenali', () => {
  const nike = buildPlan(opts({ curriculum: 'nike5k', raceIso: '2027-01-10' }));
  assert.equal(nike.weeks.length, 8);
  assert.ok(all(nike).filter((s) => s.kind !== 'race').every((s) => s.id.startsWith('n') && s.zone !== 'maf'));
  const prog = buildPlan(opts({ curriculum: 'progressive5k', raceIso: '2027-01-31' }));
  assert.equal(prog.weeks.length, 11);
  assert.ok(all(prog).every((s) => s.zone !== 'maf'));
  assert.equal(normalizePlanMode('maf'), 'maf');
  assert.equal(normalizePlanMode('mmm'), 'auto');
  assert.ok(PLAN_LABEL.maf.includes('MAF'));
  const sel = selectBestPlan([], { maxHr: 182 }, { now: NOW, projected5kSec: 2000 });
  assert.notEqual(sel.plan, 'maf', 'rekomendasi otomatis tidak berubah');
  assert.equal(resolvePlan('maf', sel), 'maf');
  assert.equal(resolvePlan('auto', sel), sel.plan);
});

test('semua tanggal sesi MAF unik, tidak di masa lalu, dan berurutan', () => {
  const s = all(buildPlan(opts()));
  assert.equal(new Set(s.map((x) => x.date)).size, s.length);
  assert.ok(s.every((x) => dayNum(x.date) >= dayNum(TODAY)));
  assert.ok(mins(s) > 0);
});

// ── Proyeksi race & lini masa adaptasi ─────────────────────────────────────

test('mafRaceOutlook tanpa catatan pace MAF: tanpa proyeksi, lini masa dan HR race tetap ada', () => {
  const o = mafRaceOutlook({ mafPaceSecPerKm: null, maxHr: 182, targetDistance: '5K', weeksRemaining: 10 });
  assert.equal(o.projection, null);
  assert.deepEqual(o.timeline.earlyWeeks, [3, 6]);
  assert.deepEqual(o.timeline.earlyGainSec, [15, 30]);
  assert.deepEqual(o.timeline.fullWeeks, [12, 24]);
  assert.deepEqual(o.raceHr, hrRange('race', 182));
  assert.deepEqual(o.raceHr, [164, 173]);
  assert.ok(o.splits.middle.includes('164–173'));
  for (const bad of [0, -5, NaN]) {
    assert.equal(mafRaceOutlook({ mafPaceSecPerKm: bad, maxHr: 182, targetDistance: '5K', weeksRemaining: 10 }).projection, null);
  }
});

test('mafRaceOutlook tanpa HR maks: raceHr null dan segmen tengah memakai teks persen', () => {
  for (const maxHr of [null, 0]) {
    const o = mafRaceOutlook({ mafPaceSecPerKm: 400, maxHr, targetDistance: '5K', weeksRemaining: 10 });
    assert.equal(o.raceHr, null);
    assert.ok(o.splits.middle.includes('90–95% HR maks'));
    assert.ok(o.projection, 'proyeksi pace tidak bergantung HR maks');
  }
});

test('mafRaceOutlook 5K: pace = MAF − 150…−90 dtk/km; waktu = pace × 5', () => {
  const o = mafRaceOutlook({ mafPaceSecPerKm: 420, maxHr: 182, targetDistance: '5K', weeksRemaining: 2 });
  assert.deepEqual(o.projection?.paceNow, [270, 330]);
  assert.deepEqual(o.projection?.timeNow, [1350, 1650]);
  assert.equal(o.projection?.raceDay, null, 'sisa < 4 minggu: tanpa simulasi hari lomba');
});

test('mafRaceOutlook 10K: pace diskalakan (10/5) ** 0.06 dan waktu = pace × 10', () => {
  const o = mafRaceOutlook({ mafPaceSecPerKm: 420, maxHr: 182, targetDistance: '10K', weeksRemaining: null });
  const k = 2 ** 0.06;
  assert.deepEqual(o.projection?.paceNow, [Math.round(270 * k), Math.round(330 * k)]);
  assert.deepEqual(o.projection?.timeNow, [Math.round(Math.round(270 * k) * 10), Math.round(Math.round(330 * k) * 10)]);
  const five = mafRaceOutlook({ mafPaceSecPerKm: 420, maxHr: 182, targetDistance: '5K', weeksRemaining: null });
  assert.ok((o.projection?.paceNow[0] as number) > (five.projection?.paceNow[0] as number), '10K sedikit lebih lambat per km');
});

test('mafRaceOutlook weeksRemaining ≥ 4: simulasi hari lomba, 12 dtk/km per 4 minggu penuh', () => {
  const at = (w: number) => mafRaceOutlook({ mafPaceSecPerKm: 420, maxHr: 182, targetDistance: '5K', weeksRemaining: w }).projection?.raceDay;
  assert.equal(at(3), null);
  assert.equal(at(4)?.gainSecPerKm, 12);
  assert.deepEqual(at(4)?.pace, [258, 318]);
  assert.deepEqual(at(4)?.time, [1290, 1590]);
  assert.equal(at(7)?.gainSecPerKm, 12, 'blok 4 minggu penuh saja');
  assert.equal(at(12)?.gainSecPerKm, 36);
  assert.equal(at(100)?.gainSecPerKm, 72, 'dibatasi 24 minggu');
  const now = mafRaceOutlook({ mafPaceSecPerKm: 420, maxHr: 182, targetDistance: '5K', weeksRemaining: 12 }).projection;
  assert.ok((now?.raceDay?.time[0] as number) < (now?.timeNow[0] as number), 'proyeksi hari lomba lebih cepat');
});

test('mafRaceOutlook catatan sisa minggu: null / terlewat / singkat / awal / penuh', () => {
  const note = (w: number | null) => mafRaceOutlook({ mafPaceSecPerKm: null, maxHr: null, targetDistance: '5K', weeksRemaining: w }).timeline.weeksNote;
  assert.equal(note(null), null);
  assert.ok(note(0)?.includes('terlewat'));
  assert.ok(note(2)?.includes('2 minggu') && note(2)?.includes('terlalu singkat'));
  assert.ok(note(8)?.includes('8 minggu') && note(8)?.includes('tanda awal'));
  assert.ok(note(16)?.includes('16 minggu') && note(16)?.includes('adaptasi aerobik penuh'));
});

test('latestMafPaceSec: pace sesi zona-MAF terbaru; null bila tidak ada; mengabaikan sesi setelah now', async () => {
  const { latestMafPaceSec } = await import('./maf.ts');
  const maf = mafHr(34, 0) as number; // 180 − 34 = 146
  const w = (daysAgo: number, avgHr: number, pace: number, type = 'easy') => ({
    id: daysAgo, date: Date.UTC(2026, 10, 22) - daysAgo * DAY_MS, source: 'manual', workoutType: type,
    distanceKm: 5, durationSec: pace * 5, avgPaceSecPerKm: pace, avgHr, maxHr: 170, avgCadence: null,
    elevationGain: 0, rpe: 4, laps: [],
  }) as never;
  const now = Date.UTC(2026, 10, 22, 12);
  const ws = [w(20, maf - 2, 420), w(10, maf - 1, 405), w(3, maf + 25, 330), w(1, maf - 3, 400, 'race')];
  assert.equal(latestMafPaceSec(ws, 34, 0, now), 405, 'sesi HR jauh di atas MAF dan race tidak dihitung');
  assert.equal(latestMafPaceSec([w(3, maf + 25, 330)], 34, 0, now), null);
  assert.equal(latestMafPaceSec([], 34, 0, now), null);
  assert.equal(latestMafPaceSec(ws, null, 0, now), null, 'usia tidak diketahui');
  assert.equal(latestMafPaceSec(ws, 34, 0, Date.UTC(2026, 10, 5)), 420, 'sesi setelah now diabaikan');
});

