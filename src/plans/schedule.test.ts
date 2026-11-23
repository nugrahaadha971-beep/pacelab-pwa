import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, applyScheduleState, assignWeek, baseVolumes, buildPlan, completedIds, DEFAULT_SCHEDULE_STATE, dayNum, flattenPlan,
  formatDateId, isoFromRaceTs, normalizeScheduleState, pickSessions, remaining, resetSchedule, sessionLoad, setSessionDate,
  shiftAll, swapSessions, TAPER_CUT, toggleDay, toggleDone, weekdayOf,
} from './schedule.ts';
import type { Plan, PlanOptions, PlanSession } from './schedule.ts';
import { NIKE_5K_PLAN } from './nike5k.ts';
import { parseBackup } from '../db/validate.ts';

// 15 Nov 2026 = Minggu. 14 Mar 2027 = Minggu.
const TODAY = '2026-11-15';
const opts = (o: Partial<PlanOptions> = {}): PlanOptions => ({
  raceIso: '2027-03-14', todayIso: TODAY, days: [2, 4, 6, 0], raceName: '5K · Hari Lomba / Uji PB',
  startWeeklyKm: 20, maxWeeklyKm: 50, easyPaceSecPerKm: 360, ...o,
});
const all = (p: Plan) => flattenPlan(p);
const adj = (a: string, b: string) => Math.abs(dayNum(a) - dayNum(b)) === 1;

test('remaining: ceil hari/7; tepat 56 hari = 8 minggu, 57 hari = 9 minggu', () => {
  assert.deepEqual(remaining('2027-01-10', TODAY), { daysRemaining: 56, weeksRemaining: 8 });
  assert.deepEqual(remaining('2027-01-11', TODAY), { daysRemaining: 57, weeksRemaining: 9 });
  assert.deepEqual(remaining(TODAY, TODAY), { daysRemaining: 0, weeksRemaining: 0 });
  assert.equal(remaining('2026-11-10', TODAY).daysRemaining, -5);
  assert.equal(remaining('2026-11-10', TODAY).weeksRemaining, 0);
});

test('tanggal: hari & format Indonesia; tanggal lomba UTC', () => {
  assert.equal(weekdayOf('2026-11-15'), 0);
  assert.equal(formatDateId('2026-11-17'), 'Selasa, 17 Nov 2026');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(isoFromRaceTs(Date.parse('2026-12-20')), '2026-12-20');
});

test('weeksRemaining > 8 → minggu awal Base Building lalu 8 minggu puncak, minggu terakhir Taper', () => {
  const p = buildPlan(opts()); // 119 hari = 17 minggu
  assert.equal(p.weeksRemaining, 17);
  assert.equal(p.baseWeeks, 9);
  assert.equal(p.totalWeeks, 17);
  assert.deepEqual(p.weeks.map((w) => w.phase), [...Array(9).fill('base'), ...Array(7).fill('build'), 'taper']);
  for (const w of p.weeks.filter((x) => x.phase === 'base')) {
    assert.ok(w.sessions.every((s) => s.kind === 'recovery' || s.kind === 'long'), 'Base hanya Easy Run + Long Run');
  }
});

test('Base Building: target volume naik maks +10%/minggu dan berhenti di batas', () => {
  const p = buildPlan(opts());
  const km = p.weeks.filter((w) => w.phase === 'base').map((w) => w.plannedKm as number);
  for (let i = 1; i < km.length; i++) assert.ok(km[i] <= km[i - 1] * 1.1 + 0.051, `minggu ${i + 1}: ${km[i]} vs ${km[i - 1]}`);
  assert.ok(km[km.length - 1] > km[0]);
  const v = baseVolumes(30, 20, 50);
  assert.ok(Math.max(...v) <= 50 && v[v.length - 1] === 50);
  for (let i = 1; i < v.length; i++) assert.ok(v[i] <= v[i - 1] * 1.1 + 0.051);
});

test('weeksRemaining ≤ 8 → petakan langsung; sesi terakhir = Hari Lomba tepat di targetRaceDate', () => {
  const p = buildPlan(opts({ raceIso: '2026-12-20' })); // 35 hari = 5 minggu
  assert.equal(p.weeksRemaining, 5);
  assert.equal(p.baseWeeks, 0);
  assert.equal(p.weeks.length, 5);
  assert.equal(p.weeks[0].sessions[0].id.startsWith('n3-'), true, 'memakai 5 minggu terakhir templat');
  const last = all(p).at(-1) as PlanSession;
  assert.equal(last.kind, 'race');
  assert.equal(last.date, '2026-12-20');
  assert.equal(p.weeks.at(-1)?.phase, 'taper');
  assert.ok(all(p).filter((s) => s.kind !== 'race').every((s) => dayNum(s.date) < dayNum('2026-12-20')));
});

test('Taper: volume sesi non-lomba dipangkas 30–40% (TAPER_CUT), sesi speed tetap menjaga langkah pace', () => {
  assert.ok(TAPER_CUT >= 0.3 && TAPER_CUT <= 0.4);
  const p = buildPlan(opts({ raceIso: '2026-12-20', days: [1, 2, 4, 5, 6] }));
  const taper = p.weeks.at(-1)!.sessions.filter((s) => s.kind !== 'race');
  assert.ok(taper.length >= 3);
  for (const s of taper) {
    const [, wk, k] = /^n(\d+)-(\d+)$/.exec(s.id) as RegExpExecArray;
    const orig = NIKE_5K_PLAN[Number(wk)].sessions[Number(k)];
    const o = sessionLoad(orig, 360);
    const expectedMin = Math.round((o.durationMin as number) * (1 - TAPER_CUT));
    assert.equal(s.durationMin, expectedMin);
    const cut = 1 - (s.durationMin as number) / (o.durationMin as number);
    assert.ok(cut >= 0.3 && cut <= 0.4 || (o.durationMin as number) < 10, `${s.id} dipangkas ${cut}`); // pembulatan pada sesi sangat pendek
    if (s.kind === 'speed') {
      assert.deepEqual(s.steps, orig.steps);
      assert.match(s.note ?? '', /Taper/);
    }
  }
});

test('lomba hari ini → hanya sesi Hari Lomba; lomba sudah lewat → rencana kosong', () => {
  const today = buildPlan(opts({ raceIso: TODAY }));
  assert.deepEqual(all(today).map((s) => s.kind), ['race']);
  assert.equal(buildPlan(opts({ raceIso: '2026-11-01' })).weeks.length, 0);
});

test('hari latihan: sesi hanya di hari pilihan; Long Run di akhir pekan; Speed tak bersebelahan Long Run', () => {
  const combos = [[2, 4, 6, 0], [1, 3, 5, 6], [2, 3, 5, 6, 0], [1, 2, 4, 5, 6, 0], [1, 2, 3, 4, 5, 6, 0], [3, 4, 6]];
  for (const days of combos) {
    for (const raceIso of ['2027-03-14', '2027-03-17', '2026-12-26', '2027-01-05']) {
      const p = buildPlan(opts({ days, raceIso }));
      const s = all(p);
      const longs = s.filter((x) => x.kind === 'long');
      const uniq = new Set(s.map((x) => x.date));
      assert.equal(uniq.size, s.length, `tanggal ganda ${days}/${raceIso}`);
      for (const x of s) {
        assert.ok(dayNum(x.date) >= dayNum(TODAY), 'tidak di masa lalu');
        if (x.kind !== 'race') assert.ok(days.includes(weekdayOf(x.date)), `${x.id} jatuh di hari tak dipilih (${days})`);
      }
      // Long Run di akhir pekan pilihan, kecuali jendela minggu (terpotong hari ini) tidak memuat hari akhir pekan pilihan.
      for (const w of p.weeks) {
        const wl = w.sessions.find((x) => x.kind === 'long');
        if (!wl) continue;
        const hasWeekend = [...Array(7)].map((_, k) => addDays(w.startIso, k)).some((d) => dayNum(d) >= dayNum(TODAY) && days.includes(weekdayOf(d)) && [0, 6].includes(weekdayOf(d)));
        if (hasWeekend) assert.ok([0, 6].includes(weekdayOf(wl.date)), `Long Run ${wl.date} bukan akhir pekan (${days})`);
      }
      for (const sp of s.filter((x) => x.kind === 'speed')) for (const l of longs) assert.ok(!adj(sp.date, l.date), `Speed ${sp.date} bersebelahan Long Run ${l.date} (${days})`);
    }
  }
});

test('Speed yang tak bisa ditempatkan tanpa bersebelahan Long Run diturunkan menjadi Easy Run', () => {
  const p = buildPlan(opts({ days: [5, 6, 0], raceIso: '2027-01-10' })); // Jum/Sab/Min, 8 minggu
  const s = all(p);
  assert.ok(s.some((x) => x.demoted && x.kind === 'recovery'));
  for (const sp of s.filter((x) => x.kind === 'speed')) for (const l of s.filter((x) => x.kind === 'long')) assert.ok(!adj(sp.date, l.date));
});

test('assignWeek: Long Run ke akhir pekan pilihan, Speed menghindari hari sebelum/sesudahnya', () => {
  const mk = (id: string, kind: 'recovery' | 'speed' | 'long') => ({ id, kind, name: id, steps: [], distanceKm: null, durationMin: null });
  // Sel 17, Kam 19, Sab 21, Min 22
  const r = assignWeek([mk('r', 'recovery'), mk('s', 'speed'), mk('l', 'long')], ['2026-11-17', '2026-11-19', '2026-11-21', '2026-11-22'], { prevLong: null, prevSpeed: null });
  const by = Object.fromEntries(r.map((x) => [x.draft.id, x.date]));
  assert.equal(weekdayOf(by.l), 0); // slot dipilih merata (Sel, Kam/Sab, Min): Long di Minggu
  assert.ok(!adj(by.s, by.l));
});

test('pickSessions: recovery dibuang lebih dulu (yang paling awal), urutan dipertahankan', () => {
  const t = NIKE_5K_PLAN[0].sessions; // rec, speed, rec, speed, long
  assert.deepEqual(pickSessions(t, 4), [1, 2, 3, 4]);
  assert.deepEqual(pickSessions(t, 3), [1, 3, 4]);
  assert.deepEqual(pickSessions(t, 2), [3, 4]);
});

test('Adjust: geser semua jadwal ±1 hari menggeser sesi tetapi tidak hari lomba; Reset memulihkan', () => {
  const o = opts({ raceIso: '2026-12-20' });
  const p = buildPlan(o);
  const s1 = applyScheduleState(p, shiftAll(DEFAULT_SCHEDULE_STATE, 1), o.raceIso);
  const a = all(p), b = all(s1);
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind === 'race') assert.equal(b.find((x) => x.id === 'race')?.date, '2026-12-20');
    else assert.equal(b.find((x) => x.id === a[i].id)?.date, addDays(a[i].baseDate, 1));
  }
  const back = applyScheduleState(p, shiftAll(DEFAULT_SCHEDULE_STATE, -1), o.raceIso);
  assert.equal(all(back)[0].date, addDays(a[0].baseDate, -1));
  const reset = resetSchedule({ ...DEFAULT_SCHEDULE_STATE, shift: 3, overrides: { x: '2026-11-20' }, done: { y: true } });
  assert.equal(reset.shift, 0);
  assert.deepEqual(reset.overrides, {});
  assert.deepEqual(reset.done, { y: true });
});

test('Adjust: geser tidak pernah menaruh sesi pada/setelah hari lomba', () => {
  const o = opts({ raceIso: '2026-12-20' });
  const p = buildPlan(o);
  const shifted = applyScheduleState(p, shiftAll(DEFAULT_SCHEDULE_STATE, 5), o.raceIso);
  assert.ok(all(shifted).filter((s) => s.kind !== 'race').every((s) => dayNum(s.date) <= dayNum('2026-12-19')));
});

test('Adjust: ubah tanggal manual dan tukar sesi', () => {
  const o = opts({ raceIso: '2026-12-20' });
  const p = buildPlan(o);
  const [a, b] = all(p);
  let st = setSessionDate(DEFAULT_SCHEDULE_STATE, a.id, '2026-11-30');
  assert.equal(all(applyScheduleState(p, st, o.raceIso)).find((s) => s.id === a.id)?.date, '2026-11-30');
  st = swapSessions(DEFAULT_SCHEDULE_STATE, a, b);
  const q = all(applyScheduleState(p, st, o.raceIso));
  assert.equal(q.find((s) => s.id === a.id)?.date, b.date);
  assert.equal(q.find((s) => s.id === b.id)?.date, a.date);
});

test('Auto-complete: ada catatan latihan pada tanggal sesi (≤ hari ini) → Selesai; manual bisa dicentang', () => {
  const o = opts({ raceIso: '2026-12-20', todayIso: '2026-11-20' });
  const s = all(buildPlan(o));
  const past = s.find((x) => dayNum(x.date) <= dayNum('2026-11-20')) ?? s[0];
  const future = s.find((x) => dayNum(x.date) > dayNum('2026-11-20')) as PlanSession;
  const days = new Set([past.date, future.date]);
  const ids = completedIds(s, days, DEFAULT_SCHEDULE_STATE, '2026-11-20');
  assert.equal(ids.has(past.id), dayNum(past.date) <= dayNum('2026-11-20'));
  assert.equal(ids.has(future.id), false, 'tanggal mendatang tidak otomatis selesai');
  assert.equal(completedIds(s, new Set(), toggleDone(DEFAULT_SCHEDULE_STATE, future.id), '2026-11-20').has(future.id), true);
  assert.deepEqual(toggleDone(toggleDone(DEFAULT_SCHEDULE_STATE, 'a'), 'a').done, {});
});

test('toggleDay: minimal 3 hari latihan; normalizeScheduleState membersihkan data rusak', () => {
  assert.deepEqual(toggleDay({ ...DEFAULT_SCHEDULE_STATE, days: [2, 4, 6] }, 4).days, [2, 4, 6]);
  assert.deepEqual(toggleDay(DEFAULT_SCHEDULE_STATE, 3).days, [0, 2, 3, 4, 6]);
  assert.equal(normalizeScheduleState('x'), null);
  const n = normalizeScheduleState({ days: [9, 1, 1, 'a', 3], shift: 999, overrides: { a: '2026-11-20', b: '20-11-2026', c: '2026-02-31' }, done: { a: true, b: false } });
  assert.deepEqual(n, { days: [1, 3], shift: 60, overrides: { a: '2026-11-20' }, done: { a: true } });
  assert.deepEqual(normalizeScheduleState({ days: [] })?.days, DEFAULT_SCHEDULE_STATE.days);
});

test('cadangan JSON: jadwal ikut diekspor/diimpor lewat parseBackup', () => {
  const st = { days: [0, 1, 3, 5], shift: 2, overrides: { 'n0-1': '2026-11-24' }, done: { 'n0-0': true } };
  const r = parseBackup({ app: 'pacelab', workouts: [], schedule: st });
  assert.deepEqual(r.schedule, st);
  assert.equal(parseBackup({ app: 'pacelab', workouts: [] }).schedule, null);
});

test('Base: data volume sangat kecil tidak menghasilkan lari mini; Easy Run 2,0–2,5 km, volume awal ≥ 10 km', async () => {
  const { MIN_BASE_WEEKLY_KM } = await import('./schedule.ts');
  for (const days of [[2, 4, 6, 0], [1, 2, 3, 4, 5, 6, 0], [3, 5, 6]]) {
    const p = buildPlan(opts({ days, startWeeklyKm: 2.5 }));
    assert.ok((p.weeks[0].plannedKm as number) >= (days.length >= 4 ? MIN_BASE_WEEKLY_KM : 9), `${days}: ${p.weeks[0].plannedKm}`);
    for (const s of p.weeks.filter((w) => w.phase === 'base').flatMap((w) => w.sessions)) {
      if (s.kind === 'recovery') assert.ok((s.distanceKm as number) >= 2 - 0.05 && (s.distanceKm as number) <= 2.5 + 0.05, `${days}: Easy ${s.distanceKm} km`);
    }
  }
});

// ── v2.2: Long Run vs Easy, HR, kurikulum Progresif ───────────────────────────

const longOk = (ws: PlanSession[], easyPace: number) => {
  const easy = ws.filter((s) => s.kind === 'recovery' && s.zone === 'easy' && !s.demoted);
  const long = ws.find((s) => s.kind === 'long');
  if (!long || !easy.length) return true;
  const eMin = Math.max(...easy.map((s) => s.durationMin as number));
  const eKm = Math.max(...easy.map((s) => s.distanceKm as number));
  return (long.durationMin as number) - eMin >= 15 || (long.distanceKm as number) - eKm >= 1.5 - 0.051 || (long.durationMin as number) * 60 / easyPace - (eMin * 60) / easyPace >= 1.5;
};

test('Long Run ≥ Easy terpanjang + 1,5 km atau + 15 menit, di Base dan Nike (semua kombinasi hari)', () => {
  for (const days of [[2, 4, 6, 0], [1, 3, 5, 6], [1, 2, 3, 4, 5, 6, 0], [3, 5, 6]]) {
    for (const pace of [330, 360, 541, 660]) {
      const p = buildPlan(opts({ days, easyPaceSecPerKm: pace, raceIso: '2027-03-14' }));
      for (const w of p.weeks) {
        if (w.phase === 'taper' || w.deload) continue;
        assert.ok(longOk(w.sessions, pace), `minggu ${w.weekNo} (${w.phase}) hari ${days} pace ${pace}: ${JSON.stringify(w.sessions.map((s) => [s.kind, s.durationMin, s.distanceKm]))}`);
      }
    }
  }
});

test('Nike: Recovery/Easy dikunci ≤ 30 menit; Easy Base 2,0–2,5 km, Long Base lebih panjang', () => {
  const p = buildPlan(opts({ days: [2, 4, 6, 0], easyPaceSecPerKm: 541, raceIso: '2027-03-14' }));
  for (const s of all(p)) if (s.kind === 'recovery' && s.zone === 'easy') assert.ok((s.durationMin as number) <= 30, `${s.id} ${s.durationMin}`);
  const base = p.weeks[0].sessions;
  const maxEasy = Math.max(...base.filter((s) => s.kind === 'recovery').map((s) => s.distanceKm as number));
  assert.ok((base.find((s) => s.kind === 'long')?.distanceKm as number) >= maxEasy + 1.5 - 0.05);
});

const PROG = (o: Partial<PlanOptions> = {}) => buildPlan(opts({ curriculum: 'progressive5k', raceIso: '2027-01-31', days: [2, 4, 6, 0], maxHr: 182, easyPaceSecPerKm: 541, ...o }));
const names = (p: Plan, wk: number) => p.weeks[wk - 1].sessions.map((s) => `${weekdayOf(s.date)}:${s.name}`);

test('Progresif 5K: 11 minggu menuju 31 Jan 2027, minggu 1 = 16–22 Nov, hari Sel/Kam/Sab/Min', () => {
  const p = PROG();
  assert.equal(p.weeksRemaining, 11);
  assert.equal(p.baseWeeks, 0);
  assert.equal(p.weeks.length, 11);
  assert.equal(p.weeks[0].startIso, '2026-11-16');
  assert.equal(p.weeks[0].endIso, '2026-11-22');
  assert.deepEqual(p.weeks[0].sessions.map((s) => s.date), ['2026-11-17', '2026-11-19', '2026-11-21', '2026-11-22']);
  assert.deepEqual(names(p, 1), ["2:6×(3' Lari / 1' Jalan)", "4:25' (4' Lari / 1' Jalan)", "6:25' (4' Lari / 1' Jalan)", "0:40' (5' Lari / 1' Jalan)"]);
  assert.deepEqual(names(p, 2), ["2:5×(5' Lari / 1' Jalan)", "4:30' (6' Lari / 1' Jalan)", "6:25' (5' Lari / 1' Jalan)", "0:45' (6' Lari / 1' Jalan)"]);
  assert.deepEqual(names(p, 3).slice(0, 3), ["2:3×(10' Lari / 2' Jalan)", "4:30' (10' Lari / 1' Jalan)", "6:25' (8' Lari / 1' Jalan)"]);
  assert.equal(p.weeks[2].sessions[3].durationMin, 51);
  assert.deepEqual(p.weeks.map((w) => w.title).filter((t, i, a) => a.indexOf(t) === i), ['Fondasi Lari-Jalan', 'Fondasi · Ringan + Tes 3K', 'Kecepatan & Daya Tahan', 'Kecepatan · Ringan + Tes 5K', 'Spesifik Lomba', 'Taper & Lomba']);
});

test('Progresif 5K: minggu 4 = Tes 3K Sabtu 12 Des + long ringan; minggu 8 = Tes 5K Sabtu 9 Jan', () => {
  const p = PROG();
  const t3k = all(p).find((s) => s.test === '3k') as PlanSession;
  const t5k = all(p).find((s) => s.test === '5k') as PlanSession;
  assert.equal(t3k.date, '2026-12-12');
  assert.equal(weekdayOf(t3k.date), 6);
  assert.equal(t5k.date, '2027-01-09');
  assert.equal(p.weeks[3].deload, true);
  assert.deepEqual(names(p, 4).map((x) => x.split(':').slice(1).join(':')), ["20' mudah + 4 strides", "25' (10' Lari / 1' Jalan)", 'Tes 3K', "30' mudah"]);
  assert.equal(p.weeks[3].sessions[3].kind, 'long');
  assert.deepEqual(names(p, 8).map((x) => x.split(':').slice(1).join(':')), ['4×400 m, jalan 2\'', "25' mudah", 'Tes 5K', "30' mudah"]);
});

test('Progresif 5K: fase 2 & 3 (interval berbasis jarak, strides, pace race) sesuai kurikulum', () => {
  const p = PROG();
  const n = (w: number) => p.weeks[w - 1].sessions.map((s) => s.name);
  assert.equal(n(5)[0], "6×400 m, jalan 2'");
  assert.equal(n(6)[0], "5×600 m, jalan 2'");
  assert.equal(n(7)[0], "4×800 m, jalan 2,5'");
  assert.equal(n(5)[1], "30' lari kontinu (mudah)");
  assert.equal(n(5)[2], "25' mudah + 4 strides");
  assert.ok(p.weeks[4].sessions[2].steps.some((x) => x.includes('4 × (20" cepat rileks / 40" jalan)')));
  assert.equal(n(9)[0], "3×1 km pace race, jalan 2,5'");
  assert.equal(n(9)[3], "70' mudah");
  assert.equal(n(10)[0], "2×1,6 km pace race, jalan 3'");
  assert.equal(n(10)[3], "60' mudah");
  assert.deepEqual(n(11).slice(0, 3), ["3×800 m pace race, jalan 2'", "20' mudah + 4 strides", "15' mudah + 3 strides"]);
});

test('Progresif 5K: RACE 5K tepat di targetRaceDate; taper tidak dipotong dua kali; shake-out sehari sebelum lomba dipertahankan', () => {
  const p = PROG();
  const s = all(p);
  assert.equal(s.at(-1)?.kind, 'race');
  assert.equal(s.at(-1)?.date, '2027-01-31');
  assert.deepEqual(p.weeks[10].sessions.map((x) => x.date), ['2027-01-26', '2027-01-28', '2027-01-30', '2027-01-31']);
  assert.equal(p.weeks[10].phase, 'taper');
  assert.equal(p.weeks[10].sessions[1].durationMin, 24, "20' + 4 strides tanpa pemangkasan tambahan");
  assert.ok(s.at(-1)?.steps.some((x) => x.includes('Km 1')));
});

test('Progresif 5K: Long Run di Minggu, interval Selasa, tes boleh Sabtu sebelum Long Run; pola 4 hari konsisten', () => {
  const p = PROG();
  for (const w of p.weeks) {
    const lg = w.sessions.find((x) => x.kind === 'long');
    if (lg) assert.equal(weekdayOf(lg.date), 0);
    for (const sp of w.sessions.filter((x) => x.kind === 'speed' && !x.test)) assert.equal(weekdayOf(sp.date), 2);
  }
  for (const sp of all(p).filter((x) => x.kind === 'speed' && !x.test)) for (const l of all(p).filter((x) => x.kind === 'long')) assert.ok(!adj(sp.date, l.date));
});

test('Progresif 5K: Long Run ≥ Easy terpanjang + 15 menit pada semua minggu non-deload (tanpa perlu dikoreksi)', () => {
  const p = PROG();
  for (const w of p.weeks) {
    if (w.deload) continue;
    const easy = w.sessions.filter((x) => x.kind === 'recovery').map((x) => x.durationMin as number);
    const lg = w.sessions.find((x) => x.kind === 'long');
    if (lg) assert.ok((lg.durationMin as number) - Math.max(...easy) >= 15, `minggu ${w.weekNo}`);
  }
});

test('Progresif 5K: skala mengikuti weeksRemaining (lebih dari 11 → Base di awal; kurang dari 11 → 11 minggu terakhir)', () => {
  const long = PROG({ raceIso: '2027-03-14' }); // 17 minggu
  assert.equal(long.baseWeeks, 6);
  assert.equal(long.weeks.length, 17);
  assert.deepEqual(long.weeks.slice(0, 6).map((w) => w.phase), Array(6).fill('base'));
  assert.equal(long.weeks[6].sessions[0].id, 'p0-0');
  assert.equal(all(long).at(-1)?.date, '2027-03-14');
  const short = PROG({ raceIso: '2026-12-20' }); // 5 minggu
  assert.equal(short.weeks.length, 5);
  assert.equal(short.weeks[0].sessions[0].id.startsWith('p6-'), true);
  assert.equal(short.weeks.at(-1)?.sessions.at(-1)?.kind, 'race');
  assert.equal(all(short).at(-1)?.date, '2026-12-20');
});

test('HR-first: target bpm per zona dari HR maks (easy 130–150, interval 164–175, race 164–173)', async () => {
  const { hrRange } = await import('./hrZones.ts');
  assert.deepEqual(hrRange('easy', 182), [130, 150]);
  assert.deepEqual(hrRange('interval', 182), [164, 175]);
  assert.deepEqual(hrRange('race', 182), [164, 173]);
  assert.equal(hrRange('easy', 0), null);
  const p = PROG();
  const s = all(p);
  assert.deepEqual(s.find((x) => x.kind === 'long')?.hr, [130, 150]);
  assert.deepEqual(s.find((x) => x.zone === 'interval')?.hr, [164, 175]);
  assert.deepEqual(s.find((x) => x.kind === 'race')?.hr, [164, 173]);
  assert.equal(PROG({ maxHr: null }).weeks[0].sessions[0].hr, null);
  const nike = buildPlan(opts({ maxHr: 190 }));
  assert.ok(all(nike).filter((x) => x.zone).every((x) => x.hr != null));
});

test('Nike tetap tidak berubah secara struktur: id n*, 8 minggu puncak, tanpa tes', () => {
  const p = buildPlan(opts({ raceIso: '2027-01-10' }));
  assert.equal(p.weeks.length, 8);
  assert.ok(all(p).filter((s) => s.kind !== 'race').every((s) => s.id.startsWith('n')));
  assert.ok(all(p).every((s) => !s.test));
});
