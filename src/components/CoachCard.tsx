import { useEffect, useState } from 'react';
import { Activity, ChevronDown, Heart, RefreshCw, Sparkles } from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, cardiacDrift, DAY_MS, efTrend } from '../analytics/workload';
import type { AcwrStatus } from '../analytics/workload';
import { predictAll, velocityFor, ZONE_FRACTION } from '../analytics/predictor';
import { coachAdvice, DRIFT_WARN_PCT } from '../analytics/coachEngine';
import {
  loadCachedAiCoachAnalysis,
  loadGeminiApiKey,
  parseCoachPoints,
  requestAiCoachAnalysis,
} from '../analytics/aiCoach';
import { mafHr, mafTests } from '../plans/maf';
import { fmtPace } from '../plans/pace';
import { resolvePlan, selectBestPlan } from '../plans/planSelector';
import { loadMafAdj, loadPlanMode } from '../plans/scheduleStore';
import AiLoader from './AiLoader';
import { Button } from './ui';

type PaceZoneKey = keyof typeof ZONE_FRACTION;

const STATUS_BADGE: Record<AcwrStatus, { label: string; badge: string; pin: string }> = {
  unknown: {
    label: 'Belum Cukup Data',
    badge: 'bg-slate-400/15 text-slate-300 border-slate-400/25',
    pin: 'bg-slate-300 ring-slate-300/30',
  },
  undertraining: {
    label: 'Ringan',
    badge: 'bg-sky-400/15 text-sky-300 border-sky-400/30',
    pin: 'bg-sky-400 ring-sky-400/35',
  },
  sweet_spot: {
    label: 'Aman',
    badge: 'bg-volt/15 text-volt border-volt/30',
    pin: 'bg-volt ring-volt/35',
  },
  high_fatigue: {
    label: 'Terlalu Berat',
    badge: 'bg-coral/15 text-coral border-coral/35',
    pin: 'bg-coral ring-coral/35',
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
    textColor: 'text-sky-300',
    dotColor: 'bg-sky-400',
    hrFrac: [0.71, 0.82],
  },
  {
    key: 'marathon',
    name: 'Marathon',
    desc: 'Ritme stabil & efisien jangka panjang',
    barPct: '58%',
    barColor: 'bg-volt',
    textColor: 'text-volt',
    dotColor: 'bg-volt',
    hrFrac: [0.80, 0.87],
  },
  {
    key: 'threshold',
    name: 'Threshold',
    desc: 'Batas ambang laktat terkontrol',
    barPct: '78%',
    barColor: 'bg-amber-400',
    textColor: 'text-amber-300',
    dotColor: 'bg-amber-400',
    hrFrac: [0.86, 0.91],
  },
  {
    key: 'interval',
    name: 'Interval',
    desc: 'Kecepatan tinggi & kapasitas maksimal',
    barPct: '96%',
    barColor: 'bg-coral',
    textColor: 'text-coral',
    dotColor: 'bg-coral',
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
    <section
      aria-label="Zona Pace dan Intensitas"
      className="sport-card p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-100">Zona Pace</h2>
          <p className="text-xs text-slate-400">Target kecepatan latihan berdasarkan Skor Kebugaran Lari</p>
        </div>
        <span className="shrink-0 rounded-full border border-volt/30 bg-volt/15 px-3 py-1 text-xs font-extrabold tabular-nums text-volt">
          Skor {vdot.toFixed(1)} <span className="font-semibold text-volt/75">(VDOT)</span>
        </span>
      </div>

      <div className="mt-4 space-y-3.5">
        {PACE_ZONES.map((z) => {
          const paceStr = fmtPace(60000 / velocityFor(vdot, ZONE_FRACTION[z.key]));
          const bpmStr = formatBpmRange(z.hrFrac, maxHr);
          return (
            <div key={z.key} className="sport-subcard p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className={`h-2 w-2 rounded-full ${z.dotColor}`} />
                    <span className="text-sm font-bold text-slate-100">{z.name}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{z.desc}</p>
                </div>

                <div className="shrink-0 text-right tabular-nums">
                  <div className={`text-base font-extrabold ${z.textColor}`}>
                    {paceStr} <span className="text-xs font-semibold text-slate-400">/km</span>
                  </div>
                  {bpmStr && (
                    <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                      <Heart className="h-3 w-3 text-slate-500" aria-hidden />
                      <span>{bpmStr}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[#272A35]">
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
  curriculum: ReturnType<typeof resolvePlan>,
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
      if (curriculum === 'maf') {
        return `Beban latihan minggu ini tergolong ringan. Tambah durasi lari santai sekitar ${durationAddMin || 10} menit di zona detak jantung nyaman.${driftNote}`;
      }
      return `Beban latihan minggu ini tergolong ringan. Anda bisa menambah durasi lari santai sekitar ${durationAddMin || 10} menit secara bertahap.${driftNote}`;
    case 'sweet_spot':
    default:
      if (curriculum === 'maf') {
        return `Kondisi beban tubuh seimbang dan aman. Lanjutkan lari di zona detak jantung nyaman tanpa mengejar kecepatan.${driftNote}`;
      }
      return (
        (session === 'tempo'
          ? 'Kondisi beban tubuh seimbang dan aman. Anda siap melanjutkan progres sesuai jadwal latihan.'
          : 'Kondisi beban tubuh seimbang dan aman. Lanjutkan latihan dengan lari santai sesuai jadwal.') +
        driftNote
      );
  }
}

export default function CoachCard({ workouts, profile }: { workouts: Workout[]; profile: UserProfile }) {
  const t = Date.now();
  const load = acwr(workouts, profile, t);
  const ef = efTrend(workouts, t);
  const last = [...workouts].sort((a, b) => b.date - a.date)[0];
  const drift = last ? cardiacDrift(last.laps) : null;
  const preds = predictAll(workouts, t);
  const curriculum = resolvePlan(loadPlanMode(), selectBestPlan(workouts, profile, { now: t, projected5kSec: preds['5K']?.finalSec ?? null }));
  const advice = coachAdvice({
    acwrStatus: load.status,
    acwrRatio: load.ratio,
    efImproving: ef.improving,
    lastType: last?.workoutType ?? null,
    daysSinceLast: last ? (t - last.date) / DAY_MS : null,
    lastDrift: drift,
    curriculum,
  });
  const meta = STATUS_BADGE[load.status];
  const driftHigh = drift != null && drift > DRIFT_WARN_PCT;
  const friendlySummary = buildFriendlyAdvice(load.status, advice.session, advice.durationAddMin, curriculum, driftHigh);

  const [hasApiKey, setHasApiKey] = useState(() => Boolean(loadGeminiApiKey()));
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(() => loadCachedAiCoachAnalysis({ workouts, acwr: load, now: t }));
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

  const maf = mafHr(profile.age, loadMafAdj());
  const mafPts = mafTests(workouts, maf);
  const latestMafPaceSec = mafPts.length ? mafPts[mafPts.length - 1].paceSecPerKm : null;
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
          curriculum,
          acwr: load,
          efTrend: ef,
          latestMafPaceSec,
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

  const aiPoints = aiResult ? parseCoachPoints(aiResult) : [];

  return (
    <section aria-label="Kondisi Tubuh dan Pelatih" className="sport-card p-4">
      {/* Header & Badge Kondisi Beban Tubuh */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-volt/15 text-volt">
            <Activity className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-base font-bold tracking-tight text-white">Kondisi Tubuh &amp; Pelatih</h2>
            <p className="text-[11px] text-slate-400">Kondisi Beban Tubuh</p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${meta.badge}`}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          <span>{meta.label}</span>
        </span>
      </div>

      {/* 1–2 Kalimat Saran Praktis */}
      <p className="mt-3 text-sm leading-relaxed text-slate-200">{friendlySummary}</p>

      {/* Tombol Tanya Pelatih AI */}
      <div className="mt-3.5">
        <Button
          variant="secondary"
          onClick={() => void handleAnalyzeAi(false)}
          disabled={!canAnalyzeAi}
          className="gap-2 border-volt/35 bg-volt/10 text-volt hover:bg-volt/15"
        >
          <Sparkles className="h-4 w-4 text-volt" aria-hidden />
          <span>{aiLoading ? 'Meminta saran Pelatih AI…' : 'Tanya Pelatih AI'}</span>
        </Button>

        {!hasApiKey && (
          <p className="mt-2 text-xs text-slate-400">
            Tambahkan Gemini API Key di Profil untuk mengaktifkan Pelatih AI.
          </p>
        )}
        {hasApiKey && !isOnline && (
          <p className="mt-2 text-xs text-slate-400">
            Sedang offline. Hubungkan internet untuk tanya Pelatih AI.
          </p>
        )}

        {aiLoading && (
          <div className="mt-3">
            <AiLoader />
          </div>
        )}

        {aiError && (
          <p role="alert" className="mt-2.5 rounded-2xl border border-coral/30 bg-coral/10 px-3 py-2 text-xs leading-relaxed text-coral">
            {aiError}
          </p>
        )}

        {!aiLoading && aiResult && (
          <div className="mt-3 sport-subcard p-3.5" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-volt">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                <span>Saran Pelatih AI</span>
              </div>
              <button
                type="button"
                onClick={() => void handleAnalyzeAi(true)}
                disabled={!canAnalyzeAi}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-volt hover:bg-volt/10 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${aiLoading ? 'animate-spin' : ''}`} aria-hidden />
                <span>Perbarui Analisis</span>
              </button>
            </div>
            {aiPoints.length > 0 ? (
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-slate-200">
                {aiPoints.map((point, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-volt" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-200">{aiResult}</p>
            )}
          </div>
        )}
      </div>

      {/* Detail Rasio Beban (ACWR) & Efisiensi Jantung (EF) terlipat */}
      <details className="group mt-3.5 rounded-2xl border border-white/[0.08] bg-[#191B22]/70">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-semibold text-slate-300">
          <span>Lihat detail rasio beban</span>
          <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
        </summary>

        <div className="space-y-3 border-t border-white/[0.06] px-3 py-3">
          {load.ratio != null ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-400">
                <span>Kondisi Beban Tubuh (ACWR)</span>
                <span className="tabular-nums text-slate-200">Rasio {load.ratio.toFixed(2)}</span>
              </div>

              <div className="relative py-1.5">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#272A35]">
                  <div className="h-full bg-sky-400/75" style={{ width: '44.44%' }} />
                  <div className="h-full bg-volt" style={{ width: '27.78%' }} />
                  <div className="h-full bg-coral/90" style={{ width: '27.78%' }} />
                </div>

                <div
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                  style={{ left: `${acwrMarkerPct(load.ratio)}%` }}
                >
                  <span className={`block h-3.5 w-3.5 rounded-full border-2 border-[#070709] ring-4 ${meta.pin}`} />
                </div>
              </div>

              <div className="relative mt-1 h-4 text-[10px] font-medium tabular-nums text-slate-400" aria-hidden>
                <span className="absolute left-0">0.0</span>
                <span className="absolute -translate-x-1/2" style={{ left: '44.44%' }}>0.8</span>
                <span className="absolute -translate-x-1/2" style={{ left: '72.22%' }}>1.3</span>
                <span className="absolute right-0">1.8</span>
              </div>
              <div className="mt-1 flex justify-between text-[10px] font-medium text-slate-400">
                <span className="text-sky-300">Ringan</span>
                <span className="text-volt">Aman</span>
                <span className="text-coral">Terlalu Berat</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Membandingkan Poin Usaha (TRIMP) 7 hari terakhir dengan rata-rata mingguan sebelumnya. Rentang 0,8–1,3 berarti Aman.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              Butuh lebih banyak catatan sesi untuk menghitung rasio beban tubuh (ACWR).
            </p>
          )}

          {(ef.improving || drift != null) && (
            <div className="space-y-1 border-t border-white/[0.06] pt-2 text-xs text-slate-300">
              {ef.improving && (
                <div>
                  Efisiensi Jantung <span className="text-slate-400">(EF)</span>: <strong className="text-volt">Meningkat</strong>
                </div>
              )}
              {drift != null && (
                <div className="tabular-nums">
                  Kestabilan detak jantung sesi terakhir: <strong className={driftHigh ? 'text-amber-300' : 'text-slate-200'}>{drift.toFixed(1)}%</strong>{' '}
                  <span className="text-slate-400">(cardiac drift)</span>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
