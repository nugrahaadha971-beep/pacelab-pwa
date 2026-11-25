import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Workout } from '../analytics/types';
import {
  aggregateHrZones,
  formatZoneDuration,
  type HrZoneBucket,
  type HrZoneIndex,
} from './hrZoneDistribution';

interface Props {
  workouts: ReadonlyArray<Workout>;
  days: number;
  maxHr: number | null;
  className?: string;
}

interface HrZoneTooltipProps {
  active?: boolean;
  zones: HrZoneBucket[];
  focusedZone: HrZoneIndex | null;
}

function HrZoneTooltip({ active, zones, focusedZone }: HrZoneTooltipProps) {
  if (!active) return null;
  const activeZones = zones.filter((z) => z.pct > 0 || z.seconds > 0);
  if (activeZones.length === 0) return null;

  return (
    <div className="min-w-[210px] rounded-2xl border border-white/15 bg-[#121215]/95 px-3.5 py-3 text-xs shadow-2xl backdrop-blur-md">
      <div className="mb-2 font-semibold text-zinc-300">Sebaran Zona Detak Jantung</div>
      <div className="space-y-1.5 tabular-nums">
        {activeZones.map((z) => {
          const isFocused = focusedZone === z.index;
          return (
            <div
              key={z.key}
              className={`flex items-center justify-between gap-4 rounded-lg px-1.5 py-0.5 transition-colors ${
                isFocused ? 'bg-white/[0.08]' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: z.color }}
                />
                <span className={isFocused ? 'font-bold text-white' : 'text-zinc-300'}>
                  {z.code} · {z.name}
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-zinc-400">{formatZoneDuration(z.seconds)}</span>
                <span className="font-extrabold text-white">{z.pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function HrZoneDistributionCard({ workouts, days, maxHr, className = '' }: Props) {
  const [hoveredZone, setHoveredZone] = useState<HrZoneIndex | null>(null);
  const [pinnedZone, setPinnedZone] = useState<HrZoneIndex | null>(null);

  const summary = aggregateHrZones(workouts, maxHr);
  const { zones, totalSeconds, measuredSessions, exactSessions, estimatedSessions, aerobicPct, dominantZone } =
    summary;

  const hasData = totalSeconds > 0;
  const activeZone = hoveredZone ?? pinnedZone;
  const activeZones = zones.filter((z) => z.exactPct > 0);

  const chartRow = {
    name: 'Distribusi Zona HR',
    z1: zones[0].exactPct,
    z2: zones[1].exactPct,
    z3: zones[2].exactPct,
    z4: zones[3].exactPct,
    z5: zones[4].exactPct,
  };

  const sourceNote =
    exactSessions > 0 && estimatedSessions === 0
      ? 'Rekaman sensor HR'
      : exactSessions > 0
        ? 'Rekaman HR & estimasi lap'
        : 'Estimasi dari HR sesi/lap';

  const ariaSummary = hasData
    ? zones.map((z) => `${z.code} ${z.name} ${z.pct}%`).join(', ')
    : 'Belum ada data distribusi zona detak jantung';

  return (
    <section className={`sport-card p-5 ${className}`} aria-label="Distribusi Zona Detak Jantung">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-white">
            Distribusi Zona Detak Jantung
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            {hasData ? (
              <>
                <span>Zona 1–5</span>
                <span aria-hidden> · </span>
                <span className="tabular-nums">{measuredSessions} sesi</span>
                <span aria-hidden> · </span>
                <span className="tabular-nums">{formatZoneDuration(totalSeconds)} total</span>
                <span aria-hidden> · </span>
                <span>{sourceNote}</span>
              </>
            ) : (
              `Zona 1–5 dalam ${days} hari terakhir`
            )}
          </p>
        </div>

        {hasData && (
          <div className="flex items-center gap-5 sm:text-right">
            <div>
              <div className="text-[11px] font-medium text-zinc-400">Dominan</div>
              <div className={`font-mono text-sm font-extrabold tabular-nums ${dominantZone?.textClass ?? 'text-white'}`}>
                {dominantZone ? `${dominantZone.code} · ${dominantZone.pct}%` : '–'}
              </div>
            </div>
            <div className="h-7 w-px bg-white/10" aria-hidden />
            <div>
              <div className="text-[11px] font-medium text-zinc-400">Aerobik (Z1–Z2)</div>
              <div className="font-mono text-sm font-extrabold tabular-nums text-sky-400">
                {aerobicPct}%
              </div>
            </div>
          </div>
        )}
      </div>

      {hasData ? (
        <div className="mt-5 space-y-4">
          {/* Horizontally Stacked Bar Chart (Recharts) */}
          <div role="img" aria-label={ariaSummary}>
            <div className="h-[52px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[chartRow]}
                  layout="vertical"
                  margin={{ top: 4, right: 0, left: 0, bottom: 4 }}
                  barSize={40}
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip
                    cursor={false}
                    content={<HrZoneTooltip zones={zones} focusedZone={activeZone} />}
                  />
                  {activeZones.map((z, idx) => {
                    const isFirst = idx === 0;
                    const isLast = idx === activeZones.length - 1;
                    const radius: [number, number, number, number] =
                      isFirst && isLast
                        ? [10, 10, 10, 10]
                        : isFirst
                          ? [10, 0, 0, 10]
                          : isLast
                            ? [0, 10, 10, 0]
                            : [0, 0, 0, 0];

                    const dimmed = activeZone !== null && activeZone !== z.index;

                    return (
                      <Bar
                        key={z.key}
                        dataKey={z.key}
                        name={`${z.code} ${z.name}`}
                        stackId="hr"
                        fill={z.color}
                        fillOpacity={dimmed ? 0.28 : 1}
                        stroke="#121215"
                        strokeWidth={2}
                        radius={radius}
                        isAnimationActive={false}
                        className="cursor-pointer transition-opacity duration-150"
                        onMouseEnter={() => setHoveredZone(z.index)}
                        onMouseLeave={() => setHoveredZone(null)}
                        onClick={() =>
                          setPinnedZone((prev) => (prev === z.index ? null : z.index))
                        }
                      >
                        <LabelList
                          dataKey={z.key}
                          content={(props) => {
                            const x = Number(props.x);
                            const y = Number(props.y);
                            const width = Number(props.width);
                            const height = Number(props.height);
                            if (
                              !Number.isFinite(x) ||
                              !Number.isFinite(y) ||
                              !Number.isFinite(width) ||
                              !Number.isFinite(height) ||
                              width < 34
                            ) {
                              return null;
                            }
                            const labelText =
                              width >= 78 ? `${z.code} ${z.pct}%` : `${z.pct}%`;
                            return (
                              <text
                                x={x + width / 2}
                                y={y + height / 2}
                                fill={z.onColorText}
                                fillOpacity={dimmed ? 0.45 : 1}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fontSize={11}
                                fontWeight={700}
                                fontFamily="'JetBrains Mono', monospace"
                                style={{ pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}
                              >
                                {labelText}
                              </text>
                            );
                          }}
                        />
                      </Bar>
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Scale Ticks */}
            <div
              className="mt-1 flex justify-between font-mono text-[10px] font-medium tabular-nums text-zinc-500"
              aria-hidden
            >
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Interactive Z1–Z5 Zone Breakdown */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#18181D]/60 divide-y divide-white/[0.06] lg:grid lg:grid-cols-5 lg:divide-x lg:divide-y-0">
            {zones.map((z) => {
              const isSelected = pinnedZone === z.index;
              const isHighlighted = activeZone === z.index;
              const isMuted = activeZone !== null && activeZone !== z.index;

              return (
                <button
                  key={z.key}
                  type="button"
                  aria-pressed={isSelected}
                  onMouseEnter={() => setHoveredZone(z.index)}
                  onMouseLeave={() => setHoveredZone(null)}
                  onClick={() => setPinnedZone((prev) => (prev === z.index ? null : z.index))}
                  className={`flex min-h-[44px] w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#BEF264] lg:flex-col lg:items-start lg:justify-between lg:gap-2 ${
                    isHighlighted
                      ? 'bg-white/[0.07]'
                      : isMuted
                        ? 'opacity-55 hover:opacity-90'
                        : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: z.color }}
                      />
                      <span className={`font-display text-xs font-bold ${z.textClass}`}>
                        {z.code}
                      </span>
                      <span className="truncate text-xs font-semibold text-zinc-200">
                        {z.name}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-[18px] font-mono text-[11px] tabular-nums text-zinc-400">
                      {z.bpmRangeLabel ?? z.pctRangeLabel}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-baseline gap-2.5 tabular-nums lg:w-full lg:justify-between lg:border-t lg:border-white/[0.06] lg:pt-2">
                    <span className="font-mono text-base font-extrabold text-white">
                      {z.pct}%
                    </span>
                    <span className="font-mono text-xs text-zinc-400">
                      {formatZoneDuration(z.seconds)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#18181D]/60 px-4 py-10 text-center">
          <HeartPulse size={24} className="text-zinc-500" aria-hidden />
          <p className="mt-2.5 text-sm font-semibold text-zinc-200">
            Belum ada data zona detak jantung
          </p>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-400">
            Impor file .GPX / .FIT atau catat sesi dengan data detak jantung (HR) dalam {days} hari terakhir untuk melihat distribusi waktu di Z1–Z5.
          </p>
        </div>
      )}
    </section>
  );
}
