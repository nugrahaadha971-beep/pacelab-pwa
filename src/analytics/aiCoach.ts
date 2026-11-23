import type { RaceDistance, UserProfile, Workout, WorkoutType } from './types.ts';
import type { Acwr, EfTrend } from './workload.ts';
import type { CurriculumId } from '../plans/schedule.ts';
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

function modelEndpoint(model: string): string {
  return `${GEMINI_API_BASE}/${normalizeModelName(model)}:generateContent`;
}

function modelVersionScore(name: string): number {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(name);
  return m ? Number(m[1]) : 0;
}

function modelPriorityScore(rawName: string): number {
  const n = rawName.toLowerCase();
  let score = modelVersionScore(n) * 100;
  if (!n.includes('exp') && !n.includes('thinking')) score += 20;
  if (!n.includes('preview')) score += 5;
  if (!n.includes('lite')) score += 3;
  if (n.includes('tts') || n.includes('image') || n.includes('audio') || n.includes('live')) score -= 1000;
  return score;
}

async function callGenerateContent(
  fetchFn: typeof fetch,
  model: string,
  apiKey: string,
  prompt: string,
): Promise<Response> {
  try {
    return await fetchFn(modelEndpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
  } catch {
    throw new AiCoachError(
      'network',
      'Gagal terhubung ke server Gemini. Periksa koneksi internet Anda lalu coba lagi.',
    );
  }
}

async function findFallbackFlashModel(
  fetchFn: typeof fetch,
  apiKey: string,
  excludeModel?: string,
): Promise<string | null> {
  let listRes: Response;
  try {
    listRes = await fetchFn(GEMINI_API_BASE, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
      },
    });
  } catch {
    return null;
  }

  if (!listRes.ok) return null;
  const data = (await listRes.json().catch(() => null)) as GeminiModelsListResponse | null;
  const models = data?.models ?? [];
  const excluded = excludeModel ? normalizeModelName(excludeModel).toLowerCase() : '';

  const candidates = models
    .map((m) => ({
      clean: normalizeModelName(m.name ?? ''),
      methods: m.supportedGenerationMethods ?? [],
    }))
    .filter((m) => {
      const lower = m.clean.toLowerCase();
      return (
        Boolean(m.clean) &&
        lower !== excluded &&
        m.methods.includes('generateContent') &&
        lower.includes('flash')
      );
    })
    .sort((a, b) => {
      const diff = modelPriorityScore(b.clean) - modelPriorityScore(a.clean);
      return diff !== 0 ? diff : b.clean.localeCompare(a.clean);
    });

  return candidates[0]?.clean ?? null;
}

export async function requestAiCoachAnalysis(
  ctx: AiCoachContext,
  opts: RequestAiCoachOptions = {},
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
  const prompt = buildAiCoachPrompt(ctx);
  const activeModel = loadGeminiModel();

  let res = await callGenerateContent(fetchFn, activeModel, apiKey, prompt);

  if (res.status === 404) {
    const fallbackModel = await findFallbackFlashModel(fetchFn, apiKey, activeModel);
    if (fallbackModel) {
      res = await callGenerateContent(fetchFn, fallbackModel, apiKey, prompt);
      if (res.ok) saveGeminiModel(fallbackModel);
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
