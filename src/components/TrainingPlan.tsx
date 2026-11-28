import { useEffect, useState } from 'react';
import {
  Check,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, cardiacDrift, efTrend } from '../analytics/workload';
import {
  generateAiTrainingPlan,
  loadGeminiApiKey,
  type AiTrainingPlanResult,
  type AiWeekCondition,
} from '../analytics/aiCoach';
import { stripMarkdown } from '../analytics/raceDayAnalyzer';
import { PENALTY_RULES, RACE_KM } from '../analytics/predictor';
import {
  applyAdaptation,
  evaluateAdaptation,
  gatherAdaptiveInput,
  weekPace,
} from '../plans/adaptiveEngine';
import { formatHrWithZone, resolveMaxHr, ZONE_LABEL, zoneRestingHr } from '../plans/hrZones';
import { fmtKm, fmtPace, fmtRangeKm, nearestRow, paceSecPerKm } from '../plans/pace';
import {
  addDays,
  applyScheduleState,
  autoCompleted,
  buildPlan,
  clearAiSchedule,
  completedIds,
  dayNum,
  deleteSessionsOnDate,
  flattenPlan,
  formatDateId,
  isoFromLocal,
  isoFromRaceTs,
  MIN_TRAINING_DAYS,
  resetSchedule,
  shiftAll,
  toggleDay,
  toggleDone,
  WEEKDAY_SHORT,
} from '../plans/schedule';
import type { IsoDate, PlanSession, ScheduleState } from '../plans/schedule';
import { formatDuration, kindToCategory } from '../plans/workoutTypes';
import { loadK5, saveK5 } from '../plans/k5Store';
import { saveScheduleState } from '../plans/scheduleStore';
import { parseDuration } from '../parsers/manual';
import { fmtHms, todayStr } from './format';
import AiLoader from './AiLoader';
import Sheet from './Sheet';
import WeekStrip from './WeekStrip';
import { KIND_LABEL } from './sessionMeta';
import { Button, Field } from './ui';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const CONDITION_OPTIONS: ReadonlyArray<{ value: AiWeekCondition; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'night_shift', label: 'Habis Shift Malam' },
  { value: 'hot_humid', label: 'Cuaca Panas' },
];

const SHORT_CATEGORY_LABEL: Record<PlanSession['kind'], string> = {
  recovery: 'Easy',
  long: 'Long Run',
  speed: 'Interval',
  race: 'Lomba',
};

const KIND_DOT: Record<PlanSession['kind'], string> = {
  recovery: 'bg-[#BEF264]',
  long: 'bg-sky-400',
  speed: 'bg-rose-500',
  race: 'bg-amber-400',
};

interface Props {
  profile: UserProfile;
  workouts: Workout[];
  defaultK5Sec: number | null;
  currentPaceSecPerKm: number | null;
  startWeeklyKm: number;
  easyPaceSecPerKm: number;
  scheduleState: ScheduleState;
  weekStartIso: IsoDate;
  selectedDate: IsoDate | null;
  onShiftWeek: (delta: -1 | 1) => void;
  onSelectDate: (iso: IsoDate | null) => void;
  onScheduleChange: (next: ScheduleState) => void;
  onAddCustomSession: () => void;
  onEditSession: (
    session: PlanSession,
    baseIdsOnDate: string[],
    remainingIfDeleted: number,
  ) => void;
}

export default function TrainingPlan({
  profile,
  workouts,
  defaultK5Sec,
  currentPaceSecPerKm,
  startWeeklyKm,
  easyPaceSecPerKm,
  scheduleState: st,
  weekStartIso,
  selectedDate,
  onShiftWeek,
  onSelectDate,
  onScheduleChange: update,
  onAddCustomSession,
  onEditSession,
}: Props) {
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
  const [askReset, setAskReset] = useState(false);

  const [k5Text, setK5Text] = useState(
    () => loadK5() ?? (defaultK5Sec != null ? fmtHms(defaultK5Sec) : ''),
  );
  const [fromPrediction, setFromPrediction] = useState(
    () => loadK5() == null && defaultK5Sec != null,
  );
  const [hasApiKey, setHasApiKey] = useState(() => Boolean(loadGeminiApiKey()));
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const [aiCondition, setAiCondition] = useState<AiWeekCondition>('normal');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<AiTrainingPlanResult | null>(null);

  const k5 = parseDuration(k5Text);
  const row = k5 != null ? nearestRow(k5) : null;

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

  const onK5 = (v: string) => {
    setK5Text(v);
    setFromPrediction(false);
    saveK5(v);
  };

  const todayIso = todayStr();
  const raceIso = profile.targetRaceDate ? isoFromRaceTs(profile.targetRaceDate) : null;
  const targetPace = profile.targetTimeSec / RACE_KM[profile.targetDistance];
  const maxHr = resolveMaxHr(profile, workouts);
  const restingHr = zoneRestingHr(profile);
  const maxWeeklyKm =
    profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 50;
  const easyPace = paceSecPerKm('rec', row) ?? easyPaceSecPerKm;
  const workoutDays = new Set(workouts.map((w) => isoFromLocal(w.date)));

  const deletedSet = new Set(st.deletedIds ?? []);
  const standaloneSessions: PlanSession[] = !raceIso
    ? [...(st.aiSessions ?? []), ...(st.customSessions ?? [])]
        .filter((item) => !deletedSet.has(item.id))
        .map((item) => ({ ...item, date: st.overrides[item.id] ?? item.date }))
        .sort((a, b) => dayNum(a.date) - dayNum(b.date))
    : [];

  const basePlan = raceIso
    ? buildPlan({
        raceIso,
        todayIso,
        days: st.days,
        raceName: `${profile.targetDistance} · Hari Lomba`,
        startWeeklyKm,
        maxWeeklyKm,
        easyPaceSecPerKm: easyPace,
        curriculum: 'custom',
        maxHr,
      })
    : null;

  const plan = basePlan && raceIso ? applyScheduleState(basePlan, st, raceIso) : null;
  const flat = plan ? flattenPlan(plan) : standaloneSessions;
  const done = completedIds(flat, workoutDays, st, todayIso);

  const gathered = gatherAdaptiveInput(workouts, profile, Date.now());
  const decision = evaluateAdaptation(gathered.input);
  const adapted = applyAdaptation(flat, decision, todayIso, done, maxHr);

  const byId = new Map(adapted.sessions.map((s) => [s.id, s]));

  const missed = flat.filter((s) => dayNum(s.date) < dayNum(todayIso) && !done.has(s.id)).length;
  const totalWeeks = plan ? plan.totalWeeks : 1;

  const weekEndIso = addDays(weekStartIso, 6);
  const weekDots = flat.map((s) => ({
    id: s.id,
    date: s.date,
    category: kindToCategory(s.kind),
  }));

  const weekRawSessions = flat.filter(
    (s) => dayNum(s.date) >= dayNum(weekStartIso) && dayNum(s.date) <= dayNum(weekEndIso),
  );
  const visibleRawSessions = selectedDate
    ? weekRawSessions.filter((s) => s.date === selectedDate)
    : weekRawSessions;

  const goalPaceFor = (s: PlanSession): number | null =>
    s.kind === 'race'
      ? targetPace
      : currentPaceSecPerKm == null
        ? null
        : weekPace(currentPaceSecPerKm, targetPace, s.weekNo, totalWeeks);

  const loadOf = (s: PlanSession): { min: number | null; km: number | null } => {
    const rawMin = s.adjDurationMin ?? s.durationMin;
    if (s.kind === 'speed' || s.kind === 'race') return { min: rawMin, km: s.distanceKm ?? null };
    const min =
      rawMin ?? (s.distanceKm != null ? Math.round((s.distanceKm * easyPace) / 60) : null);
    if (min == null) return { min: null, km: s.distanceKm ?? null };
    const km =
      s.distanceKm != null && s.durationMin
        ? (s.distanceKm * min) / s.durationMin
        : s.distanceKm ?? (min * 60) / easyPace;
    return { min, km };
  };

  const canGenerateAi = hasApiKey && isOnline && !aiLoading;
  const hasAiActive = Boolean(st.aiSessions && st.aiSessions.length > 0);

  const handleGenerateAiPlan = async () => {
    const key = loadGeminiApiKey();
    setHasApiKey(Boolean(key));
    setAiLoading(true);
    setAiError(null);
    try {
      const now = Date.now();
      const sorted = [...workouts].filter((w) => w.date <= now).sort((a, b) => b.date - a.date);
      const latestW = sorted[0];
      const latestPace = latestW
        ? latestW.avgPaceSecPerKm > 0
          ? latestW.avgPaceSecPerKm
          : latestW.distanceKm > 0
            ? latestW.durationSec / latestW.distanceKm
            : null
        : null;
      const result = await generateAiTrainingPlan(
        {
          profile,
          programTitle: st.programTitle,
          trainingDays: st.days,
          condition: aiCondition,
          weekStartIso,
          weekEndIso,
          acwr: acwr(workouts, profile, now),
          efTrend: efTrend(workouts, now),
          latestDriftPct: latestW ? cardiacDrift(latestW.laps) : null,
          weeklyVolumeKm: startWeeklyKm,
          latestAvgPaceSec: latestPace,
          workouts,
          todayIso,
          now,
        },
        { apiKey: key, isOnline: navigator.onLine },
      );
      setAiPreview(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Gagal menyusun jadwal minggu AI.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiPlan = () => {
    if (!aiPreview) return;
    const base = clearAiSchedule(st);
    const nextState: ScheduleState = {
      ...base,
      initialized: true,
      aiSessions: aiPreview.sessions,
      aiSummary: aiPreview.summary,
    };
    saveScheduleState(nextState);
    update(nextState);
    setAiPreview(null);
    setAiError(null);
    setAiSheetOpen(false);
  };

  const handleRestoreStandard = () => {
    const nextState: ScheduleState = { ...clearAiSchedule(st), initialized: true };
    saveScheduleState(nextState);
    update(nextState);
    setAiError(null);
  };

  const baseSessionsOnDate = (dateIso: IsoDate): string[] => {
    if (!basePlan || !raceIso) return [];
    const baseOnly = applyScheduleState(
      basePlan,
      {
        days: st.days,
        shift: st.shift,
        overrides: st.overrides,
        done: {},
      },
      raceIso,
    );
    return flattenPlan(baseOnly)
      .filter((b) => b.date === dateIso)
      .map((b) => b.id);
  };

  const handleDeleteDay = (dateIso: IsoDate) => {
    const baseIdsOnDate = baseSessionsOnDate(dateIso);
    const remainingCount = flat.filter((item) => item.date !== dateIso).length;
    const nextState = deleteSessionsOnDate(st, dateIso, baseIdsOnDate, remainingCount === 0);
    saveScheduleState(nextState);
    update(nextState);
  };

  const handleResetToDefault = () => {
    const nextState: ScheduleState = { ...resetSchedule(st), initialized: true };
    saveScheduleState(nextState);
    update(nextState);
    setAskReset(false);
    setAiSheetOpen(false);
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Kalender Mingguan Horizontal (Sen–Min) */}
      <WeekStrip
        weekStartIso={weekStartIso}
        weekEndIso={
          raceIso && dayNum(raceIso) >= dayNum(weekStartIso) && dayNum(raceIso) < dayNum(weekEndIso)
            ? raceIso
            : undefined
        }
        todayIso={todayIso}
        selectedDate={selectedDate}
        sessions={weekDots}
        onSelectDate={onSelectDate}
        onShiftWeek={onShiftWeek}
      />

      {/* Kosongkan Hari (hanya muncul bila tanggal terpilih memiliki sesi) */}
      {selectedDate && visibleRawSessions.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#121215] px-3.5 py-2 text-xs">
          <span className="font-semibold text-zinc-300">
            {formatDateId(selectedDate)} · {visibleRawSessions.length} sesi
          </span>
          <button
            type="button"
            onClick={() => handleDeleteDay(selectedDate)}
            className="inline-flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            <Trash2 size={13} aria-hidden />
            <span>Kosongkan Hari</span>
          </button>
        </div>
      )}

      {/* Hanya 2 Tombol Aksi Sejajar di Bawah Kalender */}
      <div className="grid grid-cols-2 gap-2" aria-label="Aksi Jadwal">
        <button
          type="button"
          onClick={() => {
            setAskReset(false);
            setAiSheetOpen(true);
          }}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl border border-[#BEF264]/35 bg-[#BEF264]/10 px-4 text-xs font-bold text-[#BEF264] transition hover:bg-[#BEF264]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          <Sparkles size={15} aria-hidden />
          <span>Susun AI</span>
        </button>

        <button
          type="button"
          onClick={onAddCustomSession}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl bg-[#BEF264] px-4 text-xs font-extrabold text-[#09090B] transition hover:bg-[#d4fc82] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          <Plus size={15} strokeWidth={2.5} aria-hidden />
          <span>Tambah</span>
        </button>
      </div>

      {/* Daftar Kartu Sesi Minimalis */}
      <section className="space-y-2.5" aria-label="Daftar Sesi Jadwal">
        {visibleRawSessions.length === 0 ? (
          <div className="sport-card border-dashed border-white/15 p-5 text-center">
            <p className="text-sm text-zinc-300">
              {selectedDate
                ? `Tidak ada sesi pada ${formatDateId(selectedDate)}.`
                : 'Belum ada sesi latihan pada minggu ini.'}
            </p>
            {raceIso && (st.clearedByUser || (st.deletedIds?.length ?? 0) > 0) && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-white/10 bg-[#18181D] px-4 text-xs font-semibold text-zinc-300 transition hover:text-white"
                >
                  <RotateCcw size={13} aria-hidden />
                  <span>Reset ke Default</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          visibleRawSessions.map((raw) => {
            const s = (byId.get(raw.id) ?? raw) as PlanSession;
            const isDone = done.has(s.id);
            const auto = autoCompleted(s, workoutDays, todayIso);
            const gp = goalPaceFor(s);
            const delta = s.paceDeltaSec ?? 0;
            const easy = s.kind === 'recovery' || s.kind === 'long';
            const { min, km } = loadOf(s);

            const showName =
              s.name && s.kind !== 'race' && !['Easy Run', 'Long Run'].includes(s.name);
            const rawTitle = s.convertedFrom
              ? s.name
              : showName
                ? s.name
                : KIND_LABEL[s.kind];
            const sessionTitle = stripMarkdown(rawTitle);

            const singleStep =
              s.structuredSteps?.length === 1 && s.structuredSteps[0].type === 'step'
                ? s.structuredSteps[0]
                : null;
            const exactTimeText =
              singleStep &&
              singleStep.durationType === 'time' &&
              singleStep.durationValue &&
              (singleStep.durationValue < 60 || singleStep.durationValue % 60 !== 0)
                ? formatDuration('time', singleStep.durationValue)
                : null;

            const loadPrimary =
              s.kind === 'race'
                ? `${profile.targetDistance} · ${fmtHms(profile.targetTimeSec)}`
                : exactTimeText
                  ? exactTimeText
                  : easy && km != null && min != null
                    ? `${km.toFixed(1)} km · ${Math.round(min)} mnt`
                    : easy && km != null
                      ? `${km.toFixed(1)} km`
                      : min != null
                        ? s.distanceKm != null
                          ? `${s.distanceKm.toFixed(1)} km · ${Math.round(min)} mnt`
                          : `${Math.round(min)} mnt`
                        : s.distanceKm != null
                          ? `${s.distanceKm.toFixed(1)} km`
                          : 'Sesuai langkah';

            const customPaceText = s.pace
              ? s.pace[0] === s.pace[1]
                ? fmtKm(s.pace[0])
                : `${fmtPace(s.pace[0])}–${fmtPace(s.pace[1])} /km`
              : null;

            const formattedHr = formatHrWithZone(s.hr, s.zone, maxHr, restingHr);
            const targetHrDisplay = formattedHr
              ? formattedHr
              : customPaceText
                ? customPaceText
                : easy
                  ? fmtRangeKm(easyPace + delta)
                  : gp != null
                    ? fmtKm(gp)
                    : s.zone
                      ? ZONE_LABEL[s.zone]
                      : 'Target HR';

            const dateDisplay = s.date === todayIso ? 'Hari ini' : formatDateId(s.date);
            const remainingIfDeleted = flat.filter((item) => item.id !== s.id).length;

            return (
              <article
                key={s.id}
                className={`sport-card flex items-center justify-between gap-3 p-3.5 transition hover:border-white/20 ${
                  isDone ? 'opacity-65' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onEditSession(s, baseSessionsOnDate(s.date), remainingIfDeleted)}
                  className="min-w-0 flex-1 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[s.kind]}`} aria-hidden />
                    <span className="font-semibold text-zinc-300">
                      {SHORT_CATEGORY_LABEL[s.kind]}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{dateDisplay}</span>
                  </div>

                  <h3 className="mt-1 truncate font-display text-base font-bold text-white">
                    {sessionTitle}
                  </h3>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs tabular-nums">
                    <span className="font-bold text-sky-400">{loadPrimary}</span>
                    <span className="text-zinc-500" aria-hidden>·</span>
                    <span className="font-semibold text-[#BEF264]">{targetHrDisplay}</span>
                  </div>
                </button>

                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  disabled={auto}
                  onClick={(e) => {
                    e.stopPropagation();
                    update(toggleDone(st, s.id));
                  }}
                  aria-label={`Tandai selesai: ${sessionTitle}`}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] disabled:opacity-60 ${
                    isDone
                      ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                      : 'border-white/15 bg-[#18181D] text-transparent hover:border-white/30'
                  }`}
                >
                  <Check size={20} strokeWidth={3} aria-hidden />
                </button>
              </article>
            );
          })
        )}
      </section>

      {/* Bottom Sheet: ✨ Susun AI + Pengaturan Hari & Reset */}
      {aiSheetOpen && (
        <Sheet
          title={aiPreview ? `Pratinjau Jadwal AI (${aiPreview.sessions.length} sesi)` : 'Susun AI & Pengaturan'}
          titleId="susun-ai-judul"
          onClose={() => {
            setAiPreview(null);
            setAiSheetOpen(false);
          }}
        >
          {aiPreview ? (
            <div className="space-y-4">
              <p className="rounded-2xl border border-[#BEF264]/25 bg-[#BEF264]/[0.08] px-3.5 py-2.5 text-xs leading-relaxed text-zinc-200">
                {stripMarkdown(aiPreview.summary)}
              </p>
              <ul className="space-y-2">
                {aiPreview.sessions.map((s) => (
                  <li key={s.id} className="sport-subcard p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-semibold text-zinc-100">{formatDateId(s.date)}</span>
                      <span className="font-bold text-[#BEF264]">{SHORT_CATEGORY_LABEL[s.kind]}</span>
                    </div>
                    <div className="mt-0.5 text-sm font-bold text-zinc-100">{stripMarkdown(s.name)}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono tabular-nums text-zinc-300">
                      {s.distanceKm != null && <span>{s.distanceKm.toFixed(1)} km</span>}
                      {s.durationMin != null && <span>{s.durationMin} mnt</span>}
                      {s.hr && <span>{formatHrWithZone(s.hr, s.zone, maxHr, restingHr)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="secondary" onClick={() => setAiPreview(null)}>
                  Kembali
                </Button>
                <Button onClick={handleApplyAiPlan}>Terapkan</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Bagian 1: Susun Jadwal AI */}
              <div className="space-y-3">
                <div className="text-sm font-semibold text-zinc-200">Kondisi Minggu Ini</div>
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Kondisi pelari untuk Susun AI">
                  {CONDITION_OPTIONS.map((opt) => {
                    const active = aiCondition === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setAiCondition(opt.value)}
                        className={`min-h-[44px] rounded-xl border px-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                          active
                            ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                            : 'border-white/10 bg-[#18181D] text-zinc-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {!hasApiKey && (
                  <p className="text-xs text-zinc-400">
                    Tambahkan Gemini API Key di Profil untuk mengaktifkan Susun AI.
                  </p>
                )}

                {aiLoading && <AiLoader />}
                {aiError && (
                  <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                    {aiError}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <Button onClick={handleGenerateAiPlan} disabled={!canGenerateAi} className="gap-1.5">
                    <Sparkles size={15} aria-hidden />
                    <span>{aiLoading ? 'Menyusun Jadwal AI…' : 'Buat Jadwal AI'}</span>
                  </Button>

                  {hasAiActive && (
                    <Button variant="secondary" onClick={handleRestoreStandard} className="gap-1.5">
                      <RotateCcw size={14} aria-hidden />
                      <span>Hapus Jadwal AI</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Bagian 2: Pengaturan Hari Rutin & Reset */}
              <div className="space-y-4 border-t border-white/10 pt-4">
                <div>
                  <div className="text-sm font-semibold text-zinc-200">
                    Hari latihan rutin <span className="font-normal text-zinc-400">(min {MIN_TRAINING_DAYS} hari)</span>
                  </div>
                  <div className="mt-2 grid grid-cols-7 gap-1.5">
                    {DAY_ORDER.map((d) => {
                      const on = st.days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => update(toggleDay(st, d))}
                          className={`min-h-[44px] rounded-xl text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                            on
                              ? 'bg-[#BEF264] text-[#09090B]'
                              : 'border border-white/10 bg-[#18181D] text-zinc-300'
                          }`}
                        >
                          {WEEKDAY_SHORT[d]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Field
                    label="5K terbaru"
                    term="MM:SS"
                    value={k5Text}
                    onChange={(e) => onK5(e.target.value)}
                    placeholder="27:00"
                    autoComplete="off"
                    hint={fromPrediction ? 'Dari prediksi terkini.' : 'Dasar kalkulasi pace.'}
                    error={k5Text && k5 == null ? 'Format MM:SS tidak valid.' : undefined}
                  />
                </div>

                <div>
                  <div className="text-sm font-semibold text-zinc-200">Geser & Reset</div>
                  {missed > 0 && <p className="mt-1 text-xs text-amber-400">{missed} sesi terlewat.</p>}
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Button variant="secondary" onClick={() => update(shiftAll(st, -1))}>
                      −1 hari
                    </Button>
                    <Button variant="secondary" onClick={() => update(shiftAll(st, 1))}>
                      +1 hari
                    </Button>
                    <Button variant="secondary" onClick={() => setAskReset(true)}>
                      Reset Default
                    </Button>
                  </div>

                  {askReset && (
                    <div
                      role="alertdialog"
                      aria-label="Konfirmasi reset jadwal"
                      className="mt-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3"
                    >
                      <p className="text-xs text-zinc-200">Reset jadwal ke pengaturan default?</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => setAskReset(false)}>
                          Batal
                        </Button>
                        <Button variant="danger-solid" onClick={handleResetToDefault}>
                          Reset ke Default
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
