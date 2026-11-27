import type { UserProfile, Workout } from '../analytics/types.ts';
import { currentVdot, PENALTY_RULES, predictAll, RACE_KM, velocityFor, ZONE_FRACTION } from '../analytics/predictor.ts';
import { DAY_MS } from '../analytics/workload.ts';
import { applyAdaptation, evaluateAdaptation, gatherAdaptiveInput, weekPace } from '../plans/adaptiveEngine.ts';
import { hrRange, resolveMaxHr } from '../plans/hrZones.ts';
import { fmtKm, fmtPace, fmtRangeKm, nearestRow, paceSecPerKm } from '../plans/pace.ts';
import {
  applyScheduleState, buildPlan, completedIds, dayNum, flattenPlan, formatDayMonth, isoFromLocal, isoFromRaceTs,
} from '../plans/schedule.ts';
import type { PlanSession } from '../plans/schedule.ts';
import { loadScheduleState } from '../plans/scheduleStore.ts';
import { loadK5 } from '../plans/k5Store.ts';
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
 * Sesi terdekat yang belum selesai dari jadwal aktif pengguna
 * (`customSessions` / `aiSessions` / jadwal kalender dasar).
 * Mengembalikan null bila belum ada jadwal aktif atau semua sesi sudah selesai.
 */
export function nextSession(profile: UserProfile, workouts: Workout[], now: number): NextSession | null {
  const todayIso = todayStr();
  const raceIso = profile.targetRaceDate ? isoFromRaceTs(profile.targetRaceDate) : null;
  const st = loadScheduleState();

  const hasCustomOrAi = Boolean((st.customSessions && st.customSessions.length > 0) || (st.aiSessions && st.aiSessions.length > 0));
  if (st.customOnly && !hasCustomOrAi) {
    return null;
  }
  if (!raceIso && !hasCustomOrAi) {
    return null;
  }

  const target = profile.targetDistance;
  const preds = predictAll(workouts, now);
  const pred = preds[target];

  const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
  const startWeeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
  const vd = currentVdot(workouts, now);
  const easyVdot = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;

  const saved = loadK5();
  const k5 = parseDuration(saved ?? (preds['5K'] ? fmtHms(preds['5K'].finalSec) : ''));
  const row = k5 != null ? nearestRow(k5) : null;
  const easyPace = paceSecPerKm('rec', row) ?? easyVdot;

  const maxHr = resolveMaxHr(profile, workouts);
  const maxWeeklyKm = profile.weeklyTargetKm ?? PENALTY_RULES[target]?.weeklyKm ?? 50;
  const workoutDays = new Set(workouts.map((w) => isoFromLocal(w.date)));

  let s: PlanSession | undefined;
  let totalWeeks = 1;

  if (raceIso) {
    const base = buildPlan({
      raceIso,
      todayIso,
      days: st.days,
      raceName: `${target} · Hari Lomba / Uji PB`,
      startWeeklyKm,
      maxWeeklyKm,
      easyPaceSecPerKm: easyPace,
      curriculum: 'custom',
      maxHr,
    });
    const plan = applyScheduleState(base, st, raceIso);
    totalWeeks = Math.max(1, plan.totalWeeks);
    const flat = flattenPlan(plan);
    const done = completedIds(flat, workoutDays, st, todayIso);
    const decision = evaluateAdaptation(gatherAdaptiveInput(workouts, profile, now).input);
    const sessions = applyAdaptation(flat, decision, todayIso, done, maxHr).sessions;
    s = sessions
      .filter((x) => !done.has(x.id) && dayNum(x.date) >= dayNum(todayIso))
      .sort((a, b) => dayNum(a.date) - dayNum(b.date))[0];
  } else {
    const standalone = [...(st.aiSessions ?? []), ...(st.customSessions ?? [])]
      .map((item) => ({ ...item, date: st.overrides[item.id] ?? item.date }))
      .sort((a, b) => dayNum(a.date) - dayNum(b.date));
    const done = completedIds(standalone, workoutDays, st, todayIso);
    s = standalone.find((x) => !done.has(x.id) && dayNum(x.date) >= dayNum(todayIso));
  }

  if (!s) return null;

  const targetPace = profile.targetTimeSec / RACE_KM[target];
  const currentPace = pred ? pred.finalSec / RACE_KM[target] : null;
  const easy = s.kind === 'recovery' || s.kind === 'long';
  let paceText: string | null = null;
  if (s.pace) {
    paceText = s.pace[0] === s.pace[1] ? fmtKm(s.pace[0]) : `${fmtPace(s.pace[0])}–${fmtPace(s.pace[1])} /km`;
  } else if (easy) paceText = fmtRangeKm(easyPace + (s.paceDeltaSec ?? 0));
  else if (s.kind === 'race') paceText = fmtKm(targetPace);
  else if (currentPace != null) paceText = fmtKm(weekPace(currentPace, targetPace, s.weekNo, totalWeeks));

  const fallbackHr = s.zone ? hrRange(s.zone, maxHr) : hrRange(easy ? 'easy' : s.kind === 'race' ? 'race' : 'interval', maxHr);
  const effectiveHr = s.hr ?? fallbackHr;

  const diff = dayNum(s.date) - dayNum(todayIso);
  return {
    session: s,
    dayLabel: diff === 0 ? 'Hari ini' : diff === 1 ? 'Besok' : formatDayMonth(s.date),
    isToday: diff === 0,
    paceText,
    hr: effectiveHr ? [effectiveHr[0], effectiveHr[1]] : null,
    durationMin: s.adjDurationMin ?? s.durationMin ?? null,
  };
}
