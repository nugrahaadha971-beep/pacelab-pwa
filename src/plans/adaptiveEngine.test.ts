import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAdaptation, BADGE, evaluateAdaptation, gatherAdaptiveInput, pbOutlook, weekPace,
} from './adaptiveEngine.ts';
import type { AdaptiveDecision, AdaptiveInput } from './adaptiveEngine.ts';
import { buildPlan, flattenPlan } from './schedule.ts';
import { calibrateFrom3k, intervalPaceRange, TEST3K_FACTOR } from './adaptiveEngine.ts';
import type { PlanSession } from './schedule.ts';
import { targetForAdjusted, targetFor } from './pace.ts';
import { DAY_MS } from '../analytics/workload.ts';
import type { UserProfile, Workout } from '../analytics/types.ts';

const TODAY = '2026-11-20';
const none: AdaptiveDecision = { highLoad: false, efUp: false, efGainPct: null, driftHigh: false, addVolume: false };
const IN: AdaptiveInput = { acwrRatio: 1, lastEf: null, avgEf14: null, lastDriftPct: null };

const S = (id: string, kind: PlanSession['kind'], date: string, durationMin: number | null = 40): PlanSession => ({
  id, weekNo: 1, phase: 'build', kind, name: id, steps: kind === 'speed' ? ['5:00 Warm Up', '5 x 4:00 5K Pace'] : [], date, baseDate: date,
  distanceKm: null, durationMin, note: kind === 'speed' ? 'x' : undefined,
});
const list = () => [
  S('past-speed', 'speed', '2026-11-18'),
  S('rec1', 'recovery', '2026-11-21', 40),
  S('speed1', 'speed', '2026-11-22', 50),
  S('speed2', 'speed', '2026-11-24', 50),
  S('long1', 'long', '2026-11-26', 120),
  S('race', 'race', '2026-12-06', null),
];
const get = (r: { sessions: PlanSession[] }, id: string) => r.sessions.find((s) => s.id === id) as PlanSession;

// ── Progresi pace ──────────────────────────────────────────────────────────────

test('weekPace: interpolasi linear currentPace → targetPace; minggu terakhir = target', () => {
  assert.equal(weekPace(330, 300, 5, 10), 315);
  assert.equal(weekPace(330, 300, 1, 10), 327);
  assert.equal(weekPace(330, 300, 10, 10), 300);
  const seq = [1, 2, 3, 4, 5, 6].map((w) => weekPace(330, 300, w, 6));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] < seq[i - 1]);
  assert.ok(seq[0] < 330 && seq[0] >= 300);
});

test('weekPace: proyeksi sudah lebih cepat dari target → tahan di pace target (tidak melambat)', () => {
  assert.equal(weekPace(290, 300, 3, 8), 300);
  assert.equal(weekPace(300, 300, 3, 8), 300);
});

test('pbOutlook: gap waktu, kebutuhan perbaikan per minggu, dan label peluang', () => {
  const o = pbOutlook(1530, 1500, 6); // 5K proyeksi 25:30, target 25:00
  assert.equal(o.gapSec, 30);
  assert.equal(o.gapPct, 2);
  assert.equal(o.perWeekSec, 5);
  assert.equal(o.label, 'Sangat realistis');
  assert.equal(pbOutlook(1400, 1500, 6).gapSec, -100);
  assert.equal(pbOutlook(1400, 1500, 6).perWeekSec, null);
  assert.equal(pbOutlook(1400, 1500, 6).label, 'Proyeksi sudah di bawah target');
  assert.equal(pbOutlook(1600, 1500, 0).perWeekSec, null);
  assert.equal(pbOutlook(1700, 1500, 4).label, 'Sangat menantang');
});

test('targetForAdjusted: menggeser pace per km dan per mil; pace best tidak digeser', () => {
  const row = [420, 1425, 460, 475, 495, 560];
  assert.equal(targetForAdjusted('k5', row, 0), targetFor('k5', row));
  assert.equal(targetForAdjusted('k5', row, -4), '7:34/mi · 4:42/km'); // 460 − 6,44 = 453,56 s/mi; 281,9 s/km
  assert.equal(targetForAdjusted('rec', row, 12), '9:39/mi · 6:00/km'); // 560 + 19,3 = 579,3 s/mi
  assert.equal(targetForAdjusted('best', row, -4), 'sesuai effort Anda');
});

// ── Evaluasi ambang ──────────────────────────────────────────────────────────

test('ACWR > 1,3 (tepat 1,3 tidak)', () => {
  assert.equal(evaluateAdaptation({ ...IN, acwrRatio: 1.3 }).highLoad, false);
  assert.equal(evaluateAdaptation({ ...IN, acwrRatio: 1.31 }).highLoad, true);
});

test('EF sesi terakhir ≥ +3% di atas rata-rata 14 hari', () => {
  assert.equal(evaluateAdaptation({ ...IN, lastEf: 1.03, avgEf14: 1 }).efUp, true);
  assert.equal(evaluateAdaptation({ ...IN, lastEf: 1.029, avgEf14: 1 }).efUp, false);
  assert.equal(evaluateAdaptation({ ...IN, lastEf: 1.2, avgEf14: null }).efUp, false);
  assert.ok(Math.abs((evaluateAdaptation({ ...IN, lastEf: 1.05, avgEf14: 1 }).efGainPct ?? 0) - 5) < 1e-9);
});

test('Drift > 5% (tepat 5 tidak); ACWR < 0,8 dan drift ≤ 5% → tambah volume', () => {
  assert.equal(evaluateAdaptation({ ...IN, lastDriftPct: 5 }).driftHigh, false);
  assert.equal(evaluateAdaptation({ ...IN, lastDriftPct: 5.1 }).driftHigh, true);
  assert.equal(evaluateAdaptation({ ...IN, acwrRatio: 0.79, lastDriftPct: 5 }).addVolume, true);
  assert.equal(evaluateAdaptation({ ...IN, acwrRatio: 0.8, lastDriftPct: 3 }).addVolume, false);
  assert.equal(evaluateAdaptation({ ...IN, acwrRatio: 0.5, lastDriftPct: 6 }).addVolume, false);
  assert.equal(evaluateAdaptation({ ...IN, acwrRatio: 0.5, lastDriftPct: null }).addVolume, true);
  assert.equal(evaluateAdaptation({ ...IN, acwrRatio: null }).addVolume, false);
});

// ── Penerapan pada jadwal ─────────────────────────────────────────────────────

test('Aturan 1: ACWR tinggi → Speed berikutnya jadi Recovery Easy Run, durasi −20%, badge', () => {
  const r = applyAdaptation(list(), { ...none, highLoad: true }, TODAY, new Set());
  const s = get(r, 'speed1');
  assert.equal(s.kind, 'recovery');
  assert.equal(s.convertedFrom, 'speed');
  assert.equal(s.name, 'Recovery Easy Run');
  assert.equal(s.adjDurationMin, 40); // 50 × 0,8
  assert.equal(s.adjustments?.[0].badge, 'Disesuaikan: Beban Tinggi (ACWR)');
  assert.equal(BADGE.high_load, 'Disesuaikan: Beban Tinggi (ACWR)');
  assert.equal(get(r, 'speed2').kind, 'speed', 'hanya Speed berikutnya');
  assert.equal(get(r, 'past-speed').kind, 'speed', 'sesi lampau tidak disentuh');
  assert.equal(r.notes.length, 1);
});

test('Sesi yang sudah selesai dilewati; Speed berikutnya = yang belum selesai', () => {
  const r = applyAdaptation(list(), { ...none, highLoad: true }, TODAY, new Set(['speed1']));
  assert.equal(get(r, 'speed1').kind, 'speed');
  assert.equal(get(r, 'speed2').kind, 'recovery');
});

test('Aturan 2: EF naik ≥ 3% → target pace Speed berikutnya −4 dtk/km dengan badge', () => {
  const r = applyAdaptation(list(), { ...none, efUp: true, efGainPct: 4.2 }, TODAY, new Set());
  assert.equal(get(r, 'speed1').paceDeltaSec, -4);
  assert.equal(get(r, 'speed1').kind, 'speed');
  assert.equal(get(r, 'speed1').adjustments?.[0].badge, 'Target Pace Ditingkatkan (+Efisiensi)');
  assert.equal(get(r, 'speed2').paceDeltaSec, undefined);
});

test('Aturan 1 menang atas aturan 2 pada sesi yang sama (beban tinggi menunda kenaikan pace)', () => {
  const r = applyAdaptation(list(), { ...none, highLoad: true, efUp: true, efGainPct: 4 }, TODAY, new Set());
  assert.equal(get(r, 'speed1').kind, 'recovery');
  assert.equal(get(r, 'speed1').paceDeltaSec, undefined);
  assert.ok(r.notes.some((n) => n.code === 'ef_up_held'));
});

test('Aturan 3: drift > 5% → pace Easy Run berikutnya +12 dtk/km', () => {
  const r = applyAdaptation(list(), { ...none, driftHigh: true }, TODAY, new Set());
  assert.equal(get(r, 'rec1').paceDeltaSec, 12);
  assert.equal(get(r, 'speed1').paceDeltaSec, undefined);
  assert.equal(get(r, 'long1').paceDeltaSec, undefined);
});

test('Aturan 4: +10% durasi (maks +10 menit) hanya pada Long Run berikutnya, bukan Recovery Run', () => {
  const r = applyAdaptation(list(), { ...none, addVolume: true }, TODAY, new Set());
  assert.equal(get(r, 'rec1').adjDurationMin, undefined, 'Recovery tidak mendapat bonus');
  assert.equal(get(r, 'long1').adjDurationMin, 130); // 10% dari 120 = 12 → dibatasi 10
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].sessionId, 'long1');
  const short = list().map((s) => (s.id === 'long1' ? { ...s, durationMin: 40 } : s));
  assert.ok(Math.abs((get(applyAdaptation(short, { ...none, addVolume: true }, TODAY, new Set()), 'long1').adjDurationMin as number) - 44) < 1e-9);
  const noLong = applyAdaptation(list().filter((s) => s.kind !== 'long'), { ...none, addVolume: true }, TODAY, new Set());
  assert.equal(noLong.notes.length, 0, 'tanpa Long Run mendatang tidak ada bonus');
});

test('Sesi Speed yang dialihkan menjadi Recovery mendapat zona HR mudah', () => {
  const r = applyAdaptation(list(), { ...none, highLoad: true }, TODAY, new Set(), 182);
  assert.equal(get(r, 'speed1').zone, 'easy');
  assert.deepEqual(get(r, 'speed1').hr, [130, 150]);
});

test('Hari lomba tidak pernah diubah; tanpa aturan aktif tidak ada perubahan', () => {
  const all = { ...none, highLoad: true, efUp: true, driftHigh: true, addVolume: true };
  const r = applyAdaptation(list().filter((s) => s.kind === 'race'), all, TODAY, new Set());
  assert.deepEqual(r.sessions, list().filter((s) => s.kind === 'race'));
  const r0 = applyAdaptation(list(), none, TODAY, new Set());
  assert.deepEqual(r0.sessions, list());
  assert.equal(r0.notes.length, 0);
});

// ── Pengumpulan input dari catatan latihan ───────────────────────────────────

const P = { id: 'default', age: 30, restingHr: 50, maxHr: 190, targetDistance: '5K', targetRaceDate: 0, targetTimeSec: 1500 } as UserProfile;
const NOW = Date.parse('2026-11-20T12:00:00Z');
const wk = (daysAgo: number, o: Partial<Workout> = {}): Workout => ({
  date: NOW - daysAgo * DAY_MS, source: 'manual', workoutType: 'easy', distanceKm: 5, durationSec: 1800, avgPaceSecPerKm: 360,
  avgHr: 150, maxHr: 170, avgCadence: null, elevationGain: null, rpe: null, laps: [], ...o,
});

test('gatherAdaptiveInput: EF terakhir vs rata-rata 14 hari sebelumnya (tanpa sesi terakhir), drift dari lap', () => {
  const laps = [120, 120, 130, 130].map((hr, i) => ({ km: i + 1, paceSec: 360, avgHr: hr }));
  const last = wk(0.1, { avgHr: 140, laps }); // EF = 166,67/140 = 1,19
  const ws = [wk(3), wk(7, { avgHr: 160 }), wk(20), last]; // 20 hari lalu di luar jendela 14 hari
  const g = gatherAdaptiveInput(ws, P, NOW);
  const ef = (hr: number) => (5000 / 30) / hr;
  assert.ok(Math.abs((g.input.lastEf as number) - ef(140)) < 1e-9);
  assert.ok(Math.abs((g.input.avgEf14 as number) - (ef(150) + ef(160)) / 2) < 1e-9);
  assert.ok(Math.abs((g.input.lastDriftPct as number) - 7.69) < 0.1);
  assert.ok(g.input.acwrRatio != null);
  assert.equal(g.last?.date, last.date);
  assert.equal(gatherAdaptiveInput([], P, NOW).last, null);
});

test('alur lengkap: sesi terakhir EF naik + drift tinggi → rencana nyata menerima penyesuaian', () => {
  const laps = [120, 120, 130, 130].map((hr, i) => ({ km: i + 1, paceSec: 360, avgHr: hr }));
  const ws = [wk(3, { avgHr: 160 }), wk(6, { avgHr: 160 }), wk(0.1, { avgHr: 140, laps })];
  const { input } = gatherAdaptiveInput(ws, P, NOW);
  const d = evaluateAdaptation({ ...input, acwrRatio: 1.0 });
  assert.equal(d.efUp, true);
  assert.equal(d.driftHigh, true);
  const plan = buildPlan({ raceIso: '2027-01-17', todayIso: TODAY, days: [2, 4, 6, 0], raceName: 'Lomba', startWeeklyKm: 20, maxWeeklyKm: 50, easyPaceSecPerKm: 360 });
  const r = applyAdaptation(flattenPlan(plan), d, TODAY, new Set());
  const codes = r.notes.map((n) => n.code).sort();
  assert.deepEqual(codes, ['drift', 'ef_up']);
});

// ── Kalibrasi Tes 3K ───────────────────────────────────────────────────────────

const day = (iso: string) => Date.parse(`${iso}T05:30:00`);
const t3 = (iso: string, km: number, sec: number, o: Partial<Workout> = {}): Workout => wk(0, { date: day(iso), distanceKm: km, durationSec: sec, avgHr: null, rpe: null, ...o });

test('Tes 3K: 3 km keras (RPE ≥ 8) → proyeksi 5K = waktu 3K × 1,72', () => {
  const c = calibrateFrom3k([t3('2026-12-12', 3, 1530, { rpe: 8 })], 182, '2026-12-07', '2026-12-13');
  assert.ok(c);
  assert.equal(TEST3K_FACTOR, 1.72);
  assert.ok(Math.abs(c.proj5kSec - 1530 * 1.72) < 1e-9); // 25:30 → ≈ 43:52
  assert.equal(Math.round(c.proj5kSec), 2632);
  assert.equal(c.pace3kSecPerKm, 510);
  assert.ok(Math.abs(c.pace5kSecPerKm - (1530 * 1.72) / 5) < 1e-9);
});

test('Tes 3K: syarat jarak 2,8–3,2 km, intensitas (RPE ≥ 8 atau HR ≥ 88% HR maks), dan minggu tes', () => {
  const W = ['2026-12-07', '2026-12-13'] as const;
  assert.ok(calibrateFrom3k([t3('2026-12-12', 2.8, 1500, { rpe: 8 })], 182, ...W));
  assert.ok(calibrateFrom3k([t3('2026-12-12', 3.2, 1700, { rpe: 8 })], 182, ...W));
  assert.equal(calibrateFrom3k([t3('2026-12-12', 2.7, 1500, { rpe: 9 })], 182, ...W), null, 'terlalu pendek');
  assert.equal(calibrateFrom3k([t3('2026-12-12', 3.3, 1500, { rpe: 9 })], 182, ...W), null, 'terlalu panjang');
  assert.equal(calibrateFrom3k([t3('2026-12-12', 3, 1530, { rpe: 7 })], 182, ...W), null, 'RPE 7 tidak cukup');
  assert.ok(calibrateFrom3k([t3('2026-12-12', 3, 1530, { avgHr: 161 })], 182, ...W), '88% × 182 = 160,2');
  assert.equal(calibrateFrom3k([t3('2026-12-12', 3, 1530, { avgHr: 160 })], 182, ...W), null);
  assert.equal(calibrateFrom3k([t3('2026-12-12', 3, 1530, { avgHr: 175 })], null, ...W), null, 'tanpa HR maks hanya RPE yang berlaku');
  assert.equal(calibrateFrom3k([t3('2026-12-20', 3, 1530, { rpe: 9 })], 182, ...W), null, 'di luar minggu tes');
});

test('Tes 3K: waktu dinormalkan ke 3,0 km; bila ada beberapa dipakai yang tercepat', () => {
  const c = calibrateFrom3k([t3('2026-12-12', 3.1, 1600, { rpe: 9 }), t3('2026-12-10', 3, 1700, { rpe: 9 })], 182, '2026-12-07', '2026-12-13');
  assert.ok(Math.abs((c?.time3kSec ?? 0) - (1600 * 3) / 3.1) < 1e-9);
});

test('pace interval = pace 3K − 10–20 dtk/km (400 m lebih dekat 20)', () => {
  assert.deepEqual(intervalPaceRange(510, 0.4), [490, 495]);
  assert.deepEqual(intervalPaceRange(510, 0.6), [495, 500]);
  assert.deepEqual(intervalPaceRange(510, 0.8), [495, 500]);
  assert.deepEqual(intervalPaceRange(510, undefined), [495, 500]);
});
