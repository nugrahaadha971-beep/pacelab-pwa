import type { RaceDistance, UserProfile, Workout, WorkoutType } from './types.ts';
import type { Acwr, EfTrend } from './workload.ts';
import { dayNum, isoFromLocal, isoFromRaceTs, isValidIso, WEEKDAY_SHORT } from '../plans/schedule.ts';
import type { CurriculumId, IsoDate, PlanSession } from '../plans/schedule.ts';
import type { SessionKind } from '../plans/nike5k.ts';
import type { Zone } from '../plans/hrZones.ts';
import { fmtPace } from '../plans/pace.ts';
import { PLAN_LABEL } from '../plans/planSelector.ts';

export const GEMINI_API_KEY_STORAGE_KEY = 'pacelab_gemini_api_key';
export const GEMINI_MODEL_STORAGE_KEY = 'pacelab_gemini_model';
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_ENDPOINT = `${GEMINI_API_BASE}/${DEFAULT_GEMINI_MODEL}:generateContent`;

const WORKOUT_TYPE_ID: Record<WorkoutType, string> = {
  easy: 'Easy Run',
  tempo: 'Tempo Run',
  interval: 'Interval',
  long_run: 'Long Run',
  race: 'Lomba',
};

const ACWR_STATUS_ID: Record<Acwr['status'], string> = {
  unknown: 'Data belum cukup',
  undertraining: 'Beban rendah (<0,8)',
  sweet_spot: 'Optimal (0,8–1,3)',
  high_fatigue: 'Kelelahan tinggi (>1,3)',
};

export type AiCoachErrorCode =
  | 'missing_key'
  | 'offline'
  | 'proxy_disabled'
  | 'invalid_key'
  | 'quota_exceeded'
  | 'bad_request'
  | 'network'
  | 'empty_response'
  | 'invalid_json'
  | 'api_error';

export class AiCoachError extends Error {
  readonly code: AiCoachErrorCode;
  constructor(code: AiCoachErrorCode, message: string) {
    super(message);
    this.name = 'AiCoachError';
    this.code = code;
  }
}

export function loadGeminiApiKey(): string {
  try {
    return (localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function saveGeminiApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  try {
    if (!trimmed) localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    else localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
  } catch {
    throw new Error('Gagal menyimpan API Key ke penyimpanan lokal browser.');
  }
}

export function clearGeminiApiKey(): void {
  try {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    /* penyimpanan tidak tersedia: abaikan */
  }
}

function normalizeModelName(model: string): string {
  return model.replace(/^models\//, '').trim();
}

export function loadGeminiModel(): string {
  try {
    const saved = normalizeModelName(localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) ?? '');
    return saved || DEFAULT_GEMINI_MODEL;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function saveGeminiModel(model: string): void {
  const clean = normalizeModelName(model);
  try {
    if (!clean) localStorage.removeItem(GEMINI_MODEL_STORAGE_KEY);
    else localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, clean);
  } catch {
    /* penyimpanan tidak tersedia: abaikan */
  }
}

function fmtShortDateId(ts: number): string {
  return new Date(ts).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDurationMinSec(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface AiCoachContext {
  profile: Pick<UserProfile, 'age' | 'targetDistance' | 'targetRaceDate'>;
  curriculum: CurriculumId;
  acwr: Acwr;
  efTrend: EfTrend;
  latestMafPaceSec: number | null;
  workouts: Workout[];
  now?: number;
}

export interface AiCoachSummaryData {
  age: number;
  curriculumLabel: string;
  targetDistance: RaceDistance;
  targetRaceDateText: string;
  acwrText: string;
  efTrendText: string;
  latestMafPaceText: string;
  recentSessionsText: string[];
}

export function buildAiCoachSummary(ctx: AiCoachContext): AiCoachSummaryData {
  const curriculumLabel = PLAN_LABEL[ctx.curriculum] ?? ctx.curriculum;
  const targetRaceDateText =
    ctx.profile.targetRaceDate > 0 ? fmtShortDateId(ctx.profile.targetRaceDate) : 'Belum diatur';

  const acwrText =
    ctx.acwr.ratio != null
      ? `${ctx.acwr.ratio.toFixed(2)} (${ACWR_STATUS_ID[ctx.acwr.status]})`
      : ACWR_STATUS_ID[ctx.acwr.status];

  let efTrendText = 'Belum cukup data (butuh sesi aerobik di 2 periode 14 hari)';
  if (ctx.efTrend.recent != null && ctx.efTrend.changePct != null) {
    const sign = ctx.efTrend.changePct > 0 ? '+' : '';
    const direction = ctx.efTrend.improving
      ? 'meningkat'
      : ctx.efTrend.changePct < -2
        ? 'menurun'
        : 'stabil';
    efTrendText = `EF 14 hari terakhir ${ctx.efTrend.recent.toFixed(2)} (${sign}${ctx.efTrend.changePct.toFixed(1)}% vs 14 hari sebelumnya, ${direction})`;
  } else if (ctx.efTrend.recent != null) {
    efTrendText = `EF 14 hari terakhir ${ctx.efTrend.recent.toFixed(2)} (belum ada pembanding sebelumnya)`;
  }

  const latestMafPaceText =
    ctx.latestMafPaceSec != null && Number.isFinite(ctx.latestMafPaceSec) && ctx.latestMafPaceSec > 0
      ? `${fmtPace(ctx.latestMafPaceSec)} /km`
      : 'Belum ada catatan di zona MAF';

  const cutoff = ctx.now;
  const recent = [...ctx.workouts]
    .filter((w) => (cutoff == null ? true : w.date <= cutoff))
    .sort((a, b) => b.date - a.date)
    .slice(0, 7);

  const recentSessionsText = recent.map((w) => {
    const pace =
      w.avgPaceSecPerKm > 0
        ? fmtPace(w.avgPaceSecPerKm)
        : w.distanceKm > 0
          ? fmtPace(w.durationSec / w.distanceKm)
          : '-';
    const parts = [
      fmtShortDateId(w.date),
      WORKOUT_TYPE_ID[w.workoutType] ?? w.workoutType,
      `${w.distanceKm.toFixed(1)} km`,
      fmtDurationMinSec(w.durationSec),
      `pace ${pace}/km`,
    ];
    if (w.avgHr != null) parts.push(`HR ${Math.round(w.avgHr)} bpm`);
    if (w.rpe != null) parts.push(`RPE ${w.rpe}/10`);
    return parts.join(' · ');
  });

  return {
    age: ctx.profile.age,
    curriculumLabel,
    targetDistance: ctx.profile.targetDistance,
    targetRaceDateText,
    acwrText,
    efTrendText,
    latestMafPaceText,
    recentSessionsText,
  };
}

export function buildAiCoachPrompt(ctx: AiCoachContext): string {
  const s = buildAiCoachSummary(ctx);
  const sessionsBlock =
    s.recentSessionsText.length > 0
      ? s.recentSessionsText.map((line, i) => `${i + 1}. ${line}`).join('\n')
      : 'Belum ada sesi latihan tercatat.';

  return [
    'Anda adalah pelatih lari pribadi berbasis sains olahraga. Berikan evaluasi latihan personal dan rekomendasi sesi berikutnya dalam Bahasa Indonesia.',
    'Aturan jawaban: tulis tepat 3–4 poin ringkas (pakai awalan "- "), langsung ke inti, praktis, dan tanpa basa-basi pembuka/penutup.',
    '',
    'Ringkasan Pelari:',
    `- Usia: ${s.age} tahun`,
    `- Kurikulum aktif: ${s.curriculumLabel}`,
    `- Target lomba: ${s.targetDistance} (Tanggal: ${s.targetRaceDateText})`,
    `- Nilai ACWR: ${s.acwrText}`,
    `- Tren Efficiency Factor (EF): ${s.efTrendText}`,
    `- Pace MAF terbaru: ${s.latestMafPaceText}`,
    '- Maksimal 7 sesi terakhir:',
    sessionsBlock,
  ].join('\n');
}

export interface RequestAiCoachOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  isOnline?: boolean;
  retryDelayMs?: number;
}

interface GeminiApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}

interface GeminiModelInfo {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiModelsListResponse {
  models?: GeminiModelInfo[];
}

const RETRY_503_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelEndpoint(model: string): string {
  return `${GEMINI_API_BASE}/${normalizeModelName(model)}:generateContent`;
}

function modelVersionScore(name: string): number {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(name);
  return m ? Number(m[1]) : 0;
}

function isMediaOnlyModel(lowerName: string): boolean {
  return (
    lowerName.includes('tts') ||
    lowerName.includes('image') ||
    lowerName.includes('audio') ||
    lowerName.includes('live') ||
    lowerName.includes('transcribe')
  );
}

function modelPriorityScore(rawName: string): number {
  const n = normalizeModelName(rawName).toLowerCase();
  if (n === DEFAULT_GEMINI_MODEL) return 400_000;
  const ver = modelVersionScore(n) * 100;
  const stability = (!n.includes('exp') && !n.includes('thinking') ? 20 : 0) + (!n.includes('preview') ? 5 : 0);
  if (n.includes('flash') && !n.includes('flash-lite')) return 300_000 + ver + stability;
  if (n.includes('flash-lite')) return 200_000 + ver + stability;
  if (n.includes('pro')) return 100_000 + ver + stability;
  return 0;
}

function isFallbackStatus(status: number): boolean {
  return status === 503 || status === 429 || status === 404;
}

async function callGenerateContent(
  fetchFn: typeof fetch,
  model: string,
  apiKey: string,
  prompt: string,
  generationConfig?: Record<string, unknown>,
): Promise<Response> {
  const payload: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  if (generationConfig) {
    payload.generationConfig = generationConfig;
  }
  try {
    return await fetchFn(modelEndpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AiCoachError(
      'network',
      'Gagal terhubung ke server Gemini. Periksa koneksi internet Anda lalu coba lagi.',
    );
  }
}

async function attemptModel(
  fetchFn: typeof fetch,
  model: string,
  apiKey: string,
  prompt: string,
  retryDelayMs: number,
  generationConfig?: Record<string, unknown>,
): Promise<Response> {
  let res = await callGenerateContent(fetchFn, model, apiKey, prompt, generationConfig);
  if (res.status === 503) {
    await sleep(retryDelayMs);
    res = await callGenerateContent(fetchFn, model, apiKey, prompt, generationConfig);
  }
  return res;
}

async function findFallbackCandidates(
  fetchFn: typeof fetch,
  apiKey: string,
  excludeModel?: string,
): Promise<string[]> {
  let listRes: Response;
  try {
    listRes = await fetchFn(GEMINI_API_BASE, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
      },
    });
  } catch {
    return [];
  }

  if (!listRes.ok) return [];
  const data = (await listRes.json().catch(() => null)) as GeminiModelsListResponse | null;
  const models = data?.models ?? [];
  const excluded = excludeModel ? normalizeModelName(excludeModel).toLowerCase() : '';
  const seen = new Set<string>(excluded ? [excluded] : []);

  const candidates = models
    .map((m) => ({
      clean: normalizeModelName(m.name ?? ''),
      methods: m.supportedGenerationMethods ?? [],
    }))
    .filter((m) => {
      const lower = m.clean.toLowerCase();
      if (!m.clean || seen.has(lower)) return false;
      if (!m.methods.includes('generateContent')) return false;
      if (isMediaOnlyModel(lower)) return false;
      if (!lower.includes('flash') && !lower.includes('pro')) return false;
      seen.add(lower);
      return true;
    })
    .sort((a, b) => {
      const diff = modelPriorityScore(b.clean) - modelPriorityScore(a.clean);
      return diff !== 0 ? diff : b.clean.localeCompare(a.clean);
    })
    .map((m) => m.clean);

  return candidates;
}

async function callGeminiText(
  prompt: string,
  opts: RequestAiCoachOptions = {},
  generationConfig?: Record<string, unknown>,
): Promise<string> {
  const apiKey = (opts.apiKey ?? loadGeminiApiKey()).trim();
  if (!apiKey) {
    throw new AiCoachError(
      'missing_key',
      'API Key Gemini belum diisi. Simpan API Key Anda di tab Profil terlebih dahulu.',
    );
  }

  const online =
    opts.isOnline ?? (typeof navigator !== 'undefined' ? navigator.onLine : true);
  if (!online) {
    throw new AiCoachError(
      'offline',
      'Perangkat sedang offline. Hubungkan ke internet untuk memakai Analisis Mendalam AI.',
    );
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const retryDelayMs = opts.retryDelayMs ?? RETRY_503_DELAY_MS;
  const activeModel = loadGeminiModel();

  let res = await attemptModel(fetchFn, activeModel, apiKey, prompt, retryDelayMs, generationConfig);
  if (res.ok) {
    saveGeminiModel(activeModel);
  } else if (isFallbackStatus(res.status)) {
    const candidates = await findFallbackCandidates(fetchFn, apiKey, activeModel);
    for (const candidate of candidates) {
      res = await attemptModel(fetchFn, candidate, apiKey, prompt, retryDelayMs, generationConfig);
      if (res.ok) {
        saveGeminiModel(candidate);
        break;
      }
      if (!isFallbackStatus(res.status)) {
        break;
      }
    }
  }

  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    if (rawText.includes('PROXY_GENERATION_DISABLED')) {
      throw new AiCoachError(
        'proxy_disabled',
        'Preview AI Studio memblokir panggilan langsung ke Gemini API. Push ke GitHub dan buka aplikasi dari URL GitHub Pages Anda untuk menggunakan AI Coach.',
      );
    }

    let errData: GeminiApiErrorBody | null = null;
    try {
      errData = rawText ? (JSON.parse(rawText) as GeminiApiErrorBody) : null;
    } catch {
      errData = null;
    }
    const apiMessage = errData?.error?.message?.trim() ?? '';
    const statusText = errData?.error?.status ?? '';

    if (res.status === 429 || statusText === 'RESOURCE_EXHAUSTED') {
      throw new AiCoachError(
        'quota_exceeded',
        apiMessage
          ? `Gemini (429): ${apiMessage}`
          : 'Kuota API Gemini habis atau batas permintaan tercapai (429). Coba lagi nanti atau periksa kuota akun Google AI Anda.',
      );
    }

    if (
      res.status === 401 ||
      res.status === 403 ||
      statusText === 'PERMISSION_DENIED' ||
      (res.status === 400 && /api[_ ]?key|key not valid|invalid.*key/i.test(apiMessage))
    ) {
      throw new AiCoachError(
        'invalid_key',
        apiMessage
          ? `Gemini (${res.status}): ${apiMessage}`
          : `API Key Gemini tidak valid atau ditolak (${res.status}). Periksa kembali key Anda di tab Profil.`,
      );
    }

    if (res.status === 400) {
      throw new AiCoachError(
        'bad_request',
        apiMessage ? `Gemini (400): ${apiMessage}` : 'Permintaan ke Gemini tidak valid (400).',
      );
    }

    throw new AiCoachError(
      'api_error',
      apiMessage
        ? `Gemini (${res.status}): ${apiMessage}`
        : rawText.trim()
          ? `Gemini (${res.status}): ${rawText.trim()}`
          : `Layanan Gemini mengalami gangguan (${res.status}). Silakan coba lagi nanti.`,
    );
  }

  const data = (await res.json().catch(() => null)) as GeminiGenerateResponse | null;
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('\n')
    .trim();

  if (!text) {
    throw new AiCoachError(
      'empty_response',
      'Gemini tidak memberikan respons teks. Silakan coba beberapa saat lagi.',
    );
  }

  return text;
}

export async function requestAiCoachAnalysis(
  ctx: AiCoachContext,
  opts: RequestAiCoachOptions = {},
): Promise<string> {
  return callGeminiText(buildAiCoachPrompt(ctx), opts);
}

/** Memecah output poin Gemini menjadi daftar bersih untuk dirender di UI. */
export function parseCoachPoints(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1').trim())
    .filter(Boolean);
  return lines.slice(0, 6);
}

// ───────────────────────── AI Training Plan Generator ─────────────────────────

export interface AiTrainingPlanInput {
  profile: Pick<UserProfile, 'age' | 'restingHr' | 'maxHr' | 'targetDistance' | 'targetRaceDate' | 'targetTimeSec'>;
  curriculum: CurriculumId;
  trainingDays: number[];
  acwr: Acwr;
  efTrend: EfTrend;
  latestDriftPct: number | null;
  weeklyVolumeKm: number;
  latestAvgPaceSec: number | null;
  workouts: Workout[];
  todayIso?: IsoDate;
  now?: number;
}

export interface AiTrainingPlanResult {
  summary: string;
  sessions: PlanSession[];
}

const VALID_PLAN_KINDS: readonly Exclude<SessionKind, 'race'>[] = ['recovery', 'long', 'speed'];

export function buildAiTrainingPlanPrompt(input: AiTrainingPlanInput): string {
  const now = input.now ?? Date.now();
  const todayIso = input.todayIso ?? isoFromLocal(now);
  const raceIso = input.profile.targetRaceDate > 0 ? isoFromRaceTs(input.profile.targetRaceDate) : null;
  const curriculumLabel = PLAN_LABEL[input.curriculum] ?? input.curriculum;
  const daysText = input.trainingDays.length > 0
    ? input.trainingDays.map((d) => WEEKDAY_SHORT[d] ?? String(d)).join(', ')
    : 'Sel, Kam, Sab, Min';

  const acwrText =
    input.acwr.ratio != null
      ? `${input.acwr.ratio.toFixed(2)} (${ACWR_STATUS_ID[input.acwr.status]})`
      : ACWR_STATUS_ID[input.acwr.status];

  let efText = 'Belum cukup data';
  if (input.efTrend.recent != null && input.efTrend.changePct != null) {
    const sign = input.efTrend.changePct > 0 ? '+' : '';
    efText = `${input.efTrend.recent.toFixed(2)} (${sign}${input.efTrend.changePct.toFixed(1)}% vs 14 hari sebelumnya)`;
  } else if (input.efTrend.recent != null) {
    efText = `${input.efTrend.recent.toFixed(2)} (belum ada pembanding)`;
  }

  const driftText =
    input.latestDriftPct != null && Number.isFinite(input.latestDriftPct)
      ? `${input.latestDriftPct.toFixed(1)}%`
      : 'Belum ada data';

  const latestPaceText =
    input.latestAvgPaceSec != null && Number.isFinite(input.latestAvgPaceSec) && input.latestAvgPaceSec > 0
      ? `${fmtPace(input.latestAvgPaceSec)} /km`
      : 'Belum ada data';

  const recentWorkouts = [...input.workouts]
    .filter((w) => w.date <= now)
    .sort((a, b) => b.date - a.date)
    .slice(0, 10);

  const historyBlock =
    recentWorkouts.length > 0
      ? recentWorkouts
          .map((w, i) => {
            const pace =
              w.avgPaceSecPerKm > 0
                ? fmtPace(w.avgPaceSecPerKm)
                : w.distanceKm > 0
                  ? fmtPace(w.durationSec / w.distanceKm)
                  : '-';
            const parts = [
              isoFromLocal(w.date),
              WORKOUT_TYPE_ID[w.workoutType] ?? w.workoutType,
              `${w.distanceKm.toFixed(1)} km`,
              fmtDurationMinSec(w.durationSec),
              `pace ${pace}/km`,
            ];
            if (w.avgHr != null) parts.push(`HR ${Math.round(w.avgHr)} bpm`);
            if (w.rpe != null) parts.push(`RPE ${w.rpe}/10`);
            return `${i + 1}. ${parts.join(' · ')}`;
          })
          .join('\n')
      : 'Belum ada riwayat latihan tercatat.';

  return [
    'Anda adalah pelatih lari pribadi berbasis sains olahraga. Susun program latihan terstruktur untuk 2–4 minggu ke depan (atau hingga sebelum hari lomba bila lebih dekat) dalam Bahasa Indonesia.',
    'Kembalikan HANYA JSON valid tanpa teks tambahan di luar JSON, sesuai skema persis berikut:',
    '{ "summary": string, "sessions": [{ "date": "YYYY-MM-DD", "kind": "recovery" | "long" | "speed", "name": string, "distanceKm": number | null, "durationMin": number | null, "hr": [number, number] | null, "steps": string[], "note": string }] }',
    '',
    'Aturan penyusunan:',
    `- Tanggal hari ini: ${todayIso}. Tanggal sesi harus >= ${todayIso}${raceIso ? ` dan WAJIB lebih awal dari tanggal lomba (${raceIso}) — jangan buat sesi pada atau setelah ${raceIso}` : ''}.`,
    `- Utamakan hari latihan rutin pelari: ${daysText}.`,
    `- Sesuaikan beban dan jenis sesi dengan kurikulum aktif (${curriculumLabel} / ${input.curriculum}), nilai ACWR, tren EF, dan cardiac drift.`,
    '- Gunakan kind "recovery" untuk lari santai/pemulihan, "long" untuk lari terjauh mingguan, dan "speed" untuk interval/tempo/tes (jika kurikulum maf, hindari speed berat kecuali tes MAF).',
    '- Untuk recovery/long sertakan durationMin dan distanceKm yang realistis; untuk speed sertakan durationMin, steps detail (pemanasan, ulangan, pendinginan), dan note.',
    '',
    'Profil Pelari:',
    `- Usia: ${input.profile.age} tahun`,
    `- HR istirahat: ${input.profile.restingHr} bpm`,
    `- HR maksimal: ${input.profile.maxHr} bpm`,
    `- Target jarak lomba: ${input.profile.targetDistance}`,
    `- Tanggal target lomba: ${raceIso ?? 'Belum diatur'}`,
    `- Target waktu lomba: ${fmtDurationMinSec(input.profile.targetTimeSec)}`,
    '',
    'Metrik Terkini:',
    `- Kurikulum aktif: ${curriculumLabel} (${input.curriculum})`,
    `- Hari latihan rutin: ${daysText}`,
    `- ACWR: ${acwrText}`,
    `- Tren EF: ${efText}`,
    `- Cardiac drift terakhir: ${driftText}`,
    `- Volume mingguan rata-rata (28 hari): ${input.weeklyVolumeKm.toFixed(1)} km/minggu`,
    `- Pace rata-rata terbaru: ${latestPaceText}`,
    '',
    'Maksimal 10 riwayat sesi terakhir:',
    historyBlock,
  ].join('\n');
}

function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

export function parseAiTrainingPlanResponse(raw: string, input: AiTrainingPlanInput): AiTrainingPlanResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonCodeFence(raw));
  } catch {
    throw new AiCoachError(
      'invalid_json',
      'Respons jadwal AI bukan JSON yang valid. Silakan coba susun ulang jadwal.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AiCoachError('invalid_json', 'Struktur respons jadwal AI tidak valid.');
  }

  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!summary) {
    throw new AiCoachError('invalid_json', 'Ringkasan analisis dari AI tidak boleh kosong.');
  }

  if (!Array.isArray(obj.sessions) || obj.sessions.length === 0) {
    throw new AiCoachError('invalid_json', 'Daftar sesi jadwal AI kosong atau tidak valid.');
  }

  const raceIso = input.profile.targetRaceDate > 0 ? isoFromRaceTs(input.profile.targetRaceDate) : null;
  const raceDayNum = raceIso ? dayNum(raceIso) : null;

  const sessions: PlanSession[] = obj.sessions.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new AiCoachError('invalid_json', `Sesi AI ke-${index + 1} tidak berbentuk objek yang valid.`);
    }
    const r = item as Record<string, unknown>;

    const date = r.date;
    if (!isValidIso(date)) {
      throw new AiCoachError('invalid_json', `Tanggal sesi AI ke-${index + 1} tidak valid.`);
    }
    if (raceDayNum != null && dayNum(date) >= raceDayNum) {
      throw new AiCoachError(
        'invalid_json',
        `Tanggal sesi AI (${date}) melewati atau jatuh pada hari lomba (${raceIso}).`,
      );
    }

    if (typeof r.kind !== 'string' || !VALID_PLAN_KINDS.includes(r.kind as Exclude<SessionKind, 'race'>)) {
      throw new AiCoachError('invalid_json', `Jenis sesi AI ke-${index + 1} tidak valid.`);
    }
    const kind = r.kind as Exclude<SessionKind, 'race'>;

    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) {
      throw new AiCoachError('invalid_json', `Nama sesi AI ke-${index + 1} tidak boleh kosong.`);
    }

    let distanceKm: number | null = null;
    if (r.distanceKm !== null && r.distanceKm !== undefined) {
      if (typeof r.distanceKm !== 'number' || !Number.isFinite(r.distanceKm) || r.distanceKm <= 0) {
        throw new AiCoachError('invalid_json', `Jarak sesi AI ke-${index + 1} tidak valid.`);
      }
      distanceKm = Math.round(r.distanceKm * 10) / 10;
    }

    let durationMin: number | null = null;
    if (r.durationMin !== null && r.durationMin !== undefined) {
      if (typeof r.durationMin !== 'number' || !Number.isFinite(r.durationMin) || r.durationMin <= 0) {
        throw new AiCoachError('invalid_json', `Durasi sesi AI ke-${index + 1} tidak valid.`);
      }
      durationMin = Math.round(r.durationMin);
    }

    let hr: [number, number] | null = null;
    if (r.hr !== null && r.hr !== undefined) {
      if (
        !Array.isArray(r.hr) ||
        r.hr.length !== 2 ||
        typeof r.hr[0] !== 'number' ||
        typeof r.hr[1] !== 'number' ||
        !Number.isFinite(r.hr[0]) ||
        !Number.isFinite(r.hr[1]) ||
        r.hr[0] <= 0 ||
        r.hr[1] < r.hr[0]
      ) {
        throw new AiCoachError('invalid_json', `Target detak jantung sesi AI ke-${index + 1} tidak valid.`);
      }
      hr = [Math.round(r.hr[0]), Math.round(r.hr[1])];
    }

    if (!Array.isArray(r.steps) || r.steps.some((s) => typeof s !== 'string')) {
      throw new AiCoachError('invalid_json', `Langkah sesi AI ke-${index + 1} harus berupa daftar teks.`);
    }
    const steps = r.steps.map((s) => s.trim()).filter(Boolean);

    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined;
    const zone: Zone = kind === 'speed' ? 'interval' : input.curriculum === 'maf' ? 'maf' : 'easy';

    return {
      id: `ai-${date}-${index}`,
      weekNo: 1,
      phase: 'build',
      kind,
      name,
      steps,
      date,
      baseDate: date,
      distanceKm,
      durationMin,
      zone,
      hr,
      ...(note ? { note } : {}),
    };
  });

  return { summary, sessions };
}

export async function generateAiTrainingPlan(
  input: AiTrainingPlanInput,
  opts: RequestAiCoachOptions = {},
): Promise<AiTrainingPlanResult> {
  const prompt = buildAiTrainingPlanPrompt(input);
  const raw = await callGeminiText(prompt, opts, {
    responseMimeType: 'application/json',
    temperature: 0.4,
  });
  return parseAiTrainingPlanResponse(raw, input);
}
