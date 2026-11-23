import type { AcwrStatus } from '../analytics/workload';

const MAX = 2;
const CX = 100;
const CY = 100;
const R = 80;
const LABEL: Record<AcwrStatus, string> = {
  unknown: 'Data belum cukup', undertraining: 'Perlu hati-hati', sweet_spot: 'Aman', high_fatigue: 'Terlalu berat',
};
const COLOR: Record<AcwrStatus, string> = {
  unknown: '#64748b', undertraining: '#fbbf24', sweet_spot: '#34d399', high_fatigue: '#ff6b5e',
};

/** Titik pada setengah lingkaran: nilai 0 di kiri, MAX di kanan. */
function point(v: number, r: number): [number, number] {
  const a = Math.PI * (1 - Math.min(MAX, Math.max(0, v)) / MAX);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(v1: number, v2: number): string {
  const [x1, y1] = point(v1, R);
  const [x2, y2] = point(v2, R);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function AcwrGauge({ ratio, status }: { ratio: number | null; status: AcwrStatus }) {
  const tip = ratio == null ? null : point(ratio, R - 14);
  const [lx1, ly1] = point(0.8, R + 12);
  const [lx2, ly2] = point(1.3, R + 12);
  return (
    <div>
      <svg viewBox="0 0 200 108" className="mx-auto w-full max-w-xs" role="img"
        aria-label={`ACWR ${ratio == null ? 'belum tersedia' : ratio.toFixed(2)}, ${LABEL[status]}`}>
        <path d={arc(0, 0.8)} stroke="#fbbf24" strokeWidth={12} fill="none" opacity={0.55} />
        <path d={arc(0.8, 1.3)} stroke="#34d399" strokeWidth={12} fill="none" opacity={0.75} />
        <path d={arc(1.3, MAX)} stroke="#ff6b5e" strokeWidth={12} fill="none" opacity={0.75} />
        <text x={lx1} y={ly1} textAnchor="middle" fontSize={9} fill="#94a3b8">0.8</text>
        <text x={lx2} y={ly2} textAnchor="middle" fontSize={9} fill="#94a3b8">1.3</text>
        {tip && <line x1={CX} y1={CY} x2={tip[0]} y2={tip[1]} stroke="#e2e8f0" strokeWidth={3} strokeLinecap="round" />}
        <circle cx={CX} cy={CY} r={5} fill="#e2e8f0" />
      </svg>
      <div className="-mt-1 text-center">
        <div className="text-3xl font-bold tabular-nums" style={{ color: COLOR[status] }}>
          {ratio == null ? '–' : ratio.toFixed(2)}
        </div>
        <div className="text-sm text-slate-400">{LABEL[status]}</div>
      </div>
    </div>
  );
}
