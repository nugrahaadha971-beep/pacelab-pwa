import { ACWR_MIN_HISTORY_DAYS, type AcwrStatus } from '../analytics/workload';

const MAX = 2.0;
const CX = 130;
const CY = 128;
const R = 92;

interface ZoneVisual {
  label: string;
  color: string;
  badgeText: string;
}

function resolveZoneVisual(ratio: number | null, status: AcwrStatus): ZoneVisual {
  if (ratio == null || status === 'unknown') {
    return { label: 'Data belum cukup', color: '#71717A', badgeText: 'text-zinc-400' };
  }
  if (ratio < 0.8) {
    return { label: 'Beban Ringan (< 0,8)', color: '#38BDF8', badgeText: 'text-sky-400' };
  }
  if (ratio <= 1.3) {
    return { label: 'Optimal (0,8–1,3)', color: '#BEF264', badgeText: 'text-[#BEF264]' };
  }
  if (ratio <= 1.5) {
    return { label: 'Waspada (1,3–1,5)', color: '#F59E0B', badgeText: 'text-amber-400' };
  }
  return { label: 'Risiko Tinggi (> 1,5)', color: '#F43F5E', badgeText: 'text-rose-400' };
}

function point(v: number, r: number): [number, number] {
  const clamped = Math.min(MAX, Math.max(0, v));
  const a = Math.PI * (1 - clamped / MAX);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(v1: number, v2: number, radius = R): string {
  const [x1, y1] = point(v1, radius);
  const [x2, y2] = point(v2, radius);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const SEGMENTS: ReadonlyArray<{ from: number; to: number; color: string; name: string }> = [
  { from: 0, to: 0.785, color: '#38BDF8', name: 'Ringan' },
  { from: 0.815, to: 1.285, color: '#BEF264', name: 'Optimal' },
  { from: 1.315, to: 1.485, color: '#F59E0B', name: 'Waspada' },
  { from: 1.515, to: MAX, color: '#F43F5E', name: 'Tinggi' },
];

const TICKS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: '0' },
  { value: 0.8, label: '0.8' },
  { value: 1.3, label: '1.3' },
  { value: 1.5, label: '1.5' },
  { value: 2.0, label: '2.0' },
];

export default function AcwrGauge({
  ratio,
  status,
  historyDays,
}: {
  ratio: number | null;
  status: AcwrStatus;
  historyDays?: number;
}) {
  const visual = resolveZoneVisual(ratio, status);
  const clampedRatio = ratio != null ? Math.min(MAX, Math.max(0, ratio)) : null;

  const angle = clampedRatio != null ? Math.PI * (1 - clampedRatio / MAX) : null;
  const tip = clampedRatio != null ? point(clampedRatio, R - 16) : null;
  const leftBase =
    angle != null ? [CX + 4.5 * Math.cos(angle + Math.PI / 2), CY - 4.5 * Math.sin(angle + Math.PI / 2)] : null;
  const rightBase =
    angle != null ? [CX + 4.5 * Math.cos(angle - Math.PI / 2), CY - 4.5 * Math.sin(angle - Math.PI / 2)] : null;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 260 150"
        className="mx-auto w-full max-w-[270px]"
        role="img"
        aria-label={`ACWR ${ratio == null ? 'belum tersedia' : ratio.toFixed(2)}, ${visual.label}`}
      >
        <path d={arc(0, MAX)} stroke="#27272E" strokeWidth={15} fill="none" strokeLinecap="round" />

        {SEGMENTS.map((seg) => {
          const isActive =
            clampedRatio != null &&
            clampedRatio >= seg.from - 0.02 &&
            clampedRatio <= seg.to + 0.02;
          return (
            <path
              key={seg.name}
              d={arc(seg.from, seg.to)}
              stroke={seg.color}
              strokeWidth={15}
              fill="none"
              strokeLinecap="butt"
              opacity={clampedRatio == null ? 0.35 : isActive ? 1 : 0.3}
            />
          );
        })}

        <path d={arc(0, MAX, R - 13)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} fill="none" />

        {TICKS.map((tk) => {
          const [tx, ty] = point(tk.value, R + 17);
          return (
            <text
              key={tk.label}
              x={tx}
              y={ty + 3}
              textAnchor="middle"
              fontSize={10}
              fontFamily="JetBrains Mono, monospace"
              fontWeight={600}
              fill="#A1A1AA"
            >
              {tk.label}
            </text>
          );
        })}

        {tip && leftBase && rightBase && (
          <g>
            <polygon
              points={`${tip[0].toFixed(2)},${tip[1].toFixed(2)} ${leftBase[0].toFixed(2)},${leftBase[1].toFixed(2)} ${rightBase[0].toFixed(2)},${rightBase[1].toFixed(2)}`}
              fill="#F4F4F5"
            />
            <circle cx={tip[0]} cy={tip[1]} r={2.5} fill={visual.color} />
          </g>
        )}

        <circle cx={CX} cy={CY} r={8} fill="#18181D" stroke={visual.color} strokeWidth={2.5} />
        <circle cx={CX} cy={CY} r={3} fill="#F4F4F5" />
      </svg>

      <div className="-mt-2 text-center">
        <div className="font-mono text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl" style={{ color: visual.color }}>
          {ratio == null ? '–' : ratio.toFixed(2)}
        </div>
        <div className={`mt-1 text-xs font-bold ${visual.badgeText}`}>{visual.label}</div>
        {status === 'unknown' && historyDays != null && (
          <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-zinc-400">
            Mengumpulkan data beban latihan ({Math.min(historyDays, ACWR_MIN_HISTORY_DAYS)}/{ACWR_MIN_HISTORY_DAYS} hari).
            ACWR muncul setelah {ACWR_MIN_HISTORY_DAYS} hari riwayat.
          </p>
        )}
      </div>

      <div className="mt-4 grid w-full grid-cols-4 gap-1.5 text-center text-[10px]">
        <div className="rounded-xl border border-white/[0.06] bg-[#18181D] px-1.5 py-1.5">
          <div className="font-mono font-bold text-sky-400">&lt;0.8</div>
          <div className="mt-0.5 text-zinc-400">Ringan</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#18181D] px-1.5 py-1.5">
          <div className="font-mono font-bold text-[#BEF264]">0.8–1.3</div>
          <div className="mt-0.5 text-zinc-400">Optimal</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#18181D] px-1.5 py-1.5">
          <div className="font-mono font-bold text-amber-400">1.3–1.5</div>
          <div className="mt-0.5 text-zinc-400">Waspada</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#18181D] px-1.5 py-1.5">
          <div className="font-mono font-bold text-rose-400">&gt;1.5</div>
          <div className="mt-0.5 text-zinc-400">Tinggi</div>
        </div>
      </div>
    </div>
  );
}
