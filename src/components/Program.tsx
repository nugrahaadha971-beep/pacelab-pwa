import { useEffect, useId, useMemo, useState } from 'react';
import { CalendarDays, Pencil, Plus, RotateCcw, Sparkles } from 'lucide-react';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import {
  currentVdot,
  PENALTY_RULES,
  predictAll,
  RACE_KM,
  riegelProject,
  velocityFor,
  ZONE_FRACTION,
} from '../analytics/predictor';
import { resolveMaxHr } from '../plans/hrZones';
import { fmtPace } from '../plans/pace';
import type { SessionKind } from '../plans/nike5k';
import {
  addCustomSession,
  applyPresetTemplate,
  applyScheduleState,
  buildPlan,
  formatDateId,
  formatDayMonthYear,
  isoFromRaceTs,
  isValidIso,
  remaining,
  updateCustomSession,
} from '../plans/schedule';
import type {
  CustomSessionInput,
  PlanSession,
  PresetTemplateId,
  ScheduleState,
  WorkoutBlock,
} from '../plans/schedule';
import { loadScheduleState, saveScheduleState } from '../plans/scheduleStore';
import {
  initialBlocksForSession,
  summarizeStructuredWorkout,
  WORKOUT_PRESETS,
} from '../plans/workoutBuilder';
import type { WorkoutPresetTemplate } from '../plans/workoutBuilder';
import { DAY_MS } from '../analytics/workload';
import { fmtHms, todayStr } from './format';
import RaceDayCard from './RaceDayCard';
import Sheet from './Sheet';
import TargetRaceModal from './TargetRaceModal';
import TrainingPlan from './TrainingPlan';
import { WorkoutProfileBar, WorkoutStepBuilder } from './WorkoutStepBuilder';
import { Button, Field, ScreenHeader, SegmentedTabs, SelectField } from './ui';

type ProgramTab = 'jadwal' | 'analisa';
const PROGRAM_TABS: ReadonlyArray<{ id: ProgramTab; label: string }> = [
  { id: 'jadwal', label: 'Jadwal' },
  { id: 'analisa', label: 'Analisa Lomba' },
];

const SIM_DISTANCES: ReadonlyArray<{ id: RaceDistance; label: string }> = [
  { id: '5K', label: '5K' },
  { id: '10K', label: '10K' },
  { id: '21.1K', label: 'Half Marathon' },
  { id: '42.2K', label: 'Marathon' },
];

const PRESET_TEMPLATES: ReadonlyArray<{ id: PresetTemplateId; label: string; matchTitle?: string }> = [
  { id: 'base5k', label: 'Dasar 5K', matchTitle: 'Dasar 5K' },
  { id: 'base10k', label: 'Dasar 10K', matchTitle: 'Dasar 10K' },
  { id: 'empty', label: 'Kosongkan' },
];

const SESSION_KIND_OPTIONS: ReadonlyArray<{ value: SessionKind; label: string }> = [
  { value: 'recovery', label: 'Easy / Pemulihan' },
  { value: 'long', label: 'Long Run' },
  { value: 'speed', label: 'Speed / Interval' },
  { value: 'race', label: 'Lomba' },
];

const SESSION_NAME_PLACEHOLDERS: Record<SessionKind, string> = {
  recovery: 'Mis. Easy Run Zona 2',
  speed: 'Mis. Norwegian 4×4',
  long: 'Mis. Long Run Akhir Pekan',
  race: 'Mis. Race Day 10K',
};

const SESSION_NOTE_PLACEHOLDERS: Record<SessionKind, string> = {
  recovery: 'Opsional, mis. Jaga napas rileks & tetap di Zona 2',
  speed: 'Opsional, mis. Fokus pace stabil di tiap ulangan',
  long: 'Opsional, mis. Siapkan hidrasi setiap 20–25 menit',
  race: 'Opsional, mis. Negative split & minum di pos air',
};

function defaultSimDateIso(): string {
  const future = new Date(Date.now() + 14 * DAY_MS);
  const y = future.getFullYear();
  const m = String(future.getMonth() + 1).padStart(2, '0');
  const d = String(future.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface CustomSessionSheetProps {
  mode: 'create' | 'edit';
  initialSession?: PlanSession;
  defaultDate: string;
  maxHr: number | null;
  restingHr: number;
  easyPaceSecPerKm: number;
  onClose: () => void;
  onSave: (payload: CustomSessionInput) => void;
}

function CustomSessionSheet({
  mode,
  initialSession,
  defaultDate,
  maxHr,
  restingHr,
  easyPaceSecPerKm,
  onClose,
  onSave,
}: CustomSessionSheetProps) {
  const formId = useId();
  const dateFieldId = useId();
  const [date, setDate] = useState(initialSession?.date ?? defaultDate);
  const [name, setName] = useState(initialSession?.name ?? '');
  const [kind, setKind] = useState<SessionKind>(initialSession?.kind ?? 'recovery');
  const [blocks, setBlocks] = useState<WorkoutBlock[]>(() =>
    initialBlocksForSession(initialSession),
  );
  const [note, setNote] = useState(initialSession?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const displayDate = isValidIso(date) ? formatDayMonthYear(date) : 'Pilih tanggal';

  const handleApplyPreset = (preset: WorkoutPresetTemplate) => {
    setBlocks(preset.build());
    setKind(preset.kind);
    const trimmed = name.trim();
    const isPresetName = WORKOUT_PRESETS.some((p) => p.name === trimmed);
    if (!trimmed || isPresetName) {
      setName(preset.name);
    }
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidIso(date)) {
      setError('Tanggal sesi tidak valid.');
      return;
    }
    if (!name.trim()) {
      setError('Nama sesi wajib diisi.');
      return;
    }
    if (blocks.length === 0) {
      setError('Tambahkan minimal satu langkah latihan.');
      return;
    }

    const summary = summarizeStructuredWorkout(blocks, {
      maxHr,
      restingHr,
      referencePaceSecPerKm: easyPaceSecPerKm,
    });

    onSave({
      ...(initialSession ? { id: initialSession.id } : {}),
      date,
      kind,
      name: name.trim(),
      distanceKm: summary.distanceKm,
      durationMin: summary.durationMin,
      hr: summary.hr,
      pace: summary.pace,
      steps: summary.steps,
      structuredSteps: summary.structuredSteps,
      note: note.trim() || undefined,
    });
  };

  return (
    <Sheet
      title={mode === 'edit' ? 'Edit Sesi Program' : 'Input Sesi Program'}
      titleId="custom-session-sheet-title"
      wide
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && (
            <p
              role="alert"
              className="rounded-2xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-400"
            >
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" form={formId}>
              {mode === 'edit' ? 'Simpan Perubahan' : 'Simpan Sesi'}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        {/* Bagian Atas: Info Sesi */}
        <Field
          label="Nama Sesi"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={SESSION_NAME_PLACEHOLDERS[kind]}
          required
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={dateFieldId} className="text-sm font-semibold text-zinc-200">
              Tanggal Sesi
            </label>
            <div className="relative mt-1">
              <input
                id={dateFieldId}
                type="date"
                aria-label="Tanggal Sesi"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              />
              <div className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#121215] px-3.5 py-2 text-sm font-medium tabular-nums text-zinc-100 peer-focus-visible:border-[#BEF264] peer-focus-visible:ring-2 peer-focus-visible:ring-[#BEF264]/35">
                <span>{displayDate}</span>
                <CalendarDays size={16} className="shrink-0 text-zinc-400" aria-hidden />
              </div>
            </div>
          </div>

          <SelectField
            label="Kategori Sesi"
            value={kind}
            onChange={(e) => setKind(e.target.value as SessionKind)}
          >
            {SESSION_KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectField>
        </div>

        {/* Grafik Batang Mini (Workout Profile Bar) */}
        <WorkoutProfileBar blocks={blocks} referencePaceSecPerKm={easyPaceSecPerKm} />

        {/* Builder Langkah & Blok Repeat bergaya Garmin Connect */}
        <WorkoutStepBuilder
          blocks={blocks}
          onChange={setBlocks}
          onApplyPreset={handleApplyPreset}
          maxHr={maxHr}
          restingHr={restingHr}
        />

        <Field
          label="Catatan Tambahan"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={SESSION_NOTE_PLACEHOLDERS[kind]}
        />
      </form>
    </Sheet>
  );
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
  const [tab, setTab] = useState<ProgramTab>('jadwal');
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [st, setSt] = useState<ScheduleState>(loadScheduleState);
  const [sessionModal, setSessionModal] = useState<
    { mode: 'create' } | { mode: 'edit'; session: PlanSession } | null
  >(null);

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
  const todayIso = todayStr();
  const rem = validRaceIso ? remaining(validRaceIso, todayIso) : null;
  const daysLeft = rem ? rem.daysRemaining : null;

  const effectiveTargetSec = useMemo(() => {
    if (effectiveDistance === profile.targetDistance) return profile.targetTimeSec;
    return Math.round(
      riegelProject(
        profile.targetTimeSec,
        RACE_KM[profile.targetDistance],
        RACE_KM[effectiveDistance],
      ),
    );
  }, [effectiveDistance, profile.targetDistance, profile.targetTimeSec]);

  const goalPace = effectiveTargetSec / RACE_KM[effectiveDistance];
  const preds = predictAll(workouts, now);
  const pred = preds[effectiveDistance];
  const currentPace = pred ? pred.finalSec / RACE_KM[effectiveDistance] : null;
  const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
  const weeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
  const vd = currentVdot(workouts, now);
  const easyPace = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;
  const maxHr = resolveMaxHr(profile, workouts);
  const maxWeeklyKm = profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 50;

  const scheduledSessionsCount = useMemo(() => {
    if (validRaceIso) {
      const base = buildPlan({
        raceIso: validRaceIso,
        todayIso,
        days: st.days,
        raceName: `${effectiveDistance} · Hari Lomba`,
        startWeeklyKm: weeklyKm,
        maxWeeklyKm,
        easyPaceSecPerKm: easyPace,
        curriculum: 'custom',
        maxHr,
      });
      const applied = applyScheduleState(base, st, validRaceIso);
      return applied.weeks.flatMap((w) => w.sessions).filter((s) => s.kind !== 'race').length;
    }
    return (st.customSessions?.length ?? 0) + (st.aiSessions?.length ?? 0);
  }, [validRaceIso, todayIso, st, effectiveDistance, weeklyKm, maxWeeklyKm, easyPace, maxHr]);

  const activeProgramTitle =
    st.programTitle ||
    (st.aiSessions?.length
      ? 'Program Susun AI'
      : st.customOnly
        ? 'Program Kustom'
        : 'Jadwal Kalender Dasar');

  const handleApplyPreset = (presetId: PresetTemplateId) => {
    const next = applyPresetTemplate(st, presetId, {
      todayIso,
      raceIso: validRaceIso ?? (profileRaceIso || null),
      maxHr,
      trainingDays: st.days,
    });
    updateSchedule(next);
  };

  const handleSaveCustomSession = (payload: CustomSessionInput) => {
    if (sessionModal?.mode === 'edit') {
      updateSchedule(updateCustomSession(st, sessionModal.session.id, payload));
    } else {
      updateSchedule(addCustomSession(st, payload));
    }
    setSessionModal(null);
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
      ? '–'
      : daysLeft === 0
        ? 'Hari Ini'
        : daysLeft < 0
          ? 'Lewat'
          : `H-${daysLeft}`;

  const countdownSub =
    daysLeft == null
      ? 'Atur tanggal lomba'
      : daysLeft === 0
        ? 'Hari Lomba (H-0)'
        : daysLeft < 0
          ? `${Math.abs(daysLeft)} hari lalu`
          : `${daysLeft} hari lagi`;

  const distanceKmText = `${String(Number(RACE_KM[effectiveDistance].toFixed(1))).replace('.', ',')} km`;

  return (
    <div className="space-y-4">
      <ScreenHeader title="Program" subtitle="Target lomba, program mandiri & evaluasi latihan" />

      {/* Kartu Header Target Lomba Ringkas (2x2 Grid) */}
      <section aria-label="Target Lomba" className="sport-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="font-display text-base font-bold text-white">Target Lomba</h2>
            <span className="font-mono text-xs font-extrabold tabular-nums text-[#BEF264]">
              {countdownBadge}
            </span>
            {isSimulated && (
              <span className="text-xs font-semibold text-sky-400">· Simulasi</span>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTargetModalOpen(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border border-[#BEF264]/35 bg-[#BEF264]/10 px-3.5 text-xs font-bold text-[#BEF264] transition hover:border-[#BEF264]/55 hover:bg-[#BEF264]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              <Pencil size={13} aria-hidden />
              <span>{profile.targetRaceDate > 0 ? 'Ubah Target' : 'Atur Target'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleSim}
              aria-expanded={simOpen}
              className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-[#18181D] px-3.5 text-xs font-semibold text-zinc-200 transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              <CalendarDays size={14} aria-hidden />
              <span>{simOpen ? 'Tutup' : 'Simulasi'}</span>
            </button>

            {isSimulated && (
              <button
                type="button"
                onClick={handleResetSim}
                aria-label="Reset simulasi"
                className="inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-[#18181D] px-3 text-xs font-semibold text-zinc-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
              >
                <RotateCcw size={13} aria-hidden />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {simOpen && (
          <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#18181D]/80 p-3">
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
                          : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/20 hover:text-white'
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
                className="min-h-[40px] rounded-xl border border-white/10 bg-[#121215] px-3 text-xs font-medium text-zinc-100 tabular-nums focus:border-[#BEF264] focus:outline-none"
              />
            </div>
          </div>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.08]">
          <div className="bg-[#121215] px-3.5 py-2.5">
            <dt className="text-[11px] font-medium text-zinc-400">Tanggal Lomba</dt>
            <dd className="mt-0.5 truncate font-display text-sm font-bold tabular-nums text-white sm:text-base">
              {validRaceIso ? formatDateId(validRaceIso) : 'Belum diatur'}
            </dd>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
              {countdownSub}
            </div>
          </div>

          <div className="bg-[#121215] px-3.5 py-2.5">
            <dt className="text-[11px] font-medium text-zinc-400">Jarak Lomba</dt>
            <dd className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-white sm:text-base">
              {distanceTitle}
            </dd>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
              {distanceKmText}{isSimulated ? ' · Simulasi' : ''}
            </div>
          </div>

          <div className="bg-[#121215] px-3.5 py-2.5">
            <dt className="text-[11px] font-medium text-zinc-400">Target Waktu</dt>
            <dd className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-[#BEF264] sm:text-lg">
              {fmtHms(effectiveTargetSec)}
            </dd>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
              {fmtPace(goalPace)} /km
            </div>
          </div>

          <div className="bg-[#121215] px-3.5 py-2.5">
            <dt className="text-[11px] font-medium text-zinc-400">Prediksi Riegel</dt>
            <dd className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-sky-400 sm:text-lg">
              {pred ? fmtHms(pred.finalSec) : '–'}
            </dd>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
              {currentPace != null ? `${fmtPace(currentPace)} /km` : 'Data lari < 5 km'}
            </div>
          </div>
        </dl>
      </section>

      <SegmentedTabs idBase="program" label="Bagian program" tabs={PROGRAM_TABS} value={tab} onChange={setTab} />

      {tab === 'jadwal' && (
        <div id="program-panel-jadwal" role="tabpanel" aria-labelledby="program-tab-jadwal" className="space-y-4">
          {/* Kartu Program Latihan Saya (Input Mandiri & Template Cepat) */}
          <section aria-label="Program Latihan Saya" className="sport-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Program Latihan Saya
                  </span>
                  <span className="font-mono text-xs font-bold tabular-nums text-sky-400">
                    {scheduledSessionsCount} sesi
                  </span>
                </div>
                <h3 className="mt-0.5 truncate font-display text-base font-bold text-white">
                  {activeProgramTitle}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSessionModal({ mode: 'create' })}
                className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-2xl bg-[#BEF264] px-4 text-xs font-extrabold text-[#09090B] transition hover:bg-[#d4fc82] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
              >
                <Plus size={15} strokeWidth={2.5} aria-hidden />
                <span>Input Sesi Program</span>
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
                <Sparkles size={13} className="text-[#BEF264]" aria-hidden />
                <span>Pilih Template Cepat</span>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pilih template program cepat">
                {PRESET_TEMPLATES.map((tpl) => {
                  const isActive =
                    tpl.id === 'empty'
                      ? Boolean(st.customOnly && !(st.customSessions?.length || st.aiSessions?.length))
                      : Boolean(st.customOnly && st.programTitle === tpl.matchTitle);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => handleApplyPreset(tpl.id)}
                      className={`min-h-[40px] whitespace-nowrap rounded-xl border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                        isActive
                          ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                          : tpl.id === 'empty'
                            ? 'border-white/10 bg-[#18181D] text-zinc-300 hover:border-rose-400/40 hover:text-rose-300'
                            : 'border-white/10 bg-[#18181D] text-zinc-200 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      {tpl.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <TrainingPlan
            profile={profile}
            workouts={workouts}
            defaultK5Sec={preds['5K']?.finalSec ?? null}
            currentPaceSecPerKm={currentPace}
            startWeeklyKm={weeklyKm}
            easyPaceSecPerKm={easyPace}
            scheduleState={st}
            onScheduleChange={updateSchedule}
            onAddCustomSession={() => setSessionModal({ mode: 'create' })}
            onEditCustomSession={(session) => setSessionModal({ mode: 'edit', session })}
          />
        </div>
      )}

      {tab === 'analisa' && (
        <div id="program-panel-analisa" role="tabpanel" aria-labelledby="program-tab-analisa">
          <RaceDayCard
            profile={profile}
            workouts={workouts}
            simDistance={simDistance}
            simDateIso={simDateIso}
            hideTargetControls
          />
        </div>
      )}

      {targetModalOpen && (
        <TargetRaceModal
          profile={profile}
          onClose={() => setTargetModalOpen(false)}
          onSaved={onProfileChange}
        />
      )}

      {sessionModal && (
        <CustomSessionSheet
          mode={sessionModal.mode}
          initialSession={sessionModal.mode === 'edit' ? sessionModal.session : undefined}
          defaultDate={todayIso}
          maxHr={maxHr}
          restingHr={profile.restingHr}
          easyPaceSecPerKm={easyPace}
          onClose={() => setSessionModal(null)}
          onSave={handleSaveCustomSession}
        />
      )}
    </div>
  );
}
