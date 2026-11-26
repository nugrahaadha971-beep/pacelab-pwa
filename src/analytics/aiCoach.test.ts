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

test('buildAiTrainingPlanPrompt memuat profil, metrik lengkap, hari latihan rutin, dan maksimal 10 riwayat sesi', async () => {
  const { buildAiTrainingPlanPrompt } = await import('./aiCoach.ts');
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);
  const workouts = Array.from({ length: 12 }, (_, i) => makeWorkout(i + 1, i));
  const prompt = buildAiTrainingPlanPrompt({
    profile: {
      age: 34,
      restingHr: 54,
      maxHr: 186,
      targetDistance: '5K',
      targetRaceDate: Date.UTC(2027, 0, 31),
      targetTimeSec: 1500,
    },
    curriculum: 'progressive5k',
    trainingDays: [2, 4, 6, 0],
    acwr: { acute: 120, chronicWeekly: 110, ratio: 1.09, status: 'sweet_spot' },
    efTrend: { recent: 1.45, prior: 1.38, changePct: 5.07, improving: true },
    latestDriftPct: 4.2,
    weeklyVolumeKm: 24.5,
    latestAvgPaceSec: 360,
    workouts,
    todayIso: '2026-11-22',
    now,
  });

  assert.match(prompt, /Usia: 34 tahun/);
  assert.match(prompt, /HR istirahat: 54 bpm/);
  assert.match(prompt, /HR maksimal: 186 bpm/);
  assert.match(prompt, /2027-01-31/);
  assert.match(prompt, /25:00/);
  assert.match(prompt, /Sel, Kam, Sab, Min/);
  assert.match(prompt, /4\.2%/);
  assert.match(prompt, /24\.5 km\/minggu/);
  assert.match(prompt, /6:00 \/km/);
  assert.match(prompt, /10\. /);
  assert.equal(prompt.includes('11. '), false);
});

test('generateAiTrainingPlan mengirim generationConfig JSON, memvalidasi ketat, dan menyusun PlanSession lengkap', async () => {
  const { generateAiTrainingPlan } = await import('./aiCoach.ts');
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);
  const input = {
    profile: {
      age: 34,
      restingHr: 54,
      maxHr: 186,
      targetDistance: '5K' as const,
      targetRaceDate: Date.UTC(2026, 11, 20),
      targetTimeSec: 1500,
    },
    curriculum: 'progressive5k' as const,
    trainingDays: [2, 4, 6, 0],
    acwr: { acute: 120, chronicWeekly: 110, ratio: 1.09, status: 'sweet_spot' as const },
    efTrend: { recent: 1.45, prior: 1.38, changePct: 5.07, improving: true },
    latestDriftPct: 3.1,
    weeklyVolumeKm: 22,
    latestAvgPaceSec: 360,
    workouts: [makeWorkout(1, 1)],
    todayIso: '2026-11-22',
    now,
  };

  let capturedBody: Record<string, unknown> | null = null;
  const okFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: 'Beban optimal, fokus progresi aerobik bertahap.',
                    sessions: [
                      {
                        date: '2026-11-24',
                        kind: 'recovery',
                        name: 'Easy Aerobic Run',
                        distanceKm: 5,
                        durationMin: 32,
                        hr: [132, 148],
                        steps: ['Pemanasan 5 menit', 'Lari santai 27 menit'],
                        note: 'Pertahankan HR rendah',
                      },
                      {
                        date: '2026-11-28',
                        kind: 'speed',
                        name: 'Interval 400m',
                        distanceKm: null,
                        durationMin: 40,
                        hr: [165, 178],
                        steps: ['10 menit pemanasan', '5 x 400m cepat'],
                        note: 'Istirahat 90 detik antar ulangan',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const result = await generateAiTrainingPlan(input, { apiKey: 'AIzaDemo', isOnline: true, fetchImpl: okFetch });
  assert.deepEqual(capturedBody?.generationConfig, { responseMimeType: 'application/json', temperature: 0.4 });
  assert.equal(result.summary, 'Beban optimal, fokus progresi aerobik bertahap.');
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0].id, 'ai-2026-11-24-0');
  assert.equal(result.sessions[0].zone, 'easy');
  assert.equal(result.sessions[1].id, 'ai-2026-11-28-1');
  assert.equal(result.sessions[1].zone, 'interval');

  const pastRaceFetch = (async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: 'Ringkasan',
                    sessions: [
                      {
                        date: '2026-12-21',
                        kind: 'recovery',
                        name: 'Lewat lomba',
                        distanceKm: 4,
                        durationMin: 25,
                        hr: null,
                        steps: [],
                        note: '',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  await assert.rejects(
    () => generateAiTrainingPlan(input, { apiKey: 'AIzaDemo', isOnline: true, fetchImpl: pastRaceFetch }),
    (err: unknown) => err instanceof AiCoachError && err.code === 'invalid_json',
  );

  const badKindFetch = (async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: 'Ringkasan',
                    sessions: [
                      {
                        date: '2026-11-24',
                        kind: 'race',
                        name: 'Salah kind',
                        distanceKm: 5,
                        durationMin: 25,
                        hr: null,
                        steps: [],
                        note: '',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  await assert.rejects(
    () => generateAiTrainingPlan(input, { apiKey: 'AIzaDemo', isOnline: true, fetchImpl: badKindFetch }),
    (err: unknown) => err instanceof AiCoachError && err.code === 'invalid_json',
  );
});

test('buildProgramEvaluationPrompt, parseProgramEvaluationResponse, dan evaluateProgramResultsWithAi bekerja dan memvalidasi JSON ketat', async () => {
  const {
    buildProgramEvaluationPrompt,
    parseProgramEvaluationResponse,
    evaluateProgramResultsWithAi,
  } = await import('./aiCoach.ts');
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);
  const evalInput = {
    profile: {
      age: 34,
      restingHr: 54,
      maxHr: 186,
      targetDistance: '5K' as const,
      targetRaceDate: Date.UTC(2026, 11, 20),
      targetTimeSec: 1500,
    },
    programTitle: 'Dasar 5K',
    plannedSessions: [
      {
        date: '2026-11-20',
        kind: 'recovery' as const,
        name: 'Easy Run Aerobik',
        status: 'done' as const,
        targetDistanceKm: 4,
        targetDurationMin: 28,
        targetHr: [130, 148] as [number, number],
      },
      {
        date: '2026-11-21',
        kind: 'speed' as const,
        name: 'Fartlek Ringan',
        status: 'missed' as const,
        targetDistanceKm: 4.5,
        targetDurationMin: 30,
        targetHr: [162, 174] as [number, number],
      },
    ],
    workouts: [makeWorkout(1, 2)],
    todayIso: '2026-11-22',
    now,
  };

  const prompt = buildProgramEvaluationPrompt(evalInput);
  assert.match(prompt, /Dasar 5K/);
  assert.match(prompt, /1 selesai, 1 terlewat, 0 mendatang/);
  assert.match(prompt, /Easy Run Aerobik/);

  const parsed = parseProgramEvaluationResponse(
    JSON.stringify({
      complianceScore: 78.6,
      summary: '**Konsistensi** cukup baik walau satu sesi speed terlewat.',
      analysisPoints: [
        '- **Volume**: Jarak mingguan terjaga.',
        '2. HR rata-rata sesuai zona mudah.',
        'Satu sesi kecepatan terlewat akhir pekan.',
      ],
      nextAdjustments: ['Pertahankan 3 sesi mudah minggu depan', 'Pindahkan interval ke Selasa'],
    }),
  );
  assert.equal(parsed.complianceScore, 79);
  assert.equal(parsed.summary, 'Konsistensi cukup baik walau satu sesi speed terlewat.');
  assert.deepEqual(parsed.analysisPoints, [
    'Volume: Jarak mingguan terjaga.',
    'HR rata-rata sesuai zona mudah.',
    'Satu sesi kecepatan terlewat akhir pekan.',
  ]);

  let capturedConfig: unknown = null;
  const okFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { generationConfig?: unknown };
    capturedConfig = body.generationConfig;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    complianceScore: 84,
                    summary: 'Eksekusi program sangat stabil sepanjang minggu.',
                    analysisPoints: [
                      'Target jarak tercapai sesuai rencana.',
                      'Detak jantung stabil di zona target.',
                      'Pemulihan antar sesi berjalan baik.',
                    ],
                    nextAdjustments: ['Tambahkan durasi long run +5 menit'],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const evalRes = await evaluateProgramResultsWithAi(evalInput, {
    apiKey: 'AIzaDemo',
    isOnline: true,
    fetchImpl: okFetch,
  });
  assert.deepEqual(capturedConfig, { responseMimeType: 'application/json', temperature: 0.3 });
  assert.equal(evalRes.complianceScore, 84);
  assert.equal(evalRes.nextAdjustments.length, 1);

  assert.throws(
    () => parseProgramEvaluationResponse('{bukan json'),
    (err: unknown) => err instanceof AiCoachError && err.code === 'invalid_json',
  );
});

