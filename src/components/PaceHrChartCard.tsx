import { useState } from 'react';
import { Activity } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Workout, WorkoutType } from '../analytics/types';
import { efficiencyFactor } from '../analytics/workload';
import { fmtPace } from '../plans/pace';
import { fmtDate } from './format';

type Scope = 'aerobic' | 'all';

const TYPE_LABEL: Record<WorkoutType, string> = {
  easy: 'Easy',
  long_run: 'Long Run',
  tempo: 'Tempo',
  interval: 'Interval',
  race: 'Race',
};

const shortDate = (ts: number) =>
  new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

const dec = (x: number, digits = 1) => x.toFixed(digits).replace('.', ',');
const avg = (nums: number[]) => nums.reduce((sum, n) => sum + n, 0) / nums.length;

interface PaceHrPoint {
  idx: number;
  dateLabel: string;
  fullDate: string;
  typeLabel: string;
  distanceKm: number;
  paceSec: number;
  avgHr: number;
  ef: number | null;
}

interface PaceHrTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: PaceHrPoint }>;
}

function PaceHrTooltip({ active, payload }: PaceHrTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="min-w-[196px] rounded-2xl border border-white/15 bg-[#121215]/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-zinc-200">{pt.fullDate}</span>
        <span className="font-mono text-[11px] tabular-nums text-zinc-400">
          {pt.typeLabel} · {dec(pt.distanceKm, 1)} km
        </span>
      </div>

      <div className="mt-2 space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-[#BEF264]" aria-hidden />
            Pace
          </span>
          <span className="font-mono font-extrabold text-[#BEF264]">{fmtPace(pt.paceSec)} /km</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-[#38BDF8]" aria-hidden />
            Heart Rate
          </span>
          <span className="font-mono font-extrabold text-[#38BDF8]">{pt.avgHr} bpm</span>
        </div>
        {pt.ef != null && (
          <div className="flex items-center justify-between gap-4 border-t border-white/[0.08] pt-1 text-[11px]">
            <span className="text-zinc-400">Efisiensi (EF)</span>
            <span className="font-mono font-bold text-white">{dec(pt.ef, 2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function buildInsight(points: PaceHrPoint[]): string {
  if (points.length === 0) {
    return 'Perlu sesi dengan data pace dan detak jantung untuk membandingkan efisiensi.';
  }
  if (points.length === 1) {
    return 'Catat minimal 2 sesi dengan data HR untuk melihat arah perkembangan Pace vs Heart Rate.';
  }

  const mid = Math.floor(points.length / 2);
  const early = points.slice(0, mid);
  const late = points.slice(mid);

  const avgPaceEarly = avg(early.map((p) => p.paceSec));
  const avgPaceLate = avg(late.map((p) => p.paceSec));
  const avgHrEarly = avg(early.map((p) => p.avgHr));
  const avgHrLate = avg(late.map((p) => p.avgHr));

  const paceDiff = Math.round(avgPaceLate - avgPaceEarly); // negatif = lebih cepat
  const hrDiff = Math.round(avgHrLate - avgHrEarly); // negatif = jantung lebih hemat

  if (paceDiff <= -3 && hrDiff <= 1) {
    const hrNote = hrDiff < 0 ? `dengan HR turun ${Math.abs(hrDiff)} bpm` : 'dengan HR tetap stabil';
    return `Efisiensi membaik: pace lebih cepat ${Math.abs(paceDiff)} dtk/km ${hrNote}.`;
  }
  if (Math.abs(paceDiff) <= 3 && hrDiff <= -3) {
    return `Jantung lebih hemat ${Math.abs(hrDiff)} bpm pada ritme pace yang relatif sama.`;
  }
  if (paceDiff >= 4 && hrDiff >= 3) {
    return `Pace melambat ${paceDiff} dtk/km dengan HR naik +${hrDiff} bpm; prioritaskan pemulihan.`;
  }
  if (hrDiff >= 4 && Math.abs(paceDiff) < 4) {
    return `Heart rate naik +${hrDiff} bpm pada pace serupa; perhatikan hidrasi dan istirahat.`;
  }

  const overallPace = avg(points.map((p) => p.paceSec));
  const overallHr = avg(points.map((p) => p.avgHr));
  return `Pace dan detak jantung berjalan seimbang di kisaran ${fmtPace(overallPace)} /km · ${Math.round(overallHr)} bpm.`;
}

interface Props {
  workouts: ReadonlyArray<Workout>;
  days: number;
  className?: string;
}

export default function PaceHrChartCard({ workouts, days, className = '' }: Props) {
  const [scope, setScope] = useState<Scope>('aerobic');

  const filtered = [...workouts]
    .filter((w) => {
      if (w.avgPaceSecPerKm <= 0 || !Number.isFinite(w.avgPaceSecPerKm)) return false;
      if (w.avgHr == null || w.avgHr <= 0 || !Number.isFinite(w.avgHr)) return false;
      if (scope === 'aerobic') {
        return w.workoutType === 'easy' || w.workoutType === 'long_run';
      }
      return true;
    })
    .sort((a, b) => a.date - b.date);

  const points: PaceHrPoint[] = filtered.map((w, idx) => ({
    idx,
    dateLabel: shortDate(w.date),
    fullDate: fmtDate(w.date),
    typeLabel: TYPE_LABEL[w.workoutType],
    distanceKm: w.distanceKm,
    paceSec: Math.round(w.avgPaceSecPerKm),
    avgHr: Math.round(w.avgHr as number),
    ef: w.efficiencyFactor ?? efficiencyFactor(w),
  }));

  const hasData = points.length > 0;
  const insight = buildInsight(points);

  const paces = points.map((p) => p.paceSec);
  const hrs = points.map((p) => p.avgHr);
  const efs = points.map((p) => p.ef).filter((v): v is number => v != null && Number.isFinite(v));

  const avgPace = hasData ? avg(paces) : null;
  const avgHr = hasData ? avg(hrs) : null;
  const avgEf = efs.length > 0 ? avg(efs) : null;

  const minPace = hasData ? Math.min(...paces) : 300;
  const maxPace = hasData ? Math.max(...paces) : 480;
  const pacePad = Math.max(12, Math.round((maxPace - minPace) * 0.18));

  const minHr = hasData ? Math.min(...hrs) : 120;
  const maxHr = hasData ? Math.max(...hrs) : 170;
  const hrPad = Math.max(5, Math.round((maxHr - minHr) * 0.18));

  return (
    <section className={`sport-card p-5 ${className}`} aria-label="Perbandingan Pace vs Heart Rate">
      {/* Header + Scope Toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-white">
            Pace vs Heart Rate
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">{insight}</p>
        </div>

        <div
          role="group"
          aria-label="Filter tipe sesi Pace vs Heart Rate"
          className="grid shrink-0 grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-[#18181D] p-1"
        >
          <button
            type="button"
            aria-pressed={scope === 'aerobic'}
            onClick={() => setScope('aerobic')}
            className={`min-h-[40px] whitespace-nowrap rounded-xl px-3 font-display text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
              scope === 'aerobic' ? 'bg-[#BEF264] text-[#09090B]' : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            Sesi Aerobik
          </button>
          <button
            type="button"
            aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
            className={`min-h-[40px] whitespace-nowrap rounded-xl px-3 font-display text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
              scope === 'all' ? 'bg-[#38BDF8] text-[#09090B]' : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            Semua Sesi
          </button>
        </div>
      </div>

      {/* Ringkasan Angka + Legenda */}
      {hasData && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-white/[0.06] py-3">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-2 font-semibold text-zinc-200">
              <span className="h-2.5 w-2.5 rounded-full bg-[#BEF264]" aria-hidden />
              Pace (naik = lebih cepat)
            </span>
            <span className="inline-flex items-center gap-2 font-semibold text-zinc-200">
              <span className="h-2.5 w-2.5 rounded-full bg-[#38BDF8]" aria-hidden />
              Heart Rate (bpm)
            </span>
          </div>

          <div className="flex items-center gap-4 tabular-nums">
            <div>
              <div className="text-[11px] font-medium text-zinc-400">Rata Pace</div>
              <div className="font-mono text-sm font-extrabold text-[#BEF264]">
                {avgPace != null ? `${fmtPace(avgPace)} /km` : '–'}
              </div>
            </div>
            <div className="h-6 w-px bg-white/10" aria-hidden />
            <div>
              <div className="text-[11px] font-medium text-zinc-400">Rata HR</div>
              <div className="font-mono text-sm font-extrabold text-[#38BDF8]">
                {avgHr != null ? `${Math.round(avgHr)} bpm` : '–'}
              </div>
            </div>
            <div className="h-6 w-px bg-white/10" aria-hidden />
            <div>
              <div className="text-[11px] font-medium text-zinc-400">Rata EF</div>
              <div className="font-mono text-sm font-extrabold text-white">
                {avgEf != null ? dec(avgEf, 2) : '–'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dual-Axis Smooth Line Chart */}
      <div className="mt-4">
        {hasData ? (
          <div className="h-[250px] w-full sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 10, right: 6, left: -6, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="idx"
                  stroke="#71717A"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickFormatter={(v) => points[Number(v)]?.dateLabel ?? ''}
                />
                <YAxis
                  yAxisId="pace"
                  reversed
                  domain={[Math.max(120, minPace - pacePad), maxPace + pacePad]}
                  stroke="#BEF264"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(v: number) => fmtPace(v)}
                />
                <YAxis
                  yAxisId="hr"
                  orientation="right"
                  domain={[Math.max(40, minHr - hrPad), maxHr + hrPad]}
                  stroke="#38BDF8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                />
                <Tooltip content={<PaceHrTooltip />} />
                <Line
                  yAxisId="pace"
                  type="monotone"
                  dataKey="paceSec"
                  name="Pace"
                  stroke="#BEF264"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: '#09090B', stroke: '#BEF264', strokeWidth: 2 }}
                  activeDot={{ r: 5.5, fill: '#BEF264', stroke: '#09090B', strokeWidth: 2 }}
                  connectNulls
                />
                <Line
                  yAxisId="hr"
                  type="monotone"
                  dataKey="avgHr"
                  name="Heart Rate"
                  stroke="#38BDF8"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: '#09090B', stroke: '#38BDF8', strokeWidth: 2 }}
                  activeDot={{ r: 5.5, fill: '#38BDF8', stroke: '#09090B', strokeWidth: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#18181D]/60 px-4 py-12 text-center">
            <Activity size={22} className="text-zinc-500" aria-hidden />
            <p className="mt-2 max-w-xs text-xs text-zinc-400">
              {scope === 'aerobic'
                ? `Belum ada sesi Easy atau Long Run dengan data HR dalam ${days} hari terakhir.`
                : `Belum ada sesi dengan data pace dan detak jantung dalam ${days} hari terakhir.`}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
