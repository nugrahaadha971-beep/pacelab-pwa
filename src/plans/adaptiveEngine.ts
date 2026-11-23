// Mesin penyesuaian program otomatis. Murni (tanpa UI) agar bisa diuji dengan node:test.
import { acwr, cardiacDrift, DAY_MS, efficiencyFactor } from '../analytics/workload.ts';
import type { UserProfile, Workout } from '../analytics/types.ts';
import { dayNum, isoFromLocal } from './schedule.ts';
import type { Adjustment, IsoDate, PlanSession } from './schedule.ts';
import { hrRange } from './hrZones.ts';

export const ACWR_HIGH = 1.3;
const ACWR_HIGH_ID = String(ACWR_HIGH).replace('.', ','); // untuk teks alasan: 1,3
export const ACWR_LOW = 0.8;
export const EF_GAIN_PCT = 3;
export const DRIFT_LIMIT_PCT = 5;
export const HIGH_LOAD_CUT = 0.2;
export const PACE_UP_SEC = 4;
export const EASY_SLOW_SEC = 12;
export const VOLUME_ADD = 0.1;
export const VOLUME_ADD_MAX_MIN = 10;
export const EF_WINDOW_DAYS = 14;

export const BADGE = {
  high_load: 'Disesuaikan: Beban Tinggi (ACWR)',
  ef_up: 'Target Pace Ditingkatkan (+Efisiensi)',
  drift: 'Pace Easy Diperlambat (Cardiac Drift)',
  add_volume: 'Durasi Long Run Ditambah (Beban Rendah)',
} as const;

// ───────────────────────── Progresi pace menuju target PB ─────────────────────────

/**
 * weekPace = currentPace − (currentPace − targetPace) × (weekIndex / totalWeeks).
 * Bila proyeksi sudah sama/lebih cepat dari target, pace ditahan di pace target (rumus apa adanya akan "melambat" ke target).
 */
export function weekPace(currentPace: number, targetPace: number, weekIndex: number, totalWeeks: number): number {
  if (currentPace <= targetPace) return targetPace;
  const r = totalWeeks <= 0 ? 1 : Math.min(1, Math.max(0, weekIndex / totalWeeks));
  return currentPace - (currentPace - targetPace) * r;
}

export interface PbOutlook {
  gapSec: number; // proyeksi − target (detik); ≤ 0 = sudah di bawah target
  gapPct: number;
  perWeekSec: number | null; // perbaikan waktu per minggu yang dibutuhkan
  label: string;
}

/** ASUMSI: ambang label peluang (2/5/10% dari waktu target) tidak berasal dari blueprint; bisa disetel. */
export function pbOutlook(projectedSec: number, targetSec: number, weeksRemaining: number): PbOutlook {
  const gapSec = projectedSec - targetSec;
  const gapPct = (gapSec / targetSec) * 100;
  const label = gapSec <= 0 ? 'Proyeksi sudah di bawah target'
    : gapPct <= 2 ? 'Sangat realistis'
    : gapPct <= 5 ? 'Realistis'
    : gapPct <= 10 ? 'Menantang' : 'Sangat menantang';
  return { gapSec, gapPct, perWeekSec: gapSec > 0 && weeksRemaining > 0 ? gapSec / weeksRemaining : null, label };
}

// ───────────────────────── Evaluasi sesi terakhir ─────────────────────────

export interface AdaptiveInput {
  acwrRatio: number | null;
  lastEf: number | null;
  avgEf14: number | null;
  lastDriftPct: number | null;
}

export interface AdaptiveDecision {
  highLoad: boolean;
  efUp: boolean;
  efGainPct: number | null;
  driftHigh: boolean;
  addVolume: boolean;
}

export function evaluateAdaptation(i: AdaptiveInput): AdaptiveDecision {
  const efGainPct = i.lastEf != null && i.avgEf14 != null && i.avgEf14 > 0 ? ((i.lastEf - i.avgEf14) / i.avgEf14) * 100 : null;
  return {
    highLoad: i.acwrRatio != null && i.acwrRatio > ACWR_HIGH,
    efUp: efGainPct != null && efGainPct >= EF_GAIN_PCT - 1e-9,
    efGainPct,
    driftHigh: i.lastDriftPct != null && i.lastDriftPct > DRIFT_LIMIT_PCT,
    // Drift tidak diketahui (tanpa lap/HR) dianggap tidak melebihi ambang.
    addVolume: i.acwrRatio != null && i.acwrRatio < ACWR_LOW && (i.lastDriftPct == null || i.lastDriftPct <= DRIFT_LIMIT_PCT),
  };
}

export interface LastSessionInfo { date: number; type: Workout['workoutType']; distanceKm: number }
export interface Gathered { input: AdaptiveInput; last: LastSessionInfo | null }

/** EF rata-rata = sesi ber-EF dalam 14 hari sebelum sesi terakhir (sesi terakhir tidak ikut dihitung). */
export function gatherAdaptiveInput(workouts: Workout[], profile: UserProfile, now: number): Gathered {
  const past = workouts.filter((w) => w.date <= now);
  const last = [...past].sort((a, b) => b.date - a.date)[0];
  const ratio = acwr(workouts, profile, now).ratio;
  if (!last) return { input: { acwrRatio: ratio, lastEf: null, avgEf14: null, lastDriftPct: null }, last: null };
  const efOf = (w: Workout) => w.efficiencyFactor ?? efficiencyFactor(w);
  const base = past
    .filter((w) => w !== last && w.date > last.date - EF_WINDOW_DAYS * DAY_MS && w.date <= last.date)
    .map(efOf)
    .filter((v): v is number => v != null);
  return {
    input: {
      acwrRatio: ratio,
      lastEf: efOf(last),
      avgEf14: base.length ? base.reduce((a, b) => a + b, 0) / base.length : null,
      lastDriftPct: cardiacDrift(last.laps),
    },
    last: { date: last.date, type: last.workoutType, distanceKm: last.distanceKm },
  };
}

// ───────────────────────── Penerapan pada jadwal ─────────────────────────

export interface AdaptationNote { code: Adjustment['code'] | 'ef_up_held'; badge: string; sessionId: string; reason: string }
export interface AdaptationResult { sessions: PlanSession[]; notes: AdaptationNote[] }

const mins = (n: number) => `${Math.round(n)} menit`;

/**
 * Terapkan aturan pada sesi *berikutnya* (tanggal ≥ hari ini, belum selesai, bukan hari lomba):
 *  1. ACWR > 1,3 → Speed berikutnya jadi Recovery Easy Run, durasi −20%. (Menang atas aturan 2.)
 *     Program MAF tidak punya sesi Speed, jadi untuknya berlaku 1b.
 *  1b. ACWR > 1,3 dan tidak ada Speed (program MAF) → durasi lari MAF berikutnya −20%; zona detak jantung tetap.
 *  2. EF terakhir ≥ rata-rata 14 hari +3% → pace Interval/Threshold (Speed berikutnya) −4 dtk/km.
 *  3. Drift > 5% → pace Easy Run berikutnya +12 dtk/km.
 *  4. ACWR < 0,8 dan drift ≤ 5% → Long Run berikutnya +10% (maks +10 menit); bonus tidak diberikan ke Recovery Run
 *     agar Easy tetap pendek dan Long Run tetap jelas lebih panjang.
 */
export function applyAdaptation(sessions: PlanSession[], d: AdaptiveDecision, todayIso: IsoDate, done: ReadonlySet<string>, maxHr?: number | null): AdaptationResult {
  const upcoming = sessions
    .filter((s) => s.kind !== 'race' && dayNum(s.date) >= dayNum(todayIso) && !done.has(s.id))
    .sort((a, b) => dayNum(a.date) - dayNum(b.date));
  const nextSpeed = upcoming.find((s) => s.kind === 'speed' && s.test !== 'maf'); // MAF Test bukan sesi kecepatan
  const nextMaf = upcoming.find((s) => s.zone === 'maf' && s.test !== 'maf'); // lari MAF berikutnya (bukan MAF Test)
  const nextEasy = upcoming.find((s) => s.kind === 'recovery');
  const nextLong = upcoming.find((s) => s.kind === 'long');

  const patch = new Map<string, PlanSession>();
  const notes: AdaptationNote[] = [];
  const edit = (s: PlanSession, f: (c: PlanSession) => PlanSession) => patch.set(s.id, f(patch.get(s.id) ?? { ...s }));
  const tag = (s: PlanSession, code: Adjustment['code'], reason: string) => {
    edit(s, (c) => ({ ...c, adjustments: [...(c.adjustments ?? []), { code, badge: BADGE[code], reason }] }));
    notes.push({ code, badge: BADGE[code], sessionId: s.id, reason });
  };

  if (d.highLoad && nextSpeed) {
    const base = nextSpeed.durationMin;
    edit(nextSpeed, (c) => ({
      ...c, kind: 'recovery', convertedFrom: 'speed', name: 'Recovery Easy Run', steps: [], note: undefined,
      zone: 'easy', hr: hrRange('easy', maxHr), test: undefined, repKm: undefined,
      adjDurationMin: base != null ? base * (1 - HIGH_LOAD_CUT) : undefined,
    }));
    tag(nextSpeed, 'high_load', `ACWR di atas ${ACWR_HIGH_ID}: sesi Speed diganti Recovery Easy Run${base != null ? `, durasi −${HIGH_LOAD_CUT * 100}% (${mins(base)} → ${mins(base * (1 - HIGH_LOAD_CUT))})` : ''}.`);
  } else if (d.efUp && nextSpeed) {
    edit(nextSpeed, (c) => ({ ...c, paceDeltaSec: (c.paceDeltaSec ?? 0) - PACE_UP_SEC }));
    tag(nextSpeed, 'ef_up', `EF sesi terakhir ${d.efGainPct?.toFixed(1)}% di atas rata-rata ${EF_WINDOW_DAYS} hari: target pace −${PACE_UP_SEC} dtk/km.`);
  }
  if (d.highLoad && !nextSpeed && nextMaf && nextMaf.durationMin != null) {
    const base = nextMaf.durationMin;
    edit(nextMaf, (c) => ({ ...c, adjDurationMin: base * (1 - HIGH_LOAD_CUT) }));
    tag(nextMaf, 'high_load', `ACWR di atas ${ACWR_HIGH_ID}: durasi lari MAF berikutnya −${HIGH_LOAD_CUT * 100}% (${mins(base)} → ${mins(base * (1 - HIGH_LOAD_CUT))}). Batas detak jantung tidak berubah.`);
  }
  if (d.highLoad && d.efUp && nextSpeed) {
    notes.push({ code: 'ef_up_held', badge: 'Kenaikan pace ditunda', sessionId: nextSpeed.id, reason: 'EF membaik, tetapi beban masih tinggi (ACWR); kenaikan pace ditunda.' });
  }

  if (d.driftHigh && nextEasy) {
    edit(nextEasy, (c) => ({ ...c, paceDeltaSec: (c.paceDeltaSec ?? 0) + EASY_SLOW_SEC }));
    tag(nextEasy, 'drift', `Cardiac drift sesi terakhir di atas ${DRIFT_LIMIT_PCT}%: pace Easy +${EASY_SLOW_SEC} dtk/km agar tetap aerobik.`);
  }

  if (d.addVolume && nextLong && nextLong.durationMin != null) {
    const add = Math.min(VOLUME_ADD_MAX_MIN, nextLong.durationMin * VOLUME_ADD);
    edit(nextLong, (c) => ({ ...c, adjDurationMin: (nextLong.durationMin as number) + add }));
    tag(nextLong, 'add_volume', `Beban rendah (ACWR < ${ACWR_LOW}) dan drift ≤ ${DRIFT_LIMIT_PCT}%: durasi Long Run +${mins(add)} (${mins(nextLong.durationMin)} → ${mins(nextLong.durationMin + add)}).`);
  }

  return { sessions: sessions.map((s) => patch.get(s.id) ?? s), notes };
}

// ───────────────────────── Kalibrasi dari Tes 3K ─────────────────────────

export const TEST3K_FACTOR = 1.72; // proyeksi 5K = waktu 3K × 1,72
export const TEST3K_MIN_KM = 2.8;
export const TEST3K_MAX_KM = 3.2;
export const TEST_RPE_MIN = 8;
export const TEST_HR_PCT = 0.88;

export interface Test3kCalibration {
  date: number;
  time3kSec: number; // waktu dinormalkan ke tepat 3 km
  pace3kSecPerKm: number;
  proj5kSec: number;
  pace5kSecPerKm: number;
}

/**
 * Cari catatan Tes 3K pada minggu tes [startIso, endIso]: jarak 2,8–3,2 km dan intensitas keras
 * (RPE ≥ 8 atau HR rata-rata ≥ 88% HR maks). Bila ada beberapa, dipakai yang tercepat.
 * Waktu dinormalkan proporsional ke 3,0 km.
 */
export function calibrateFrom3k(workouts: Workout[], maxHr: number | null, startIso: IsoDate, endIso: IsoDate): Test3kCalibration | null {
  let best: Test3kCalibration | null = null;
  for (const w of workouts) {
    const day = isoFromLocal(w.date);
    if (dayNum(day) < dayNum(startIso) || dayNum(day) > dayNum(endIso)) continue;
    if (w.distanceKm < TEST3K_MIN_KM || w.distanceKm > TEST3K_MAX_KM || w.durationSec <= 0) continue;
    const hard = (w.rpe != null && w.rpe >= TEST_RPE_MIN) || (maxHr != null && maxHr > 0 && w.avgHr != null && w.avgHr >= TEST_HR_PCT * maxHr);
    if (!hard) continue;
    const t3 = (w.durationSec * 3) / w.distanceKm;
    if (!best || t3 < best.time3kSec) {
      const proj = t3 * TEST3K_FACTOR;
      best = { date: w.date, time3kSec: t3, pace3kSecPerKm: t3 / 3, proj5kSec: proj, pace5kSecPerKm: proj / 5 };
    }
  }
  return best;
}

/** Pace interval = pace 3K dikurangi 10–20 dtk/km (ulangan 400 m lebih dekat ke −20). Mengembalikan [tercepat, terlambat]. */
export function intervalPaceRange(pace3kSecPerKm: number, repKm: number | undefined): [number, number] {
  const [a, b] = repKm != null && repKm <= 0.4 ? [20, 15] : [15, 10];
  return [pace3kSecPerKm - a, pace3kSecPerKm - b];
}
