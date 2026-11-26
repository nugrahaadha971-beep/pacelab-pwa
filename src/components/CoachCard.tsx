import { useEffect, useState } from 'react';
import { Activity, ChevronDown, Heart, RefreshCw, Sparkles } from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, cardiacDrift, DAY_MS, efTrend } from '../analytics/workload';
import type { AcwrStatus } from '../analytics/workload';
import { velocityFor, ZONE_FRACTION } from '../analytics/predictor';
import { coachAdvice, DRIFT_WARN_PCT } from '../analytics/coachEngine';
import {
  loadCachedAiCoachAnalysis,
  loadGeminiApiKey,
  parseCoachPoints,
  requestAiCoachAnalysis,
} from '../analytics/aiCoach';
import { fmtPace } from '../plans/pace';
import { loadScheduleState } from '../plans/scheduleStore';
import { stripMarkdown } from '../analytics/raceDayAnalyzer';
import AiLoader from './AiLoader';
import { Button, StatusPill, type Tone } from './ui';

type PaceZoneKey = keyof typeof ZONE_FRACTION;

const STATUS_BADGE: Record<AcwrStatus, { label: string; tone: Exclude<Tone, 'neutral'>; pin: string }> = {
  unknown: {
    label: 'Data Kurang',
    tone: 'info',
    pin: 'bg-zinc-300 ring-zinc-300/30',
  },
  undertraining: {
    label: 'Ringan',
    tone: 'info',
    pin: 'bg-sky-400 ring-sky-400/35',
  },
  sweet_spot: {
    label: 'Aman',
    tone: 'good',
    pin: 'bg-[#BEF264] ring-[#BEF264]/35',
  },
  high_fatigue: {
    label: 'Terlalu Berat',
    tone: 'bad',
    pin: 'bg-rose-500 ring-rose-500/35',
  },
};

const PACE_ZONES: ReadonlyArray<{
  key: PaceZoneKey;
  name: string;
  desc: string;
  barPct: string;
  barColor: string;
  textColor: string;
  dotColor: string;
  hrFrac: [number, number];
}> = [
  {
    key: 'easy',
    name: 'Easy',
    desc: 'Napas tenang, bangun daya tahan dasar',
    barPct: '38%',
    barColor: 'bg-sky-400',
    textColor: 'text-sky-400',
    dotColor: 'bg-sky-400',
    hrFrac: [0.71, 0.82],
  },
  {
    key: 'marathon',
    name: 'Marathon',
    desc: 'Ritme stabil & efisien jangka panjang',
    barPct: '58%',
    barColor: 'bg-[#BEF264]',
    textColor: 'text-[#BEF264]',
    dotColor: 'bg-[#BEF264]',
    hrFrac: [0.80, 0.87],
  },
  {
    key: 'threshold',
    name: 'Threshold',
    desc: 'Batas ambang laktat terkontrol',
    barPct: '78%',
    barColor: 'bg-amber-400',
    textColor: 'text-amber-400',
    dotColor: 'bg-amber-400',
    hrFrac: [0.86, 0.91],
  },
  {
    key: 'interval',
    name: 'Interval',
    desc: 'Kecepatan tinggi & kapasitas maksimal',
    barPct: '96%',
    barColor: 'bg-rose-500',
    textColor: 'text-rose-400',
    dotColor: 'bg-rose-500',
    hrFrac: [0.90, 0.96],
  },
];

function formatBpmRange(frac: [number, number], maxHr: number | null): string | null {
  if (!maxHr || maxHr <= 0) return null;
  const lo = Math.ceil(frac[0] * maxHr - 1e-9);
  const hi = Math.ceil(frac[1] * maxHr - 1e-9);
  return `${lo}–${hi} bpm`;
}

/** Hitung posisi persentase marker pada pita ACWR skala 0.0 – 1.8. */
function acwrMarkerPct(ratio: number): number {
  const clamped = Math.max(0.05, Math.min(1.75, ratio));
  return (clamped / 1.8) * 100;
}

export function ZonaPaceCard({ vdot, maxHr }: { vdot: number; maxHr: number | null }) {
  return (
    <section aria-label="Zona Pace dan Intensitas" className="sport-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-white">Zona Pace Latihan</h2>
          <p className="text-xs text-zinc-400">Target kecepatan & detak jantung berdasarkan skor kebugaran</p>
        </div>
        <span className="shrink-0 font-mono text-xs font-extrabold tabular-nums text-[#BEF264]">
          VDOT {vdot.toFixed(1)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PACE_ZONES.map((z) => {
          const paceStr = fmtPace(60000 / velocityFor(vdot, ZONE_FRACTION[z.key]));
          const bpmStr = formatBpmRange(z.hrFrac, maxHr);
          return (
            <div key={z.key} className="sport-subcard p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className={`h-2 w-2 rounded-full ${z.dotColor}`} />
                    <span className="text-sm font-bold text-zinc-100">{z.name}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">{z.desc}</p>
                </div>

                <div className="shrink-0 text-right tabular-nums">
                  <div className={`font-mono text-base font-extrabold ${z.textColor}`}>
                    {paceStr} <span className="font-sans text-xs font-semibold text-zinc-400">/km</span>
                  </div>
                  {bpmStr && (
                    <div className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] font-medium text-zinc-400">
                      <Heart className="h-3 w-3 text-zinc-500" aria-hidden />
                      <span>{bpmStr}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[#27272E]">
                <div
                  className={`h-full rounded-full ${z.barColor} transition-all duration-300`}
                  style={{ width: z.barPct }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function buildFriendlyAdvice(
  status: AcwrStatus,
  session: ReturnType<typeof coachAdvice>['session'],
  durationAddMin: number,
  driftHigh: boolean,
): string {
  const driftNote = driftHigh
    ? ' Detak jantung sempat naik di sesi terakhir—jaga pace lebih santai hari ini.'
    : '';
  switch (status) {
    case 'unknown':
      return 'Catat beberapa sesi lari dulu agar kondisi beban tubuh Anda bisa dinilai.';
    case 'high_fatigue':
      return (
        (session === 'rest'
          ? 'Beban latihan sedang terlalu berat. Ambil istirahat penuh hari ini agar tubuh pulih.'
          : 'Beban latihan sedang terlalu berat. Pilih lari pemulihan yang sangat pelan dan singkat.') +
        driftNote
      );
    case 'undertraining':
      return `Beban latihan minggu ini tergolong ringan. Anda bisa menambah durasi lari santai sekitar ${durationAddMin || 10} menit secara bertahap.${driftNote}`;
    case 'sweet_spot':
    default:
      return (
        (session === 'tempo'
          ? 'Kondisi beban tubuh seimbang dan aman. Anda siap melanjutkan progres sesuai jadwal latihan.'
          : 'Kondisi beban tubuh seimbang dan aman. Lanjutkan latihan dengan lari santai sesuai jadwal.') +
        driftNote
      );
  }
}

export default function CoachCard({
  workouts,
  profile,
  embedded = false,
}: {
  workouts: Workout[];
  profile: UserProfile;
  embedded?: boolean;
}) {
  const t = Date.now();
  const load = acwr(workouts, profile, t);
  const ef = efTrend(workouts, t);
  const last = [...workouts].sort((a, b) => b.date - a.date)[0];
  const drift = last ? cardiacDrift(last.laps) : null;
  const scheduleState = loadScheduleState();
  const advice = coachAdvice({
    acwrStatus: load.status,
    acwrRatio: load.ratio,
    efImproving: ef.improving,
    lastType: last?.workoutType ?? null,
    daysSinceLast: last ? (t - last.date) / DAY_MS : null,
    lastDrift: drift,
    curriculum: 'custom',
  });
  const meta = STATUS_BADGE[load.status];
  const driftHigh = drift != null && drift > DRIFT_WARN_PCT;
  const friendlySummary = buildFriendlyAdvice(load.status, advice.session, advice.durationAddMin, driftHigh);

  const [hasApiKey, setHasApiKey] = useState(() => Boolean(loadGeminiApiKey()));
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(() =>
    loadCachedAiCoachAnalysis({ workouts, acwr: load, now: t }),
  );
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const syncOnline = () => setIsOnline(navigator.onLine);
    const syncKey = () => setHasApiKey(Boolean(loadGeminiApiKey()));
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    window.addEventListener('storage', syncKey);
    window.addEventListener('focus', syncKey);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
      window.removeEventListener('storage', syncKey);
      window.removeEventListener('focus', syncKey);
    };
  }, []);

  useEffect(() => {
    const cached = loadCachedAiCoachAnalysis({ workouts, acwr: load, now: t });
    if (cached) setAiResult(cached);
  }, [workouts, load.ratio, load.status]);

  const canAnalyzeAi = hasApiKey && isOnline && !aiLoading;

  const handleAnalyzeAi = async (forceRefresh = false) => {
    const key = loadGeminiApiKey();
    setHasApiKey(Boolean(key));
    setAiLoading(true);
    setAiError(null);
    try {
      const text = await requestAiCoachAnalysis(
        {
          profile,
          curriculum: 'custom',
          programTitle: scheduleState.programTitle,
          acwr: load,
          efTrend: ef,
          latestMafPaceSec: null,
          workouts,
          now: t,
        },
        { apiKey: key, isOnline: navigator.onLine, forceRefresh },
      );
      setAiResult(text);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Gagal meminta saran Pelatih AI.');
    } finally {
      setAiLoading(false);
    }
  };

  const aiPoints = aiResult ? parseCoachPoints(aiResult).map(stripMarkdown).filter(Boolean) : [];
  const cleanSummary = stripMarkdown(friendlySummary);
  const cleanRawAi = aiResult ? stripMarkdown(aiResult) : '';

  return (
    <section
      aria-label="Kondisi Tubuh dan Pelatih"
      className={embedded ? 'flex flex-col justify-between' : 'sport-card flex h-full flex-col justify-between p-5'}
    >
      <div>
        {/* Header & Status Badge */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[#BEF264]/25 bg-[#BEF264]/10 text-[#BEF264]">
              <Activity className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="font-display text-base font-bold tracking-tight text-white">Kondisi Tubuh & Pelatih</h2>
              <p className="text-xs text-zinc-400">Evaluasi kesiapan & beban latihan</p>
            </div>
          </div>

          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        </div>

        {/* Saran Praktis */}
        <p className="mt-4 rounded-2xl border border-white/[0.08] bg-[#18181D] px-4 py-3 text-sm leading-relaxed text-zinc-200">
          {cleanSummary}
        </p>

        {/* Tombol Tanya Pelatih AI */}
        <div className="mt-4">
          <Button
            variant="secondary"
            block={false}
            onClick={() => void handleAnalyzeAi(false)}
            disabled={!canAnalyzeAi}
            className="w-full gap-2 border-[#BEF264]/35 bg-[#BEF264]/10 text-[#BEF264] hover:border-[#BEF264]/50 hover:bg-[#BEF264]/15"
          >
            <Sparkles className="h-4 w-4 text-[#BEF264]" aria-hidden />
            <span className="whitespace-nowrap">{aiLoading ? 'Meminta saran Pelatih AI…' : 'Tanya Pelatih AI'}</span>
          </Button>

          {!hasApiKey && (
            <p className="mt-2 text-xs text-zinc-400">
              Tambahkan Gemini API Key di Profil untuk mengaktifkan analisis Pelatih AI.
            </p>
          )}
          {hasApiKey && !isOnline && (
            <p className="mt-2 text-xs text-zinc-400">
              Sedang offline. Hubungkan internet untuk tanya Pelatih AI.
            </p>
          )}

          {aiLoading && (
            <div className="mt-3">
              <AiLoader />
            </div>
          )}

          {aiError && (
            <p role="alert" className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-rose-300">
              {aiError}
            </p>
          )}

          {!aiLoading && aiResult && (
            <div className="mt-3 sport-subcard p-4" aria-live="polite">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#BEF264]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  <span>Saran Pelatih AI</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAnalyzeAi(true)}
                  disabled={!canAnalyzeAi}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-[#BEF264] hover:bg-[#BEF264]/10 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${aiLoading ? 'animate-spin' : ''}`} aria-hidden />
                  <span className="whitespace-nowrap">Perbarui</span>
                </button>
              </div>
              {aiPoints.length > 0 ? (
                <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-zinc-200">
                  {aiPoints.map((point, idx) => (
                    <li key={idx} className="flex gap-2.5">
                      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#BEF264]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-200">{cleanRawAi}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detail Rasio Beban (ACWR) & Efisiensi Jantung (EF) */}
      <details className="group mt-4 rounded-2xl border border-white/[0.08] bg-[#18181D]/80">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-xs font-semibold text-zinc-300">
          <span>Lihat detail rasio beban & efisiensi</span>
          <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden />
        </summary>

        <div className="space-y-3 border-t border-white/[0.06] px-3.5 py-3">
          {load.ratio != null ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-zinc-400">
                <span>Rasio Beban Tubuh (ACWR)</span>
                <span className="font-mono tabular-nums text-zinc-100">{load.ratio.toFixed(2)}</span>
              </div>

              <div className="relative py-1.5">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#27272E]">
                  <div className="h-full bg-sky-400/80" style={{ width: '44.44%' }} />
                  <div className="h-full bg-[#BEF264]" style={{ width: '27.78%' }} />
                  <div className="h-full bg-rose-500/90" style={{ width: '27.78%' }} />
                </div>

                <div
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                  style={{ left: `${acwrMarkerPct(load.ratio)}%` }}
                >
                  <span className={`block h-3.5 w-3.5 rounded-full border-2 border-[#09090B] ring-4 ${meta.pin}`} />
                </div>
              </div>

              <div className="relative mt-1 h-4 font-mono text-[10px] font-medium tabular-nums text-zinc-400" aria-hidden>
                <span className="absolute left-0">0.0</span>
                <span className="absolute -translate-x-1/2" style={{ left: '44.44%' }}>0.8</span>
                <span className="absolute -translate-x-1/2" style={{ left: '72.22%' }}>1.3</span>
                <span className="absolute right-0">1.8</span>
              </div>
              <div className="mt-1 flex justify-between text-[11px] font-medium">
                <span className="text-sky-400">Ringan</span>
                <span className="text-[#BEF264]">Optimal</span>
                <span className="text-rose-400">Terlalu Berat</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                Membandingkan Poin Usaha (TRIMP) 7 hari terakhir dengan rata-rata mingguan 28 hari. Rentang 0,8–1,3 menandakan beban seimbang.
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-400">
              Butuh lebih banyak catatan sesi untuk menghitung rasio beban tubuh (ACWR).
            </p>
          )}

          {(ef.improving || drift != null) && (
            <div className="space-y-1 border-t border-white/[0.06] pt-2.5 text-xs text-zinc-300">
              {ef.improving && (
                <div>
                  Efisiensi Jantung <span className="text-zinc-400">(EF)</span>: <strong className="text-[#BEF264]">Meningkat</strong>
                </div>
              )}
              {drift != null && (
                <div className="tabular-nums">
                  Kestabilan detak jantung sesi terakhir:{' '}
                  <strong className={`font-mono ${driftHigh ? 'text-amber-400' : 'text-zinc-100'}`}>{drift.toFixed(1)}%</strong>{' '}
                  <span className="text-zinc-400">(cardiac drift)</span>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
