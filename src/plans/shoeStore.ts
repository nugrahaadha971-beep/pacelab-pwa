import type { Workout } from '../analytics/types.ts';
import { isoFromLocal, isValidIso } from './schedule.ts';

export const SHOE_KEY = 'pacelab_shoe';
export const SHOES_KEY = 'pacelab_shoes';

export interface ShoeConfig {
  name: string;
  initialKm: number;
  maxKm: number;
  startDate?: string;
}

export interface ShoeItem {
  id: string;
  name: string;
  initialKm: number;
  maxKm: number;
  isDefault: boolean;
  retired?: boolean;
}

export type ShoeStatus = 'good' | 'warn' | 'replace';

export interface ShoeMileage {
  totalKm: number;
  remainingKm: number;
  pct: number;
  status: ShoeStatus;
}

export interface ShoeMileageEntry extends ShoeMileage {
  shoe: ShoeItem;
  loggedKm: number;
}

const roundKm2 = (n: number): number => Math.round(n * 100) / 100;

export function parseKmInput(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? roundKm2(raw) : null;
  }
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().replace(/,/g, '.');
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? roundKm2(parsed) : null;
}

export const DEFAULT_SHOE: ShoeConfig = {
  name: 'Sepatu Utama',
  initialKm: 0,
  maxKm: 800,
  startDate: '',
};

export const DEFAULT_MAX_KM = 800;

export const SHOE_STATUS_TEXT: Record<ShoeStatus, string> = {
  good: 'Bantalan sepatu masih nyaman dipakai lari',
  warn: 'Hampir waktunya ganti sepatu',
  replace: 'Bantalan sepatu sudah aus, pertimbangkan ganti baru',
};

export function createShoeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `shoe-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `shoe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeShoeConfig(raw: unknown): ShoeConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SHOE };
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : DEFAULT_SHOE.name;
  const rawInitial = parseKmInput(r.initialKm);
  const initialKm = rawInitial !== null && rawInitial >= 0 ? rawInitial : 0;
  const rawMax = parseKmInput(r.maxKm);
  const maxKm = rawMax !== null && rawMax > 0 ? rawMax : DEFAULT_SHOE.maxKm;
  const startDate = typeof r.startDate === 'string' && isValidIso(r.startDate.trim()) ? r.startDate.trim() : '';
  return { name, initialKm, maxKm, startDate };
}

export function normalizeShoeItem(raw: unknown, fallbackId?: string): ShoeItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : (fallbackId ?? createShoeId());
  const rawName = typeof r.name === 'string' ? r.name.trim() : '';
  const name = rawName || DEFAULT_SHOE.name;
  const rawInitial = parseKmInput(r.initialKm);
  const initialKm = rawInitial !== null && rawInitial >= 0 ? rawInitial : 0;
  const rawMax = parseKmInput(r.maxKm);
  const maxKm = rawMax !== null && rawMax > 0 ? rawMax : DEFAULT_MAX_KM;
  const retired = r.retired === true;
  const isDefault = !retired && r.isDefault === true;
  return { id, name, initialKm, maxKm, isDefault, ...(retired ? { retired: true } : {}) };
}

/** Pastikan paling banyak 1 sepatu aktif bertanda `isDefault: true`, dan selalu ada 1 jika masih ada sepatu aktif. */
export function normalizeShoeList(raw: unknown): ShoeItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: ShoeItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = normalizeShoeItem(raw[i], `shoe-${i + 1}`);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const active = items.filter((s) => !s.retired);
  if (active.length > 0) {
    const firstDefaultId = active.find((s) => s.isDefault)?.id ?? active[0].id;
    return items.map((s) => ({ ...s, isDefault: !s.retired && s.id === firstDefaultId }));
  }
  return items.map((s) => ({ ...s, isDefault: false }));
}

export function migrateLegacyShoe(rawLegacy: unknown): ShoeItem[] {
  if (rawLegacy == null) return [];
  const legacy = normalizeShoeConfig(rawLegacy);
  if (!legacy.name && legacy.initialKm === 0 && legacy.maxKm === DEFAULT_MAX_KM) return [];
  return [
    {
      id: 'shoe-default',
      name: legacy.name || DEFAULT_SHOE.name,
      initialKm: legacy.initialKm,
      maxKm: legacy.maxKm,
      isDefault: true,
    },
  ];
}

export function loadShoes(): ShoeItem[] {
  try {
    const rawList = localStorage.getItem(SHOES_KEY);
    if (rawList != null) {
      return normalizeShoeList(JSON.parse(rawList));
    }
    const rawLegacy = localStorage.getItem(SHOE_KEY);
    if (rawLegacy != null) {
      const migrated = migrateLegacyShoe(JSON.parse(rawLegacy));
      if (migrated.length > 0) {
        localStorage.setItem(SHOES_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
    return [];
  } catch {
    return [];
  }
}

export function saveShoes(shoes: ReadonlyArray<ShoeItem>): ShoeItem[] {
  const normalized = normalizeShoeList(shoes);
  try {
    localStorage.setItem(SHOES_KEY, JSON.stringify(normalized));
  } catch {
    /* penyimpanan tidak tersedia: abaikan */
  }
  return normalized;
}

export function getDefaultShoeId(shoes: ReadonlyArray<ShoeItem>): string | undefined {
  const active = shoes.filter((s) => !s.retired);
  return active.find((s) => s.isDefault)?.id ?? active[0]?.id;
}

export function addShoe(
  shoes: ReadonlyArray<ShoeItem>,
  input: { name: string; initialKm: number | string; maxKm: number | string },
): ShoeItem[] {
  const hasActive = shoes.some((s) => !s.retired);
  const parsedInitial = parseKmInput(input.initialKm);
  const parsedMax = parseKmInput(input.maxKm);
  const next: ShoeItem = {
    id: createShoeId(),
    name: input.name.trim() || DEFAULT_SHOE.name,
    initialKm: parsedInitial !== null && parsedInitial >= 0 ? parsedInitial : 0,
    maxKm: parsedMax !== null && parsedMax > 0 ? parsedMax : DEFAULT_MAX_KM,
    isDefault: !hasActive,
  };
  return normalizeShoeList([...shoes, next]);
}

export function updateShoeKm(
  shoes: ReadonlyArray<ShoeItem>,
  id: string,
  initialKm: number | string,
): ShoeItem[] {
  const parsedInitial = parseKmInput(initialKm);
  if (parsedInitial === null || parsedInitial < 0) {
    return normalizeShoeList(shoes);
  }
  return normalizeShoeList(
    shoes.map((s) => (s.id === id ? { ...s, initialKm: parsedInitial } : s)),
  );
}

export function setDefaultShoe(shoes: ReadonlyArray<ShoeItem>, id: string): ShoeItem[] {
  return normalizeShoeList(
    shoes.map((s) => ({
      ...s,
      isDefault: !s.retired && s.id === id,
    })),
  );
}

export function retireShoe(shoes: ReadonlyArray<ShoeItem>, id: string): ShoeItem[] {
  return normalizeShoeList(
    shoes.map((s) => (s.id === id ? { ...s, retired: true, isDefault: false } : s)),
  );
}

export function deleteShoe(shoes: ReadonlyArray<ShoeItem>, id: string): ShoeItem[] {
  return normalizeShoeList(shoes.filter((s) => s.id !== id));
}

function toMileage(totalKmRaw: number, maxKmRaw: number): ShoeMileage {
  const maxKm = Number.isFinite(maxKmRaw) && maxKmRaw > 0 ? maxKmRaw : DEFAULT_MAX_KM;
  const totalKm = roundKm2(totalKmRaw);
  const remainingKm = roundKm2(Math.max(0, maxKm - totalKm));
  const rawPct = (totalKm / maxKm) * 100;
  const pct = Math.round(rawPct * 10) / 10;
  const status: ShoeStatus = rawPct >= 95 ? 'replace' : rawPct >= 75 ? 'warn' : 'good';
  return { totalKm, remainingKm, pct, status };
}

export function calcAllShoesMileage(
  workouts: ReadonlyArray<Pick<Workout, 'distanceKm' | 'shoeId'>>,
  shoes: ReadonlyArray<ShoeItem>,
): ShoeMileageEntry[] {
  const active = normalizeShoeList(shoes).filter((s) => !s.retired);
  return active.map((shoe) => {
    const initialKm = Number.isFinite(shoe.initialKm) && shoe.initialKm >= 0 ? roundKm2(shoe.initialKm) : 0;
    const loggedKm = roundKm2(
      workouts.reduce((sum, w) => {
        if (!Number.isFinite(w.distanceKm) || w.distanceKm <= 0) return sum;
        return w.shoeId === shoe.id ? sum + w.distanceKm : sum;
      }, 0),
    );
    return {
      shoe,
      loggedKm,
      ...toMileage(initialKm + loggedKm, shoe.maxKm),
    };
  });
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

  return toMileage(initialKm + loggedKm, maxKm);
}
