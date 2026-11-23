import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import { acwr, DAY_MS, efficiencyFactor } from '../analytics/workload';
import { currentVdot, PENALTY_RULES, predictAll, RACE_KM, velocityFor, ZONE_FRACTION } from '../analytics/predictor';
import { compareProgress } from '../analytics/progressSummary';
import { analyzeWorkoutPeriod, type SessionVerdictStatus } from '../analytics/sessionAnalysis';
import { parseDuration } from '../parsers/manual';
import { applyAdaptation, evaluateAdaptation, gatherAdaptiveInput } from '../plans/adaptiveEngine';
import { resolveMaxHr } from '../plans/hrZones';
import { mafHr, mafTests } from '../plans/maf';
import { fmtPace, nearestRow, paceSecPerKm } from '../plans/pace';
import { resolvePlan, selectBestPlan } from '../plans/planSelector';
import { applyScheduleState, buildPlan, completedIds, flattenPlan, isoFromLocal, isoFromRaceTs, type PlanSession } from '../plans/schedule';
import { loadMafAdj, loadPlanMode, loadScheduleState } from '../plans/scheduleStore';
import { fmtDate, fmtHms, todayStr } from './format';
import { weeklyKm } from './historyFilter';
import AcwrGauge from './AcwrGauge';
import { ZonaPaceCard } from './CoachCard';
import { KpiTile, ScreenHeader, SegmentedTabs, StatusPill, type Tone } from './ui';
import SessionAnalysisTab from './SessionAnalysisTab';

const RANGES = [7, 28, 90] as const;
type Range = (typeof RANGES)[number];
const tip = {
  contentStyle: {
    background: '#111216',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    color: '#f4f5f7',
    fontSize: 12,
  },
};
const axis = { stroke: '#64748b', fontSize: 11, tickLine: false };
const short = (ts: number) => new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

/** Angka desimal gaya Indonesia: 12,3 (koma). */
const dec = (x: number, digits = 1) => x.toFixed(digits).replace('.', ',');
/** Selisih bertanda: +4,5 / -2,1. */
const signed = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${dec(Math.abs(x), digits)}`;

const INTENSITY_PILL: Record<'insufficient' | 'balanced' | 'too_hard' | 'base_building', { tone: 'good' | 'warn' | 'info'; label: string }> = {
  insufficient: { tone: 'info', label: 'Data belum cukup' },
  balanced: { tone: 'good', label: 'Seimbang' },
  too_hard: { tone: 'warn', label: 'Terlalu banyak lari cepat' },
  base_building: { tone: 'info', label: 'Fondasi aerobik' },
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sport-card p-4">
      <h2 className="mb-2 font-display text-sm font-bold text-slate-200">{title}</h2>
      {children}
    </section>
  );
}

const CALLOUT_STYLE: Record<'good' | 'warn' | 'info', string> = {
  good: 'border-volt/25 bg-volt/[0.07] text-slate-100',
  warn: 'border-coral/35 bg-coral/[0.08] text-orange-100',
  info: 'border-white/10 bg-[#191B22] text-slate-200',
};

function ChartSummary({ tone = 'info', text }: { tone?: 'good' | 'warn' | 'info'; text: string }) {
  return (
    <p className={`mb-2.5 rounded-xl border px-3 py-2 text-xs leading-relaxed ${CALLOUT_STYLE[tone]}`}>
      {text}
    </p>
  );
}

type View = 'ringkasan' | 'sesi';
const VIEW_TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'sesi', label: 'Per Sesi' },
];
const VERDICT_TONE: Record<SessionVerdictStatus, Exclude<Tone, 'neutral'>> = {
  optimal: 'good', caution: 'warn', off_target: 'bad', incomplete: 'info',
};

/**
 * Konteks program untuk analisis sesi. Logikanya sama dengan Beranda (nextSession) dan Saran Pelatih,
 * sehingga sesi yang dianalisis cocok dengan jadwal yang dilihat pengguna.
 */
function programContextFor(profile: UserProfile, workouts: Workout[], now: number, preds: ReturnType<typeof predictAll>) {
  const todayIso = todayStr();
  const selection = selectBestPlan(workouts, profile, { now, projected5kSec: preds['5K']?.finalSec ?? null });
  const curriculum = resolvePlan(loadPlanMode(), selection);
  const mafAdjustment = loadMafAdj();
  const maf = curriculum === 'maf' ? mafHr(profile.age, mafAdjustment) : null;
  const mafPts = curriculum === 'maf' ? mafTests(workouts, maf) : [];
  // Patokan pace MAF hanya dari catatan MAF sendiri. Tanpa catatan → null; tidak pernah jatuh ke pace VDOT.
  const mafPaceSecPerKm = mafPts.length ? mafPts[mafPts.length - 1].paceSecPerKm : null;

  const vd = currentVdot(workouts, now);
  const easyVdot = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;
  let saved: string | null = null;
  try { saved = localStorage.getItem('pacelab.k5'); } catch { /* penyimpanan tidak tersedia */ }
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
      raceIso, todayIso, days: st.days, raceName: `${profile.targetDistance} · Hari Lomba / Uji PB`,
      startWeeklyKm, maxWeeklyKm, easyPaceSecPerKm: easyPace, curriculum, maxHr, mafHr: maf,
    });
    const flat = flattenPlan(applyScheduleState(base, st, raceIso));
    const done = completedIds(flat, new Set(workouts.map((w) => isoFromLocal(w.date))), st, todayIso);
    const decision = evaluateAdaptation(gatherAdaptiveInput(workouts, profile, now).input);
    plannedSessions = applyAdaptation(flat, decision, todayIso, done, maxHr).sessions;
  }

  return {
    curriculum,
    mafAdjustment,
    easyPaceSecPerKm: curriculum === 'maf' ? null : easyPace,
    mafPaceSecPerKm,
    plannedSessions,
  };
}

export default function Analitik({ profile, workouts }: { profile: UserProfile; workouts: Workout[] }) {
  const [days, setDays] = useState<Range>(28);
  const [view, setView] = useState<View>('ringkasan');
  const now = Date.now();
  const progress = compareProgress(workouts, now, days);
  const { current: cur } = progress;
  const hasSessions = cur.sessions > 0;
  const gauge = acwr(workouts, profile, now);
  const acwrData = Array.from({ length: days }, (_, i) => {
    const ts = now - (days - 1 - i) * DAY_MS;
    return { d: short(ts), acwr: acwr(workouts, profile, ts).ratio };
  });
  const acwrMax = Math.max(2, Math.ceil(Math.max(0, ...acwrData.map((d) => d.acwr ?? 0)) * 2) / 2);
  const inRange = workouts.filter((w) => w.date <= now && now - w.date <= days * DAY_MS);
  const efData = inRange
    .filter((w) => w.workoutType === 'easy' || w.workoutType === 'long_run')
    .sort((a, b) => a.date - b.date)
    .map((w) => ({ d: short(w.date), ef: w.efficiencyFactor ?? efficiencyFactor(w) }));
  const trend = progress.series.map((p) => ({ d: short(p.date), pace: p.easyPaceSec, vdot: p.vdotScore }));
  const hasPace = trend.some((p) => p.pace != null);
  const hasVdot = trend.some((p) => p.vdot != null);
  const weekly = weeklyKm(workouts, now, Math.max(1, Math.round(days / 7)));
  const preds = predictAll(workouts, now);
  const program = programContextFor(profile, workouts, now, preds);
  const period = analyzeWorkoutPeriod(workouts, now, days, {
    profile,
    curriculum: program.curriculum,
    mafAdjustment: program.mafAdjustment,
    easyPaceSecPerKm: program.easyPaceSecPerKm,
    mafPaceSecPerKm: program.mafPaceSecPerKm,
    plannedSessions: program.plannedSessions,
  });
  const latest = period.items[0];
  const dists = Object.keys(RACE_KM) as RaceDistance[];
  const vd = currentVdot(workouts, now);
  const maxHr = resolveMaxHr(profile, workouts);

  // ── Catatan perubahan pada ubin KPI ──────────────────────────────────────
  const ago = `${days} hr lalu`;
  const none = 'Belum ada pembanding';
  const kmNote = progress.kmDeltaPct == null ? none
    : Math.round(progress.kmDeltaPct) === 0 ? `Sama seperti ${ago}`
    : `${progress.kmDeltaPct > 0 ? '▲' : '▼'} ${signed(Math.round(progress.kmDeltaPct), 0)}% vs ${ago}`;

  const pd = progress.easyPaceDeltaSec;
  const paceNote = pd == null ? none : Math.abs(pd) < 1 ? 'Stabil' : `${pd < 0 ? 'Lebih cepat' : 'Lebih lambat'} ${Math.abs(Math.round(pd))} dtk/km`;
  const paceTone: Tone = pd != null && pd <= -1 ? 'good' : 'neutral';

  const ed = progress.efDeltaPct;
  const efNote = ed == null ? none : `${ed >= 0 ? '▲' : '▼'} ${signed(ed)}%`;
  const efTone: Tone = ed == null ? 'neutral' : ed >= 2 ? 'good' : ed <= -3 ? 'warn' : 'neutral';

  const drift = cur.avgDriftPct;
  const driftNote = `Cardiac drift: ${drift == null ? '–' : `${dec(drift)}%`}`;
  const driftTone: Tone = drift == null ? 'neutral' : drift > 5 ? 'warn' : 'good';

  const improving = (ed ?? 0) >= 2 || (pd ?? 0) <= -4 || (progress.kmDeltaPct ?? 0) >= 10;

  // Terjemahan EF ke angka nyata: selisih pace santai dan detak jantung rata-rata.
  const real: string[] = [];
  if (pd != null) real.push(Math.abs(pd) < 1 ? 'pace santai stabil' : `pace santai ${pd < 0 ? 'lebih cepat' : 'lebih lambat'} ${Math.abs(Math.round(pd))} dtk/km`);
  if (progress.hrDeltaBpm != null) {
    const h = Math.round(progress.hrDeltaBpm);
    real.push(h === 0 ? 'detak jantung rata-rata sama' : `detak jantung rata-rata ${h < 0 ? 'turun' : 'naik'} ${Math.abs(h)} bpm`);
  }

  const easy = cur.easySharePct;
  const quality = cur.qualitySharePct;
  const pill = INTENSITY_PILL[progress.intensityStatus];

  // ── Kesimpulan bahasa sehari-hari 1 kalimat di atas setiap grafik ────────
  const acwrChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    gauge.status === 'sweet_spot'
      ? { tone: 'good', text: 'Beban latihanmu saat ini berada di zona aman, sehingga tubuh beradaptasi dengan baik tanpa kelelahan berlebih.' }
      : gauge.status === 'high_fatigue'
        ? { tone: 'warn', text: 'Beban latihanmu sedang terlalu tinggi—kurangi intensitas atau ambil istirahat agar terhindar dari cedera.' }
        : gauge.status === 'undertraining'
          ? { tone: 'info', text: 'Beban latihanmu saat ini tergolong ringan, jadi masih ada ruang untuk menambah durasi lari santai secara bertahap.' }
          : { tone: 'info', text: 'Catat beberapa sesi lari lagi agar grafik kondisi beban tubuhmu mulai terbentuk.' };

  const paceChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    !hasPace
      ? { tone: 'info', text: 'Belum ada sesi lari santai (easy/long run) pada rentang ini untuk melihat tren kecepatan.' }
      : pd != null && pd <= -3
        ? { tone: 'good', text: 'Lari santaimu kini lebih cepat dibanding sebelumnya—tanda daya tahan tubuhmu sedang meningkat.' }
        : pd != null && pd >= 3
          ? { tone: 'info', text: 'Pace lari santaimu sedikit melambat; ini wajar bila kamu menjaga detak jantung tetap rendah atau saat cuaca panas.' }
          : { tone: 'info', text: 'Kecepatan lari santaimu terjaga stabil sepanjang periode ini.' };

  const vdotPts = trend.map((p) => p.vdot).filter((v): v is number => v != null);
  const vdotDelta = vdotPts.length >= 2 ? vdotPts[vdotPts.length - 1] - vdotPts[0] : null;
  const vdotChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    !hasVdot
      ? { tone: 'info', text: 'Catat minimal satu sesi lari 3 km atau lebih untuk melihat perkembangan skor kebugaranmu.' }
      : vdotDelta == null
        ? { tone: 'info', text: 'Baru ada 1 sesi di atas 3 km; tambah beberapa sesi lagi untuk melihat apakah kebugaranmu sedang naik.' }
        : vdotDelta >= 0.5
          ? { tone: 'good', text: 'Kebugaran larimu sedang meningkat—tubuhmu mampu berlari lebih cepat dengan jarak yang sama.' }
          : vdotDelta <= -0.5
            ? { tone: 'info', text: 'Angka terlihat turun karena kamu lebih banyak lari santai akhir-akhir ini, bukan berarti kebugaranmu menurun.' }
            : { tone: 'info', text: 'Skor kebugaran larimu terjaga konsisten sepanjang periode ini.' };

  const efChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    efData.length === 0
      ? { tone: 'info', text: 'Lari santai dengan sensor detak jantung dibutuhkan agar efisiensi jantungmu bisa dipantau.' }
      : ed != null && ed >= 2
        ? { tone: 'good', text: 'Efisiensi jantungmu membaik—kamu bisa berlari sama cepat atau lebih cepat dengan detak jantung lebih hemat.' }
        : ed != null && ed <= -3
          ? { tone: 'warn', text: 'Jantung bekerja sedikit lebih keras dari biasanya, kemungkinan karena kurang pulih, kurang tidur, atau cuaca panas.' }
          : { tone: 'info', text: 'Efisiensi jantungmu stabil, menandakan tubuhmu beradaptasi dengan baik pada porsi latihan sekarang.' };

  const kmDelta = progress.kmDeltaPct;
  const weeklyChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    weekly.every((w) => w.km === 0)
      ? { tone: 'info', text: 'Belum ada jarak lari yang tercatat pada rentang waktu ini.' }
      : kmDelta != null && kmDelta >= 15
        ? { tone: 'warn', text: 'Total jarak mingguanmu naik cukup cepat—pastikan tetap menyelipkan hari santai agar otot dan sendi tidak kaget.' }
        : kmDelta != null && kmDelta <= -15
          ? { tone: 'info', text: 'Jarak mingguanmu sedang lebih ringan dari periode lalu, bagus untuk memberi waktu tubuh memulihkan tenaga.' }
          : { tone: 'good', text: 'Total jarak lari mingguanmu berjalan konsisten, kebiasaan baik untuk membangun daya tahan jangka panjang.' };

  return (
    <div className="space-y-4">
      <ScreenHeader title="Analitik" subtitle="Perkembangan kebugaran & beban latihan" />

      <div role="group" aria-label="Rentang waktu" className="grid grid-cols-3 gap-1 rounded-full border border-white/[0.08] bg-[#111216] p-1">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}
            className={`min-h-[40px] rounded-full font-display text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
              days === r ? 'bg-volt text-[#070709]' : 'text-slate-400 hover:text-slate-200'
            }`}>
            {r} Hari
          </button>
        ))}
      </div>

      <SegmentedTabs idBase="analitik" label="Tampilan analitik" tabs={VIEW_TABS} value={view} onChange={setView} />

      {view === 'sesi' ? (
        <SessionAnalysisTab days={days} curriculum={program.curriculum} items={period.items} summary={period.summary} />
      ) : (
        <>
      {!hasSessions ? (
        <p className="rounded-3xl border border-white/[0.08] bg-[#111216] p-6 text-center text-sm text-slate-400">
          Belum ada sesi dalam {days} hari terakhir. Ketuk tombol <strong className="text-volt">+</strong> di bawah untuk mencatat sesi.
        </p>
      ) : (
        <>
          {latest && (
            <Card title={`Evaluasi sesi terakhir · ${fmtDate(latest.workout.date)}`}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={VERDICT_TONE[latest.status]}>{latest.verdictLabel}</StatusPill>
                <span className="text-xs tabular-nums text-slate-400">{dec(latest.workout.distanceKm, 1)} km · {latest.targetZoneLabel}</span>
              </div>
              <p className="mt-2 text-sm text-slate-100">{latest.summary}</p>
              <p className="mt-2 text-xs text-slate-300"><strong className="text-volt">Saran berikutnya:</strong> {latest.nextAction}</p>
              <p className="mt-2 text-xs text-slate-400">Rincian pemeriksaan semua sesi ada di tab Per Sesi.</p>
            </Card>
          )}

          {/* Kartu 1 — Ringkasan Perkembangan */}
          <Card title={`Ringkasan perkembangan · ${days} hari`}>
            <div className={`sport-subcard border p-3.5 text-sm font-medium text-slate-100 ${improving ? 'border-volt/30' : 'border-white/[0.08]'}`}>
              {progress.headline}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <KpiTile label="Jarak periode" value={dec(cur.totalKm)} unit="km" context={kmNote} tone="info" />
              <KpiTile label="Pace lari santai" value={cur.easyAvgPaceSec != null ? fmtPace(cur.easyAvgPaceSec) : '–'} unit="/km" context={paceNote} tone={paceTone} />
              <KpiTile label="Efisiensi jantung" term="EF" value={cur.avgEf != null ? dec(cur.avgEf, 2) : '–'} context={efNote} tone={efTone} />
              <KpiTile label="Kadens langkah" value={cur.avgCadence != null ? Math.round(cur.avgCadence) : '–'} unit="spm" context={driftNote} tone={driftTone} />
            </div>
            {real.length > 0 && (
              <p className="mt-3 text-sm text-slate-300">
                <span className="font-semibold text-slate-100">Dalam angka nyata (vs {days} hari sebelumnya): </span>
                {real.join(' · ')}.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Efisiensi jantung (EF) mengukur seberapa cepat kamu berlari tiap detak jantung—makin tinggi, tubuh makin hemat energi.
              Pergeseran detak jantung (cardiac drift) di atas 5% berarti detak jantung terus naik walau kecepatanmu tetap sama.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Pace lari santai = rata-rata seluruh sesi easy dan long run pada periode ini, tanpa filter batas detak jantung MAF. Di mode MAF, pace pada detak jantung yang sama ada di kartu Zona MAF.
            </p>
          </Card>

          {/* Kartu 2 — Keseimbangan Intensitas */}
          <Card title="Keseimbangan intensitas (Prinsip 80/20)">
            <div className="mb-2"><StatusPill tone={pill.tone}>{pill.label}</StatusPill></div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-navy-700" role="img"
              aria-label={easy == null ? 'Belum ada data' : `Lari santai ${Math.round(easy)} persen, lari cepat ${Math.round(quality ?? 0)} persen`}>
              {easy != null && <div className="bg-sky-400" style={{ width: `${easy}%` }} />}
              {quality != null && <div className="bg-coral" style={{ width: `${quality}%` }} />}
            </div>
            <div className="mt-2 flex justify-between text-sm tabular-nums">
              <span className="text-sky-300">● Lari santai {easy == null ? '–' : `${Math.round(easy)}%`}</span>
              <span className="text-coral">● Lari cepat {quality == null ? '–' : `${Math.round(quality)}%`}</span>
            </div>
            <p className="mt-2 text-sm text-slate-300">{progress.intensityNote}</p>
          </Card>
        </>
      )}

      {/* Kartu 3 — Kondisi Beban Tubuh */}
      <Card title="Kondisi beban tubuh (ACWR)">
        <AcwrGauge ratio={gauge.ratio} status={gauge.status} />
        <p className="mt-2 text-center text-sm tabular-nums text-slate-400">
          Poin Usaha 7 hari {Math.round(gauge.acute)} · Rata-rata mingguan sebelumnya {Math.round(gauge.chronicWeekly)}
        </p>
        <p className="mt-1 text-center text-xs text-slate-400">Rentang 0,8–1,3 berarti Aman. Di bawah 0,8 beban ringan; di atas 1,3 terlalu berat.</p>
        {hasSessions && (
          <div className="mt-3">
            <ChartSummary tone={acwrChartSummary.tone} text={acwrChartSummary.text} />
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={acwrData}>
                <CartesianGrid stroke="#272A35" vertical={false} />
                <ReferenceArea y1={0.8} y2={1.3} fill="#C8FF00" fillOpacity={0.09} />
                <XAxis dataKey="d" hide />
                <YAxis domain={[0, acwrMax]} {...axis} width={28} />
                <Tooltip {...tip} />
                <Line dataKey="acwr" stroke="#C8FF00" dot={false} connectNulls strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-1 text-xs text-slate-400">Area Volt Lime (0,8–1,3) adalah rentang aman. Garis di dalam area itu berarti beban seimbang.</p>
          </div>
        )}
      </Card>

      {hasSessions && (
        <>
          {/* Kartu 4 — Tren Pace Santai & Skor Kebugaran Lari */}
          <Card title="Tren pace lari santai & skor kebugaran lari">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Pace lari santai (menit/km)</h3>
            <ChartSummary tone={paceChartSummary.tone} text={paceChartSummary.text} />
            {hasPace ? (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={trend}>
                    <CartesianGrid stroke="#272A35" vertical={false} />
                    <XAxis dataKey="d" {...axis} minTickGap={24} />
                    <YAxis {...axis} width={40} reversed domain={['auto', 'auto']} tickFormatter={(v: number) => fmtPace(v)} />
                    <Tooltip {...tip} formatter={(v) => [`${fmtPace(Number(v))} /km`, 'Pace santai']} />
                    <Line dataKey="pace" stroke="#38bdf8" dot={{ r: 3 }} connectNulls strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="mt-1 text-xs text-slate-400">Kurva naik berarti lari santai makin cepat.</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-400">Belum ada sesi easy atau long run dalam rentang ini.</p>
            )}
            <h3 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-slate-400">Skor kebugaran lari <span className="font-medium normal-case tracking-normal">(VDOT)</span></h3>
            <ChartSummary tone={vdotChartSummary.tone} text={vdotChartSummary.text} />
            {hasVdot ? (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={trend}>
                    <CartesianGrid stroke="#272A35" vertical={false} />
                    <XAxis dataKey="d" {...axis} minTickGap={24} />
                    <YAxis {...axis} width={32} domain={['auto', 'auto']} />
                    <Tooltip {...tip} formatter={(v) => [dec(Number(v)), 'Skor Kebugaran (VDOT)']} />
                    <Line dataKey="vdot" stroke="#C8FF00" dot={{ r: 3 }} connectNulls strokeWidth={2.5} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="mt-1 text-xs text-slate-400">
                  Dihitung dari tiap sesi ≥ 3 km. Sesi santai menghasilkan skor lebih rendah daripada sesi cepat atau lomba, jadi lihat arah tren, bukan satu angka.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-400">Belum ada sesi ≥ 3 km dalam rentang ini.</p>
            )}
          </Card>

          <Card title={`Efisiensi jantung (EF) · ${days} hari`}>
            <ChartSummary tone={efChartSummary.tone} text={efChartSummary.text} />
            {efData.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada sesi easy atau long run dalam rentang ini.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={efData}>
                  <CartesianGrid stroke="#272A35" vertical={false} />
                  <XAxis dataKey="d" {...axis} minTickGap={24} />
                  <YAxis {...axis} width={36} domain={['auto', 'auto']} />
                  <Tooltip {...tip} />
                  <Line dataKey="ef" stroke="#C8FF00" dot={{ r: 3 }} connectNulls strokeWidth={2.5} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Volume mingguan (km)">
            <ChartSummary tone={weeklyChartSummary.tone} text={weeklyChartSummary.text} />
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={weekly}>
                <CartesianGrid stroke="#272A35" vertical={false} />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} width={28} />
                <Tooltip {...tip} />
                <Bar dataKey="km" fill="#C8FF00" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Kartu 5 — Pencapaian Periode */}
          <Card title={`Pencapaian · ${days} hari`}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="sport-subcard p-2.5">
                <div className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">Lari terpanjang</div>
                <div className="mt-1 font-mono text-lg font-extrabold tabular-nums text-white">{dec(cur.longestKm)}<span className="ml-0.5 font-sans text-xs font-bold text-slate-400"> km</span></div>
              </div>
              <div className="sport-subcard p-2.5">
                <div className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">Pace tercepat</div>
                <div className="mt-1 font-mono text-lg font-extrabold tabular-nums text-white">{cur.bestPaceSec != null ? fmtPace(cur.bestPaceSec) : '–'}<span className="ml-0.5 font-sans text-xs font-bold text-slate-400"> /km</span></div>
              </div>
              <div className="sport-subcard p-2.5">
                <div className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">Frekuensi</div>
                <div className="mt-1 font-mono text-lg font-extrabold tabular-nums text-white">{dec(cur.sessionsPerWeek)}<span className="ml-0.5 font-sans text-xs font-bold text-slate-400"> sesi/mgg</span></div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Kartu 6 — Zona Pace & Prediksi Lomba */}
      {vd != null && <ZonaPaceCard vdot={vd} maxHr={maxHr} />}

      <Card title="Perkiraan waktu lomba (Riegel)">
        <p className="mb-2 text-xs text-slate-400">
          Estimasi waktu finis tiap jarak lomba berdasarkan kecepatan terbaikmu belakangan ini dan kecukupan jarak latihanmu.
        </p>
        <div className="divide-y divide-navy-700 tabular-nums">
          {dists.map((d) => {
            const p = preds[d];
            return (
              <div key={d} className="flex justify-between py-2 text-sm">
                <span className="text-slate-400">{d}</span>
                <span className="font-semibold">{p ? fmtHms(p.finalSec) : '–'}</span>
              </div>
            );
          })}
        </div>
      </Card>
        </>
      )}
    </div>
  );
}
