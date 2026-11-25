import { useState } from 'react';
import type { RaceDistance, UserProfile, Workout } from '../analytics/types';
import { db } from '../db/database';
import { currentVdot, PENALTY_RULES, penaltyPct, predictAll, RACE_KM, velocityFor, ZONE_FRACTION } from '../analytics/predictor';
import { fmtPace } from '../plans/pace';
import { pbOutlook } from '../plans/adaptiveEngine';
import { isoFromRaceTs, isValidIso, remaining } from '../plans/schedule';
import { PLAN_LABEL, resolvePlan, selectBestPlan } from '../plans/planSelector';
import type { PlanMode } from '../plans/planSelector';
import { loadPlanMode, savePlanMode } from '../plans/scheduleStore';
import { DAY_MS } from '../analytics/workload';
import { fmtHms, todayStr } from './format';
import RaceDayCard from './RaceDayCard';
import TrainingPlan from './TrainingPlan';
import { Field, KpiTile, ScreenHeader, SegmentedTabs } from './ui';

type ProgramTab = 'ringkasan' | 'jadwal';
const PROGRAM_TABS: ReadonlyArray<{ id: ProgramTab; label: string }> = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'jadwal', label: 'Jadwal' },
];
const card = 'sport-card p-4';
const MODE_OPTIONS: ReadonlyArray<{ id: PlanMode; label: string; desc: string }> = [
  { id: 'auto', label: 'Otomatis', desc: 'Dipilihkan sistem sesuai kondisi lari terakhirmu.' },
  { id: 'progressive5k', label: 'Progresif 5K', desc: 'Kombinasi lari-jalan bertahap, paling aman untuk pemula.' },
  { id: 'nike5k', label: 'Nike 5K', desc: 'Lari terus-menerus berdasarkan target kecepatan.' },
  { id: 'maf', label: 'MAF', desc: 'Fokus menjaga detak jantung tetap rendah & nyaman.' },
];

/** Bar progres dengan semantik progressbar; hijau bila sudah memenuhi syarat. */
function Meter({ label, ratio }: { label: string; ratio: number }) {
  const r = Math.min(1, Math.max(0, ratio));
  return (
    <div
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r * 100)}
      className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#272A35]"
    >
      <div
        className={`h-full rounded-full ${r >= 1 ? 'bg-volt' : 'bg-sky-400'}`}
        style={{ width: `${r * 100}%` }}
      />
    </div>
  );
}

export default function Program({ profile, workouts, onProfileChange }: { profile: UserProfile; workouts: Workout[]; onProfileChange: () => void }) {
  const now = Date.now();
  const [tab, setTab] = useState<ProgramTab>('ringkasan');
  const raceIso = profile.targetRaceDate ? isoFromRaceTs(profile.targetRaceDate) : null;
  const [raceText, setRaceText] = useState(raceIso ?? '');
  const [mode, setMode] = useState<PlanMode>(loadPlanMode);
  const chooseMode = (m: PlanMode) => { setMode(m); savePlanMode(m); };
  const saveRaceDate = async (v: string) => {
    setRaceText(v);
    if (v !== '' && !isValidIso(v)) return;
    await db.userProfile.put({ ...profile, targetRaceDate: v ? Date.parse(v) : 0 });
    onProfileChange();
  };
  const target: RaceDistance = profile.targetDistance;
  const rem = raceIso ? remaining(raceIso, todayStr()) : null;
  const daysLeft = rem ? rem.daysRemaining : null;
  const goalPace = profile.targetTimeSec / RACE_KM[target];
  const preds = predictAll(workouts, now);
  const pred = preds[target];
  const gap = pred ? pred.finalSec - profile.targetTimeSec : null;
  const outlook = pred ? pbOutlook(pred.finalSec, profile.targetTimeSec, rem?.weeksRemaining ?? 0) : null;
  const currentPace = pred ? pred.finalSec / RACE_KM[target] : null;
  const rule = PENALTY_RULES[target];
  const last28 = workouts.filter((w) => w.date <= now && now - w.date <= 28 * DAY_MS);
  const weeklyKm = last28.reduce((s, w) => s + w.distanceKm, 0) / 4;
  const longRun = last28.filter((w) => w.workoutType === 'long_run').reduce((m, w) => Math.max(m, w.distanceKm), 0);
  const pen = penaltyPct(target, workouts, now);
  const penMin = pred ? (pred.finalSec - pred.baseSec) / 60 : 0;
  const vd = currentVdot(workouts, now);
  const easyPace = vd != null ? 60000 / velocityFor(vd, ZONE_FRACTION.easy) : 360;
  const selection = selectBestPlan(workouts, profile, { now, projected5kSec: preds['5K']?.finalSec ?? null });
  const curriculum = resolvePlan(mode, selection);

  return (
    <div className="space-y-4">
      <ScreenHeader title="Program" subtitle="Rencana menuju lomba dan jadwal latihan" />
      <SegmentedTabs idBase="program" label="Bagian program" tabs={PROGRAM_TABS} value={tab} onChange={setTab} />

      {tab === 'ringkasan' && (
        <div id="program-panel-ringkasan" role="tabpanel" aria-labelledby="program-tab-ringkasan" className="space-y-4">
          <section aria-label="Hitung mundur lomba" className="rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#191B22] via-[#111216] to-[#0D1208] p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Menuju lomba {target}</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-mono text-5xl font-extrabold tabular-nums text-volt">{daysLeft == null ? '–' : Math.max(0, daysLeft)}</span>
              <span className="text-sm text-slate-300">
                {daysLeft == null ? 'Isi tanggal lomba di bawah' : daysLeft < 0 ? 'Lomba sudah lewat' : `hari lagi · ${rem?.weeksRemaining} minggu`}
              </span>
            </div>
            <div className="mt-4">
              <Field label="Tanggal lomba" hint="Sinkron dengan Profil" type="date" value={raceText} onChange={(e) => void saveRaceDate(e.target.value)} />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Target waktu" value={fmtHms(profile.targetTimeSec)} tone="neutral" />
            <KpiTile label="Pace dibutuhkan" value={fmtPace(goalPace)} unit="/km" tone="neutral" />
            <KpiTile label="Perkiraan waktu saat ini" term="Riegel" value={pred ? fmtHms(pred.finalSec) : '–'} tone="neutral" />
            <KpiTile
              label="Selisih ke target"
              value={gap == null ? '–' : gap > 0 ? `+${fmtHms(gap)}` : `−${fmtHms(-gap)}`}
              tone={gap == null ? 'neutral' : gap > 0 ? 'warn' : 'good'}
              context={gap == null ? undefined : gap > 0 ? 'masih di atas target' : 'sudah di bawah target'}
            />
          </div>

          {outlook && currentPace != null && (
            <section className={`sport-card border-l-[3px] ${curriculum === 'maf' ? 'border-l-sky-400' : 'border-l-volt'} p-4 text-sm`}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Peluang memecahkan target (PB)</div>
              <div className="mt-1 font-display text-base font-bold text-volt">{outlook.label}</div>
              <div className="mt-2 tabular-nums text-slate-300">
                Selisih waktu: {outlook.gapSec > 0 ? `+${Math.round(outlook.gapSec)} dtk (${fmtHms(outlook.gapSec)})` : `${Math.round(outlook.gapSec)} dtk, sudah di bawah target`}
              </div>
              <div className="tabular-nums text-slate-300">Pace: {fmtPace(currentPace)} → {fmtPace(goalPace)} /km</div>
              {outlook.perWeekSec != null && <div className="tabular-nums text-slate-300">Perlu sekitar {outlook.perWeekSec.toFixed(1)} dtk perbaikan per minggu</div>}
              {curriculum === 'maf' && <p className="mt-2 text-xs text-slate-400">Mode MAF fokus membangun fondasi aerobik; proyeksi PB dihitung dari performa terbaik terkini.</p>}
            </section>
          )}

          <RaceDayCard profile={profile} workouts={workouts} />

          <section className={card} aria-label="Rekomendasi pelatih">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Metode latihan</div>
            <div className="mt-1 font-display text-base font-bold text-volt">
              {mode === 'auto' ? 'Otomatis' : 'Pilihanmu'}: {PLAN_LABEL[curriculum]}
            </div>
            {mode !== 'auto' && curriculum !== selection.plan && (
              <p className="mt-1 text-xs text-amber-400">Rekomendasi otomatis saat ini: {PLAN_LABEL[selection.plan]}.</p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Pilih metode latihan">
              {MODE_OPTIONS.map((opt) => {
                const active = mode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => chooseMode(opt.id)}
                    className={`flex min-h-[56px] flex-col items-start justify-center rounded-2xl border px-3.5 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                      active
                        ? 'border-volt/70 bg-volt/10 text-white'
                        : 'border-white/10 bg-[#191B22] text-slate-200 hover:border-white/20'
                    }`}
                  >
                    <span className={`font-display text-sm font-bold ${active ? 'text-volt' : 'text-white'}`}>{opt.label}</span>
                    <span className={`mt-0.5 text-xs leading-snug ${active ? 'text-slate-200' : 'text-slate-400'}`}>
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">
              {selection.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            {mode === 'maf' && (
              <p className="mt-2 text-sm text-sky-300">Program MAF: semua lari di zona detak jantung MAF (180 − usia; 165 untuk usia ≤ 16). Atur kondisi Anda dan lihat zona di tab Jadwal.</p>
            )}
            {mode !== 'maf' && ((selection.metrics.easyHrPct != null && selection.metrics.easyHrPct > 0.8) || (selection.metrics.driftPct ?? 0) > 5) && (
              <p className="mt-2 text-sm text-sky-300">Lari santai Anda masih di atas zona aerobik. Program MAF (batas detak jantung rendah) juga cocok untuk membangun fondasi.</p>
            )}
            {target !== '5K' && <p className="mt-2 text-xs text-slate-400">Ketiga program ini untuk 5K, sedangkan jarak target Anda {target}.</p>}
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold text-slate-300">Volume dan long run</h2>
            <div className="mt-2 text-sm tabular-nums">
              Rata-rata 4 minggu: <span className="font-bold">{weeklyKm.toFixed(1)} km/minggu</span>
            </div>
            {rule && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-400"><span>Syarat {target}</span><span className="tabular-nums">{rule.weeklyKm} km/minggu</span></div>
                <Meter label={`Volume mingguan terhadap syarat ${target}`} ratio={weeklyKm / rule.weeklyKm} />
              </div>
            )}
            {profile.weeklyTargetKm != null && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-400"><span>Target mingguan Anda</span><span className="tabular-nums">{profile.weeklyTargetKm} km</span></div>
                <Meter label="Volume mingguan terhadap target Anda" ratio={weeklyKm / profile.weeklyTargetKm} />
              </div>
            )}
            {rule && (
              <div className="mt-3">
                <div className="flex justify-between text-sm tabular-nums">
                  <span>Long run terpanjang: <span className="font-bold">{longRun.toFixed(1)} km</span></span>
                  <span className="text-xs text-slate-400">syarat {rule.longRunKm} km</span>
                </div>
                <Meter label={`Long run terhadap syarat ${target}`} ratio={longRun / rule.longRunKm} />
              </div>
            )}
            {pen > 0 ? (
              <div className="mt-4 rounded-2xl border border-coral/40 bg-coral/10 p-3 text-sm text-coral">
                Daya tahan belum cukup: waktu prediksi ditambah {(pen * 100).toFixed(1)}% (sekitar +{penMin.toFixed(0)} menit). Volume atau long run masih di bawah syarat.
              </div>
            ) : rule ? (
              <div className="mt-4 rounded-2xl border border-volt/25 bg-volt/10 p-3 text-sm text-volt">Syarat volume dan long run terpenuhi.</div>
            ) : (
              <div className="mt-4 text-sm text-slate-400">Tidak ada tambahan waktu karena daya tahan untuk {target}.</div>
            )}
          </section>

        </div>
      )}

      {tab === 'jadwal' && (
        <div id="program-panel-jadwal" role="tabpanel" aria-labelledby="program-tab-jadwal">
          <TrainingPlan profile={profile} workouts={workouts} defaultK5Sec={preds['5K']?.finalSec ?? null} currentPaceSecPerKm={currentPace} startWeeklyKm={weeklyKm} easyPaceSecPerKm={easyPace} curriculum={curriculum} />
        </div>
      )}
    </div>
  );
}
