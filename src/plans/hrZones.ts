// Zona detak jantung berbasis HR maks & Resting HR (Karvonen HRR). Murni (tanpa UI).
import type { UserProfile, Workout } from '../analytics/types.ts';

export type Zone = 'easy' | 'interval' | 'race' | 'test' | 'maf';
export type HrZoneNumber = 1 | 2 | 3 | 4 | 5;

/** Lebar zona latihan MAF: dari HR MAF turun 10 bpm. */
export const MAF_BAND_BPM = 10;

/** Fraksi HR maks [bawah, atas]. easy/long 71–82%, interval 90–96%, race 90–95%. `test` (88–95%) adalah asumsi. */
export const HR_ZONES: Record<Exclude<Zone, 'maf'>, readonly [number, number]> = {
  easy: [0.71, 0.82],
  interval: [0.9, 0.96],
  race: [0.9, 0.95],
  test: [0.88, 0.95],
};

export const ZONE_LABEL: Record<Zone, string> = {
  easy: 'Zona 2',
  interval: 'Zona 4',
  race: 'Zona 4',
  test: 'Zona 4',
  maf: 'Zona MAF',
};

export interface HrZonePreset {
  zone: HrZoneNumber;
  code: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
  label: string;
  name: string;
  pctMin: number;
  pctMax: number;
  pctLabel: string;
}

export const HR_ZONE_PRESETS: readonly HrZonePreset[] = [
  { zone: 1, code: 'Z1', label: 'Zona 1', name: 'Pemulihan', pctMin: 0.5, pctMax: 0.6, pctLabel: '50–60%' },
  { zone: 2, code: 'Z2', label: 'Zona 2', name: 'Aerobik', pctMin: 0.6, pctMax: 0.7, pctLabel: '60–70%' },
  { zone: 3, code: 'Z3', label: 'Zona 3', name: 'Tempo', pctMin: 0.7, pctMax: 0.8, pctLabel: '70–80%' },
  { zone: 4, code: 'Z4', label: 'Zona 4', name: 'Ambang', pctMin: 0.8, pctMax: 0.9, pctLabel: '80–90%' },
  { zone: 5, code: 'Z5', label: 'Zona 5', name: 'Maksimal', pctMin: 0.9, pctMax: 1.0, pctLabel: '90–100%' },
] as const;

export const HR_FIRST_RULE =
  'Utamakan HR: jika HR melewati batas atas (misal cuaca panas), jalan kaki sebentar sampai HR turun—jangan paksa pace.';

/** Dibulatkan ke atas, mis. HR maks 182 → easy 130–150, interval 164–175. */
export function hrRange(zone: Zone, maxHr: number | null | undefined, mafHr?: number | null): [number, number] | null {
  // Zona MAF bersifat absolut (180 − usia ± penyesuaian), bukan persen HR maks.
  if (zone === 'maf') return mafHr && mafHr > 0 ? [mafHr - MAF_BAND_BPM, mafHr] : null;
  if (!maxHr || maxHr <= 0) return null;
  const [lo, hi] = HR_ZONES[zone];
  return [Math.ceil(lo * maxHr - 1e-9), Math.ceil(hi * maxHr - 1e-9)];
}

/** HR maks dari profil; bila kosong, HR tertinggi yang pernah terekam. */
export function resolveMaxHr(profile: Pick<UserProfile, 'maxHr'>, workouts: Workout[]): number | null {
  if (profile.maxHr > 0) return profile.maxHr;
  const seen = workouts.map((w) => w.maxHr ?? 0).filter((h) => h > 0);
  return seen.length ? Math.max(...seen) : null;
}

export interface HrZonePresetResult {
  min: number;
  max: number;
  method: 'hrr' | 'max';
  preset: HrZonePreset;
}

/**
 * Hitung rentang bpm preset Z1–Z5 memakai Karvonen (HRR = HRmaks − Resting HR)
 * bila Resting HR tersedia, atau % HRmaks bila Resting HR belum diisi.
 */
export function calcHrZonePresetRange(
  zoneNum: HrZoneNumber,
  maxHr: number | null | undefined,
  restingHr?: number | null,
): HrZonePresetResult | null {
  if (!maxHr || maxHr <= 0 || !Number.isFinite(maxHr)) return null;
  const preset = HR_ZONE_PRESETS.find((z) => z.zone === zoneNum);
  if (!preset) return null;

  if (restingHr != null && Number.isFinite(restingHr) && restingHr > 0 && maxHr > restingHr) {
    const hrr = maxHr - restingHr;
    return {
      min: Math.round(restingHr + preset.pctMin * hrr),
      max: Math.round(restingHr + preset.pctMax * hrr),
      method: 'hrr',
      preset,
    };
  }

  return {
    min: Math.round(preset.pctMin * maxHr),
    max: Math.round(preset.pctMax * maxHr),
    method: 'max',
    preset,
  };
}

/** Tentukan label zona (mis. "Zona 2", "Zona 4") dari rentang bpm dan profil HR pengguna. */
export function detectHrZoneLabel(
  hr: [number, number] | null | undefined,
  zone: Zone | undefined,
  maxHr: number | null | undefined,
  restingHr?: number | null,
): string | null {
  if (zone === 'maf') return 'Zona MAF';

  if (hr && maxHr && maxHr > 0 && Number.isFinite(maxHr)) {
    if (zone) {
      const auto = hrRange(zone, maxHr);
      if (auto && auto[0] === hr[0] && auto[1] === hr[1]) {
        return ZONE_LABEL[zone];
      }
    }

    const mid = (hr[0] + hr[1]) / 2;
    const useHrr = restingHr != null && Number.isFinite(restingHr) && restingHr > 0 && maxHr > restingHr;
    const frac = useHrr ? (mid - (restingHr as number)) / (maxHr - (restingHr as number)) : mid / maxHr;

    if (frac < 0.6) return 'Zona 1';
    if (frac < 0.7) return 'Zona 2';
    if (frac < 0.8) return 'Zona 3';
    if (frac < 0.9) return 'Zona 4';
    return 'Zona 5';
  }

  if (zone) return ZONE_LABEL[zone];
  if (hr) return 'Target HR';
  return null;
}

/** Format target HR kartu sesi beserta label zonanya, mis. "Zona 2 · 130–150 bpm". */
export function formatHrWithZone(
  hr: [number, number] | null | undefined,
  zone: Zone | undefined,
  maxHr: number | null | undefined,
  restingHr?: number | null,
): string | null {
  if (!hr) return null;
  const label = detectHrZoneLabel(hr, zone, maxHr, restingHr);
  const range = `${hr[0]}–${hr[1]} bpm`;
  return label ? `${label} · ${range}` : range;
}

export interface SpeedHrSegment {
  id: 'warmup' | 'work' | 'recovery' | 'cooldown';
  label: string;
  zoneCode: string;
  bpmText: string | null;
}

/** Target HR per segmen khusus sesi Speed / Interval di dalam Detail & atur sesi. */
export function speedHrSegments({
  sessionHr,
  maxHr,
  restingHr,
}: {
  sessionHr?: [number, number] | null;
  maxHr?: number | null;
  restingHr?: number | null;
}): SpeedHrSegment[] {
  const z1 = calcHrZonePresetRange(1, maxHr, restingHr);
  const z2 = calcHrZonePresetRange(2, maxHr, restingHr);
  const autoInterval = hrRange('interval', maxHr);
  const workRange = sessionHr ?? autoInterval;

  let workZoneCode = 'Z4–Z5';
  if (sessionHr && maxHr && maxHr > 0) {
    const detected = detectHrZoneLabel(sessionHr, undefined, maxHr, restingHr);
    if (detected === 'Zona 1' || detected === 'Zona 2' || detected === 'Zona 3') {
      workZoneCode = detected.replace('Zona ', 'Z');
    }
  }

  const restCap = z2 ? Math.round((z2.min + z2.max) / 2) : null;

  return [
    {
      id: 'warmup',
      label: 'Pemanasan',
      zoneCode: 'Z1–Z2',
      bpmText: z2 ? `< ${z2.max} bpm` : null,
    },
    {
      id: 'work',
      label: 'Interval Kerja',
      zoneCode: workZoneCode,
      bpmText: workRange ? `${workRange[0]}–${workRange[1]} bpm` : null,
    },
    {
      id: 'recovery',
      label: 'Istirahat',
      zoneCode: 'Z1–Z2',
      bpmText: restCap != null ? `< ${restCap} bpm` : null,
    },
    {
      id: 'cooldown',
      label: 'Pendinginan',
      zoneCode: 'Z1',
      bpmText: z1 ? `< ${z1.max} bpm` : null,
    },
  ];
}
