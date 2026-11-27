import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Sparkles } from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
import {
  evaluateProgramResultsWithAi,
  loadGeminiApiKey,
  type ProgramEvaluationResult,
  type ProgramSessionSnapshot,
} from '../analytics/aiCoach';
import { stripMarkdown } from '../analytics/raceDayAnalyzer';
import { currentVdot, PENALTY_RULES, velocityFor, ZONE_FRACTION } from '../analytics/predictor';
import { DAY_MS } from '../analytics/workload';
import { resolveMaxHr } from '../plans/hrZones';
import {
  applyScheduleState,
  buildPlan,
  completedIds,
  dayNum,
  flattenPlan,
  isoFromLocal,
  isoFromRaceTs,
  type PlanSession,
} from '../plans/schedule';
import { loadScheduleState } from '../plans/scheduleStore';
import { todayStr } from './format';
import AiLoader from './AiLoader';

export default function ProgramEvaluationCard({
  profile,
  workouts,
  className = '',
}: {
  profile: UserProfile;
  workouts: Workout[];
  className?: string;
}) {
  const [hasApiKey, setHasApiKey] = useState(() => Boolean(loadGeminiApiKey()));
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<ProgramEvaluationResult | null>(null);

  useEffect(() => {
    const syncOnline = () => setIsOnline(navigator.onLine);
    const syncKey = () => setHasApiKey(Boolean(loadGeminiApiKey()));
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    window.addEventListener('storage', syncKey);
    window.addEventListener('focus', syncKey);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
      window.removeEventListener('storage', syncKey);
      window.removeEventListener('focus', syncKey);
    };
  }, []);

  const todayIso = todayStr();
  const scheduleContext = useMemo(() => {
    const now = Date.now();
    const st = loadScheduleState();
    const raceIso = profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : null;
    const maxHr = resolveMaxHr(profile, workouts);
    const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
    const weeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
    const vd = currentVdot(workouts, now);
    const easyPace = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;
    const maxWeeklyKm = profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 50;

    let flat: PlanSession[] = [];
    if (raceIso) {
      const base = buildPlan({
        raceIso,
        todayIso,
        days: st.days,
        raceName: `${profile.targetDistance} · Hari Lomba`,
        startWeeklyKm: weeklyKm,
        maxWeeklyKm,
        easyPaceSecPerKm: easyPace,
        curriculum: 'custom',
        maxHr,
      });
      const applied = applyScheduleState(base, st, raceIso);
      flat = flattenPlan(applied);
    } else {
      flat = [...(st.aiSessions ?? []), ...(st.customSessions ?? [])]
        .map((item) => ({ ...item, date: st.overrides[item.id] ?? item.date }))
        .sort((a, b) => dayNum(a.date) - dayNum(b.date));
    }

    const workoutDays = new Set(workouts.map((w) => isoFromLocal(w.date)));
    const done = completedIds(flat, workoutDays, st, todayIso);
    const targets = flat.filter((s) => s.kind !== 'race');
    return { st, done, targets };
  }, [profile, workouts, todayIso]);

  const { st, done, targets } = scheduleContext;
  const canEvaluateProgram = hasApiKey && isOnline && !evalLoading && targets.length > 0;

  const handleEvaluateProgram = async () => {
    const key = loadGeminiApiKey();
    setHasApiKey(Boolean(key));
    setEvalLoading(true);
    setEvalError(null);
    try {
      const now = Date.now();
      const plannedSessions: ProgramSessionSnapshot[] = targets.map((s) => ({
        date: s.date,
        kind: s.kind,
        name: s.name,
        status: done.has(s.id)
          ? 'done'
          : dayNum(s.date) < dayNum(todayIso)
            ? 'missed'
            : 'upcoming',
        targetDistanceKm: s.distanceKm,
        targetDurationMin: s.adjDurationMin ?? s.durationMin,
        targetHr: s.hr ?? null,
      }));
      const result = await evaluateProgramResultsWithAi(
        {
          profile,
          programTitle: st.programTitle,
          plannedSessions,
          workouts,
          todayIso,
          now,
        },
        { apiKey: key, isOnline: navigator.onLine },
      );
      setEvalResult(result);
    } catch (err) {
      setEvalError(
        err instanceof Error ? err.message : 'Gagal mengevaluasi hasil program dengan AI.',
      );
    } finally {
      setEvalLoading(false);
    }
  };

  const scoreTone =
    evalResult == null
      ? 'text-white'
      : evalResult.complianceScore >= 75
        ? 'text-[#BEF264]'
        : evalResult.complianceScore >= 50
          ? 'text-amber-400'
          : 'text-rose-400';

  return (
    <section aria-label="Evaluasi AI Hasil Program" className={`sport-card p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ClipboardCheck size={16} className="text-[#BEF264]" aria-hidden />
            <h2 className="font-display text-base font-bold text-white">
              Evaluasi AI Hasil Program
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">
            Bandingkan kepatuhan jadwal, zona HR, dan realisasi latihan Anda.
          </p>
        </div>

        <button
          type="button"
          onClick={handleEvaluateProgram}
          disabled={!canEvaluateProgram}
          className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-2xl border border-[#BEF264]/35 bg-[#BEF264]/10 px-4 text-xs font-bold text-[#BEF264] transition hover:bg-[#BEF264]/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          <Sparkles size={14} aria-hidden />
          <span>{evalLoading ? 'Menganalisis…' : 'Evaluasi Hasil Program'}</span>
        </button>
      </div>

      {!hasApiKey && (
        <p className="mt-2.5 text-xs text-zinc-400">
          Tambahkan Gemini API Key di Profil untuk mengaktifkan Evaluasi AI Hasil Program.
        </p>
      )}

      {targets.length === 0 && (
        <p className="mt-2.5 text-xs text-zinc-400">
          Tambahkan minimal 1 sesi di tab Program agar hasil program bisa dievaluasi.
        </p>
      )}

      {evalLoading && (
        <div className="mt-3">
          <AiLoader />
        </div>
      )}

      {evalError && (
        <p
          role="alert"
          className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400"
        >
          {evalError}
        </p>
      )}

      {evalResult && !evalLoading && (
        <div className="mt-4 space-y-3 border-t border-white/[0.08] pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-[#18181D] px-3.5 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Skor Kepatuhan Program
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-200">
                {stripMarkdown(evalResult.summary)}
              </p>
            </div>
            <div className={`font-mono text-2xl font-extrabold tabular-nums ${scoreTone}`}>
              {evalResult.complianceScore}%
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sport-subcard p-3">
              <div className="text-xs font-bold text-white">Poin Evaluasi</div>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-300">
                {evalResult.analysisPoints.map((pt, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" aria-hidden />
                    <span>{stripMarkdown(pt)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="sport-subcard p-3">
              <div className="text-xs font-bold text-[#BEF264]">Penyesuaian Berikutnya</div>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-300">
                {evalResult.nextAdjustments.map((adj, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#BEF264]" aria-hidden />
                    <span>{stripMarkdown(adj)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
