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
const tip = { contentStyle: { background: '#101829', border: '1px solid #243456', color: '#e2e8f0', fontSize: 12 } };
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

  return (
    <div className="space-y-4">
      <ScreenHeader title="Analitik" subtitle="Perkembangan kebugaran & beban latihan" />

      <div role="group" aria-label="Rentang waktu" className="grid grid-cols-3 gap-1 rounded-2xl border border-white/[0.07] bg-navy-900 p-1">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}
            className={`min-h-[44px] rounded-xl font-display text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral ${
              days === r ? 'bg-navy-700 text-white' : 'text-slate-400'
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
        <p className="rounded-xl bg-navy-800 p-6 text-center text-sm text-slate-400">
          Belum ada sesi dalam {days} hari terakhir. Ketuk tombol + di pojok kanan bawah untuk mencatat sesi.
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
              <p className="mt-2 text-xs text-slate-300"><strong className="text-coral">Saran berikutnya:</strong> {latest.nextAction}</p>
              <p className="mt-2 text-xs text-slate-400">Rincian pemeriksaan semua sesi ada di tab Per Sesi.</p>
            </Card>
          )}

          {/* Kartu 1 — Ringkasan Perkembangan */}
          <Card title={`Ringkasan perkembangan · ${days} hari`}>
            <div className={`sport-subcard border-l-4 p-3 text-sm font-medium text-slate-100 ${improving ? 'border-l-emerald-400' : 'border-l-sky-400'}`}>
              {progress.headline}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <KpiTile label="Jarak periode" value={dec(cur.totalKm)} unit="km" context={kmNote} tone="info" />
              <KpiTile label="Pace lari santai" value={cur.easyAvgPaceSec != null ? fmtPace(cur.easyAvgPaceSec) : '–'} unit="/km" context={paceNote} tone={paceTone} />
              <KpiTile label="Efisiensi aerobik" term="EF" value={cur.avgEf != null ? dec(cur.avgEf, 2) : '–'} context={efNote} tone={efTone} />
              <KpiTile label="Kadens langkah" value={cur.avgCadence != null ? Math.round(cur.avgCadence) : '–'} unit="spm" context={driftNote} tone={driftTone} />
            </div>
            {real.length > 0 && (
              <p className="mt-3 text-sm text-slate-300">
                <span className="font-semibold text-slate-100">Dalam angka nyata (vs {days} hari sebelumnya): </span>
                {real.join(' · ')}.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Efisiensi aerobik (EF) = kecepatan per detak jantung; makin tinggi, tubuh makin hemat.
              Pergeseran detak jantung (cardiac drift) di atas 5% berarti HR terus naik pada pace yang sama.
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

      {/* Kartu 3 — Rasio Beban */}
      <Card title="Rasio beban (ACWR)">
        <AcwrGauge ratio={gauge.ratio} status={gauge.status} />
        <p className="mt-2 text-center text-sm tabular-nums text-slate-400">
          Beban 7 hari {Math.round(gauge.acute)} · Rata-rata mingguan sebelumnya {Math.round(gauge.chronicWeekly)}
        </p>
        <p className="mt-1 text-center text-xs text-slate-400">Rasio antara 0,8 dan 1,3 dianggap aman. Di bawah 0,8 beban terlalu ringan; di atas 1,3 terlalu berat.</p>
        {hasSessions && (
          <div className="mt-3">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={acwrData}>
                <CartesianGrid stroke="#243456" vertical={false} />
                <ReferenceArea y1={0.8} y2={1.3} fill="#34d399" fillOpacity={0.12} />
                <XAxis dataKey="d" hide />
                <YAxis domain={[0, acwrMax]} {...axis} width={28} />
                <Tooltip {...tip} />
                <Line dataKey="acwr" stroke="#ff6b5e" dot={false} connectNulls strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-1 text-xs text-slate-400">Area hijau (0,8–1,3) adalah rentang aman. Garis di dalam area itu berarti beban seimbang.</p>
          </div>
        )}
      </Card>

      {hasSessions && (
        <>
          {/* Kartu 4 — Tren Pace Santai & VDOT */}
          <Card title="Tren pace lari santai & skor kebugaran (VDOT)">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Pace lari santai (menit/km)</h3>
            {hasPace ? (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={trend}>
                    <CartesianGrid stroke="#243456" vertical={false} />
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
            <h3 className="mt-4 text-xs font-bold uppercase tracking-wider text-slate-400">Skor kebugaran <span className="font-medium normal-case tracking-normal">(VDOT)</span></h3>
            {hasVdot ? (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={trend}>
                    <CartesianGrid stroke="#243456" vertical={false} />
                    <XAxis dataKey="d" {...axis} minTickGap={24} />
                    <YAxis {...axis} width={32} domain={['auto', 'auto']} />
                    <Tooltip {...tip} formatter={(v) => [dec(Number(v)), 'VDOT']} />
                    <Line dataKey="vdot" stroke="#ff6b5e" dot={{ r: 3 }} connectNulls strokeWidth={2} />
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

          <Card title={`Efisiensi aerobik (EF) · ${days} hari`}>
            {efData.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada sesi easy atau long run dalam rentang ini.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={efData}>
                  <CartesianGrid stroke="#243456" vertical={false} />
                  <XAxis dataKey="d" {...axis} minTickGap={24} />
                  <YAxis {...axis} width={36} domain={['auto', 'auto']} />
                  <Tooltip {...tip} />
                  <Line dataKey="ef" stroke="#34d399" dot={{ r: 3 }} connectNulls strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Volume mingguan (km)">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={weekly}>
                <CartesianGrid stroke="#243456" vertical={false} />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} width={28} />
                <Tooltip {...tip} />
                <Bar dataKey="km" fill="#ff6b5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Kartu 5 — Pencapaian Periode */}
          <Card title={`Pencapaian · ${days} hari`}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="sport-subcard p-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Lari terpanjang</div>
                <div className="mt-1 font-display text-lg font-extrabold tabular-nums text-white">{dec(cur.longestKm)}<span className="ml-0.5 text-xs font-bold text-slate-400"> km</span></div>
              </div>
              <div className="sport-subcard p-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pace tercepat</div>
                <div className="mt-1 font-display text-lg font-extrabold tabular-nums text-white">{cur.bestPaceSec != null ? fmtPace(cur.bestPaceSec) : '–'}<span className="ml-0.5 text-xs font-bold text-slate-400"> /km</span></div>
              </div>
              <div className="sport-subcard p-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Frekuensi</div>
                <div className="mt-1 font-display text-lg font-extrabold tabular-nums text-white">{dec(cur.sessionsPerWeek)}<span className="ml-0.5 text-xs font-bold text-slate-400"> sesi/mgg</span></div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Kartu 6 — Zona Pace & Prediksi Lomba */}
      {vd != null && <ZonaPaceCard vdot={vd} maxHr={maxHr} />}

      <Card title="Prediksi waktu lomba (Riegel)">
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
