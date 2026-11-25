import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const MODEL = 'gemini-4-hydrogen';

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
  app.use(express.json({ limit: '256kb' }));

  app.post('/api/race-day-analyze', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        code: 'missing_key',
        error: 'GEMINI_API_KEY belum dikonfigurasi di server.',
      });
      return;
    }

    const body = (req.body ?? {}) as RaceDayRequestBody;
    const s = body.snapshot;
    if (!s || typeof s.targetDistance !== 'string' || typeof s.estimatedFinishSec !== 'number') {
      res.status(400).json({
        code: 'bad_request',
        error: 'Payload snapshot lomba tidak lengkap.',
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
      `- Volume rata-rata 28 hari: ${(s.weeklyKm28 ?? 0).toFixed(1)} km/mgg · Long run terpanjang: ${(s.longestRunKm28 ?? 0).toFixed(1)} km`,
      `- Sepatu utama: ${s.primaryShoeSummary ?? 'Belum diatur'}`,
      `- Total sesi tercatat: ${s.sessionsCount ?? 0}`,
      '',
      'Instruksi ketat:',
      '1. Gunakan teks polos Bahasa Indonesia yang ringkas, padat, dan praktis. DILARANG memakai simbol Markdown (*, **, #, `).',
      '2. healthWarnings: 3 poin maksimal 1–2 baris per poin mencakup risiko ACWR/overtraining, cardiac drift/kelelahan, serta takaran hidrasi & elektrolit sesuai estimasi durasi lomba.',
      '3. pacingStrategy: tepat 3 segmen berurutan (Awal, Pertengahan, Akhir / Negative Split) dengan pace & HR target spesifik.',
      '4. tacticalTips: 3 poin maksimal 1–2 baris per poin mencakup jadwal nutrisi/gel, manajemen tanjakan/cuaca via HR, dan kesiapan sepatu.',
    ].join('\n');

    try {
      const response = await ai.models.generateContent({
        model: MODEL,
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
      });

      const raw = (response.text ?? '').trim();
      if (!raw) {
        res.status(502).json({
          code: 'empty_response',
          error: 'Gemini mengembalikan respons kosong.',
        });
        return;
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      res.json({ analysis: parsed, model: MODEL });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi Gemini API.';
      const status = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
        ? 429
        : msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')
          ? 403
          : 502;
      res.status(status).json({
        code: status === 429 ? 'quota_exceeded' : status === 403 ? 'invalid_key' : 'api_error',
        error: msg,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
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
