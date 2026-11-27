# PACELAB (`pacelab-pwa`) — Refactor Tab Program & Garmin Workout Builder

Dokumen ini berisi seluruh kode dan spesifikasi integrasi untuk merombak tab **Program** dan modal **Input/Edit Sesi** menjadi alur **Week Strip + 2-Step Garmin Workout Builder** dengan perhitungan zona detak jantung Karvonen otomatis (`HRmax = 195 bpm`, `Resting HR = 58 bpm`).

---

## 1. Prompt Instruksi AI Coding Agent (Google AI Studio / Claude Code)

Gunakan prompt di bawah ini saat menempelkan kode ke AI Studio atau terminal coding agent agar perubahan terpasang secara konsisten:

```markdown
Tugas: Terapkan refactor tab **Program** dan modal **Input/Edit Sesi** pada `pacelab-pwa` menggunakan kode `src/plans/workoutTypes.ts` dan `src/components/WorkoutBuilderModal.tsx` di bawah ini:

1. **Integrasi Tipe Data (`src/plans/schedule.ts` & `src/plans/scheduleStore.ts`):**
   - Impor `WorkoutBlock` dari `./workoutTypes` dan tambahkan properti opsional `structuredSteps?: WorkoutBlock[]` pada interface `PlanSession`.
   - Pastikan normalizer dan storage Dexie.js tetap mempertahankan properti `structuredSteps` saat menyimpan/memuat sesi.

2. **Perombakan Tab Program (`src/components/Program.tsx` / `src/components/TrainingPlan.tsx`):**
   - Satukan tampilan tanpa sub-tab terpisah:
     - **Sticky Header:** Target lomba (`5K · 31 Jan 2027`), hitung mundur hari, dan referensi zona HR profil.
     - **Week Strip (Sen–Min):** Navigasi minggu `<` `>` dengan titik warna indikator sesi per hari; ketuk tanggal untuk memfilter hari tersebut atau tampilkan semua sesi minggu aktif.
     - **Aksi Mingguan:** Tombol **`✨ Isi Minggu AI`** (opsi kondisi: `Normal`, `Habis Shift Malam`, `Cuaca Panas/Lembap`) dan **`+ Tambah Sesi`** (membuka `<WorkoutBuilderModal />`).
   - Pada setiap kartu sesi, tampilkan badge zona HR (`Zona 2 · 140–154 bpm`) serta rincian blok `Repeat Nx` jika memiliki `structuredSteps`.
   - Pindahkan tombol **Evaluasi AI Hasil Program** ke tab **Analitik / Riwayat** agar tab Program fokus pada perencanaan jadwal.

3. **Verifikasi:**
   - Jalankan `npm run typecheck && npm test && npm run build` dan pastikan 0 error.
```

---

## 2. File 1: `src/plans/workoutTypes.ts`

Berisi definisi tipe langkah latihan terstruktur ala Garmin, kalkulator zona detak jantung metode Karvonen (% HRR), ringkasan otomatis durasi/jarak, dan 4 preset siap pakai (*Easy Run 35m*, *Norwegian 4×4*, *Fartlek 5×1m*, *Long Run 8 km*).

```ts
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

/** Hitung rentang bpm menggunakan metode Karvonen (% HRR) */
export function getZoneBpm(
  zone: 1 | 2 | 3 | 4 | 5,
  maxHr = 195,
  restingHr = 58
): [number, number] {
  const hrr = Math.max(40, maxHr - restingHr);
  const [low, high] = ZONE_PCT[zone];
  return [
    Math.round(restingHr + hrr * low),
    Math.round(restingHr + hrr * high),
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
  restingHr = 58
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

const STEP_LABELS: Record<StepKind, string> = {
  warmup: 'Warm Up',
  run: 'Run',
  recover: 'Recover',
  cooldown: 'Cool Down',
};

/** Konversi blok Garmin ke ringkasan sesi (durasi, jarak estimasi, langkah teks, & HR utama) */
export function summarizeWorkout(
  blocks: WorkoutBlock[],
  maxHr = 195,
  restingHr = 58,
  defaultPaceSecPerKm = 390 // 6:30/km estimasi
) {
  let totalSec = 0;
  let totalMeters = 0;
  const stepsText: string[] = [];
  let primaryHr: [number, number] | null = null;

  const processSingle = (s: SingleStep, mult = 1) => {
    if (s.durationType === 'time' && s.durationValue) {
      totalSec += s.durationValue * mult;
      totalMeters += ((s.durationValue / defaultPaceSecPerKm) * 1000) * mult;
    } else if (s.durationType === 'distance' && s.durationValue) {
      totalMeters += s.durationValue * mult;
      totalSec += ((s.durationValue / 1000) * defaultPaceSecPerKm) * mult;
    } else {
      totalSec += 300 * mult; // estimasi 5 menit untuk Lap Button
    }

    if (s.kind === 'run') {
      if (s.targetType === 'hr_zone' && s.hrZone) {
        const range = getZoneBpm(s.hrZone, maxHr, restingHr);
        primaryHr = primaryHr
          ? [Math.min(primaryHr[0], range[0]), Math.max(primaryHr[1], range[1])]
          : range;
      } else if (s.targetType === 'custom_hr' && s.hrRange) {
        primaryHr = s.hrRange;
      }
    }
  };

  for (const b of blocks) {
    if (b.type === 'step') {
      processSingle(b, 1);
      stepsText.push(
        `${STEP_LABELS[b.kind]}: ${formatDuration(b.durationType, b.durationValue)} · ${formatTarget(b, maxHr, restingHr)}`
      );
    } else {
      b.steps.forEach((sub) => processSingle(sub, b.count));
      const inner = b.steps
        .map(
          (sub) =>
            `${STEP_LABELS[sub.kind]} ${formatDuration(sub.durationType, sub.durationValue)} (${formatTarget(sub, maxHr, restingHr)})`
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
```

---

## 3. File 2: `src/components/WorkoutBuilderModal.tsx`

Komponen React Bottom Sheet 2-langkah (*Info & Preset* + *Builder ala Garmin*) lengkap dengan grafik batang intensitas, blok pengulangan (`Repeat Nx`), dan sub-editor inline.

```tsx
import React, { useMemo, useState } from 'react';
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
  restingHr?: number;
  onClose: () => void;
  onSave: (payload: {
    date: string;
    category: SessionCategory;
    title: string;
    durationMin: number;
    distanceKm: number;
    hrRange: [number, number];
    steps: string[];
    structuredSteps: WorkoutBlock[];
  }) => void;
}

const KIND_STYLE: Record<StepKind, { label: string; border: string; bar: string }> = {
  warmup: { label: 'Warm Up', border: 'border-l-rose-500', bar: 'bg-rose-500' },
  run: { label: 'Run', border: 'border-l-sky-400', bar: 'bg-sky-400' },
  recover: { label: 'Recover', border: 'border-l-zinc-400', bar: 'bg-zinc-400' },
  cooldown: { label: 'Cool Down', border: 'border-l-emerald-400', bar: 'bg-emerald-400' },
};

export const WorkoutBuilderModal: React.FC<Props> = ({
  isOpen,
  initialDate,
  initialData,
  maxHr = 195,
  restingHr = 58,
  onClose,
  onSave,
}) => {
  const [stepTab, setStepTab] = useState<1 | 2>(1);
  const [date, setDate] = useState(initialData?.date ?? initialDate);
  const [category, setCategory] = useState<SessionCategory>(initialData?.category ?? 'speed');
  const [title, setTitle] = useState(initialData?.title ?? 'Norwegian 4×4');
  const [blocks, setBlocks] = useState<WorkoutBlock[]>(
    initialData?.structuredSteps ?? WORKOUT_PRESETS.norwegian4x4.blocks
  );
  const [editingStepId, setEditingStepId] = useState<string | null>(null);

  const summary = useMemo(
    () => summarizeWorkout(blocks, maxHr, restingHr),
    [blocks, maxHr, restingHr]
  );

  if (!isOpen) return null;

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
      })
    );
  };

  const addSingleStep = () => {
    const id = `step-${Date.now()}`;
    setBlocks((prev) => [
      ...prev,
      { id, type: 'step', kind: 'run', durationType: 'time', durationValue: 300, targetType: 'hr_zone', hrZone: 2 },
    ]);
    setEditingStepId(id);
  };

  const addRepeatBlock = () => {
    setBlocks((prev) => [
      ...prev,
      {
        id: `rep-${Date.now()}`,
        type: 'repeat',
        count: 4,
        steps: [
          { id: `s1-${Date.now()}`, type: 'step', kind: 'run', durationType: 'time', durationValue: 240, targetType: 'hr_zone', hrZone: 4 },
          { id: `s2-${Date.now()}`, type: 'step', kind: 'recover', durationType: 'time', durationValue: 180, targetType: 'hr_zone', hrZone: 2 },
        ],
      },
    ]);
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const flatBars = blocks.flatMap((b) =>
    b.type === 'step' ? [b] : Array.from({ length: b.count }, () => b.steps).flat()
  );

  const renderStepCard = (step: SingleStep, deletable = true) => {
    const isEditing = editingStepId === step.id;
    const style = KIND_STYLE[step.kind];

    return (
      <div
        key={step.id}
        className={`rounded-xl bg-zinc-900 border border-zinc-800 border-l-4 ${style.border} p-3 space-y-2`}
      >
        <div
          onClick={() => setEditingStepId(isEditing ? null : step.id)}
          className="flex items-center justify-between cursor-pointer"
        >
          <div>
            <div className="text-xs font-semibold text-zinc-200">{style.label}</div>
            <div className="text-[11px] text-zinc-400">
              {formatDuration(step.durationType, step.durationValue)} ·{' '}
              <span className="text-lime-400">{formatTarget(step, maxHr, restingHr)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span>{isEditing ? 'Tutup' : 'Ubah'}</span>
            {deletable && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBlock(step.id);
                }}
                className="text-rose-400 px-1"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {isEditing && (
          <div className="pt-2 border-t border-zinc-800 grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1">
              <span className="text-zinc-400">Jenis</span>
              <select
                value={step.kind}
                onChange={(e) => updateStep(step.id, { kind: e.target.value as StepKind })}
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 p-1.5 text-zinc-100"
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
                onChange={(e) =>
                  updateStep(step.id, {
                    durationType: e.target.value as DurationType,
                    durationValue: e.target.value === 'distance' ? 1000 : 300,
                  })
                }
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 p-1.5 text-zinc-100"
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
                  value={
                    step.durationType === 'time'
                      ? Math.round((step.durationValue ?? 60) / 60)
                      : step.durationValue ?? 1000
                  }
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value));
                    updateStep(step.id, {
                      durationValue: step.durationType === 'time' ? val * 60 : val,
                    });
                  }}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-700 p-1.5 text-zinc-100"
                />
              </label>
            )}

            <label className="space-y-1">
              <span className="text-zinc-400">Target</span>
              <select
                value={step.targetType}
                onChange={(e) =>
                  updateStep(step.id, {
                    targetType: e.target.value as TargetType,
                    hrZone: 2,
                    hrRange: [166, 185],
                  })
                }
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 p-1.5 text-zinc-100"
              >
                <option value="hr_zone">Zona HR (Z1–Z5)</option>
                <option value="custom_hr">Custom HR (bpm)</option>
                <option value="none">Tanpa Target</option>
              </select>
            </label>

            {step.targetType === 'hr_zone' && (
              <div className="col-span-2 flex gap-1.5 pt-1">
                {([1, 2, 3, 4, 5] as const).map((z) => {
                  const [min, max] = getZoneBpm(z, maxHr, restingHr);
                  return (
                    <button
                      key={z}
                      type="button"
                      onClick={() => updateStep(step.id, { hrZone: z })}
                      className={`flex-1 py-1.5 rounded-lg border text-[11px] font-medium ${
                        step.hrZone === z
                          ? 'bg-lime-400 text-zinc-950 border-lime-400'
                          : 'bg-zinc-950 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      Z{z}
                      <span className="block text-[9px] opacity-80">
                        {min}-{max}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {step.targetType === 'custom_hr' && (
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="HR Min"
                  value={step.hrRange?.[0] ?? 165}
                  onChange={(e) =>
                    updateStep(step.id, {
                      hrRange: [Number(e.target.value), step.hrRange?.[1] ?? 185],
                    })
                  }
                  className="rounded-lg bg-zinc-950 border border-zinc-700 p-1.5 text-zinc-100"
                />
                <input
                  type="number"
                  placeholder="HR Maks"
                  value={step.hrRange?.[1] ?? 185}
                  onChange={(e) =>
                    updateStep(step.id, {
                      hrRange: [step.hrRange?.[0] ?? 165, Number(e.target.value)],
                    })
                  }
                  className="rounded-lg bg-zinc-950 border border-zinc-700 p-1.5 text-zinc-100"
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-end justify-center">
      <div className="w-full max-w-md max-h-[90vh] flex flex-col rounded-t-2xl bg-zinc-950 border-t border-zinc-800 text-zinc-100">
        {/* Header & Step Switcher */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">Input Sesi Program</h3>
            <p className="text-[11px] text-zinc-400">
              Estimasi: {summary.durationMin} mnt · ~{summary.distanceKm} km · {summary.hrRange[0]}–{summary.hrRange[1]} bpm
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 text-sm px-2 py-1">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-2 bg-zinc-900/60 border-b border-zinc-800 text-xs">
          <button
            type="button"
            onClick={() => setStepTab(1)}
            className={`py-1.5 rounded-lg font-medium ${stepTab === 1 ? 'bg-lime-400 text-zinc-950' : 'text-zinc-400'}`}
          >
            1. Info & Preset
          </button>
          <button
            type="button"
            onClick={() => setStepTab(2)}
            className={`py-1.5 rounded-lg font-medium ${stepTab === 2 ? 'bg-lime-400 text-zinc-950' : 'text-zinc-400'}`}
          >
            2. Builder ala Garmin
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {stepTab === 1 ? (
            <>
              <div>
                <div className="text-xs text-zinc-400 mb-1.5">Isi Cepat Preset</div>
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
                      className="text-left text-xs p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-lime-400"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="text-zinc-400">Tanggal Sesi</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-800 p-2.5 text-zinc-100"
                />
              </label>

              <div className="space-y-1 text-xs">
                <span className="text-zinc-400">Kategori Sesi</span>
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
                      onClick={() => setCategory(val)}
                      className={`py-2 rounded-xl border font-medium ${
                        category === val
                          ? 'bg-lime-400 text-zinc-950 border-lime-400'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="text-zinc-400">Nama Sesi</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-800 p-2.5 text-zinc-100"
                />
              </label>
            </>
          ) : (
            <>
              {/* Workout Profile Bar */}
              <div className="h-6 w-full rounded-lg bg-zinc-900 p-1 flex items-end gap-0.5">
                {flatBars.map((s, idx) => {
                  const h =
                    s.kind === 'run' && (s.hrZone === 4 || s.hrZone === 5 || s.targetType === 'custom_hr')
                      ? 'h-full'
                      : s.kind === 'run'
                      ? 'h-3/4'
                      : 'h-2/5';
                  return (
                    <div
                      key={`${s.id}-${idx}`}
                      style={{ flexGrow: s.durationValue ?? 180 }}
                      className={`${h} ${KIND_STYLE[s.kind].bar} rounded-sm transition-all`}
                    />
                  );
                })}
              </div>

              {/* Steps & Repeat Blocks */}
              <div className="space-y-2.5">
                {blocks.map((block) =>
                  block.type === 'step' ? (
                    renderStepCard(block, true)
                  ) : (
                    <div
                      key={block.id}
                      className="rounded-xl border border-zinc-700 bg-zinc-900/40 p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sky-400">Repeat {block.count}×</span>
                          <button
                            type="button"
                            onClick={() =>
                              setBlocks((prev) =>
                                prev.map((b) =>
                                  b.id === block.id && b.type === 'repeat'
                                    ? { ...b, count: Math.max(2, b.count - 1) }
                                    : b
                                )
                              )
                            }
                            className="px-2 py-0.5 rounded bg-zinc-800"
                          >
                            -
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setBlocks((prev) =>
                                prev.map((b) =>
                                  b.id === block.id && b.type === 'repeat'
                                    ? { ...b, count: b.count + 1 }
                                    : b
                                )
                              )
                            }
                            className="px-2 py-0.5 rounded bg-zinc-800"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeBlock(block.id)}
                          className="text-rose-400 text-xs"
                        >
                          Hapus Blok
                        </button>
                      </div>
                      <div className="space-y-2 pl-2 border-l-2 border-sky-500/40">
                        {block.steps.map((sub) => renderStepCard(sub, false))}
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={addSingleStep}
                  className="py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-xs font-medium"
                >
                  + Tambah Langkah
                </button>
                <button
                  type="button"
                  onClick={addRepeatBlock}
                  className="py-2 rounded-xl border border-sky-500/40 bg-sky-500/10 text-sky-300 text-xs font-medium"
                >
                  + Tambah Repeat
                </button>
              </div>
            </>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="p-4 border-t border-zinc-800 flex gap-2 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-zinc-900 text-xs font-semibold text-zinc-300"
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
                steps: summary.steps,
                structuredSteps: blocks,
              });
              onClose();
            }}
            className="flex-1 py-2.5 rounded-xl bg-lime-400 text-xs font-bold text-zinc-950"
          >
            Simpan Sesi
          </button>
        </div>
      </div>
    </div>
  );
};
```

---

## 4. File 3: `src/components/WeekStrip.tsx` (Komponen Kalender Horizontal)

Komponen kalender mingguan horizontal 7 hari (`Sen–Min`) dengan titik indikator warna per kategori latihan untuk menggantikan dropdown minggu lama di tab Program.

```tsx
import React from 'react';
import { SessionCategory } from '../plans/workoutTypes';

export interface WeekSessionDot {
  id: string;
  date: string; // YYYY-MM-DD
  category: SessionCategory;
}

interface WeekStripProps {
  weekStartIso: string; // Senin minggu aktif (YYYY-MM-DD)
  selectedDate: string | null;
  sessions: WeekSessionDot[];
  onSelectDate: (iso: string | null) => void;
  onShiftWeek: (delta: -1 | 1) => void;
}

const DAYS_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const DOT_COLOR: Record<SessionCategory, string> = {
  easy: 'bg-emerald-400',
  long: 'bg-purple-400',
  speed: 'bg-sky-400',
  race: 'bg-amber-400',
};

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const WeekStrip: React.FC<WeekStripProps> = ({
  weekStartIso,
  selectedDate,
  sessions,
  onSelectDate,
  onShiftWeek,
}) => {
  const start = parseIso(weekStartIso);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { dateObj: d, iso: toIso(d) };
  });

  const end = days[6].dateObj;
  const rangeLabel = `${start.getDate()} ${MONTHS_ID[start.getMonth()]} – ${end.getDate()} ${MONTHS_ID[end.getMonth()]} ${end.getFullYear()}`;
  const todayIso = toIso(new Date());

  return (
    <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onShiftWeek(-1)}
          className="w-8 h-8 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300 flex items-center justify-center"
          aria-label="Minggu sebelumnya"
        >
          ‹
        </button>
        <div className="text-xs font-bold text-zinc-100">{rangeLabel}</div>
        <button
          type="button"
          onClick={() => onShiftWeek(1)}
          className="w-8 h-8 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300 flex items-center justify-center"
          aria-label="Minggu berikutnya"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map(({ dateObj, iso }) => {
          const dayDots = sessions.filter((s) => s.date === iso);
          const isSelected = selectedDate === iso;
          const isToday = iso === todayIso;

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(isSelected ? null : iso)}
              className={`flex flex-col items-center py-2 rounded-xl border transition ${
                isSelected
                  ? 'bg-lime-400/15 border-lime-400 text-white'
                  : isToday
                  ? 'bg-zinc-800/80 border-zinc-600 text-zinc-100'
                  : 'bg-zinc-950 border-zinc-800/80 text-zinc-400'
              }`}
            >
              <span className={`text-[10px] ${isToday ? 'text-lime-400 font-bold' : ''}`}>
                {DAYS_ID[dateObj.getDay()]}
              </span>
              <span className="text-xs font-extrabold my-0.5 text-zinc-100">
                {dateObj.getDate()}
              </span>
              <div className="flex items-center gap-0.5 h-1.5">
                {dayDots.map((dot) => (
                  <span
                    key={dot.id}
                    className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[dot.category]}`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-[11px]">
          <span className="text-zinc-400">Menampilkan tanggal terpilih</span>
          <button
            type="button"
            onClick={() => onSelectDate(null)}
            className="text-lime-400 font-semibold underline"
          >
            Semua minggu ini
          </button>
        </div>
      )}
    </div>
  );
};
```