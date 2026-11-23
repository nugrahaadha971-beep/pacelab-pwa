import type { UserProfile, Workout } from '../analytics/types.ts';
import { currentVdot, PENALTY_RULES, predictAll, RACE_KM, velocityFor, ZONE_FRACTION } from '../analytics/predictor.ts';
import { DAY_MS } from '../analytics/workload.ts';
import { applyAdaptation, evaluateAdaptation, gatherAdaptiveInput, weekPace } from '../plans/adaptiveEngine.ts';
import { resolveMaxHr } from '../plans/hrZones.ts';
import { mafHr, mafTests } from '../plans/maf.ts';
import { fmtKm, fmtRangeKm, nearestRow, paceSecPerKm } from '../plans/pace.ts';
import { resolvePlan, selectBestPlan } from '../plans/planSelector.ts';
import {
  applyScheduleState, buildPlan, completedIds, dayNum, flattenPlan, formatDayMonth, isoFromLocal, isoFromRaceTs,
} from '../plans/schedule.ts';
import type { PlanSession } from '../plans/schedule.ts';
import { loadMafAdj, loadPlanMode, loadScheduleState } from '../plans/scheduleStore.ts';
import { parseDuration } from '../parsers/manual.ts';
import { fmtHms, todayStr } from './format.ts';

export interface NextSession {
  session: PlanSession;
  /** "Hari ini", "Besok", atau tanggal singkat. */
  dayLabel: string;
  isToday: boolean;
  /** Pace target siap tampil (mis. "6:10–6:30"), atau null bila belum bisa dihitung. */
  paceText: string | null;
  /** Rentang detak jantung target (bpm), atau null bila detak jantung maksimal belum diisi. */
  hr: [number, number] | null;
  durationMin: number | null;
}

/**
 * Sesi terdekat yang belum selesai dari jadwal latihan (hari ini atau setelahnya).
 * Memakai rumus yang sama dengan tab Jadwal; null bila tanggal lomba belum diisi
 * atau tidak ada sesi tersisa.
 */
export function nextSession(profile: UserProfile, workouts: Workout[], now: number): NextSession | null {
  const raceIso = profile.targetRaceDate ? isoFromRaceTs(profile.targetRaceDate) : null;
  if (!raceIso) return null;
  const todayIso = todayStr();

  const target = profile.targetDistance;
  const preds = predictAll(workouts, now);
  const pred = preds[target];
  const selection = selectBestPlan(workouts, profile, { now, projected5kSec: preds['5K']?.finalSec ?? null });
  const curriculum = resolvePlan(loadPlanMode(), selection);

  const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
  const startWeeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
  const vd = currentVdot(workouts, now);
  const easyVdot = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;

  let saved: string | null = null;
  try { saved = localStorage.getItem('pacelab.k5'); } catch { /* penyimpanan tidak tersedia */ }
  const k5 = parseDuration(saved ?? (preds['5K'] ? fmtHms(preds['5K'].finalSec) : ''));
  const row = k5 != null ? nearestRow(k5) : null;
  const easyPace = paceSecPerKm('rec', row) ?? easyVdot;

  const maxHr = resolveMaxHr(profile, workouts);
  const maxWeeklyKm = profile.weeklyTargetKm ?? PENALTY_RULES[target]?.weeklyKm ?? 50;
  // Program MAF: HR MAF menentukan target detak jantung; pace patokan dari catatan MAF (bukan VDOT).
  const maf = curriculum === 'maf' ? mafHr(profile.age, loadMafAdj()) : null;
  const mafPts = curriculum === 'maf' ? mafTests(workouts, maf) : [];
  const mafCenter = mafPts.length ? mafPts[mafPts.length - 1].paceSecPerKm : null;

  const st = loadScheduleState();
  const base = buildPlan({
    raceIso, todayIso, days: st.days, raceName: `${target} · Hari Lomba / Uji PB`,
    startWeeklyKm, maxWeeklyKm, easyPaceSecPerKm: easyPace, curriculum, maxHr, mafHr: maf,
  });
  const plan = applyScheduleState(base, st, raceIso);
  const flat = flattenPlan(plan);
  const done = completedIds(flat, new Set(workouts.map((w) => isoFromLocal(w.date))), st, todayIso);
  const decision = evaluateAdaptation(gatherAdaptiveInput(workouts, profile, now).input);
  const sessions = applyAdaptation(flat, decision, todayIso, done, maxHr).sessions;

  const s = sessions
    .filter((x) => !done.has(x.id) && dayNum(x.date) >= dayNum(todayIso))
    .sort((a, b) => dayNum(a.date) - dayNum(b.date))[0];
  if (!s) return null;

  const targetPace = profile.targetTimeSec / RACE_KM[target];
  const currentPace = pred ? pred.finalSec / RACE_KM[target] : null;
  const easy = s.kind === 'recovery' || s.kind === 'long';
  let paceText: string | null = null;
  // Sesi zona MAF (termasuk MAF Test): pace hanya patokan dari catatan MAF; null bila belum ada → UI menampilkan "Sesuai HR".
  if (s.zone === 'maf') paceText = mafCenter != null ? fmtRangeKm(mafCenter + (s.paceDeltaSec ?? 0)) : null;
  else if (easy) paceText = fmtRangeKm(easyPace + (s.paceDeltaSec ?? 0));
  else if (s.kind === 'race') paceText = fmtKm(targetPace);
  else if (currentPace != null) paceText = fmtKm(weekPace(currentPace, targetPace, s.weekNo, plan.totalWeeks));

  const diff = dayNum(s.date) - dayNum(todayIso);
  return {
    session: s,
    dayLabel: diff === 0 ? 'Hari ini' : diff === 1 ? 'Besok' : formatDayMonth(s.date),
    isToday: diff === 0,
    paceText,
    hr: s.hr ? [s.hr[0], s.hr[1]] : null,
    durationMin: s.adjDurationMin ?? s.durationMin ?? null,
  };
}
