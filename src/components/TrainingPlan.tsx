import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, RotateCcw, Sparkles } from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, cardiacDrift, efTrend } from '../analytics/workload';
import { generateAiTrainingPlan, loadGeminiApiKey } from '../analytics/aiCoach';
import type { AiTrainingPlanResult } from '../analytics/aiCoach';
import { PENALTY_RULES, RACE_KM } from '../analytics/predictor';
import { applyAdaptation, calibrateFrom3k, evaluateAdaptation, gatherAdaptiveInput, intervalPaceRange, TEST3K_FACTOR, weekPace } from '../plans/adaptiveEngine';
import { HR_FIRST_RULE, resolveMaxHr, ZONE_LABEL } from '../plans/hrZones';
import { STRENGTH_NOTE } from '../plans/progressive5k';
import { mafHr, mafTests, MAF_RULE } from '../plans/maf';
import { fmtKm, fmtPace, fmtRangeKm, nearestRow, paceKeyFor, paceSecPerKm } from '../plans/pace';
import {
  addDays, applyScheduleState, autoCompleted, buildPlan, clearAiSchedule, completedIds, dayNum, flattenPlan, formatDateId, formatDayMonth,
  isoFromLocal, isoFromRaceTs, MIN_BASE_WEEKLY_KM, MIN_TRAINING_DAYS, resetSchedule, setSessionDate, shiftAll, swapSessions, toggleDay, toggleDone,
  WEEKDAY_SHORT,
} from '../plans/schedule';
import type { CurriculumId, Phase, PlanSession, ScheduleState } from '../plans/schedule';
import { loadMafAdj, loadScheduleState, saveMafAdj, saveScheduleState } from '../plans/scheduleStore';
import { parseDuration } from '../parsers/manual';
import { fmtDate, fmtHms, todayStr } from './format';
import MafCard from './MafCard';
import Sheet from './Sheet';
import { KIND_BORDER, KIND_LABEL } from './sessionMeta';
import { Button, Field } from './ui';

const KIND_HINT: Record<PlanSession['kind'], string> = {
  recovery: 'Lari santai: napas tenang, masih bisa ngobrol. Jangan dipercepat walau terasa terlalu mudah.',
  long: 'Lari terpanjang minggu ini. Pace santai, sama seperti Easy Run. Boleh jeda jalan kaki bila perlu.',
  speed: 'Lari cepat berinterval. Ikuti pace tiap langkah; sela pemulihan dilakukan dengan lari/jalan pelan.',
  race: 'Hari uji PB: lari dengan target pace PB di bawah.',
};
const MAF_HINT: Record<PlanSession['kind'], string> = {
  recovery: 'Lari santai di zona MAF: jaga detak jantung di antara batas bawah dan MAF. Pace mengikuti detak jantung.',
  long: 'Lari terpanjang minggu ini, tetap di zona MAF. Boleh jeda jalan bila detak jantung melewati MAF.',
  speed: 'MAF Test: lari 5 km di detak jantung MAF dan catat waktu tiap km. Pace yang makin cepat di detak jantung sama = fondasi aerobik membaik.',
  race: 'Hari lomba: lari dengan usaha terkendali menuju target pace.',
};
/** Panjang blok kurikulum penuh (minggu). */
const PEAK_WEEKS: Record<CurriculumId, number> = { nike5k: 8, progressive5k: 11, maf: 12 };
const PHASE_LABEL: Record<Phase, string> = { base: 'Base Building', build: 'Build', taper: 'Taper', race: 'Lomba' };
const STORE_KEY = 'pacelab.k5';
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Sen … Min
const card = 'sport-card p-4';
const control = 'mt-1 block min-h-11 w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-2 text-sm tabular-nums text-slate-100 focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/40';
const badge = 'inline-block rounded-full bg-coral/15 px-2 py-0.5 text-[11px] font-semibold text-coral';

function loadSaved(): string | null {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

const fmtRangeMinMax = ([fast, slow]: [number, number]) => `${fmtPace(fast)}–${fmtPace(slow)} /km`;

interface Props {
  profile: UserProfile;
  workouts: Workout[];
  defaultK5Sec: number | null;
  /** Pace proyeksi Riegel saat ini untuk jarak target (detik/km); null bila belum ada data. */
  currentPaceSecPerKm: number | null;
  startWeeklyKm: number;
  easyPaceSecPerKm: number;
  curriculum: CurriculumId;
}

interface SettingsProps {
  st: ScheduleState;
  update: (next: ScheduleState) => void;
  k5Text: string;
  onK5: (v: string) => void;
  k5: number | null;
  paceChartRow: ReturnType<typeof nearestRow> | null;
  fromPrediction: boolean;
  missed: number;
  onClose: () => void;
}

/** Sheet "Atur jadwal": dasar pace, hari latihan rutin, dan geser jadwal. */
function SettingsSheet({ st, update, k5Text, onK5, k5, paceChartRow, fromPrediction, missed, onClose }: SettingsProps) {
  const [askReset, setAskReset] = useState(false);
  const k5Hint = fromPrediction ? 'Terisi dari prediksi Riegel Anda. Ubah bila punya hasil 5K terbaru.' : 'Dasar untuk pace chart.';
  return (
    <Sheet title="Atur jadwal" titleId="atur-jadwal-judul" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <Field label="5K terbaru Anda" term="MM:SS" value={k5Text} onChange={(e) => onK5(e.target.value)} placeholder="27:00" autoComplete="off"
            hint={k5Hint} error={k5Text && k5 == null ? 'Format waktu tidak valid. Contoh 27:00.' : undefined} />
          {paceChartRow && (
            <p className="mt-2 text-sm tabular-nums text-slate-300">Baris pace chart: 5K {fmtPace(paceChartRow[1])} · pace tercepat {fmtKm(paceChartRow[0] / 1.609344)}</p>
          )}
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-200">Hari latihan rutin <span className="font-normal text-slate-400">(minimal {MIN_TRAINING_DAYS} hari)</span></div>
          <div className="mt-1 grid grid-cols-7 gap-1.5">
            {DAY_ORDER.map((d) => {
              const on = st.days.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => update(toggleDay(st, d))}
                  className={`min-h-11 rounded-xl text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral ${
                    on ? 'bg-coral text-navy-950' : 'border border-navy-600 text-slate-300'
                  }`}>
                  {WEEKDAY_SHORT[d]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-200">Geser jadwal</div>
          {missed > 0 && <p className="mt-1 text-sm text-amber-400">{missed} sesi terlewat. Geser jadwal bila ingin mengejar.</p>}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button variant="secondary" onClick={() => update(shiftAll(st, -1))}>−1 hari</Button>
            <Button variant="secondary" onClick={() => update(shiftAll(st, 1))}>+1 hari</Button>
            <Button variant="secondary" onClick={() => setAskReset(true)}>Reset</Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Geser aktif: {st.shift > 0 ? `+${st.shift}` : st.shift} hari · {Object.keys(st.overrides).length} tanggal manual. Hari lomba tidak ikut bergeser.
          </p>
          {askReset && (
            <div role="alertdialog" aria-label="Konfirmasi reset jadwal" className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
              <p className="text-sm text-slate-200">Reset jadwal ke hasil penjadwalan otomatis? Geseran dan tanggal manual akan dihapus.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setAskReset(false)}>Batal</Button>
                <Button variant="danger-solid" onClick={() => { update(resetSchedule(st)); setAskReset(false); }}>Reset jadwal</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

export default function TrainingPlan({ profile, workouts, defaultK5Sec, currentPaceSecPerKm, startWeeklyKm, easyPaceSecPerKm, curriculum }: Props) {
  const [st, setSt] = useState<ScheduleState>(loadScheduleState);
  const [weekIdx, setWeekIdx] = useState(0);
  const [settings, setSettings] = useState(false);
  const [mafAdj, setMafAdj] = useState(loadMafAdj);
  const [k5Text, setK5Text] = useState(() => loadSaved() ?? (defaultK5Sec != null ? fmtHms(defaultK5Sec) : ''));
  const [fromPrediction, setFromPrediction] = useState(() => loadSaved() == null && defaultK5Sec != null);
  const [hasApiKey, setHasApiKey] = useState(() => Boolean(loadGeminiApiKey()));
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<AiTrainingPlanResult | null>(null);
  const k5 = parseDuration(k5Text);
  const row = k5 != null ? nearestRow(k5) : null;

  useEffect(() => {
    const syncOnline = () => setIsOnline(navigator.onLine);
    const syncKey = () => setHasApiKey(Boolean(loadGeminiApiKey()));
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    window.addEventListener('storage', syncKey);
    window.addEventListener('focus', syncKey);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
      window.removeEventListener('storage', syncKey);
      window.removeEventListener('focus', syncKey);
    };
  }, []);

  const update = (next: ScheduleState) => { setSt(next); saveScheduleState(next); };
  const onK5 = (v: string) => {
    setK5Text(v);
    setFromPrediction(false);
    try { localStorage.setItem(STORE_KEY, v); } catch { /* penyimpanan tidak tersedia: abaikan */ }
  };

  const todayIso = todayStr();
  const raceIso = profile.targetRaceDate ? isoFromRaceTs(profile.targetRaceDate) : null;
  const targetPace = profile.targetTimeSec / RACE_KM[profile.targetDistance];
  const maxHr = resolveMaxHr(profile, workouts);
  const maf = mafHr(profile.age, mafAdj);
  const mafPts = curriculum === 'maf' ? mafTests(workouts, maf) : [];
  const mafCenter = mafPts.length ? mafPts[mafPts.length - 1].paceSecPerKm : null;
  const maxWeeklyKm = profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 50;

  const title = <h2 className="text-lg font-bold">Jadwal latihan · menuju PB {profile.targetDistance}</h2>;
  const head = (
    <div className="flex items-center justify-between gap-3">
      {title}
      <Button variant="secondary" block={false} onClick={() => setSettings(true)} aria-haspopup="dialog" className="shrink-0">Atur jadwal</Button>
    </div>
  );
  const settingsSheet = (missed: number) => settings && (
    <SettingsSheet st={st} update={update} k5Text={k5Text} onK5={onK5} k5={k5} paceChartRow={row} fromPrediction={fromPrediction} missed={missed} onClose={() => setSettings(false)} />
  );

  if (!raceIso) {
    return (
      <div className="space-y-3">
        {head}
        <p className="rounded-2xl border border-dashed border-coral/60 bg-coral/10 p-4 text-sm">Isi tanggal lomba di tab Ringkasan untuk membuat jadwal berdasarkan kalender nyata.</p>
        {settingsSheet(0)}
      </div>
    );
  }

  // Satu sumber pace santai: Pace Chart (kolom recovery) bila ada, jika tidak zona Easy VDOT.
  const easyPace = paceSecPerKm('rec', row) ?? easyPaceSecPerKm;
  const basePlan = buildPlan({
    raceIso, todayIso, days: st.days, raceName: `${profile.targetDistance} · Hari Lomba / Uji PB`,
    startWeeklyKm, maxWeeklyKm, easyPaceSecPerKm: easyPace, curriculum, maxHr, mafHr: maf,
  });
  const plan = applyScheduleState(basePlan, st, raceIso);
  const flat = flattenPlan(plan);
  const workoutDays = new Set(workouts.map((w) => isoFromLocal(w.date)));
  const done = completedIds(flat, workoutDays, st, todayIso);

  const gathered = gatherAdaptiveInput(workouts, profile, Date.now());
  const decision = evaluateAdaptation(gathered.input);
  const adapted = applyAdaptation(flat, decision, todayIso, done, maxHr);

  // Kalibrasi Tes 3K (kurikulum Progresif): proyeksi 5K = waktu 3K × 1,72; pace interval minggu berikutnya = pace 3K − 10–20 dtk/km.
  const test3k = flat.find((x) => x.test === '3k');
  const testWeek = test3k ? plan.weeks[test3k.weekNo - 1] : undefined;
  const calib = testWeek ? calibrateFrom3k(workouts, maxHr, testWeek.startIso, testWeek.endIso) : null;
  const projPace = calib && profile.targetDistance === '5K' ? calib.pace5kSecPerKm : currentPaceSecPerKm;
  const byId = new Map(adapted.sessions.map((s) => [s.id, s]));
  const labelOf = (id: string) => { const s = byId.get(id); return s ? `${formatDayMonth(s.date)} · ${KIND_LABEL[s.kind]}` : id; };

  const missed = flat.filter((s) => dayNum(s.date) < dayNum(todayIso) && !done.has(s.id)).length;
  const wi = Math.min(weekIdx, Math.max(0, plan.weeks.length - 1));
  const week = plan.weeks[wi];
  const goalPaceFor = (s: PlanSession): number | null =>
    s.kind === 'race' ? targetPace : projPace == null ? null : weekPace(projPace, targetPace, s.weekNo, plan.totalWeeks);
  const weekLabel = (w: (typeof plan.weeks)[number]) =>
    `Minggu ${w.weekNo}/${plan.totalWeeks} · ${formatDayMonth(dayNum(w.startIso) < dayNum(todayIso) ? todayIso : w.startIso)}–${formatDayMonth(w.endIso)} · ${w.title ?? PHASE_LABEL[w.phase]}`;

  if (!week) {
    return (
      <div className="space-y-3">
        {title}
        <p className="rounded-2xl bg-navy-800 p-4 text-sm text-slate-300">Tanggal lomba sudah lewat. Atur tanggal lomba baru di tab Ringkasan.</p>
      </div>
    );
  }

  const { last } = gathered;
  const lastIn = gathered.input;
  /** Durasi & jarak yang ditampilkan (sudah memperhitungkan penyesuaian adaptif). */
  const loadOf = (s: PlanSession): { min: number | null; km: number | null } => {
    const rawMin = s.adjDurationMin ?? s.durationMin;
    if (s.kind === 'speed' || s.kind === 'race') return { min: rawMin, km: null };
    const min = rawMin ?? (s.distanceKm != null ? Math.round((s.distanceKm * easyPace) / 60) : null);
    if (min == null) return { min: null, km: s.distanceKm ?? null };
    const km = s.distanceKm != null && s.durationMin ? (s.distanceKm * min) / s.durationMin : s.distanceKm ?? (min * 60) / easyPace;
    return { min, km };
  };
  const weekKm = week.sessions.reduce((sum, r) => sum + (loadOf(byId.get(r.id) as PlanSession).km ?? 0), 0);

  const canGenerateAi = hasApiKey && isOnline && !aiLoading;
  const hasAiActive = Boolean(st.aiSessions && st.aiSessions.length > 0);

  const handleGenerateAiPlan = async () => {
    const key = loadGeminiApiKey();
    setHasApiKey(Boolean(key));
    setAiLoading(true);
    setAiError(null);
    try {
      const now = Date.now();
      const sorted = [...workouts].filter((w) => w.date <= now).sort((a, b) => b.date - a.date);
      const latestW = sorted[0];
      const latestPace = latestW
        ? latestW.avgPaceSecPerKm > 0
          ? latestW.avgPaceSecPerKm
          : latestW.distanceKm > 0
            ? latestW.durationSec / latestW.distanceKm
            : null
        : null;
      const result = await generateAiTrainingPlan(
        {
          profile,
          curriculum,
          trainingDays: st.days,
          acwr: acwr(workouts, profile, now),
          efTrend: efTrend(workouts, now),
          latestDriftPct: latestW ? cardiacDrift(latestW.laps) : null,
          weeklyVolumeKm: startWeeklyKm,
          latestAvgPaceSec: latestPace,
          workouts,
          todayIso,
          now,
        },
        { apiKey: key, isOnline: navigator.onLine },
      );
      setAiPreview(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Gagal menyusun jadwal latihan AI.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiPlan = () => {
    if (!aiPreview) return;
    const base = clearAiSchedule(st);
    update({
      ...base,
      aiSessions: aiPreview.sessions,
      aiSummary: aiPreview.summary,
    });
    setAiPreview(null);
    setAiError(null);
  };

  const handleRestoreStandard = () => {
    update(clearAiSchedule(st));
    setAiError(null);
  };

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        {head}
        <p className="text-sm tabular-nums text-slate-300">
          {plan.daysRemaining} hari · {plan.weeksRemaining} minggu menuju {formatDateId(raceIso)}
          {plan.baseWeeks > 0 ? ` · ${plan.baseWeeks} minggu Base Building + blok puncak ${PEAK_WEEKS[curriculum]} minggu` : ''}
        </p>
        {curriculum !== 'nike5k' && plan.totalWeeks < PEAK_WEEKS[curriculum] && (
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-300">
            Tersisa {plan.totalWeeks} minggu (kurikulum penuh {PEAK_WEEKS[curriculum]} minggu): minggu awal fase Fondasi dilewati, jadi pelan-pelan dan utamakan detak jantung.
          </p>
        )}
        {missed > 0 && <p className="text-sm text-amber-400">{missed} sesi terlewat. Buka "Atur jadwal" untuk menggeser jadwal.</p>}

        {/* Kontrol & Pratinjau Penyusunan Jadwal AI (BYOK Gemini) */}
        <div className={`${card} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              block={false}
              onClick={handleGenerateAiPlan}
              disabled={!canGenerateAi}
              className="gap-2 border-sky-400/30 bg-sky-400/10 text-sky-200 hover:bg-sky-400/15"
            >
              <Sparkles className="h-4 w-4 text-sky-300" aria-hidden />
              <span>{aiLoading ? 'Menyusun jadwal AI…' : 'Susun Jadwal dengan AI'}</span>
            </Button>

            {hasAiActive && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/15 px-2.5 py-1 text-xs font-bold text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                <span>Program Aktif: Disusun Gemini AI</span>
              </span>
            )}
          </div>

          {!hasApiKey && (
            <p className="text-xs text-slate-400">
              Tambahkan Gemini API Key di tab Profil untuk mengaktifkan penyusunan jadwal AI.
            </p>
          )}
          {hasApiKey && !isOnline && (
            <p className="text-xs text-slate-400">
              Perangkat sedang offline. Hubungkan ke internet untuk menyusun jadwal dengan AI.
            </p>
          )}

          {hasAiActive && (
            <div className="sport-subcard space-y-2 p-3">
              {st.aiSummary && <p className="text-xs leading-relaxed text-slate-300">{st.aiSummary}</p>}
              <Button variant="secondary" block={false} onClick={handleRestoreStandard} className="gap-1.5 text-xs">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                <span>Kembalikan Jadwal Standar</span>
              </Button>
            </div>
          )}

          {aiError && (
            <p role="alert" className="rounded-xl bg-coral/15 px-3 py-2 text-xs leading-relaxed text-coral">
              {aiError}
            </p>
          )}

          {aiPreview && (
            <div className="sport-subcard space-y-3 border border-sky-400/30 p-3.5" aria-live="polite">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                <span>Pratinjau Jadwal Gemini AI ({aiPreview.sessions.length} sesi)</span>
              </div>
              <p className="text-sm leading-relaxed text-slate-200">{aiPreview.summary}</p>
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {aiPreview.sessions.map((s) => (
                  <li key={s.id} className={`rounded-xl border-l-[3px] ${KIND_BORDER[s.kind]} bg-navy-900/90 p-2.5 text-xs`}>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-semibold text-slate-100">{formatDateId(s.date)}</span>
                      <span className="font-bold text-sky-300">{KIND_LABEL[s.kind]}</span>
                    </div>
                    <div className="mt-0.5 font-semibold text-slate-200">{s.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums text-slate-400">
                      {s.distanceKm != null && <span>Jarak: {s.distanceKm.toFixed(1)} km</span>}
                      {s.durationMin != null && <span>Durasi: {s.durationMin} menit</span>}
                      {s.hr && <span>HR: {s.hr[0]}–{s.hr[1]} bpm</span>}
                    </div>
                    {s.note && <p className="mt-1 text-slate-400">{s.note}</p>}
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="secondary" onClick={() => setAiPreview(null)}>Batal</Button>
                <Button onClick={handleApplyAiPlan}>Terapkan ke Jadwal</Button>
              </div>
            </div>
          )}
        </div>
      </header>

      {curriculum === 'maf' && (
        <MafCard age={profile.age} adj={mafAdj} onAdj={(a) => { setMafAdj(a); saveMafAdj(a); }} maf={maf} points={mafPts}
          maxHr={maxHr} targetDistance={profile.targetDistance} weeksRemaining={plan.weeksRemaining} />
      )}

      <section className="rounded-2xl border border-coral/40 bg-coral/5 p-4 text-sm" aria-labelledby="adaptasi-judul">
        <h3 id="adaptasi-judul" className="font-semibold">Penyesuaian terbaru dari sesi terakhir</h3>
        {calib && (
          <p className="mt-1 text-slate-200">
            <span className={badge}>Kalibrasi Tes 3K</span>{' '}
            3 km dalam {fmtHms(calib.time3kSec)} → proyeksi 5K = {fmtHms(calib.time3kSec)} × {String(TEST3K_FACTOR).replace('.', ',')} ≈ <strong>{fmtHms(calib.proj5kSec)}</strong>.
            Pace interval minggu berikutnya {fmtRangeMinMax(intervalPaceRange(calib.pace3kSecPerKm, 0.6))}.
          </p>
        )}
        {!last ? (
          <p className="mt-1 text-slate-400">Belum ada sesi tercatat. Penyesuaian otomatis aktif setelah Anda mencatat latihan.</p>
        ) : (
          <>
            <p className="mt-1 text-sm tabular-nums text-slate-400">
              {fmtDate(last.date)} · Rasio beban (ACWR) {lastIn.acwrRatio == null ? '–' : lastIn.acwrRatio.toFixed(2)}
              {' · '}Efisiensi (EF) {decision.efGainPct == null ? '–' : `${decision.efGainPct >= 0 ? '+' : ''}${decision.efGainPct.toFixed(1)}% vs rata-rata 14 hari`}
              {' · '}Drift {lastIn.lastDriftPct == null ? '–' : `${lastIn.lastDriftPct.toFixed(1)}%`}
            </p>
            {adapted.notes.length === 0 ? (
              <p className="mt-2 text-slate-300">Tidak ada penyesuaian: beban, efisiensi, dan drift dalam batas normal.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {adapted.notes.map((n, i) => (
                  <li key={i}>
                    <span className={badge}>{n.badge}</span>{' '}
                    <span className="text-xs text-slate-400">{labelOf(n.sessionId)}</span>
                    <div className="text-slate-200">{n.reason}</div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="space-y-3" aria-label="Sesi minggu ini">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setWeekIdx(wi - 1)} disabled={wi <= 0} aria-label="Minggu sebelumnya"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-navy-700 text-slate-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral">
            <ChevronLeft size={20} aria-hidden />
          </button>
          <select value={wi} onChange={(e) => setWeekIdx(Number(e.target.value))} aria-label="Pilih minggu"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-navy-700 bg-navy-900 px-3 text-sm text-slate-100 focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/40">
            {plan.weeks.map((w, i) => <option key={w.weekNo} value={i}>{weekLabel(w)}</option>)}
          </select>
          <button type="button" onClick={() => setWeekIdx(wi + 1)} disabled={wi >= plan.weeks.length - 1} aria-label="Minggu berikutnya"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-navy-700 text-slate-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral">
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>

        {week.plannedKm != null && (
          <p className="text-sm text-slate-400">
            Target volume Base minggu ini: {week.plannedKm} km (naik maks +10%/minggu).
            {startWeeklyKm < MIN_BASE_WEEKLY_KM ? ` Data 28 hari terakhir hanya ${startWeeklyKm.toFixed(1)} km/minggu, jadi volume awal dipatok minimal ${MIN_BASE_WEEKLY_KM} km. Kurangi hari latihan bila terasa berat.` : ''}
          </p>
        )}
        {weekKm > 0 && (
          <p className="text-sm tabular-nums text-slate-300">
            Total jarak lari santai + long run minggu ini: <strong>≈{weekKm.toFixed(1)} km</strong>
            {week.sessions.some((x) => x.kind === 'speed') ? ' (belum termasuk sesi Speed)' : ''}
          </p>
        )}

        {week.sessions.map((raw) => {
          const s = byId.get(raw.id) as PlanSession;
          const isDone = done.has(s.id);
          const auto = autoCompleted(s, workoutDays, todayIso);
          const gp = goalPaceFor(s);
          const status = isDone ? 'Selesai' : dayNum(s.date) < dayNum(todayIso) ? 'Terlewat' : s.date === todayIso ? 'Hari ini' : 'Mendatang';
          const statusColor = isDone ? 'text-emerald-400' : status === 'Terlewat' ? 'text-amber-400' : status === 'Hari ini' ? 'text-coral' : 'text-slate-400';
          const delta = s.paceDeltaSec ?? 0;
          const easy = s.kind === 'recovery' || s.kind === 'long';
          const calibPace = calib && test3k && s.zone === 'interval' && s.weekNo > test3k.weekNo ? intervalPaceRange(calib.pace3kSecPerKm, s.repKm) : null;
          const { min, km } = loadOf(s);
          const showName = s.name && s.kind !== 'race' && !['Easy Run', 'Long Run'].includes(s.name);
          const swapChoices = week.sessions.filter((o) => o.id !== s.id && o.kind !== 'race' && !done.has(o.id)).map((o) => byId.get(o.id) as PlanSession);
          return (
            <article key={s.id} className={`${card} border-l-[3px] ${KIND_BORDER[s.kind]} ${isDone ? 'opacity-80' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold tabular-nums">{formatDateId(s.date)}</span>
                <div className={`flex items-center gap-2 ${statusColor}`}>
                  <span className="text-sm font-semibold">{status}{auto ? ' (otomatis)' : ''}</span>
                  <button type="button" role="checkbox" aria-checked={isDone} disabled={auto} onClick={() => update(toggleDone(st, s.id))}
                    aria-label={`Tandai selesai: ${KIND_LABEL[s.kind]}`}
                    className={`flex h-11 w-11 items-center justify-center rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60 ${
                      isDone ? 'border-emerald-400 bg-emerald-400 text-navy-950' : 'border-navy-600 text-transparent'
                    }`}>
                    <Check size={22} strokeWidth={3} aria-hidden />
                  </button>
                </div>
              </div>
              <h3 className="text-base font-bold">{s.convertedFrom || s.test === 'maf' ? s.name : `${KIND_LABEL[s.kind]}${showName ? ` · ${s.name}` : ''}`}</h3>
              <p className="mt-0.5 text-sm text-slate-400">{s.zone === 'maf' ? MAF_HINT[s.kind] : KIND_HINT[s.kind]}</p>
              {s.kind === 'race' && <div className="mt-1 text-sm">{s.name}</div>}
              {easy && km != null && min != null && (
                <div className="mt-2 rounded-xl bg-navy-900 p-3 text-sm tabular-nums">
                  <div>Jarak: <strong className="text-base">{km.toFixed(1)} km</strong> <span className="text-slate-400">(≈{Math.round(min)} menit)</span></div>
                  {s.zone === 'maf' ? (
                    <>
                      {s.hr && <div>Detak jantung (utama): <strong className="text-base text-emerald-400">{s.hr[0]}–{s.hr[1]} bpm</strong></div>}
                      {mafCenter != null ? (
                        <div>Pace perkiraan: <strong className="text-base text-slate-100">{fmtRangeKm(mafCenter + delta)}</strong> <span className="text-slate-400">(ikuti detak jantung)</span></div>
                      ) : (
                        <div>Pace: <strong className="text-base text-slate-100">Sesuai HR</strong> <span className="text-slate-400">(patokan pace muncul setelah 1 sesi MAF ≥ 3 km)</span></div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>Pace: <strong className="text-base text-emerald-400">{fmtRangeKm(easyPace + delta)}</strong></div>
                      {s.hr && <div>Detak jantung: <strong className="text-base text-emerald-400">{s.hr[0]}–{s.hr[1]} bpm</strong></div>}
                    </>
                  )}
                </div>
              )}
              {!easy && s.hr && s.zone && (
                <div className="mt-2 text-sm tabular-nums">{ZONE_LABEL[s.zone]}: detak jantung <strong className="text-emerald-400">{s.hr[0]}–{s.hr[1]} bpm</strong>
                  {s.zone === 'interval' || s.zone === 'test' ? ' di akhir tiap ulangan' : ''}</div>
              )}
              {calibPace && <div className="text-sm tabular-nums">Pace ulangan (dari Tes 3K): <strong className="text-emerald-400">{fmtRangeMinMax(calibPace)}</strong></div>}
              {s.hr && (
                <p className="mt-1 text-sm text-amber-300">{s.zone === 'maf' ? MAF_RULE : HR_FIRST_RULE}{s.zone === 'easy' ? ` Jalan sampai detak jantung < ${s.hr[0]} bpm.` : ''}</p>
              )}
              {!s.hr && s.zone && <p className="mt-1 text-sm text-slate-400">{s.zone === 'maf' ? 'Isi usia di Profil untuk melihat target bpm MAF.' : 'Isi detak jantung maksimal di Profil untuk melihat target bpm.'}</p>}
              {s.kind === 'speed' && min != null && (
                <div className="mt-1 text-sm tabular-nums">Total ≈ <strong>{Math.round(min)} menit</strong> (termasuk pemanasan & pemulihan)</div>
              )}
              {s.adjDurationMin != null && s.durationMin != null && (
                <div className="text-sm tabular-nums text-coral">Durasi disesuaikan: {Math.round(s.durationMin)} → {Math.round(s.adjDurationMin)} menit</div>
              )}
              {s.demoted && <p className="text-sm text-slate-400">Speed diganti Easy Run: tidak ada hari yang tidak bersebelahan dengan Long Run.</p>}
              {(s.adjustments ?? []).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(s.adjustments ?? []).map((a) => <span key={a.code} className={badge}>{a.badge}</span>)}
                </div>
              )}
              {s.note && <p className="text-sm text-slate-400">{s.note}</p>}
              {s.steps.map((stp, j) => {
                const sec = curriculum === 'nike5k' ? paceSecPerKm(paceKeyFor(stp), row, delta) : null;
                return <div key={j} className="text-sm">{stp}{sec != null && <em className="text-emerald-400"> → {fmtKm(sec)}</em>}</div>;
              })}
              {gp != null && (s.kind === 'speed' || s.kind === 'race') && s.test !== 'maf' && (
                <div className="mt-1 text-sm tabular-nums text-slate-300">
                  {s.kind === 'race' ? 'Target pace PB' : `Pace menuju PB ${profile.targetDistance}`}: <span className="font-semibold">{fmtKm(gp)}</span>
                </div>
              )}
              {s.kind !== 'race' && (
                <details className="mt-3 rounded-xl bg-navy-900">
                  <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-slate-300">Ubah atau tukar jadwal sesi ini</summary>
                  <div className="grid grid-cols-1 gap-2 px-3 pb-3">
                    <label className="text-sm font-semibold text-slate-200">Tanggal sesi
                      <input type="date" value={s.date} max={addDays(raceIso, -1)}
                        onChange={(e) => { if (e.target.value) update(setSessionDate(st, s.id, e.target.value)); }} className={control} />
                    </label>
                    <label className="text-sm font-semibold text-slate-200">Tukar dengan sesi lain
                      <select value="" className={control}
                        onChange={(e) => { const o = swapChoices.find((x) => x.id === e.target.value); if (o) update(swapSessions(st, s, o)); }}>
                        <option value="">Pilih sesi…</option>
                        {swapChoices.map((o) => <option key={o.id} value={o.id}>{formatDayMonth(o.date)} · {KIND_LABEL[o.kind]}</option>)}
                      </select>
                    </label>
                  </div>
                </details>
              )}
            </article>
          );
        })}
      </section>

      <details className={`${card} text-sm`}>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-300">Apa itu Easy, Recovery, dan Long Run?</summary>
        <div className="mt-2 space-y-2 text-slate-300">
          <p><strong>Easy Run / Recovery Run</strong>: lari santai. Pace pelan, napas tenang, masih bisa ngobrol kalimat utuh. Fungsinya membangun daya tahan dan memulihkan kaki. Easy dan Recovery sama-sama santai, hanya beda tujuan; pace yang dipakai sama.</p>
          <p><strong>Long Run</strong>: lari paling panjang dalam seminggu, tetap pace santai. Yang dilatih daya tahan, bukan kecepatan.</p>
          <p><strong>Speed Run</strong>: sesi cepat (interval/tempo). Ada pemanasan, bagian cepat dengan pace tertentu, lalu pemulihan pelan.</p>
          <p><strong>Lari-jalan (L/J)</strong>: 6×(3' Lari / 1' Jalan) artinya lari pelan 3 menit, jalan 1 menit, diulang 6 kali. <strong>Strides</strong>: 20 detik lari cepat tapi rileks, jalan 40 detik.</p>
          <p><strong>Detak jantung dulu (HR-first)</strong>: detak jantung adalah patokan utama; pace hanya perkiraan. Di cuaca panas detak jantung naik, jadi perlambat atau jalan sampai turun.</p>
          {curriculum === 'maf' && <p><strong>Zona MAF</strong>: rentang detak jantung (HR MAF − 10 sampai HR MAF) tempat seluruh lari dilakukan. Pace adalah hasil, bukan target; yang dipantau adalah pace di detak jantung yang sama dari waktu ke waktu.</p>}
          <p className="text-xs text-slate-400">Setiap kartu menampilkan jarak (km) dan pace dalam menit per km. Pace santai ditampilkan sebagai rentang; lebih lambat sedikit tidak masalah, jangan lebih cepat.</p>
        </div>
      </details>

      {curriculum === 'progressive5k' && (
        <details className={`${card} text-sm`}>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-300">{STRENGTH_NOTE.title}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
            {STRENGTH_NOTE.moves.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p className="mt-2 text-xs text-slate-400">{STRENGTH_NOTE.how}</p>
        </details>
      )}

      {settingsSheet(missed)}
    </div>
  );
}
