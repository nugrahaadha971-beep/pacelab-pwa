import type { PlanSession } from '../plans/schedule';

export const KIND_LABEL: Record<PlanSession['kind'], string> = {
  recovery: 'Easy / Recovery Run',
  speed: 'Speed Run',
  long: 'Long Run',
  race: 'Hari Lomba',
};

/** Garis kategori di tepi kiri kartu: Easy Electric Lime, Long Run Cyan, Speed Rose, Race Amber. */
export const KIND_BORDER: Record<PlanSession['kind'], string> = {
  recovery: 'border-l-[#BEF264]',
  long: 'border-l-sky-400',
  speed: 'border-l-rose-500',
  race: 'border-l-amber-400',
};
