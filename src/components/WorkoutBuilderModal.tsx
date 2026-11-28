import React, { useEffect, useId, useMemo, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import {
  DurationType,
  SessionCategory,
  SingleStep,
  StepKind,
  TargetType,
  WORKOUT_PRESETS,
  WorkoutBlock,
  formatDuration,
  formatTarget,
  getZoneBpm,
  summarizeWorkout,
} from '../plans/workoutTypes';
import { formatDayMonthYear, isValidIso } from '../plans/schedule';
import { useDialog } from './useDialog';

interface Props {
  isOpen: boolean;
  initialDate: string; // YYYY-MM-DD
  initialData?: {
    date: string;
    category: SessionCategory;
    title: string;
    structuredSteps?: WorkoutBlock[];
  };
  maxHr?: number;
  restingHr?: number | null;
  onClose: () => void;
  onSave: (payload: {
    date: string;
    category: SessionCategory;
    title: string;
    durationMin: number;
    distanceKm: number;
    hrRange: [number, number];
    paceRange: [number, number] | null;
    steps: string[];
    structuredSteps: WorkoutBlock[];
  }) => void;
}

const KIND_STYLE: Record<StepKind, { label: string; border: string; fill: string }> = {
  warmup: { label: 'Warm Up', border: 'border-l-rose-500', fill: '#f43f5e' },
  run: { label: 'Run', border: 'border-l-sky-400', fill: '#38bdf8' },
  recover: { label: 'Recover', border: 'border-l-zinc-400', fill: '#a1a1aa' },
  cooldown: { label: 'Cool Down', border: 'border-l-emerald-400', fill: '#34d399' },
};

function fmtMmSs(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function parsePaceInput(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function stepWeight(step: SingleStep): number {
  if (step.durationType === 'time' && step.durationValue) return Math.max(60, step.durationValue);
  if (step.durationType === 'distance' && step.durationValue) {
    return Math.max(60, Math.round((step.durationValue / 1000) * 390));
  }
  return 240;
}

function stepHeightRatio(step: SingleStep): number {
  if (step.kind === 'run' && (step.hrZone === 4 || step.hrZone === 5 || step.targetType === 'custom_hr' || step.targetType === 'pace')) {
    return 1;
  }
  if (step.kind === 'run') return 0.75;
  return 0.42;
}

function WorkoutProfileBar({ blocks }: { blocks: WorkoutBlock[] }) {
  const flatBars = blocks.flatMap((b) =>
    b.type === 'step' ? [b] : Array.from({ length: b.count }, () => b.steps).flat(),
  );
  const totalWeight = flatBars.reduce((sum, s) => sum + stepWeight(s), 0) || 1;
  const gap = 0.6;
  const usableWidth = Math.max(10, 100 - Math.max(0, flatBars.length - 1) * gap);

  let cursorX = 0;
  const rects = flatBars.map((s, idx) => {
    const w = (stepWeight(s) / totalWeight) * usableWidth;
    const h = 20 * stepHeightRatio(s);
    const y = 22 - h;
    const rect = {
      key: `${s.id}-${idx}`,
      x: cursorX,
      y,
      w: Math.max(1.2, w),
      h,
      fill: KIND_STYLE[s.kind].fill,
    };
    cursorX += w + gap;
    return rect;
  });

  return (
    <div className="rounded-xl border border-white/10 bg-[#121215] p-2">
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        className="h-6 w-full"
        role="img"
        aria-label="Profil intensitas langkah latihan"
      >
        {rects.map((r) => (
          <rect
            key={r.key}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={0.8}
            fill={r.fill}
          />
        ))}
      </svg>
    </div>
  );
}

export function StructuredWorkoutPreview({
  blocks,
  maxHr = 195,
  restingHr = 58,
}: {
  blocks: WorkoutBlock[];
  maxHr?: number;
  restingHr?: number | null;
}) {
  if (!blocks.length) return null;

  return (
    <div className="space-y-1.5">
      <WorkoutProfileBar blocks={blocks} />
      <div className="space-y-1.5">
        {blocks.map((block) =>
          block.type === 'step' ? (
            <div
              key={block.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] border-l-4 ${KIND_STYLE[block.kind].border} bg-[#121215] px-3 py-2 text-xs`}
            >
              <span className="font-semibold text-zinc-200">{KIND_STYLE[block.kind].label}</span>
              <span className="font-mono tabular-nums text-zinc-400">
                {formatDuration(block.durationType, block.durationValue)} ·{' '}
                <span className="font-semibold text-[#BEF264]">
                  {formatTarget(block, maxHr, restingHr)}
                </span>
              </span>
            </div>
          ) : (
            <div
              key={block.id}
              className="space-y-1.5 rounded-xl border border-sky-400/25 bg-sky-400/[0.05] p-2.5"
            >
              <div className="font-mono text-xs font-extrabold tabular-nums text-sky-400">
                Repeat {block.count}×
              </div>
              <div className="space-y-1 border-l-2 border-sky-400/40 pl-2">
                {block.steps.map((sub) => (
                  <div
                    key={sub.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] border-l-4 ${KIND_STYLE[sub.kind].border} bg-[#121215] px-2.5 py-1.5 text-[11px]`}
                  >
                    <span className="font-semibold text-zinc-200">{KIND_STYLE[sub.kind].label}</span>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {formatDuration(sub.durationType, sub.durationValue)} ·{' '}
                      <span className="font-semibold text-[#BEF264]">
                        {formatTarget(sub, maxHr, restingHr)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export const WorkoutBuilderModal: React.FC<Props> = ({
  isOpen,
  initialDate,
  initialData,
  maxHr = 195,
  restingHr = 58,
  onClose,
  onSave,
}) => {
  const titleId = useId();
  const dateInputId = useId();
  const dialogRef = useDialog<HTMLDivElement>(onClose, isOpen);

  const [stepTab, setStepTab] = useState<1 | 2>(1);
  const [date, setDate] = useState(initialData?.date ?? initialDate);
  const [category, setCategory] = useState<SessionCategory>(initialData?.category ?? 'speed');
  const [title, setTitle] = useState(initialData?.title ?? 'Norwegian 4×4');
  const [blocks, setBlocks] = useState<WorkoutBlock[]>(
    () =>
      structuredClone(
        initialData?.structuredSteps && initialData.structuredSteps.length > 0
          ? initialData.structuredSteps
          : WORKOUT_PRESETS.norwegian4x4.blocks,
      ),
  );
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [paceMinDraft, setPaceMinDraft] = useState<Record<string, string>>({});
  const [paceMaxDraft, setPaceMaxDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setStepTab(1);
    setDate(initialData?.date ?? initialDate);
    setCategory(initialData?.category ?? 'speed');
    setTitle(initialData?.title ?? (initialData ? initialData.title : 'Norwegian 4×4'));
    setBlocks(
      structuredClone(
        initialData?.structuredSteps && initialData.structuredSteps.length > 0
          ? initialData.structuredSteps
          : WORKOUT_PRESETS.norwegian4x4.blocks,
      ),
    );
    setEditingStepId(null);
    setPaceMinDraft({});
    setPaceMaxDraft({});
  }, [isOpen, initialData, initialDate]);

  const summary = useMemo(
    () => summarizeWorkout(blocks, maxHr, restingHr),
    [blocks, maxHr, restingHr],
  );

  if (!isOpen) return null;

  const isEdit = Boolean(initialData);
  const displayDate = isValidIso(date) ? formatDayMonthYear(date) : 'Pilih tanggal';

  const applyPreset = (key: keyof typeof WORKOUT_PRESETS) => {
    const p = WORKOUT_PRESETS[key];
    setTitle(p.title);
    setCategory(p.category);
    setBlocks(structuredClone(p.blocks));
    setEditingStepId(null);
  };

  const updateStep = (stepId: string, patch: Partial<SingleStep>) => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.type === 'step') return b.id === stepId ? { ...b, ...patch } : b;
        return {
          ...b,
          steps: b.steps.map((sub) => (sub.id === stepId ? { ...sub, ...patch } : sub)),
        };
      }),
    );
  };

  const addSingleStep = () => {
    const id = `step-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setBlocks((prev) => [
      ...prev,
      { id, type: 'step', kind: 'run', durationType: 'time', durationValue: 300, targetType: 'hr_zone', hrZone: 2 },
    ]);
    setEditingStepId(id);
  };

  const addRepeatBlock = () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setBlocks((prev) => [
      ...prev,
      {
        id: `rep-${stamp}`,
        type: 'repeat',
        count: 4,
        steps: [
          { id: `s1-${stamp}`, type: 'step', kind: 'run', durationType: 'time', durationValue: 240, targetType: 'hr_zone', hrZone: 4 },
          { id: `s2-${stamp}`, type: 'step', kind: 'recover', durationType: 'time', durationValue: 180, targetType: 'hr_zone', hrZone: 2 },
        ],
      },
    ]);
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const renderStepCard = (step: SingleStep, deletable = true) => {
    const isEditing = editingStepId === step.id;
    const style = KIND_STYLE[step.kind];
    const minPaceText = paceMinDraft[step.id] ?? fmtMmSs(step.paceRange?.[0] ?? 270);
    const maxPaceText = paceMaxDraft[step.id] ?? fmtMmSs(step.paceRange?.[1] ?? 290);

    return (
      <div
        key={step.id}
        className={`space-y-2 rounded-xl border border-white/10 border-l-4 ${style.border} bg-[#18181D] p-3`}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setEditingStepId(isEditing ? null : step.id)}
            aria-expanded={isEditing}
            className="flex min-h-[44px] flex-1 items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <div>
              <div className="text-xs font-semibold text-zinc-100">{style.label}</div>
              <div className="font-mono text-[11px] tabular-nums text-zinc-400">
                {formatDuration(step.durationType, step.durationValue)} ·{' '}
                <span className="font-semibold text-[#BEF264]">
                  {formatTarget(step, maxHr, restingHr)}
                </span>
              </div>
            </div>
            <span className="text-xs font-semibold text-zinc-400">
              {isEditing ? 'Tutup' : 'Ubah'}
            </span>
          </button>

          {deletable && (
            <button
              type="button"
              aria-label={`Hapus langkah ${style.label}`}
              onClick={() => removeBlock(step.id)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-rose-400 transition hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </div>

        {isEditing && (
          <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-2.5 text-xs">
            <label className="space-y-1">
              <span className="text-zinc-400">Jenis</span>
              <select
                value={step.kind}
                onChange={(e) => updateStep(step.id, { kind: e.target.value as StepKind })}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#121215] px-2.5 text-zinc-100 focus:border-[#BEF264] focus:outline-none"
              >
                <option value="warmup">Warm Up</option>
                <option value="run">Run</option>
                <option value="recover">Recover</option>
                <option value="cooldown">Cool Down</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-zinc-400">Tipe Durasi</span>
              <select
                value={step.durationType}
                onChange={(e) => {
                  const nextDur = e.target.value as DurationType;
                  updateStep(step.id, {
                    durationType: nextDur,
                    durationValue: nextDur === 'distance' ? 1000 : nextDur === 'time' ? 300 : undefined,
                  });
                }}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#121215] px-2.5 text-zinc-100 focus:border-[#BEF264] focus:outline-none"
              >
                <option value="time">Waktu (menit)</option>
                <option value="distance">Jarak (meter)</option>
                <option value="open">Tombol Lap</option>
              </select>
            </label>

            {step.durationType !== 'open' && (
              <label className="space-y-1">
                <span className="text-zinc-400">
                  {step.durationType === 'time' ? 'Menit' : 'Meter'}
                </span>
                <input
                  type="number"
                  min={1}
                  value={
                    step.durationType === 'time'
                      ? Math.max(1, Math.round((step.durationValue ?? 60) / 60))
                      : step.durationValue ?? 1000
                  }
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value) || 1);
                    updateStep(step.id, {
                      durationValue: step.durationType === 'time' ? val * 60 : val,
                    });
                  }}
                  className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#121215] px-2.5 font-mono tabular-nums text-zinc-100 focus:border-[#BEF264] focus:outline-none"
                />
              </label>
            )}

            <label className="space-y-1">
              <span className="text-zinc-400">Target</span>
              <select
                value={step.targetType}
                onChange={(e) => {
                  const nextTarget = e.target.value as TargetType;
                  updateStep(step.id, {
                    targetType: nextTarget,
                    hrZone: nextTarget === 'hr_zone' ? step.hrZone ?? 2 : step.hrZone,
                    hrRange: nextTarget === 'custom_hr' ? step.hrRange ?? [166, 185] : step.hrRange,
                    paceRange: nextTarget === 'pace' ? step.paceRange ?? [270, 290] : step.paceRange,
                  });
                }}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#121215] px-2.5 text-zinc-100 focus:border-[#BEF264] focus:outline-none"
              >
                <option value="hr_zone">Zona HR (Z1–Z5)</option>
                <option value="custom_hr">Custom HR (bpm)</option>
                <option value="pace">Target Pace (/km)</option>
                <option value="none">Tanpa Target</option>
              </select>
            </label>

            {step.targetType === 'hr_zone' && (
              <div className="col-span-2 grid grid-cols-5 gap-1.5 pt-1">
                {([1, 2, 3, 4, 5] as const).map((z) => {
                  const [min, max] = getZoneBpm(z, maxHr, restingHr);
                  const active = step.hrZone === z;
                  return (
                    <button
                      key={z}
                      type="button"
                      aria-pressed={active}
                      onClick={() => updateStep(step.id, { hrZone: z })}
                      className={`min-h-[44px] rounded-xl border py-1.5 font-mono text-[11px] font-bold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                        active
                          ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                          : 'border-white/10 bg-[#121215] text-zinc-300'
                      }`}
                    >
                      Z{z}
                      <span className="block text-[9px] font-medium opacity-85">
                        {min}-{max}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {step.targetType === 'custom_hr' && (
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">HR Min (bpm)</span>
                  <input
                    type="number"
                    min={60}
                    max={230}
                    value={step.hrRange?.[0] ?? 165}
                    onChange={(e) => {
                      const lo = Math.max(60, Number(e.target.value) || 60);
                      const hi = Math.max(lo, step.hrRange?.[1] ?? 185);
                      updateStep(step.id, { hrRange: [lo, hi] });
                    }}
                    className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#121215] px-2.5 font-mono tabular-nums text-zinc-100 focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">HR Maks (bpm)</span>
                  <input
                    type="number"
                    min={60}
                    max={230}
                    value={step.hrRange?.[1] ?? 185}
                    onChange={(e) => {
                      const hi = Math.max(60, Number(e.target.value) || 185);
                      const lo = Math.min(hi, step.hrRange?.[0] ?? 165);
                      updateStep(step.id, { hrRange: [lo, hi] });
                    }}
                    className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#121215] px-2.5 font-mono tabular-nums text-zinc-100 focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
              </div>
            )}

            {step.targetType === 'pace' && (
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Pace Cepat (MM:SS)</span>
                  <input
                    type="text"
                    placeholder="4:30"
                    value={minPaceText}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setPaceMinDraft((d) => ({ ...d, [step.id]: raw }));
                      const parsed = parsePaceInput(raw);
                      if (parsed != null) {
                        const curHi = step.paceRange?.[1] ?? parsed + 15;
                        updateStep(step.id, { paceRange: [Math.min(parsed, curHi), Math.max(parsed, curHi)] });
                      }
                    }}
                    className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#121215] px-2.5 font-mono tabular-nums text-zinc-100 focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Pace Lambat (MM:SS)</span>
                  <input
                    type="text"
                    placeholder="4:50"
                    value={maxPaceText}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setPaceMaxDraft((d) => ({ ...d, [step.id]: raw }));
                      const parsed = parsePaceInput(raw);
                      if (parsed != null) {
                        const curLo = step.paceRange?.[0] ?? Math.max(120, parsed - 15);
                        updateStep(step.id, { paceRange: [Math.min(curLo, parsed), Math.max(curLo, parsed)] });
                      }
                    }}
                    className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#121215] px-2.5 font-mono tabular-nums text-zinc-100 focus:border-[#BEF264] focus:outline-none"
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#121215] text-zinc-100 shadow-2xl sm:rounded-3xl"
      >
        {/* Header & Step Switcher */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
          <div className="min-w-0">
            <h3 id={titleId} className="font-display text-sm font-bold text-white">
              {isEdit ? 'Edit Sesi Program' : 'Input Sesi Program'}
            </h3>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
              Estimasi: {summary.durationMin} mnt · ~{summary.distanceKm} km · {summary.hrRange[0]}–{summary.hrRange[1]} bpm
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-1.5 border-b border-white/10 bg-[#18181D]/70 p-2 text-xs">
          <button
            type="button"
            aria-pressed={stepTab === 1}
            onClick={() => setStepTab(1)}
            className={`min-h-[44px] rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
              stepTab === 1 ? 'bg-[#BEF264] text-[#09090B]' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            1. Info & Preset
          </button>
          <button
            type="button"
            aria-pressed={stepTab === 2}
            onClick={() => setStepTab(2)}
            className={`min-h-[44px] rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
              stepTab === 2 ? 'bg-[#BEF264] text-[#09090B]' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            2. Builder ala Garmin
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {stepTab === 1 ? (
            <>
              <div>
                <div className="mb-1.5 text-xs font-semibold text-zinc-400">Isi Cepat Preset</div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['easy35', 'Easy Run 35m'],
                      ['norwegian4x4', 'Norwegian 4×4'],
                      ['fartlek5x1', 'Fartlek 5×1m'],
                      ['long8k', 'Long Run 8 km'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key)}
                      className="min-h-[44px] rounded-xl border border-white/10 bg-[#18181D] px-3 py-2 text-left text-xs font-semibold text-zinc-100 transition hover:border-[#BEF264]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <label htmlFor={dateInputId} className="block font-semibold text-zinc-400">
                  Tanggal Sesi
                </label>
                <div className="relative">
                  <input
                    id={dateInputId}
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  />
                  <div className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#18181D] px-3 text-sm font-medium tabular-nums text-zinc-100 peer-focus-visible:border-[#BEF264] peer-focus-visible:ring-2 peer-focus-visible:ring-[#BEF264]/35">
                    <span>{displayDate}</span>
                    <CalendarDays size={16} className="shrink-0 text-zinc-400" aria-hidden />
                  </div>
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <span className="block font-semibold text-zinc-400">Kategori Sesi</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      ['easy', 'Easy'],
                      ['long', 'Long Run'],
                      ['speed', 'Interval'],
                      ['race', 'Lomba'],
                    ] as const
                  ).map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      aria-pressed={category === val}
                      onClick={() => setCategory(val)}
                      className={`min-h-[44px] rounded-xl border text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                        category === val
                          ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                          : 'border-white/10 bg-[#18181D] text-zinc-300'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="font-semibold text-zinc-400">Nama Sesi</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Mis. Norwegian 4×4"
                  className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#18181D] px-3 text-sm text-zinc-100 focus:border-[#BEF264] focus:outline-none focus:ring-2 focus:ring-[#BEF264]/35"
                />
              </label>
            </>
          ) : (
            <>
              {/* Workout Profile Bar */}
              <WorkoutProfileBar blocks={blocks} />

              {/* Steps & Repeat Blocks */}
              <div className="space-y-2.5">
                {blocks.map((block) =>
                  block.type === 'step' ? (
                    renderStepCard(block, blocks.length > 1)
                  ) : (
                    <div
                      key={block.id}
                      className="space-y-2 rounded-xl border border-sky-400/30 bg-sky-400/[0.04] p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold tabular-nums text-sky-400">
                            Repeat {block.count}×
                          </span>
                          <button
                            type="button"
                            aria-label="Kurangi pengulangan"
                            onClick={() =>
                              setBlocks((prev) =>
                                prev.map((b) =>
                                  b.id === block.id && b.type === 'repeat'
                                    ? { ...b, count: Math.max(2, b.count - 1) }
                                    : b,
                                ),
                              )
                            }
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#18181D] font-bold text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                          >
                            −
                          </button>
                          <button
                            type="button"
                            aria-label="Tambah pengulangan"
                            onClick={() =>
                              setBlocks((prev) =>
                                prev.map((b) =>
                                  b.id === block.id && b.type === 'repeat'
                                    ? { ...b, count: Math.min(30, b.count + 1) }
                                    : b,
                                ),
                              )
                            }
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#18181D] font-bold text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeBlock(block.id)}
                          className="min-h-[36px] rounded-lg px-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                        >
                          Hapus Blok
                        </button>
                      </div>
                      <div className="space-y-2 border-l-2 border-sky-400/40 pl-2">
                        {block.steps.map((sub) => renderStepCard(sub, false))}
                      </div>
                    </div>
                  ),
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={addSingleStep}
                  className="min-h-[44px] rounded-xl border border-white/10 bg-[#18181D] text-xs font-semibold text-zinc-200 transition hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
                >
                  + Tambah Langkah
                </button>
                <button
                  type="button"
                  onClick={addRepeatBlock}
                  className="min-h-[44px] rounded-xl border border-sky-400/35 bg-sky-400/10 text-xs font-semibold text-sky-300 transition hover:bg-sky-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  + Tambah Repeat
                </button>
              </div>
            </>
          )}
        </div>

        {/* Sticky Footer */}
        <div
          className="flex shrink-0 gap-2 border-t border-white/10 bg-[#121215] px-4 pt-3"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-[#18181D] text-xs font-semibold text-zinc-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => {
              onSave({
                date,
                category,
                title: title.trim() || 'Sesi Lari',
                durationMin: summary.durationMin,
                distanceKm: summary.distanceKm,
                hrRange: summary.hrRange,
                paceRange: summary.paceRange,
                steps: summary.steps,
                structuredSteps: blocks,
              });
              onClose();
            }}
            className="min-h-[44px] flex-1 rounded-xl bg-[#BEF264] text-xs font-extrabold text-[#09090B] transition hover:bg-[#d4fc82] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            Simpan Sesi
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkoutBuilderModal;
