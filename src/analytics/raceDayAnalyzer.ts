import type { RaceDistance, UserProfile, Workout } from './types.ts';
import {
  acwr,
  DAY_MS,
  efTrend,
  steadyDrift,
  type AcwrStatus,
} from './workload.ts';
import {
  currentVdot,
  predictAll,
  RACE_KM,
  riegelProject,
} from './predictor.ts';
import { hrRange, resolveMaxHr } from '../plans/hrZones.ts';
import { mafHr, mafTests, type MafAdjustment } from '../plans/maf.ts';
import { fmtPace } from '../plans/pace.ts';
import { isoFromRaceTs, remaining } from '../plans/schedule.ts';
import {
  calcAllShoesMileage,
  loadShoes,
  type ShoeItem,
  type ShoeMileageEntry,
} from '../plans/shoeStore.ts';

export type ReadinessStatus = 'aman' | 'waspada' | 'risiko_tinggi';

export const READINESS_LABEL: Record<ReadinessStatus, 'Aman' | 'Waspada' | 'Risiko Tinggi'> = {
  aman: 'Aman',
  waspada: 'Waspada',
  risiko_tinggi: 'Risiko Tinggi',
};

export interface RaceDayPacingSegment {
  phase: string;
  targetPace: string;
  targetHr: string;
  cue: string;
}

export interface RaceDaySnapshot {
  targetDistance: RaceDistance;
  raceDateIso: string | null;
  daysToRace: number | null;
  estimatedFinishSec: number;
  estimatedFinishTime: string;
  targetPaceSecPerKm: number;
  targetPacePerKm: string;
  acwrRatio: number | null;
  acwrStatus: AcwrStatus;
  avgDriftPct: number | null;
  efRecent: number | null;
  efChangePct: number | null;
  vdotScore: number | null;
  mafHr: number | null;
  mafPacePerKm: string | null;
  raceHrRange: string | null;
  raceHrBounds: [number, number] | null;
  maxHr: number | null;
  weeklyKm28: number;
  longestRunKm28: number;
  primaryShoe: ShoeMileageEntry | null;
  primaryShoeSummary: string | null;
  sessionsCount: number;
  hasPredictionBasis: boolean;
}

export interface RaceDayAnalysis {
  readinessStatus: ReadinessStatus;
  readinessLabel: 'Aman' | 'Waspada' | 'Risiko Tinggi';
  readinessHeadline: string;
  estimatedFinishTime: string;
  estimatedFinishSec: number;
  targetPacePerKm: string;
  daysToRace: number | null;
  source: 'gemini' | 'offline';
  generatedAt: number;
  healthWarnings: string[];
  pacingStrategy: RaceDayPacingSegment[];
  tacticalTips: string[];
}

export interface RaceDayAnalyzerInput {
  profile: UserProfile;
  workouts: Workout[];
  targetDistance?: RaceDistance;
  targetRaceDate?: number | null;
  shoes?: ReadonlyArray<ShoeItem>;
  mafAdjustment?: MafAdjustment;
  now?: number;
}

/** Hapus semua karakter bintang/format Markdown mentah agar UI selalu bersih. */
export function stripMarkdown(raw: string): string {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtTimeClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function todayIsoFrom(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function safeLoadShoes(provided?: ReadonlyArray<ShoeItem>): ReadonlyArray<ShoeItem> {
  if (provided) return provided;
  if (typeof localStorage === 'undefined') return [];
  return loadShoes();
}

export function buildRaceDaySnapshot(input: RaceDayAnalyzerInput): RaceDaySnapshot {
  const now = input.now ?? Date.now();
  const distance: RaceDistance = input.targetDistance ?? input.profile.targetDistance;
  const raceTs =
    input.targetRaceDate !== undefined ? (input.targetRaceDate ?? 0) : input.profile.targetRaceDate;
  const raceDateIso = raceTs > 0 ? isoFromRaceTs(raceTs) : null;
  const daysToRace = raceDateIso ? remaining(raceDateIso, todayIsoFrom(now)).daysRemaining : null;

  const load = acwr(input.workouts, input.profile, now);
  const ef = efTrend(input.workouts, now);
  const preds = predictAll(input.workouts, now);
  const pred = preds[distance];
  const vd = currentVdot(input.workouts, now);

  const last28 = input.workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
  const weeklyKm28 = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
  const longestRunKm28 = last28.reduce((m, w) => Math.max(m, w.distanceKm), 0);

  const driftVals = last28
    .filter((w) => w.date <= now)
    .map((w) => steadyDrift(w))
    .filter((d): d is number => d != null && Number.isFinite(d));
  const avgDriftPct =
    driftVals.length > 0 ? driftVals.reduce((s, d) => s + d, 0) / driftVals.length : null;

  const maxHr = resolveMaxHr(input.profile, input.workouts);
  const raceHrBounds = hrRange('race', maxHr);
  const raceHrRange = raceHrBounds ? `${raceHrBounds[0]}–${raceHrBounds[1]} bpm` : null;

  const maf = mafHr(input.profile.age, input.mafAdjustment ?? 0);
  const mafPts = mafTests(
    input.workouts.filter((w) => w.date <= now),
    maf,
  );
  const latestMafPace = mafPts.length > 0 ? mafPts[mafPts.length - 1].paceSecPerKm : null;

  const profileTargetTime =
    input.profile.targetTimeSec > 0
      ? distance === input.profile.targetDistance
        ? input.profile.targetTimeSec
        : riegelProject(
            input.profile.targetTimeSec,
            RACE_KM[input.profile.targetDistance],
            RACE_KM[distance],
          )
      : RACE_KM[distance] * 360;

  const estimatedFinishSec = pred ? Math.round(pred.finalSec) : Math.round(profileTargetTime);
  const targetPaceSecPerKm = estimatedFinishSec / RACE_KM[distance];

  const shoeEntries = calcAllShoesMileage(input.workouts, safeLoadShoes(input.shoes));
  const primaryShoe = shoeEntries.find((e) => e.shoe.isDefault) ?? shoeEntries[0] ?? null;
  const primaryShoeSummary = primaryShoe
    ? `${primaryShoe.shoe.name} (${primaryShoe.totalKm.toFixed(0)}/${primaryShoe.shoe.maxKm} km, status ${primaryShoe.status})`
    : null;

  return {
    targetDistance: distance,
    raceDateIso,
    daysToRace,
    estimatedFinishSec,
    estimatedFinishTime: fmtTimeClock(estimatedFinishSec),
    targetPaceSecPerKm,
    targetPacePerKm: `${fmtPace(targetPaceSecPerKm)} /km`,
    acwrRatio: load.ratio,
    acwrStatus: load.status,
    avgDriftPct,
    efRecent: ef.recent,
    efChangePct: ef.changePct,
    vdotScore: vd,
    mafHr: maf,
    mafPacePerKm: latestMafPace ? `${fmtPace(latestMafPace)} /km` : null,
    raceHrRange,
    raceHrBounds,
    maxHr,
    weeklyKm28,
    longestRunKm28,
    primaryShoe,
    primaryShoeSummary,
    sessionsCount: input.workouts.filter((w) => w.date <= now).length,
    hasPredictionBasis: Boolean(pred),
  };
}

function buildHydrationAdvice(estimatedFinishSec: number, distance: RaceDistance): string {
  const min = estimatedFinishSec / 60;
  if (min <= 40 || distance === '5K') {
    return 'Hidrasi pra-lomba cukup 250–300 ml air 60 menit sebelum start; minum secukupnya di pos air.';
  }
  if (min <= 85 || distance === '10K') {
    return `Estimasi durasi ${Math.round(min)} menit: minum 150–200 ml air atau elektrolit tiap 20–25 menit untuk mencegah dehidrasi.`;
  }
  return `Durasi panjang (~${Math.round(min)} menit): targetkan 400–600 ml cairan dan 300–500 mg natrium/jam sejak menit ke-20.`;
}

function buildNutritionTip(estimatedFinishSec: number, distance: RaceDistance): string {
  const min = estimatedFinishSec / 60;
  if (distance === '5K' || min < 55) {
    return 'Konsumsi karbohidrat ringan 2 jam sebelum start; tidak perlu energy gel di tengah lomba.';
  }
  if (distance === '10K' || min < 85) {
    return 'Ambil 1 energy gel 15 menit sebelum start atau di Km 5 bila intensitas terasa berat.';
  }
  return 'Jadwalkan 1 energy gel tiap 35–40 menit (disertai 2–3 teguk air putih, hindari minuman manis pekat bersamaan).';
}

function buildShoeTip(primaryShoe: ShoeMileageEntry | null): string {
  if (!primaryShoe) {
    return 'Catat sepatu utama di Profil untuk memantau usia bantalan sebelum hari lomba.';
  }
  const { shoe, totalKm, status } = primaryShoe;
  if (status === 'replace') {
    return `Bantalan ${shoe.name} (${totalKm.toFixed(0)}/${shoe.maxKm} km) sudah aus; siapkan sepatu pengganti sebelum race.`;
  }
  if (status === 'warn') {
    return `${shoe.name} mendekati batas usia (${totalKm.toFixed(0)}/${shoe.maxKm} km); pastikan sol masih responsif saat pemanasan.`;
  }
  return `Sepatu ${shoe.name} (${totalKm.toFixed(0)}/${shoe.maxKm} km) masih optimal; hindari memakai sepatu baru yang belum dicoba.`;
}

function phaseLabelsFor(distance: RaceDistance): [string, string, string] {
  switch (distance) {
    case '5K':
      return ['Awal (Km 1)', 'Pertengahan (Km 2–4)', 'Akhir (Km 5 · Negative Split)'];
    case '10K':
      return ['Awal (Km 1–2)', 'Pertengahan (Km 3–8)', 'Akhir (Km 9–10 · Negative Split)'];
    case '21.1K':
      return ['Awal (Km 1–5)', 'Pertengahan (Km 6–16)', 'Akhir (Km 17–21,1 · Negative Split)'];
    case '42.2K':
      return ['Awal (Km 1–10)', 'Pertengahan (Km 11–32)', 'Akhir (Km 33–42,2 · Negative Split)'];
  }
}

export function buildLocalRaceDayAnalysis(input: RaceDayAnalyzerInput): RaceDayAnalysis {
  const now = input.now ?? Date.now();
  const s = buildRaceDaySnapshot(input);

  const highAcwr = s.acwrRatio != null && s.acwrRatio > 1.5;
  const cautionAcwr = s.acwrRatio != null && s.acwrRatio > 1.3;
  const highDrift = s.avgDriftPct != null && s.avgDriftPct > 5;
  const severeDrift = s.avgDriftPct != null && s.avgDriftPct > 7;
  const efDrop = s.efChangePct != null && s.efChangePct <= -3;
  const shoeReplace = s.primaryShoe?.status === 'replace';

  let readinessStatus: ReadinessStatus = 'aman';
  if (highAcwr || (cautionAcwr && severeDrift)) {
    readinessStatus = 'risiko_tinggi';
  } else if (cautionAcwr || highDrift || efDrop || shoeReplace) {
    readinessStatus = 'waspada';
  }

  const readinessHeadline =
    s.sessionsCount === 0
      ? `Belum ada riwayat lari; strategi ${s.targetDistance} dihitung dari target waktu profil.`
      : readinessStatus === 'risiko_tinggi'
        ? `Beban latihan tinggi (ACWR ${s.acwrRatio?.toFixed(2)}); kurangi porsi dan mulai lebih konservatif di hari lomba.`
        : readinessStatus === 'waspada'
          ? `Kesiapan cukup baik, namun ada sinyal kelelahan ringan; disiplin pace awal dan hidrasi sangat disarankan.`
          : s.daysToRace != null && s.daysToRace <= 7 && s.daysToRace >= 0
            ? `Kondisi fisik prima jelang H-${s.daysToRace}; pertahankan taper ringan dan tidur cukup.`
            : `Fondasi beban latihan berada di zona aman untuk target ${s.targetDistance}.`;

  // 1. Peringatan Kesehatan & Kesiapan
  const healthWarnings: string[] = [];
  if (s.acwrRatio == null) {
    healthWarnings.push('Rasio ACWR belum terbentuk; hindari menambah intensitas mendadak dalam 7 hari sebelum lomba.');
  } else if (highAcwr) {
    healthWarnings.push(`ACWR ${s.acwrRatio.toFixed(2)} (> 1,50): risiko kelelahan & cedera tinggi, wajib taper 40–50% sebelum start.`);
  } else if (cautionAcwr) {
    healthWarnings.push(`ACWR ${s.acwrRatio.toFixed(2)} (waspada): jaga sesi terakhir tetap santai agar kaki segar di garis start.`);
  } else if (s.acwrStatus === 'undertraining') {
    healthWarnings.push(`ACWR ${s.acwrRatio.toFixed(2)} (ringan): tubuh relatif segar, fokus menjaga konsistensi pemanasan sebelum start.`);
  } else {
    healthWarnings.push(`ACWR ${s.acwrRatio.toFixed(2)} berada di zona aman (0,8–1,3); risiko overtraining terkendali.`);
  }

  if (s.avgDriftPct != null) {
    if (highDrift) {
      healthWarnings.push(`Cardiac drift rata-rata ${s.avgDriftPct.toFixed(1)}% (> 5%): detak jantung mudah naik, kontrol start agar tidak kehabisan tenaga.`);
    } else {
      healthWarnings.push(`Cardiac drift terjaga di ${s.avgDriftPct.toFixed(1)}% (≤ 5%): daya tahan aerobik stabil untuk ritme lomba.`);
    }
  } else {
    healthWarnings.push('Belum ada data cardiac drift; pantau detak jantung di paruh awal lomba agar tidak cepat lelah.');
  }

  healthWarnings.push(buildHydrationAdvice(s.estimatedFinishSec, s.targetDistance));

  // 2. Strategi Pacing Lomba (Awal, Pertengahan, Akhir Negative Split)
  const basePace = s.targetPaceSecPerKm;
  const startSlow = readinessStatus === 'risiko_tinggi' ? 12 : 8;
  const finishFast = readinessStatus === 'risiko_tinggi' ? 4 : 8;
  const [p1, p2, p3] = phaseLabelsFor(s.targetDistance);

  const hrStart = s.raceHrBounds
    ? `${Math.max(100, s.raceHrBounds[0] - 8)}–${s.raceHrBounds[0]} bpm`
    : 'Zona 3 (75–82% HRmaks)';
  const hrMid = s.raceHrBounds
    ? `${s.raceHrBounds[0]}–${s.raceHrBounds[1]} bpm`
    : 'Zona 4 (85–90% HRmaks)';
  const hrEnd = s.raceHrBounds
    ? `${s.raceHrBounds[1] - 2}–${s.maxHr ?? s.raceHrBounds[1] + 5} bpm`
    : 'Zona 4–5 (90–95% HRmaks)';

  const pacingStrategy: RaceDayPacingSegment[] = [
    {
      phase: p1,
      targetPace: `${fmtPace(basePace + startSlow - 3)}–${fmtPace(basePace + startSlow + 2)} /km`,
      targetHr: hrStart,
      cue: 'Tahan adrenalin saat gun start; biarkan napas dan langkah stabil dulu.',
    },
    {
      phase: p2,
      targetPace: `${fmtPace(basePace - 2)}–${fmtPace(basePace + 2)} /km`,
      targetHr: hrMid,
      cue: 'Kunci ritme target sambil cek kenyamanan bahu dan irama langkah.',
    },
    {
      phase: p3,
      targetPace: `${fmtPace(Math.max(150, basePace - finishFast))}–${fmtPace(basePace - 2)} /km`,
      targetHr: hrEnd,
      cue: 'Percepat bertahap untuk negative split jika napas dan HR masih terkontrol.',
    },
  ];

  // 3. Tips & Tricks Taktis
  const tacticalTips: string[] = [
    buildNutritionTip(s.estimatedFinishSec, s.targetDistance),
    s.raceHrBounds
      ? `Saat tanjakan atau cuaca panas, kendurkan pace 10–15 dtk/km agar HR tidak melewati ${s.raceHrBounds[1]} bpm terlalu awal.`
      : 'Saat tanjakan atau cuaca panas, perlambat 10–15 dtk/km dan prioritaskan usaha napas yang konstan.',
    buildShoeTip(s.primaryShoe),
  ];

  return {
    readinessStatus,
    readinessLabel: READINESS_LABEL[readinessStatus],
    readinessHeadline: stripMarkdown(readinessHeadline),
    estimatedFinishTime: s.estimatedFinishTime,
    estimatedFinishSec: s.estimatedFinishSec,
    targetPacePerKm: s.targetPacePerKm,
    daysToRace: s.daysToRace,
    source: 'offline',
    generatedAt: now,
    healthWarnings: healthWarnings.map(stripMarkdown),
    pacingStrategy: pacingStrategy.map((seg) => ({
      phase: stripMarkdown(seg.phase),
      targetPace: stripMarkdown(seg.targetPace),
      targetHr: stripMarkdown(seg.targetHr),
      cue: stripMarkdown(seg.cue),
    })),
    tacticalTips: tacticalTips.map(stripMarkdown),
  };
}

function isReadinessStatus(val: unknown): val is ReadinessStatus {
  return val === 'aman' || val === 'waspada' || val === 'risiko_tinggi';
}

export function parseRaceDayServerResponse(
  raw: unknown,
  snapshot: RaceDaySnapshot,
  now = Date.now(),
): RaceDayAnalysis {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Respons analisa D-Day tidak valid.');
  }
  const obj = raw as Record<string, unknown>;
  const readinessStatus: ReadinessStatus = isReadinessStatus(obj.readinessStatus)
    ? obj.readinessStatus
    : 'aman';
  const readinessHeadline =
    typeof obj.readinessHeadline === 'string' && obj.readinessHeadline.trim()
      ? stripMarkdown(obj.readinessHeadline)
      : `Kesiapan lomba ${snapshot.targetDistance} telah dianalisis.`;

  const healthWarnings = Array.isArray(obj.healthWarnings)
    ? obj.healthWarnings
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map(stripMarkdown)
        .slice(0, 4)
    : [];

  const pacingStrategy: RaceDayPacingSegment[] = Array.isArray(obj.pacingStrategy)
    ? obj.pacingStrategy
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((seg) => ({
          phase: typeof seg.phase === 'string' ? stripMarkdown(seg.phase) : '',
          targetPace: typeof seg.targetPace === 'string' ? stripMarkdown(seg.targetPace) : '',
          targetHr: typeof seg.targetHr === 'string' ? stripMarkdown(seg.targetHr) : '',
          cue: typeof seg.cue === 'string' ? stripMarkdown(seg.cue) : '',
        }))
        .filter((seg) => seg.phase && seg.targetPace && seg.cue)
        .slice(0, 3)
    : [];

  const tacticalTips = Array.isArray(obj.tacticalTips)
    ? obj.tacticalTips
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map(stripMarkdown)
        .slice(0, 4)
    : [];

  if (healthWarnings.length === 0 || pacingStrategy.length === 0 || tacticalTips.length === 0) {
    throw new Error('Struktur JSON D-Day dari server belum lengkap.');
  }

  return {
    readinessStatus,
    readinessLabel: READINESS_LABEL[readinessStatus],
    readinessHeadline,
    estimatedFinishTime: snapshot.estimatedFinishTime,
    estimatedFinishSec: snapshot.estimatedFinishSec,
    targetPacePerKm: snapshot.targetPacePerKm,
    daysToRace: snapshot.daysToRace,
    source: 'gemini',
    generatedAt: now,
    healthWarnings,
    pacingStrategy,
    tacticalTips,
  };
}

export interface RequestRaceDayOptions {
  fetchImpl?: typeof fetch;
  isOnline?: boolean;
  timeoutMs?: number;
}

export async function requestRaceDayAnalysis(
  input: RaceDayAnalyzerInput,
  opts: RequestRaceDayOptions = {},
): Promise<{ analysis: RaceDayAnalysis; fallbackReason?: string }> {
  const now = input.now ?? Date.now();
  const snapshot = buildRaceDaySnapshot({ ...input, now });
  const online = opts.isOnline ?? (typeof navigator !== 'undefined' ? navigator.onLine : true);

  if (!online) {
    return {
      analysis: buildLocalRaceDayAnalysis({ ...input, now }),
      fallbackReason: 'Mode offline aktif: menggunakan kalkulasi fisiologi lokal.',
    };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn('api/race-day-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot: {
          targetDistance: snapshot.targetDistance,
          raceDateIso: snapshot.raceDateIso,
          daysToRace: snapshot.daysToRace,
          estimatedFinishTime: snapshot.estimatedFinishTime,
          estimatedFinishSec: snapshot.estimatedFinishSec,
          targetPacePerKm: snapshot.targetPacePerKm,
          acwrRatio: snapshot.acwrRatio,
          acwrStatus: snapshot.acwrStatus,
          avgDriftPct: snapshot.avgDriftPct,
          efRecent: snapshot.efRecent,
          efChangePct: snapshot.efChangePct,
          mafHr: snapshot.mafHr,
          mafPacePerKm: snapshot.mafPacePerKm,
          raceHrRange: snapshot.raceHrRange,
          weeklyKm28: snapshot.weeklyKm28,
          longestRunKm28: snapshot.longestRunKm28,
          primaryShoeSummary: snapshot.primaryShoeSummary,
          sessionsCount: snapshot.sessionsCount,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
      return {
        analysis: buildLocalRaceDayAnalysis({ ...input, now }),
        fallbackReason: errBody?.error
          ? `Kalkulasi lokal aktif (${errBody.error})`
          : 'Kalkulasi lokal aktif (layanan AI belum tersedia).',
      };
    }

    const data = (await res.json().catch(() => null)) as { analysis?: unknown } | null;
    const analysis = parseRaceDayServerResponse(data?.analysis, snapshot, now);
    return { analysis };
  } catch {
    return {
      analysis: buildLocalRaceDayAnalysis({ ...input, now }),
      fallbackReason: 'Kalkulasi lokal aktif (koneksi ke server AI tidak terjangkau).',
    };
  } finally {
    clearTimeout(timer);
  }
}
