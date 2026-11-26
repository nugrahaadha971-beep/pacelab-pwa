import { HeartPulse } from 'lucide-react';
import { fmtPace } from '../plans/pace';
import { MAF_ADJUSTMENTS, mafTrend, mafZone, normalizeMafAdj } from '../plans/maf';
import type { MafAdjustment, MafPoint } from '../plans/maf';
import type { RaceDistance } from '../analytics/types';
import { fmtDate } from './format';
import { SelectField, StatusPill } from './ui';

interface Props {
  age: number;
  adj: MafAdjustment;
  onAdj: (a: MafAdjustment) => void;
  maf: number | null;
  points: MafPoint[];
  maxHr?: number | null;
  targetDistance?: RaceDistance;
  weeksRemaining?: number | null;
}

/** Kartu ringkas Zona MAF: batas HR MAF, penyesuaian kondisi, dan progres pace terbaru. */
export default function MafCard({ adj, onAdj, maf, points }: Props) {
  const zone = maf != null ? mafZone(maf) : null;
  const trend = mafTrend(points);
  const recent = [...points].reverse().slice(0, 3);

  return (
    <section className="sport-card border-sky-400/25 p-4" aria-labelledby="maf-judul">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse size={16} className="text-sky-400" aria-hidden />
          <h3 id="maf-judul" className="font-display text-sm font-bold text-white">Zona MAF</h3>
        </div>
        <StatusPill tone="info">180 − Usia</StatusPill>
      </div>

      {maf == null || zone == null ? (
        <p className="mt-3 rounded-2xl border border-dashed border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
          Isi usia di Profil untuk menghitung detak jantung MAF.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="sport-subcard p-3">
            <div className="text-[11px] font-medium text-zinc-400">Batas Atas MAF</div>
            <div className="mt-0.5 font-mono text-2xl font-extrabold tabular-nums text-sky-400">
              {maf} <span className="font-sans text-xs font-semibold text-zinc-400">bpm</span>
            </div>
          </div>
          <div className="sport-subcard p-3">
            <div className="text-[11px] font-medium text-zinc-400">Zona Latihan</div>
            <div className="mt-0.5 font-mono text-2xl font-extrabold tabular-nums text-white">
              {zone[0]}–{zone[1]} <span className="font-sans text-xs font-semibold text-zinc-400">bpm</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3">
        <SelectField
          label="Penyesuaian kondisi"
          value={String(adj)}
          onChange={(e) => onAdj(normalizeMafAdj(Number(e.target.value)))}
        >
          {MAF_ADJUSTMENTS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </SelectField>
      </div>

      {recent.length > 0 && (
        <div className="mt-3 border-t border-white/[0.07] pt-3">
          <ul className="divide-y divide-white/[0.06] text-xs tabular-nums">
            {recent.map((p) => (
              <li key={p.date} className="flex items-center justify-between gap-2 py-2">
                <span className="text-zinc-400">{fmtDate(p.date)}</span>
                <span className="font-mono text-zinc-200">
                  <strong className="text-[#BEF264]">{fmtPace(p.paceSecPerKm)}</strong> /km · {Math.round(p.avgHr)} bpm
                </span>
              </li>
            ))}
          </ul>
          {trend && (
            <p className={`mt-1.5 text-xs font-semibold ${trend.deltaSec < -1 ? 'text-[#BEF264]' : 'text-zinc-400'}`}>
              {Math.abs(trend.deltaSec) < 1
                ? 'Pace MAF stabil.'
                : `Pace MAF ${trend.deltaSec < 0 ? 'lebih cepat' : 'lebih lambat'} ${Math.abs(Math.round(trend.deltaSec))} dtk/km.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
