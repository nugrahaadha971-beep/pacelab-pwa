// Penjadwalan kalender nyata mundur dari targetRaceDate. Murni (tanpa UI/DOM) agar bisa diuji dengan node:test.
import { NIKE_5K_PLAN } from './nike5k.ts';
import type { Session, SessionKind } from './nike5k.ts';
import { PROGRESSIVE_5K, PROGRESSIVE_RACE_STEPS } from './progressive5k.ts';
import type { TestKind } from './progressive5k.ts';
import { MAF_5K, MAF_RACE_STEPS } from './maf.ts';
import { hrRange } from './hrZones.ts';
import type { Zone } from './hrZones.ts';
import { normalizeStructuredSteps } from './workoutTypes.ts';
import type { RepeatBlock, SingleStep, WorkoutBlock } from './workoutTypes.ts';

export type { RepeatBlock, SingleStep, WorkoutBlock };
export type { DurationType, SessionCategory, StepKind, TargetType } from './workoutTypes.ts';

export type CurriculumId = 'nike5k' | 'progressive5k' | 'maf' | 'custom';

export type IsoDate = string; // YYYY-MM-DD (kalender, tanpa zona waktu)
export type Phase = 'base' | 'build' | 'taper' | 'race';

const DAY = 86_400_000;
/** Indeks = Date.getUTCDay(): 0 Minggu … 6 Sabtu. */
export const WEEKDAY_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
const WEEKDAY_LONG = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

export const NIKE_WEEKS = NIKE_5K_PLAN.length; // 8
export const BASE_GROWTH = 0.1; // maks +10%/minggu pada fase Base Building
export const TAPER_CUT = 0.35; // pemangkasan volume minggu terakhir (rentang yang diminta: 30–40%)
export const MIN_TRAINING_DAYS = 3;
/** ASUMSI: volume awal Base minimal 10 km/minggu (data 28 hari yang sangat sedikit tidak dipakai mentah-mentah) dan tiap Easy Run minimal 2 km. */
export const MIN_BASE_WEEKLY_KM = 10;
export const MIN_EASY_KM = 2;
/** Easy/Recovery Run dikunci pendek (Base: 2,0–2,5 km; Nike: maks 30 menit); Long Run ≥ Easy terpanjang + 1,5 km atau + 15 menit. */
export const RECOVERY_MAX_KM = 2.5;
export const RECOVERY_MAX_MIN = 30;
export const LONG_MARGIN_KM = 1.5;
export const LONG_MARGIN_MIN = 15;
/** ASUMSI: Long Run fase Base tidak melebihi 40% volume mingguan (kecuali untuk memenuhi margin di atas). */
const BASE_LONG_MAX_SHARE = 0.4;
/** ASUMSI: persentase long run dari volume mingguan pada fase Base. */
const BASE_LONG_SHARE = 0.35;
/** ASUMSI: estimasi durasi sesi speed = jumlah langkah berdurasi, minimal 30 menit (termasuk pemanasan/recovery/pendinginan). */
const SPEED_MIN_MINUTES = 30;

// ───────────────────────── Tanggal (aritmetika nomor hari, aman DST) ─────────────────────────

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIso(s: unknown): s is IsoDate {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export const dayNum = (iso: IsoDate): number => {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Tanggal tidak valid: ${iso}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY;
};
export const fromDayNum = (n: number): IsoDate => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (iso: IsoDate, n: number): IsoDate => fromDayNum(dayNum(iso) + n);
export const weekdayOf = (iso: IsoDate): number => new Date(dayNum(iso) * DAY).getUTCDay();
/** Senin minggu yang memuat `iso`. */
export const getMondayIso = (iso: IsoDate): IsoDate => addDays(iso, -((weekdayOf(iso) + 6) % 7));

/** Tanggal lomba tersimpan sebagai UTC tengah malam (Date.parse('YYYY-MM-DD') di Profil.tsx). */
export const isoFromRaceTs = (ts: number): IsoDate => new Date(ts).toISOString().slice(0, 10);
/** Tanggal kalender lokal dari timestamp (untuk hari ini dan tanggal sesi lari). */
export function isoFromLocal(ts: number): IsoDate {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Contoh: "Selasa, 17 Nov 2026". */
export function formatDateId(iso: IsoDate): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAY_LONG[weekdayOf(iso)]}, ${d} ${MONTH_SHORT[m - 1]} ${y}`;
}
/** Contoh: "17 Nov". */
export function formatDayMonth(iso: IsoDate): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]}`;
}
/** Contoh: "26 Nov 2026". */
export function formatDayMonthYear(iso: IsoDate): string {
  if (!isValidIso(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

export interface Remaining { daysRemaining: number; weeksRemaining: number }
/** daysRemaining = ceil((target − hari ini) / 86400000); dihitung pada tanggal kalender sehingga selalu bilangan bulat. */
export function remaining(raceIso: IsoDate, todayIso: IsoDate): Remaining {
  const daysRemaining = dayNum(raceIso) - dayNum(todayIso);
  return { daysRemaining, weeksRemaining: daysRemaining > 0 ? Math.ceil(daysRemaining / 7) : 0 };
}

// ───────────────────────── State jadwal pengguna (localStorage + cadangan JSON) ─────────────────────────

export interface ScheduleState {
  /** Hari latihan rutin (0 = Minggu … 6 = Sabtu). */
  days: number[];
  /** Geser semua sesi (hari); hari lomba tidak ikut bergeser. */
  shift: number;
  /** Tanggal manual per id sesi. */
  overrides: Record<string, IsoDate>;
  /** Centang manual "Selesai". */
  done: Record<string, true>;
  /** Sesi latihan kustom milik pengguna. */
  customSessions?: PlanSession[];
  /** Nama program latihan aktif milik pengguna. */
  programTitle?: string;
  /** Jika true, kalender hanya menampilkan sesi kustom/AI (+ hari lomba) tanpa sesi kurikulum bawaan. */
  customOnly?: boolean;
  /** Menandai jadwal sudah pernah diinisialisasi/disimpan pengguna. */
  initialized?: boolean;
  /** Menandai pengguna sengaja mengosongkan jadwal agar tidak digenerate ulang ke default. */
  clearedByUser?: boolean;
  /** Daftar id sesi bawaan yang dihapus secara individual oleh pengguna. */
  deletedIds?: string[];
  /** Sesi latihan terstruktur hasil penyusunan Gemini AI. */
  aiSessions?: PlanSession[];
  /** Ringkasan analisis program hasil Gemini AI. */
  aiSummary?: string;
}

export const DEFAULT_SCHEDULE_STATE: ScheduleState = { days: [2, 4, 6, 0], shift: 0, overrides: {}, done: {} };
export const SHIFT_LIMIT = 60;

const AI_KINDS: readonly SessionKind[] = ['recovery', 'long', 'speed'];
const CUSTOM_KINDS: readonly SessionKind[] = ['recovery', 'long', 'speed', 'race'];
const VALID_PHASES: readonly Phase[] = ['base', 'build', 'taper', 'race'];
const VALID_ZONES: readonly Zone[] = ['easy', 'interval', 'race', 'test', 'maf'];

function normalizeStoredSession(raw: unknown, allowRace: boolean): PlanSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!id || !name) return null;
  const allowedKinds = allowRace ? CUSTOM_KINDS : AI_KINDS;
  if (typeof r.kind !== 'string' || !allowedKinds.includes(r.kind as SessionKind)) return null;
  const kind = r.kind as SessionKind;
  if (!isValidIso(r.date)) return null;
  const date = r.date;
  const baseDate = isValidIso(r.baseDate) ? r.baseDate : date;
  const weekNo = typeof r.weekNo === 'number' && Number.isInteger(r.weekNo) && r.weekNo >= 1 ? r.weekNo : 1;
  const phase: Phase = typeof r.phase === 'string' && VALID_PHASES.includes(r.phase as Phase)
    ? (r.phase as Phase)
    : kind === 'race'
      ? 'race'
      : 'build';
  const steps = Array.isArray(r.steps)
    ? r.steps.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : [];
  const distanceKm = typeof r.distanceKm === 'number' && Number.isFinite(r.distanceKm) && r.distanceKm > 0
    ? Math.round(r.distanceKm * 10) / 10
    : null;
  const durationMin = typeof r.durationMin === 'number' && Number.isFinite(r.durationMin) && r.durationMin > 0
    ? Math.round(r.durationMin)
    : null;
  let hr: [number, number] | null = null;
  if (
    Array.isArray(r.hr) &&
    r.hr.length === 2 &&
    typeof r.hr[0] === 'number' &&
    typeof r.hr[1] === 'number' &&
    Number.isFinite(r.hr[0]) &&
    Number.isFinite(r.hr[1]) &&
    r.hr[0] > 0 &&
    r.hr[1] >= r.hr[0]
  ) {
    hr = [Math.round(r.hr[0]), Math.round(r.hr[1])];
  }
  let pace: [number, number] | null = null;
  if (
    Array.isArray(r.pace) &&
    r.pace.length === 2 &&
    typeof r.pace[0] === 'number' &&
    typeof r.pace[1] === 'number' &&
    Number.isFinite(r.pace[0]) &&
    Number.isFinite(r.pace[1]) &&
    r.pace[0] > 0 &&
    r.pace[1] > 0
  ) {
    const a = Math.round(r.pace[0]);
    const b = Math.round(r.pace[1]);
    pace = [Math.min(a, b), Math.max(a, b)];
  }
  const zone: Zone = typeof r.zone === 'string' && VALID_ZONES.includes(r.zone as Zone)
    ? (r.zone as Zone)
    : kind === 'speed'
      ? 'interval'
      : kind === 'race'
        ? 'race'
        : 'easy';
  const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined;
  const structuredSteps = normalizeStructuredSteps(r.structuredSteps);

  return {
    id,
    weekNo,
    phase,
    kind,
    name,
    steps,
    ...(structuredSteps ? { structuredSteps } : {}),
    date,
    baseDate,
    distanceKm,
    durationMin,
    zone,
    hr,
    ...(pace ? { pace } : {}),
    ...(note ? { note } : {}),
  };
}

export function normalizeScheduleState(raw: unknown): ScheduleState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const days = Array.isArray(r.days)
    ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  const shift = typeof r.shift === 'number' && Number.isInteger(r.shift) ? Math.max(-SHIFT_LIMIT, Math.min(SHIFT_LIMIT, r.shift)) : 0;
  const overrides: Record<string, IsoDate> = {};
  if (typeof r.overrides === 'object' && r.overrides !== null) {
    for (const [k, v] of Object.entries(r.overrides)) if (isValidIso(v)) overrides[k] = v;
  }
  const done: Record<string, true> = {};
  if (typeof r.done === 'object' && r.done !== null) {
    for (const [k, v] of Object.entries(r.done)) if (v === true) done[k] = true;
  }
  const customSessions = Array.isArray(r.customSessions)
    ? r.customSessions.map((s) => normalizeStoredSession(s, true)).filter((s): s is PlanSession => s !== null)
    : [];
  const programTitle = typeof r.programTitle === 'string' && r.programTitle.trim() ? r.programTitle.trim() : '';
  const aiSessions = Array.isArray(r.aiSessions)
    ? r.aiSessions.map((s) => normalizeStoredSession(s, false)).filter((s): s is PlanSession => s !== null)
    : [];
  const aiSummary = typeof r.aiSummary === 'string' && r.aiSummary.trim() ? r.aiSummary.trim() : '';

  const deletedIds = Array.isArray(r.deletedIds)
    ? [...new Set(r.deletedIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))]
    : [];

  const out: ScheduleState = { days: days.length ? days : [...DEFAULT_SCHEDULE_STATE.days], shift, overrides, done };
  if (customSessions.length > 0) out.customSessions = customSessions;
  if (programTitle) out.programTitle = programTitle;
  if (r.customOnly === true) out.customOnly = true;
  if (r.initialized === true) out.initialized = true;
  if (r.clearedByUser === true) out.clearedByUser = true;
  if (deletedIds.length > 0) out.deletedIds = deletedIds;
  if (aiSessions.length > 0) out.aiSessions = aiSessions;
  if (aiSummary) out.aiSummary = aiSummary;
  return out;
}

export function toggleDay(state: ScheduleState, day: number): ScheduleState {
  const has = state.days.includes(day);
  if (has && state.days.length <= MIN_TRAINING_DAYS) return state;
  const days = has ? state.days.filter((d) => d !== day) : [...state.days, day].sort((a, b) => a - b);
  return { ...state, days };
}
export const shiftAll = (state: ScheduleState, delta: number): ScheduleState =>
  ({ ...state, shift: Math.max(-SHIFT_LIMIT, Math.min(SHIFT_LIMIT, state.shift + delta)) });
export function resetSchedule(state: ScheduleState): ScheduleState {
  const {
    aiSessions: _aiSessions,
    aiSummary: _aiSummary,
    clearedByUser: _clearedByUser,
    customOnly: _customOnly,
    deletedIds: _deletedIds,
    ...rest
  } = state;
  return { ...rest, shift: 0, overrides: {} };
}
export function clearAiSchedule(state: ScheduleState): ScheduleState {
  const { aiSessions: _aiSessions, aiSummary: _aiSummary, ...rest } = state;
  const overrides: Record<string, IsoDate> = {};
  for (const [k, v] of Object.entries(rest.overrides)) {
    if (!k.startsWith('ai-')) overrides[k] = v;
  }
  return { ...rest, overrides };
}
export const setSessionDate = (state: ScheduleState, id: string, iso: IsoDate): ScheduleState =>
  ({ ...state, overrides: { ...state.overrides, [id]: iso } });
export function toggleDone(state: ScheduleState, id: string): ScheduleState {
  const done = { ...state.done };
  if (done[id]) delete done[id];
  else done[id] = true;
  return { ...state, done };
}
/** Tukar tanggal dua sesi (berdasarkan tanggal efektif saat ini). */
export function swapSessions(state: ScheduleState, a: PlanSession, b: PlanSession): ScheduleState {
  return { ...state, overrides: { ...state.overrides, [a.id]: b.date, [b.id]: a.date } };
}

export interface CustomSessionInput {
  id?: string;
  date: IsoDate;
  kind: SessionKind;
  name: string;
  distanceKm?: number | null;
  durationMin?: number | null;
  hr?: [number, number] | null;
  pace?: [number, number] | null;
  steps?: string[];
  structuredSteps?: WorkoutBlock[];
  note?: string;
}

export type PresetTemplateId = 'base5k' | 'base10k' | 'empty';

export interface PresetTemplateOptions {
  todayIso: IsoDate;
  raceIso?: IsoDate | null;
  maxHr?: number | null;
  trainingDays?: number[];
}

function zoneForKind(kind: SessionKind): Zone {
  if (kind === 'speed') return 'interval';
  if (kind === 'race') return 'race';
  return 'easy';
}

function buildCustomSessionRecord(input: CustomSessionInput, fallbackId: string): PlanSession {
  const name = input.name.trim() || 'Sesi Latihan';
  const distanceKm =
    typeof input.distanceKm === 'number' && Number.isFinite(input.distanceKm) && input.distanceKm > 0
      ? Math.round(input.distanceKm * 10) / 10
      : null;
  const durationMin =
    typeof input.durationMin === 'number' && Number.isFinite(input.durationMin) && input.durationMin > 0
      ? Math.round(input.durationMin)
      : null;
  const hr: [number, number] | null =
    input.hr &&
    Number.isFinite(input.hr[0]) &&
    Number.isFinite(input.hr[1]) &&
    input.hr[0] > 0 &&
    input.hr[1] >= input.hr[0]
      ? [Math.round(input.hr[0]), Math.round(input.hr[1])]
      : null;
  const pace: [number, number] | null =
    input.pace &&
    Number.isFinite(input.pace[0]) &&
    Number.isFinite(input.pace[1]) &&
    input.pace[0] > 0 &&
    input.pace[1] > 0
      ? [Math.min(Math.round(input.pace[0]), Math.round(input.pace[1])), Math.max(Math.round(input.pace[0]), Math.round(input.pace[1]))]
      : null;
  const steps = (input.steps ?? []).map((s) => s.trim()).filter(Boolean);
  const structuredSteps = normalizeStructuredSteps(input.structuredSteps);
  const note = input.note?.trim() ? input.note.trim() : undefined;

  return {
    id: input.id?.trim() || fallbackId,
    weekNo: 1,
    phase: input.kind === 'race' ? 'race' : 'build',
    kind: input.kind,
    name,
    steps,
    ...(structuredSteps ? { structuredSteps } : {}),
    date: input.date,
    baseDate: input.date,
    distanceKm,
    durationMin,
    zone: zoneForKind(input.kind),
    hr,
    ...(pace ? { pace } : {}),
    ...(note ? { note } : {}),
  };
}

export function addCustomSession(state: ScheduleState, input: CustomSessionInput): ScheduleState {
  if (!isValidIso(input.date)) return state;
  const existing = state.customSessions ?? [];
  const uid = `custom-${input.date}-${Date.now().toString(36)}-${existing.length}`;
  const session = buildCustomSessionRecord(input, uid);
  const customSessions = [...existing, session].sort((a, b) => dayNum(a.date) - dayNum(b.date));
  return {
    ...state,
    customSessions,
    ...(state.programTitle ? {} : { programTitle: 'Program Latihan Saya' }),
  };
}

export function updateCustomSession(
  state: ScheduleState,
  id: string,
  patch: Partial<CustomSessionInput>,
): ScheduleState {
  const existing = state.customSessions ?? [];
  const target = existing.find((s) => s.id === id);
  if (!target) return state;

  const nextDate = patch.date && isValidIso(patch.date) ? patch.date : target.date;
  const updated = buildCustomSessionRecord(
    {
      id: target.id,
      date: nextDate,
      kind: patch.kind ?? target.kind,
      name: patch.name !== undefined ? patch.name : target.name,
      distanceKm: patch.distanceKm !== undefined ? patch.distanceKm : target.distanceKm,
      durationMin: patch.durationMin !== undefined ? patch.durationMin : target.durationMin,
      hr: patch.hr !== undefined ? patch.hr : target.hr,
      pace: patch.pace !== undefined ? patch.pace : target.pace,
      steps: patch.steps !== undefined ? patch.steps : target.steps,
      structuredSteps:
        patch.structuredSteps !== undefined ? patch.structuredSteps : target.structuredSteps,
      note: patch.note !== undefined ? patch.note : target.note,
    },
    target.id,
  );

  const overrides = { ...state.overrides };
  if (patch.date && isValidIso(patch.date)) delete overrides[id];

  const customSessions = existing
    .map((s) => (s.id === id ? updated : s))
    .sort((a, b) => dayNum(a.date) - dayNum(b.date));

  return { ...state, overrides, customSessions };
}

export function deleteCustomSession(state: ScheduleState, id: string): ScheduleState {
  const existing = state.customSessions ?? [];
  const nextList = existing.filter((s) => s.id !== id);
  const overrides = { ...state.overrides };
  delete overrides[id];
  const done = { ...state.done };
  delete done[id];

  const { customSessions: _old, ...rest } = state;
  return {
    ...rest,
    overrides,
    done,
    ...(nextList.length > 0 ? { customSessions: nextList } : {}),
  };
}

/** Hapus satu sesi (kustom, AI, atau bawaan) berdasarkan id; opsional menandai jadwal kosong oleh pengguna. */
export function deleteSession(
  state: ScheduleState,
  targetId: string,
  opts?: { extraDeletedIds?: string[]; markClearedIfEmpty?: boolean },
): ScheduleState {
  const existingCustom = state.customSessions ?? [];
  const existingAi = state.aiSessions ?? [];
  const wasCustom = existingCustom.some((s) => s.id === targetId);
  const wasAi = existingAi.some((s) => s.id === targetId);

  const nextCustom = existingCustom.filter((s) => s.id !== targetId);
  const nextAi = existingAi.filter((s) => s.id !== targetId);

  const overrides = { ...state.overrides };
  delete overrides[targetId];
  const done = { ...state.done };
  delete done[targetId];

  const deletedSet = new Set(state.deletedIds ?? []);
  if (!wasCustom && !wasAi) deletedSet.add(targetId);
  for (const extra of opts?.extraDeletedIds ?? []) {
    if (extra.trim()) deletedSet.add(extra.trim());
  }
  const deletedIds = [...deletedSet];

  const { customSessions: _oldC, aiSessions: _oldA, aiSummary: _oldS, deletedIds: _oldD, ...rest } = state;
  const keepSummary = nextAi.length > 0 ? state.aiSummary : undefined;

  return {
    ...rest,
    initialized: true,
    ...(opts?.markClearedIfEmpty ? { clearedByUser: true } : {}),
    overrides,
    done,
    ...(nextCustom.length > 0 ? { customSessions: nextCustom } : {}),
    ...(nextAi.length > 0 ? { aiSessions: nextAi } : {}),
    ...(keepSummary ? { aiSummary: keepSummary } : {}),
    ...(deletedIds.length > 0 ? { deletedIds } : {}),
  };
}

/** Hapus semua sesi pada tanggal lokal tertentu (`YYYY-MM-DD`). */
export function deleteSessionsOnDate(
  state: ScheduleState,
  dateIso: IsoDate,
  baseIdsOnDate: string[] = [],
  markClearedIfEmpty = false,
): ScheduleState {
  const effDate = (s: PlanSession) => state.overrides[s.id] ?? s.date;
  const existingCustom = state.customSessions ?? [];
  const existingAi = state.aiSessions ?? [];

  const removedIds = new Set<string>(baseIdsOnDate);
  for (const s of existingCustom) if (effDate(s) === dateIso) removedIds.add(s.id);
  for (const s of existingAi) if (effDate(s) === dateIso) removedIds.add(s.id);

  const nextCustom = existingCustom.filter((s) => effDate(s) !== dateIso);
  const nextAi = existingAi.filter((s) => effDate(s) !== dateIso);

  const overrides = { ...state.overrides };
  const done = { ...state.done };
  for (const id of removedIds) {
    delete overrides[id];
    delete done[id];
  }

  const deletedSet = new Set(state.deletedIds ?? []);
  for (const id of baseIdsOnDate) {
    if (id.trim()) deletedSet.add(id.trim());
  }
  const deletedIds = [...deletedSet];

  const { customSessions: _oldC, aiSessions: _oldA, aiSummary: _oldS, deletedIds: _oldD, ...rest } = state;
  const keepSummary = nextAi.length > 0 ? state.aiSummary : undefined;

  return {
    ...rest,
    initialized: true,
    ...(markClearedIfEmpty ? { clearedByUser: true } : {}),
    overrides,
    done,
    ...(nextCustom.length > 0 ? { customSessions: nextCustom } : {}),
    ...(nextAi.length > 0 ? { aiSessions: nextAi } : {}),
    ...(keepSummary ? { aiSummary: keepSummary } : {}),
    ...(deletedIds.length > 0 ? { deletedIds } : {}),
  };
}

/** Kosongkan seluruh sesi jadwal secara eksplisit oleh pengguna. */
export function clearAllSessions(state: ScheduleState): ScheduleState {
  const {
    customSessions: _oldC,
    aiSessions: _oldA,
    aiSummary: _oldS,
    deletedIds: _oldD,
    ...rest
  } = state;
  return {
    ...rest,
    initialized: true,
    clearedByUser: true,
    customOnly: true,
    overrides: {},
    done: {},
  };
}

export function setProgramTitle(state: ScheduleState, title: string): ScheduleState {
  const trimmed = title.trim();
  if (!trimmed) {
    const { programTitle: _old, ...rest } = state;
    return rest;
  }
  return { ...state, programTitle: trimmed };
}

export function applyPresetTemplate(
  state: ScheduleState,
  templateId: PresetTemplateId,
  opts: PresetTemplateOptions,
): ScheduleState {
  const { customSessions: _cs, aiSessions: _ai, aiSummary: _as, ...rest } = state;
  const overrides: Record<string, IsoDate> = {};
  for (const [k, v] of Object.entries(rest.overrides)) {
    if (!k.startsWith('custom-') && !k.startsWith('tpl-') && !k.startsWith('ai-')) overrides[k] = v;
  }

  if (templateId === 'empty') {
    return {
      ...rest,
      overrides,
      programTitle: 'Program Kustom',
      customOnly: true,
    };
  }

  const days = (opts.trainingDays && opts.trainingDays.length > 0 ? opts.trainingDays : state.days).slice().sort((a, b) => a - b);
  const raceLimit = opts.raceIso && isValidIso(opts.raceIso) ? dayNum(opts.raceIso) : null;
  const startDay = dayNum(opts.todayIso);

  const slots: IsoDate[] = [];
  for (let offset = 0; offset < 14 && slots.length < 8; offset++) {
    const d = startDay + offset;
    if (raceLimit != null && d >= raceLimit) break;
    const iso = fromDayNum(d);
    if (days.includes(weekdayOf(iso))) slots.push(iso);
  }
  if (slots.length === 0 && (raceLimit == null || startDay < raceLimit)) {
    slots.push(opts.todayIso);
  }

  const easyHr = hrRange('easy', opts.maxHr);
  const speedHr = hrRange('interval', opts.maxHr);
  const is10k = templateId === 'base10k';
  const blueprint: Array<{ kind: SessionKind; name: string; distanceKm: number | null; durationMin: number; steps: string[] }> = is10k
    ? [
        { kind: 'recovery', name: 'Easy Run Aerobik', distanceKm: 5, durationMin: 35, steps: ['Lari santai di zona HR mudah', 'Fokus ritme napas rileks'] },
        { kind: 'speed', name: 'Tempo Terkontrol', distanceKm: 6, durationMin: 38, steps: ['10 menit pemanasan', '18 menit tempo stabil', '10 menit pendinginan'] },
        { kind: 'recovery', name: 'Easy Run Pemulihan', distanceKm: 5, durationMin: 32, steps: ['Lari santai menjaga konsistensi'] },
        { kind: 'long', name: 'Long Run Dasar', distanceKm: 10, durationMin: 68, steps: ['Jaga detak jantung stabil di zona aerobik'] },
        { kind: 'recovery', name: 'Easy Run + Strides', distanceKm: 5.5, durationMin: 35, steps: ['30 menit easy run', '4 × 20 dtk strides rileks'] },
        { kind: 'speed', name: 'Interval 5×600m', distanceKm: 6.5, durationMin: 40, steps: ['10 menit pemanasan', '5 × 600m cepat, jeda 2 menit jalan', '10 menit pendinginan'] },
        { kind: 'recovery', name: 'Easy Run Ringan', distanceKm: 4.5, durationMin: 30, steps: ['Lari ringan menjaga kesegaran kaki'] },
        { kind: 'long', name: 'Long Run Progresif', distanceKm: 12, durationMin: 80, steps: ['Mulai santai, pertahankan ritme stabil hingga selesai'] },
      ]
    : [
        { kind: 'recovery', name: 'Easy Run Aerobik', distanceKm: 3.5, durationMin: 25, steps: ['Lari santai di zona HR mudah'] },
        { kind: 'speed', name: 'Fartlek Ringan', distanceKm: 4, durationMin: 28, steps: ['10 menit pemanasan', '5 × (1 mnt cepat / 2 mnt santai)', '5 menit pendinginan'] },
        { kind: 'recovery', name: 'Easy Run Pemulihan', distanceKm: 3, durationMin: 22, steps: ['Jaga napas santai, bisa berbicara lancar'] },
        { kind: 'long', name: 'Long Run Dasar', distanceKm: 6, durationMin: 42, steps: ['Lari terjauh minggu ini dengan ritme nyaman'] },
        { kind: 'recovery', name: 'Easy Run + Strides', distanceKm: 4, durationMin: 28, steps: ['22 menit easy run', '4 × 20 dtk strides rileks'] },
        { kind: 'speed', name: 'Interval 4×400m', distanceKm: 4.5, durationMin: 32, steps: ['10 menit pemanasan', '4 × 400m ritme cepat, jeda 90 dtk jalan', '8 menit pendinginan'] },
        { kind: 'recovery', name: 'Easy Run Ringan', distanceKm: 3, durationMin: 22, steps: ['Pemulihan aktif sebelum long run'] },
        { kind: 'long', name: 'Long Run Akhir Pekan', distanceKm: 7.5, durationMin: 52, steps: ['Pertahankan detak jantung stabil hingga akhir'] },
      ];

  const customSessions: PlanSession[] = slots.map((date, idx) => {
    const item = blueprint[idx % blueprint.length];
    return buildCustomSessionRecord(
      {
        id: `tpl-${templateId}-${idx}-${date}`,
        date,
        kind: item.kind,
        name: item.name,
        distanceKm: item.distanceKm,
        durationMin: item.durationMin,
        hr: item.kind === 'speed' ? speedHr : easyHr,
        steps: item.steps,
      },
      `tpl-${templateId}-${idx}`,
    );
  });

  return {
    ...rest,
    overrides,
    programTitle: is10k ? 'Dasar 10K' : 'Dasar 5K',
    customOnly: true,
    customSessions,
  };
}

// ───────────────────────── Model rencana ─────────────────────────

export interface Adjustment { code: 'high_load' | 'ef_up' | 'drift' | 'add_volume'; badge: string; reason: string }

export interface PlanSession {
  id: string;
  weekNo: number; // 1..totalWeeks
  phase: Phase;
  kind: SessionKind;
  name: string;
  steps: string[];
  structuredSteps?: WorkoutBlock[];
  date: IsoDate; // tanggal efektif (setelah geser/ubah manual)
  baseDate: IsoDate; // tanggal hasil penjadwalan otomatis
  distanceKm: number | null;
  durationMin: number | null;
  note?: string;
  demoted?: boolean; // speed → easy karena tidak ada hari yang tidak bersebelahan dengan Long Run
  zone?: Zone; // zona HR: easy (Easy/Long), interval, race, test
  hr?: [number, number] | null; // target bpm dari HR maks
  pace?: [number, number] | null; // target pace [minSec, maxSec] per km (opsional)
  test?: TestKind;
  repKm?: number; // jarak ulangan interval (km)
  // Diisi oleh adaptiveEngine
  adjDurationMin?: number;
  paceDeltaSec?: number; // + lebih lambat, − lebih cepat (detik/km)
  convertedFrom?: SessionKind;
  adjustments?: Adjustment[];
}

export interface PlanWeek {
  weekNo: number;
  phase: Phase;
  startIso: IsoDate;
  endIso: IsoDate;
  plannedKm: number | null; // target volume mingguan (hanya fase Base)
  title?: string; // judul fase kurikulum (mis. "Fondasi Lari-Jalan")
  deload?: boolean;
  sessions: PlanSession[];
}

export interface Plan {
  weeks: PlanWeek[];
  daysRemaining: number;
  weeksRemaining: number;
  baseWeeks: number;
  totalWeeks: number;
}

export interface PlanOptions {
  raceIso: IsoDate;
  todayIso: IsoDate;
  days: number[];
  raceName: string;
  startWeeklyKm: number;
  maxWeeklyKm: number;
  easyPaceSecPerKm: number;
  curriculum?: CurriculumId; // default 'nike5k'
  maxHr?: number | null; // untuk target bpm per sesi
  mafHr?: number | null; // HR MAF (180 − usia ± penyesuaian) untuk zona 'maf'
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function estimateSpeedMinutes(steps: string[]): number {
  let sum = 0;
  for (const s of steps) {
    const m = /^(?:(\d+) x )?(\d+):(\d{2})\b/.exec(s);
    if (m) sum += (m[1] ? Number(m[1]) : 1) * (Number(m[2]) + Number(m[3]) / 60);
  }
  return Math.max(SPEED_MIN_MINUTES, Math.round(sum));
}

/** Durasi/jarak sesi templat Nike. Nama "25:00" = menit; "3.2K / 2 Mile" = km (dikonversi lewat easy pace). */
export function sessionLoad(s: Pick<Session, 'kind' | 'name' | 'steps'>, easyPaceSec: number): { durationMin: number | null; distanceKm: number | null } {
  if (s.kind === 'race') return { durationMin: null, distanceKm: null };
  if (s.kind === 'speed') return { durationMin: estimateSpeedMinutes(s.steps), distanceKm: null };
  const t = /^(\d+):(\d{2})/.exec(s.name);
  if (t) {
    const min = Number(t[1]) + Number(t[2]) / 60;
    return { durationMin: Math.round(min), distanceKm: round1((min * 60) / easyPaceSec) };
  }
  const k = /^(\d+(?:\.\d+)?)K\b/.exec(s.name);
  if (k) {
    const km = Number(k[1]);
    return { durationMin: Math.round((km * easyPaceSec) / 60), distanceKm: km };
  }
  return { durationMin: null, distanceKm: null };
}

const PRIORITY: Record<SessionKind, number> = { race: 4, long: 3, speed: 2, recovery: 1 };

/** Pilih `n` sesi yang dipertahankan: buang prioritas terendah dulu (recovery), yang paling awal lebih dulu. Urutan asli dipertahankan. */
export function pickSessions<T extends { kind: SessionKind; test?: unknown }>(list: T[], n: number): number[] {
  const pr = (x: T) => (x.test ? 3 : PRIORITY[x.kind]);
  const idx = list.map((_, i) => i);
  while (idx.length > Math.max(0, n)) {
    let drop = 0;
    for (let k = 1; k < idx.length; k++) if (pr(list[idx[k]]) < pr(list[idx[drop]])) drop = k;
    idx.splice(drop, 1);
  }
  return idx;
}

/** Pilih `n` slot dari `slots` (terurut) dengan jarak merata; slot pertama dan terakhir selalu ikut bila n ≥ 2. */
function spreadSlots(slots: IsoDate[], n: number): IsoDate[] {
  if (n >= slots.length) return slots;
  if (n <= 0) return [];
  if (n === 1) return [slots[slots.length - 1]];
  return Array.from({ length: n }, (_, i) => slots[Math.round((i * (slots.length - 1)) / (n - 1))]);
}

const isWeekend = (iso: IsoDate) => { const w = weekdayOf(iso); return w === 0 || w === 6; };
const adjacent = (a: IsoDate | null, b: IsoDate | null) => a != null && b != null && Math.abs(dayNum(a) - dayNum(b)) === 1;

export interface Draft {
  id: string; kind: SessionKind; name: string; steps: string[]; distanceKm: number | null; durationMin: number | null; demoted?: boolean;
  zone?: Zone; test?: TestKind; repKm?: number; fixedWeekday?: number;
}
interface Ctx { prevLong: IsoDate | null; prevSpeed: IsoDate | null }

/**
 * Tempatkan sesi pada slot hari. Aturan: Long Run di akhir pekan pilihan (Sab/Min) bila ada;
 * Speed tidak bersebelahan dengan Long Run (minggu ini maupun sebelumnya) dan sebisa mungkin tidak bersebelahan satu sama lain.
 * Speed yang tidak bisa ditempatkan tanpa melanggar aturan diturunkan menjadi Easy Run.
 */
export function assignWeek(drafts: Draft[], slotsAll: IsoDate[], ctx: Ctx): Array<{ draft: Draft; date: IsoDate }> {
  const slots = spreadSlots(slotsAll, drafts.length);
  const free = [...slots];
  const out: Array<{ draft: Draft; date: IsoDate }> = [];
  const take = (d: IsoDate) => free.splice(free.indexOf(d), 1);

  let longDate: IsoDate | null = null;
  const longDraft = drafts.find((d) => d.kind === 'long');
  if (longDraft && free.length) {
    const ok = free.filter((d) => !adjacent(d, ctx.prevSpeed));
    const pool = ok.length ? ok : free;
    const weekend = pool.filter(isWeekend);
    longDate = (weekend.length ? weekend : pool)[(weekend.length ? weekend : pool).length - 1];
    take(longDate);
    out.push({ draft: longDraft, date: longDate });
  }

  const speedDates: IsoDate[] = [];
  const placed = new Map<Draft, IsoDate>();
  // Tes (3K/5K) lebih dulu: ditaruh di hari tetapnya (Sabtu) dan boleh bersebelahan dengan Long Run karena Long Run setelahnya ringan.
  const speeds = drafts.filter((x) => x.kind === 'speed').sort((a, b) => Number(!!b.test) - Number(!!a.test));
  for (const d of speeds) {
    if (d.test) {
      const hardOk = free.filter((x) => !adjacent(x, longDate) && !adjacent(x, ctx.prevLong));
      const pick = free.find((x) => weekdayOf(x) === d.fixedWeekday) ?? hardOk[0] ?? free[0];
      if (pick) { take(pick); speedDates.push(pick); placed.set(d, pick); }
      continue;
    }
    const hardOk = free.filter((x) => !adjacent(x, longDate) && !adjacent(x, ctx.prevLong));
    const soft = hardOk.filter((x) => !speedDates.some((p) => adjacent(x, p)));
    const pick = (soft.length ? soft : hardOk)[0];
    if (pick) {
      take(pick);
      speedDates.push(pick);
      placed.set(d, pick);
    }
  }
  for (const d of drafts) {
    if (d.kind === 'speed') {
      const dt = placed.get(d);
      if (dt) out.push({ draft: d, date: dt });
      else if (free.length) {
        const dt2 = free.shift() as IsoDate;
        out.push({ draft: { ...d, kind: 'recovery', zone: 'easy', repKm: undefined, name: 'Easy Run (pengganti Speed)', steps: [], durationMin: Math.min(d.durationMin ?? 35, 35), demoted: true }, date: dt2 });
      }
    } else if (d.kind === 'recovery') {
      if (free.length) out.push({ draft: d, date: free.shift() as IsoDate });
    }
  }
  return out.sort((a, b) => dayNum(a.date) - dayNum(b.date));
}

/** Volume mingguan Base: +10%/minggu dari volume awal, berhenti naik di batas `maxKm`. */
export function baseVolumes(count: number, startKm: number, maxKm: number): number[] {
  const start = Math.max(1, startKm);
  const cap = Math.max(maxKm, start);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(round1(Math.min(cap, i === 0 ? start : out[i - 1] * (1 + BASE_GROWTH))));
  return out;
}

interface TplSession {
  key: number; kind: SessionKind; name: string; steps: string[]; zone: Zone; durationMin: number | null; distanceKm: number | null;
  test?: TestKind; repKm?: number; fixedWeekday?: number;
}
interface Tpl {
  weeks: Array<{ title?: string; deload?: boolean; sessions: TplSession[] }>;
  idPrefix: string;
  capRecovery: boolean; // kunci Easy/Recovery ≤ 30 menit (templat Nike); kurikulum Progresif sudah menetapkan durasinya sendiri
  taperCut: boolean; // pangkas minggu terakhir (templat Nike); Progresif sudah memuat taper sendiri
  keepPreRaceDay: boolean; // Progresif memprogram shake-out sehari sebelum lomba
  raceSteps: string[];
}

function template(c: CurriculumId, easyPace: number): Tpl {
  if (c === 'maf') {
    return {
      idPrefix: 'm', capRecovery: false, taperCut: false, keepPreRaceDay: true, raceSteps: MAF_RACE_STEPS,
      weeks: MAF_5K.map((w) => ({
        title: w.title, deload: w.deload,
        sessions: w.sessions.map((x, key) => ({
          ...x, key, distanceKm: x.kind === 'speed' ? null : round1((x.durationMin * 60) / easyPace),
        })),
      })),
    };
  }
  if (c === 'progressive5k') {
    return {
      idPrefix: 'p', capRecovery: false, taperCut: false, keepPreRaceDay: true, raceSteps: PROGRESSIVE_RACE_STEPS,
      weeks: PROGRESSIVE_5K.map((w) => ({
        title: w.title, deload: w.deload,
        sessions: w.sessions.map((x, key) => ({
          ...x, key, distanceKm: x.kind === 'speed' ? null : round1((x.durationMin * 60) / easyPace),
        })),
      })),
    };
  }
  return {
    idPrefix: 'n', capRecovery: true, taperCut: true, keepPreRaceDay: false, raceSteps: [],
    weeks: NIKE_5K_PLAN.map((w) => ({
      sessions: w.sessions.flatMap((x, key): TplSession[] =>
        x.kind === 'race' ? [] : [{ key, kind: x.kind, name: x.name, steps: x.steps, zone: x.kind === 'speed' ? 'interval' : 'easy', ...sessionLoad(x, easyPace) }]),
    })),
  };
}

const renameForMinutes = (name: string, min: number): string =>
  name === 'Easy Run' || name === 'Long Run' ? name : /^\d+'/.test(name) ? name.replace(/^\d+'/, `${min}'`) : `${min} menit`;

/**
 * Kunci Easy/Recovery pendek dan pastikan Long Run lebih panjang: selisih ≥ 1,5 km ATAU ≥ 15 menit dari
 * Easy/Recovery terpanjang di minggu yang sama (Long Run dinaikkan seperlunya). Minggu deload dikecualikan.
 */
export function enforceLongMargin(drafts: Draft[], easyPace: number, capRecovery: boolean, exempt = false): Draft[] {
  let out = drafts.map((d) => ({ ...d }));
  if (capRecovery) {
    out = out.map((d) => {
      if (d.kind !== 'recovery' || (d.zone !== 'easy' && d.zone !== 'maf') || d.demoted || d.durationMin == null || d.durationMin <= RECOVERY_MAX_MIN) return d;
      const km = d.distanceKm != null ? round1((d.distanceKm * RECOVERY_MAX_MIN) / d.durationMin) : null;
      return { ...d, durationMin: RECOVERY_MAX_MIN, distanceKm: km, name: renameForMinutes(d.name, RECOVERY_MAX_MIN) };
    });
  }
  if (exempt) return out;
  const easy = out.filter((d) => d.kind === 'recovery' && (d.zone === 'easy' || d.zone === 'maf') && d.durationMin != null);
  const li = out.findIndex((d) => d.kind === 'long' && d.durationMin != null);
  if (li < 0 || !easy.length) return out;
  const L = out[li];
  const eMin = Math.max(...easy.map((d) => d.durationMin as number));
  const eKm = Math.max(...easy.map((d) => d.distanceKm ?? ((d.durationMin as number) * 60) / easyPace));
  const lMin = L.durationMin as number;
  const lKm = L.distanceKm ?? (lMin * 60) / easyPace;
  if (lMin - eMin >= LONG_MARGIN_MIN || lKm - eKm >= LONG_MARGIN_KM) return out;
  const needMin = Math.ceil(Math.min(eMin + LONG_MARGIN_MIN, ((eKm + LONG_MARGIN_KM) * easyPace) / 60));
  out[li] = { ...L, durationMin: needMin, distanceKm: round1((needMin * 60) / easyPace), name: renameForMinutes(L.name, needMin) };
  return out;
}

export function buildPlan(o: PlanOptions): Plan {
  const { daysRemaining, weeksRemaining } = remaining(o.raceIso, o.todayIso);
  if (daysRemaining < 0) return { weeks: [], daysRemaining, weeksRemaining: 0, baseWeeks: 0, totalWeeks: 0 };

  const isCustomNeutral = o.curriculum === 'custom';
  const tpl = isCustomNeutral ? null : template(o.curriculum ?? 'nike5k', o.easyPaceSecPerKm);
  const tplWeeks = tpl ? tpl.weeks.length : 0;
  const total = Math.max(1, weeksRemaining);
  const peakCount = isCustomNeutral ? 0 : Math.min(tplWeeks, total);
  const baseCount = total - peakCount;
  const volumes = baseVolumes(baseCount, Math.max(o.startWeeklyKm, MIN_BASE_WEEKLY_KM), o.maxWeeklyKm);
  const raceDay = o.raceIso;
  const weeks: PlanWeek[] = [];
  let ctx: Ctx = { prevLong: null, prevSpeed: null };
  const marginKm = Math.max(LONG_MARGIN_KM, (LONG_MARGIN_MIN * 60) / o.easyPaceSecPerKm);
  const withHr = (zone: Zone | undefined) => (zone ? hrRange(zone, o.maxHr, o.mafHr) : null);

  for (let i = 0; i < total; i++) {
    const end = addDays(raceDay, -7 * (total - 1 - i));
    const start = addDays(end, -6);
    const isLast = i === total - 1;
    const isBase = i < baseCount;
    const tIdx = tplWeeks - peakCount + (i - baseCount);
    const tw = isBase || !tpl ? null : tpl.weeks[tIdx];

    let slots: IsoDate[] = [];
    for (let d = Math.max(dayNum(start), dayNum(o.todayIso)); d <= dayNum(end); d++) {
      const iso = fromDayNum(d);
      if (o.days.includes(weekdayOf(iso)) && !(isLast && iso === raceDay)) slots.push(iso);
    }
    // Minggu lomba (templat tanpa shake-out): sisakan hari sebelum lomba untuk istirahat bila masih ada ≥ 2 slot lain.
    if (isLast && (!tpl || !tpl.keepPreRaceDay) && slots.length > 2 && slots[slots.length - 1] === addDays(raceDay, -1)) slots = slots.slice(0, -1);

    let drafts: Draft[];
    let plannedKm: number | null = null;
    if (isBase) {
      const V = volumes[i];
      const n = o.days.length <= 1 ? 1 : Math.max(2, Math.min(o.days.length, 1 + Math.floor((V * (1 - BASE_LONG_SHARE)) / MIN_EASY_KM)));
      const easyKm = n > 1 ? Math.min(RECOVERY_MAX_KM, Math.max(MIN_EASY_KM, round1((V * (1 - BASE_LONG_SHARE)) / (n - 1)))) : 0;
      const longKm = n === 1 ? V : round1(Math.max(easyKm + marginKm, Math.min(V - easyKm * (n - 1), V * BASE_LONG_MAX_SHARE)));
      const bj = baseCount - i; // b1 = minggu Base tepat sebelum blok puncak (id stabil seiring waktu)
      const mk = (kind: SessionKind, km: number, k: number): Draft => ({
        id: `b${bj}-${k}`, kind, name: kind === 'long' ? 'Long Run' : 'Easy Run', steps: [], zone: o.curriculum === 'maf' ? 'maf' : 'easy',
        distanceKm: km, durationMin: Math.round((km * o.easyPaceSecPerKm) / 60),
      });
      drafts = n === 1 ? [mk('long', longKm, 0)] : [...Array.from({ length: n - 1 }, (_, k) => mk('recovery', easyKm, k)), mk('long', longKm, n - 1)];
      plannedKm = round1(easyKm * (n - 1) + longKm);
    } else {
      drafts = (tw as NonNullable<typeof tw>).sessions.map((x) => ({
        id: `${tpl!.idPrefix}${tIdx}-${x.key}`, kind: x.kind, name: x.name, steps: x.steps, zone: x.zone,
        distanceKm: x.distanceKm, durationMin: x.durationMin, test: x.test, repKm: x.repKm, fixedWeekday: x.fixedWeekday,
      }));
    }

    const picked = pickSessions(drafts, slots.length).map((k) => drafts[k]);
    const keep = enforceLongMargin(picked, o.easyPaceSecPerKm, Boolean(tpl?.capRecovery && !isBase), !!tw?.deload);
    const placed = assignWeek(keep, slots, ctx);
    const phase: Phase = isCustomNeutral ? (isLast ? 'taper' : 'build') : isBase ? 'base' : isLast ? 'taper' : 'build';

    const sessions: PlanSession[] = placed.map(({ draft, date }) => {
      let { durationMin, distanceKm, name } = draft;
      let note: string | undefined;
      if (phase === 'taper' && tpl?.taperCut) {
        const f = 1 - TAPER_CUT;
        if (durationMin != null) durationMin = Math.round(durationMin * f);
        if (distanceKm != null) distanceKm = round1(distanceKm * f);
        if (draft.kind === 'speed') note = `Taper: kurangi volume ±${Math.round(TAPER_CUT * 100)}% (lebih sedikit pengulangan), pertahankan pace.`;
        else if (durationMin != null) { name = `${durationMin} menit (taper −${Math.round(TAPER_CUT * 100)}%)`; }
      }
      return {
        id: draft.id, weekNo: i + 1, phase, kind: draft.kind, name, steps: draft.steps,
        date, baseDate: date, distanceKm, durationMin, note, demoted: draft.demoted,
        zone: draft.zone, hr: withHr(draft.zone), test: draft.test, repKm: draft.repKm,
      };
    });

    if (isLast) {
      sessions.push({
        id: 'race', weekNo: i + 1, phase: 'race', kind: 'race', name: o.raceName, steps: tpl?.raceSteps ?? [],
        date: raceDay, baseDate: raceDay, distanceKm: null, durationMin: null, zone: 'race', hr: withHr('race'),
      });
    }

    const longS = [...sessions].reverse().find((s) => s.kind === 'long');
    const speedS = [...sessions].reverse().find((s) => s.kind === 'speed');
    ctx = { prevLong: longS?.date ?? ctx.prevLong, prevSpeed: speedS?.date ?? null };
    weeks.push({ weekNo: i + 1, phase, startIso: start, endIso: end, plannedKm, title: tw?.title, deload: tw?.deload, sessions });
  }
  return { weeks, daysRemaining, weeksRemaining, baseWeeks: baseCount, totalWeeks: total };
}

/** Terapkan geser global, tanggal manual, serta prioritaskan sesi kustom dan sesi AI di atas jadwal kalender dasar. */
export function applyScheduleState(plan: Plan, state: ScheduleState, raceIso: IsoDate): Plan {
  const lastAllowed = addDays(raceIso, -1);
  const deletedSet = new Set(state.deletedIds ?? []);
  let weeks: PlanWeek[] = plan.weeks.map((w) => ({
    ...w,
    sessions: state.clearedByUser
      ? []
      : state.customOnly
        ? w.sessions.filter((s) => s.kind === 'race' && !deletedSet.has(s.id))
        : w.sessions
            .filter((s) => !deletedSet.has(s.id))
            .map((s) => {
              if (s.kind === 'race') return s;
              let date = state.overrides[s.id] ?? addDays(s.baseDate, state.shift);
              if (dayNum(date) > dayNum(lastAllowed)) date = lastAllowed;
              return { ...s, date };
            }),
  }));

  const insertOverlay = (overlay: PlanSession[], replaceRaceOnMatch: boolean) => {
    if (overlay.length === 0 || weeks.length === 0) return;
    const coveredDates = new Set(overlay.filter((s) => s.kind !== 'race').map((s) => s.date));
    const hasCustomRace = replaceRaceOnMatch && overlay.some((s) => s.kind === 'race');
    weeks = weeks.map((w) => ({
      ...w,
      sessions: w.sessions.filter((s) => {
        if (s.kind === 'race') return !hasCustomRace;
        return !coveredDates.has(s.date);
      }),
    }));
    for (const item of overlay) {
      let targetIdx = weeks.findIndex((w) => dayNum(w.startIso) <= dayNum(item.date) && dayNum(item.date) <= dayNum(w.endIso));
      if (targetIdx < 0) {
        targetIdx = dayNum(item.date) < dayNum(weeks[0].startIso) ? 0 : weeks.length - 1;
      }
      const targetWeek = weeks[targetIdx];
      const phase: Phase = item.kind === 'race' ? 'race' : targetWeek.phase === 'race' ? 'build' : targetWeek.phase;
      weeks[targetIdx] = {
        ...targetWeek,
        sessions: [...targetWeek.sessions, { ...item, weekNo: targetWeek.weekNo, phase }],
      };
    }
    weeks = weeks.map((w) => ({
      ...w,
      sessions: [...w.sessions].sort(
        (a, b) => dayNum(a.date) - dayNum(b.date) || (a.kind === 'race' ? 1 : b.kind === 'race' ? -1 : 0),
      ),
    }));
  };

  if (state.aiSessions && state.aiSessions.length > 0 && weeks.length > 0) {
    const aiMapped: PlanSession[] = [];
    for (const s of state.aiSessions) {
      if (s.kind === 'race') continue;
      let date = state.overrides[s.id] ?? s.date;
      if (dayNum(date) > dayNum(lastAllowed)) date = lastAllowed;
      aiMapped.push({ ...s, date });
    }
    insertOverlay(aiMapped, false);
  }

  if (state.customSessions && state.customSessions.length > 0 && weeks.length > 0) {
    const customMapped: PlanSession[] = state.customSessions.map((s) => {
      let date = state.overrides[s.id] ?? s.date;
      if (s.kind !== 'race' && dayNum(date) > dayNum(lastAllowed)) date = lastAllowed;
      return { ...s, date };
    });
    insertOverlay(customMapped, true);
  }

  return { ...plan, weeks };
}

export const flattenPlan = (plan: Plan): PlanSession[] =>
  plan.weeks.flatMap((w) => w.sessions).sort((a, b) => dayNum(a.date) - dayNum(b.date) || a.weekNo - b.weekNo);

/** Selesai bila dicentang manual, atau (tanggal ≤ hari ini) ada catatan latihan pada tanggal itu. */
export function completedIds(sessions: PlanSession[], workoutDays: ReadonlySet<IsoDate>, state: ScheduleState, todayIso: IsoDate): Set<string> {
  const out = new Set<string>();
  for (const s of sessions) {
    if (state.done[s.id] || (dayNum(s.date) <= dayNum(todayIso) && workoutDays.has(s.date))) out.add(s.id);
  }
  return out;
}
export const autoCompleted = (s: PlanSession, workoutDays: ReadonlySet<IsoDate>, todayIso: IsoDate): boolean =>
  dayNum(s.date) <= dayNum(todayIso) && workoutDays.has(s.date);
