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

const dec1 = (x: number) => x.toFixed(1).replace('.', ',');
const dec2 = (x: number) => x.toFixed(2).replace('.', ',');

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
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#191B22] p-3 tabular-nums">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-300">Posisi HR vs Zona Target</span>
        <span className="font-bold text-volt">{lo}–{hi} bpm</span>
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
        <span>● Rata-rata: <strong className="text-slate-200">{Math.round(avgHr)} bpm</strong></span>
        {peakHr != null && <span>▌ Puncak: <strong className="text-slate-200">{Math.round(peakHr)} bpm</strong></span>}
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
          <div className="mt-1 text-xs tabular-nums text-slate-300">
            {w.distanceKm.toFixed(2)} km · {fmtHms(w.durationSec)} · {fmtPace(w.avgPaceSecPerKm)} /km
            {m.avgHr != null ? ` · HR ${Math.round(m.avgHr)} bpm` : ''}
          </div>
          <div className="mt-2">
            <StatusPill tone={STATUS_PILL_TONE[item.status]}>{item.verdictLabel}</StatusPill>
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

          {/* Visualisasi Zona HR */}
          {item.targetHrRange && m.avgHr != null && (
            <HrZoneBar range={item.targetHrRange} avgHr={m.avgHr} peakHr={m.peakHr} />
          )}

          {/* 4 Metrik Inti Sesi */}
          <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
            <div className="sport-subcard p-2.5">
              <div className="font-bold uppercase tracking-wider text-slate-400">Detak Jantung</div>
              <div className="mt-0.5 font-display text-base font-extrabold text-white">
                {m.avgHr != null ? `${Math.round(m.avgHr)} bpm` : '–'}
                {m.peakHr != null && <span className="ml-1 text-xs font-normal text-slate-400">(maks {Math.round(m.peakHr)})</span>}
              </div>
              <div className="mt-0.5 text-slate-400">
                {item.targetHrRange ? `Target ${item.targetHrRange[0]}–${item.targetHrRange[1]} bpm` : 'Target belum diatur'}
              </div>
            </div>

            <div className="sport-subcard p-2.5">
              <div className="font-bold uppercase tracking-wider text-slate-400">Pace & Split</div>
              <div className="mt-0.5 font-display text-base font-extrabold text-white">
                {fmtPace(w.avgPaceSecPerKm)} <span className="text-xs font-normal text-slate-400">/km</span>
              </div>
              <div className="mt-0.5 text-slate-400">
                {m.splitDeltaSec != null
                  ? `Paruh 2: ${m.splitDeltaSec > 0 ? '+' : ''}${Math.round(m.splitDeltaSec)} dtk/km`
                  : 'Split butuh ≥ 2 lap'}
              </div>
            </div>

            <div className="sport-subcard p-2.5">
              <div className="font-bold uppercase tracking-wider text-slate-400">Efisiensi (EF)</div>
              <div className="mt-0.5 font-display text-base font-extrabold text-white">
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
              <div className="mt-0.5 font-display text-base font-extrabold text-white">
                {m.driftPct != null ? `${dec1(m.driftPct)}%` : '–'}
                <span className="ml-1.5 text-xs font-normal text-slate-400">TRIMP {Math.round(m.trimp)}</span>
              </div>
              <div className="mt-0.5 text-slate-400">Batas aman drift ≤ 5%</div>
            </div>
          </div>

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

        <div className="mt-3 grid grid-cols-3 gap-2 text-center tabular-nums">
          <div className="sport-subcard p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sesuai target</div>
            <div className="mt-1 font-display text-xl font-extrabold text-emerald-400">
              {summary.compliancePct != null ? `${summary.compliancePct}%` : '–'}
            </div>
            <div className="text-[11px] text-slate-400">{summary.optimal}/{summary.evaluated} sesi terukur</div>
          </div>

          <div className="sport-subcard p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Perlu perhatian</div>
            <div className="mt-1 font-display text-xl font-extrabold text-amber-400">{summary.caution}</div>
            <div className="text-[11px] text-slate-400">lonjakan / drift</div>
          </div>

          <div className="sport-subcard p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Belum sesuai</div>
            <div className="mt-1 font-display text-xl font-extrabold text-coral">{summary.offTarget}</div>
            <div className="text-[11px] text-slate-400">keluar zona</div>
          </div>
        </div>

        {(summary.avgMafHr != null || summary.avgDriftPct != null) && (
          <p className="mt-3 text-xs tabular-nums text-slate-300">
            {summary.avgMafHr != null && <>Rata-rata HR sesi MAF: <strong>{Math.round(summary.avgMafHr)} bpm</strong></>}
            {summary.avgMafHr != null && summary.avgDriftPct != null && ' · '}
            {summary.avgDriftPct != null && <>Rata-rata cardiac drift: <strong>{dec1(summary.avgDriftPct)}%</strong></>}
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
