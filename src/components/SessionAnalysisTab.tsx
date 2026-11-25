import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Mountain,
  XCircle,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WorkoutType } from '../analytics/types';
import type {
  PeriodComplianceSummary,
  SessionAnalysis,
  SessionCheckTone,
  SessionVerdictStatus,
} from '../analytics/sessionAnalysis';
import { PLAN_LABEL } from '../plans/planSelector';
import type { CurriculumId } from '../plans/schedule';
import { fmtPace } from '../plans/pace';
import { fmtDate, fmtHms } from './format';
import { StatusPill, type Tone } from './ui';

type StatusFilter = 'all' | 'optimal' | 'caution' | 'off_target';

const FILTER_PILLS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'optimal', label: 'Sesuai' },
  { id: 'caution', label: 'Perlu perhatian' },
  { id: 'off_target', label: 'Belum sesuai' },
];

const TYPE_LABEL: Record<WorkoutType, string> = {
  easy: 'Easy',
  tempo: 'Tempo',
  interval: 'Interval',
  long_run: 'Long Run',
  race: 'Race',
};

const STATUS_PILL_TONE: Record<SessionVerdictStatus, Exclude<Tone, 'neutral'>> = {
  optimal: 'good',
  caution: 'warn',
  off_target: 'bad',
  incomplete: 'info',
};

/** Skala warna resmi HR Zone 1-5: Slate, Blue, Emerald, Amber, Rose. */
const HR_ZONE_META = [
  { label: 'Z1', name: 'Pemulihan', color: '#64748B', textClass: 'text-slate-400', barBg: 'bg-slate-500' },
  { label: 'Z2', name: 'Aerobik', color: '#3B82F6', textClass: 'text-blue-400', barBg: 'bg-blue-500' },
  { label: 'Z3', name: 'Tempo', color: '#10B981', textClass: 'text-emerald-400', barBg: 'bg-emerald-500' },
  { label: 'Z4', name: 'Ambang', color: '#F59E0B', textClass: 'text-amber-400', barBg: 'bg-amber-500' },
  { label: 'Z5', name: 'Maksimal', color: '#F43F5E', textClass: 'text-rose-400', barBg: 'bg-rose-500' },
] as const;

const dec1 = (x: number) => x.toFixed(1).replace('.', ',');
const dec2 = (x: number) => x.toFixed(2).replace('.', ',');
const fmtMinShort = (sec: number) => Math.round(sec / 60);

function splitStrategyMeta(ratio: number): { label: string; tone: Exclude<Tone, 'neutral'> } {
  if (ratio < 0.99) return { label: 'Negative Split (Makin cepat)', tone: 'good' };
  if (ratio <= 1.02) return { label: 'Ritme Stabil', tone: 'info' };
  return { label: 'Melambat di akhir', tone: 'warn' };
}

function CheckIcon({ tone }: { tone: SessionCheckTone }) {
  if (tone === 'good') return <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0 text-[#BEF264]" />;
  if (tone === 'warn') return <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-400" />;
  if (tone === 'bad') return <XCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-rose-400" />;
  return <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-sky-400" />;
}

interface LapChartPoint {
  km: string;
  pace: number;
  hr: number | null;
}

interface LapTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload?: LapChartPoint }>;
  elevationGain: number | null;
}

function LapChartTooltip({ active, label, payload, elevationGain }: LapTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  return (
    <div className="rounded-2xl border border-white/15 bg-[#121215]/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur-md">
      <div className="font-semibold text-zinc-200">{label}</div>
      <div className="mt-1.5 space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-zinc-400">Pace</span>
          <span className="font-mono font-bold text-[#BEF264]">{fmtPace(pt.pace)} /km</span>
        </div>
        {pt.hr != null && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-zinc-400">Detak Jantung</span>
            <span className="font-mono font-bold text-sky-400">{pt.hr} bpm</span>
          </div>
        )}
        {elevationGain != null && elevationGain > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-white/[0.08] pt-1 text-[11px]">
            <span className="text-zinc-500">Elevasi Sesi</span>
            <span className="font-mono text-zinc-300">+{Math.round(elevationGain)} m</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Bilah visual posisi detak jantung sesi terhadap zona target [lo, hi]. */
function HrZoneBar({ range, avgHr, peakHr }: { range: [number, number]; avgHr: number; peakHr: number | null }) {
  const [lo, hi] = range;
  const minScale = Math.min(lo - 15, avgHr - 8);
  const maxScale = Math.max(hi + 15, (peakHr ?? avgHr) + 8);
  const span = Math.max(1, maxScale - minScale);
  const pct = (v: number) => Math.min(98, Math.max(2, ((v - minScale) / span) * 100));

  const zoneLeft = pct(lo);
  const zoneWidth = Math.max(4, pct(hi) - zoneLeft);
  const avgPos = pct(avgHr);
  const inZone = avgHr >= lo - 3 && avgHr <= hi;

  return (
    <div className="sport-subcard p-3.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-zinc-300">Posisi HR vs Zona Target</span>
        <span className="font-mono font-bold tabular-nums text-[#BEF264]">{lo}–{hi} bpm</span>
      </div>
      <div
        className="relative mt-3 h-3 rounded-full bg-white/10"
        role="img"
        aria-label={`HR rata-rata ${Math.round(avgHr)} bpm terhadap zona target ${lo} sampai ${hi} bpm`}
      >
        <div
          className="absolute inset-y-0 rounded-full bg-emerald-500/35 ring-1 ring-emerald-400/60"
          style={{ left: `${zoneLeft}%`, width: `${zoneWidth}%` }}
        />
        {peakHr != null && peakHr > avgHr + 2 && (
          <div
            title={`HR puncak ${Math.round(peakHr)} bpm`}
            className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400"
            style={{ left: `${pct(peakHr)}%` }}
          />
        )}
        <div
          title={`HR rata-rata ${Math.round(avgHr)} bpm`}
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#09090B] shadow ${
            inZone ? 'bg-[#BEF264]' : 'bg-rose-500'
          }`}
          style={{ left: `${avgPos}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-zinc-400">
        <span>
          Rata-rata: <strong className="font-mono text-zinc-100">{Math.round(avgHr)} bpm</strong>
        </span>
        {peakHr != null && (
          <span>
            Puncak: <strong className="font-mono text-zinc-100">{Math.round(peakHr)} bpm</strong>
          </span>
        )}
      </div>
    </div>
  );
}

function SessionCard({ item, defaultOpen }: { item: SessionAnalysis; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { workout: w, metrics: m } = item;

  const lapChart: LapChartPoint[] = w.laps
    .filter((l) => l.paceSec > 0 && Number.isFinite(l.paceSec))
    .map((l) => ({
      km: `Km ${l.km}`,
      pace: Math.round(l.paceSec),
      hr: l.avgHr != null && l.avgHr > 0 ? Math.round(l.avgHr) : null,
    }));

  const hasLapHr = lapChart.some((d) => d.hr != null);
  const hrValues = lapChart.map((d) => d.hr).filter((v): v is number => v != null);
  const minHrY = item.targetHrRange
    ? Math.min(item.targetHrRange[0] - 10, ...(hrValues.length ? hrValues : [item.targetHrRange[0]]))
    : Math.min(...(hrValues.length ? hrValues : [100]));
  const maxHrY = item.targetHrRange
    ? Math.max(item.targetHrRange[1] + 10, ...(hrValues.length ? hrValues : [item.targetHrRange[1]]))
    : Math.max(...(hrValues.length ? hrValues : [180]));

  const hasRunWalk = w.runSec != null && w.walkSec != null && w.runSec + w.walkSec > 0;
  const totalMoveSec = hasRunWalk ? (w.runSec ?? 0) + (w.walkSec ?? 0) : 0;
  const runPct = hasRunWalk ? Math.round(((w.runSec ?? 0) / totalMoveSec) * 100) : 0;
  const walkPct = hasRunWalk ? 100 - runPct : 0;

  const pauseSec = w.elapsedSec != null && w.elapsedSec - w.durationSec >= 20 ? Math.round(w.elapsedSec - w.durationSec) : null;
  const pauseMin = pauseSec != null ? Math.floor(pauseSec / 60) : 0;
  const pauseRemSec = pauseSec != null ? pauseSec % 60 : 0;

  const splitRatio = w.splitRatio ?? (m.firstHalfPaceSec && m.secondHalfPaceSec ? m.secondHalfPaceSec / m.firstHalfPaceSec : null);
  const splitMeta = splitRatio != null ? splitStrategyMeta(splitRatio) : null;

  return (
    <article className="sport-card p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
            <span className="font-display text-sm font-bold text-white">{fmtDate(w.date)}</span>
            <span aria-hidden>·</span>
            <span className="font-semibold text-zinc-300">{TYPE_LABEL[w.workoutType]}</span>
            {item.matchedPlan && (
              <>
                <span aria-hidden>·</span>
                <span className="text-sky-400">{item.matchedPlan.name}</span>
              </>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums text-zinc-300">
            <span className="font-bold text-sky-400">{w.distanceKm.toFixed(2)} km</span>
            <span className="text-zinc-600" aria-hidden>·</span>
            <span>{fmtHms(w.durationSec)}</span>
            <span className="text-zinc-600" aria-hidden>·</span>
            <span className="font-bold text-[#BEF264]">{fmtPace(w.avgPaceSecPerKm)} /km</span>
            {m.avgHr != null && (
              <>
                <span className="text-zinc-600" aria-hidden>·</span>
                <span>{Math.round(m.avgHr)} bpm</span>
              </>
            )}
            {w.elevationGain != null && w.elevationGain > 0 && (
              <>
                <span className="text-zinc-600" aria-hidden>·</span>
                <span>+{Math.round(w.elevationGain)} m</span>
              </>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <StatusPill tone={STATUS_PILL_TONE[item.status]}>{item.verdictLabel}</StatusPill>
            {pauseSec != null && (
              <span className="text-xs text-zinc-400">
                Jeda berhenti: {pauseMin}m {pauseRemSec}d
              </span>
            )}
          </div>
        </div>
        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#18181D] text-zinc-400">
          {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-white/[0.08] pt-4">
          {/* Kesimpulan & Saran Sesi Berikutnya */}
          <div className="sport-subcard p-3.5 text-sm">
            <div className="text-xs font-semibold text-zinc-400">Evaluasi · {item.targetZoneLabel}</div>
            <p className="mt-1 leading-relaxed text-zinc-100">{item.summary}</p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-300">
              <strong className="text-[#BEF264]">Saran berikutnya:</strong> {item.nextAction}
            </p>
          </div>

          {/* 4 Metrik Inti Sesi */}
          <div className="grid grid-cols-2 gap-2.5 text-xs sm:grid-cols-4">
            <div className="sport-subcard p-3">
              <div className="font-medium text-zinc-400">Detak Jantung</div>
              <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-white">
                {m.avgHr != null ? `${Math.round(m.avgHr)} bpm` : '–'}
              </div>
              <div className="mt-0.5 tabular-nums text-zinc-400">
                {m.peakHr != null
                  ? `Puncak ${Math.round(m.peakHr)} bpm`
                  : item.targetHrRange
                    ? `Target ${item.targetHrRange[0]}–${item.targetHrRange[1]}`
                    : 'Target belum diatur'}
              </div>
            </div>

            <div className="sport-subcard p-3">
              <div className="font-medium text-zinc-400">Pace & Split</div>
              <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-[#BEF264]">
                {fmtPace(w.avgPaceSecPerKm)}
                <span className="ml-0.5 font-sans text-xs font-normal text-zinc-400"> /km</span>
              </div>
              <div className="mt-0.5 tabular-nums text-zinc-400">
                {m.splitDeltaSec != null
                  ? `Paruh 2: ${m.splitDeltaSec > 0 ? '+' : ''}${Math.round(m.splitDeltaSec)} dtk/km`
                  : 'Butuh ≥ 2 lap'}
              </div>
            </div>

            <div className="sport-subcard p-3">
              <div className="font-medium text-zinc-400">Efisiensi (EF)</div>
              <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-sky-400">
                {m.ef != null ? dec2(m.ef) : '–'}
              </div>
              <div className="mt-0.5 tabular-nums text-zinc-400">
                {m.efDiffPct != null
                  ? `${m.efDiffPct >= 0 ? '+' : ''}${dec1(m.efDiffPct)}% vs 28 hr`
                  : 'Kecepatan ÷ HR'}
              </div>
            </div>

            <div className="sport-subcard p-3">
              <div className="font-medium text-zinc-400">Drift & Elevasi</div>
              <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-white">
                {m.driftPct != null ? `${dec1(m.driftPct)}%` : '–'}
                {w.elevationGain != null && w.elevationGain > 0 && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 font-mono text-xs font-semibold text-zinc-300">
                    <Mountain size={12} aria-hidden />+{Math.round(w.elevationGain)}m
                  </span>
                )}
              </div>
              <div className="mt-0.5 tabular-nums text-zinc-400">TRIMP {Math.round(m.trimp)} · Aman ≤ 5%</div>
            </div>
          </div>

          {/* Proporsi Lari vs Jalan */}
          {hasRunWalk && (
            <div className="sport-subcard space-y-2.5 p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-zinc-300">Proporsi Lari vs Jalan</span>
                <span className="tabular-nums text-zinc-400">
                  <strong className="font-mono text-white">{w.walkCount ?? 0}</strong> jeda jalan
                </span>
              </div>
              <div
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10"
                role="img"
                aria-label={`Lari ${runPct} persen, jalan kaki ${walkPct} persen`}
              >
                <div style={{ width: `${runPct}%`, backgroundColor: '#BEF264' }} />
                <div style={{ width: `${walkPct}%`, backgroundColor: '#38BDF8' }} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums text-zinc-300">
                <span>
                  Lari: <strong className="font-mono text-[#BEF264]">{fmtMinShort(w.runSec ?? 0)} mnt ({runPct}%)</strong>
                </span>
                <span>
                  Jalan: <strong className="font-mono text-sky-400">{fmtMinShort(w.walkSec ?? 0)} mnt ({walkPct}%)</strong>
                </span>
              </div>

              {w.runPaceSecPerKm != null && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-xl border border-white/[0.06] bg-[#121215] p-2.5">
                    <div className="text-[11px] font-medium text-zinc-400">Pace Lari Murni</div>
                    <div className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-[#BEF264]">
                      {fmtPace(w.runPaceSecPerKm)} <span className="font-sans text-xs font-normal text-zinc-400">/km</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-[#121215] p-2.5">
                    <div className="text-[11px] font-medium text-zinc-400">Pace Gabungan</div>
                    <div className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-white">
                      {fmtPace(w.avgPaceSecPerKm)} <span className="font-sans text-xs font-normal text-zinc-400">/km</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Strategi Pace & Sebaran Zona HR 1-5 (Slate, Blue, Emerald, Amber, Rose) */}
          {(splitMeta || w.hrZonePct) && (
            <div className="sport-subcard space-y-3 p-3.5">
              {splitMeta && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-300">Strategi Pace</span>
                  <StatusPill tone={splitMeta.tone}>{splitMeta.label}</StatusPill>
                </div>
              )}

              {w.hrZonePct && (
                <div className={splitMeta ? 'border-t border-white/[0.06] pt-3' : ''}>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-300">Distribusi Zona Detak Jantung</span>
                    <span className="text-[11px] text-zinc-400">Zona 1 – 5</span>
                  </div>
                  <div
                    className="flex h-3 w-full overflow-hidden rounded-full bg-white/10"
                    role="img"
                    aria-label={w.hrZonePct.map((p, i) => `Zona ${i + 1} ${p}%`).join(', ')}
                  >
                    {w.hrZonePct.map((pct, i) =>
                      pct > 0 ? (
                        <div
                          key={HR_ZONE_META[i].label}
                          style={{ width: `${pct}%`, backgroundColor: HR_ZONE_META[i].color }}
                        />
                      ) : null,
                    )}
                  </div>
                  <div className="mt-2.5 grid grid-cols-5 gap-1.5 text-center text-[11px]">
                    {w.hrZonePct.map((pct, i) => (
                      <div key={HR_ZONE_META[i].label} className="rounded-xl border border-white/[0.06] bg-[#121215] px-1 py-1.5">
                        <div className={`font-bold ${HR_ZONE_META[i].textClass}`}>{HR_ZONE_META[i].label}</div>
                        <div className="mt-0.5 font-mono font-extrabold tabular-nums text-zinc-100">{pct}%</div>
                        <div className="truncate text-[10px] text-zinc-500">{HR_ZONE_META[i].name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Visualisasi Zona Target HR */}
          {item.targetHrRange && m.avgHr != null && (
            <HrZoneBar range={item.targetHrRange} avgHr={m.avgHr} peakHr={m.peakHr} />
          )}

          {/* Grafik Pace & Detak Jantung per Kilometer */}
          {lapChart.length >= 2 && (
            <div className="sport-subcard p-3.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-zinc-200">
                    Perbandingan Pace {hasLapHr ? '& Detak Jantung ' : ''}per Kilometer
                  </h3>
                  {item.targetHrRange && hasLapHr && (
                    <p className="text-[11px] text-zinc-400">
                      Area hijau: target HR {item.targetHrRange[0]}–{item.targetHrRange[1]} bpm
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="font-semibold text-[#BEF264]">● Pace</span>
                  {hasLapHr && <span className="font-semibold text-sky-400">● Detak Jantung</span>}
                </div>
              </div>

              <div className="h-[190px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={lapChart} margin={{ top: 8, right: hasLapHr ? 4 : 8, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`lapPaceGrad-${w.id ?? w.date}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#BEF264" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#BEF264" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    {item.targetHrRange && hasLapHr && (
                      <ReferenceArea
                        yAxisId="hr"
                        y1={item.targetHrRange[0]}
                        y2={item.targetHrRange[1]}
                        fill="#10B981"
                        fillOpacity={0.12}
                      />
                    )}
                    <XAxis dataKey="km" stroke="#71717A" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis
                      yAxisId="pace"
                      reversed
                      domain={['auto', 'auto']}
                      stroke="#BEF264"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      tickFormatter={(v: number) => fmtPace(v)}
                    />
                    {hasLapHr && (
                      <YAxis
                        yAxisId="hr"
                        orientation="right"
                        domain={[minHrY, maxHrY]}
                        stroke="#38BDF8"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                      />
                    )}
                    <ReferenceLine
                      yAxisId="pace"
                      y={w.avgPaceSecPerKm}
                      stroke="#BEF264"
                      strokeDasharray="4 4"
                      strokeOpacity={0.45}
                    />
                    <Tooltip content={<LapChartTooltip elevationGain={w.elevationGain} />} />
                    <Area
                      yAxisId="pace"
                      type="monotone"
                      dataKey="pace"
                      stroke="#BEF264"
                      strokeWidth={2.2}
                      fill={`url(#lapPaceGrad-${w.id ?? w.date})`}
                      dot={{ r: 3, fill: '#09090B', stroke: '#BEF264', strokeWidth: 1.5 }}
                    />
                    {hasLapHr && (
                      <Line
                        yAxisId="hr"
                        type="monotone"
                        dataKey="hr"
                        stroke="#38BDF8"
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#09090B', stroke: '#38BDF8', strokeWidth: 1.5 }}
                        connectNulls
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Tabel Split per Kilometer */}
          {w.laps.length > 0 && (
            <details className="group rounded-2xl border border-white/[0.08] bg-[#18181D]/70">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-xs font-semibold text-zinc-300">
                <span>Split per kilometer ({w.laps.length} km)</span>
                <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t border-white/[0.06] px-3.5 py-2.5">
                <table className="w-full text-xs">
                  <thead className="text-left text-[11px] font-semibold text-zinc-400">
                    <tr>
                      <th className="py-1.5">KM</th>
                      <th className="py-1.5">Pace</th>
                      <th className="py-1.5 text-right">Detak Jantung</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {w.laps.map((l) => (
                      <tr key={l.km}>
                        <td className="py-1.5 font-semibold text-zinc-300">KM {l.km}</td>
                        <td className="py-1.5 font-mono font-bold tabular-nums text-[#BEF264]">{fmtPace(l.paceSec)} /km</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-zinc-300">
                          {l.avgHr != null ? `${Math.round(l.avgHr)} bpm` : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Checklist Detail Pemeriksaan */}
          <div>
            <h3 className="text-xs font-bold text-zinc-300">Rincian pemeriksaan sesi</h3>
            <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {item.checks.map((c, idx) => (
                <li
                  key={`${c.key}-${idx}`}
                  className="flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-[#18181D]/80 p-3 text-xs"
                >
                  <CheckIcon tone={c.tone} />
                  <div className="min-w-0">
                    <div className="font-bold text-zinc-100">{c.title}</div>
                    <p className="mt-0.5 leading-relaxed text-zinc-400">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}

interface Props {
  days: number;
  curriculum: CurriculumId;
  items: SessionAnalysis[];
  summary: PeriodComplianceSummary;
}

export default function SessionAnalysisTab({ days, curriculum, items, summary }: Props) {
  const [filter, setFilter] = useState<StatusFilter>('all');

  const filtered = filter === 'all' ? items : items.filter((it) => it.status === filter);
  const countOf = (f: StatusFilter) =>
    f === 'all' ? items.length : items.filter((it) => it.status === f).length;

  return (
    <div className="space-y-4">
      {/* Kartu Ringkasan Kepatuhan Periode */}
      <section className="sport-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-white">Kepatuhan Sesi · {days} Hari</h2>
            <p className="mt-0.5 text-xs text-zinc-400">Evaluasi disiplin zona HR, drift & pacing</p>
          </div>
          <StatusPill tone="good">{PLAN_LABEL[curriculum]}</StatusPill>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2.5 text-center">
          <div className="sport-subcard p-3">
            <div className="text-xs font-medium text-zinc-400">Sesuai target</div>
            <div className="mt-1 font-mono text-xl font-extrabold tabular-nums text-[#BEF264] sm:text-2xl">
              {summary.compliancePct != null ? `${summary.compliancePct}%` : '–'}
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-zinc-400">
              {summary.optimal}/{summary.evaluated} terukur
            </div>
          </div>

          <div className="sport-subcard p-3">
            <div className="text-xs font-medium text-zinc-400">Perlu perhatian</div>
            <div className="mt-1 font-mono text-xl font-extrabold tabular-nums text-amber-400 sm:text-2xl">
              {summary.caution}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-400">lonjakan / drift</div>
          </div>

          <div className="sport-subcard p-3">
            <div className="text-xs font-medium text-zinc-400">Belum sesuai</div>
            <div className="mt-1 font-mono text-xl font-extrabold tabular-nums text-rose-400 sm:text-2xl">
              {summary.offTarget}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-400">keluar zona</div>
          </div>
        </div>

        {(summary.avgMafHr != null || summary.avgDriftPct != null) && (
          <p className="mt-3 text-xs tabular-nums text-zinc-300">
            {summary.avgMafHr != null && (
              <>
                Rata-rata HR sesi MAF: <strong className="font-mono text-sky-400">{Math.round(summary.avgMafHr)} bpm</strong>
              </>
            )}
            {summary.avgMafHr != null && summary.avgDriftPct != null && ' · '}
            {summary.avgDriftPct != null && (
              <>
                Rata-rata cardiac drift: <strong className="font-mono text-white">{dec1(summary.avgDriftPct)}%</strong>
              </>
            )}
          </p>
        )}

        {/* Filter Status */}
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter status evaluasi">
          {FILTER_PILLS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={filter === p.id}
              onClick={() => setFilter(p.id)}
              className={`min-h-[38px] whitespace-nowrap rounded-2xl border px-3.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                filter === p.id
                  ? 'border-[#BEF264] bg-[#BEF264] text-[#09090B]'
                  : 'border-white/10 bg-[#18181D] text-zinc-300 hover:border-white/20 hover:text-white'
              }`}
            >
              {p.label} ({countOf(p.id)})
            </button>
          ))}
        </div>
      </section>

      {items.length === 0 ? (
        <div className="sport-card flex flex-col items-center justify-center px-4 py-12 text-center">
          <Activity size={24} className="text-zinc-500" aria-hidden />
          <p className="mt-2.5 text-sm font-semibold text-zinc-200">Belum ada sesi pada periode {days} hari ini</p>
          <p className="mt-1 max-w-sm text-xs text-zinc-400">
            Catat sesi lari atau impor file .FIT / .GPX untuk melihat analisis detak jantung, pace per km, dan evaluasi zona latihan.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="sport-card p-6 text-center text-sm text-zinc-400">
          Tidak ada sesi pada kategori filter ini dalam {days} hari terakhir.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item, idx) => (
            <SessionCard key={item.workout.id ?? `${item.workout.date}-${idx}`} item={item} defaultOpen={idx === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
