import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { db } from '../db/database';
import { isDuplicate } from '../db/validate';
import { finalizeWorkout } from '../analytics/workload';
import type { UserProfile, WorkoutType } from '../analytics/types';
import { parseFit } from '../parsers/fitParser';
import { parseGpx } from '../parsers/gpxParser';
import { parseDuration } from '../parsers/manual';
import { todayStr } from './format';
import { Field, PrimaryButton, SegmentedTabs } from './ui';

const TYPES: { id: WorkoutType; label: string }[] = [
  { id: 'easy', label: 'Easy' }, { id: 'tempo', label: 'Tempo' }, { id: 'interval', label: 'Interval' },
  { id: 'long_run', label: 'Long run' }, { id: 'race', label: 'Race' },
];
const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Jeda sebelum sheet menutup otomatis setelah berhasil menyimpan. */
const CLOSE_DELAY_MS = 1200;

type Tab = 'manual' | 'impor';
interface Msg { text: string; ok: boolean }
interface Errs { date?: string; duration?: string; distance?: string; rpe?: string }

const chip = (on: boolean) =>
  `min-h-11 rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral ${
    on ? 'border-coral/60 bg-coral/20 text-orange-200' : 'border-navy-700 bg-navy-800 text-slate-300'
  }`;

/** Pilihan jenis sesi sebagai chip (satu pilihan). */
function TypePicker({ value, onChange }: { value: WorkoutType; onChange: (t: WorkoutType) => void }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-200">Jenis sesi</div>
      <div role="radiogroup" aria-label="Jenis sesi" className="mt-1 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={value === t.id} onClick={() => onChange(t.id)} className={chip(value === t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Topeng durasi gaya kalkulator: ketik angka saja, hasilnya HH:MM:SS (4500 → 00:45:00). */
function maskDuration(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^0+/, '').slice(-6);
  if (d === '') return '';
  const p = d.padStart(6, '0');
  return `${p.slice(0, 2)}:${p.slice(2, 4)}:${p.slice(4)}`;
}

const CATAT_TABS = [
  { id: 'manual' as const, label: 'Catat manual' },
  { id: 'impor' as const, label: 'Impor file (.FIT/.GPX)' },
];

/** Skala 1–10 yang bisa diketuk. Ketuk angka terpilih sekali lagi untuk mengosongkan. */
function RpeScale({ value, onChange, error, hint, warn }: { value: number | null; onChange: (v: number | null) => void; error?: string; hint?: string; warn?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-200">
        Seberapa berat rasanya? <span className="font-normal text-slate-400">(RPE)</span>
      </div>
      <div role="radiogroup" aria-label="Tingkat berat sesi, 1 sampai 10" className={`mt-1 grid grid-cols-5 gap-2 ${warn ? 'rounded-2xl p-1.5 ring-2 ring-amber-400/70' : ''}`}>
        {RPE_VALUES.map((n) => {
          const on = value === n;
          return (
            <button key={n} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? null : n)}
              className={`min-h-11 rounded-xl border text-base font-bold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral ${
                on ? 'border-transparent bg-coral text-navy-950' : 'border-navy-700 bg-navy-800 text-slate-300'
              }`}>
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-400"><span>1 = sangat ringan</span><span>10 = tenaga maksimal</span></div>
      {error ? <p role="alert" className="mt-1 text-xs text-coral">{error}</p> : warn ? <p role="alert" className="mt-1 text-xs font-semibold text-amber-300">{warn}</p> : hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

function Notice({ msg }: { msg: Msg }) {
  return msg.ok ? (
    <p role="status" className="rounded-xl bg-emerald-400/15 px-3 py-2 text-sm font-semibold text-emerald-300">✓ {msg.text}</p>
  ) : (
    <p role="alert" className="rounded-xl bg-coral/15 px-3 py-2 text-sm text-coral">{msg.text}</p>
  );
}

export default function QuickLog({ profile, onSaved, onDone }: { profile: UserProfile; onSaved: () => void; onDone?: () => void }) {
  const [tab, setTab] = useState<Tab>('manual');
  const [msg, setMsg] = useState<Msg | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Impor
  const [impType, setImpType] = useState<WorkoutType>('easy');
  const [impRpe, setImpRpe] = useState<number | null>(null);
  const [impWarn, setImpWarn] = useState(false);
  // Manual
  const [date, setDate] = useState(todayStr());
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [manType, setManType] = useState<WorkoutType>('easy');
  const [rpe, setRpe] = useState<number | null>(null);
  const [errs, setErrs] = useState<Errs>({});

  const fail = (text: string) => setMsg({ text, ok: false });

  // Setelah berhasil, tutup sheet sebentar kemudian agar pesan sempat terbaca.
  useEffect(() => {
    if (!msg?.ok) return;
    const id = setTimeout(() => doneRef.current?.(), CLOSE_DELAY_MS);
    return () => clearTimeout(id);
  }, [msg]);

  const switchTab = (next: Tab) => { setTab(next); setMsg(null); setErrs({}); setImpWarn(false); };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = /\.fit$/i.test(file.name) ? parseFit(await file.arrayBuffer()) : parseGpx(await file.text());
      if (parsed.avgHr == null && impRpe == null) {
        setImpWarn(true);
        return fail('File ini tidak punya data detak jantung. Pilih tingkat berat (RPE) di atas, lalu pilih berkas lagi agar beban latihan bisa dihitung.');
      }
      if (isDuplicate(await db.workouts.toArray(), parsed)) {
        return fail('Sesi ini sudah ada (waktu dan jarak sama). Impor dilewati.');
      }
      await db.workouts.add(finalizeWorkout({ ...parsed, workoutType: impType, rpe: impRpe }, profile));
      setImpWarn(false);
      setMsg({ text: `Sesi ${parsed.source.toUpperCase()} tersimpan: ${parsed.distanceKm.toFixed(2)} km.`, ok: true });
      onSaved();
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Gagal membaca berkas.');
    } finally {
      input.value = ''; // agar berkas yang sama bisa dipilih lagi
    }
  };

  const onManual = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const today = todayStr();
    const durationSec = parseDuration(duration);
    const distanceKm = Number(distance.replace(',', '.'));
    const next: Errs = {};
    if (!date || date > today) next.date = 'Tanggal tidak boleh kosong atau di masa depan.';
    if (durationSec == null) next.duration = 'Isi durasi dengan format jam:menit:detik, contoh 00:45:00.';
    if (!(distanceKm > 0)) next.distance = 'Jarak harus lebih dari 0 km.';
    if (rpe == null) next.rpe = 'Pilih seberapa berat sesi ini (1–10).';
    setErrs(next);
    setMsg(null);
    if (Object.keys(next).length > 0 || durationSec == null || rpe == null) return;

    const ts = date === today ? Date.now() : new Date(`${date}T12:00:00`).getTime();
    try {
      await db.workouts.add(finalizeWorkout({
        date: ts, source: 'manual', workoutType: manType,
        distanceKm, durationSec, avgPaceSecPerKm: durationSec / distanceKm,
        avgHr: null, maxHr: null, avgCadence: null, elevationGain: null, rpe, laps: [],
      }, profile));
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Gagal menyimpan sesi.');
    }
    setDuration(''); setDistance(''); setRpe(null); setDate(todayStr());
    setMsg({ text: 'Sesi tersimpan. Beban 7 hari diperbarui.', ok: true });
    onSaved();
  };

  return (
    <div className="space-y-4">
      <SegmentedTabs idBase="catat" label="Cara mencatat sesi" tabs={CATAT_TABS} value={tab} onChange={switchTab} />

      {tab === 'manual' ? (
        <form id="catat-panel-manual" role="tabpanel" aria-labelledby="catat-tab-manual" onSubmit={onManual} noValidate className="space-y-4">
          <Field label="Tanggal" type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} error={errs.date} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Durasi" hint="Ketik angkanya saja: 4500 jadi 00:45:00" inputMode="numeric" value={duration} onChange={(e) => setDuration(maskDuration(e.target.value))}
              placeholder="00:45:00" autoComplete="off" error={errs.duration} />
            <Field label="Jarak" term="km" hint="Contoh 8,5" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)}
              placeholder="8,0" autoComplete="off" error={errs.distance} />
          </div>
          <TypePicker value={manType} onChange={setManType} />
          <RpeScale value={rpe} onChange={setRpe} error={errs.rpe} />
          {msg && <Notice msg={msg} />}
          <PrimaryButton type="submit">Simpan sesi</PrimaryButton>
        </form>
      ) : (
        <div id="catat-panel-impor" role="tabpanel" aria-labelledby="catat-tab-impor" className="space-y-4">
          <TypePicker value={impType} onChange={setImpType} />
          <RpeScale value={impRpe} onChange={(v) => { setImpRpe(v); if (v != null) setImpWarn(false); }} hint="Wajib diisi bila file tidak punya data detak jantung."
            warn={impWarn ? 'File ini tidak punya data detak jantung. Pilih RPE di sini, lalu pilih berkas lagi.' : undefined} />
          <label className="flex min-h-[46px] w-full cursor-pointer items-center justify-center rounded-xl bg-coral px-4 py-2 font-display text-sm font-extrabold text-navy-950 shadow-lg shadow-coral/25 focus-within:ring-2 focus-within:ring-coral focus-within:ring-offset-2 focus-within:ring-offset-navy-900">
            Pilih berkas .FIT / .GPX
            <input type="file" accept=".fit,.gpx" onChange={onImport} className="sr-only" />
          </label>
          {msg && <Notice msg={msg} />}
        </div>
      )}
    </div>
  );
}
