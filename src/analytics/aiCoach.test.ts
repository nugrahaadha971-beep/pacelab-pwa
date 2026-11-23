import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiCoachError,
  buildAiCoachPrompt,
  buildAiCoachSummary,
  clearGeminiApiKey,
  GEMINI_API_KEY_STORAGE_KEY,
  GEMINI_ENDPOINT,
  loadGeminiApiKey,
  parseCoachPoints,
  requestAiCoachAnalysis,
  saveGeminiApiKey,
} from './aiCoach.ts';
import type { Workout } from './types.ts';

function makeWorkout(idx: number, daysAgo: number): Workout {
  const now = Date.UTC(2026, 10, 22, 6, 0, 0);
  return {
    id: idx,
    date: now - daysAgo * 86_400_000,
    source: 'manual',
    workoutType: idx % 2 === 0 ? 'easy' : 'tempo',
    distanceKm: 5 + idx * 0.5,
    durationSec: 1800 + idx * 120,
    avgPaceSecPerKm: 360,
    avgHr: 145,
    maxHr: 165,
    avgCadence: 174,
    elevationGain: 20,
    rpe: 5,
    laps: [
      { km: 1, paceSec: 360, avgHr: 140 },
      { km: 2, paceSec: 360, avgHr: 145 },
      { km: 3, paceSec: 360, avgHr: 148 },
      { km: 4, paceSec: 360, avgHr: 150 },
    ],
  };
}

const baseContext = () => {
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);
  const workouts = Array.from({ length: 10 }, (_, i) => makeWorkout(i + 1, i));
  return {
    profile: {
      age: 34,
      targetDistance: '10K' as const,
      targetRaceDate: Date.UTC(2027, 0, 31),
    },
    curriculum: 'maf' as const,
    acwr: { acute: 120, chronicWeekly: 110, ratio: 1.09, status: 'sweet_spot' as const },
    efTrend: { recent: 1.45, prior: 1.38, changePct: 5.07, improving: true },
    latestMafPaceSec: 410,
    workouts,
    now,
  };
};

test('storage key konstan tepat pacelab_gemini_api_key & CRUD localStorage bekerja', () => {
  assert.equal(GEMINI_API_KEY_STORAGE_KEY, 'pacelab_gemini_api_key');
  const map = new Map<string, string>();
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    },
  });
  try {
    assert.equal(loadGeminiApiKey(), '');
    saveGeminiApiKey('  AIzaTestKey123  ');
    assert.equal(map.get('pacelab_gemini_api_key'), 'AIzaTestKey123');
    assert.equal(loadGeminiApiKey(), 'AIzaTestKey123');
    clearGeminiApiKey();
    assert.equal(loadGeminiApiKey(), '');
  } finally {
    if (orig) Object.defineProperty(globalThis, 'localStorage', orig);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test('buildAiCoachSummary membatasi maksimal 7 sesi terakhir dan memuat semua ringkasan agregat', () => {
  const ctx = baseContext();
  const s = buildAiCoachSummary(ctx);
  assert.equal(s.age, 34);
  assert.equal(s.targetDistance, '10K');
  assert.match(s.curriculumLabel, /MAF/);
  assert.match(s.acwrText, /1\.09/);
  assert.match(s.efTrendText, /1\.45/);
  assert.equal(s.latestMafPaceText, '6:50 /km');
  assert.equal(s.recentSessionsText.length, 7);

  const prompt = buildAiCoachPrompt(ctx);
  assert.match(prompt, /Usia: 34 tahun/);
  assert.match(prompt, /Pace MAF terbaru: 6:50 \/km/);
  assert.match(prompt, /3–4 poin/);
});

test('requestAiCoachAnalysis menolak API key kosong dan kondisi offline', async () => {
  const ctx = baseContext();
  await assert.rejects(
    () => requestAiCoachAnalysis(ctx, { apiKey: '   ', isOnline: true }),
    (err: unknown) => err instanceof AiCoachError && err.code === 'missing_key',
  );
  await assert.rejects(
    () => requestAiCoachAnalysis(ctx, { apiKey: 'AIzaValid', isOnline: false }),
    (err: unknown) => err instanceof AiCoachError && err.code === 'offline',
  );
});

test('requestAiCoachAnalysis memanggil endpoint gemini-2.5-flash dengan header x-goog-api-key dan menangani error 429/400/403/PROXY_GENERATION_DISABLED/network', async () => {
  const ctx = baseContext();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  const okFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calledUrl = String(url);
    calledHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '- Poin 1\n- Poin 2\n- Poin 3' }] } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const text = await requestAiCoachAnalysis(ctx, { apiKey: 'AIzaDemo', isOnline: true, fetchImpl: okFetch });
  assert.equal(calledUrl, GEMINI_ENDPOINT);
  assert.equal(calledHeaders['x-goog-api-key'], 'AIzaDemo');
  assert.match(text, /Poin 1/);

  const proxyFetch = (async () =>
    new Response(JSON.stringify({ error: { code: 403, message: 'PROXY_GENERATION_DISABLED' } }), { status: 403 })) as typeof fetch;
  await assert.rejects(
    () => requestAiCoachAnalysis(ctx, { apiKey: 'AIzaDemo', isOnline: true, fetchImpl: proxyFetch }),
    (err: unknown) =>
      err instanceof AiCoachError &&
      err.code === 'proxy_disabled' &&
      err.message === 'Preview AI Studio memblokir panggilan langsung ke Gemini API. Push ke GitHub dan buka aplikasi dari URL GitHub Pages Anda untuk menggunakan AI Coach.',
  );

  const quotaFetch = (async () =>
    new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), { status: 429 })) as typeof fetch;
  await assert.rejects(
    () => requestAiCoachAnalysis(ctx, { apiKey: 'AIzaDemo', isOnline: true, fetchImpl: quotaFetch }),
    (err: unknown) => err instanceof AiCoachError && err.code === 'quota_exceeded',
  );

  const invalid400Fetch = (async () =>
    new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid.' } }), { status: 400 })) as typeof fetch;
  await assert.rejects(
    () => requestAiCoachAnalysis(ctx, { apiKey: 'bad', isOnline: true, fetchImpl: invalid400Fetch }),
    (err: unknown) => err instanceof AiCoachError && err.code === 'invalid_key',
  );

  const forbiddenFetch = (async () =>
    new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 })) as typeof fetch;
  await assert.rejects(
    () => requestAiCoachAnalysis(ctx, { apiKey: 'bad', isOnline: true, fetchImpl: forbiddenFetch }),
    (err: unknown) => err instanceof AiCoachError && err.code === 'invalid_key',
  );

  const netFailFetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  await assert.rejects(
    () => requestAiCoachAnalysis(ctx, { apiKey: 'AIzaDemo', isOnline: true, fetchImpl: netFailFetch }),
    (err: unknown) => err instanceof AiCoachError && err.code === 'network',
  );
});

test('parseCoachPoints membersihkan awalan bullet, nomor, dan bold markdown', () => {
  const pts = parseCoachPoints('- **Evaluasi**: Bagus.\n2. **Fokus**: Pertahankan HR.\n• Istirahat cukup.');
  assert.deepEqual(pts, ['Evaluasi: Bagus.', 'Fokus: Pertahankan HR.', 'Istirahat cukup.']);
});
