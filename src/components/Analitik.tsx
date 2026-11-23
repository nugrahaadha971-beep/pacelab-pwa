import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import { acwr, DAY_MS, efficiencyFactor, type AcwrStatus } from '../analytics/workload';
import { currentVdot, PENALTY_RULES, predictAll, RACE_KM, velocityFor, ZONE_FRACTION } from '../analytics/predictor';
import { compareProgress } from '../analytics/progressSummary';
import { analyzeWorkoutPeriod } from '../analytics/sessionAnalysis';
import { parseDuration } from '../parsers/manual';
import { applyAdaptation, evaluateAdaptation, gatherAdaptiveInput } from '../plans/adaptiveEngine';
import { resolveMaxHr } from '../plans/hrZones';
import { mafHr, mafTests } from '../plans/maf';
import { fmtPace, nearestRow, paceSecPerKm } from '../plans/pace';
import { resolvePlan, selectBestPlan } from '../plans/planSelector';
import { applyScheduleState, buildPlan, completedIds, flattenPlan, isoFromLocal, isoFromRaceTs, type PlanSession } from '../plans/schedule';
import { loadMafAdj, loadPlanMode, loadScheduleState } from '../plans/scheduleStore';
import { fmtHms, todayStr } from './format';
import { weeklyKm } from './historyFilter';
import AcwrGauge from './AcwrGauge';
import { ZonaPaceCard } from './CoachCard';
import { KpiTile, ScreenHeader, SegmentedTabs, StatusPill } from './ui';
import type { Tone } from './ui';
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

const ACWR_PILL: Record<AcwrStatus, { tone: Exclude<Tone, 'neutral'>; label: string }> = {
  unknown: { tone: 'info', label: 'Belum cukup data' },
  undertraining: { tone: 'info', label: 'Ringan' },
  sweet_spot: { tone: 'good', label: 'Aman' },
  high_fatigue: { tone: 'bad', label: 'Terlalu Berat' },
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sport-card p-4">
      <h2 className="mb-3 font-display text-sm font-bold text-slate-200">{title}</h2>
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
    <p className={`mb-3 rounded-xl border px-3 py-2 text-xs leading-relaxed ${CALLOUT_STYLE[tone]}`}>
      {text}
    </p>
  );
}

type View = 'ringkasan' | 'grafik' | 'sesi';
const VIEW_TABS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'grafik', label: 'Grafik' },
  { id: 'sesi', label: 'Per Sesi' },
];

type ChartKind = 'pace' | 'ef' | 'acwr' | 'weekly';
const CHART_TABS: ReadonlyArray<{ id: ChartKind; label: string }> = [
  { id: 'pace', label: 'Pace Santai' },
  { id: 'ef', label: 'Efisiensi (EF)' },
  { id: 'acwr', label: 'Beban (ACWR)' },
  { id: 'weekly', label: 'Volume Mingguan' },
];

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
  const [chartKind, setChartKind] = useState<ChartKind>('pace');
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
  const trend = progress.series.map((p) => ({ d: short(p.date), pace: p.easyPaceSec }));
  const hasPace = trend.some((p) => p.pace != null);
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
  const driftNote = `Drift: ${drift == null ? '–' : `${dec(drift)}%`}`;
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
  const acwrPill = ACWR_PILL[gauge.status];

  const loadAdvice = gauge.status === 'high_fatigue'
    ? 'Beban latihan sedang terlalu berat—kurangi intensitas atau ambil istirahat agar terhindar dari cedera.'
    : gauge.status === 'undertraining'
      ? 'Beban masih ringan; kamu bisa menambah porsi lari santai bertahap sambil menjaga prinsip 80/20.'
      : gauge.status === 'sweet_spot'
        ? progress.intensityNote
        : 'Catat beberapa sesi lari lagi agar rasio beban tubuh dan komposisi intensitas terbaca.';

  // ── Kesimpulan bahasa sehari-hari 1 kalimat di atas setiap grafik ────────
  const acwrChartSummary: { tone: 'good' | 'warn' | 'info'; text: string } =
    gauge.status === 'sweet_spot'
      ? { tone: 'good', text: 'Beban latihanmu saat ini berada di zona aman (0,8–1,3), sehingga tubuh beradaptasi dengan baik tanpa kelelahan berlebih.' }
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
      ) : view === 'grafik' ? (
        <div className="space-y-3">
          <div role="group" aria-label="Pilih grafik" className="flex flex-wrap gap-1.5">
            {CHART_TABS.map((t) => {
              const active = chartKind === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setChartKind(t.id)}
                  className={`min-h-[38px] rounded-full border px-3.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                    active
                      ? 'border-volt bg-volt text-[#070709]'
                      : 'border-white/10 bg-[#191B22] text-slate-300 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <Card title={CHART_TABS.find((t) => t.id === chartKind)?.label ?? 'Grafik'}>
            {chartKind === 'pace' && (
              <>
                <ChartSummary tone={paceChartSummary.tone} text={paceChartSummary.text} />
                {hasPace ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={trend}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="d" {...axis} minTickGap={24} />
                      <YAxis {...axis} width={40} reversed domain={['auto', 'auto']} tickFormatter={(v: number) => fmtPace(v)} />
                      <Tooltip {...tip} formatter={(v) => [`${fmtPace(Number(v))} /km`, 'Pace santai']} />
                      <Line dataKey="pace" stroke="#38BDF8" dot={{ r: 3, fill: '#38BDF8' }} connectNulls strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-10 text-center text-sm text-slate-400">Belum ada sesi easy atau long run dalam rentang ini.</p>
                )}
              </>
            )}

            {chartKind === 'ef' && (
              <>
                <ChartSummary tone={efChartSummary.tone} text={efChartSummary.text} />
                {efData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={efData}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="d" {...axis} minTickGap={24} />
                      <YAxis {...axis} width={36} domain={['auto', 'auto']} />
                      <Tooltip {...tip} formatter={(v) => [dec(Number(v), 2), 'Efisiensi (EF)']} />
                      <Line dataKey="ef" stroke="#C8FF00" dot={{ r: 3, fill: '#C8FF00' }} connectNulls strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-10 text-center text-sm text-slate-400">Belum ada sesi easy atau long run dengan data detak jantung.</p>
                )}
              </>
            )}

            {chartKind === 'acwr' && (
              <>
                <ChartSummary tone={acwrChartSummary.tone} text={acwrChartSummary.text} />
                {hasSessions ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={acwrData}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <ReferenceArea y1={0.8} y2={1.3} fill="#C8FF00" fillOpacity={0.08} />
                      <XAxis dataKey="d" {...axis} minTickGap={24} />
                      <YAxis domain={[0, acwrMax]} {...axis} width={28} />
                      <Tooltip {...tip} formatter={(v) => [dec(Number(v), 2), 'Rasio Beban (ACWR)']} />
                      <Line dataKey="acwr" stroke="#C8FF00" dot={false} connectNulls strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-10 text-center text-sm text-slate-400">Belum ada sesi dalam {days} hari terakhir untuk grafik beban.</p>
                )}
              </>
            )}

            {chartKind === 'weekly' && (
              <>
                <ChartSummary tone={weeklyChartSummary.tone} text={weeklyChartSummary.text} />
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={weekly}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis {...axis} width={28} />
                    <Tooltip {...tip} formatter={(v) => [`${dec(Number(v), 1)} km`, 'Volume']} />
                    <Bar dataKey="km" fill="#C8FF00" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Kartu 1 — Perkembangan Utama */}
          <Card title="Perkembangan Utama">
            <div className={`rounded-2xl border border-white/[0.08] border-l-4 bg-[#191B22] px-3.5 py-3 text-sm font-medium text-slate-100 ${improving ? 'border-l-[#C8FF00]' : 'border-l-[#38BDF8]'}`}>
              {hasSessions
                ? progress.headline
                : `Belum ada sesi dalam ${days} hari terakhir. Ketuk tombol + di bawah untuk mencatat sesi.`}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <KpiTile label="Jarak" value={dec(cur.totalKm)} unit="km" context={kmNote} tone="info" />
              <KpiTile label="Pace Santai" value={cur.easyAvgPaceSec != null ? fmtPace(cur.easyAvgPaceSec) : '–'} unit="/km" context={paceNote} tone={paceTone} />
              <KpiTile label="Efisiensi Jantung" value={cur.avgEf != null ? dec(cur.avgEf, 2) : '–'} context={efNote} tone={efTone} />
              <KpiTile label="Kadens" value={cur.avgCadence != null ? Math.round(cur.avgCadence) : '–'} unit="spm" context={driftNote} tone={driftTone} />
            </div>

            <details className="group mt-3 rounded-2xl border border-white/[0.08] bg-[#191B22]/70">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-semibold text-slate-300">
                <span>Apa arti metrik ini?</span>
                <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-2 border-t border-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-slate-300">
                {real.length > 0 && (
                  <p>
                    <strong className="text-slate-100">Dibanding {days} hari lalu:</strong> {real.join(' · ')}.
                  </p>
                )}
                <p>
                  <strong className="text-slate-100">Efisiensi Jantung (EF):</strong> rasio kecepatan lari terhadap detak jantung. Makin tinggi berarti jantung makin hemat tenaga.
                </p>
                <p>
                  <strong className="text-slate-100">Cardiac Drift:</strong> kenaikan detak jantung di paruh akhir lari; di bawah 5% menandakan fondasi aerobik baik.
                </p>
              </div>
            </details>
          </Card>

          {/* Kartu 2 — Kondisi Beban & Intensitas */}
          <Card title="Kondisi Beban & Intensitas">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-400">Rasio Beban Tubuh (ACWR)</span>
              <StatusPill tone={acwrPill.tone}>{acwrPill.label}</StatusPill>
            </div>
            <div className="mt-2">
              <AcwrGauge ratio={gauge.ratio} status={gauge.status} />
            </div>

            <div className="mt-4 border-t border-white/[0.08] pt-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Prinsip 80/20</span>
                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-white/10" role="img"
                aria-label={easy == null ? 'Belum ada data' : `Lari santai ${Math.round(easy)} persen, lari cepat ${Math.round(quality ?? 0)} persen`}>
                {easy != null && <div className="bg-sky-400" style={{ width: `${easy}%` }} />}
                {quality != null && <div className="bg-coral" style={{ width: `${quality}%` }} />}
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-sky-300">● Santai <strong className="font-mono">{easy == null ? '–' : `${Math.round(easy)}%`}</strong></span>
                <span className="text-coral">● Cepat <strong className="font-mono">{quality == null ? '–' : `${Math.round(quality)}%`}</strong></span>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-slate-300">{loadAdvice}</p>
            </div>
          </Card>

          {/* Kartu 3 — Rekor & Prediksi Lomba */}
          <Card title="Rekor & Prediksi Lomba">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="sport-subcard p-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Terpanjang</div>
                <div className="mt-1 font-mono text-base font-extrabold text-white">
                  {dec(cur.longestKm)}<span className="ml-0.5 font-sans text-xs font-semibold text-slate-400"> km</span>
                </div>
              </div>
              <div className="sport-subcard p-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tercepat</div>
                <div className="mt-1 font-mono text-base font-extrabold text-white">
                  {cur.bestPaceSec != null ? fmtPace(cur.bestPaceSec) : '–'}<span className="ml-0.5 font-sans text-xs font-semibold text-slate-400"> /km</span>
                </div>
              </div>
              <div className="sport-subcard p-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Frekuensi</div>
                <div className="mt-1 font-mono text-base font-extrabold text-white">
                  {dec(cur.sessionsPerWeek)}<span className="ml-0.5 font-sans text-xs font-semibold text-slate-400"> /mgg</span>
                </div>
              </div>
            </div>

            <div className="mt-3 divide-y divide-white/[0.06]">
              {dists.map((d) => {
                const p = preds[d];
                return (
                  <div key={d} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-slate-400">{d}</span>
                    <span className="font-mono font-bold text-white">{p ? fmtHms(p.finalSec) : '–'}</span>
                  </div>
                );
              })}
            </div>

            <details className="group mt-3 rounded-2xl border border-white/[0.08] bg-[#191B22]/70">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-semibold text-slate-300">
                <span>Lihat zona pace &amp; HR</span>
                <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t border-white/[0.06] p-2.5">
                {vd != null ? (
                  <ZonaPaceCard vdot={vd} maxHr={maxHr} />
                ) : (
                  <p className="p-2 text-xs text-slate-400">Catat minimal 1 sesi lari ≥ 3 km untuk menghitung zona pace dan detak jantung.</p>
                )}
              </div>
            </details>
          </Card>
        </div>
      )}
    </div>
  );
}
