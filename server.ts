import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import {
  buildRaceDayPrompt,
  createRateLimiter,
  resolveModels,
  runWithModelFallback,
  sanitizeSnapshot,
  toClientError,
  withTimeout,
} from './src/server/raceDayAi.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const MODELS = resolveModels(process.env);
const REQUEST_TIMEOUT_MS = 40_000;
const rateLimit = createRateLimiter({ max: 10, windowMs: 60_000 });

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
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/', (req, res, next) => {
    const r = rateLimit(req.ip ?? 'anon');
    if (!r.allowed) {
      res.set('Retry-After', String(r.retryAfterSec));
      res.status(429).json({ code: 'rate_limited', error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
      return;
    }
    next();
  });

  app.post('/api/race-day-analyze', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        code: 'missing_key',
        error: 'GEMINI_API_KEY belum dikonfigurasi di server.',
      });
      return;
    }

    const snapshot = sanitizeSnapshot((req.body as { snapshot?: unknown } | undefined)?.snapshot);
    if (!snapshot) {
      res.status(400).json({
        code: 'bad_request',
        error: 'Payload snapshot lomba tidak lengkap atau tidak valid.',
      });
      return;
    }

    const prompt = buildRaceDayPrompt(snapshot);

    try {
      const { result: response, model } = await runWithModelFallback(MODELS, (modelName) =>
        withTimeout(
          ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
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
            },
          }),
          REQUEST_TIMEOUT_MS,
        ),
      );

      const raw = (response.text ?? '').trim();
      if (!raw) {
        res.status(502).json({
          code: 'empty_response',
          error: 'Gemini mengembalikan respons kosong.',
        });
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        res.status(502).json({
          code: 'invalid_json',
          error: 'Respons AI bukan JSON yang valid.',
        });
        return;
      }
      res.json({ analysis: parsed, model });
    } catch (err) {
      console.error('[race-day-analyze]', err); // detail mentah hanya di log server
      const e = toClientError(err);
      res.status(e.status).json({ code: e.code, error: e.error });
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
