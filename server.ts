import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI, Type, type GenerateContentConfig } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

// Contoh .env: GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite (urut prioritas)
const RAW_MODELS = (process.env.GEMINI_MODELS ?? process.env.GEMINI_MODEL ?? 'gemini-4-hydrogen')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const MODELS = RAW_MODELS.length > 0 ? RAW_MODELS : ['gemini-4-hydrogen'];

const ALLOWED_DISTANCES = new Set(['5K', '10K', '21.1K', '42.2K']);
const clean = (v: unknown, max = 80): string | null =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) || null : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

interface RaceDayRequestBody {
  snapshot?: {
    targetDistance?: string;
    raceDateIso?: string | null;
    daysToRace?: number | null;
    estimatedFinishTime?: string;
    estimatedFinishSec?: number;
    targetPacePerKm?: string;
    acwrRatio?: number | null;
    acwrStatus?: string;
    avgDriftPct?: number | null;
    efRecent?: number | null;
    efChangePct?: number | null;
    mafHr?: number | null;
    mafPacePerKm?: string | null;
    raceHrRange?: string | null;
    weeklyKm28?: number;
    longestRunKm28?: number;
    primaryShoeSummary?: string | null;
    sessionsCount?: number;
  };
}

function sanitizeSnapshot(raw: RaceDayRequestBody['snapshot']) {
  if (!raw || !ALLOWED_DISTANCES.has(String(raw.targetDistance)) || num(raw.estimatedFinishSec) == null) {
    return null;
  }
  return {
    targetDistance: String(raw.targetDistance),
    raceDateIso: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.raceDateIso)) ? String(raw.raceDateIso) : null,
    daysToRace: num(raw.daysToRace),
    estimatedFinishTime: clean(raw.estimatedFinishTime, 12),
    estimatedFinishSec: num(raw.estimatedFinishSec) as number,
    targetPacePerKm: clean(raw.targetPacePerKm, 12),
    acwrRatio: num(raw.acwrRatio),
    acwrStatus: clean(raw.acwrStatus, 20),
    avgDriftPct: num(raw.avgDriftPct),
    efRecent: num(raw.efRecent),
    efChangePct: num(raw.efChangePct),
    mafHr: num(raw.mafHr),
    mafPacePerKm: clean(raw.mafPacePerKm, 12),
    raceHrRange: clean(raw.raceHrRange, 20),
    weeklyKm28: num(raw.weeklyKm28) ?? 0,
    longestRunKm28: num(raw.longestRunKm28) ?? 0,
    primaryShoeSummary: clean(raw.primaryShoeSummary, 80),
    sessionsCount: num(raw.sessionsCount) ?? 0,
  };
}

// Pembatas laju sederhana (10 permintaan/menit/IP). Untuk multi-instance, pakai penyimpanan bersama.
const hits = new Map<string, { n: number; reset: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const key = req.ip ?? 'anon';
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + 60_000 });
    return next();
  }
  if (++h.n > 10) {
    res.status(429).json({ code: 'rate_limited', error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
    return;
  }
  next();
}

function httpStatusOf(err: unknown): number {
  const direct = (err as { status?: unknown } | null)?.status;
  if (typeof direct === 'number') return direct;
  const m = err instanceof Error ? /\b([45]\d{2})\b/.exec(err.message) : null;
  return m ? Number(m[1]) : 502;
}

async function generateWithFallback(ai: GoogleGenAI, contents: string, config: GenerateContentConfig) {
  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      return { response: await ai.models.generateContent({ model, contents, config }), model };
    } catch (err) {
      lastErr = err;
      if (![400, 404, 429, 503].includes(httpStatusOf(err))) throw err;
    }
  }
  throw lastErr;
}

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1); // di belakang proxy (AI Studio/Cloud Run) agar req.ip benar
  app.use(express.json({ limit: '256kb' }));

  app.post('/api/race-day-analyze', rateLimit, async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        code: 'missing_key',
        error: 'GEMINI_API_KEY belum dikonfigurasi di server.',
      });
      return;
    }

    const s = sanitizeSnapshot((req.body as RaceDayRequestBody | undefined)?.snapshot);
    if (!s) {
      res.status(400).json({
        code: 'bad_request',
        error: 'Payload snapshot lomba tidak lengkap atau tidak valid.',
      });
      return;
    }

    const prompt = [
      'Analisis kesiapan dan strategi D-Day lomba lari untuk atlet berikut dalam Bahasa Indonesia.',
      'Data Pelari & Latihan:',
      `- Jarak lomba: ${s.targetDistance}`,
      `- Tanggal lomba: ${s.raceDateIso ?? 'Simulasi'} (Sisa hari: ${s.daysToRace != null ? s.daysToRace : 'Simulasi'})`,
      `- Estimasi waktu finis saat ini: ${s.estimatedFinishTime ?? '-'} (${Math.round(s.estimatedFinishSec)} detik)`,
      `- Target pace rata-rata: ${s.targetPacePerKm ?? '-'}`,
      `- ACWR terkini: ${s.acwrRatio != null ? s.acwrRatio.toFixed(2) : 'Belum cukup data'} (status: ${s.acwrStatus ?? 'unknown'})`,
      `- Cardiac drift rata-rata: ${s.avgDriftPct != null ? `${s.avgDriftPct.toFixed(1)}%` : 'Belum ada data'}`,
      `- Efficiency Factor (EF) 14 hari: ${s.efRecent != null ? s.efRecent.toFixed(2) : 'Belum ada data'}${s.efChangePct != null ? ` (perubahan ${s.efChangePct > 0 ? '+' : ''}${s.efChangePct.toFixed(1)}%)` : ''}`,
      `- Zona HR Lomba: ${s.raceHrRange ?? 'Belum diatur'}`,
      `- Pace MAF terbaru: ${s.mafPacePerKm ?? 'Belum tercatat'} (HR MAF: ${s.mafHr ?? '-'})`,
      `- Volume rata-rata 28 hari: ${s.weeklyKm28.toFixed(1)} km/mgg · Long run terpanjang: ${s.longestRunKm28.toFixed(1)} km`,
      `- Sepatu utama: ${s.primaryShoeSummary ?? 'Belum diatur'}`,
      `- Total sesi tercatat: ${s.sessionsCount}`,
      '',
      'Instruksi ketat:',
      '1. Gunakan teks polos Bahasa Indonesia yang ringkas, padat, dan praktis. DILARANG memakai simbol Markdown (*, **, #, `).',
      '2. healthWarnings: 3 poin maksimal 1–2 baris per poin mencakup risiko ACWR/overtraining, cardiac drift/kelelahan, serta takaran hidrasi & elektrolit sesuai estimasi durasi lomba.',
      '3. pacingStrategy: tepat 3 segmen berurutan (Awal, Pertengahan, Akhir / Negative Split) dengan pace & HR target spesifik.',
      '4. tacticalTips: 3 poin maksimal 1–2 baris per poin mencakup jadwal nutrisi/gel, manajemen tanjakan/cuaca via HR, dan kesiapan sepatu.',
    ].join('\n');

    const config: GenerateContentConfig = {
      systemInstruction:
        'Anda adalah pelatih lari jarak jauh dan ahli fisiologi olahraga. Kembalikan hanya JSON sesuai schema tanpa karakter bintang atau Markdown.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          readinessStatus: {
            type: Type.STRING,
            enum: ['aman', 'waspada', 'risiko_tinggi'],
            description: 'Status kesiapan fisik menjelang hari lomba.',
          },
          readinessHeadline: {
            type: Type.STRING,
            description: 'Satu kalimat ringkas kesimpulan kesiapan D-Day.',
          },
          healthWarnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Peringatan kesehatan, risiko ACWR, kelelahan/drift, dan hidrasi/elektrolit.',
          },
          pacingStrategy: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                phase: { type: Type.STRING },
                targetPace: { type: Type.STRING },
                targetHr: { type: Type.STRING },
                cue: { type: Type.STRING },
              },
              required: ['phase', 'targetPace', 'targetHr', 'cue'],
            },
            description: '3 fase strategi pacing: Awal, Pertengahan, Akhir (Negative Split).',
          },
          tacticalTips: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Tips nutrisi/gel, manajemen tanjakan/cuaca, dan pengingat sepatu.',
          },
        },
        required: [
          'readinessStatus',
          'readinessHeadline',
          'healthWarnings',
          'pacingStrategy',
          'tacticalTips',
        ],
      },
    };

    try {
      const { response, model } = await generateWithFallback(ai, prompt, config);

      const raw = (response.text ?? '').trim();
      if (!raw) {
        res.status(502).json({
          code: 'empty_response',
          error: 'Gemini mengembalikan respons kosong.',
        });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.status(502).json({
          code: 'invalid_json',
          error: 'Respons AI bukan JSON valid.',
        });
        return;
      }
      res.json({ analysis: parsed, model });
    } catch (err) {
      console.error('[race-day-analyze]', err);
      const status = httpStatusOf(err);
      if (status === 429) {
        res.status(429).json({ code: 'quota_exceeded', error: 'Kuota AI habis. Coba lagi nanti.' });
        return;
      }
      if (status === 401 || status === 403) {
        res.status(403).json({ code: 'invalid_key', error: 'API key server ditolak.' });
        return;
      }
      res.status(502).json({ code: 'api_error', error: 'Layanan AI sedang bermasalah.' });
    }
  });

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      console.error('Folder dist/ belum ada. Jalankan "npm run build" sebelum "npm start".');
      process.exit(1);
    }
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PACELAB server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
