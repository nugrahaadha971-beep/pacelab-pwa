import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, cardiacDrift, efTrend } from '../analytics/workload';
import {
  AI_WEEK_CONDITION_LABEL,
  generateAiTrainingPlan,
  loadGeminiApiKey,
  type AiTrainingPlanResult,
  type AiWeekCondition,
} from '../analytics/aiCoach';
import { stripMarkdown } from '../analytics/raceDayAnalyzer';
import { PENALTY_RULES, RACE_KM } from '../analytics/predictor';
import {
  applyAdaptation,
  calibrateFrom3k,
  evaluateAdaptation,
  gatherAdaptiveInput,
  intervalPaceRange,
  weekPace,
} from '../plans/adaptiveEngine';
import { formatHrWithZone, resolveMaxHr, speedHrSegments, ZONE_LABEL, zoneRestingHr } from '../plans/hrZones';
import { fmtKm, fmtPace, fmtRangeKm, nearestRow, paceSecPerKm } from '../plans/pace';
import {
  addDays,
  applyScheduleState,
  autoCompleted,
  buildPlan,
  clearAiSchedule,
  completedIds,
  dayNum,
  deleteCustomSession,
  flattenPlan,
  formatDateId,
  formatDayMonth,
  isoFromLocal,
  isoFromRaceTs,
  MIN_TRAINING_DAYS,
  resetSchedule,
  setSessionDate,
  shiftAll,
  swapSessions,
  toggleDay,
  toggleDone,
  WEEKDAY_SHORT,
} from '../plans/schedule';
import type { IsoDate, PlanSession, ScheduleState } from '../plans/schedule';
import { kindToCategory } from '../plans/workoutTypes';
import { loadK5, saveK5 } from '../plans/k5Store';
import { parseDuration } from '../parsers/manual';
import { fmtHms, todayStr } from './format';
import AiLoader from './AiLoader';
import Sheet from './Sheet';
import WeekStrip from './WeekStrip';
import { StructuredWorkoutPreview } from './WorkoutBuilderModal';
import { KIND_BORDER, KIND_LABEL } from './sessionMeta';
import { Button, Field } from './ui';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const CONDITION_OPTIONS: ReadonlyArray<{ value: AiWeekCondition; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'night_shift', label: 'Habis Shift Malam' },
  { value: 'hot_humid', label: 'Cuaca Panas/Lembap' },
];
const control =
  'mt-1 block min-h-[44px] w-full rounded-2xl border border-white/10 bg-[#121215] px-3 py-2 text-sm tabular-nums text-zinc-100 focus:border-[#BEF264] focus:outline-none focus:ring-2 focus:ring-[#BEF264]/35';

const fmtRangeMinMax = ([fast, slow]: [number, number]) =>
  `${fmtPace(fast)}–${fmtPace(slow)} /km`;

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
  onEditCustomSession: (session: PlanSession) => void;
}

interface SettingsProps {
  st: ScheduleState;
  update: (next: ScheduleState) => void;
  k5Text: string;
  onK5: (v: string) => void;
  k5: number | null;
  paceChartRow: ReturnType<typeof nearestRow> | null;
  fromPrediction: boolean;
  missed: number;
  onClose: () => void;
}

function SettingsSheet({
  st,
  update,
  k5Text,
  onK5,
  k5,
  paceChartRow,
  fromPrediction,
  missed,
  onClose,
}: SettingsProps) {
  const [askReset, setAskReset] = useState(false);
  const k5Hint = fromPrediction ? 'Dari prediksi Riegel terkini.' : 'Dasar kalkulasi pace.';
  return (
    <Sheet title="Atur jadwal" titleId="atur-jadwal-judul" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <Field
            label="5K terbaru"
            term="MM:SS"
            value={k5Text}
            onChange={(e) => onK5(e.target.value)}
            placeholder="27:00"
            autoComplete="off"
            hint={k5Hint}
            error={k5Text && k5 == null ? 'Format MM:SS tidak valid.' : undefined}
          />
          {paceChartRow && (
            <p className="mt-2 text-xs tabular-nums text-zinc-400">
              Pace 5K {fmtPace(paceChartRow[1])} · Interval {fmtKm(paceChartRow[0] / 1.609344)}
            </p>
          )}
        </div>

        <div>
          <div className="text-sm font-semibold text-zinc-200">
            Hari latihan <span className="font-normal text-zinc-400">(min {MIN_TRAINING_DAYS} hari)</span>
          </div>
          <div className="mt-1.5 grid grid-cols-7 gap-1.5">
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
          <div className="text-sm font-semibold text-zinc-200">Geser jadwal</div>
          {missed > 0 && <p className="mt-1 text-xs text-amber-400">{missed} sesi terlewat.</p>}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button variant="secondary" onClick={() => update(shiftAll(st, -1))}>
              −1 hari
            </Button>
            <Button variant="secondary" onClick={() => update(shiftAll(st, 1))}>
              +1 hari
            </Button>
            <Button variant="secondary" onClick={() => setAskReset(true)}>
              Reset
            </Button>
          </div>
          {askReset && (
            <div
              role="alertdialog"
              aria-label="Konfirmasi reset jadwal"
              className="mt-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3"
            >
              <p className="text-xs text-zinc-200">Reset jadwal ke pengaturan awal?</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setAskReset(false)}>
                  Batal
                </Button>
                <Button
                  variant="danger-solid"
                  onClick={() => {
                    update(resetSchedule(st));
                    setAskReset(false);
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
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
  onEditCustomSession,
}: Props) {
  const [settings, setSettings] = useState(false);
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
  const effectiveMaxHr = maxHr ?? 195;
  const restingHr = zoneRestingHr(profile);
  const maxWeeklyKm =
    profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 50;
  const customIds = new Set((st.customSessions ?? []).map((c) => c.id));
  const easyPace = paceSecPerKm('rec', row) ?? easyPaceSecPerKm;
  const workoutDays = new Set(workouts.map((w) => isoFromLocal(w.date)));

  const standaloneSessions: PlanSession[] = !raceIso
    ? [...(st.aiSessions ?? []), ...(st.customSessions ?? [])]
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

  const test3k = flat.find((x) => x.test === '3k');
  const testWeek = test3k && plan ? plan.weeks[test3k.weekNo - 1] : undefined;
  const calib = testWeek
    ? calibrateFrom3k(workouts, maxHr, testWeek.startIso, testWeek.endIso)
    : null;
  const projPace = calib && profile.targetDistance === '5K' ? calib.pace5kSecPerKm : currentPaceSecPerKm;
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
      : projPace == null
        ? null
        : weekPace(projPace, targetPace, s.weekNo, totalWeeks);

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

  const weekKm = weekRawSessions.reduce(
    (sum, r) => sum + (loadOf((byId.get(r.id) ?? r) as PlanSession).km ?? 0),
    0,
  );

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
    update({
      ...base,
      aiSessions: aiPreview.sessions,
      aiSummary: aiPreview.summary,
    });
    setAiPreview(null);
    setAiError(null);
  };

  const handleRestoreStandard = () => {
    update(clearAiSchedule(st));
    setAiError(null);
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

      {/* Aksi Mingguan: Kondisi + Isi Minggu AI + Tambah Sesi */}
      <section
        aria-label="Aksi Jadwal Mingguan"
        className="rounded-2xl border border-white/10 bg-[#121215] p-3.5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Kondisi pelari untuk Isi Minggu AI">
            {CONDITION_OPTIONS.map((opt) => {
              const active = aiCondition === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAiCondition(opt.value)}
                  className={`min-h-[36px] whitespace-nowrap rounded-xl border px-2.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                    active
                      ? 'border-[#BEF264]/60 bg-[#BEF264]/15 text-[#BEF264]'
                      : 'border-white/10 bg-[#18181D] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {weekKm > 0 && (
              <span className="font-mono text-xs font-bold tabular-nums text-sky-400">
                {weekKm.toFixed(1)} km
              </span>
            )}
            <button
              type="button"
              onClick={() => setSettings(true)}
              aria-haspopup="dialog"
              aria-label="Atur hari latihan"
              className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-white/10 bg-[#18181D] px-2.5 text-xs font-semibold text-zinc-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              <SlidersHorizontal size={13} aria-hidden />
              <span>Atur Hari</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleGenerateAiPlan}
            disabled={!canGenerateAi}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-[#BEF264]/35 bg-[#BEF264]/10 px-4 text-xs font-bold text-[#BEF264] transition hover:bg-[#BEF264]/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <Sparkles size={15} aria-hidden />
            <span>
              {aiLoading
                ? 'Menyusun Minggu AI…'
                : `Isi Minggu AI (${AI_WEEK_CONDITION_LABEL[aiCondition]})`}
            </span>
          </button>

          <button
            type="button"
            onClick={onAddCustomSession}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl bg-[#BEF264] px-4 text-xs font-extrabold text-[#09090B] transition hover:bg-[#d4fc82] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <Plus size={15} strokeWidth={2.5} aria-hidden />
            <span>Tambah Sesi</span>
          </button>
        </div>

        {hasAiActive && (
          <div className="flex items-center justify-between border-t border-white/[0.08] pt-2 text-xs">
            <span className="truncate text-zinc-400">
              {st.aiSummary ? stripMarkdown(st.aiSummary) : 'Jadwal AI aktif diterapkan.'}
            </span>
            <button
              type="button"
              onClick={handleRestoreStandard}
              className="ml-2 inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-[#18181D] px-2.5 text-xs font-semibold text-zinc-300 hover:text-white"
            >
              <RotateCcw size={12} aria-hidden />
              <span>Hapus AI</span>
            </button>
          </div>
        )}
      </section>

      {!hasApiKey && (
        <p className="text-xs text-zinc-400">
          Tambahkan Gemini API Key di Profil untuk mengaktifkan Isi Minggu AI.
        </p>
      )}
      {aiLoading && <AiLoader />}
      {aiError && (
        <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
          {aiError}
        </p>
      )}

      {/* Daftar Sesi Minggu / Tanggal Terpilih */}
      <section className="space-y-3" aria-label="Daftar Sesi Jadwal">
        {visibleRawSessions.length === 0 ? (
          <div className="sport-card border-dashed border-white/15 p-5 text-center">
            <p className="text-sm text-zinc-300">
              {selectedDate
                ? `Tidak ada sesi latihan pada ${formatDateId(selectedDate)}.`
                : 'Belum ada sesi latihan pada minggu ini.'}
            </p>
            <button
              type="button"
              onClick={onAddCustomSession}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-[#BEF264]/35 bg-[#BEF264]/10 px-4 text-xs font-bold text-[#BEF264] transition hover:bg-[#BEF264]/15"
            >
              <Plus size={14} aria-hidden />
              <span>Tambah Sesi</span>
            </button>
          </div>
        ) : (
          visibleRawSessions.map((raw) => {
            const s = (byId.get(raw.id) ?? raw) as PlanSession;
            const isDone = done.has(s.id);
            const auto = autoCompleted(s, workoutDays, todayIso);
            const gp = goalPaceFor(s);
            const status = isDone
              ? 'Selesai'
              : dayNum(s.date) < dayNum(todayIso)
                ? 'Terlewat'
                : s.date === todayIso
                  ? 'Hari ini'
                  : 'Mendatang';
            const statusColor = isDone
              ? 'text-[#BEF264]'
              : status === 'Terlewat'
                ? 'text-amber-400'
                : status === 'Hari ini'
                  ? 'text-[#BEF264]'
                  : 'text-zinc-400';
            const delta = s.paceDeltaSec ?? 0;
            const easy = s.kind === 'recovery' || s.kind === 'long';
            const calibPace =
              calib && test3k && s.zone === 'interval' && s.weekNo > test3k.weekNo
                ? intervalPaceRange(calib.pace3kSecPerKm, s.repKm)
                : null;
            const { min, km } = loadOf(s);
            const showName = s.name && s.kind !== 'race' && !['Easy Run', 'Long Run'].includes(s.name);
            const swapChoices = weekRawSessions
              .filter((o) => o.id !== s.id && o.kind !== 'race' && !done.has(o.id))
              .map((o) => (byId.get(o.id) ?? o) as PlanSession);
            const rawTitle = s.convertedFrom
              ? s.name
              : `${KIND_LABEL[s.kind]}${showName ? ` · ${s.name}` : ''}`;
            const sessionTitle = stripMarkdown(rawTitle);
            const isCustom = customIds.has(s.id);

            const loadPrimary =
              s.kind === 'race'
                ? `${profile.targetDistance} · ${fmtHms(profile.targetTimeSec)}`
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

            const targetPaceOrHr = formattedHr
              ? formattedHr
              : customPaceText
                ? customPaceText
                : easy
                  ? fmtRangeKm(easyPace + delta)
                  : gp != null
                    ? fmtKm(gp)
                    : s.zone
                      ? ZONE_LABEL[s.zone]
                      : 'Isi HR di Profil';

            return (
              <article
                key={s.id}
                className={`sport-card border-l-[3px] p-4 ${KIND_BORDER[s.kind]} ${isDone ? 'opacity-75' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold tabular-nums text-zinc-400">
                      {formatDateId(s.date)}
                    </span>
                    {isCustom && (
                      <span className="rounded-md bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-400">
                        Mandiri
                      </span>
                    )}
                    {formattedHr && (
                      <span className="rounded-md border border-[#BEF264]/25 bg-[#BEF264]/10 px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-[#BEF264]">
                        {formattedHr}
                      </span>
                    )}
                  </div>
                  <div className={`flex items-center gap-2 ${statusColor}`}>
                    <span className="text-xs font-bold">
                      {status}
                      {auto ? ' · Otomatis' : ''}
                    </span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isDone}
                      disabled={auto}
                      onClick={() => update(toggleDone(st, s.id))}
                      aria-label={`Tandai selesai: ${KIND_LABEL[s.kind]}`}
                      className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] disabled:opacity-60 ${
                        isDone
                          ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                          : 'border-white/15 bg-[#18181D] text-transparent'
                      }`}
                    >
                      <Check size={20} strokeWidth={3} aria-hidden />
                    </button>
                  </div>
                </div>

                <h3 className="mt-1 font-display text-base font-bold text-white sm:text-lg">
                  {sessionTitle}
                </h3>

                <dl className="mt-2.5 grid grid-cols-2 gap-2.5">
                  <div className="sport-subcard p-3">
                    <dt className="text-[11px] font-medium text-zinc-400">Jarak / Durasi</dt>
                    <dd className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-sky-400 sm:text-base">
                      {loadPrimary}
                    </dd>
                  </div>
                  <div className="sport-subcard p-3">
                    <dt className="text-[11px] font-medium text-zinc-400">Target HR / Pace</dt>
                    <dd className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-[#BEF264] sm:text-base">
                      {targetPaceOrHr}
                    </dd>
                    {s.hr && customPaceText && (
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-300">
                        Pace {customPaceText}
                      </div>
                    )}
                  </div>
                </dl>

                {/* Rincian Blok Terstruktur (Repeat Nx & Langkah Garmin) */}
                {s.structuredSteps && s.structuredSteps.length > 0 && (
                  <div className="mt-3">
                    <StructuredWorkoutPreview
                      blocks={s.structuredSteps}
                      maxHr={effectiveMaxHr}
                      restingHr={restingHr}
                    />
                  </div>
                )}

                {isCustom && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onEditCustomSession(s)}
                      aria-label={`Edit sesi ${sessionTitle}`}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/10 bg-[#18181D] px-3 text-xs font-semibold text-zinc-200 transition hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                    >
                      <Pencil size={13} aria-hidden />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => update(deleteCustomSession(st, s.id))}
                      aria-label={`Hapus sesi ${sessionTitle}`}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    >
                      <Trash2 size={13} aria-hidden />
                      <span>Hapus</span>
                    </button>
                  </div>
                )}

                <details className="group mt-3 rounded-2xl border border-white/[0.08] bg-[#18181D]/60">
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-xs font-semibold text-zinc-300">
                    <span>Detail & atur sesi</span>
                    <ChevronDown
                      className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>

                  <div className="space-y-3 border-t border-white/[0.06] px-3.5 py-3 text-xs text-zinc-300">
                    {calibPace && (
                      <div>
                        Pace interval (Tes 3K):{' '}
                        <strong className="font-mono text-[#BEF264]">
                          {fmtRangeMinMax(calibPace)}
                        </strong>
                      </div>
                    )}

                    {!s.structuredSteps?.length && s.kind === 'speed' && (
                      <div className="rounded-xl border border-white/[0.07] bg-[#121215] p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Target HR per Segmen
                        </div>
                        <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {speedHrSegments({
                            sessionHr: s.hr,
                            maxHr,
                            restingHr,
                          }).map((seg) => (
                            <div
                              key={seg.id}
                              className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-[#18181D]/70 px-2.5 py-1.5"
                            >
                              <dt className="text-zinc-300">{seg.label}</dt>
                              <dd className="font-mono text-[11px] font-bold tabular-nums text-[#BEF264]">
                                {seg.zoneCode}
                                {seg.bpmText ? ` ${seg.bpmText}` : ''}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}

                    {s.steps.length > 0 && !s.structuredSteps?.length && (
                      <div className="space-y-1">
                        {s.steps.map((stp, j) => (
                          <div key={j}>{stripMarkdown(stp)}</div>
                        ))}
                      </div>
                    )}

                    {s.note && (
                      <p className="rounded-xl border border-white/[0.06] bg-[#121215] px-3 py-2 text-zinc-300">
                        {stripMarkdown(s.note)}
                      </p>
                    )}

                    {s.kind !== 'race' && raceIso && (
                      <div className="grid grid-cols-1 gap-2 border-t border-white/[0.06] pt-2.5 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-zinc-300">
                          Ubah tanggal
                          <input
                            type="date"
                            value={s.date}
                            max={addDays(raceIso, -1)}
                            onChange={(e) => {
                              if (e.target.value) update(setSessionDate(st, s.id, e.target.value));
                            }}
                            className={control}
                          />
                        </label>
                        <label className="text-xs font-semibold text-zinc-300">
                          Tukar sesi
                          <select
                            value=""
                            className={control}
                            onChange={(e) => {
                              const o = swapChoices.find((x) => x.id === e.target.value);
                              if (o) update(swapSessions(st, s, o));
                            }}
                          >
                            <option value="">Pilih sesi…</option>
                            {swapChoices.map((o) => (
                              <option key={o.id} value={o.id}>
                                {formatDayMonth(o.date)} · {KIND_LABEL[o.kind]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                </details>
              </article>
            );
          })
        )}
      </section>

      {settings && (
        <SettingsSheet
          st={st}
          update={update}
          k5Text={k5Text}
          onK5={onK5}
          k5={k5}
          paceChartRow={row}
          fromPrediction={fromPrediction}
          missed={missed}
          onClose={() => setSettings(false)}
        />
      )}

      {aiPreview && (
        <Sheet
          title={`Pratinjau Jadwal AI (${aiPreview.sessions.length} sesi)`}
          titleId="ai-preview-judul"
          onClose={() => setAiPreview(null)}
        >
          <div className="space-y-4">
            <p className="rounded-2xl border border-[#BEF264]/25 bg-[#BEF264]/[0.08] px-3.5 py-2.5 text-xs leading-relaxed text-zinc-200">
              {stripMarkdown(aiPreview.summary)}
            </p>
            <ul className="space-y-2.5">
              {aiPreview.sessions.map((s) => (
                <li
                  key={s.id}
                  className={`sport-subcard border-l-[3px] ${KIND_BORDER[s.kind]} p-3 text-xs`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-semibold text-zinc-100">{formatDateId(s.date)}</span>
                    <span className="font-bold text-[#BEF264]">{KIND_LABEL[s.kind]}</span>
                  </div>
                  <div className="mt-0.5 text-sm font-bold text-zinc-100">{stripMarkdown(s.name)}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono tabular-nums text-zinc-300">
                    {s.distanceKm != null && <span>{s.distanceKm.toFixed(1)} km</span>}
                    {s.durationMin != null && <span>{s.durationMin} mnt</span>}
                    {s.hr && (
                      <span>
                        {formatHrWithZone(s.hr, s.zone, maxHr, restingHr)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="secondary" onClick={() => setAiPreview(null)}>
                Batal
              </Button>
              <Button onClick={handleApplyAiPlan}>Terapkan</Button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
