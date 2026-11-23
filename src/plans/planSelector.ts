// Mesin pemilih kurikulum terbaik. Murni (tanpa UI) agar bisa diuji dengan node:test.
import { cardiacDrift, DAY_MS } from '../analytics/workload.ts';
import type { UserProfile, Workout } from '../analytics/types.ts';
import type { CurriculumId } from './schedule.ts';

export type PlanMode = 'auto' | CurriculumId;
export const PLAN_MODES: readonly PlanMode[] = ['auto', 'progressive5k', 'nike5k', 'maf'];
export const PLAN_LABEL: Record<CurriculumId, string> = { progressive5k: 'Progresif 5K (Lari-Jalan + HR-First)', nike5k: 'Nike 5K (Kontinu Berbasis Pace)', maf: 'MAF (Maffetone): Fondasi Aerobik' };

export const SLOW_5K_SEC = 2400; // ≥ 40:00 → Progresif
export const MIN_WEEKLY_FREQ = 3; // < 3 sesi/minggu → Progresif
export const EASY_HR_LIMIT = 0.8; // > 80% HR maks → Progresif
export const DRIFT_LIMIT_PCT = 5; // > 5% → Progresif
export const FREQ_WINDOW_DAYS = 28;

export const normalizePlanMode = (raw: unknown): PlanMode => (PLAN_MODES as readonly unknown[]).includes(raw) ? (raw as PlanMode) : 'auto';

export interface SelectionMetrics {
  fiveKSec: number | null;
  weeklyFreq: number;
  easyHrPct: number | null; // avgHr / HR maks sesi Easy terakhir
  driftPct: number | null;
  easySessionIsFallback: boolean; // tidak ada sesi bertipe Easy → memakai sesi terakhir
}
export interface PlanSelection { plan: CurriculumId; reasons: string[]; metrics: SelectionMetrics }

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const dec1 = (x: number) => x.toFixed(1).replace('.', ',');

/** 5K terbaik: yang lebih cepat antara proyeksi Riegel (dari pemanggil) dan catatan 5K aktual (4,9–5,2 km, dinormalkan ke 5 km). */
export function best5kSec(workouts: Workout[], projectedSec: number | null | undefined): number | null {
  const actual = workouts
    .filter((w) => w.distanceKm >= 4.9 && w.distanceKm <= 5.2 && w.durationSec > 0)
    .map((w) => (w.durationSec * 5) / w.distanceKm);
  const all = [...actual, ...(projectedSec != null && projectedSec > 0 ? [projectedSec] : [])];
  return all.length ? Math.min(...all) : null;
}

/**
 * Pilih `progressive5k` bila SALAH SATU: 5K ≥ 40:00, frekuensi 28 hari < 3 sesi/minggu, atau sesi Easy terakhir
 * HR rata-rata > 80% HR maks / cardiac drift > 5%. `nike5k` hanya bila 5K < 40:00 DAN frekuensi ≥ 3 DAN HR stabil.
 * Data yang tidak ada (5K belum bisa diproyeksikan) tidak memenuhi syarat Nike → default aman ke Progresif.
 * Data HR yang tidak ada dianggap tidak melanggar batas.
 */
export function selectBestPlan(
  workouts: Workout[], profile: Pick<UserProfile, 'maxHr'>,
  opts: { now?: number; projected5kSec?: number | null } = {},
): PlanSelection {
  const now = opts.now ?? Date.now();
  const fiveKSec = best5kSec(workouts.filter((w) => w.date <= now), opts.projected5kSec);
  const recent = workouts.filter((w) => w.date <= now && now - w.date < FREQ_WINDOW_DAYS * DAY_MS);
  const weeklyFreq = recent.length / (FREQ_WINDOW_DAYS / 7);

  const past = workouts.filter((w) => w.date <= now).sort((a, b) => b.date - a.date);
  const lastEasyTyped = past.find((w) => w.workoutType === 'easy');
  const easy = lastEasyTyped ?? past[0] ?? null;
  const easyHrPct = easy && easy.avgHr != null && profile.maxHr > 0 ? easy.avgHr / profile.maxHr : null;
  const driftPct = easy ? cardiacDrift(easy.laps) : null;
  const metrics: SelectionMetrics = { fiveKSec, weeklyFreq, easyHrPct, driftPct, easySessionIsFallback: !!easy && !lastEasyTyped };

  const slow = fiveKSec != null && fiveKSec >= SLOW_5K_SEC;
  const lowFreq = weeklyFreq < MIN_WEEKLY_FREQ;
  const hrHigh = easyHrPct != null && easyHrPct > EASY_HR_LIMIT;
  const driftHigh = driftPct != null && driftPct > DRIFT_LIMIT_PCT;
  const sessionWord = metrics.easySessionIsFallback ? 'sesi terakhir (belum ada sesi bertipe Easy)' : 'sesi Easy terakhir';

  if (slow || lowFreq || hrHigh || driftHigh) {
    const reasons: string[] = [];
    if (slow) reasons.push(`Waktu 5K terbaik/proyeksi Anda ${mmss(fiveKSec as number)}, di atas batas 40:00. Lari-jalan membangun daya tahan tanpa lonjakan detak jantung.`);
    if (lowFreq) reasons.push(`Rata-rata ${dec1(weeklyFreq)} sesi/minggu dalam 28 hari terakhir (di bawah 3). Konsistensi masih dibangun, jadi mulai dari fondasi.`);
    if (hrHigh) reasons.push(`HR rata-rata ${sessionWord} ${Math.round(easy!.avgHr as number)} bpm = ${pct(easyHrPct as number)} HR maks (di atas 80%). Lari santai Anda masih terlalu berat untuk lari kontinu.`);
    if (driftHigh) reasons.push(`Cardiac drift ${sessionWord} ${dec1(driftPct as number)}% (di atas 5%). Tubuh belum stabil di zona aerobik.`);
    return { plan: 'progressive5k', reasons, metrics };
  }

  if (fiveKSec != null) {
    const reasons = [
      `Waktu 5K terbaik/proyeksi ${mmss(fiveKSec)} (di bawah 40:00).`,
      `Frekuensi ${dec1(weeklyFreq)} sesi/minggu (minimal 3).`,
      easyHrPct != null
        ? `HR ${sessionWord} ${pct(easyHrPct)} HR maks${driftPct != null ? `, drift ${dec1(driftPct)}%` : ''}: stabil di bawah 80%.`
        : 'Belum ada data HR sesi santai; dianggap stabil.',
    ];
    return { plan: 'nike5k', reasons, metrics };
  }
  return { plan: 'progressive5k', reasons: ['Data belum cukup untuk memproyeksikan 5K Anda (catat lari 3 km atau lebih). Dipilih jalur yang paling aman.'], metrics };
}

/** Mode "auto" mengikuti rekomendasi; mode manual menang. */
export const resolvePlan = (mode: PlanMode, sel: PlanSelection): CurriculumId => (mode === 'auto' ? sel.plan : mode);
