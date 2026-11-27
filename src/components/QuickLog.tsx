import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { db } from '../db/database';
import { isDuplicate } from '../db/validate';
import { finalizeWorkout } from '../analytics/workload';
import type { UserProfile, WorkoutType } from '../analytics/types';
import { parseFit } from '../parsers/fitParser';
import { parseGpx } from '../parsers/gpxParser';
import { parseDuration } from '../parsers/manual';
import { getDefaultShoeId, loadShoes } from '../plans/shoeStore';
import { todayStr } from './format';
import { Field, PrimaryButton, SegmentedTabs, SelectField } from './ui';

const TYPES: { id: WorkoutType; label: string; desc: string }[] = [
  { id: 'easy', label: 'Easy', desc: 'Santai & aerobik' },
  { id: 'long_run', label: 'Long Run', desc: 'Jarak jauh santai' },
  { id: 'tempo', label: 'Tempo', desc: 'Cepat stabil' },
  { id: 'interval', label: 'Interval', desc: 'Ulangan cepat' },
  { id: 'race', label: 'Race', desc: 'Hari lomba' },
];
const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const CLOSE_DELAY_MS = 1200;
const MIN_PACE_SEC = 120;  // 2:00 /km
const MAX_PACE_SEC = 1200; // 20:00 /km

type Tab = 'manual' | 'impor';
interface Msg { text: string; ok: boolean }
interface Errs { date?: string; duration?: string; distance?: string; rpe?: string }

const chip = (on: boolean) =>
  `flex min-h-[44px] flex-col items-start justify-center rounded-2xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
    on ? 'border-[#BEF264]/70 bg-[#BEF264]/10 text-white' : 'border-white/10 bg-[#18181D] text-zinc-200 hover:border-white/20'
  }`;

function rpeFeedback(v: number): { title: string; tone: string } {
  if (v <= 3) return { title: '1–3: Sangat ringan', tone: 'border-sky-400/30 bg-sky-400/10 text-sky-300' };
  if (v <= 6) return { title: '4–6: Sedang & nyaman', tone: 'border-[#BEF264]/30 bg-[#BEF264]/10 text-[#BEF264]' };
  if (v <= 8) return { title: '7–8: Berat', tone: 'border-amber-400/30 bg-amber-400/10 text-amber-300' };
  return { title: '9–10: Maksimal', tone: 'border-rose-500/35 bg-rose-500/10 text-rose-400' };
}

function TypePicker({ value, onChange }: { value: WorkoutType; onChange: (t: WorkoutType) => void }) {
  return (
    <div>
      <div className="text-sm font-semibold text-zinc-200">Jenis lari</div>
      <div role="radiogroup" aria-label="Jenis lari" className="mt-1.5 grid grid-cols-2 gap-2">
        {TYPES.map((t, idx) => {
          const on = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(t.id)}
              className={`${chip(on)} ${idx === TYPES.length - 1 ? 'col-span-2' : ''}`}
            >
              <span className={`font-display text-sm font-bold ${on ? 'text-[#BEF264]' : 'text-white'}`}>{t.label}</span>
              <span className={`text-[11px] leading-snug ${on ? 'text-zinc-200' : 'text-zinc-400'}`}>{t.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function maskDuration(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^0+/, '').slice(-6);
  if (d === '') return '';
  const p = d.padStart(6, '0');
  return `${p.slice(0, 2)}:${p.slice(2, 4)}:${p.slice(4)}`;
}

const CATAT_TABS = [
  { id: 'manual' as const, label: 'Catat manual' },
  { id: 'impor' as const, label: 'Impor .FIT / .GPX' },
];

function RpeScale({ value, onChange, error, hint, warn }: { value: number | null; onChange: (v: number | null) => void; error?: string; hint?: string; warn?: string }) {
  const feedback = value != null ? rpeFeedback(value) : null;
  return (
    <div>
      <div className="text-sm font-semibold text-zinc-200">
        Tingkat usaha <span className="font-normal text-zinc-400">(RPE)</span>
      </div>
      <div role="radiogroup" aria-label="Tingkat berat sesi, 1 sampai 10" className={`mt-1.5 grid grid-cols-5 gap-2 ${warn ? 'rounded-2xl p-1.5 ring-2 ring-amber-400/70' : ''}`}>
        {RPE_VALUES.map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? null : n)}
              className={`min-h-[44px] rounded-2xl border font-mono text-base font-bold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                on ? 'border-transparent bg-[#BEF264] text-[#09090B]' : 'border-white/10 bg-[#18181D] text-zinc-300 hover:border-white/20'
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      {feedback ? (
        <div className={`mt-2 rounded-2xl border px-3 py-2 text-xs font-semibold ${feedback.tone}`} aria-live="polite">
          {feedback.title}
        </div>
      ) : (
        <div className="mt-1.5 flex justify-between text-xs text-zinc-400">
          <span>1–3: Ringan</span>
          <span>9–10: Maksimal</span>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-rose-400">{error}</p>
      ) : warn ? (
        <p role="alert" className="mt-1 text-xs font-semibold text-amber-300">{warn}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}

function Notice({ msg }: { msg: Msg }) {
  return msg.ok ? (
    <p role="status" className="rounded-2xl border border-[#BEF264]/25 bg-[#BEF264]/10 px-3 py-2 text-sm font-semibold text-[#BEF264]">
      ✓ {msg.text}
    </p>
  ) : (
    <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
      {msg.text}
    </p>
  );
}

export default function QuickLog({ profile, onSaved, onDone }: { profile: UserProfile; onSaved: () => void; onDone?: () => void }) {
  const [tab, setTab] = useState<Tab>('manual');
  const [msg, setMsg] = useState<Msg | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const [activeShoes] = useState(() => loadShoes().filter((s) => !s.retired));
  const [shoeId, setShoeId] = useState(() => getDefaultShoeId(activeShoes) ?? '');

  const [impType, setImpType] = useState<WorkoutType>('easy');
  const [impRpe, setImpRpe] = useState<number | null>(null);
  const [impWarn, setImpWarn] = useState(false);

  const [date, setDate] = useState(todayStr());
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [manType, setManType] = useState<WorkoutType>('easy');
  const [rpe, setRpe] = useState<number | null>(null);
  const [errs, setErrs] = useState<Errs>({});

  const fail = (text: string) => setMsg({ text, ok: false });

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
      const parsed = /\.fit$/i.test(file.name)
        ? parseFit(await file.arrayBuffer())
        : parseGpx(await file.text(), profile.maxHr);
      if (parsed.avgHr == null && impRpe == null) {
        setImpWarn(true);
        return fail('File tidak memiliki data HR. Pilih RPE di atas lalu pilih file lagi.');
      }
      if (isDuplicate(await db.workouts.toArray(), parsed)) {
        return fail('Sesi ini sudah tercatat.');
      }
      await db.workouts.add(finalizeWorkout({
        ...parsed,
        workoutType: impType,
        rpe: impRpe,
        ...(shoeId ? { shoeId } : {}),
      }, profile));
      setImpWarn(false);
      setMsg({ text: `Sesi ${parsed.source.toUpperCase()} tersimpan (${parsed.distanceKm.toFixed(2)} km).`, ok: true });
      onSaved();
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Gagal membaca berkas.');
    } finally {
      input.value = '';
    }
  };

  const onManual = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const today = todayStr();
    const durationSec = parseDuration(duration);
    const distanceKm = Number(distance.replace(',', '.'));
    const next: Errs = {};
    if (!date || date > today) next.date = 'Tanggal tidak valid.';
    if (durationSec == null || durationSec <= 0) {
      next.duration = 'Durasi harus lebih dari 00:00:00 (jam:menit:detik).';
    }
    if (!(distanceKm > 0) || distanceKm > 300) {
      next.distance = 'Jarak harus antara 0 dan 300 km.';
    }
    if (!next.duration && !next.distance && durationSec != null) {
      const pace = durationSec / distanceKm;
      if (pace < MIN_PACE_SEC || pace > MAX_PACE_SEC) {
        next.duration = 'Pace tidak masuk akal (harus 2:00–20:00 /km). Periksa durasi dan jarak.';
      }
    }
    if (rpe == null) next.rpe = 'Pilih skala RPE (1–10).';
    setErrs(next);
    setMsg(null);
    if (Object.keys(next).length > 0 || durationSec == null || rpe == null) return;

    const ts = date === today ? Date.now() : new Date(`${date}T12:00:00`).getTime();
    try {
      await db.workouts.add(finalizeWorkout({
        date: ts, source: 'manual', workoutType: manType,
        distanceKm, durationSec, avgPaceSecPerKm: durationSec / distanceKm,
        avgHr: null, maxHr: null, avgCadence: null, elevationGain: null, rpe, laps: [],
        ...(shoeId ? { shoeId } : {}),
      }, profile));
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Gagal menyimpan sesi.');
    }
    setDuration(''); setDistance(''); setRpe(null); setDate(todayStr());
    setMsg({ text: 'Sesi lari tersimpan.', ok: true });
    onSaved();
  };

  const shoePicker = activeShoes.length > 0 ? (
    <SelectField label="Sepatu" value={shoeId} onChange={(e) => setShoeId(e.target.value)}>
      {activeShoes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}{s.isDefault ? ' (Utama)' : ''}
        </option>
      ))}
    </SelectField>
  ) : null;

  return (
    <div className="space-y-4">
      <SegmentedTabs idBase="catat" label="Cara mencatat sesi" tabs={CATAT_TABS} value={tab} onChange={switchTab} />

      {tab === 'manual' ? (
        <form id="catat-panel-manual" role="tabpanel" aria-labelledby="catat-tab-manual" onSubmit={onManual} noValidate className="space-y-4">
          <Field label="Tanggal" type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} error={errs.date} />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Durasi"
              hint="Contoh 4500 → 00:45:00"
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(maskDuration(e.target.value))}
              placeholder="00:45:00"
              autoComplete="off"
              error={errs.duration}
            />
            <Field
              label="Jarak"
              term="km"
              hint="Contoh 8,5"
              inputMode="decimal"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              placeholder="8,0"
              autoComplete="off"
              error={errs.distance}
            />
          </div>
          <TypePicker value={manType} onChange={setManType} />
          {shoePicker}
          <RpeScale value={rpe} onChange={setRpe} error={errs.rpe} />
          {msg && <Notice msg={msg} />}
          <PrimaryButton type="submit">Simpan sesi</PrimaryButton>
        </form>
      ) : (
        <div id="catat-panel-impor" role="tabpanel" aria-labelledby="catat-tab-impor" className="space-y-4">
          <TypePicker value={impType} onChange={setImpType} />
          {shoePicker}
          <RpeScale
            value={impRpe}
            onChange={(v) => { setImpRpe(v); if (v != null) setImpWarn(false); }}
            hint="Wajib diisi bila file tidak memiliki data HR."
            warn={impWarn ? 'Pilih RPE di atas lalu pilih file lagi.' : undefined}
          />
          <label className="flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-2xl bg-[#BEF264] px-4 py-2 font-display text-sm font-extrabold text-[#09090B] shadow-[0_0_20px_rgba(190,242,100,0.2)] transition hover:bg-[#d4fc82] focus-within:ring-2 focus-within:ring-[#BEF264] focus-within:ring-offset-2 focus-within:ring-offset-[#09090B]">
            Pilih berkas .FIT / .GPX
            <input type="file" accept=".fit,.gpx" onChange={onImport} className="sr-only" />
          </label>
          {msg && <Notice msg={msg} />}
        </div>
      )}
    </div>
  );
}
