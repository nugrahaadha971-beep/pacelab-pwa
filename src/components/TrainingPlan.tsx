import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, cardiacDrift, efTrend } from '../analytics/workload';
import {
  evaluateProgramResultsWithAi,
  generateAiTrainingPlan,
  loadGeminiApiKey,
} from '../analytics/aiCoach';
import type {
  AiTrainingPlanResult,
  ProgramEvaluationResult,
  ProgramSessionSnapshot,
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
import { formatHrWithZone, resolveMaxHr, speedHrSegments, ZONE_LABEL } from '../plans/hrZones';
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
import type { Phase, PlanSession, ScheduleState } from '../plans/schedule';
import { parseDuration } from '../parsers/manual';
import { fmtHms, todayStr } from './format';
import AiLoader from './AiLoader';
import Sheet from './Sheet';
import { StructuredStepsView } from './WorkoutStepBuilder';
import { KIND_BORDER, KIND_LABEL } from './sessionMeta';
import { Button, Field } from './ui';

const PHASE_LABEL: Record<Phase, string> = {
  base: 'Base Building',
  build: 'Build',
  taper: 'Taper',
  race: 'Lomba',
};
const STORE_KEY = 'pacelab.k5';
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const control =
  'mt-1 block min-h-[44px] w-full rounded-2xl border border-white/10 bg-[#121215] px-3 py-2 text-sm tabular-nums text-zinc-100 focus:border-[#BEF264] focus:outline-none focus:ring-2 focus:ring-[#BEF264]/35';

function loadSaved(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

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
  onScheduleChange: (next: ScheduleState) => void;
  onAddCustomSession?: () => void;
  onEditCustomSession?: (session: PlanSession) => void;
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
  onScheduleChange: update,
  onAddCustomSession,
  onEditCustomSession,
}: Props) {
  const [weekIdx, setWeekIdx] = useState(0);
  const [settings, setSettings] = useState(false);
  const [k5Text, setK5Text] = useState(
    () => loadSaved() ?? (defaultK5Sec != null ? fmtHms(defaultK5Sec) : ''),
  );
  const [fromPrediction, setFromPrediction] = useState(
    () => loadSaved() == null && defaultK5Sec != null,
  );
  const [hasApiKey, setHasApiKey] = useState(() => Boolean(loadGeminiApiKey()));
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<AiTrainingPlanResult | null>(null);

  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<ProgramEvaluationResult | null>(null);

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
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const todayIso = todayStr();
  const raceIso = profile.targetRaceDate ? isoFromRaceTs(profile.targetRaceDate) : null;
  const targetPace = profile.targetTimeSec / RACE_KM[profile.targetDistance];
  const maxHr = resolveMaxHr(profile, workouts);
  const maxWeeklyKm =
    profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 50;
  const customIds = new Set((st.customSessions ?? []).map((c) => c.id));
  const easyPace = paceSecPerKm('rec', row) ?? easyPaceSecPerKm;
  const workoutDays = new Set(workouts.map((w) => isoFromLocal(w.date)));

  const settingsSheet = (missed: number) =>
    settings && (
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
    );

  // Bangun daftar sesi (berbasis tanggal lomba bila ada, atau sesi kustom/AI mandiri bila belum ada tanggal lomba)
  const standaloneSessions: PlanSession[] = !raceIso
    ? [...(st.aiSessions ?? []), ...(st.customSessions ?? [])]
        .map((item) => ({ ...item, date: st.overrides[item.id] ?? item.date }))
        .sort((a, b) => dayNum(a.date) - dayNum(b.date))
    : [];

  if (!raceIso && standaloneSessions.length === 0) {
    return (
      <div className="space-y-4">
        <div className="sport-card border-dashed border-white/15 p-5 text-center">
          <p className="text-sm text-zinc-300">
            Atur tanggal lomba di atas untuk membuat jadwal kalender dasar, atau input sesi program Anda secara mandiri.
          </p>
          {onAddCustomSession && (
            <button
              type="button"
              onClick={onAddCustomSession}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl bg-[#BEF264] px-4 text-xs font-extrabold text-[#09090B] transition hover:bg-[#d4fc82]"
            >
              <Plus size={15} strokeWidth={2.5} aria-hidden />
              <span>Input Sesi Program</span>
            </button>
          )}
        </div>
        {settingsSheet(0)}
      </div>
    );
  }

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
  const wi = plan ? Math.min(weekIdx, Math.max(0, plan.weeks.length - 1)) : 0;
  const week = plan ? plan.weeks[wi] : null;

  if (raceIso && !week) {
    return (
      <div className="sport-card p-4 text-sm text-zinc-300">
        Tanggal lomba sudah lewat. Klik Ubah Target di atas untuk memperbarui jadwal.
      </div>
    );
  }

  const visibleRawSessions = week ? week.sessions : standaloneSessions;

  const goalPaceFor = (s: PlanSession): number | null =>
    s.kind === 'race'
      ? targetPace
      : projPace == null
        ? null
        : weekPace(projPace, targetPace, s.weekNo, totalWeeks);

  const weekLabel = (w: NonNullable<typeof week>) =>
    `Minggu ${w.weekNo}/${totalWeeks} · ${formatDayMonth(dayNum(w.startIso) < dayNum(todayIso) ? todayIso : w.startIso)}–${formatDayMonth(w.endIso)} · ${w.title ?? PHASE_LABEL[w.phase]}`;

  const loadOf = (s: PlanSession): { min: number | null; km: number | null } => {
    const rawMin = s.adjDurationMin ?? s.durationMin;
    if (s.kind === 'speed' || s.kind === 'race') return { min: rawMin, km: null };
    const min =
      rawMin ?? (s.distanceKm != null ? Math.round((s.distanceKm * easyPace) / 60) : null);
    if (min == null) return { min: null, km: s.distanceKm ?? null };
    const km =
      s.distanceKm != null && s.durationMin
        ? (s.distanceKm * min) / s.durationMin
        : s.distanceKm ?? (min * 60) / easyPace;
    return { min, km };
  };

  const weekKm = visibleRawSessions.reduce(
    (sum, r) => sum + (loadOf(byId.get(r.id) as PlanSession).km ?? 0),
    0,
  );

  const canGenerateAi = hasApiKey && isOnline && !aiLoading;
  const hasAiActive = Boolean(st.aiSessions && st.aiSessions.length > 0);
  const evaluationTargets = adapted.sessions.filter((s) => s.kind !== 'race');
  const canEvaluateProgram = hasApiKey && isOnline && !evalLoading && evaluationTargets.length > 0;

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
      setAiError(err instanceof Error ? err.message : 'Gagal menyusun jadwal latihan AI.');
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

  const handleEvaluateProgram = async () => {
    const key = loadGeminiApiKey();
    setHasApiKey(Boolean(key));
    setEvalLoading(true);
    setEvalError(null);
    try {
      const now = Date.now();
      const plannedSessions: ProgramSessionSnapshot[] = evaluationTargets.map((s) => ({
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
    <div className="space-y-4">
      {/* Toolbar Jadwal Ringkas */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" block={false} onClick={() => setSettings(true)} aria-haspopup="dialog">
            Atur jadwal
          </Button>
          <Button
            variant="secondary"
            block={false}
            onClick={handleGenerateAiPlan}
            disabled={!canGenerateAi}
            className="gap-1.5 border-[#BEF264]/35 bg-[#BEF264]/10 text-[#BEF264] hover:bg-[#BEF264]/15"
          >
            <Sparkles className="h-4 w-4 text-[#BEF264]" aria-hidden />
            <span className="whitespace-nowrap">{aiLoading ? 'Menyusun…' : 'Susun AI'}</span>
          </Button>
          {hasAiActive && (
            <Button variant="secondary" block={false} onClick={handleRestoreStandard} className="gap-1.5 text-xs">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              <span>Hapus AI</span>
            </Button>
          )}
        </div>

        {(weekKm > 0 || week?.plannedKm != null) && (
          <span className="inline-flex min-h-[44px] items-center rounded-2xl border border-sky-400/25 bg-sky-400/10 px-3.5 text-xs font-bold text-sky-400">
            Volume:{' '}
            <span className="ml-1 font-mono tabular-nums">
              {(weekKm > 0 ? weekKm : week?.plannedKm ?? 0).toFixed(1)} km
            </span>
          </span>
        )}
      </div>

      {!hasApiKey && (
        <p className="text-xs text-zinc-400">
          Tambahkan Gemini API Key di Profil untuk mengaktifkan Susun AI dan Evaluasi AI.
        </p>
      )}
      {aiLoading && <AiLoader />}
      {aiError && (
        <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
          {aiError}
        </p>
      )}

      {/* Pemilih Minggu */}
      {plan && week && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWeekIdx(wi - 1)}
            disabled={wi <= 0}
            aria-label="Minggu sebelumnya"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#121215] text-zinc-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
          <select
            value={wi}
            onChange={(e) => setWeekIdx(Number(e.target.value))}
            aria-label="Pilih minggu"
            className="min-h-[44px] min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#121215] px-3 text-sm text-zinc-100 focus:border-[#BEF264] focus:outline-none focus:ring-2 focus:ring-[#BEF264]/35"
          >
            {plan.weeks.map((w, i) => (
              <option key={w.weekNo} value={i}>
                {weekLabel(w)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setWeekIdx(wi + 1)}
            disabled={wi >= plan.weeks.length - 1}
            aria-label="Minggu berikutnya"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#121215] text-zinc-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>
      )}

      {/* Daftar Sesi Minggu Ini */}
      <section className="space-y-3" aria-label="Sesi minggu ini">
        {visibleRawSessions.length === 0 ? (
          <div className="sport-card border-dashed border-white/15 p-5 text-center">
            <p className="text-sm text-zinc-300">Belum ada sesi latihan pada minggu ini.</p>
            {onAddCustomSession && (
              <button
                type="button"
                onClick={onAddCustomSession}
                className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-[#BEF264]/35 bg-[#BEF264]/10 px-4 text-xs font-bold text-[#BEF264] transition hover:bg-[#BEF264]/15"
              >
                <Plus size={14} aria-hidden />
                <span>Tambah Sesi Kustom</span>
              </button>
            )}
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
            const swapChoices = visibleRawSessions
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

            const formattedHr = formatHrWithZone(s.hr, s.zone, maxHr, profile.restingHr);

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
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold tabular-nums text-zinc-400">
                      {formatDateId(s.date)}
                    </span>
                    {isCustom && (
                      <span className="rounded-md bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-400">
                        Mandiri
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

                {isCustom && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
                    {onEditCustomSession && (
                      <button
                        type="button"
                        onClick={() => onEditCustomSession(s)}
                        aria-label={`Edit sesi ${sessionTitle}`}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/10 bg-[#18181D] px-3 text-xs font-semibold text-zinc-200 transition hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                      >
                        <Pencil size={13} aria-hidden />
                        <span>Edit</span>
                      </button>
                    )}
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

                    {s.structuredSteps && s.structuredSteps.length > 0 ? (
                      <StructuredStepsView
                        blocks={s.structuredSteps}
                        maxHr={maxHr}
                        restingHr={profile.restingHr}
                        referencePaceSecPerKm={easyPace}
                      />
                    ) : (
                      <>
                        {s.kind === 'speed' && (
                          <div className="rounded-xl border border-white/[0.07] bg-[#121215] p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                              Target HR per Segmen
                            </div>
                            <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {speedHrSegments({
                                sessionHr: s.hr,
                                maxHr,
                                restingHr: profile.restingHr,
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

                        {s.steps.length > 0 && (
                          <div className="space-y-1">
                            {s.steps.map((stp, j) => (
                              <div key={j}>{stripMarkdown(stp)}</div>
                            ))}
                          </div>
                        )}
                      </>
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

      {/* Kartu Analisis AI Hasil Program */}
      <section aria-label="Analisis AI Hasil Program" className="sport-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <ClipboardCheck size={16} className="text-[#BEF264]" aria-hidden />
              <h3 className="font-display text-base font-bold text-white">
                Analisis AI Hasil Program
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-zinc-400">
              Bandingkan kepatuhan jadwal, HR, dan realisasi latihan Anda.
            </p>
          </div>

          <button
            type="button"
            onClick={handleEvaluateProgram}
            disabled={!canEvaluateProgram}
            className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-2xl border border-[#BEF264]/35 bg-[#BEF264]/10 px-4 text-xs font-bold text-[#BEF264] transition hover:bg-[#BEF264]/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <Sparkles size={14} aria-hidden />
            <span>{evalLoading ? 'Menganalisis…' : 'Evaluasi Hasil Latihan dengan AI'}</span>
          </button>
        </div>

        {evaluationTargets.length === 0 && (
          <p className="mt-2.5 text-xs text-zinc-400">
            Tambahkan minimal 1 sesi latihan di jadwal untuk dievaluasi.
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

      {settingsSheet(missed)}

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
                        {formatHrWithZone(s.hr, s.zone, maxHr, profile.restingHr)}
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
