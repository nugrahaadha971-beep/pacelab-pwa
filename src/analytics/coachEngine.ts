import type { AcwrStatus } from './workload';
import type { WorkoutType } from './types';
import type { CurriculumId } from '../plans/schedule.ts';

export type SessionRec = 'easy' | 'tempo' | 'interval' | 'long_run' | 'recovery' | 'rest';

export interface CoachInput {
  acwrStatus: AcwrStatus;
  acwrRatio: number | null;
  efImproving: boolean;
  lastType: WorkoutType | null;
  daysSinceLast: number | null;
  lastDrift: number | null;
  /** Kurikulum aktif. Untuk 'maf', saran tidak pernah berupa Tempo/interval. */
  curriculum?: CurriculumId;
}

export interface CoachAdvice {
  headline: string;
  detail: string;
  session: SessionRec;
  durationAddMin: number;
  efNote: string | null;
}

/** ASUMSI: blueprint tidak menetapkan ambang cardiac drift. */
export const DRIFT_WARN_PCT = 5;
const HARD: WorkoutType[] = ['tempo', 'interval', 'race'];

/** Aturan 4.1 (EF) dan 4.2 (ACWR) dari blueprint. */
export function coachAdvice(i: CoachInput): CoachAdvice {
  const efNote = i.efImproving ? 'Kapasitas Aerobik Meningkat' : null;
  const hardRecently = i.lastType !== null && HARD.includes(i.lastType) && (i.daysSinceLast ?? Infinity) <= 1;
  const ratio = i.acwrRatio != null ? ` (ACWR ${i.acwrRatio.toFixed(2)})` : '';
  const drift = i.lastDrift != null && i.lastDrift > DRIFT_WARN_PCT
    ? ` Cardiac drift sesi terakhir ${i.lastDrift.toFixed(1)}%: jaga intensitas lebih rendah.` : '';
  // Program MAF: semua lari aerobik di zona HR MAF. Tidak ada saran Tempo; yang ditekankan adalah detak jantung, bukan pace.
  const maf = i.curriculum === 'maf';

  switch (i.acwrStatus) {
    case 'unknown':
      return { headline: 'Data belum cukup', detail: 'Catat beberapa sesi untuk mendapatkan saran.', session: 'easy', durationAddMin: 0, efNote };
    case 'high_fatigue':
      return { headline: `Kelelahan tinggi${ratio}`, detail: 'Sesi intensitas berikutnya diganti Recovery Run atau istirahat.' + drift,
        session: hardRecently ? 'rest' : 'recovery', durationAddMin: 0, efNote };
    case 'undertraining':
      if (maf) return { headline: `Beban rendah${ratio}`, detail: 'Tambah durasi lari aerobik di zona HR MAF, bukan kecepatan.' + drift,
        session: 'easy', durationAddMin: 10, efNote };
      return { headline: `Beban rendah${ratio}`, detail: 'Tambah durasi Easy Run atau tambahkan sesi Tempo untuk menjaga stimulus.' + drift,
        session: 'easy', durationAddMin: 10, efNote };
    case 'sweet_spot':
    default:
      if (maf) return { headline: `Beban optimal${ratio}`, detail: 'Lanjutkan lari aerobik di zona HR MAF; jangan kejar pace.' + drift,
        session: 'easy', durationAddMin: 0, efNote };
      return { headline: `Beban optimal${ratio}`, detail: 'Progres dilanjutkan.' + drift,
        session: hardRecently ? 'easy' : 'tempo', durationAddMin: 0, efNote };
  }
}
