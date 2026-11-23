import type { PlanSession } from '../plans/schedule';

export const KIND_LABEL: Record<PlanSession['kind'], string> = {
  recovery: 'Easy / Recovery Run',
  speed: 'Speed Run',
  long: 'Long Run',
  race: 'Hari Lomba',
};

/** Garis kategori di tepi kiri kartu: Easy Volt Lime, Long Run sky, Speed/Race Hyper Coral. */
export const KIND_BORDER: Record<PlanSession['kind'], string> = {
  recovery: 'border-l-volt',
  long: 'border-l-sky-400',
  speed: 'border-l-coral',
  race: 'border-l-coral',
};
