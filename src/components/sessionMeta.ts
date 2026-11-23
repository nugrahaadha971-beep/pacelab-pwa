import type { PlanSession } from '../plans/schedule';

export const KIND_LABEL: Record<PlanSession['kind'], string> = {
  recovery: 'Easy / Recovery Run',
  speed: 'Speed Run',
  long: 'Long Run',
  race: 'Hari Lomba',
};

/** Garis kategori di tepi kiri kartu: Easy sky, Long Run indigo, Speed/Tes/Lomba amber. Ditulis lengkap agar terdeteksi Tailwind. */
export const KIND_BORDER: Record<PlanSession['kind'], string> = {
  recovery: 'border-l-sky-400',
  long: 'border-l-indigo-400',
  speed: 'border-l-amber-400',
  race: 'border-l-amber-400',
};
