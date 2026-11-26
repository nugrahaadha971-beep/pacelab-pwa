import { calcHrZonePresetRange, HR_ZONE_PRESETS } from './hrZones.ts';
import type { HrZoneNumber } from './hrZones.ts';
import type { SessionKind } from './nike5k.ts';
import { fmtPace } from './pace.ts';

export type WorkoutStepKind = 'warmup' | 'run' | 'recover' | 'cooldown';
export type WorkoutDurationType = 'time' | 'distance' | 'open';
export type WorkoutTargetType = 'hr_zone' | 'custom_hr' | 'pace' | 'none';

export interface SingleStep {
  id: string;
  kind: WorkoutStepKind;
  durationType: WorkoutDurationType;
  /** Detik jika durationType === 'time', meter jika durationType === 'distance'. */
  durationValue?: number;
  targetType: WorkoutTargetType;
  hrZone?: HrZoneNumber;
  hrRange?: [number, number];
  /** Detik per km [cepat, lambat]. */
  paceRange?: [number, number];
  note?: string;
}

export interface RepeatBlock {
  id: string;
  type: 'repeat';
  count: number;
  steps: SingleStep[];
}

export type WorkoutBlock = SingleStep | RepeatBlock;

export const isRepeatBlock = (block: WorkoutBlock): block is RepeatBlock =>
  'type' in block && block.type === 'repeat';

export const STEP_KIND_ORDER: readonly WorkoutStepKind[] = [
  'warmup',
  'run',
  'recover',
  'cooldown',
];

export const STEP_KIND_LABEL: Record<WorkoutStepKind, string> = {
  warmup: 'Warm Up',
  run: 'Run',
  recover: 'Recover',
  cooldown: 'Cool Down',
};

/** Aksen tepi kiri kartu langkah (Warm Up coral, Run biru, Recover abu-abu, Cool Down hijau). */
export const STEP_KIND_BORDER: Record<WorkoutStepKind, string> = {
  warmup: 'border-l-rose-400',
  run: 'border-l-sky-400',
  recover: 'border-l-zinc-500',
  cooldown: 'border-l-emerald-400',
};

/** Warna batang mini profil latihan. */
export const STEP_KIND_BAR: Record<WorkoutStepKind, string> = {
  warmup: 'bg-rose-400',
  run: 'bg-sky-400',
  recover: 'bg-zinc-500',
  cooldown: 'bg-emerald-400',
};

export const STEP_KIND_TEXT: Record<WorkoutStepKind, string> = {
  warmup: 'text-rose-300',
  run: 'text-sky-300',
  recover: 'text-zinc-300',
  cooldown: 'text-emerald-300',
};

const VALID_STEP_KINDS: readonly WorkoutStepKind[] = ['warmup', 'run', 'recover', 'cooldown'];
const VALID_DURATION_TYPES: readonly WorkoutDurationType[] = ['time', 'distance', 'open'];
const VALID_TARGET_TYPES: readonly WorkoutTargetType[] = ['hr_zone', 'custom_hr', 'pace', 'none'];
const VALID_HR_ZONES: readonly HrZoneNumber[] = [1, 2, 3, 4, 5];

let stepSeq = 0;

export function makeStepId(prefix = 'step'): string {
  stepSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${stepSeq}`;
}

export function createDefaultStep(kind: WorkoutStepKind = 'run'): SingleStep {
  if (kind === 'warmup') {
    return {
      id: makeStepId('wu'),
      kind: 'warmup',
      durationType: 'time',
      durationValue: 600,
      targetType: 'hr_zone',
      hrZone: 2,
    };
  }
  if (kind === 'recover') {
    return {
      id: makeStepId('rec'),
      kind: 'recover',
      durationType: 'time',
      durationValue: 180,
      targetType: 'hr_zone',
      hrZone: 2,
    };
  }
  if (kind === 'cooldown') {
    return {
      id: makeStepId('cd'),
      kind: 'cooldown',
      durationType: 'time',
      durationValue: 300,
      targetType: 'hr_zone',
      hrZone: 1,
    };
  }
  return {
    id: makeStepId('run'),
    kind: 'run',
    durationType: 'time',
    durationValue: 1200,
    targetType: 'hr_zone',
    hrZone: 2,
  };
}

export function createDefaultRepeatBlock(): RepeatBlock {
  return {
    id: makeStepId('rep'),
    type: 'repeat',
    count: 4,
    steps: [
      {
        id: makeStepId('run'),
        kind: 'run',
        durationType: 'time',
        durationValue: 240,
        targetType: 'hr_zone',
        hrZone: 4,
      },
      {
        id: makeStepId('rec'),
        kind: 'recover',
        durationType: 'time',
        durationValue: 180,
        targetType: 'hr_zone',
        hrZone: 2,
      },
    ],
  };
}

function normalizeSingleStep(raw: unknown): SingleStep | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !VALID_STEP_KINDS.includes(r.kind as WorkoutStepKind)) {
    return null;
  }
  if (
    typeof r.durationType !== 'string' ||
    !VALID_DURATION_TYPES.includes(r.durationType as WorkoutDurationType)
  ) {
    return null;
  }
  if (
    typeof r.targetType !== 'string' ||
    !VALID_TARGET_TYPES.includes(r.targetType as WorkoutTargetType)
  ) {
    return null;
  }

  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : makeStepId('st');
  const durationType = r.durationType as WorkoutDurationType;
  const durationValue =
    durationType !== 'open' &&
    typeof r.durationValue === 'number' &&
    Number.isFinite(r.durationValue) &&
    r.durationValue > 0
      ? Math.round(r.durationValue)
      : undefined;

  if (durationType !== 'open' && durationValue == null) return null;

  const targetType = r.targetType as WorkoutTargetType;
  const hrZone =
    typeof r.hrZone === 'number' && VALID_HR_ZONES.includes(r.hrZone as HrZoneNumber)
      ? (r.hrZone as HrZoneNumber)
      : undefined;

  let hrRange: [number, number] | undefined;
  if (
    Array.isArray(r.hrRange) &&
    r.hrRange.length === 2 &&
    typeof r.hrRange[0] === 'number' &&
    typeof r.hrRange[1] === 'number' &&
    Number.isFinite(r.hrRange[0]) &&
    Number.isFinite(r.hrRange[1]) &&
    r.hrRange[0] > 0 &&
    r.hrRange[1] >= r.hrRange[0]
  ) {
    hrRange = [Math.round(r.hrRange[0]), Math.round(r.hrRange[1])];
  }

  let paceRange: [number, number] | undefined;
  if (
    Array.isArray(r.paceRange) &&
    r.paceRange.length === 2 &&
    typeof r.paceRange[0] === 'number' &&
    typeof r.paceRange[1] === 'number' &&
    Number.isFinite(r.paceRange[0]) &&
    Number.isFinite(r.paceRange[1]) &&
    r.paceRange[0] > 0 &&
    r.paceRange[1] > 0
  ) {
    const a = Math.round(r.paceRange[0]);
    const b = Math.round(r.paceRange[1]);
    paceRange = [Math.min(a, b), Math.max(a, b)];
  }

  const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined;

  return {
    id,
    kind: r.kind as WorkoutStepKind,
    durationType,
    ...(durationValue != null ? { durationValue } : {}),
    targetType,
    ...(targetType === 'hr_zone' && hrZone ? { hrZone } : {}),
    ...(targetType === 'custom_hr' && hrRange ? { hrRange } : {}),
    ...(targetType === 'pace' && paceRange ? { paceRange } : {}),
    ...(note ? { note } : {}),
  };
}

export function normalizeStructuredSteps(raw: unknown): WorkoutBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WorkoutBlock[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (rec.type === 'repeat') {
      const steps = Array.isArray(rec.steps)
        ? rec.steps.map(normalizeSingleStep).filter((s): s is SingleStep => s !== null)
        : [];
      if (steps.length === 0) continue;
      const count =
        typeof rec.count === 'number' && Number.isFinite(rec.count)
          ? Math.max(1, Math.min(50, Math.round(rec.count)))
          : 1;
      out.push({
        id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : makeStepId('rep'),
        type: 'repeat',
        count,
        steps,
      });
    } else {
      const step = normalizeSingleStep(item);
      if (step) out.push(step);
    }
  }
  return out.length > 0 ? out : undefined;
}

export function formatStepDuration(step: Pick<SingleStep, 'durationType' | 'durationValue'>): string {
  if (step.durationType === 'open') return 'Lap Button';
  const val = step.durationValue ?? 0;
  if (step.durationType === 'distance') {
    if (val >= 1000) {
      const km = val / 1000;
      const text = Number.isInteger(km) ? km.toFixed(1) : km.toFixed(val % 100 === 0 ? 1 : 2);
      return `${text} km`;
    }
    return `${Math.round(val)} m`;
  }
  const totalSec = Math.max(0, Math.round(val));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function resolveStepHrRange(
  step: SingleStep,
  maxHr?: number | null,
  restingHr?: number | null,
): [number, number] | null {
  if (step.targetType === 'custom_hr' && step.hrRange) {
    return step.hrRange;
  }
  if (step.targetType === 'hr_zone' && step.hrZone) {
    const res = calcHrZonePresetRange(step.hrZone, maxHr, restingHr);
    if (res) return [res.min, res.max];
    if (step.hrRange) return step.hrRange;
  }
  return null;
}

export function formatStepTarget(
  step: SingleStep,
  maxHr?: number | null,
  restingHr?: number | null,
): string | null {
  if (step.targetType === 'hr_zone') {
    const z = step.hrZone ?? 2;
    const bpm = resolveStepHrRange(step, maxHr, restingHr);
    return bpm ? `Zona ${z} · ${bpm[0]}–${bpm[1]} bpm` : `Zona ${z}`;
  }
  if (step.targetType === 'custom_hr' && step.hrRange) {
    return `${step.hrRange[0]}–${step.hrRange[1]} bpm`;
  }
  if (step.targetType === 'pace' && step.paceRange) {
    const [fast, slow] = step.paceRange;
    return fast === slow ? `${fmtPace(fast)} /km` : `${fmtPace(fast)}–${fmtPace(slow)} /km`;
  }
  return null;
}

export function formatStepCompactTarget(
  step: SingleStep,
  maxHr?: number | null,
  restingHr?: number | null,
): string | null {
  if (step.targetType === 'hr_zone') {
    const z = step.hrZone ?? 2;
    const bpm = resolveStepHrRange(step, maxHr, restingHr);
    return bpm ? `Z${z} (${bpm[0]}–${bpm[1]} bpm)` : `Z${z}`;
  }
  if (step.targetType === 'custom_hr' && step.hrRange) {
    return `${step.hrRange[0]}–${step.hrRange[1]} bpm`;
  }
  if (step.targetType === 'pace' && step.paceRange) {
    const [fast, slow] = step.paceRange;
    return fast === slow ? `${fmtPace(fast)} /km` : `${fmtPace(fast)}–${fmtPace(slow)} /km`;
  }
  return null;
}

function estimateStepPaceSec(step: SingleStep, referencePaceSecPerKm?: number | null): number {
  if (step.targetType === 'pace' && step.paceRange) {
    return (step.paceRange[0] + step.paceRange[1]) / 2;
  }
  const base =
    referencePaceSecPerKm && Number.isFinite(referencePaceSecPerKm) && referencePaceSecPerKm > 120
      ? referencePaceSecPerKm
      : 360;
  if (step.kind === 'recover' || step.kind === 'warmup' || step.kind === 'cooldown') {
    return Math.round(base * 1.04);
  }
  if (step.hrZone === 5) return Math.round(base * 0.78);
  if (step.hrZone === 4) return Math.round(base * 0.83);
  if (step.hrZone === 3) return Math.round(base * 0.9);
  return base;
}

function estimateStepRaw(
  step: SingleStep,
  referencePaceSecPerKm?: number | null,
): { sec: number; meters: number; isOpen: boolean } {
  if (step.durationType === 'open' || !step.durationValue || step.durationValue <= 0) {
    return { sec: 0, meters: 0, isOpen: step.durationType === 'open' };
  }
  const pace = estimateStepPaceSec(step, referencePaceSecPerKm);
  if (step.durationType === 'time') {
    const sec = step.durationValue;
    const meters = (sec / pace) * 1000;
    return { sec, meters, isOpen: false };
  }
  const meters = step.durationValue;
  const sec = (meters / 1000) * pace;
  return { sec, meters, isOpen: false };
}

export interface StructuredWorkoutTotals {
  durationMin: number | null;
  distanceKm: number | null;
  totalSec: number;
  hasOpenSteps: boolean;
  segmentCount: number;
}

export function estimateStructuredTotals(
  blocks: WorkoutBlock[],
  referencePaceSecPerKm?: number | null,
): StructuredWorkoutTotals {
  let totalSec = 0;
  let totalMeters = 0;
  let hasOpenSteps = false;
  let segmentCount = 0;

  for (const block of blocks) {
    if (isRepeatBlock(block)) {
      const count = Math.max(1, block.count);
      for (let i = 0; i < count; i++) {
        for (const st of block.steps) {
          const m = estimateStepRaw(st, referencePaceSecPerKm);
          totalSec += m.sec;
          totalMeters += m.meters;
          if (m.isOpen) hasOpenSteps = true;
          segmentCount += 1;
        }
      }
    } else {
      const m = estimateStepRaw(block, referencePaceSecPerKm);
      totalSec += m.sec;
      totalMeters += m.meters;
      if (m.isOpen) hasOpenSteps = true;
      segmentCount += 1;
    }
  }

  return {
    durationMin: totalSec > 0 ? Math.max(1, Math.round(totalSec / 60)) : null,
    distanceKm: totalMeters > 0 ? Math.round((totalMeters / 1000) * 10) / 10 : null,
    totalSec: Math.round(totalSec),
    hasOpenSteps,
    segmentCount,
  };
}

export interface WorkoutVisualSegment {
  id: string;
  kind: WorkoutStepKind;
  weightSec: number;
  intensityPct: number;
  label: string;
}

function stepIntensityPct(step: SingleStep): number {
  if (step.kind === 'warmup') return 45;
  if (step.kind === 'recover') return 32;
  if (step.kind === 'cooldown') return 36;
  if (step.targetType === 'hr_zone') {
    if (step.hrZone === 1) return 42;
    if (step.hrZone === 2) return 56;
    if (step.hrZone === 3) return 72;
    if (step.hrZone === 4) return 88;
    if (step.hrZone === 5) return 100;
  }
  if (step.targetType === 'pace') return 86;
  if (step.targetType === 'custom_hr' && step.hrRange) {
    return step.hrRange[1] >= 165 ? 90 : step.hrRange[1] >= 150 ? 72 : 56;
  }
  return 65;
}

export function buildWorkoutProfileBars(
  blocks: WorkoutBlock[],
  referencePaceSecPerKm?: number | null,
): WorkoutVisualSegment[] {
  const bars: WorkoutVisualSegment[] = [];

  const pushStep = (st: SingleStep, iterKey: string) => {
    const est = estimateStepRaw(st, referencePaceSecPerKm);
    const weightSec = Math.max(60, Math.round(est.sec > 0 ? est.sec : 180));
    bars.push({
      id: `${st.id}-${iterKey}`,
      kind: st.kind,
      weightSec,
      intensityPct: stepIntensityPct(st),
      label: `${STEP_KIND_LABEL[st.kind]} ${formatStepDuration(st)}`,
    });
  };

  blocks.forEach((block, bi) => {
    if (isRepeatBlock(block)) {
      const count = Math.max(1, block.count);
      for (let i = 0; i < count; i++) {
        block.steps.forEach((st, si) => pushStep(st, `b${bi}-r${i}-s${si}`));
      }
    } else {
      pushStep(block, `b${bi}`);
    }
  });

  return bars;
}

function singleStepLine(
  st: SingleStep,
  maxHr?: number | null,
  restingHr?: number | null,
  withColon = true,
): string {
  const label = STEP_KIND_LABEL[st.kind];
  const dur = formatStepDuration(st);
  const target = formatStepCompactTarget(st, maxHr, restingHr);
  const head = withColon ? `${label}: ${dur}` : `${label} ${dur}`;
  const withTarget = target ? `${head} · ${target}` : head;
  return st.note?.trim() ? `${withTarget} (${st.note.trim()})` : withTarget;
}

export function structuredStepsToLines(
  blocks: WorkoutBlock[],
  maxHr?: number | null,
  restingHr?: number | null,
): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (isRepeatBlock(block)) {
      const inner = block.steps
        .map((st) => singleStepLine(st, maxHr, restingHr, false))
        .join(' + ');
      if (inner) lines.push(`${block.count}x [${inner}]`);
    } else {
      lines.push(singleStepLine(block, maxHr, restingHr, true));
    }
  }
  return lines;
}

export function extractPrimaryTargets(
  blocks: WorkoutBlock[],
  maxHr?: number | null,
  restingHr?: number | null,
): { hr: [number, number] | null; pace: [number, number] | null } {
  const allSteps: SingleStep[] = [];
  for (const block of blocks) {
    if (isRepeatBlock(block)) allSteps.push(...block.steps);
    else allSteps.push(block);
  }

  const runSteps = allSteps.filter((s) => s.kind === 'run');
  const hrCandidates = (runSteps.length > 0 ? runSteps : allSteps)
    .map((s) => resolveStepHrRange(s, maxHr, restingHr))
    .filter((r): r is [number, number] => r !== null);

  let hr: [number, number] | null = null;
  if (hrCandidates.length > 0) {
    // Pilih rentang HR kerja utama dengan intensitas tertinggi
    hr = hrCandidates.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  }

  const paceCandidates = (runSteps.length > 0 ? runSteps : allSteps)
    .filter((s) => s.targetType === 'pace' && s.paceRange != null)
    .map((s) => s.paceRange as [number, number]);

  let pace: [number, number] | null = null;
  if (paceCandidates.length > 0) {
    pace = paceCandidates[0];
  }

  return { hr, pace };
}

export function summarizeStructuredWorkout(
  blocks: WorkoutBlock[],
  opts: {
    maxHr?: number | null;
    restingHr?: number | null;
    referencePaceSecPerKm?: number | null;
  },
): {
  durationMin: number | null;
  distanceKm: number | null;
  hr: [number, number] | null;
  pace: [number, number] | null;
  steps: string[];
  structuredSteps: WorkoutBlock[];
} {
  const normalized = normalizeStructuredSteps(blocks) ?? [];
  const totals = estimateStructuredTotals(normalized, opts.referencePaceSecPerKm);
  const targets = extractPrimaryTargets(normalized, opts.maxHr, opts.restingHr);
  const steps = structuredStepsToLines(normalized, opts.maxHr, opts.restingHr);

  return {
    durationMin: totals.durationMin,
    distanceKm: totals.distanceKm,
    hr: targets.hr,
    pace: targets.pace,
    steps,
    structuredSteps: normalized,
  };
}

export interface WorkoutPresetTemplate {
  id: string;
  label: string;
  name: string;
  kind: SessionKind;
  build: () => WorkoutBlock[];
}

export const WORKOUT_PRESETS: readonly WorkoutPresetTemplate[] = [
  {
    id: 'easy35',
    label: 'Easy Run 35m',
    name: 'Easy Run Zona 2',
    kind: 'recovery',
    build: () => [
      {
        id: makeStepId('wu'),
        kind: 'warmup',
        durationType: 'time',
        durationValue: 300,
        targetType: 'hr_zone',
        hrZone: 1,
      },
      {
        id: makeStepId('run'),
        kind: 'run',
        durationType: 'time',
        durationValue: 1500,
        targetType: 'hr_zone',
        hrZone: 2,
      },
      {
        id: makeStepId('cd'),
        kind: 'cooldown',
        durationType: 'time',
        durationValue: 300,
        targetType: 'hr_zone',
        hrZone: 1,
      },
    ],
  },
  {
    id: 'norwegian4x4',
    label: 'Norwegian 4×4',
    name: 'Norwegian 4×4',
    kind: 'speed',
    build: () => [
      {
        id: makeStepId('wu'),
        kind: 'warmup',
        durationType: 'time',
        durationValue: 600,
        targetType: 'hr_zone',
        hrZone: 2,
      },
      {
        id: makeStepId('rep'),
        type: 'repeat',
        count: 4,
        steps: [
          {
            id: makeStepId('run'),
            kind: 'run',
            durationType: 'time',
            durationValue: 240,
            targetType: 'hr_zone',
            hrZone: 4,
          },
          {
            id: makeStepId('rec'),
            kind: 'recover',
            durationType: 'time',
            durationValue: 180,
            targetType: 'hr_zone',
            hrZone: 2,
          },
        ],
      },
      {
        id: makeStepId('cd'),
        kind: 'cooldown',
        durationType: 'time',
        durationValue: 300,
        targetType: 'hr_zone',
        hrZone: 1,
      },
    ],
  },
  {
    id: 'long75',
    label: 'Long Run 75m',
    name: 'Long Run Aerobik',
    kind: 'long',
    build: () => [
      {
        id: makeStepId('wu'),
        kind: 'warmup',
        durationType: 'time',
        durationValue: 600,
        targetType: 'hr_zone',
        hrZone: 1,
      },
      {
        id: makeStepId('run'),
        kind: 'run',
        durationType: 'time',
        durationValue: 3600,
        targetType: 'hr_zone',
        hrZone: 2,
      },
      {
        id: makeStepId('cd'),
        kind: 'cooldown',
        durationType: 'time',
        durationValue: 300,
        targetType: 'hr_zone',
        hrZone: 1,
      },
    ],
  },
  {
    id: 'fartlek6x1',
    label: 'Fartlek 6×1m',
    name: 'Fartlek 6×1 Menit',
    kind: 'speed',
    build: () => [
      {
        id: makeStepId('wu'),
        kind: 'warmup',
        durationType: 'time',
        durationValue: 600,
        targetType: 'hr_zone',
        hrZone: 2,
      },
      {
        id: makeStepId('rep'),
        type: 'repeat',
        count: 6,
        steps: [
          {
            id: makeStepId('run'),
            kind: 'run',
            durationType: 'time',
            durationValue: 60,
            targetType: 'hr_zone',
            hrZone: 4,
          },
          {
            id: makeStepId('rec'),
            kind: 'recover',
            durationType: 'time',
            durationValue: 120,
            targetType: 'hr_zone',
            hrZone: 2,
          },
        ],
      },
      {
        id: makeStepId('cd'),
        kind: 'cooldown',
        durationType: 'time',
        durationValue: 300,
        targetType: 'hr_zone',
        hrZone: 1,
      },
    ],
  },
];

export function cloneBlocksWithFreshIds(blocks: WorkoutBlock[]): WorkoutBlock[] {
  return blocks.map((b) =>
    isRepeatBlock(b)
      ? {
          ...b,
          id: makeStepId('rep'),
          steps: b.steps.map((s) => ({ ...s, id: makeStepId(s.kind) })),
        }
      : { ...b, id: makeStepId(b.kind) },
  );
}

export function initialBlocksForSession(session?: {
  kind: SessionKind;
  durationMin?: number | null;
  distanceKm?: number | null;
  hr?: [number, number] | null;
  pace?: [number, number] | null;
  structuredSteps?: WorkoutBlock[];
}): WorkoutBlock[] {
  if (session?.structuredSteps && session.structuredSteps.length > 0) {
    return cloneBlocksWithFreshIds(session.structuredSteps);
  }
  if (session) {
    const durationType: WorkoutDurationType =
      session.durationMin && session.durationMin > 0
        ? 'time'
        : session.distanceKm && session.distanceKm > 0
          ? 'distance'
          : 'open';
    const durationValue =
      durationType === 'time'
        ? Math.round((session.durationMin as number) * 60)
        : durationType === 'distance'
          ? Math.round((session.distanceKm as number) * 1000)
          : undefined;

    const targetType: WorkoutTargetType = session.hr
      ? 'custom_hr'
      : session.pace
        ? 'pace'
        : 'hr_zone';

    return [
      {
        id: makeStepId('run'),
        kind: 'run',
        durationType,
        ...(durationValue != null ? { durationValue } : {}),
        targetType,
        ...(targetType === 'custom_hr' && session.hr ? { hrRange: [...session.hr] as [number, number] } : {}),
        ...(targetType === 'pace' && session.pace ? { paceRange: [...session.pace] as [number, number] } : {}),
        ...(targetType === 'hr_zone' ? { hrZone: session.kind === 'speed' ? 4 : 2 } : {}),
      },
    ];
  }
  return WORKOUT_PRESETS[0].build();
}

export function presetMetaForZone(zone: HrZoneNumber) {
  return HR_ZONE_PRESETS.find((z) => z.zone === zone) ?? HR_ZONE_PRESETS[1];
}
