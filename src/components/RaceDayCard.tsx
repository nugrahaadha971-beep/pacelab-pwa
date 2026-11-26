import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import {
  buildLocalRaceDayAnalysis,
  requestRaceDayAnalysis,
  stripMarkdown,
  type RaceDayAnalysis,
  type ReadinessStatus,
} from '../analytics/raceDayAnalyzer';
import { loadMafAdj } from '../plans/scheduleStore';
import { loadShoes } from '../plans/shoeStore';
import { Button, StatusPill, type Tone } from './ui';

const READINESS_META: Record<
  ReadinessStatus,
  { tone: Exclude<Tone, 'neutral'>; bannerClass: string; Icon: typeof CheckCircle2 }
> = {
  aman: {
    tone: 'good',
    bannerClass: 'border-[#BEF264]/25 bg-[#BEF264]/[0.07] text-zinc-100',
    Icon: CheckCircle2,
  },
  waspada: {
    tone: 'warn',
    bannerClass: 'border-amber-400/30 bg-amber-400/[0.08] text-amber-100',
    Icon: AlertTriangle,
  },
  risiko_tinggi: {
    tone: 'bad',
    bannerClass: 'border-rose-500/35 bg-rose-500/[0.09] text-rose-100',
    Icon: ShieldAlert,
  },
};

interface Props {
  profile: UserProfile;
  workouts: Workout[];
  className?: string;
  simDistance?: RaceDistance;
  simDateIso?: string;
  hideTargetControls?: boolean;
}

export default function RaceDayCard({
  profile,
  workouts,
  className = '',
  simDistance: controlledSimDistance,
  simDateIso: controlledSimDateIso,
}: Props) {
  const [aiAnalysis, setAiAnalysis] = useState<RaceDayAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const simDistance = controlledSimDistance ?? profile.targetDistance;
  const simDateIso = controlledSimDateIso ?? '';

  useEffect(() => {
    setAiAnalysis(null);
    setFallbackNote(null);
  }, [profile.targetDistance, profile.targetRaceDate, controlledSimDistance, controlledSimDateIso]);

  const effectiveRaceDateTs = useMemo(() => {
    if (!simDateIso) return profile.targetRaceDate;
    const parsed = Date.parse(simDateIso);
    return Number.isFinite(parsed) ? parsed : profile.targetRaceDate;
  }, [simDateIso, profile.targetRaceDate]);

  const shoes = useMemo(() => loadShoes(), [workouts]);
  const mafAdj = useMemo(() => loadMafAdj(), []);

  const localAnalysis = useMemo(
    () =>
      buildLocalRaceDayAnalysis({
        profile,
        workouts,
        targetDistance: simDistance,
        targetRaceDate: effectiveRaceDateTs,
        shoes,
        mafAdjustment: mafAdj,
      }),
    [profile, workouts, simDistance, effectiveRaceDateTs, shoes, mafAdj],
  );

  const activeAnalysis = aiAnalysis ?? localAnalysis;
  const meta = READINESS_META[activeAnalysis.readinessStatus];
  const StatusIcon = meta.Icon;

  const handleRunAi = async () => {
    setAiLoading(true);
    setFallbackNote(null);
    const res = await requestRaceDayAnalysis({
      profile,
      workouts,
      targetDistance: simDistance,
      targetRaceDate: effectiveRaceDateTs,
      shoes,
      mafAdjustment: mafAdj,
    });
    if (res.analysis.source === 'gemini') {
      setAiAnalysis(res.analysis);
      setFallbackNote(null);
    } else {
      setAiAnalysis(null);
      setFallbackNote(res.fallbackReason ?? 'Menggunakan kalkulasi lokal offline.');
    }
    setAiLoading(false);
  };

  const conciseWarnings = activeAnalysis.healthWarnings.slice(0, 3).map(stripMarkdown);

  return (
    <section aria-label="Analisa D-Day Lomba" className={`space-y-4 ${className}`}>
      {/* Kesiapan & Target Lomba */}
      <div className="sport-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-bold text-white">Kesiapan D-Day</h2>
            <StatusPill tone={meta.tone}>{activeAnalysis.readinessLabel}</StatusPill>
          </div>

          <Button
            variant="secondary"
            block={false}
            onClick={() => void handleRunAi()}
            disabled={aiLoading}
            className="min-h-[44px] gap-1.5 rounded-full border-[#BEF264]/35 bg-[#BEF264]/10 px-4 text-xs font-bold text-[#BEF264] hover:border-[#BEF264]/55 hover:bg-[#BEF264]/15"
          >
            {aiLoading ? (
              <RefreshCw size={14} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={14} aria-hidden />
            )}
            <span className="whitespace-nowrap">{aiLoading ? 'Menganalisis…' : 'Analisis AI'}</span>
          </Button>
        </div>

        <div className={`mt-3.5 flex flex-col justify-between gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center ${meta.bannerClass}`}>
          <div className="flex items-start gap-2.5 min-w-0">
            <StatusIcon size={17} aria-hidden className="mt-0.5 shrink-0" />
            <p className="text-xs font-medium leading-snug sm:text-sm">
              {stripMarkdown(activeAnalysis.readinessHeadline)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-4 border-t border-white/10 pt-2.5 tabular-nums sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Estimasi Finis</div>
              <div className="font-mono text-base font-extrabold text-[#BEF264]">
                {activeAnalysis.estimatedFinishTime}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Target Pace</div>
              <div className="font-mono text-base font-extrabold text-sky-400">
                {activeAnalysis.targetPacePerKm}
              </div>
            </div>
          </div>
        </div>

        {fallbackNote && <p className="mt-2 text-xs text-zinc-400">{fallbackNote}</p>}
      </div>

      {/* Strategi Pacing (Awal, Tengah, Akhir) */}
      <div className="sport-card p-5">
        <h3 className="font-display text-sm font-bold text-white">Strategi Pacing</h3>
        <div className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#18181D]/60">
          {activeAnalysis.pacingStrategy.map((seg, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Gauge size={14} aria-hidden className="shrink-0 text-[#BEF264]" />
                  <span className="font-display text-xs font-bold text-white sm:text-sm">
                    {stripMarkdown(seg.phase)}
                  </span>
                </div>
                <p className="mt-0.5 pl-[22px] text-xs leading-snug text-zinc-400">
                  {stripMarkdown(seg.cue)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3 pl-[22px] font-mono text-xs tabular-nums sm:pl-0 sm:text-right">
                <span className="font-extrabold text-[#BEF264]">{seg.targetPace}</span>
                <span className="text-zinc-600" aria-hidden>·</span>
                <span className="font-semibold text-sky-400">{seg.targetHr}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Peringatan Kesehatan & Nutrisi (Maksimal 3 Poin Ringkas) */}
      <div className="sport-card p-5">
        <h3 className="font-display text-sm font-bold text-white">Kesehatan & Nutrisi</h3>
        <ul className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#18181D]/60">
          {conciseWarnings.map((item, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2.5 px-4 py-3 text-xs leading-snug text-zinc-200 sm:text-sm"
            >
              <Flag size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
