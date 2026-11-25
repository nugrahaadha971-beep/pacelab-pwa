import { useState, type ReactNode } from 'react';
import { BarChart3, ChevronDown, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import { acwr, DAY_MS, efficiencyFactor, tanakaMaxHr, type AcwrStatus } from '../analytics/workload';
import { currentVdot, PENALTY_RULES, predictAll, RACE_KM, velocityFor, ZONE_FRACTION } from '../analytics/predictor';
import { compareProgress } from '../analytics/progressSummary';
import { analyzeWorkoutPeriod } from '../analytics/sessionAnalysis';
import { parseDuration } from '../parsers/manual';
import { applyAdaptation, evaluateAdaptation, gatherAdaptiveInput } from '../plans/adaptiveEngine';
import { resolveMaxHr } from '../plans/hrZones';
import { mafHr, mafTests } from '../plans/maf';
import { fmtPace, nearestRow, paceSecPerKm } from '../plans/pace';
import { resolvePlan, selectBestPlan } from '../plans/planSelector';
import { applyScheduleState, buildPlan, completedIds, flattenPlan, isoFromLocal, isoFromRaceTs, type PlanSession } from '../plans/schedule';
import { loadMafAdj, loadPlanMode, loadScheduleState } from '../plans/scheduleStore';
import { fmtHms, todayStr } from './format';
import { weeklyKm } from './historyFilter';
import AcwrGauge from './AcwrGauge';
import { ZonaPaceCard } from './CoachCard';
import HrZoneDistributionCard from './HrZoneDistributionCard';
import { KpiTile, ScreenHeader, SegmentedTabs, StatusPill, type Tone } from './ui';
import SessionAnalysisTab from './SessionAnalysisTab';

const RANGES = [7, 28, 90] as const;
type Range = (typeof RANGES)[number];

const axis = { stroke: '#71717A', fontSize: 11, tickLine: false, axisLine: false };
const short = (ts: number) => new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

/** Angka desimal gaya Indonesia: 12,3 (koma). */
const dec = (x: number, digits = 1) => x.toFixed(digits).replace('.', ',');
/** Selisih bertanda: +4,5 / -2,1. */
const signed = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${dec(Math.abs(x), digits)}`;

const INTENSITY_PILL: Record<'insufficient' | 'balanced' | 'too_hard' | 'base_building', { tone: 'good' | 'warn' | 'info'; label: string }> = {
  insufficient: { tone: 'info', label: 'Data belum cukup' },
  balanced: { tone: 'good', label: 'Seimbang' },
  too_hard: { tone: 'warn', label: 'Terlalu banyak lari cepat' },
  base_building: { tone: 'info', label: 'Fondasi aerobik' },
};

const ACWR_PILL: Record<AcwrStatus, { tone: Exclude<Tone, 'neutral'>; label: string }> = {
  unknown: { tone: 'info', label: 'Data belum cukup' },
  undertraining: { tone: 'info', label: 'Ringan' },
  sweet_spot: { tone: 'good', label: 'Aman' },
  high_fatigue: { tone: 'bad', label: 'Terlalu Berat' },
};

function Card({ title, subtitle, className = '', children }: { title: string; subtitle?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`sport-card p-5 ${className}`}>
      <div className="mb-3.5">
        <h2 className="font-display text-base font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

const CALLOUT_STYLE: Record<'good' | 'warn' | 'info', string> = {
  good: 'border-[#BEF264]/25 bg-[#BEF264]/[0.07] text-zinc-100',
  warn: 'border-rose-500/30 bg-rose-500/[0.08] text-rose-100',
  info: 'border-white/10 bg-[#18181D] text-zinc-200',
};

function ChartSummary({ tone = 'info', text }: { tone?: 'good' | 'warn' | 'info'; text: string }) {
  return (
    <p className={`mb-4 rounded-2xl border px-3.5 py-2.5 text-xs leading-relaxed ${CALLOUT_STYLE[tone]}`}>
      {text}
    </p>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ value?: number | null; name?: string }>;
  unitLabel: string;
  valueFormatter: (v: number) => string;
  accentClass?: string;
}

function DarkChartTooltip({ active, label, payload, unitLabel, valueFormatter, accentClass = 'text-[#BEF264]' }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const raw = payload[0]?.value;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  return (
    <div className="rounded-2xl border border-white/15 bg-[#121215]/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur-md">
      <div className="font-medium text-zinc-400">{label}</div>
      <div className={`mt-1 font-mono text-base font-extrabold tabular-nums ${accentClass}`}>
        {valueFormatter(Number(raw))}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-400">{unitLabel}</div>
    </div>
  );
}

function EmptyChartState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#18181D]/60 px-4 py-12 text-center">
      <BarChart3 size={24} className="text-zinc-500" aria-hidden />
      <p className="mt-2.5 text-sm font-semibold text-zinc-200">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-400">{description}</p>
    </div>
  );
}

type View = 'ringkasan' | 'grafik' | 'sesi';
const VIEW_TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'grafik', label: 'Grafik' },
  { id: 'sesi', label: 'Per Sesi' },
];

type ChartKind = 'pace' | 'ef' | 'acwr' | 'weekly';
const CHART_TABS: ReadonlyArray<{ id: ChartKind; label: string }> = [
  { id: 'pace', label: 'Pace Santai' },
  { id: 'ef', label: 'Efisiensi (EF)' },
  { id: 'acwr', label: 'Beban (ACWR)' },
  { id: 'weekly', label: 'Volume Mingguan' },
];

/**
 * Konteks program untuk analisis sesi. Logikanya sama dengan Beranda (nextSession) dan Saran Pelatih,
 * sehingga sesi yang dianalisis cocok dengan jadwal yang dilihat pengguna.
 */
function programContextFor(profile: UserProfile, workouts: Workout[], now: number, preds: ReturnType<typeof predictAll>) {
  const todayIso = todayStr();
  const selection = selectBestPlan(workouts, profile, { now, projected5kSec: preds['5K']?.finalSec ?? null });
  const curriculum = resolvePlan(loadPlanMode(), selection);
  const mafAdjustment = loadMafAdj();
  const maf = curriculum === 'maf' ? mafHr(profile.age, mafAdjustment) : null;
  const mafPts = curriculum === 'maf' ? mafTests(workouts, maf) : [];
  const mafPaceSecPerKm = mafPts.length ? mafPts[mafPts.length - 1].paceSecPerKm : null;

  const vd = currentVdot(workouts, now);
  const easyVdot = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;
  let saved: string | null = null;
  try { saved = localStorage.getItem('pacelab.k5'); } catch { /* penyimpanan tidak tersedia */ }
  const k5 = parseDuration(saved ?? (preds['5K'] ? fmtHms(preds['5K'].finalSec) : ''));
  const row = k5 != null ? nearestRow(k5) : null;
  const easyPace = paceSecPerKm('rec', row) ?? easyVdot;

  let plannedSessions: PlanSession[] | undefined;
  const raceIso = profile.targetRaceDate ? isoFromRaceTs(profile.targetRaceDate) : null;
  if (raceIso) {
    const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
    const startWeeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
    const maxWeeklyKm = profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 50;
    const maxHr = resolveMaxHr(profile, workouts);
    const st = loadScheduleState();
    const base = buildPlan({
      raceIso, todayIso, days: st.days, raceName: `${profile.targetDistance} · Hari Lomba / Uji PB`,
      startWeeklyKm, maxWeeklyKm, easyPaceSecPerKm: easyPace, curriculum, maxHr, mafHr: maf,
    });
    const flat = flattenPlan(applyScheduleState(base, st, raceIso));
    const done = completedIds(flat, new Set(workouts.map((w) => isoFromLocal(w.date))), st, todayIso);
    const decision = evaluateAdaptation(gatherAdaptiveInput(workouts, profile, now).input);
    plannedSessions = applyAdaptation(flat, decision, todayIso, done, maxHr).sessions;
  }

  return {
    curriculum,
    mafAdjustment,
    easyPaceSecPerKm: curriculum === 'maf' ? null : easyPace,
    mafPaceSecPerKm,
    plannedSessions,
  };
}

export default function Analitik({ profile, workouts }: { profile: UserProfile; workouts: Workout[] }) {
  const [days, setDays] = useState<Range>(28);
  const [view, setView] = useState<View>('ringkasan');
  const [chartKind, setChartKind] = useState<ChartKind>('pace');
  const now = Date.now();
  const progress = compareProgress(workouts, now, days);
  const { current: cur } = progress;
  const hasSessions = cur.sessions > 0;
  const gauge = acwr(workouts, profile, now);
  const acwrData = Array.from({ length: days }, (_, i) => {
    const ts = now - (days - 1 - i) * DAY_MS;
    return { d: short(ts), acwr: acwr(workouts, profile, ts).ratio };
  });
  const acwrMax = Math.max(2, Math.ceil(Math.max(0, ...acwrData.map((d) => d.acwr ?? 0)) * 2) / 2);
  const inRange = workouts.filter((w) => w.date <= now && now - w.date <= days * DAY_MS);
  const efData = inRange
    .filter((w) => w.workoutType === 'easy' || w.workoutType === 'long_run')
    .sort((a, b) => a.date - b.date)
    .map((w) => ({ d: short(w.date), ef: w.efficiencyFactor ?? efficiencyFactor(w) }));
  const trend = progress.series
    .filter((p) => p.easyPaceSec != null)
    .map((p) => ({ d: short(p.date), pace: p.easyPaceSec }));
  const hasPace = trend.length > 0;
  const weekly = weeklyKm(workouts, now, Math.max(2, Math.round(days / 7)));
  const hasWeekly = weekly.some((w) => w.km > 0);
  const preds = predictAll(workouts, now);
  const program = programContextFor(profile, workouts, now, preds);
  const period = analyzeWorkoutPeriod(workouts, now, days, {
    profile,
    curriculum: program.curriculum,
    mafAdjustment: program.mafAdjustment,
    easyPaceSecPerKm: program.easyPaceSecPerKm,
    mafPaceSecPerKm: program.mafPaceSecPerKm,
    plannedSessions: program.plannedSessions,
  });
  const dists = Object.keys(RACE_KM) as RaceDistance[];
  const vd = currentVdot(workouts, now);
  const maxHr = resolveMaxHr(profile, workouts);
  const effectiveMaxHr = maxHr ?? (profile.age > 0 ? tanakaMaxHr(profile.age) : null);

  // ── Catatan perubahan pada ubin KPI ──────────────────────────────────────
  const ago = `${days} hr lalu`;
  const none = 'Belum ada pembanding';
  const kmNote = progress.kmDeltaPct == null ? none
    : Math.round(progress.kmDeltaPct) === 0 ? `Sama seperti ${ago}`
    : `${progress.kmDeltaPct > 0 ? '▲' : '▼'} ${signed(Math.round(progress.kmDeltaPct), 0)}% vs ${ago}`;

  const pd = progress.easyPaceDeltaSec;
  const paceNote = pd == null ? none : Math.abs(pd) < 1 ? 'Stabil' : `${pd < 0 ? 'Lebih cepat' : 'Lebih lambat'} ${Math.abs(Math.round(pd))} dtk/km`;
  const paceTone: Tone = pd != null && pd <= -1 ? 'good' : 'neutral';

  const ed = progress.efDeltaPct;
  const efNote = ed == null ? none : `${ed >= 0 ? '▲' : '▼'} ${signed(ed)}%`;
  const efTone: Tone = ed == null ? 'neutral' : ed >= 2 ? 'good' : ed <= -3 ? 'warn' : 'neutral';

  const drift = cur.avgDriftPct;
  const driftNote = `Drift: ${drift == null ? '–' : `${dec(drift)}%`}`;
  const driftTone: Tone = drift == null ? 'neutral' : drift > 5 ? 'warn' : 'good';

  const improving = (ed ?? 0) >= 2 || (pd ?? 0) <= -4 || (progress.kmDeltaPct ?? 0) >= 10;

  // Terjemahan EF ke angka nyata: selisih pace santai dan detak jantung rata-rata.
  const real: string[] = [];
  if (pd != null) real.push(Math.abs(pd) < 1 ? 'pace santai stabil' : `pace santai ${pd < 0 ? 'lebih cepat' : 'lebih lambat'} ${Math.abs(Math.round(pd))} dtk/km`);
  if (progress.hrDeltaBpm != null) {
    const h = Math.round(progress.hrDeltaBpm);
    real.push(h === 0 ? 'detak jantung rata-rata sama' : `detak jantung rata-rata ${h < 0 ? 'turun' : 'naik'} ${Math.abs(h)} bpm`);
  }

  const easy = cur.easySharePct;
  const quality = cur.qualitySharePct;
  const pill = INTENSITY_PILL[progress.intensityStatus];
  const acwrPill = ACWR_PILL[gauge.status];

  const loadAdvice = gauge.status === 'high_fatigue'
    ? 'Beban latihan sedang terlalu berat—kurangi intensitas atau ambil istirahat agar terhindar dari cedera.'
    : gauge.status === 'undertraining'
      ? 'Beban masih ringan; kamu bisa menambah porsi lari santai bertahap sambil menjaga prinsip 80/20.'
      : gauge.status === 'sweet_spot'
        ? progress.intensityNote
        : 'Catat beberapa sesi lari lagi agar rasio beban tubuh dan komposisi intensitas terbaca.';

  // ── Kesimpulan bahasa sehari-hari 1 kalimat di atas setiap grafik ────────
  const acwrChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    gauge.status === 'sweet_spot'
      ? { tone: 'good', text: 'Beban latihanmu saat ini berada di zona aman (0,8–1,3), sehingga tubuh beradaptasi dengan baik tanpa kelelahan berlebih.' }
      : gauge.status === 'high_fatigue'
        ? { tone: 'warn', text: 'Beban latihanmu sedang terlalu tinggi—kurangi intensitas atau ambil istirahat agar terhindar dari cedera.' }
        : gauge.status === 'undertraining'
          ? { tone: 'info', text: 'Beban latihanmu saat ini tergolong ringan, jadi masih ada ruang untuk menambah durasi lari santai secara bertahap.' }
          : { tone: 'info', text: 'Catat beberapa sesi lari lagi agar grafik kondisi beban tubuhmu mulai terbentuk.' };

  const paceChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    !hasPace
      ? { tone: 'info', text: 'Belum ada sesi lari santai (easy/long run) pada rentang ini untuk melihat tren kecepatan.' }
      : pd != null && pd <= -3
        ? { tone: 'good', text: 'Lari santaimu kini lebih cepat dibanding sebelumnya—tanda daya tahan tubuhmu sedang meningkat.' }
        : pd != null && pd >= 3
          ? { tone: 'info', text: 'Pace lari santaimu sedikit melambat; ini wajar bila kamu menjaga detak jantung tetap rendah atau saat cuaca panas.' }
          : { tone: 'info', text: 'Kecepatan lari santaimu terjaga stabil sepanjang periode ini.' };

  const efChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    efData.length === 0
      ? { tone: 'info', text: 'Lari santai dengan sensor detak jantung dibutuhkan agar efisiensi jantungmu bisa dipantau.' }
      : ed != null && ed >= 2
        ? { tone: 'good', text: 'Efisiensi jantungmu membaik—kamu bisa berlari sama cepat atau lebih cepat dengan detak jantung lebih hemat.' }
        : ed != null && ed <= -3
          ? { tone: 'warn', text: 'Jantung bekerja sedikit lebih keras dari biasanya, kemungkinan karena kurang pulih, kurang tidur, atau cuaca panas.' }
          : { tone: 'info', text: 'Efisiensi jantungmu stabil, menandakan tubuhmu beradaptasi dengan baik pada porsi latihan sekarang.' };

  const kmDelta = progress.kmDeltaPct;
  const weeklyChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    !hasWeekly
      ? { tone: 'info', text: 'Belum ada jarak lari yang tercatat pada rentang waktu ini.' }
      : kmDelta != null && kmDelta >= 15
        ? { tone: 'warn', text: 'Total jarak mingguanmu naik cukup cepat—pastikan tetap menyelipkan hari santai agar otot dan sendi tidak kaget.' }
        : kmDelta != null && kmDelta <= -15
          ? { tone: 'info', text: 'Jarak mingguanmu sedang lebih ringan dari periode lalu, bagus untuk memberi waktu tubuh memulihkan tenaga.' }
          : { tone: 'good', text: 'Total jarak lari mingguanmu berjalan konsisten, kebiasaan baik untuk membangun daya tahan jangka panjang.' };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <ScreenHeader title="Analitik" subtitle="Perkembangan kebugaran, beban latihan & evaluasi sesi" />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div role="group" aria-label="Rentang waktu" className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-[#121215] p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={days === r}
                onClick={() => setDays(r)}
                className={`min-h-[38px] whitespace-nowrap rounded-xl px-3 font-display text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                  days === r ? 'bg-[#BEF264] text-[#09090B]' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {r} Hari
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-md">
        <SegmentedTabs idBase="analitik" label="Tampilan analitik" tabs={VIEW_TABS} value={view} onChange={setView} />
      </div>

      {view === 'sesi' ? (
        <SessionAnalysisTab days={days} curriculum={program.curriculum} items={period.items} summary={period.summary} />
      ) : view === 'grafik' ? (
        <div className="space-y-4">
          <div role="group" aria-label="Pilih grafik" className="flex flex-wrap gap-2">
            {CHART_TABS.map((t) => {
              const active = chartKind === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setChartKind(t.id)}
                  className={`min-h-[40px] whitespace-nowrap rounded-2xl border px-4 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                    active
                      ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                      : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/20 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <Card
            title={CHART_TABS.find((t) => t.id === chartKind)?.label ?? 'Grafik'}
            subtitle={`Data ${days} hari terakhir`}
          >
            {chartKind === 'pace' && (
              <>
                <ChartSummary tone={paceChartSummary.tone} text={paceChartSummary.text} />
                {hasPace ? (
                  <div className="h-[240px] w-full sm:h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="paceAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#BEF264" stopOpacity={0.32} />
                            <stop offset="100%" stopColor="#BEF264" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="d" {...axis} minTickGap={24} />
                        <YAxis {...axis} width={44} reversed domain={['auto', 'auto']} tickFormatter={(v: number) => fmtPace(v)} />
                        {cur.easyAvgPaceSec != null && (
                          <ReferenceLine
                            y={cur.easyAvgPaceSec}
                            stroke="#BEF264"
                            strokeDasharray="4 4"
                            strokeOpacity={0.5}
                          />
                        )}
                        <Tooltip
                          content={
                            <DarkChartTooltip
                              unitLabel="Rata-rata pace lari santai (garis putus: rata-rata periode)"
                              valueFormatter={(v) => `${fmtPace(v)} /km`}
                              accentClass="text-[#BEF264]"
                            />
                          }
                        />
                        <Area
                          type="monotone"
                          dataKey="pace"
                          stroke="#BEF264"
                          strokeWidth={2.5}
                          fill="url(#paceAreaGrad)"
                          dot={{ r: 3.5, fill: '#09090B', stroke: '#BEF264', strokeWidth: 2 }}
                          activeDot={{ r: 5.5, fill: '#BEF264', stroke: '#09090B', strokeWidth: 2 }}
                          connectNulls
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyChartState
                    title="Belum ada data pace santai"
                    description={`Catat sesi Easy Run atau Long Run dalam ${days} hari terakhir untuk melihat grafik progres kecepatan.`}
                  />
                )}
              </>
            )}

            {chartKind === 'ef' && (
              <>
                <ChartSummary tone={efChartSummary.tone} text={efChartSummary.text} />
                {efData.length > 0 ? (
                  <div className="h-[240px] w-full sm:h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={efData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="efAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#38BDF8" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="d" {...axis} minTickGap={24} />
                        <YAxis {...axis} width={40} domain={['auto', 'auto']} />
                        {cur.avgEf != null && (
                          <ReferenceLine
                            y={cur.avgEf}
                            stroke="#38BDF8"
                            strokeDasharray="4 4"
                            strokeOpacity={0.5}
                          />
                        )}
                        <Tooltip
                          content={
                            <DarkChartTooltip
                              unitLabel="Efisiensi Aerobik (kecepatan ÷ HR)"
                              valueFormatter={(v) => dec(v, 2)}
                              accentClass="text-sky-400"
                            />
                          }
                        />
                        <Area
                          type="monotone"
                          dataKey="ef"
                          stroke="#38BDF8"
                          strokeWidth={2.5}
                          fill="url(#efAreaGrad)"
                          dot={{ r: 3.5, fill: '#09090B', stroke: '#38BDF8', strokeWidth: 2 }}
                          activeDot={{ r: 5.5, fill: '#38BDF8', stroke: '#09090B', strokeWidth: 2 }}
                          connectNulls
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyChartState
                    title="Belum ada data Efisiensi Jantung"
                    description="Dibutuhkan sesi Easy atau Long Run dengan data detak jantung (HR) untuk menghitung Efficiency Factor."
                  />
                )}
              </>
            )}

            {chartKind === 'acwr' && (
              <>
                <ChartSummary tone={acwrChartSummary.tone} text={acwrChartSummary.text} />
                {hasSessions ? (
                  <div className="h-[240px] w-full sm:h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={acwrData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                        <defs>
                          <linearGradient id="acwrAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#BEF264" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#BEF264" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <ReferenceArea y1={0.8} y2={1.3} fill="#BEF264" fillOpacity={0.08} />
                        <ReferenceLine y={0.8} stroke="#38BDF8" strokeDasharray="4 4" strokeOpacity={0.55} />
                        <ReferenceLine y={1.3} stroke="#BEF264" strokeDasharray="4 4" strokeOpacity={0.6} />
                        <ReferenceLine y={1.5} stroke="#F43F5E" strokeDasharray="4 4" strokeOpacity={0.65} />
                        <XAxis dataKey="d" {...axis} minTickGap={24} />
                        <YAxis domain={[0, acwrMax]} {...axis} width={36} />
                        <Tooltip
                          content={
                            <DarkChartTooltip
                              unitLabel="Rasio ACWR (zona optimal 0,8–1,3)"
                              valueFormatter={(v) => dec(v, 2)}
                              accentClass="text-[#BEF264]"
                            />
                          }
                        />
                        <Area
                          type="monotone"
                          dataKey="acwr"
                          stroke="#BEF264"
                          strokeWidth={2.5}
                          fill="url(#acwrAreaGrad)"
                          dot={false}
                          activeDot={{ r: 5, fill: '#BEF264', stroke: '#09090B', strokeWidth: 2 }}
                          connectNulls
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyChartState
                    title="Belum ada grafik rasio beban"
                    description={`Belum ada sesi lari dalam ${days} hari terakhir untuk memetakan tren ACWR.`}
                  />
                )}
              </>
            )}

            {chartKind === 'weekly' && (
              <>
                <ChartSummary tone={weeklyChartSummary.tone} text={weeklyChartSummary.text} />
                {hasWeekly ? (
                  <div className="h-[240px] w-full sm:h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weekly} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                        <defs>
                          <linearGradient id="analitikCyanBar" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#38BDF8" stopOpacity={0.28} />
                          </linearGradient>
                          <linearGradient id="analitikLimeBar" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#BEF264" stopOpacity={1} />
                            <stop offset="100%" stopColor="#BEF264" stopOpacity={0.45} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="label" {...axis} />
                        <YAxis {...axis} width={36} />
                        {profile.weeklyTargetKm != null && profile.weeklyTargetKm > 0 && (
                          <ReferenceLine
                            y={profile.weeklyTargetKm}
                            stroke="#BEF264"
                            strokeDasharray="4 4"
                            strokeOpacity={0.7}
                          />
                        )}
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          content={
                            <DarkChartTooltip
                              unitLabel={
                                profile.weeklyTargetKm
                                  ? `Total volume mingguan (target ${profile.weeklyTargetKm} km)`
                                  : 'Total volume lari mingguan'
                              }
                              valueFormatter={(v) => `${dec(v, 1)} km`}
                              accentClass="text-sky-400"
                            />
                          }
                        />
                        <Bar dataKey="km" radius={[8, 8, 2, 2]} maxBarSize={44}>
                          {weekly.map((_, i) => (
                            <Cell
                              key={i}
                              fill={i === weekly.length - 1 ? 'url(#analitikLimeBar)' : 'url(#analitikCyanBar)'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyChartState
                    title="Belum ada volume mingguan"
                    description={`Catat sesi lari untuk melihat distribusi kilometer per minggu dalam ${days} hari terakhir.`}
                  />
                )}
              </>
            )}
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
          {/* Kartu 1 — Perkembangan Utama */}
          <Card title="Perkembangan Utama" subtitle={`Ringkasan ${days} hari terakhir`} className="flex flex-col justify-between lg:col-span-7">
            <div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-[#18181D] px-4 py-3.5 text-sm font-medium text-zinc-100">
                <TrendingUp
                  size={18}
                  aria-hidden
                  className={`mt-0.5 shrink-0 ${improving ? 'text-[#BEF264]' : 'text-sky-400'}`}
                />
                <span className="leading-relaxed">
                  {hasSessions
                    ? progress.headline
                    : `Belum ada sesi dalam ${days} hari terakhir. Ketuk tombol Catat Sesi untuk memulai.`}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <KpiTile label="Jarak" value={dec(cur.totalKm)} unit="km" context={kmNote} tone="info" accentClass="text-sky-400" />
                <KpiTile
                  label="Pace Santai"
                  value={cur.easyAvgPaceSec != null ? fmtPace(cur.easyAvgPaceSec) : '–'}
                  unit="/km"
                  context={paceNote}
                  tone={paceTone}
                  accentClass="text-[#BEF264]"
                />
                <KpiTile
                  label="Efisiensi Jantung"
                  value={cur.avgEf != null ? dec(cur.avgEf, 2) : '–'}
                  context={efNote}
                  tone={efTone}
                />
                <KpiTile
                  label="Kadens"
                  value={cur.avgCadence != null ? Math.round(cur.avgCadence) : '–'}
                  unit="spm"
                  context={driftNote}
                  tone={driftTone}
                />
              </div>
            </div>

            <details className="group mt-4 rounded-2xl border border-white/[0.08] bg-[#18181D]/70">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-xs font-semibold text-zinc-300">
                <span>Apa arti metrik ini?</span>
                <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-2 border-t border-white/[0.06] px-3.5 py-3 text-xs leading-relaxed text-zinc-300">
                {real.length > 0 && (
                  <p>
                    <strong className="text-zinc-100">Dibanding {days} hari lalu:</strong> {real.join(' · ')}.
                  </p>
                )}
                <p>
                  <strong className="text-zinc-100">Efisiensi Jantung (EF):</strong> rasio kecepatan lari terhadap detak jantung. Makin tinggi berarti jantung makin hemat tenaga.
                </p>
                <p>
                  <strong className="text-zinc-100">Cardiac Drift:</strong> kenaikan detak jantung di paruh akhir lari; di bawah 5% menandakan fondasi aerobik baik.
                </p>
              </div>
            </details>
          </Card>

          {/* Kartu 2 — Kondisi Beban & Intensitas */}
          <Card title="Kondisi Beban & Intensitas" subtitle="Rasio ACWR & distribusi 80/20" className="flex flex-col justify-between lg:col-span-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-400">Rasio Beban Tubuh (ACWR)</span>
                <StatusPill tone={acwrPill.tone}>{acwrPill.label}</StatusPill>
              </div>
              <div className="mt-3">
                <AcwrGauge ratio={gauge.ratio} status={gauge.status} />
              </div>
            </div>

            <div className="mt-5 border-t border-white/[0.08] pt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-zinc-300">Prinsip 80/20</span>
                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
              </div>
              <div
                className="flex h-2.5 overflow-hidden rounded-full bg-white/10"
                role="img"
                aria-label={easy == null ? 'Belum ada data' : `Lari santai ${Math.round(easy)} persen, lari cepat ${Math.round(quality ?? 0)} persen`}
              >
                {easy != null && <div className="bg-sky-400" style={{ width: `${easy}%` }} />}
                {quality != null && <div className="bg-rose-500" style={{ width: `${quality}%` }} />}
              </div>
              <div className="mt-2 flex justify-between text-xs tabular-nums">
                <span className="text-sky-400">
                  Santai <strong className="font-mono">{easy == null ? '–' : `${Math.round(easy)}%`}</strong>
                </span>
                <span className="text-rose-400">
                  Cepat <strong className="font-mono">{quality == null ? '–' : `${Math.round(quality)}%`}</strong>
                </span>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">{loadAdvice}</p>
            </div>
          </Card>

          {/* Kartu 2b — Distribusi Zona Detak Jantung (Z1–Z5) */}
          <HrZoneDistributionCard
            workouts={inRange}
            days={days}
            maxHr={effectiveMaxHr}
            className="lg:col-span-12"
          />

          {/* Kartu 3 — Rekor, Prediksi Lomba & Zona Pace */}
          <div className="grid grid-cols-1 gap-4 lg:col-span-12 lg:grid-cols-12 lg:gap-5">
            <Card title="Rekor & Prediksi Lomba" subtitle="Estimasi waktu Riegel dari performa terkini" className="lg:col-span-5">
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="sport-subcard p-3">
                  <div className="text-[11px] font-medium text-zinc-400">Terpanjang</div>
                  <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-sky-400">
                    {dec(cur.longestKm)}
                    <span className="ml-0.5 font-sans text-xs font-semibold text-zinc-400"> km</span>
                  </div>
                </div>
                <div className="sport-subcard p-3">
                  <div className="text-[11px] font-medium text-zinc-400">Tercepat</div>
                  <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-[#BEF264]">
                    {cur.bestPaceSec != null ? fmtPace(cur.bestPaceSec) : '–'}
                    <span className="ml-0.5 font-sans text-xs font-semibold text-zinc-400"> /km</span>
                  </div>
                </div>
                <div className="sport-subcard p-3">
                  <div className="text-[11px] font-medium text-zinc-400">Frekuensi</div>
                  <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-white">
                    {dec(cur.sessionsPerWeek)}
                    <span className="ml-0.5 font-sans text-xs font-semibold text-zinc-400"> /mgg</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 divide-y divide-white/[0.06]">
                {dists.map((d) => {
                  const p = preds[d];
                  const isTarget = d === profile.targetDistance;
                  return (
                    <div key={d} className="flex items-center justify-between py-2.5 text-sm">
                      <span className={`font-semibold ${isTarget ? 'text-[#BEF264]' : 'text-zinc-300'}`}>
                        {d} {isTarget && <span className="ml-1 text-xs font-normal text-zinc-400">(Target)</span>}
                      </span>
                      <span className={`font-mono font-bold tabular-nums ${isTarget ? 'text-[#BEF264]' : 'text-white'}`}>
                        {p ? fmtHms(p.finalSec) : '–'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <div className="lg:col-span-7">
              {vd != null ? (
                <ZonaPaceCard vdot={vd} maxHr={maxHr} />
              ) : (
                <Card title="Zona Pace Latihan" subtitle="Target kecepatan & detak jantung">
                  <EmptyChartState
                    title="Belum ada skor VDOT"
                    description="Catat minimal 1 sesi lari ≥ 3 km untuk menghitung zona pace Easy, Marathon, Threshold, dan Interval."
                  />
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
