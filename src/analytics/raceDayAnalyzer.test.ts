import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UserProfile, Workout } from './types.ts';
import type { ShoeItem } from '../plans/shoeStore.ts';
import {
  buildLocalRaceDayAnalysis,
  buildRaceDaySnapshot,
  requestRaceDayAnalysis,
  stripMarkdown,
} from './raceDayAnalyzer.ts';

const NOW = Date.UTC(2026, 10, 25, 6, 0, 0);
const DAY = 86_400_000;

const profile: UserProfile = {
  id: 'default',
  age: 32,
  restingHr: 52,
  maxHr: 186,
  targetDistance: '21.1K',
  targetRaceDate: NOW + 14 * DAY,
  targetTimeSec: 6600, // 1:50:00
  weeklyTargetKm: 45,
};

function makeWorkout(idx: number, daysAgo: number, hr = 148, pace = 330): Workout {
  return {
    id: idx,
    date: NOW - daysAgo * DAY,
    source: 'fit',
    workoutType: daysAgo % 7 === 0 ? 'long_run' : 'easy',
    distanceKm: daysAgo % 7 === 0 ? 16 : 8,
    durationSec: (daysAgo % 7 === 0 ? 16 : 8) * pace,
    avgPaceSecPerKm: pace,
    avgHr: hr,
    maxHr: hr + 16,
    avgCadence: 174,
    elevationGain: 40,
    rpe: 5,
    shoeId: 'shoe-1',
    laps: [
      { km: 1, paceSec: pace, avgHr: hr - 4 },
      { km: 2, paceSec: pace, avgHr: hr - 1 },
      { km: 3, paceSec: pace, avgHr: hr + 2 },
      { km: 4, paceSec: pace, avgHr: hr + 4 },
    ],
  };
}

const shoes: ShoeItem[] = [
  { id: 'shoe-1', name: 'Novablast 4', initialKm: 700, maxKm: 800, isDefault: true },
];

test('stripMarkdown menghapus tanda bintang tunggal dan ganda tanpa merusak teks', () => {
  assert.equal(stripMarkdown('- Gunakan metode *HR-First* pada *Easy Run* dan **Negative Split**.'), 'Gunakan metode HR-First pada Easy Run dan Negative Split.');
});

test('buildLocalRaceDayAnalysis menghasilkan kesiapan Aman, 3 fase pacing, dan pengingat sepatu dari shoeStore', () => {
  const workouts = Array.from({ length: 12 }, (_, i) => makeWorkout(i + 1, i * 2 + 1));
  const analysis = buildLocalRaceDayAnalysis({ profile, workouts, shoes, now: NOW });

  assert.equal(analysis.source, 'offline');
  assert.equal(analysis.pacingStrategy.length, 3);
  assert.match(analysis.pacingStrategy[2].phase, /Negative Split/i);
  assert.ok(analysis.healthWarnings.length >= 3);
  assert.ok(analysis.tacticalTips.some((t) => t.includes('Novablast 4')));
  assert.ok(analysis.healthWarnings.every((line) => !line.includes('*')));
  assert.ok(analysis.tacticalTips.every((line) => !line.includes('*')));
});

test('buildLocalRaceDayAnalysis mendeteksi Risiko Tinggi saat ACWR melonjak > 1.5', () => {
  // 3 minggu awal ringan (1 sesi ringan), minggu terakhir beban sangat tinggi (6 sesi intensif)
  const workouts: Workout[] = [
    makeWorkout(1, 20, 130, 390),
    ...Array.from({ length: 6 }, (_, i) => ({
      ...makeWorkout(i + 2, i, 174, 270),
      distanceKm: 18,
      durationSec: 18 * 270,
    })),
  ];
  const snap = buildRaceDaySnapshot({ profile, workouts, shoes, now: NOW });
  assert.ok(snap.acwrRatio != null && snap.acwrRatio > 1.5);

  const analysis = buildLocalRaceDayAnalysis({ profile, workouts, shoes, now: NOW });
  assert.equal(analysis.readinessStatus, 'risiko_tinggi');
  assert.equal(analysis.readinessLabel, 'Risiko Tinggi');
  assert.ok(analysis.healthWarnings.some((w) => w.includes('ACWR')));
});

test('requestRaceDayAnalysis memakai Structured JSON dari server saat online dan fallback ke offline saat gagal', async () => {
  const workouts = Array.from({ length: 6 }, (_, i) => makeWorkout(i + 1, i * 3 + 1));

  const okFetch = (async () =>
    new Response(
      JSON.stringify({
        analysis: {
          readinessStatus: 'aman',
          readinessHeadline: 'Tubuh siap *optimal* menuju lomba.',
          healthWarnings: ['ACWR **stabil** di zona aman.', 'Minum 200 ml tiap 20 menit.'],
          pacingStrategy: [
            { phase: 'Awal', targetPace: '5:25 /km', targetHr: '160 bpm', cue: 'Mulai tenang.' },
            { phase: 'Pertengahan', targetPace: '5:15 /km', targetHr: '168 bpm', cue: 'Jaga ritme.' },
            { phase: 'Akhir', targetPace: '5:05 /km', targetHr: '175 bpm', cue: '*Negative split*.' },
          ],
          tacticalTips: ['Ambil gel di menit ke-40.', 'Cek **Novablast 4** sebelum start.'],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  const okRes = await requestRaceDayAnalysis(
    { profile, workouts, shoes, now: NOW },
    { fetchImpl: okFetch, isOnline: true },
  );
  assert.equal(okRes.analysis.source, 'gemini');
  assert.equal(okRes.fallbackReason, undefined);
  assert.equal(okRes.analysis.readinessHeadline, 'Tubuh siap optimal menuju lomba.');
  assert.equal(okRes.analysis.pacingStrategy[2].cue, 'Negative split.');

  const offlineRes = await requestRaceDayAnalysis(
    { profile, workouts, shoes, now: NOW },
    { isOnline: false },
  );
  assert.equal(offlineRes.analysis.source, 'offline');
  assert.ok(offlineRes.fallbackReason);

  const failFetch = (async () =>
    new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing' }), { status: 503 })) as typeof fetch;
  const fallbackRes = await requestRaceDayAnalysis(
    { profile, workouts, shoes, now: NOW },
    { fetchImpl: failFetch, isOnline: true },
  );
  assert.equal(fallbackRes.analysis.source, 'offline');
  assert.match(fallbackRes.fallbackReason ?? '', /GEMINI_API_KEY/);
});
