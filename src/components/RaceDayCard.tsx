import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Flag,
  Gauge,
  Lightbulb,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import {
  buildLocalRaceDayAnalysis,
  requestRaceDayAnalysis,
  type RaceDayAnalysis,
  type ReadinessStatus,
} from '../analytics/raceDayAnalyzer';
import { isoFromRaceTs } from '../plans/schedule';
import { loadMafAdj } from '../plans/scheduleStore';
import { loadShoes } from '../plans/shoeStore';
import { Button, SegmentedTabs, StatusPill, type Tone } from './ui';

type RaceDayTab = 'peringatan' | 'pacing' | 'tips';

const RACE_DAY_TABS: ReadonlyArray<{ id: RaceDayTab; label: string }> = [
  { id: 'peringatan', label: 'Kesehatan' },
  { id: 'pacing', label: 'Strategi Pace' },
  { id: 'tips', label: 'Tips Taktis' },
];

const DIST_OPTIONS: ReadonlyArray<{ id: RaceDistance; label: string }> = [
  { id: '5K', label: '5K' },
  { id: '10K', label: '10K' },
  { id: '21.1K', label: 'Half Marathon' },
  { id: '42.2K', label: 'Marathon' },
];

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
}

function defaultSimDateIso(): string {
  const future = new Date(Date.now() + 14 * 86_400_000);
  const y = future.getFullYear();
  const m = String(future.getMonth() + 1).padStart(2, '0');
  const d = String(future.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function RaceDayCard({ profile, workouts, className = '' }: Props) {
  const profileRaceIso = profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : '';
  const [simOpen, setSimOpen] = useState(() => !profile.targetRaceDate);
  const [simDistance, setSimDistance] = useState<RaceDistance>(profile.targetDistance);
  const [simDateIso, setSimDateIso] = useState<string>(profileRaceIso || defaultSimDateIso());
  const [tab, setTab] = useState<RaceDayTab>('peringatan');

  const [aiAnalysis, setAiAnalysis] = useState<RaceDayAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  useEffect(() => {
    setSimDistance(profile.targetDistance);
    setSimDateIso(profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : defaultSimDateIso());
    setAiAnalysis(null);
    setFallbackNote(null);
  }, [profile.targetDistance, profile.targetRaceDate]);

  const effectiveRaceDateTs = useMemo(() => {
    if (!simDateIso) return 0;
    const parsed = Date.parse(simDateIso);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [simDateIso]);

  const isSimulated =
    simDistance !== profile.targetDistance ||
    (profileRaceIso ? simDateIso !== profileRaceIso : true);

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

  const handleResetProfile = () => {
    setSimDistance(profile.targetDistance);
    setSimDateIso(profileRaceIso || defaultSimDateIso());
    setAiAnalysis(null);
    setFallbackNote(null);
  };

  const countdownLabel =
    activeAnalysis.daysToRace == null
      ? 'Simulasi'
      : activeAnalysis.daysToRace === 0
        ? 'Hari Ini'
        : activeAnalysis.daysToRace > 0
          ? `H-${activeAnalysis.daysToRace}`
          : 'Lewat';

  return (
    <section aria-label="Analisa D-Day Lomba" className={`sport-card p-5 ${className}`}>
      {/* Header & Status Badge */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-bold tracking-tight text-white">
              Analisa D-Day Lomba
            </h2>
            <StatusPill tone={meta.tone}>{activeAnalysis.readinessLabel}</StatusPill>
          </div>
          <p className="mt-1 text-xs text-zinc-400 tabular-nums">
            <span>{simDistance === '21.1K' ? 'Half Marathon' : simDistance === '42.2K' ? 'Marathon' : simDistance}</span>
            <span aria-hidden> · </span>
            <span>{countdownLabel}</span>
            <span aria-hidden> · </span>
            <span>{activeAnalysis.source === 'gemini' ? 'Gemini AI' : 'Kalkulasi Lokal'}</span>
            {isSimulated && (
              <>
                <span aria-hidden> · </span>
                <span className="text-sky-400">Mode Simulasi</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSimOpen((v) => !v)}
            aria-expanded={simOpen}
            className="inline-flex min-h-[38px] items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-[#18181D] px-3.5 text-xs font-semibold text-zinc-200 transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <CalendarDays size={14} aria-hidden />
            <span>{simOpen ? 'Tutup Simulasi' : 'Simulasi Target'}</span>
          </button>

          <Button
            variant="secondary"
            block={false}
            onClick={() => void handleRunAi()}
            disabled={aiLoading}
            className="min-h-[38px] gap-1.5 rounded-full border-[#BEF264]/35 bg-[#BEF264]/10 px-3.5 py-1.5 text-xs font-bold text-[#BEF264] hover:border-[#BEF264]/55 hover:bg-[#BEF264]/15"
          >
            {aiLoading ? (
              <RefreshCw size={13} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={13} aria-hidden />
            )}
            <span className="whitespace-nowrap">{aiLoading ? 'Menganalisis…' : 'Analisis AI'}</span>
          </Button>
        </div>
      </div>

      {/* Simulation Controls (Jarak & Tanggal Lomba) */}
      {simOpen && (
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#18181D]/80 p-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold text-zinc-400">Pilih Jarak Lomba</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Simulasi jarak lomba">
                {DIST_OPTIONS.map((d) => {
                  const active = simDistance === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSimDistance(d.id);
                        setAiAnalysis(null);
                        setFallbackNote(null);
                      }}
                      className={`min-h-[36px] whitespace-nowrap rounded-xl border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                        active
                          ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                          : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-[11px] font-semibold text-zinc-400">
                Tanggal Lomba
                <input
                  type="date"
                  value={simDateIso}
                  onChange={(e) => {
                    setSimDateIso(e.target.value);
                    setAiAnalysis(null);
                    setFallbackNote(null);
                  }}
                  className="mt-1 block min-h-[36px] rounded-xl border border-white/10 bg-[#121215] px-2.5 text-xs font-medium text-zinc-100 tabular-nums focus:border-[#BEF264] focus:outline-none"
                />
              </label>

              {profileRaceIso && isSimulated && (
                <button
                  type="button"
                  onClick={handleResetProfile}
                  className="min-h-[36px] whitespace-nowrap rounded-xl border border-white/10 bg-[#121215] px-3 text-xs font-semibold text-zinc-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                >
                  Reset Profil
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Readiness Banner + Instant Race Targets */}
      <div className={`mt-4 flex flex-col justify-between gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center ${meta.bannerClass}`}>
        <div className="flex items-start gap-2.5 min-w-0">
          <StatusIcon size={17} aria-hidden className="mt-0.5 shrink-0" />
          <p className="text-xs font-medium leading-relaxed sm:text-sm">
            {activeAnalysis.readinessHeadline}
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
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Pace Target</div>
            <div className="font-mono text-base font-extrabold text-sky-400">
              {activeAnalysis.targetPacePerKm}
            </div>
          </div>
        </div>
      </div>

      {fallbackNote && (
        <p className="mt-2 text-[11px] text-zinc-400">{fallbackNote}</p>
      )}

      {/* Compact Section Tabs */}
      <div className="mt-4">
        <SegmentedTabs
          idBase="raceday"
          label="Detail Analisa D-Day"
          tabs={RACE_DAY_TABS}
          value={tab}
          onChange={setTab}
        />
      </div>

      {/* Tab Content — short 1–2 line scannable points */}
      <div className="mt-3">
        {tab === 'peringatan' && (
          <ul
            id="raceday-panel-peringatan"
            role="tabpanel"
            aria-labelledby="raceday-tab-peringatan"
            className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#18181D]/60"
          >
            {activeAnalysis.healthWarnings.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5 px-3.5 py-3 text-xs leading-snug text-zinc-200 sm:text-sm">
                <Flag size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        {tab === 'pacing' && (
          <div
            id="raceday-panel-pacing"
            role="tabpanel"
            aria-labelledby="raceday-tab-pacing"
            className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#18181D]/60"
          >
            {activeAnalysis.pacingStrategy.map((seg, idx) => (
              <div key={idx} className="flex flex-col gap-1.5 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Gauge size={14} aria-hidden className="shrink-0 text-[#BEF264]" />
                    <span className="font-display text-xs font-bold text-white sm:text-sm">{seg.phase}</span>
                  </div>
                  <p className="mt-0.5 pl-[22px] text-xs leading-snug text-zinc-400">{seg.cue}</p>
                </div>

                <div className="flex shrink-0 items-center gap-3 pl-[22px] font-mono text-xs tabular-nums sm:pl-0 sm:text-right">
                  <span className="font-extrabold text-[#BEF264]">{seg.targetPace}</span>
                  <span className="text-zinc-600" aria-hidden>·</span>
                  <span className="font-semibold text-sky-400">{seg.targetHr}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'tips' && (
          <ul
            id="raceday-panel-tips"
            role="tabpanel"
            aria-labelledby="raceday-tab-tips"
            className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#18181D]/60"
          >
            {activeAnalysis.tacticalTips.map((tip, idx) => (
              <li key={idx} className="flex items-start gap-2.5 px-3.5 py-3 text-xs leading-snug text-zinc-200 sm:text-sm">
                <Lightbulb size={14} aria-hidden className="mt-0.5 shrink-0 text-[#BEF264]" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
