import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Pencil, RotateCcw } from 'lucide-react';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import {
  currentVdot,
  predictAll,
  RACE_KM,
  velocityFor,
  ZONE_FRACTION,
} from '../analytics/predictor';
import { resolveMaxHr, zoneRestingHr } from '../plans/hrZones';
import {
  addCustomSession,
  addDays,
  formatDayMonthYear,
  getMondayIso,
  isoFromRaceTs,
  isValidIso,
  remaining,
  updateCustomSession,
} from '../plans/schedule';
import type { PlanSession, ScheduleState } from '../plans/schedule';
import { loadScheduleState, saveScheduleState } from '../plans/scheduleStore';
import {
  categoryToKind,
  getZoneBpm,
  kindToCategory,
  type SessionCategory,
  type WorkoutBlock,
} from '../plans/workoutTypes';
import { DAY_MS } from '../analytics/workload';
import { todayStr } from './format';
import RaceDayCard from './RaceDayCard';
import TargetRaceModal from './TargetRaceModal';
import TrainingPlan from './TrainingPlan';
import WorkoutBuilderModal from './WorkoutBuilderModal';

const SIM_DISTANCES: ReadonlyArray<{ id: RaceDistance; label: string }> = [
  { id: '5K', label: '5K' },
  { id: '10K', label: '10K' },
  { id: '21.1K', label: 'Half Marathon' },
  { id: '42.2K', label: 'Marathon' },
];

function defaultSimDateIso(): string {
  const future = new Date(Date.now() + 14 * DAY_MS);
  const y = future.getFullYear();
  const m = String(future.getMonth() + 1).padStart(2, '0');
  const d = String(future.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function Program({
  profile,
  workouts,
  onProfileChange,
}: {
  profile: UserProfile;
  workouts: Workout[];
  onProfileChange: () => void;
}) {
  const now = Date.now();
  const todayIso = todayStr();

  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [st, setSt] = useState<ScheduleState>(loadScheduleState);
  const [weekStartIso, setWeekStartIso] = useState(() => getMondayIso(todayIso));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [builderState, setBuilderState] = useState<{
    mode: 'create' | 'edit';
    session?: PlanSession;
  } | null>(null);

  const updateSchedule = (next: ScheduleState) => {
    setSt(next);
    saveScheduleState(next);
  };

  const profileRaceIso = profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : '';
  const [simOpen, setSimOpen] = useState(false);
  const [simDistance, setSimDistance] = useState<RaceDistance>(profile.targetDistance);
  const [simDateIso, setSimDateIso] = useState<string>(profileRaceIso);

  useEffect(() => {
    setSimDistance(profile.targetDistance);
    setSimDateIso(profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : '');
  }, [profile.targetDistance, profile.targetRaceDate]);

  const isSimulated =
    simDistance !== profile.targetDistance ||
    simDateIso !== profileRaceIso;

  const effectiveDistance: RaceDistance = simDistance;
  const validRaceIso = simDateIso && isValidIso(simDateIso) ? simDateIso : null;
  const rem = validRaceIso ? remaining(validRaceIso, todayIso) : null;
  const daysLeft = rem ? rem.daysRemaining : null;

  const preds = predictAll(workouts, now);
  const pred = preds[effectiveDistance];
  const currentPace = pred ? pred.finalSec / RACE_KM[effectiveDistance] : null;
  const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
  const weeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
  const vd = currentVdot(workouts, now);
  const easyPace = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;
  const maxHr = resolveMaxHr(profile, workouts) ?? 195;
  const restingHr = zoneRestingHr(profile);

  const hrZoneRefs = useMemo(
    () =>
      ([1, 2, 3, 4, 5] as const).map((z) => {
        const [lo, hi] = getZoneBpm(z, maxHr, restingHr);
        return { zone: z, label: `Z${z} ${lo}–${hi}` };
      }),
    [maxHr, restingHr],
  );

  const handleShiftWeek = (delta: -1 | 1) => {
    setWeekStartIso((prev) => addDays(prev, delta * 7));
    setSelectedDate(null);
  };

  const handleSaveBuilder = (payload: {
    date: string;
    category: SessionCategory;
    title: string;
    durationMin: number;
    distanceKm: number;
    hrRange: [number, number];
    paceRange: [number, number] | null;
    steps: string[];
    structuredSteps: WorkoutBlock[];
  }) => {
    const kind = categoryToKind(payload.category);
    if (builderState?.mode === 'edit' && builderState.session) {
      updateSchedule(
        updateCustomSession(st, builderState.session.id, {
          date: payload.date,
          kind,
          name: payload.title,
          distanceKm: payload.distanceKm,
          durationMin: payload.durationMin,
          hr: payload.hrRange,
          pace: payload.paceRange,
          steps: payload.steps,
          structuredSteps: payload.structuredSteps,
        }),
      );
    } else {
      updateSchedule(
        addCustomSession(st, {
          date: payload.date,
          kind,
          name: payload.title,
          distanceKm: payload.distanceKm,
          durationMin: payload.durationMin,
          hr: payload.hrRange,
          pace: payload.paceRange,
          steps: payload.steps,
          structuredSteps: payload.structuredSteps,
        }),
      );
    }
    setBuilderState(null);
  };

  const handleToggleSim = () => {
    if (!simOpen && !simDateIso) {
      setSimDateIso(defaultSimDateIso());
    }
    setSimOpen((v) => !v);
  };

  const handleResetSim = () => {
    setSimDistance(profile.targetDistance);
    setSimDateIso(profileRaceIso);
    setSimOpen(false);
  };

  const distanceTitle =
    effectiveDistance === '21.1K'
      ? 'Half Marathon'
      : effectiveDistance === '42.2K'
        ? 'Marathon'
        : effectiveDistance;

  const countdownBadge =
    daysLeft == null
      ? 'Belum diatur'
      : daysLeft === 0
        ? 'Hari Ini (H-0)'
        : daysLeft < 0
          ? 'Lewat'
          : `H-${daysLeft} (${daysLeft} hari lagi)`;

  return (
    <div className="space-y-4">
      {/* Sticky Header: Target Lomba, Hitung Mundur, & Referensi Zona HR */}
      <header
        aria-label="Target Lomba dan Zona HR"
        className="sticky top-14 z-20 rounded-2xl border border-white/10 bg-[#121215]/95 px-3.5 py-2.5 shadow-lg backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-sm font-extrabold tracking-tight text-white sm:text-base">
                {distanceTitle} · {validRaceIso ? formatDayMonthYear(validRaceIso) : 'Atur Tanggal'}
              </h1>
              <span className="rounded-md bg-[#BEF264]/15 px-2 py-0.5 font-mono text-[11px] font-extrabold tabular-nums text-[#BEF264]">
                {countdownBadge}
              </span>
              {isSimulated && (
                <span className="text-[11px] font-semibold text-sky-400">Simulasi</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10px] tabular-nums text-zinc-400">
              <span className="font-semibold text-zinc-300">Zona HR:</span>
              {hrZoneRefs.map((z) => (
                <span key={z.zone}>{z.label}</span>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTargetModalOpen(true)}
              className="inline-flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-xl border border-[#BEF264]/35 bg-[#BEF264]/10 px-3 text-xs font-bold text-[#BEF264] transition hover:bg-[#BEF264]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              <Pencil size={12} aria-hidden />
              <span>{profile.targetRaceDate > 0 ? 'Ubah Target' : 'Atur Target'}</span>
            </button>
            <button
              type="button"
              onClick={handleToggleSim}
              aria-expanded={simOpen}
              aria-label="Simulasi jarak dan tanggal lomba"
              className="inline-flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-xl border border-white/10 bg-[#18181D] px-2.5 text-xs font-semibold text-zinc-200 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              <CalendarDays size={13} aria-hidden />
              <span>{simOpen ? 'Tutup' : 'Simulasi'}</span>
            </button>
            {isSimulated && (
              <button
                type="button"
                onClick={handleResetSim}
                aria-label="Reset simulasi"
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/10 bg-[#18181D] px-2.5 text-xs font-semibold text-zinc-300 hover:text-white"
              >
                <RotateCcw size={13} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </header>

      {simOpen && (
        <section
          aria-label="Panel Simulasi Target"
          className="rounded-2xl border border-white/10 bg-[#121215] p-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Simulasi jarak lomba">
              {SIM_DISTANCES.map((d) => {
                const active = simDistance === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSimDistance(d.id)}
                    className={`min-h-[40px] whitespace-nowrap rounded-xl border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                      active
                        ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                        : 'border-white/10 bg-[#18181D] text-zinc-300 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>

            <input
              type="date"
              aria-label="Simulasi tanggal lomba"
              value={simDateIso}
              onChange={(e) => setSimDateIso(e.target.value)}
              className="min-h-[40px] rounded-xl border border-white/10 bg-[#18181D] px-3 text-xs font-medium text-zinc-100 tabular-nums focus:border-[#BEF264] focus:outline-none"
            />
          </div>
        </section>
      )}

      {/* Tampilan Terpadu: WeekStrip + Aksi Mingguan + Kartu Sesi */}
      <TrainingPlan
        profile={profile}
        workouts={workouts}
        defaultK5Sec={preds['5K']?.finalSec ?? null}
        currentPaceSecPerKm={currentPace}
        startWeeklyKm={weeklyKm}
        easyPaceSecPerKm={easyPace}
        scheduleState={st}
        weekStartIso={weekStartIso}
        selectedDate={selectedDate}
        onShiftWeek={handleShiftWeek}
        onSelectDate={setSelectedDate}
        onScheduleChange={updateSchedule}
        onAddCustomSession={() => setBuilderState({ mode: 'create' })}
        onEditCustomSession={(session) => setBuilderState({ mode: 'edit', session })}
      />

      {/* Analisa D-Day Lomba (Inline Terpadu) */}
      <details className="group sport-card overflow-hidden">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-white">
          <span>Analisa Kesiapan & Strategi Lomba</span>
          <ChevronDown
            className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="border-t border-white/[0.08] p-3 sm:p-4">
          <RaceDayCard
            profile={profile}
            workouts={workouts}
            simDistance={simDistance}
            simDateIso={simDateIso}
            hideTargetControls
          />
        </div>
      </details>

      {targetModalOpen && (
        <TargetRaceModal
          profile={profile}
          onClose={() => setTargetModalOpen(false)}
          onSaved={onProfileChange}
        />
      )}

      <WorkoutBuilderModal
        isOpen={Boolean(builderState)}
        initialDate={selectedDate ?? todayIso}
        initialData={
          builderState?.mode === 'edit' && builderState.session
            ? {
                date: builderState.session.date,
                category: kindToCategory(builderState.session.kind),
                title: builderState.session.name,
                structuredSteps: builderState.session.structuredSteps,
              }
            : undefined
        }
        maxHr={maxHr}
        restingHr={restingHr}
        onClose={() => setBuilderState(null)}
        onSave={handleSaveBuilder}
      />
    </div>
  );
}
