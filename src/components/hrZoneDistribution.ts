import type { Workout } from '../analytics/types.ts';

export type HrZoneIndex = 0 | 1 | 2 | 3 | 4;

export interface HrZoneMeta {
  index: HrZoneIndex;
  key: 'z1' | 'z2' | 'z3' | 'z4' | 'z5';
  code: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
  name: string;
  pctRangeLabel: string;
  color: string;
  textClass: string;
  badgeBgClass: string;
  onColorText: string;
}

/** Skala warna resmi HR Zone 1–5: Slate, Blue, Emerald, Amber, Rose. */
export const HR_ZONE_META: ReadonlyArray<HrZoneMeta> = [
  {
    index: 0,
    key: 'z1',
    code: 'Z1',
    name: 'Pemulihan',
    pctRangeLabel: '< 60% HRmaks',
    color: '#64748B',
    textClass: 'text-slate-300',
    badgeBgClass: 'bg-slate-500',
    onColorText: '#FFFFFF',
  },
  {
    index: 1,
    key: 'z2',
    code: 'Z2',
    name: 'Aerobik',
    pctRangeLabel: '60–70% HRmaks',
    color: '#3B82F6',
    textClass: 'text-blue-400',
    badgeBgClass: 'bg-blue-500',
    onColorText: '#FFFFFF',
  },
  {
    index: 2,
    key: 'z3',
    code: 'Z3',
    name: 'Tempo',
    pctRangeLabel: '70–80% HRmaks',
    color: '#10B981',
    textClass: 'text-emerald-400',
    badgeBgClass: 'bg-emerald-500',
    onColorText: '#09090B',
  },
  {
    index: 3,
    key: 'z4',
    code: 'Z4',
    name: 'Ambang',
    pctRangeLabel: '80–90% HRmaks',
    color: '#F59E0B',
    textClass: 'text-amber-400',
    badgeBgClass: 'bg-amber-500',
    onColorText: '#09090B',
  },
  {
    index: 4,
    key: 'z5',
    code: 'Z5',
    name: 'Maksimal',
    pctRangeLabel: '≥ 90% HRmaks',
    color: '#F43F5E',
    textClass: 'text-rose-400',
    badgeBgClass: 'bg-rose-500',
    onColorText: '#FFFFFF',
  },
] as const;

export interface HrZoneBucket extends HrZoneMeta {
  seconds: number;
  pct: number;
  exactPct: number;
  bpmRangeLabel: string | null;
}

export interface HrZoneDistributionSummary {
  zones: HrZoneBucket[];
  totalSeconds: number;
  measuredSessions: number;
  exactSessions: number;
  estimatedSessions: number;
  aerobicPct: number;
  highIntensityPct: number;
  dominantZone: HrZoneBucket | null;
}

/** Klasifikasikan HR ke indeks zona 0..4 mengikuti batas gpxParser (60/70/80/90% HRmaks). */
export function classifyHrZone(hr: number, maxHr: number): HrZoneIndex {
  const frac = hr / maxHr;
  if (frac < 0.6) return 0;
  if (frac < 0.7) return 1;
  if (frac < 0.8) return 2;
  if (frac < 0.9) return 3;
  return 4;
}

export function formatZoneBpmRange(index: HrZoneIndex, maxHr: number | null): string | null {
  if (!maxHr || maxHr <= 0 || !Number.isFinite(maxHr)) return null;
  const b60 = Math.round(0.6 * maxHr);
  const b70 = Math.round(0.7 * maxHr);
  const b80 = Math.round(0.8 * maxHr);
  const b90 = Math.round(0.9 * maxHr);
  switch (index) {
    case 0:
      return `< ${b60} bpm`;
    case 1:
      return `${b60}–${b70 - 1} bpm`;
    case 2:
      return `${b70}–${b80 - 1} bpm`;
    case 3:
      return `${b80}–${b90 - 1} bpm`;
    case 4:
      return `≥ ${b90} bpm`;
  }
}

/**
 * Hitung agregat distribusi zona HR (Z1–Z5) dari daftar sesi pada periode aktif.
 * Prioritas sumber per sesi:
 * 1. `w.hrZonePct` (aliran rekaman GPX / sensor per detik, dibobot durasi sesi)
 * 2. `w.laps` dengan `avgHr` (mis. impor .FIT) bila `maxHr` tersedia
 * 3. `w.avgHr` sesi bila `maxHr` tersedia
 */
export function aggregateHrZones(
  workouts: ReadonlyArray<Workout>,
  maxHr: number | null,
): HrZoneDistributionSummary {
  const zoneSec: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let measuredSessions = 0;
  let exactSessions = 0;
  let estimatedSessions = 0;

  for (const w of workouts) {
    if (!(w.durationSec > 0)) continue;

    if (w.hrZonePct && w.hrZonePct.length === 5) {
      const pctSum = w.hrZonePct[0] + w.hrZonePct[1] + w.hrZonePct[2] + w.hrZonePct[3] + w.hrZonePct[4];
      if (pctSum > 0) {
        for (let i = 0; i < 5; i++) {
          zoneSec[i] += w.durationSec * (w.hrZonePct[i] / pctSum);
        }
        measuredSessions++;
        exactSessions++;
        continue;
      }
    }

    if (maxHr != null && maxHr > 0) {
      const hrLaps = w.laps.filter((l) => l.avgHr != null && l.avgHr > 0 && l.paceSec > 0);
      if (hrLaps.length > 0) {
        const lapWeightSum = hrLaps.reduce((s, l) => s + l.paceSec, 0);
        if (lapWeightSum > 0) {
          for (const lap of hrLaps) {
            const idx = classifyHrZone(lap.avgHr!, maxHr);
            zoneSec[idx] += w.durationSec * (lap.paceSec / lapWeightSum);
          }
          measuredSessions++;
          estimatedSessions++;
          continue;
        }
      }

      if (w.avgHr != null && w.avgHr > 0) {
        const idx = classifyHrZone(w.avgHr, maxHr);
        zoneSec[idx] += w.durationSec;
        measuredSessions++;
        estimatedSessions++;
      }
    }
  }

  const totalSeconds = zoneSec[0] + zoneSec[1] + zoneSec[2] + zoneSec[3] + zoneSec[4];
  const roundedPcts: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  if (totalSeconds > 0) {
    for (let i = 0; i < 5; i++) {
      roundedPcts[i] = Math.round((zoneSec[i] / totalSeconds) * 100);
    }
    const diff = 100 - (roundedPcts[0] + roundedPcts[1] + roundedPcts[2] + roundedPcts[3] + roundedPcts[4]);
    if (diff !== 0) {
      let maxIdx = 0;
      for (let i = 1; i < 5; i++) {
        if (zoneSec[i] > zoneSec[maxIdx]) maxIdx = i;
      }
      roundedPcts[maxIdx] = Math.max(0, roundedPcts[maxIdx] + diff);
    }
  }

  const zones: HrZoneBucket[] = HR_ZONE_META.map((meta, i) => ({
    ...meta,
    seconds: zoneSec[i],
    pct: roundedPcts[i],
    exactPct: totalSeconds > 0 ? (zoneSec[i] / totalSeconds) * 100 : 0,
    bpmRangeLabel: formatZoneBpmRange(meta.index, maxHr),
  }));

  const dominantZone =
    totalSeconds > 0
      ? zones.reduce((best, cur) => (cur.seconds > best.seconds ? cur : best), zones[0])
      : null;

  return {
    zones,
    totalSeconds,
    measuredSessions,
    exactSessions,
    estimatedSessions,
    aerobicPct: roundedPcts[0] + roundedPcts[1],
    highIntensityPct: roundedPcts[3] + roundedPcts[4],
    dominantZone,
  };
}

export function formatZoneDuration(seconds: number): string {
  if (seconds <= 0) return '0 mnt';
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 1) return '< 1 mnt';
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours === 0) return `${mins} mnt`;
  if (mins === 0) return `${hours}j`;
  return `${hours}j ${mins}m`;
}
