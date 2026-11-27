import type { SessionKind } from './nike5k.ts';

export type StepKind = 'warmup' | 'run' | 'recover' | 'cooldown';
export type DurationType = 'time' | 'distance' | 'open';
export type TargetType = 'hr_zone' | 'custom_hr' | 'pace' | 'none';
export type SessionCategory = 'easy' | 'long' | 'speed' | 'race';

export interface SingleStep {
  id: string;
  type: 'step';
  kind: StepKind;
  durationType: DurationType;
  /** Detik jika durationType === 'time', meter jika 'distance' */
  durationValue?: number;
  targetType: TargetType;
  hrZone?: 1 | 2 | 3 | 4 | 5;
  hrRange?: [number, number];
  /** Detik per km [min, max] */
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

const ZONE_PCT: Record<1 | 2 | 3 | 4 | 5, [number, number]> = {
  1: [0.5, 0.6],
  2: [0.6, 0.7],
  3: [0.7, 0.8],
  4: [0.8, 0.9],
  5: [0.9, 1.0],
};

/** Hitung rentang bpm menggunakan Karvonen (% HRR) atau % HRmaks bila restingHr null/tidak valid */
export function getZoneBpm(
  zone: 1 | 2 | 3 | 4 | 5,
  maxHr = 195,
  restingHr: number | null = 58,
): [number, number] {
  const safeMax = Number.isFinite(maxHr) && maxHr > 0 ? maxHr : 195;
  const [low, high] = ZONE_PCT[zone];
  if (restingHr != null && Number.isFinite(restingHr) && restingHr > 0 && restingHr < safeMax) {
    const hrr = safeMax - restingHr;
    return [
      Math.round(restingHr + hrr * low),
      Math.round(restingHr + hrr * high),
    ];
  }
  return [
    Math.round(safeMax * low),
    Math.round(safeMax * high),
  ];
}

export function formatDuration(type: DurationType, value = 0): string {
  if (type === 'open') return 'Tombol Lap';
  if (type === 'distance') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${value} m`;
  }
  const mins = Math.floor(value / 60);
  const secs = value % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatTarget(
  step: SingleStep,
  maxHr = 195,
  restingHr: number | null = 58,
): string {
  if (step.targetType === 'none') return 'Tanpa target';
  if (step.targetType === 'hr_zone' && step.hrZone) {
    const [min, max] = getZoneBpm(step.hrZone, maxHr, restingHr);
    return `Zona ${step.hrZone} · ${min}–${max} bpm`;
  }
  if (step.targetType === 'custom_hr' && step.hrRange) {
    return `${step.hrRange[0]}–${step.hrRange[1]} bpm`;
  }
  if (step.targetType === 'pace' && step.paceRange) {
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return `${fmt(step.paceRange[0])}–${fmt(step.paceRange[1])} /km`;
  }
  return 'Tanpa target';
}

export const STEP_LABELS: Record<StepKind, string> = {
  warmup: 'Warm Up',
  run: 'Run',
  recover: 'Recover',
  cooldown: 'Cool Down',
};

/** Konversi blok Garmin ke ringkasan sesi (durasi, jarak estimasi, langkah teks, & HR utama) */
export function summarizeWorkout(
  blocks: WorkoutBlock[],
  maxHr = 195,
  restingHr: number | null = 58,
  defaultPaceSecPerKm = 390, // 6:30/km estimasi
) {
  let totalSec = 0;
  let totalMeters = 0;
  const stepsText: string[] = [];
  let primaryHr: [number, number] | null = null;
  let primaryPace: [number, number] | null = null;

  const processSingle = (s: SingleStep, mult = 1) => {
    if (s.durationType === 'time' && s.durationValue) {
      totalSec += s.durationValue * mult;
      totalMeters += ((s.durationValue / defaultPaceSecPerKm) * 1000) * mult;
    } else if (s.durationType === 'distance' && s.durationValue) {
      totalMeters += s.durationValue * mult;
      totalSec += ((s.durationValue / 1000) * defaultPaceSecPerKm) * mult;
    } else {
      totalSec += 300 * mult; // estimasi 5 menit untuk Tombol Lap
    }

    if (s.kind === 'run') {
      if (s.targetType === 'hr_zone' && s.hrZone) {
        const range = getZoneBpm(s.hrZone, maxHr, restingHr);
        primaryHr = primaryHr
          ? [Math.min(primaryHr[0], range[0]), Math.max(primaryHr[1], range[1])]
          : range;
      } else if (s.targetType === 'custom_hr' && s.hrRange) {
        primaryHr = primaryHr
          ? [Math.min(primaryHr[0], s.hrRange[0]), Math.max(primaryHr[1], s.hrRange[1])]
          : s.hrRange;
      } else if (s.targetType === 'pace' && s.paceRange) {
        primaryPace = primaryPace
          ? [Math.min(primaryPace[0], s.paceRange[0]), Math.max(primaryPace[1], s.paceRange[1])]
          : s.paceRange;
      }
    }
  };

  for (const b of blocks) {
    if (b.type === 'step') {
      processSingle(b, 1);
      stepsText.push(
        `${STEP_LABELS[b.kind]}: ${formatDuration(b.durationType, b.durationValue)} · ${formatTarget(b, maxHr, restingHr)}`,
      );
    } else {
      b.steps.forEach((sub) => processSingle(sub, b.count));
      const inner = b.steps
        .map(
          (sub) =>
            `${STEP_LABELS[sub.kind]} ${formatDuration(sub.durationType, sub.durationValue)} (${formatTarget(sub, maxHr, restingHr)})`,
        )
        .join(' + ');
      stepsText.push(`${b.count}× [${inner}]`);
    }
  }

  return {
    durationMin: Math.max(1, Math.round(totalSec / 60)),
    distanceKm: Number((totalMeters / 1000).toFixed(1)),
    steps: stepsText,
    hrRange: primaryHr ?? getZoneBpm(2, maxHr, restingHr),
    paceRange: primaryPace,
  };
}

/** Preset 1-ketuk untuk modal Input Sesi */
export const WORKOUT_PRESETS: Record<
  'easy35' | 'norwegian4x4' | 'fartlek5x1' | 'long8k',
  { title: string; category: SessionCategory; blocks: WorkoutBlock[] }
> = {
  easy35: {
    title: 'Easy Run Aerobik',
    category: 'easy',
    blocks: [
      { id: 'w1', type: 'step', kind: 'warmup', durationType: 'time', durationValue: 300, targetType: 'hr_zone', hrZone: 1 },
      { id: 'r1', type: 'step', kind: 'run', durationType: 'time', durationValue: 1500, targetType: 'hr_zone', hrZone: 2 },
      { id: 'c1', type: 'step', kind: 'cooldown', durationType: 'time', durationValue: 300, targetType: 'hr_zone', hrZone: 1 },
    ],
  },
  norwegian4x4: {
    title: 'Norwegian 4×4',
    category: 'speed',
    blocks: [
      { id: 'w1', type: 'step', kind: 'warmup', durationType: 'time', durationValue: 600, targetType: 'hr_zone', hrZone: 2 },
      {
        id: 'rep1',
        type: 'repeat',
        count: 4,
        steps: [
          { id: 's1', type: 'step', kind: 'run', durationType: 'time', durationValue: 240, targetType: 'custom_hr', hrRange: [166, 185] },
          { id: 's2', type: 'step', kind: 'recover', durationType: 'time', durationValue: 180, targetType: 'hr_zone', hrZone: 2 },
        ],
      },
      { id: 'c1', type: 'step', kind: 'cooldown', durationType: 'open', targetType: 'hr_zone', hrZone: 1 },
    ],
  },
  fartlek5x1: {
    title: 'Fartlek Ringan 5×1m',
    category: 'speed',
    blocks: [
      { id: 'w1', type: 'step', kind: 'warmup', durationType: 'time', durationValue: 600, targetType: 'hr_zone', hrZone: 2 },
      {
        id: 'rep1',
        type: 'repeat',
        count: 5,
        steps: [
          { id: 's1', type: 'step', kind: 'run', durationType: 'time', durationValue: 60, targetType: 'hr_zone', hrZone: 4 },
          { id: 's2', type: 'step', kind: 'recover', durationType: 'time', durationValue: 120, targetType: 'hr_zone', hrZone: 1 },
        ],
      },
      { id: 'c1', type: 'step', kind: 'cooldown', durationType: 'time', durationValue: 300, targetType: 'hr_zone', hrZone: 1 },
    ],
  },
  long8k: {
    title: 'Long Run Akhir Pekan',
    category: 'long',
    blocks: [
      { id: 'r1', type: 'step', kind: 'run', durationType: 'distance', durationValue: 8000, targetType: 'hr_zone', hrZone: 2 },
    ],
  },
};

export function categoryToKind(category: SessionCategory): SessionKind {
  if (category === 'easy') return 'recovery';
  return category;
}

export function kindToCategory(kind: SessionKind): SessionCategory {
  if (kind === 'recovery') return 'easy';
  return kind;
}

const VALID_KINDS: readonly StepKind[] = ['warmup', 'run', 'recover', 'cooldown'];
const VALID_DURATIONS: readonly DurationType[] = ['time', 'distance', 'open'];
const VALID_TARGETS: readonly TargetType[] = ['hr_zone', 'custom_hr', 'pace', 'none'];

function normalizeSingleStep(raw: unknown): SingleStep | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'repeat') return null;

  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `step-${Math.random().toString(36).slice(2, 8)}`;
  const kind: StepKind =
    typeof r.kind === 'string' && VALID_KINDS.includes(r.kind as StepKind)
      ? (r.kind as StepKind)
      : 'run';
  const durationType: DurationType =
    typeof r.durationType === 'string' && VALID_DURATIONS.includes(r.durationType as DurationType)
      ? (r.durationType as DurationType)
      : 'time';
  const durationValue =
    durationType !== 'open' && typeof r.durationValue === 'number' && Number.isFinite(r.durationValue) && r.durationValue > 0
      ? Math.round(r.durationValue)
      : undefined;
  const targetType: TargetType =
    typeof r.targetType === 'string' && VALID_TARGETS.includes(r.targetType as TargetType)
      ? (r.targetType as TargetType)
      : 'none';

  let hrZone: 1 | 2 | 3 | 4 | 5 | undefined;
  if (targetType === 'hr_zone') {
    const z = typeof r.hrZone === 'number' && Number.isInteger(r.hrZone) ? r.hrZone : 2;
    hrZone = z >= 1 && z <= 5 ? (z as 1 | 2 | 3 | 4 | 5) : 2;
  }

  let hrRange: [number, number] | undefined;
  if (
    targetType === 'custom_hr' &&
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
    targetType === 'pace' &&
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
    type: 'step',
    kind,
    durationType,
    ...(durationValue !== undefined ? { durationValue } : {}),
    targetType,
    ...(hrZone !== undefined ? { hrZone } : {}),
    ...(hrRange !== undefined ? { hrRange } : {}),
    ...(paceRange !== undefined ? { paceRange } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

export function normalizeStructuredSteps(raw: unknown): WorkoutBlock[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: WorkoutBlock[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (obj.type === 'repeat') {
      const steps = Array.isArray(obj.steps)
        ? obj.steps.map(normalizeSingleStep).filter((s): s is SingleStep => s !== null)
        : [];
      if (steps.length === 0) continue;
      const count =
        typeof obj.count === 'number' && Number.isInteger(obj.count) && obj.count >= 2
          ? Math.min(30, obj.count)
          : 2;
      const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `rep-${out.length + 1}`;
      out.push({ id, type: 'repeat', count, steps });
    } else {
      const single = normalizeSingleStep(item);
      if (single) out.push(single);
    }
  }
  return out.length > 0 ? out : undefined;
}
