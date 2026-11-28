import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { db } from '../db/database';
import { editWorkout } from '../db/workoutEdit';
import type { UserProfile, Workout, WorkoutType } from '../analytics/types';
import { currentVdot, PENALTY_RULES, predictAll, RACE_KM, velocityFor, ZONE_FRACTION } from '../analytics/predictor';
import { analyzeWorkoutSession } from '../analytics/sessionAnalysis';
import { DAY_MS } from '../analytics/workload';
import { parseDuration } from '../parsers/manual';
import { applyAdaptation, evaluateAdaptation, gatherAdaptiveInput } from '../plans/adaptiveEngine';
import { resolveMaxHr } from '../plans/hrZones';
import { loadK5 } from '../plans/k5Store';
import { fmtPace, nearestRow, paceSecPerKm } from '../plans/pace';
import { applyScheduleState, buildPlan, completedIds, flattenPlan, isoFromLocal, isoFromRaceTs, type PlanSession } from '../plans/schedule';
import { loadScheduleState } from '../plans/scheduleStore';
import { loadShoes } from '../plans/shoeStore';
import { fmtDate, fmtHms, todayStr } from './format';
import { filterWorkouts, type DistFilter, type SourceFilter, type TypeFilter } from './historyFilter';
import { SessionDetailView } from './SessionAnalysisTab';
import { Button, Field, ScreenHeader, SelectField } from './ui';
import ConfirmDialog from './ConfirmDialog';
import Sheet from './Sheet';

const DISTS: DistFilter[] = ['all', '5K', '10K', '21.1K', '42.2K'];
const SOURCES: SourceFilter[] = ['all', 'fit', 'gpx', 'manual'];
const SOURCE_LABEL: Record<SourceFilter, string> = { all: 'Semua', fit: 'File FIT', gpx: 'File GPX', manual: 'Manual' };
const TYPE_LABEL: Record<WorkoutType, string> = { easy: 'Easy', tempo: 'Tempo', interval: 'Interval', long_run: 'Long Run', race: 'Race' };
const TYPE_IDS = Object.keys(TYPE_LABEL) as WorkoutType[];

const TYPE_BORDER: Record<WorkoutType, string> = {
  easy: 'border-l-[#BEF264]',
  tempo: 'border-l-amber-400',
  interval: 'border-l-rose-500',
  long_run: 'border-l-sky-400',
  race: 'border-l-rose-500',
};

const TYPE_BADGE: Record<WorkoutType, string> = {
  easy: 'border-[#BEF264]/30 bg-[#BEF264]/15 text-[#BEF264]',
  tempo: 'border-amber-400/35 bg-amber-400/15 text-amber-300',
  interval: 'border-rose-500/35 bg-rose-500/15 text-rose-400',
  long_run: 'border-sky-400/30 bg-sky-400/15 text-sky-300',
  race: 'border-rose-500/40 bg-rose-500/20 text-rose-400',
};

interface Filters { dist: DistFilter; source: SourceFilter; type: TypeFilter }
const NO_FILTER: Filters = { dist: 'all', source: 'all', type: 'all' };

const chip = (on: boolean) =>
  `min-h-[44px] rounded-full border px-4 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
    on ? 'border-[#BEF264]/60 bg-[#BEF264]/15 text-[#BEF264]' : 'border-white/10 bg-[#18181D] text-zinc-300 hover:border-white/20'
  }`;

const textareaCls =
  'mt-1 block w-full rounded-2xl border border-white/10 bg-[#121215] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-[#BEF264] focus:outline-none focus:ring-2 focus:ring-[#BEF264]/35';

function buildAnalysisContext(profile: UserProfile, workouts: Workout[]) {
  const now = Date.now();
  const todayIso = todayStr();
  const preds = predictAll(workouts, now);

  const vd = currentVdot(workouts, now);
  const easyVdot = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;
  const saved = loadK5();
  const k5 = parseDuration(saved ?? (preds['5K'] ? fmtHms(preds['5K'].finalSec) : ''));
  const row = k5 != null ? nearestRow(k5) : null;
  const easyPace = paceSecPerKm('rec', row) ?? easyVdot;

  let plannedSessions: PlanSession[] | undefined;
  const raceIso = profile.targetRaceDate ? isoFromRaceTs(profile.targetRaceDate) : null;
  if (raceIso) {
    const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
    const startWeeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
    const maxWeeklyKm = profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 50;
    const maxHr = resolveMaxHr(profile, workouts);
    const st = loadScheduleState();
    const base = buildPlan({
      raceIso, todayIso, days: st.days, raceName: `${profile.targetDistance} · Hari Lomba`,
      startWeeklyKm, maxWeeklyKm, easyPaceSecPerKm: easyPace, curriculum: 'custom', maxHr,
    });
    const flat = flattenPlan(applyScheduleState(base, st, raceIso));
    const done = completedIds(flat, new Set(workouts.map((w) => isoFromLocal(w.date))), st, todayIso);
    const decision = evaluateAdaptation(gatherAdaptiveInput(workouts, profile, now).input);
    plannedSessions = applyAdaptation(flat, decision, todayIso, done, maxHr).sessions;
  }

  return {
    profile,
    curriculum: 'custom' as const,
    easyPaceSecPerKm: easyPace,
    mafPaceSecPerKm: null,
    plannedSessions,
  };
}

export default function Riwayat({
  profile,
  workouts,
  reload,
  embedded = false,
}: {
  profile: UserProfile;
  workouts: Workout[];
  reload: () => void;
  embedded?: boolean;
}) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filters>(NO_FILTER);
  const [panel, setPanel] = useState(false);
  const [sel, setSel] = useState<Workout | null>(null);
  const [ask, setAsk] = useState<Workout | null>(null);

  const sorted = useMemo(() => [...workouts].sort((a, b) => b.date - a.date), [workouts]);
  const list = useMemo(() => filterWorkouts(sorted, { q, ...f }, RACE_KM), [sorted, q, f]);
  const analysisCtx = useMemo(() => buildAnalysisContext(profile, workouts), [profile, workouts]);

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
    <div className="space-y-4">
      {!embedded && <ScreenHeader title="Riwayat" subtitle="Ketuk sesi untuk melihat detail analisis" />}

      <div className="flex gap-2">
        <label className="relative block flex-1">
          <span className="sr-only">Cari sesi</span>
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="Cari sesi atau catatan"
            className="block min-h-[44px] w-full rounded-2xl border border-white/10 bg-[#121215] py-2 pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-[#BEF264] focus:outline-none focus:ring-2 focus:ring-[#BEF264]/35"
          />
        </label>
        <button
          type="button"
          onClick={() => setPanel(true)}
          aria-haspopup="dialog"
          className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-[#121215] px-3.5 text-sm font-bold text-zinc-100 transition hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
        >
          <SlidersHorizontal size={16} aria-hidden />
          <span>Filter</span>
          {active.length > 0 && (
            <span className="rounded-full bg-[#BEF264] px-1.5 text-xs font-extrabold text-[#09090B]">
              {active.length}
            </span>
          )}
        </button>
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setF({ ...f, [a.key]: 'all' })}
              aria-label={`Hapus filter ${a.label}`}
              className="flex min-h-[44px] items-center gap-1 rounded-full border border-[#BEF264]/40 bg-[#BEF264]/10 pl-3.5 pr-2.5 text-xs font-bold text-[#BEF264] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              {a.label}
              <X size={14} aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setF(NO_FILTER)}
            className="min-h-[44px] px-2 text-xs font-semibold text-zinc-400 underline hover:text-zinc-200"
          >
            Hapus semua
          </button>
        </div>
      )}

      {sorted.length === 0 && (
        <p className="sport-card p-5 text-sm text-zinc-300">
          Belum ada sesi tercatat. Catat lari atau unggah file <strong className="text-[#BEF264]">.FIT</strong> dari tab <strong className="text-white">Hari Ini</strong>.
        </p>
      )}
      {sorted.length > 0 && (
        <p className="text-xs font-mono tabular-nums text-zinc-400" aria-live="polite">
          {list.length} dari {sorted.length} sesi
        </p>
      )}
      {sorted.length > 0 && list.length === 0 && (
        <div className="sport-card space-y-3 p-4 text-sm text-zinc-300">
          <p>Tidak ada sesi yang cocok dengan filter ini.</p>
          <Button variant="secondary" onClick={() => { setQ(''); setF(NO_FILTER); }}>
            Reset filter
          </Button>
        </div>
      )}

      <div className="space-y-2.5">
        {list.map((w, i) => (
          <button
            key={w.id ?? i}
            type="button"
            onClick={() => setSel(w)}
            className={`sport-card block w-full border-l-[3px] p-4 text-left transition hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${TYPE_BORDER[w.workoutType]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-sm font-bold text-white">{fmtDate(w.date)}</span>
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TYPE_BADGE[w.workoutType]}`}>
                {TYPE_LABEL[w.workoutType]}
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div>
                <dt className="text-[11px] font-medium text-zinc-400">Jarak</dt>
                <dd className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-sky-400 sm:text-lg">
                  {w.distanceKm.toFixed(2)} <span className="font-sans text-xs font-semibold text-zinc-400">km</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-zinc-400">Pace Rata-rata</dt>
                <dd className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-[#BEF264] sm:text-lg">
                  {fmtPace(w.avgPaceSecPerKm)} <span className="font-sans text-xs font-semibold text-zinc-400">/km</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-zinc-400">Durasi</dt>
                <dd className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-white sm:text-lg">
                  {fmtHms(w.durationSec)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-zinc-400">Rata-rata HR</dt>
                <dd className="mt-0.5 font-mono text-base font-extrabold tabular-nums text-zinc-200 sm:text-lg">
                  {w.avgHr != null ? (
                    <>
                      {Math.round(w.avgHr)} <span className="font-sans text-xs font-semibold text-zinc-400">bpm</span>
                    </>
                  ) : (
                    '–'
                  )}
                </dd>
              </div>
            </dl>
          </button>
        ))}
      </div>

      {panel && (
        <FilterPanel
          q={q}
          sorted={sorted}
          initial={f}
          onApply={(next) => { setF(next); setPanel(false); }}
          onClose={() => setPanel(false)}
        />
      )}
      {sel && (
        <Detail
          key={sel.id ?? sel.date}
          w={sel}
          analysisCtx={analysisCtx}
          onClose={() => setSel(null)}
          onDelete={() => setAsk(sel)}
          onSaved={(updated) => {
            setSel(updated);
            reload();
          }}
        />
      )}
      {ask && (
        <ConfirmDialog
          id="hapus-sesi"
          title="Hapus sesi ini?"
          confirmLabel="Hapus"
          onCancel={() => setAsk(null)}
          onConfirm={() => void remove(ask)}
        >
          <p>
            Sesi {fmtDate(ask.date)} ({ask.distanceKm.toFixed(2)} km) akan dihapus permanen dari perangkat ini.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function FilterPanel({ q, sorted, initial, onApply, onClose }: { q: string; sorted: Workout[]; initial: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [d, setD] = useState<Filters>(initial);
  const count = (patch: Partial<Filters>) => filterWorkouts(sorted, { q, ...d, ...patch }, RACE_KM).length;
  const group = (title: string, children: ReactNode) => (
    <div className="mb-4">
      <div className="text-sm font-semibold text-zinc-200">{title}</div>
      <div className="mt-1.5 flex flex-wrap gap-2">{children}</div>
    </div>
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

const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function maskDuration(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^0+/, '').slice(-6);
  if (d === '') return '';
  const p = d.padStart(6, '0');
  return `${p.slice(0, 2)}:${p.slice(2, 4)}:${p.slice(4)}`;
}

function Detail({
  w,
  analysisCtx,
  onClose,
  onDelete,
  onSaved,
}: {
  w: Workout;
  analysisCtx: ReturnType<typeof buildAnalysisContext>;
  onClose: () => void;
  onDelete: () => void;
  onSaved: (updated: Workout) => void;
}) {
  const isManual = w.source === 'manual';
  const origDateStr = isoFromLocal(w.date);
  const [dateStr, setDateStr] = useState(origDateStr);
  const [distanceText, setDistanceText] = useState(w.distanceKm.toFixed(2));
  const [durationText, setDurationText] = useState(fmtHms(w.durationSec));
  const [rpe, setRpe] = useState<number | null>(w.rpe);
  const [note, setNote] = useState(w.note ?? '');
  const [type, setType] = useState<WorkoutType>(w.workoutType);
  const [shoes] = useState(() => loadShoes());
  const [shoeId, setShoeId] = useState(w.shoeId ?? '');
  const [saved, setSaved] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const selectableShoes = shoes.filter((s) => !s.retired || s.id === w.shoeId);
  const analysis = useMemo(
    () => analyzeWorkoutSession({ ...w, workoutType: type }, analysisCtx),
    [w, type, analysisCtx],
  );

  const save = async () => {
    setErrMsg(null);
    setSaved(false);
    const today = todayStr();
    if (!dateStr || dateStr > today) {
      setErrMsg('Tanggal sesi tidak valid atau melebihi hari ini.');
      return;
    }
    const nextDate =
      dateStr === origDateStr
        ? w.date
        : dateStr === today
          ? Date.now()
          : new Date(`${dateStr}T12:00:00`).getTime();

    const parsedDuration = isManual ? parseDuration(durationText) : w.durationSec;
    if (parsedDuration == null || parsedDuration <= 0) {
      setErrMsg('Durasi harus lebih dari 00:00:00 (format jam:menit:detik).');
      return;
    }
    const parsedDistance = isManual ? Number(distanceText.replace(',', '.')) : w.distanceKm;
    if (!Number.isFinite(parsedDistance) || parsedDistance <= 0 || parsedDistance > 300) {
      setErrMsg('Jarak harus antara 0 dan 300 km.');
      return;
    }
    if (w.avgHr == null && rpe == null) {
      setErrMsg('Sesi tanpa data HR wajib memiliki skala RPE (1–10).');
      return;
    }

    try {
      const updated = await editWorkout(
        w,
        {
          date: nextDate,
          distanceKm: parsedDistance,
          durationSec: parsedDuration,
          rpe,
          workoutType: type,
          note,
          shoeId: shoeId || undefined,
        },
        analysisCtx.profile,
      );
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Gagal menyimpan perubahan sesi.');
    }
  };

  return (
    <Sheet title={`${fmtDate(w.date)} · ${TYPE_LABEL[type]}`} titleId="detail-judul" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="sport-subcard p-3">
            <div className="text-[11px] font-medium text-zinc-400">Jarak</div>
            <div className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-sky-400">
              {w.distanceKm.toFixed(2)} km
            </div>
          </div>
          <div className="sport-subcard p-3">
            <div className="text-[11px] font-medium text-zinc-400">Pace</div>
            <div className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-[#BEF264]">
              {fmtPace(w.avgPaceSecPerKm)} /km
            </div>
          </div>
          <div className="sport-subcard p-3">
            <div className="text-[11px] font-medium text-zinc-400">Durasi</div>
            <div className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-white">
              {fmtHms(w.durationSec)}
            </div>
          </div>
        </div>

        <SessionDetailView item={analysis} />

        <details className="group rounded-2xl border border-white/[0.08] bg-[#18181D]/70">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-xs font-semibold text-zinc-300">
            <span>Edit sesi & catatan</span>
            <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t border-white/[0.06] p-3.5">
            <Field
              label="Tanggal"
              type="date"
              value={dateStr}
              max={todayStr()}
              onChange={(e) => { setDateStr(e.target.value); setSaved(false); setErrMsg(null); }}
            />

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Jarak"
                term="km"
                inputMode="decimal"
                disabled={!isManual}
                value={distanceText}
                onChange={(e) => { setDistanceText(e.target.value); setSaved(false); setErrMsg(null); }}
                hint={!isManual ? 'Terkunci pada sesi impor' : undefined}
              />
              <Field
                label="Durasi"
                term="HH:MM:SS"
                inputMode="numeric"
                disabled={!isManual}
                value={durationText}
                onChange={(e) => { setDurationText(maskDuration(e.target.value)); setSaved(false); setErrMsg(null); }}
                hint={!isManual ? 'Terkunci pada sesi impor' : undefined}
              />
            </div>

            <div>
              <div className="text-sm font-semibold text-zinc-200">
                Tingkat usaha <span className="font-normal text-zinc-400">(RPE 1–10)</span>
              </div>
              <div role="radiogroup" aria-label="Tingkat berat sesi, 1 sampai 10" className="mt-1.5 grid grid-cols-5 gap-1.5">
                {RPE_VALUES.map((n) => {
                  const on = rpe === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => { setRpe(on && w.avgHr != null ? null : n); setSaved(false); setErrMsg(null); }}
                      className={`min-h-[44px] rounded-xl border font-mono text-sm font-bold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                        on ? 'border-transparent bg-[#BEF264] text-[#09090B]' : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/20'
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>

            <SelectField
              label="Jenis sesi"
              value={type}
              onChange={(e) => { setType(e.target.value as WorkoutType); setSaved(false); setErrMsg(null); }}
            >
              {TYPE_IDS.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </SelectField>

            {selectableShoes.length > 0 && (
              <SelectField
                label="Sepatu"
                value={shoeId}
                onChange={(e) => { setShoeId(e.target.value); setSaved(false); setErrMsg(null); }}
              >
                <option value="">Otomatis (Sepatu Utama)</option>
                {selectableShoes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.isDefault ? ' (Utama)' : s.retired ? ' (Pensiun)' : ''}
                  </option>
                ))}
              </SelectField>
            )}

            <label className="block text-sm font-semibold text-zinc-200">
              Catatan
              <textarea
                value={note}
                onChange={(e) => { setNote(e.target.value); setSaved(false); setErrMsg(null); }}
                rows={2}
                className={textareaCls}
              />
            </label>

            {errMsg && (
              <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                {errMsg}
              </p>
            )}
            {saved && (
              <p role="status" className="rounded-2xl border border-[#BEF264]/25 bg-[#BEF264]/10 px-3 py-2 text-xs font-semibold text-[#BEF264]">
                ✓ Perubahan tersimpan.
              </p>
            )}
            <Button onClick={() => void save()}>Simpan perubahan</Button>
          </div>
        </details>

        <Button variant="danger" onClick={onDelete}>Hapus sesi</Button>
      </div>
    </Sheet>
  );
}
