import { useMemo } from 'react';
import { buildHrZoneTable } from '../plans/hrZones';
import type { HrMethod } from '../plans/hrZones';

interface HrZoneCardProps {
  /** Nilai yang sedang dipakai form Profil (bukan data tersimpan), supaya tabel langsung berubah. */
  maxHr: number | null;
  restingHr: number | null;
  method: HrMethod;
  /** HR maks tertinggi yang terekam di sesi FIT/GPX (lihat detectPeakHr). */
  detectedMaxHr?: number | null;
  onMethodChange: (method: HrMethod) => void;
  onUseDetected?: (bpm: number) => void;
}

const ZONE_BADGE: Record<number, string> = {
  1: 'border-zinc-600 bg-zinc-800 text-zinc-200',
  2: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  3: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  4: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  5: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

const METHODS: ReadonlyArray<{ value: HrMethod; label: string }> = [
  { value: 'hrr', label: '% HRR' },
  { value: 'hrmax', label: '% HRmaks' },
];

export function HrZoneCard({
  maxHr,
  restingHr,
  method,
  detectedMaxHr,
  onMethodChange,
  onUseDetected,
}: HrZoneCardProps) {
  const rows = useMemo(() => buildHrZoneTable(maxHr, restingHr, method), [maxHr, restingHr, method]);
  const validHrr = maxHr != null && restingHr != null && restingHr > 0 && maxHr > restingHr;
  const fallsBack = method === 'hrr' && rows.length > 0 && rows[0].method === 'max';
  const showDetected = detectedMaxHr != null && maxHr != null && detectedMaxHr > maxHr && onUseDetected;

  return (
    <section className="sport-card space-y-3 p-5" aria-labelledby="zona-hr-judul">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="zona-hr-judul" className="font-display text-base font-bold text-white">
            Zona Detak Jantung
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            {method === 'hrr' && validHrr && maxHr != null && restingHr != null
              ? `Karvonen · cadangan HR (HRR) ${maxHr - restingHr} bpm`
              : method === 'hrr'
                ? 'Karvonen · isi Resting HR dan Max HR yang valid'
                : 'Persentase dari HR maksimal'}
          </p>
        </div>
        <div role="radiogroup" aria-label="Metode zona" className="flex shrink-0 rounded-xl border border-white/10 bg-[#09090B] p-0.5 text-xs">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={method === m.value}
              onClick={() => onMethodChange(m.value)}
              className={`min-h-[36px] rounded-lg px-3 font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                method === m.value ? 'bg-[#BEF264] text-[#09090B]' : 'text-zinc-400'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {fallsBack && (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Resting HR belum valid, jadi zona sementara memakai % HRmaks.
        </p>
      )}

      {showDetected && (
        <button
          type="button"
          onClick={() => onUseDetected(detectedMaxHr)}
          className="min-h-[44px] w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          Rekor sesi mencatat HR maks <b>{detectedMaxHr} bpm</b> (lebih tinggi dari Max HR sekarang). Ketuk untuk memakainya.
        </button>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">Isi Max HR pada kartu di atas untuk melihat zona.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((z) => (
            <li
              key={z.zone}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#09090B]/80 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${ZONE_BADGE[z.zone]}`}>{z.code}</span>
                <div>
                  <div className="font-semibold tabular-nums text-zinc-100">
                    {z.min}–{z.max} bpm
                  </div>
                  <div className="text-[10px] text-zinc-400">{z.pctLabel}</div>
                </div>
              </div>
              <span className="text-right text-[11px] text-zinc-400">{z.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
