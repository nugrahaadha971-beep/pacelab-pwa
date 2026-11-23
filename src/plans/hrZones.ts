// Zona detak jantung berbasis HR maks. Murni (tanpa UI).
import type { UserProfile, Workout } from '../analytics/types.ts';

export type Zone = 'easy' | 'interval' | 'race' | 'test' | 'maf';

/** Lebar zona latihan MAF: dari HR MAF turun 10 bpm. */
export const MAF_BAND_BPM = 10;

/** Fraksi HR maks [bawah, atas]. easy/long 71–82%, interval 90–96%, race 90–95%. `test` (88–95%) adalah asumsi. */
export const HR_ZONES: Record<Exclude<Zone, 'maf'>, readonly [number, number]> = {
  easy: [0.71, 0.82],
  interval: [0.9, 0.96],
  race: [0.9, 0.95],
  test: [0.88, 0.95],
};

export const ZONE_LABEL: Record<Zone, string> = { easy: 'Zona mudah', interval: 'Zona interval', race: 'Zona race', test: 'Zona tes', maf: 'Zona MAF' };

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
