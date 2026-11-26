import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Minus,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { calcHrZonePresetRange, HR_ZONE_PRESETS } from '../plans/hrZones';
import type { HrZoneNumber } from '../plans/hrZones';
import { fmtPace } from '../plans/pace';
import {
  buildWorkoutProfileBars,
  createDefaultRepeatBlock,
  createDefaultStep,
  estimateStructuredTotals,
  formatStepDuration,
  formatStepTarget,
  isRepeatBlock,
  makeStepId,
  STEP_KIND_BAR,
  STEP_KIND_BORDER,
  STEP_KIND_LABEL,
  STEP_KIND_ORDER,
  STEP_KIND_TEXT,
  WORKOUT_PRESETS,
} from '../plans/workoutBuilder';
import type {
  RepeatBlock,
  SingleStep,
  WorkoutBlock,
  WorkoutDurationType,
  WorkoutPresetTemplate,
  WorkoutStepKind,
  WorkoutTargetType,
} from '../plans/workoutBuilder';

const DURATION_OPTIONS: ReadonlyArray<{ value: WorkoutDurationType; label: string }> = [
  { value: 'time', label: 'Waktu' },
  { value: 'distance', label: 'Jarak' },
  { value: 'open', label: 'Lap Button' },
];

const TARGET_OPTIONS: ReadonlyArray<{ value: WorkoutTargetType; label: string }> = [
  { value: 'hr_zone', label: 'Zona HR' },
  { value: 'custom_hr', label: 'HR Kustom' },
  { value: 'pace', label: 'Pace' },
  { value: 'none', label: 'Tanpa Target' },
];

const QUICK_TIME_SEC = [
  { label: '1:00', sec: 60 },
  { label: '3:00', sec: 180 },
  { label: '4:00', sec: 240 },
  { label: '5:00', sec: 300 },
  { label: '10:00', sec: 600 },
  { label: '20:00', sec: 1200 },
];

const QUICK_DIST_M = [
  { label: '200 m', m: 200 },
  { label: '400 m', m: 400 },
  { label: '800 m', m: 800 },
  { label: '1 km', m: 1000 },
  { label: '1.6 km', m: 1600 },
];

const BAR_HEX: Record<WorkoutStepKind, string> = {
  warmup: '#FB7185',
  run: '#38BDF8',
  recover: '#71717A',
  cooldown: '#34D399',
};

function parsePaceInput(text: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  if (total < 90 || total > 1500) return null;
  return total;
}

export function WorkoutProfileBar({
  blocks,
  referencePaceSecPerKm,
  compact = false,
}: {
  blocks: WorkoutBlock[];
  referencePaceSecPerKm?: number | null;
  compact?: boolean;
}) {
  const totals = estimateStructuredTotals(blocks, referencePaceSecPerKm);
  const bars = buildWorkoutProfileBars(blocks, referencePaceSecPerKm);

  const durationText =
    totals.durationMin != null
      ? `${totals.durationMin} mnt${totals.hasOpenSteps ? ' + Lap' : ''}`
      : totals.hasOpenSteps
        ? 'Lap Button'
        : '–';

  const distanceText =
    totals.distanceKm != null ? `~${totals.distanceKm.toFixed(1)} km` : '–';

  const width = 1000;
  const height = compact ? 42 : 56;
  const gap = bars.length > 32 ? 2 : 5;
  const totalGap = Math.max(0, bars.length - 1) * gap;
  const usableW = Math.max(100, width - totalGap);
  const totalWeight = bars.reduce((s, b) => s + b.weightSec, 0) || 1;

  let cursorX = 0;

  return (
    <div
      className={
        compact
          ? 'rounded-xl border border-white/[0.07] bg-[#121215] p-2.5'
          : 'rounded-2xl border border-white/[0.08] bg-[#18181D] p-3'
      }
    >
      {!compact && (
        <dl className="mb-2.5 grid grid-cols-3 gap-2">
          <div>
            <dt className="text-[11px] font-medium text-zinc-400">Estimasi Durasi</dt>
            <dd className="font-mono text-sm font-extrabold tabular-nums text-white sm:text-base">
              {durationText}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-zinc-400">Estimasi Jarak</dt>
            <dd className="font-mono text-sm font-extrabold tabular-nums text-sky-400 sm:text-base">
              {distanceText}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-zinc-400">Total Segmen</dt>
            <dd className="font-mono text-sm font-extrabold tabular-nums text-[#BEF264] sm:text-base">
              {totals.segmentCount} segmen
            </dd>
          </div>
        </dl>
      )}

      <div
        className={`w-full overflow-hidden rounded-xl bg-[#09090B]/75 ${
          compact ? 'px-1.5 py-1' : 'px-2 py-1.5'
        }`}
      >
        {bars.length === 0 ? (
          <div className="flex h-10 items-center justify-center text-xs text-zinc-500">
            Tambahkan langkah untuk melihat profil latihan
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className={compact ? 'h-9 w-full' : 'h-12 w-full'}
            role="img"
            aria-label={`Profil latihan ${bars.length} segmen`}
          >
            {bars.map((bar) => {
              const barW = Math.max(4, (bar.weightSec / totalWeight) * usableW);
              const barH = Math.max(8, Math.round((bar.intensityPct / 100) * (height - 4)));
              const x = cursorX;
              const y = height - barH;
              cursorX += barW + gap;
              return (
                <rect
                  key={bar.id}
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  rx={3}
                  fill={BAR_HEX[bar.kind]}
                >
                  <title>{bar.label}</title>
                </rect>
              );
            })}
          </svg>
        )}
      </div>

      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
          {STEP_KIND_ORDER.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`h-2 w-2 rounded-sm ${STEP_KIND_BAR[k]}`} />
              <span>{STEP_KIND_LABEL[k]}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function StructuredStepsView({
  blocks,
  maxHr,
  restingHr,
  referencePaceSecPerKm,
}: {
  blocks: WorkoutBlock[];
  maxHr?: number | null;
  restingHr?: number | null;
  referencePaceSecPerKm?: number | null;
}) {
  if (!blocks.length) return null;

  const renderStepRow = (st: SingleStep, key: string) => {
    const target = formatStepTarget(st, maxHr, restingHr);
    return (
      <div
        key={key}
        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] border-l-[3px] ${STEP_KIND_BORDER[st.kind]} bg-[#121215] px-3 py-2`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`font-bold ${STEP_KIND_TEXT[st.kind]}`}>
              {STEP_KIND_LABEL[st.kind]}
            </span>
            <span className="font-mono font-bold tabular-nums text-white">
              {formatStepDuration(st)}
            </span>
          </div>
          {st.note && <p className="mt-0.5 text-[11px] text-zinc-400">{st.note}</p>}
        </div>
        <div className="font-mono text-[11px] font-semibold tabular-nums text-[#BEF264]">
          {target ?? 'Tanpa target'}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <WorkoutProfileBar
        blocks={blocks}
        referencePaceSecPerKm={referencePaceSecPerKm}
        compact
      />
      <div className="space-y-1.5">
        {blocks.map((block, bi) => {
          if (isRepeatBlock(block)) {
            return (
              <div
                key={block.id || bi}
                className="rounded-xl border border-sky-400/25 bg-[#121215]/90 p-2.5"
              >
                <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-extrabold text-sky-300">
                  <Repeat size={13} aria-hidden />
                  <span>Repeat {block.count}×</span>
                </div>
                <div className="space-y-1.5">
                  {block.steps.map((sub, si) =>
                    renderStepRow(sub, sub.id || `${bi}-${si}`),
                  )}
                </div>
              </div>
            );
          }
          return renderStepRow(block, block.id || String(bi));
        })}
      </div>
    </div>
  );
}

interface StepCardProps {
  step: SingleStep;
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  maxHr: number | null;
  restingHr: number;
  onToggleExpand: () => void;
  onChange: (next: SingleStep) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function StepCard({
  step,
  isExpanded,
  canMoveUp,
  canMoveDown,
  canDelete,
  maxHr,
  restingHr,
  onToggleExpand,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: StepCardProps) {
  const [paceMinDraft, setPaceMinDraft] = useState(
    step.paceRange ? fmtPace(step.paceRange[0]) : '4:20',
  );
  const [paceMaxDraft, setPaceMaxDraft] = useState(
    step.paceRange ? fmtPace(step.paceRange[1]) : '4:45',
  );

  const durSec = step.durationType === 'time' ? step.durationValue ?? 300 : 300;
  const durMins = Math.floor(durSec / 60);
  const durRemSecs = durSec % 60;
  const distMeters = step.durationType === 'distance' ? step.durationValue ?? 400 : 400;

  const targetText = formatStepTarget(step, maxHr, restingHr) ?? 'Tanpa target';

  const handleKindChange = (kind: WorkoutStepKind) => {
    const defaultZone: HrZoneNumber =
      kind === 'cooldown' ? 1 : kind === 'warmup' || kind === 'recover' ? 2 : step.hrZone ?? 2;
    onChange({
      ...step,
      kind,
      ...(step.targetType === 'hr_zone' && !step.hrZone ? { hrZone: defaultZone } : {}),
    });
  };

  const handleDurationTypeChange = (durationType: WorkoutDurationType) => {
    if (durationType === 'open') {
      onChange({ ...step, durationType: 'open', durationValue: undefined });
      return;
    }
    if (durationType === 'distance') {
      const nextMeters =
        step.durationType === 'distance' && step.durationValue ? step.durationValue : 400;
      onChange({ ...step, durationType: 'distance', durationValue: nextMeters });
      return;
    }
    const nextSecs =
      step.durationType === 'time' && step.durationValue ? step.durationValue : 300;
    onChange({ ...step, durationType: 'time', durationValue: nextSecs });
  };

  const handleTargetTypeChange = (targetType: WorkoutTargetType) => {
    if (targetType === 'hr_zone') {
      const z: HrZoneNumber = step.hrZone ?? (step.kind === 'run' ? 4 : 2);
      onChange({ ...step, targetType, hrZone: z });
      return;
    }
    if (targetType === 'custom_hr') {
      const auto = calcHrZonePresetRange(step.hrZone ?? 2, maxHr, restingHr);
      const hrRange: [number, number] =
        step.hrRange ?? (auto ? [auto.min, auto.max] : [135, 155]);
      onChange({ ...step, targetType, hrRange });
      return;
    }
    if (targetType === 'pace') {
      const paceRange: [number, number] = step.paceRange ?? [260, 285];
      setPaceMinDraft(fmtPace(paceRange[0]));
      setPaceMaxDraft(fmtPace(paceRange[1]));
      onChange({ ...step, targetType, paceRange });
      return;
    }
    onChange({ ...step, targetType: 'none' });
  };

  const updatePaceDrafts = (nextMin: string, nextMax: string) => {
    setPaceMinDraft(nextMin);
    setPaceMaxDraft(nextMax);
    const p1 = parsePaceInput(nextMin);
    const p2 = parsePaceInput(nextMax);
    if (p1 != null && p2 != null) {
      onChange({
        ...step,
        targetType: 'pace',
        paceRange: [Math.min(p1, p2), Math.max(p1, p2)],
      });
    }
  };

  return (
    <div
      className={`rounded-2xl border border-white/[0.08] border-l-[3px] ${STEP_KIND_BORDER[step.kind]} bg-[#18181D] transition-colors`}
    >
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] rounded-xl px-1"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-extrabold ${STEP_KIND_TEXT[step.kind]}`}>
                {STEP_KIND_LABEL[step.kind]}
              </span>
              <span className="font-mono text-sm font-extrabold tabular-nums text-white">
                {formatStepDuration(step)}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] font-medium tabular-nums text-zinc-300">
              {targetText}
              {step.note ? ` · ${step.note}` : ''}
            </div>
          </div>
          <ChevronDown
            size={16}
            className={`shrink-0 text-zinc-400 transition-transform ${
              isExpanded ? 'rotate-180 text-[#BEF264]' : ''
            }`}
            aria-hidden
          />
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            aria-label={`Pindahkan langkah ${STEP_KIND_LABEL[step.kind]} ke atas`}
            className="flex h-9 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <ArrowUp size={14} aria-hidden />
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            aria-label={`Pindahkan langkah ${STEP_KIND_LABEL[step.kind]} ke bawah`}
            className="flex h-9 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <ArrowDown size={14} aria-hidden />
          </button>
          <button
            type="button"
            disabled={!canDelete}
            onClick={onDelete}
            aria-label={`Hapus langkah ${STEP_KIND_LABEL[step.kind]}`}
            className="flex h-9 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-rose-500/15 hover:text-rose-400 disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-3 border-t border-white/[0.07] px-3 py-3">
          {/* Jenis Langkah */}
          <div>
            <div className="text-[11px] font-semibold text-zinc-400">Jenis Langkah</div>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {STEP_KIND_ORDER.map((k) => {
                const active = step.kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleKindChange(k)}
                    className={`min-h-[38px] rounded-xl border px-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                      active
                        ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                        : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    {STEP_KIND_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tipe & Nilai Durasi */}
          <div>
            <div className="text-[11px] font-semibold text-zinc-400">Durasi / Jarak</div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {DURATION_OPTIONS.map((opt) => {
                const active = step.durationType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleDurationTypeChange(opt.value)}
                    className={`min-h-[38px] rounded-xl border px-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                      active
                        ? 'border-sky-400 bg-sky-400/15 text-sky-300'
                        : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {step.durationType === 'time' && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-zinc-400">
                    Menit
                    <input
                      type="number"
                      min="0"
                      max="240"
                      value={durMins}
                      onChange={(e) => {
                        const m = Math.max(0, Math.min(240, Number(e.target.value) || 0));
                        const total = Math.max(5, m * 60 + durRemSecs);
                        onChange({ ...step, durationType: 'time', durationValue: total });
                      }}
                      className="mt-1 block min-h-[40px] w-full rounded-xl border border-white/10 bg-[#121215] px-3 text-sm font-mono tabular-nums text-white focus:border-[#BEF264] focus:outline-none"
                    />
                  </label>
                  <label className="text-[11px] text-zinc-400">
                    Detik
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={durRemSecs}
                      onChange={(e) => {
                        const s = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                        const total = Math.max(5, durMins * 60 + s);
                        onChange({ ...step, durationType: 'time', durationValue: total });
                      }}
                      className="mt-1 block min-h-[40px] w-full rounded-xl border border-white/10 bg-[#121215] px-3 text-sm font-mono tabular-nums text-white focus:border-[#BEF264] focus:outline-none"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_TIME_SEC.map((q) => (
                    <button
                      key={q.sec}
                      type="button"
                      onClick={() =>
                        onChange({ ...step, durationType: 'time', durationValue: q.sec })
                      }
                      className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] tabular-nums transition ${
                        step.durationValue === q.sec
                          ? 'border-sky-400/50 bg-sky-400/15 text-sky-300'
                          : 'border-white/10 bg-[#121215] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step.durationType === 'distance' && (
              <div className="mt-2 space-y-2">
                <label className="block text-[11px] text-zinc-400">
                  Jarak (meter)
                  <input
                    type="number"
                    min="50"
                    max="50000"
                    step="50"
                    value={distMeters}
                    onChange={(e) => {
                      const m = Math.max(50, Math.min(50000, Number(e.target.value) || 50));
                      onChange({ ...step, durationType: 'distance', durationValue: m });
                    }}
                    className="mt-1 block min-h-[40px] w-full rounded-xl border border-white/10 bg-[#121215] px-3 text-sm font-mono tabular-nums text-white focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_DIST_M.map((q) => (
                    <button
                      key={q.m}
                      type="button"
                      onClick={() =>
                        onChange({ ...step, durationType: 'distance', durationValue: q.m })
                      }
                      className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] tabular-nums transition ${
                        step.durationValue === q.m
                          ? 'border-sky-400/50 bg-sky-400/15 text-sky-300'
                          : 'border-white/10 bg-[#121215] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step.durationType === 'open' && (
              <p className="mt-2 rounded-xl border border-white/[0.06] bg-[#121215] px-3 py-2 text-[11px] text-zinc-400">
                Langkah berlanjut hingga tombol Lap pada jam ditekan.
              </p>
            )}
          </div>

          {/* Target Intensitas */}
          <div>
            <div className="text-[11px] font-semibold text-zinc-400">Target Intensitas</div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {TARGET_OPTIONS.map((opt) => {
                const active = step.targetType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleTargetTypeChange(opt.value)}
                    className={`min-h-[38px] rounded-xl border px-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                      active
                        ? 'border-[#BEF264] bg-[#BEF264]/15 text-[#BEF264]'
                        : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {step.targetType === 'hr_zone' && (
              <div className="mt-2 space-y-1.5">
                <div className="grid grid-cols-5 gap-1.5">
                  {HR_ZONE_PRESETS.map((z) => {
                    const calc = calcHrZonePresetRange(z.zone, maxHr, restingHr);
                    const active = step.hrZone === z.zone;
                    return (
                      <button
                        key={z.code}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          onChange({ ...step, targetType: 'hr_zone', hrZone: z.zone })
                        }
                        className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl border px-1 py-1 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                          active
                            ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                            : 'border-white/10 bg-[#121215] text-zinc-200 hover:border-white/25'
                        }`}
                      >
                        <span className="font-mono text-xs font-extrabold leading-tight">
                          {z.code}
                        </span>
                        <span
                          className={`mt-0.5 font-mono text-[10px] tabular-nums leading-tight ${
                            active ? 'text-[#09090B]/80 font-bold' : 'text-zinc-400'
                          }`}
                        >
                          {calc ? `${calc.min}–${calc.max}` : z.pctLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-zinc-400">
                  {(() => {
                    const activeZ = HR_ZONE_PRESETS.find((z) => z.zone === (step.hrZone ?? 2));
                    const calc = activeZ
                      ? calcHrZonePresetRange(activeZ.zone, maxHr, restingHr)
                      : null;
                    if (!activeZ) return null;
                    if (calc) {
                      const method = calc.method === 'hrr' ? 'Karvonen HRR' : '% HRmaks';
                      return `${activeZ.label} (${activeZ.name}) · ${activeZ.pctLabel} ${method} → ${calc.min}–${calc.max} bpm`;
                    }
                    return `${activeZ.label} (${activeZ.name}) · Isi HRmaks di Profil untuk kalkulasi bpm otomatis.`;
                  })()}
                </p>
              </div>
            )}

            {step.targetType === 'custom_hr' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-zinc-400">
                  HR Min (bpm)
                  <input
                    type="number"
                    min="60"
                    max="220"
                    value={step.hrRange?.[0] ?? 140}
                    onChange={(e) => {
                      const minV = Math.max(60, Math.min(220, Number(e.target.value) || 60));
                      const curMax = step.hrRange?.[1] ?? minV + 15;
                      onChange({
                        ...step,
                        targetType: 'custom_hr',
                        hrRange: [minV, Math.max(minV, curMax)],
                      });
                    }}
                    className="mt-1 block min-h-[40px] w-full rounded-xl border border-white/10 bg-[#121215] px-3 text-sm font-mono tabular-nums text-white focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
                <label className="text-[11px] text-zinc-400">
                  HR Maks (bpm)
                  <input
                    type="number"
                    min="60"
                    max="230"
                    value={step.hrRange?.[1] ?? 160}
                    onChange={(e) => {
                      const maxV = Math.max(60, Math.min(230, Number(e.target.value) || 60));
                      const curMin = step.hrRange?.[0] ?? Math.min(140, maxV);
                      onChange({
                        ...step,
                        targetType: 'custom_hr',
                        hrRange: [Math.min(curMin, maxV), maxV],
                      });
                    }}
                    className="mt-1 block min-h-[40px] w-full rounded-xl border border-white/10 bg-[#121215] px-3 text-sm font-mono tabular-nums text-white focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
              </div>
            )}

            {step.targetType === 'pace' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-zinc-400">
                  Pace Cepat (mm:ss)
                  <input
                    type="text"
                    inputMode="numeric"
                    value={paceMinDraft}
                    onChange={(e) => updatePaceDrafts(e.target.value, paceMaxDraft)}
                    placeholder="4:20"
                    className="mt-1 block min-h-[40px] w-full rounded-xl border border-white/10 bg-[#121215] px-3 text-sm font-mono tabular-nums text-white focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
                <label className="text-[11px] text-zinc-400">
                  Pace Lambat (mm:ss)
                  <input
                    type="text"
                    inputMode="numeric"
                    value={paceMaxDraft}
                    onChange={(e) => updatePaceDrafts(paceMinDraft, e.target.value)}
                    placeholder="4:45"
                    className="mt-1 block min-h-[40px] w-full rounded-xl border border-white/10 bg-[#121215] px-3 text-sm font-mono tabular-nums text-white focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
              </div>
            )}
          </div>

          <label className="block text-[11px] text-zinc-400">
            Catatan Langkah (Opsional)
            <input
              type="text"
              value={step.note ?? ''}
              onChange={(e) =>
                onChange({ ...step, note: e.target.value ? e.target.value : undefined })
              }
              placeholder="Mis. Jaga cadence ringan & napas teratur"
              className="mt-1 block min-h-[40px] w-full rounded-xl border border-white/10 bg-[#121215] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#BEF264] focus:outline-none"
            />
          </label>
        </div>
      )}
    </div>
  );
}

interface WorkoutStepBuilderProps {
  blocks: WorkoutBlock[];
  onChange: (next: WorkoutBlock[]) => void;
  onApplyPreset: (preset: WorkoutPresetTemplate) => void;
  maxHr: number | null;
  restingHr: number;
}

export function WorkoutStepBuilder({
  blocks,
  onChange,
  onApplyPreset,
  maxHr,
  restingHr,
}: WorkoutStepBuilderProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const moveBlock = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const deleteBlock = (index: number) => {
    if (blocks.length <= 1) return;
    onChange(blocks.filter((_, i) => i !== index));
  };

  const updateBlock = (index: number, nextBlock: WorkoutBlock) => {
    onChange(blocks.map((b, i) => (i === index ? nextBlock : b)));
  };

  const updateRepeatSubStep = (
    blockIndex: number,
    block: RepeatBlock,
    subIndex: number,
    nextSub: SingleStep,
  ) => {
    updateBlock(blockIndex, {
      ...block,
      steps: block.steps.map((s, i) => (i === subIndex ? nextSub : s)),
    });
  };

  const moveRepeatSubStep = (
    blockIndex: number,
    block: RepeatBlock,
    subIndex: number,
    delta: -1 | 1,
  ) => {
    const target = subIndex + delta;
    if (target < 0 || target >= block.steps.length) return;
    const nextSteps = [...block.steps];
    const [item] = nextSteps.splice(subIndex, 1);
    nextSteps.splice(target, 0, item);
    updateBlock(blockIndex, { ...block, steps: nextSteps });
  };

  const deleteRepeatSubStep = (blockIndex: number, block: RepeatBlock, subIndex: number) => {
    if (block.steps.length <= 1) return;
    updateBlock(blockIndex, {
      ...block,
      steps: block.steps.filter((_, i) => i !== subIndex),
    });
  };

  const addRepeatSubStep = (blockIndex: number, block: RepeatBlock) => {
    const lastKind = block.steps[block.steps.length - 1]?.kind;
    const newStep = createDefaultStep(lastKind === 'run' ? 'recover' : 'run');
    updateBlock(blockIndex, { ...block, steps: [...block.steps, newStep] });
    setExpandedId(newStep.id);
  };

  const handleAddSingleStep = () => {
    const newStep = createDefaultStep('run');
    onChange([...blocks, newStep]);
    setExpandedId(newStep.id);
  };

  const handleAddRepeatBlock = () => {
    const rep = createDefaultRepeatBlock();
    onChange([...blocks, rep]);
    setExpandedId(rep.steps[0]?.id ?? null);
  };

  return (
    <div className="space-y-3">
      {/* Isi Cepat Preset */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#18181D]/60 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Sparkles size={13} className="text-[#BEF264]" aria-hidden />
          <span>Isi Cepat Preset</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {WORKOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onApplyPreset(preset);
                setExpandedId(null);
              }}
              className="min-h-[38px] whitespace-nowrap rounded-xl border border-white/10 bg-[#121215] px-3 text-xs font-bold text-zinc-200 transition hover:border-[#BEF264]/45 hover:text-[#BEF264] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Daftar Kartu Langkah */}
      <div className="space-y-2.5">
        {blocks.map((block, bi) => {
          if (isRepeatBlock(block)) {
            return (
              <div
                key={block.id}
                className="rounded-2xl border border-sky-400/30 bg-[#141419] p-3"
              >
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-sky-300">
                      <Repeat size={14} aria-hidden />
                      <span>Repeat {block.count}×</span>
                    </span>
                    <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#121215] p-0.5">
                      <button
                        type="button"
                        disabled={block.count <= 1}
                        onClick={() =>
                          updateBlock(bi, {
                            ...block,
                            count: Math.max(1, block.count - 1),
                          })
                        }
                        aria-label="Kurangi jumlah ulangan"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                      >
                        <Minus size={14} aria-hidden />
                      </button>
                      <span className="min-w-[26px] text-center font-mono text-xs font-extrabold tabular-nums text-white">
                        {block.count}
                      </span>
                      <button
                        type="button"
                        disabled={block.count >= 30}
                        onClick={() =>
                          updateBlock(bi, {
                            ...block,
                            count: Math.min(30, block.count + 1),
                          })
                        }
                        aria-label="Tambah jumlah ulangan"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                      >
                        <Plus size={14} aria-hidden />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={bi === 0}
                      onClick={() => moveBlock(bi, -1)}
                      aria-label="Pindahkan blok repeat ke atas"
                      className="flex h-9 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                    >
                      <ArrowUp size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={bi === blocks.length - 1}
                      onClick={() => moveBlock(bi, 1)}
                      aria-label="Pindahkan blok repeat ke bawah"
                      className="flex h-9 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                    >
                      <ArrowDown size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={blocks.length <= 1}
                      onClick={() => deleteBlock(bi)}
                      aria-label="Hapus blok repeat"
                      className="flex h-9 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-rose-500/15 hover:text-rose-400 disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {block.steps.map((sub, si) => (
                    <StepCard
                      key={sub.id || `${block.id}-${si}`}
                      step={sub}
                      isExpanded={expandedId === sub.id}
                      canMoveUp={si > 0}
                      canMoveDown={si < block.steps.length - 1}
                      canDelete={block.steps.length > 1}
                      maxHr={maxHr}
                      restingHr={restingHr}
                      onToggleExpand={() =>
                        setExpandedId(expandedId === sub.id ? null : sub.id)
                      }
                      onChange={(nextSub) =>
                        updateRepeatSubStep(bi, block, si, nextSub)
                      }
                      onMoveUp={() => moveRepeatSubStep(bi, block, si, -1)}
                      onMoveDown={() => moveRepeatSubStep(bi, block, si, 1)}
                      onDelete={() => deleteRepeatSubStep(bi, block, si)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => addRepeatSubStep(bi, block)}
                  className="mt-2 inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 bg-[#121215]/70 px-3 text-xs font-semibold text-zinc-300 transition hover:border-sky-400/45 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                >
                  <Plus size={13} aria-hidden />
                  <span>Tambah Langkah di Repeat</span>
                </button>
              </div>
            );
          }

          return (
            <StepCard
              key={block.id}
              step={block}
              isExpanded={expandedId === block.id}
              canMoveUp={bi > 0}
              canMoveDown={bi < blocks.length - 1}
              canDelete={blocks.length > 1}
              maxHr={maxHr}
              restingHr={restingHr}
              onToggleExpand={() =>
                setExpandedId(expandedId === block.id ? null : block.id)
              }
              onChange={(nextStep) => updateBlock(bi, nextStep)}
              onMoveUp={() => moveBlock(bi, -1)}
              onMoveDown={() => moveBlock(bi, 1)}
              onDelete={() => deleteBlock(bi)}
            />
          );
        })}
      </div>

      {/* Tombol Aksi Bawah Builder */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleAddSingleStep}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-white/15 bg-[#18181D] px-3 text-xs font-bold text-zinc-100 transition hover:border-[#BEF264]/45 hover:text-[#BEF264] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          <Plus size={14} aria-hidden />
          <span>Tambah Langkah</span>
        </button>

        <button
          type="button"
          onClick={handleAddRepeatBlock}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-sky-400/35 bg-sky-400/10 px-3 text-xs font-bold text-sky-300 transition hover:border-sky-400/55 hover:bg-sky-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          <Repeat size={14} aria-hidden />
          <span>Tambah Repeat</span>
        </button>
      </div>
    </div>
  );
}
