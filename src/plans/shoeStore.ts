import type { Workout } from '../analytics/types.ts';
import { isoFromLocal, isValidIso } from './schedule.ts';

export const SHOE_KEY = 'pacelab_shoe';

export interface ShoeConfig {
  name: string;
  initialKm: number;
  maxKm: number;
  startDate?: string;
}

export type ShoeStatus = 'good' | 'warn' | 'replace';

export interface ShoeMileage {
  totalKm: number;
  remainingKm: number;
  pct: number;
  status: ShoeStatus;
}

export const DEFAULT_SHOE: ShoeConfig = {
  name: 'Sepatu Utama',
  initialKm: 0,
  maxKm: 800,
  startDate: '',
};

export const SHOE_STATUS_TEXT: Record<ShoeStatus, string> = {
  good: 'Bantalan sepatu masih nyaman dipakai lari',
  warn: 'Hampir waktunya ganti sepatu',
  replace: 'Bantalan sepatu sudah aus, pertimbangkan ganti baru',
};

export function normalizeShoeConfig(raw: unknown): ShoeConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SHOE };
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : DEFAULT_SHOE.name;
  const rawInitial = typeof r.initialKm === 'number' ? r.initialKm : Number(r.initialKm);
  const initialKm = Number.isFinite(rawInitial) && rawInitial >= 0 ? rawInitial : 0;
  const rawMax = typeof r.maxKm === 'number' ? r.maxKm : Number(r.maxKm);
  const maxKm = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : DEFAULT_SHOE.maxKm;
  const startDate = typeof r.startDate === 'string' && isValidIso(r.startDate.trim()) ? r.startDate.trim() : '';
  return { name, initialKm, maxKm, startDate };
}

export function loadShoeConfig(): ShoeConfig {
  try {
    const raw = localStorage.getItem(SHOE_KEY);
    if (!raw) return { ...DEFAULT_SHOE };
    return normalizeShoeConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SHOE };
  }
}

export function saveShoeConfig(shoe: ShoeConfig): ShoeConfig {
  const normalized = normalizeShoeConfig(shoe);
  try {
    localStorage.setItem(SHOE_KEY, JSON.stringify(normalized));
  } catch {
    /* penyimpanan tidak tersedia: abaikan */
  }
  return normalized;
}

export function calcShoeMileage(
  workouts: ReadonlyArray<Pick<Workout, 'date' | 'distanceKm'>>,
  shoe: ShoeConfig,
): ShoeMileage {
  const startIso = shoe.startDate && isValidIso(shoe.startDate.trim()) ? shoe.startDate.trim() : '';
  const initialKm = Number.isFinite(shoe.initialKm) && shoe.initialKm >= 0 ? shoe.initialKm : 0;
  const maxKm = Number.isFinite(shoe.maxKm) && shoe.maxKm > 0 ? shoe.maxKm : DEFAULT_SHOE.maxKm;

  const loggedKm = workouts.reduce((sum, w) => {
    if (!Number.isFinite(w.distanceKm) || w.distanceKm <= 0) return sum;
    if (startIso && isoFromLocal(w.date) < startIso) return sum;
    return sum + w.distanceKm;
  }, 0);

  const totalKm = Math.round((initialKm + loggedKm) * 10) / 10;
  const remainingKm = Math.round(Math.max(0, maxKm - totalKm) * 10) / 10;
  const rawPct = (totalKm / maxKm) * 100;
  const pct = Math.round(rawPct * 10) / 10;
  const status: ShoeStatus = rawPct >= 95 ? 'replace' : rawPct >= 75 ? 'warn' : 'good';

  return { totalKm, remainingKm, pct, status };
}
