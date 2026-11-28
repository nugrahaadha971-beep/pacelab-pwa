import { useState } from 'react';
import { ChevronDown, Pencil } from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
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
  deleteSession,
  formatDayMonthYear,
  getMondayIso,
  isoFromRaceTs,
  isValidIso,
  remaining,
  upsertEditedSession,
} from '../plans/schedule';
import type { PlanSession, ScheduleState } from '../plans/schedule';
import { loadScheduleState, saveScheduleState } from '../plans/scheduleStore';
import {
  categoryToKind,
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
    baseIdsOnDate?: string[];
    remainingIfDeleted?: number;
  } | null>(null);

  const updateSchedule = (next: ScheduleState) => {
    saveScheduleState(next);
    setSt(next);
  };

  const profileRaceIso = profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : '';
  const validRaceIso = profileRaceIso && isValidIso(profileRaceIso) ? profileRaceIso : null;
  const rem = validRaceIso ? remaining(validRaceIso, todayIso) : null;
  const daysLeft = rem ? rem.daysRemaining : null;

  const preds = predictAll(workouts, now);
  const pred = preds[profile.targetDistance];
  const currentPace = pred ? pred.finalSec / RACE_KM[profile.targetDistance] : null;
  const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
  const weeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
  const vd = currentVdot(workouts, now);
  const easyPace = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;
  const maxHr = resolveMaxHr(profile, workouts) ?? 195;
  const restingHr = zoneRestingHr(profile);

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
        upsertEditedSession(
          st,
          builderState.session,
          {
            date: payload.date,
            kind,
            name: payload.title,
            distanceKm: payload.distanceKm,
            durationMin: payload.durationMin,
            hr: payload.hrRange,
            pace: payload.paceRange,
            steps: payload.steps,
            structuredSteps: payload.structuredSteps,
          },
          builderState.baseIdsOnDate ?? [],
        ),
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

  const handleDeleteFromBuilder = () => {
    if (builderState?.mode !== 'edit' || !builderState.session) return;
    const nextState = deleteSession(st, builderState.session.id, {
      extraDeletedIds: builderState.baseIdsOnDate ?? [],
      markClearedIfEmpty: (builderState.remainingIfDeleted ?? 0) === 0,
    });
    saveScheduleState(nextState);
    setSt(nextState);
    setBuilderState(null);
  };

  const distanceTitle =
    profile.targetDistance === '21.1K'
      ? 'HM'
      : profile.targetDistance === '42.2K'
        ? 'FM'
        : profile.targetDistance;

  const countdownLabel =
    daysLeft == null
      ? ''
      : daysLeft === 0
        ? ' (H-0)'
        : daysLeft < 0
          ? ' (Lewat)'
          : ` (H-${daysLeft})`;

  return (
    <div className="space-y-4">
      {/* Header 1 baris: Target Lomba + tombol Edit */}
      <header
        aria-label="Target Lomba"
        className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121215] px-4 py-2.5"
      >
        <h1 className="min-w-0 truncate font-display text-sm font-extrabold tracking-tight text-white sm:text-base">
          Target: {distanceTitle} · {validRaceIso ? formatDayMonthYear(validRaceIso) : 'Atur Tanggal'}
          {countdownLabel && <span className="font-mono text-[#BEF264]">{countdownLabel}</span>}
        </h1>

        <button
          type="button"
          onClick={() => setTargetModalOpen(true)}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/10 bg-[#18181D] px-3 text-xs font-bold text-[#BEF264] transition hover:border-[#BEF264]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          <Pencil size={12} aria-hidden />
          <span>Edit</span>
        </button>
      </header>

      {/* WeekStrip + 2 Tombol Aksi + Kartu Sesi Minimalis */}
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
        onEditSession={(session, baseIdsOnDate, remainingIfDeleted) =>
          setBuilderState({ mode: 'edit', session, baseIdsOnDate, remainingIfDeleted })
        }
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
            simDistance={profile.targetDistance}
            simDateIso={profileRaceIso}
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

      {builderState && (
        <WorkoutBuilderModal
          isOpen
          initialDate={selectedDate ?? todayIso}
          initialData={
            builderState.mode === 'edit' && builderState.session
              ? {
                  date: builderState.session.date,
                  category: kindToCategory(builderState.session.kind),
                  title: builderState.session.name,
                  durationMin: builderState.session.adjDurationMin ?? builderState.session.durationMin,
                  distanceKm: builderState.session.distanceKm,
                  hr: builderState.session.hr,
                  pace: builderState.session.pace,
                  structuredSteps: builderState.session.structuredSteps,
                }
              : undefined
          }
          maxHr={maxHr}
          restingHr={restingHr}
          onClose={() => setBuilderState(null)}
          onDelete={builderState.mode === 'edit' ? handleDeleteFromBuilder : undefined}
          onSave={handleSaveBuilder}
        />
      )}
    </div>
  );
}
