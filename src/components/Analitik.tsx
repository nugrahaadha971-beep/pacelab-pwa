import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, acwrHistoryDays, DAY_MS, efficiencyFactor, tanakaMaxHr, type AcwrStatus } from '../analytics/workload';
import { compareProgress } from '../analytics/progressSummary';
import { resolveMaxHr } from '../plans/hrZones';
import { fmtPace } from '../plans/pace';
import { weeklyKm } from './historyFilter';
import AcwrGauge from './AcwrGauge';
import HrZoneDistributionCard from './HrZoneDistributionCard';
import PaceHrChartCard from './PaceHrChartCard';
import ProgramEvaluationCard from './ProgramEvaluationCard';
import { ScreenHeader, StatusPill, type Tone } from './ui';

const RANGES = [7, 28, 90] as const;
type Range = (typeof RANGES)[number];
type TrendKind = 'ef' | 'pace';

const axis = { stroke: '#71717A', fontSize: 11, tickLine: false, axisLine: false };
const short = (ts: number) => new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const dec = (x: number, digits = 1) => x.toFixed(digits).replace('.', ',');

const ACWR_PILL: Record<AcwrStatus, { tone: Exclude<Tone, 'neutral'>; label: string; note: string }> = {
  unknown: { tone: 'info', label: 'Belum Ada', note: 'Catat beberapa sesi lari untuk melihat rasio beban.' },
  undertraining: { tone: 'info', label: 'Ringan', note: 'Beban ringan; tambah durasi lari santai bertahap.' },
  sweet_spot: { tone: 'good', label: 'Optimal', note: 'Beban seimbang (0,8–1,3), adaptasi berjalan aman.' },
  high_fatigue: { tone: 'bad', label: 'Tinggi', note: 'Risiko kelelahan meningkat; kurangi intensitas.' },
};

interface CustomTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ value?: number | null }>;
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

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#18181D]/60 px-4 py-12 text-center">
      <BarChart3 size={22} className="text-zinc-500" aria-hidden />
      <p className="mt-2 max-w-xs text-xs text-zinc-400">{message}</p>
    </div>
  );
}

export default function Analitik({
  profile,
  workouts,
  embedded = false,
}: {
  profile: UserProfile;
  workouts: Workout[];
  embedded?: boolean;
}) {
  const [days, setDays] = useState<Range>(28);
  const [trendKind, setTrendKind] = useState<TrendKind>('ef');

  const now = Date.now();
  const progress = compareProgress(workouts, now, days);
  const { current: cur } = progress;
  const gauge = acwr(workouts, profile, now);
  const acwrMeta = ACWR_PILL[gauge.status];

  const inRange = workouts.filter((w) => w.date <= now && now - w.date <= days * DAY_MS);
  const efData = inRange
    .filter((w) => w.workoutType === 'easy' || w.workoutType === 'long_run')
    .sort((a, b) => a.date - b.date)
    .map((w) => ({ d: short(w.date), ef: w.efficiencyFactor ?? efficiencyFactor(w) }))
    .filter((d) => d.ef != null);

  const paceData = progress.series
    .filter((p) => p.easyPaceSec != null)
    .map((p) => ({ d: short(p.date), pace: p.easyPaceSec }));

  const weekly = weeklyKm(workouts, now, Math.max(2, Math.round(days / 7)));
  const hasWeekly = weekly.some((w) => w.km > 0);
  const maxHr = resolveMaxHr(profile, workouts);
  const effectiveMaxHr = maxHr ?? (profile.age > 0 ? tanakaMaxHr(profile.age) : null);

  const efDelta = progress.efDeltaPct;
  const paceDelta = progress.easyPaceDeltaSec;
  const trendNote =
    trendKind === 'ef'
      ? efData.length === 0
        ? 'Perlu sesi santai dengan data HR.'
        : efDelta != null && efDelta >= 2
          ? `EF meningkat +${dec(efDelta)}% dibanding ${days} hari lalu.`
          : efDelta != null && efDelta <= -3
            ? `EF turun ${dec(Math.abs(efDelta))}%; perhatikan pemulihan.`
            : 'Efisiensi aerobik stabil.'
      : paceData.length === 0
        ? 'Perlu sesi Easy / Long Run untuk melihat tren pace.'
        : paceDelta != null && paceDelta <= -3
          ? `Pace santai lebih cepat ${Math.abs(Math.round(paceDelta))} dtk/km.`
          : paceDelta != null && paceDelta >= 3
            ? `Pace santai melambat ${Math.round(paceDelta)} dtk/km.`
            : 'Pace lari santai terjaga stabil.';

  return (
    <div className="space-y-5">
      <div className={`flex flex-col gap-3 sm:flex-row sm:items-end ${embedded ? 'sm:justify-end' : 'sm:justify-between'}`}>
        {!embedded && <ScreenHeader title="Analitik" subtitle="Tren performa & beban latihan" />}

        <div role="group" aria-label="Rentang waktu" className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-[#121215] p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={days === r}
              onClick={() => setDays(r)}
              className={`min-h-[44px] whitespace-nowrap rounded-xl px-3.5 font-display text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                days === r ? 'bg-[#BEF264] text-[#09090B]' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {r} Hari
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        {/* Kartu Risiko Cedera (ACWR) */}
        <section aria-label="Risiko Cedera ACWR" className="sport-card flex flex-col justify-between p-5 lg:col-span-5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-white">Risiko Cedera (ACWR)</h2>
              <StatusPill tone={acwrMeta.tone}>{acwrMeta.label}</StatusPill>
            </div>
            <p className="mt-1 text-xs text-zinc-400">{acwrMeta.note}</p>
          </div>
          <div className="mt-4">
            <AcwrGauge ratio={gauge.ratio} status={gauge.status} historyDays={acwrHistoryDays(workouts, now)} />
          </div>
        </section>

        {/* Grafik 1: Volume Lari Mingguan */}
        <section aria-label="Volume Lari Mingguan" className="sport-card flex flex-col justify-between p-5 lg:col-span-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-white">Volume Mingguan</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Total {days} hari: <strong className="font-mono tabular-nums text-sky-400">{dec(cur.totalKm)} km</strong>
              </p>
            </div>
            {profile.weeklyTargetKm != null && profile.weeklyTargetKm > 0 && (
              <span className="font-mono text-xs font-bold tabular-nums text-[#BEF264]">
                Target {profile.weeklyTargetKm} km
              </span>
            )}
          </div>

          <div className="mt-4">
            {hasWeekly ? (
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekly} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
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
                          unitLabel="Volume mingguan"
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
              <EmptyChart message={`Belum ada jarak tercatat dalam ${days} hari terakhir.`} />
            )}
          </div>
        </section>

        {/* Grafik 2: Efisiensi Aerobik (EF) & Tren Pace */}
        <section aria-label="Efisiensi Aerobik dan Tren Pace" className="sport-card p-5 lg:col-span-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-white">
                {trendKind === 'ef' ? 'Efisiensi Aerobik (EF)' : 'Tren Pace Santai'}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">{trendNote}</p>
            </div>

            <div role="group" aria-label="Pilih metrik grafik" className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-[#18181D] p-1">
              <button
                type="button"
                aria-pressed={trendKind === 'ef'}
                onClick={() => setTrendKind('ef')}
                className={`min-h-[40px] whitespace-nowrap rounded-xl px-3 font-display text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                  trendKind === 'ef' ? 'bg-[#38BDF8] text-[#09090B]' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                Efisiensi (EF)
              </button>
              <button
                type="button"
                aria-pressed={trendKind === 'pace'}
                onClick={() => setTrendKind('pace')}
                className={`min-h-[40px] whitespace-nowrap rounded-xl px-3 font-display text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                  trendKind === 'pace' ? 'bg-[#BEF264] text-[#09090B]' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                Tren Pace
              </button>
            </div>
          </div>

          <div className="mt-4">
            {trendKind === 'ef' ? (
              efData.length > 0 ? (
                <div className="h-[240px] w-full sm:h-[260px]">
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
                            unitLabel="Efisiensi Aerobik (EF)"
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
                <EmptyChart message="Belum ada sesi santai dengan data HR pada periode ini." />
              )
            ) : paceData.length > 0 ? (
              <div className="h-[240px] w-full sm:h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={paceData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
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
                          unitLabel="Pace lari santai"
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
              <EmptyChart message="Belum ada sesi Easy atau Long Run pada periode ini." />
            )}
          </div>
        </section>

        {/* Grafik 3: Perbandingan Pace vs Heart Rate */}
        <PaceHrChartCard workouts={inRange} days={days} className="lg:col-span-12" />

        {/* Grafik 4: Distribusi Zona Detak Jantung (Z1–Z5) */}
        <HrZoneDistributionCard
          workouts={inRange}
          days={days}
          maxHr={effectiveMaxHr}
          className="lg:col-span-12"
        />

        {/* Evaluasi AI Hasil Program (dipindah dari tab Program) */}
        <ProgramEvaluationCard profile={profile} workouts={workouts} className="lg:col-span-12" />
      </div>
    </div>
  );
}
