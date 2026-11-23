import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WorkoutType } from '../analytics/types';
import type { PeriodComplianceSummary, SessionAnalysis, SessionCheckTone, SessionVerdictStatus } from '../analytics/sessionAnalysis';
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
  long_run: 'Long run',
  race: 'Race',
};

const STATUS_PILL_TONE: Record<SessionVerdictStatus, Exclude<Tone, 'neutral'>> = {
  optimal: 'good',
  caution: 'warn',
  off_target: 'bad',
  incomplete: 'info',
};

const STATUS_BORDER: Record<SessionVerdictStatus, string> = {
  optimal: 'border-l-emerald-400',
  caution: 'border-l-amber-400',
  off_target: 'border-l-coral',
  incomplete: 'border-l-sky-400',
};

const HR_ZONE_META = [
  { label: 'Z1', color: '#64748b', textClass: 'text-slate-300' },
  { label: 'Z2', color: '#38BDF8', textClass: 'text-sky-300' },
  { label: 'Z3', color: '#C8FF00', textClass: 'text-volt' },
  { label: 'Z4', color: '#fbbf24', textClass: 'text-amber-300' },
  { label: 'Z5', color: '#FF4D2D', textClass: 'text-coral' },
] as const;

const dec1 = (x: number) => x.toFixed(1).replace('.', ',');
const dec2 = (x: number) => x.toFixed(2).replace('.', ',');
const fmtMinShort = (sec: number) => Math.round(sec / 60);

function splitStrategyMeta(ratio: number): { label: string; badgeClass: string } {
  if (ratio < 0.99) {
    return {
      label: 'Negative Split (Makin cepat di akhir)',
      badgeClass: 'border-volt/30 bg-volt/15 text-volt',
    };
  }
  if (ratio <= 1.02) {
    return {
      label: 'Stabil',
      badgeClass: 'border-sky-400/30 bg-sky-400/15 text-sky-300',
    };
  }
  return {
    label: 'Melambat di akhir',
    badgeClass: 'border-amber-400/35 bg-amber-400/15 text-amber-300',
  };
}

function CheckIcon({ tone }: { tone: SessionCheckTone }) {
  if (tone === 'good') return <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0 text-emerald-400" />;
  if (tone === 'warn') return <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-400" />;
  if (tone === 'bad') return <XCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-coral" />;
  return <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-sky-400" />;
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
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#191B22] p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-300">Posisi HR vs Zona Target</span>
        <span className="font-mono font-bold text-volt">{lo}–{hi} bpm</span>
      </div>
      <div className="relative mt-2.5 h-3 rounded-full bg-white/10" role="img"
        aria-label={`HR rata-rata ${Math.round(avgHr)} bpm terhadap zona target ${lo} sampai ${hi} bpm`}>
        <div
          className="absolute inset-y-0 rounded-full bg-emerald-400/35 ring-1 ring-emerald-400/60"
          style={{ left: `${zoneLeft}%`, width: `${zoneWidth}%` }}
        />
        {peakHr != null && peakHr > avgHr + 2 && (
          <div
            title={`HR puncak ${Math.round(peakHr)} bpm`}
            className="absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400"
            style={{ left: `${pct(peakHr)}%` }}
          />
        )}
        <div
          title={`HR rata-rata ${Math.round(avgHr)} bpm`}
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-navy-900 shadow ${
            inZone ? 'bg-emerald-400' : 'bg-coral'
          }`}
          style={{ left: `${avgPos}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
        <span>● Rata-rata: <strong className="font-mono text-slate-200">{Math.round(avgHr)} bpm</strong></span>
        {peakHr != null && <span>▌ Puncak: <strong className="font-mono text-slate-200">{Math.round(peakHr)} bpm</strong></span>}
      </div>
    </div>
  );
}

function SessionCard({ item, defaultOpen }: { item: SessionAnalysis; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { workout: w, metrics: m } = item;
  const lapChart = w.laps
    .filter((l) => l.avgHr != null && l.avgHr > 0)
    .map((l) => ({ km: `Km ${l.km}`, hr: Math.round(l.avgHr as number), pace: l.paceSec }));

  const hrValues = lapChart.map((d) => d.hr);
  const minY = item.targetHrRange
    ? Math.min(item.targetHrRange[0] - 10, ...hrValues)
    : Math.min(...hrValues, 100);
  const maxY = item.targetHrRange
    ? Math.max(item.targetHrRange[1] + 10, ...hrValues)
    : Math.max(...hrValues, 180);

  const hasRunWalk = w.runSec != null && w.walkSec != null && w.runSec + w.walkSec > 0;
  const totalMoveSec = hasRunWalk ? (w.runSec ?? 0) + (w.walkSec ?? 0) : 0;
  const runPct = hasRunWalk ? Math.round(((w.runSec ?? 0) / totalMoveSec) * 100) : 0;
  const walkPct = hasRunWalk ? 100 - runPct : 0;

  const pauseSec = w.elapsedSec != null && w.elapsedSec - w.durationSec >= 20
    ? Math.round(w.elapsedSec - w.durationSec)
    : null;
  const pauseMin = pauseSec != null ? Math.floor(pauseSec / 60) : 0;
  const pauseRemSec = pauseSec != null ? pauseSec % 60 : 0;

  const splitRatio = w.splitRatio ?? (
    m.firstHalfPaceSec && m.secondHalfPaceSec
      ? m.secondHalfPaceSec / m.firstHalfPaceSec
      : null
  );
  const splitMeta = splitRatio != null ? splitStrategyMeta(splitRatio) : null;

  return (
    <article className={`sport-card border-l-[3px] ${STATUS_BORDER[item.status]} p-4`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-display text-sm font-extrabold text-white">{fmtDate(w.date)}</span>
            <span className="rounded-lg bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-bold uppercase text-slate-300">
              {TYPE_LABEL[w.workoutType]}
            </span>
            {item.matchedPlan && (
              <span className="rounded-md bg-sky-400/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-300">
                Jadwal: {item.matchedPlan.name}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            <span className="font-mono">{w.distanceKm.toFixed(2)} km</span> · <span className="font-mono">{fmtHms(w.durationSec)}</span> · <span className="font-mono">{fmtPace(w.avgPaceSecPerKm)} /km</span>
            {m.avgHr != null && <> · HR <span className="font-mono">{Math.round(m.avgHr)} bpm</span></>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusPill tone={STATUS_PILL_TONE[item.status]}>{item.verdictLabel}</StatusPill>
            {pauseSec != null && (
              <span className="inline-flex items-center rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">
                Jeda berhenti: {pauseMin} mnt {pauseRemSec} dtk
              </span>
            )}
          </div>
        </div>
        <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#191B22] text-slate-400">
          {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">
          {/* Kesimpulan & Saran Sesi Berikutnya */}
          <div className={`sport-subcard border-l-4 ${STATUS_BORDER[item.status]} p-3 text-sm`}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Evaluasi · {item.targetZoneLabel}
            </div>
            <p className="mt-1 leading-relaxed text-slate-100">{item.summary}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              <strong className="text-volt">Saran berikutnya:</strong> {item.nextAction}
            </p>
          </div>

          {/* Proporsi Lari vs Jalan & Pace Lari Murni */}
          {hasRunWalk && (
            <div className="sport-subcard space-y-2.5 p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold uppercase tracking-wider text-slate-400">Proporsi Lari vs Jalan</span>
                <span className="text-slate-300">
                  <span className="font-mono font-bold text-white">{w.walkCount ?? 0}</span> kali jeda jalan
                </span>
              </div>
              <div
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10"
                role="img"
                aria-label={`Lari ${runPct} persen, jalan kaki ${walkPct} persen`}
              >
                <div style={{ width: `${runPct}%`, backgroundColor: '#C8FF00' }} />
                <div style={{ width: `${walkPct}%`, backgroundColor: '#38BDF8' }} />
              </div>
              <p className="text-xs text-slate-300">
                Lari: <strong className="font-mono text-volt">{fmtMinShort(w.runSec ?? 0)} mnt ({runPct}%)</strong> · Jalan:{' '}
                <strong className="font-mono text-sky-300">{fmtMinShort(w.walkSec ?? 0)} mnt ({walkPct}%)</strong> · {w.walkCount ?? 0} kali jeda jalan
              </p>

              {w.runPaceSecPerKm != null && (
                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  <div className="rounded-xl border border-white/[0.06] bg-[#111216] p-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pace Lari Murni</div>
                    <div className="mt-0.5 font-mono text-base font-extrabold text-volt">
                      {fmtPace(w.runPaceSecPerKm)} <span className="font-sans text-xs font-normal text-slate-400">/km</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-[#111216] p-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pace Gabungan</div>
                    <div className="mt-0.5 font-mono text-base font-extrabold text-white">
                      {fmtPace(w.avgPaceSecPerKm)} <span className="font-sans text-xs font-normal text-slate-400">/km</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Strategi Pace & Sebaran Zona HR */}
          {(splitMeta || w.hrZonePct) && (
            <div className="sport-subcard space-y-3 p-3">
              {splitMeta && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Strategi Pace</span>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${splitMeta.badgeClass}`}>
                    {splitMeta.label}
                  </span>
                </div>
              )}

              {w.hrZonePct && (
                <div className={splitMeta ? 'border-t border-white/[0.06] pt-2.5' : ''}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-wider text-slate-400">Sebaran Zona HR</span>
                    <span className="text-[11px] text-slate-400">Zona 1 – 5</span>
                  </div>
                  <div
                    className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10"
                    role="img"
                    aria-label={w.hrZonePct.map((p, i) => `Zona ${i + 1} ${p}%`).join(', ')}
                  >
                    {w.hrZonePct.map((pct, i) => (
                      pct > 0 ? <div key={HR_ZONE_META[i].label} style={{ width: `${pct}%`, backgroundColor: HR_ZONE_META[i].color }} /> : null
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[11px]">
                    {w.hrZonePct.map((pct, i) => (
                      <div key={HR_ZONE_META[i].label} className="rounded-lg bg-[#111216] py-1">
                        <div className={`font-bold ${HR_ZONE_META[i].textClass}`}>{HR_ZONE_META[i].label}</div>
                        <div className="font-mono font-bold text-slate-200">{pct}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Visualisasi Zona HR */}
          {item.targetHrRange && m.avgHr != null && (
            <HrZoneBar range={item.targetHrRange} avgHr={m.avgHr} peakHr={m.peakHr} />
          )}

          {/* 4 Metrik Inti Sesi */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="sport-subcard p-2.5">
              <div className="font-bold uppercase tracking-wider text-slate-400">Detak Jantung</div>
              <div className="mt-0.5 font-mono text-base font-extrabold text-white">
                {m.avgHr != null ? `${Math.round(m.avgHr)} bpm` : '–'}
                {m.peakHr != null && <span className="ml-1 font-sans text-xs font-normal text-slate-400">(maks {Math.round(m.peakHr)})</span>}
              </div>
              <div className="mt-0.5 text-slate-400">
                {item.targetHrRange ? `Target ${item.targetHrRange[0]}–${item.targetHrRange[1]} bpm` : 'Target belum diatur'}
              </div>
            </div>

            <div className="sport-subcard p-2.5">
              <div className="font-bold uppercase tracking-wider text-slate-400">Pace & Split</div>
              <div className="mt-0.5 font-mono text-base font-extrabold text-white">
                {fmtPace(w.avgPaceSecPerKm)} <span className="font-sans text-xs font-normal text-slate-400">/km</span>
              </div>
              <div className="mt-0.5 text-slate-400">
                {m.splitDeltaSec != null
                  ? `Paruh 2: ${m.splitDeltaSec > 0 ? '+' : ''}${Math.round(m.splitDeltaSec)} dtk/km`
                  : 'Split butuh ≥ 2 lap'}
              </div>
            </div>

            <div className="sport-subcard p-2.5">
              <div className="font-bold uppercase tracking-wider text-slate-400">Efisiensi (EF)</div>
              <div className="mt-0.5 font-mono text-base font-extrabold text-white">
                {m.ef != null ? dec2(m.ef) : '–'}
              </div>
              <div className="mt-0.5 text-slate-400">
                {m.efDiffPct != null
                  ? `${m.efDiffPct >= 0 ? '+' : ''}${dec1(m.efDiffPct)}% vs rata-rata 28 hr`
                  : 'Kecepatan ÷ HR'}
              </div>
            </div>

            <div className="sport-subcard p-2.5">
              <div className="font-bold uppercase tracking-wider text-slate-400">Drift & Beban</div>
              <div className="mt-0.5 font-mono text-base font-extrabold text-white">
                {m.driftPct != null ? `${dec1(m.driftPct)}%` : '–'}
                <span className="ml-1.5 font-sans text-xs font-normal text-slate-400">TRIMP {Math.round(m.trimp)}</span>
              </div>
              <div className="mt-0.5 text-slate-400">Batas aman drift ≤ 5%</div>
            </div>
          </div>

          {/* Tabel Split per Kilometer (terlipat agar kartu tetap ringkas) */}
          {w.laps.length > 0 && (
            <details className="group rounded-2xl border border-white/[0.08] bg-[#191B22]/70">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-semibold text-slate-300">
                <span>Split per kilometer ({w.laps.length} km)</span>
                <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t border-white/[0.06] px-3 py-2">
                <table className="w-full text-xs">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="py-1.5">KM</th>
                      <th className="py-1.5">Pace</th>
                      <th className="py-1.5 text-right">Detak Jantung</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {w.laps.map((l) => (
                      <tr key={l.km}>
                        <td className="py-1.5 font-semibold text-slate-300">KM {l.km}</td>
                        <td className="py-1.5 font-mono font-bold text-white">{fmtPace(l.paceSec)} /km</td>
                        <td className="py-1.5 text-right font-mono text-slate-300">{l.avgHr != null ? `${Math.round(l.avgHr)} bpm` : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Checklist Detail Pemeriksaan */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Rincian pemeriksaan sesi</h3>
            <ul className="mt-1.5 space-y-2">
              {item.checks.map((c, idx) => (
                <li key={`${c.key}-${idx}`} className="flex items-start gap-2 rounded-2xl border border-white/[0.06] bg-[#191B22]/80 p-2.5 text-xs">
                  <CheckIcon tone={c.tone} />
                  <div className="min-w-0">
                    <div className="font-bold text-slate-100">{c.title}</div>
                    <p className="mt-0.5 leading-relaxed text-slate-300">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Grafik HR per Kilometer jika lap tersedia */}
          {lapChart.length >= 2 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Grafik detak jantung per km {item.targetHrRange ? `(area hijau = zona target ${item.targetHrRange[0]}–${item.targetHrRange[1]} bpm)` : ''}
              </h3>
              <div className="mt-1.5 rounded-2xl border border-white/[0.06] bg-[#191B22] p-2">
                <ResponsiveContainer width="100%" height={145}>
                  <LineChart data={lapChart}>
                    <CartesianGrid stroke="#232630" vertical={false} />
                    {item.targetHrRange && (
                      <ReferenceArea y1={item.targetHrRange[0]} y2={item.targetHrRange[1]} fill="#C8FF00" fillOpacity={0.12} />
                    )}
                    <XAxis dataKey="km" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis domain={[minY, maxY]} stroke="#64748b" fontSize={11} tickLine={false} width={32} />
                    <Tooltip
                      contentStyle={{ background: '#111216', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px', color: '#e2e8f0', fontSize: 12 }}
                      formatter={(val, name) =>
                        name === 'hr' ? [`${val} bpm`, 'Detak jantung'] : [`${fmtPace(Number(val))} /km`, 'Pace']
                      }
                    />
                    <Line dataKey="hr" stroke="#C8FF00" strokeWidth={2.2} dot={{ r: 3, fill: '#C8FF00' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
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
      <section className="sport-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-slate-200">Kepatuhan sesi · {days} hari</h2>
          <span className="rounded-full bg-volt/15 px-2.5 py-0.5 text-[11px] font-bold text-volt">
            {PLAN_LABEL[curriculum]}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="sport-subcard p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sesuai target</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-emerald-400">
              {summary.compliancePct != null ? `${summary.compliancePct}%` : '–'}
            </div>
            <div className="text-[11px] text-slate-400">{summary.optimal}/{summary.evaluated} sesi terukur</div>
          </div>

          <div className="sport-subcard p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Perlu perhatian</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-amber-400">{summary.caution}</div>
            <div className="text-[11px] text-slate-400">lonjakan / drift</div>
          </div>

          <div className="sport-subcard p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Belum sesuai</div>
            <div className="mt-1 font-mono text-xl font-extrabold text-coral">{summary.offTarget}</div>
            <div className="text-[11px] text-slate-400">keluar zona</div>
          </div>
        </div>

        {(summary.avgMafHr != null || summary.avgDriftPct != null) && (
          <p className="mt-3 text-xs text-slate-300">
            {summary.avgMafHr != null && <>Rata-rata HR sesi MAF: <strong className="font-mono">{Math.round(summary.avgMafHr)} bpm</strong></>}
            {summary.avgMafHr != null && summary.avgDriftPct != null && ' · '}
            {summary.avgDriftPct != null && <>Rata-rata cardiac drift: <strong className="font-mono">{dec1(summary.avgDriftPct)}%</strong></>}
          </p>
        )}

        {/* Filter Status */}
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter status evaluasi">
          {FILTER_PILLS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={filter === p.id}
              onClick={() => setFilter(p.id)}
              className={`min-h-[38px] rounded-full border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                filter === p.id
                  ? 'border-volt/50 bg-volt text-[#070709]'
                  : 'border-white/10 bg-[#191B22] text-slate-300'
              }`}
            >
              {p.label} ({countOf(p.id)})
            </button>
          ))}
        </div>
      </section>

      {filtered.length === 0 ? (
        <p className="sport-card p-5 text-center text-sm text-slate-400">
          Tidak ada sesi pada kategori filter ini dalam {days} hari terakhir.
        </p>
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
