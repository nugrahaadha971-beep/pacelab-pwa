import { useMemo, useState, type ReactNode } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { db } from '../db/database';
import type { Workout, WorkoutType } from '../analytics/types';
import { RACE_KM } from '../analytics/predictor';
import { cardiacDrift } from '../analytics/workload';
import { fmtPace } from '../plans/pace';
import { loadShoes } from '../plans/shoeStore';
import { fmtDate, fmtHms } from './format';
import { filterWorkouts, type DistFilter, type SourceFilter, type TypeFilter } from './historyFilter';
import { Button, ScreenHeader, SelectField } from './ui';
import { useDialog } from './useDialog';
import Sheet from './Sheet';

const DISTS: DistFilter[] = ['all', '5K', '10K', '21.1K', '42.2K'];
const SOURCES: SourceFilter[] = ['all', 'fit', 'gpx', 'manual'];
const SOURCE_LABEL: Record<SourceFilter, string> = { all: 'Semua', fit: 'File FIT', gpx: 'File GPX', manual: 'Manual' };
const TYPE_LABEL: Record<WorkoutType, string> = { easy: 'Easy', tempo: 'Tempo', interval: 'Interval', long_run: 'Long run', race: 'Race' };
const TYPE_IDS = Object.keys(TYPE_LABEL) as WorkoutType[];
/** Warna per jenis sesi: garis di tepi kartu dan teks lencana. Ditulis lengkap agar terdeteksi Tailwind. */
const TYPE_BORDER: Record<WorkoutType, string> = {
  easy: 'border-l-volt', tempo: 'border-l-coral', interval: 'border-l-coral', long_run: 'border-l-sky-400', race: 'border-l-coral',
};
const TYPE_BADGE: Record<WorkoutType, string> = {
  easy: 'border-volt/30 bg-volt/15 text-volt',
  tempo: 'border-coral/35 bg-coral/15 text-coral',
  interval: 'border-coral/35 bg-coral/15 text-coral',
  long_run: 'border-sky-400/30 bg-sky-400/15 text-sky-300',
  race: 'border-coral/40 bg-coral/20 text-coral',
};

interface Filters { dist: DistFilter; source: SourceFilter; type: TypeFilter }
const NO_FILTER: Filters = { dist: 'all', source: 'all', type: 'all' };

const chip = (on: boolean) =>
  `min-h-11 rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
    on ? 'border-volt/60 bg-volt/15 text-volt' : 'border-white/10 bg-[#191B22] text-slate-300'
  }`;
const textarea =
  'mt-1 block w-full rounded-2xl border border-white/10 bg-[#191B22] px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-volt focus:outline-none focus:ring-2 focus:ring-volt/35';

export default function Riwayat({ workouts, reload }: { workouts: Workout[]; reload: () => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filters>(NO_FILTER);
  const [panel, setPanel] = useState(false);
  const [sel, setSel] = useState<Workout | null>(null);
  const [ask, setAsk] = useState<Workout | null>(null);
  const shoes = useMemo(() => loadShoes(), [workouts]);
  const shoeNameById = useMemo(() => new Map(shoes.map((s) => [s.id, s.name])), [shoes]);
  const sorted = useMemo(() => [...workouts].sort((a, b) => b.date - a.date), [workouts]);
  const list = useMemo(() => filterWorkouts(sorted, { q, ...f }, RACE_KM), [sorted, q, f]);

  const active: { key: keyof Filters; label: string }[] = [];
  if (f.dist !== 'all') active.push({ key: 'dist', label: f.dist });
  if (f.type !== 'all') active.push({ key: 'type', label: TYPE_LABEL[f.type] });
  if (f.source !== 'all') active.push({ key: 'source', label: SOURCE_LABEL[f.source] });

  const remove = async (w: Workout) => {
    if (w.id == null) return;
    await db.workouts.delete(w.id);
    setAsk(null);
    setSel(null);
    reload();
  };

  return (
    <div className="space-y-3">
      <ScreenHeader title="Riwayat" subtitle="Semua sesi latihan yang sudah tercatat" />

      <div className="flex gap-2">
        <label className="relative block flex-1">
          <span className="sr-only">Cari sesi atau catatan</span>
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Cari sesi atau catatan"
            className="block min-h-11 w-full rounded-2xl border border-white/10 bg-[#111216] py-2 pl-10 pr-3 text-slate-100 placeholder:text-slate-500 focus:border-volt focus:outline-none focus:ring-2 focus:ring-volt/35" />
        </label>
        <button type="button" onClick={() => setPanel(true)} aria-haspopup="dialog"
          className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-[#111216] px-3.5 text-sm font-bold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt">
          <SlidersHorizontal size={18} aria-hidden />
          Filter
          {active.length > 0 && <span className="rounded-full bg-volt px-1.5 text-xs font-extrabold text-[#070709]">{active.length}</span>}
        </button>
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map((a) => (
            <button key={a.key} type="button" onClick={() => setF({ ...f, [a.key]: 'all' })} aria-label={`Hapus filter ${a.label}`}
              className="flex min-h-11 items-center gap-1 rounded-full border border-volt/40 bg-volt/10 pl-3 pr-2 text-xs font-bold text-volt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt">
              {a.label}<X size={14} aria-hidden />
            </button>
          ))}
          <button type="button" onClick={() => setF(NO_FILTER)} className="min-h-11 px-2 text-xs font-semibold text-slate-400 underline">Hapus semua</button>
        </div>
      )}

      {sorted.length === 0 && (
        <p className="sport-card p-4 text-sm text-slate-300">Belum ada sesi tercatat. Ketuk tombol <strong className="text-volt">+</strong> di bawah buat catat sesi pertamamu.</p>
      )}
      {sorted.length > 0 && <p className="text-xs text-slate-400" aria-live="polite">{list.length} dari {sorted.length} sesi</p>}
      {sorted.length > 0 && list.length === 0 && (
        <div className="sport-card space-y-3 p-4 text-sm text-slate-300">
          <p>Tidak ada sesi yang cocok dengan pencarian atau filter ini.</p>
          <Button variant="secondary" onClick={() => { setQ(''); setF(NO_FILTER); }}>Hapus pencarian dan filter</Button>
        </div>
      )}

      {list.map((w, i) => (
        <button key={w.id ?? i} type="button" onClick={() => setSel(w)}
          className={`sport-card block w-full border-l-[3px] p-4 text-left transition hover:border-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${TYPE_BORDER[w.workoutType]}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-sm font-bold text-slate-100">{fmtDate(w.date)}</span>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TYPE_BADGE[w.workoutType]}`}>
              {TYPE_LABEL[w.workoutType]}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2">
            <div>
              <dt className="font-sans text-[11px] font-semibold uppercase tracking-wider text-slate-400">Jarak</dt>
              <dd className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-white">
                {w.distanceKm.toFixed(2)} <span className="font-sans text-xs font-semibold text-slate-400">km</span>
              </dd>
            </div>
            <div>
              <dt className="font-sans text-[11px] font-semibold uppercase tracking-wider text-slate-400">Waktu</dt>
              <dd className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-white">{fmtHms(w.durationSec)}</dd>
            </div>
            <div>
              <dt className="font-sans text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pace rata-rata</dt>
              <dd className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-white">
                {fmtPace(w.avgPaceSecPerKm)} <span className="font-sans text-xs font-semibold text-slate-400">/km</span>
              </dd>
            </div>
          </dl>

          {(w.avgHr != null || w.note || (w.shoeId && shoeNameById.has(w.shoeId))) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.06] pt-2 text-xs text-slate-400">
              {w.avgHr != null && <span className="shrink-0 font-medium tabular-nums text-slate-300">HR rata-rata: {w.avgHr} bpm</span>}
              {w.shoeId && shoeNameById.has(w.shoeId) && <span className="shrink-0 text-slate-300">👟 {shoeNameById.get(w.shoeId)}</span>}
              {w.note && <span className="min-w-0 flex-1 truncate">{w.note}</span>}
            </div>
          )}
        </button>
      ))}

      {panel && <FilterPanel q={q} sorted={sorted} initial={f} onApply={(next) => { setF(next); setPanel(false); }} onClose={() => setPanel(false)} />}
      {sel && <Detail key={sel.id} w={sel} onClose={() => setSel(null)} onDelete={() => setAsk(sel)} onSaved={reload} />}
      {ask && <ConfirmDelete w={ask} onCancel={() => setAsk(null)} onConfirm={() => remove(ask)} />}
    </div>
  );
}

function FilterPanel({ q, sorted, initial, onApply, onClose }: { q: string; sorted: Workout[]; initial: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [d, setD] = useState<Filters>(initial);
  const count = (patch: Partial<Filters>) => filterWorkouts(sorted, { q, ...d, ...patch }, RACE_KM).length;
  const group = (title: string, children: ReactNode) => (
    <div className="mb-4"><div className="text-sm font-semibold text-slate-200">{title}</div><div className="mt-1 flex flex-wrap gap-2">{children}</div></div>
  );
  return (
    <Sheet title="Filter" titleId="filter-judul" onClose={onClose}>
      {group('Jarak', DISTS.map((x) => (
        <button key={x} type="button" aria-pressed={d.dist === x} onClick={() => setD({ ...d, dist: x })} className={chip(d.dist === x)}>
          {x === 'all' ? 'Semua' : x} <span className="font-normal opacity-70">({count({ dist: x })})</span>
        </button>
      )))}
      {group('Jenis sesi', (['all', ...TYPE_IDS] as TypeFilter[]).map((x) => (
        <button key={x} type="button" aria-pressed={d.type === x} onClick={() => setD({ ...d, type: x })} className={chip(d.type === x)}>
          {x === 'all' ? 'Semua' : TYPE_LABEL[x]} <span className="font-normal opacity-70">({count({ type: x })})</span>
        </button>
      )))}
      {group('Sumber data', SOURCES.map((x) => (
        <button key={x} type="button" aria-pressed={d.source === x} onClick={() => setD({ ...d, source: x })} className={chip(d.source === x)}>
          {SOURCE_LABEL[x]} <span className="font-normal opacity-70">({count({ source: x })})</span>
        </button>
      )))}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Button variant="secondary" onClick={() => setD(NO_FILTER)}>Atur ulang</Button>
        <Button onClick={() => onApply(d)}>Tampilkan {count({})} sesi</Button>
      </div>
    </Sheet>
  );
}

function ConfirmDelete({ w, onCancel, onConfirm }: { w: Workout; onCancel: () => void; onConfirm: () => void }) {
  const ref = useDialog<HTMLDivElement>(onCancel);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-6" onClick={onCancel}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="hapus-judul" aria-describedby="hapus-isi" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-navy-800 p-5 shadow-2xl">
        <div aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-lg font-extrabold text-red-300">!</div>
        <h2 id="hapus-judul" className="mt-3 text-lg font-bold">Hapus sesi ini?</h2>
        <p id="hapus-isi" className="mt-1 text-sm leading-relaxed text-slate-300">
          Sesi {fmtDate(w.date)} ({w.distanceKm.toFixed(2)} km) akan dihapus dari perangkat ini. Tindakan ini tidak bisa dibatalkan.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onCancel}>Batal</Button>
          <Button variant="danger-solid" onClick={onConfirm}>Hapus</Button>
        </div>
      </div>
    </div>
  );
}

function Detail({ w, onClose, onDelete, onSaved }: { w: Workout; onClose: () => void; onDelete: () => void; onSaved: () => void }) {
  const [note, setNote] = useState(w.note ?? '');
  const [type, setType] = useState<WorkoutType>(w.workoutType);
  const [shoes] = useState(() => loadShoes());
  const [shoeId, setShoeId] = useState(w.shoeId ?? '');
  const [saved, setSaved] = useState(false);
  const selectableShoes = shoes.filter((s) => !s.retired || s.id === w.shoeId);
  const drift = cardiacDrift(w.laps);
  const stats: [string, string][] = [
    ['Jarak', `${w.distanceKm.toFixed(2)} km`],
    ['Durasi', fmtHms(w.durationSec)],
    ['Pace', `${fmtPace(w.avgPaceSecPerKm)} /km`],
    ['Detak jantung rata-rata', w.avgHr ? `${w.avgHr} bpm` : '–'],
    ['Detak jantung maks', w.maxHr ? `${w.maxHr} bpm` : '–'],
    ['Poin Usaha (TRIMP)', w.trimp != null ? String(Math.round(w.trimp)) : '–'],
    ['Efisiensi Jantung (EF)', w.efficiencyFactor != null ? w.efficiencyFactor.toFixed(2) : '–'],
    ['Cardiac drift', drift != null ? `${drift.toFixed(1)}%` : '–'],
  ];

  const save = async () => {
    if (w.id == null) return;
    await db.workouts.update(w.id, { note: note.trim(), workoutType: type, shoeId: shoeId || undefined });
    setSaved(true);
    onSaved();
  };

  return (
    <Sheet title={fmtDate(w.date)} titleId="detail-judul" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 tabular-nums">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-navy-800 p-3">
            <div className="text-[11px] font-bold uppercase text-slate-400">{k}</div>
            <div className="font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <SelectField label="Jenis sesi" value={type} onChange={(e) => { setType(e.target.value as WorkoutType); setSaved(false); }}>
          {TYPE_IDS.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </SelectField>
      </div>
      {selectableShoes.length > 0 && (
        <div className="mt-3">
          <SelectField label="Sepatu" value={shoeId} onChange={(e) => { setShoeId(e.target.value); setSaved(false); }}>
            <option value="">Otomatis (Sepatu Utama)</option>
            {selectableShoes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.isDefault ? ' (Utama)' : s.retired ? ' (Pensiun)' : ''}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      <label className="mt-3 block text-sm font-semibold text-slate-200">Catatan sesi
        <textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} rows={2} className={`${textarea} font-normal`} />
      </label>
      {saved && <p role="status" className="mt-2 rounded-2xl border border-volt/25 bg-volt/10 px-3 py-2 text-sm font-semibold text-volt">✓ Perubahan tersimpan.</p>}
      <div className="mt-3"><Button onClick={save}>Simpan perubahan</Button></div>
      {w.laps.length > 0 && (
        <table className="mt-4 w-full text-sm tabular-nums">
          <thead className="text-left text-slate-400"><tr><th className="py-1">km</th><th>Pace</th><th>Detak jantung</th></tr></thead>
          <tbody>
            {w.laps.map((l) => (
              <tr key={l.km} className="border-t border-white/[0.08]">
                <td className="py-1">{l.km}</td><td>{fmtPace(l.paceSec)} /km</td><td>{l.avgHr ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-5"><Button variant="danger" onClick={onDelete}>Hapus sesi</Button></div>
    </Sheet>
  );
}
