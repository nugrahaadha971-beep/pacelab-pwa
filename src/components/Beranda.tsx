import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, DAY_MS } from '../analytics/workload';
import { formatDateId } from '../plans/schedule';
import { calcShoeMileage, loadShoeConfig } from '../plans/shoeStore';
import { weeklyKm } from './historyFilter';
import CoachCard from './CoachCard';
import { nextSession } from './nextSession';
import { KIND_BORDER, KIND_LABEL } from './sessionMeta';
import { ScreenHeader } from './ui';

const tip = { contentStyle: { background: '#101829', border: '1px solid #243456', color: '#e2e8f0', fontSize: 12 } };

export default function Beranda({ profile, workouts }: { profile: UserProfile; workouts: Workout[] }) {
  const t = Date.now();
  const load = acwr(workouts, profile, t);
  const km7 = workouts.filter((w) => w.date > t - 7 * DAY_MS).reduce((s, w) => s + w.distanceKm, 0);
  const weeks = weeklyKm(workouts, t, 8);
  const next = nextSession(profile, workouts, t);
  const shoe = loadShoeConfig();
  const shoeName = shoe.name.trim();
  const shoeMileage = calcShoeMileage(workouts, shoe);
  const showShoeBanner = Boolean(shoeName) && (shoeMileage.status === 'warn' || shoeMileage.status === 'replace');
  const s = next?.session;
  const showName = s && s.name && s.kind !== 'race' && !['Easy Run', 'Long Run'].includes(s.name);
  const sessionTitle = s
    ? s.convertedFrom || s.test === 'maf'
      ? s.name
      : `${KIND_LABEL[s.kind]}${showName ? ` · ${s.name}` : ''}`
    : '';

  const dateText = next && s
    ? next.isToday
      ? `Hari ini · ${formatDateId(s.date)}`
      : next.dayLabel === 'Besok'
        ? `Besok · ${formatDateId(s.date)}`
        : formatDateId(s.date)
    : null;

  const targetLoadPrimary = next && s
    ? s.kind === 'race'
      ? profile.targetDistance
      : s.distanceKm != null
        ? `${s.distanceKm.toFixed(1)} km`
        : next.durationMin != null
          ? `${Math.round(next.durationMin)} menit`
          : 'Sesuai jadwal'
    : '–';

  const targetLoadSub = next && s && s.kind !== 'race' && s.distanceKm != null && next.durationMin != null
    ? `Sekitar ${Math.round(next.durationMin)} menit`
    : next?.paceText
      ? `Perkiraan pace ${next.paceText}`
      : null;

  return (
    <div className="space-y-4">
      <ScreenHeader title="Beranda" subtitle="Ringkasan latihan dan kondisi tubuh hari ini" />

      {workouts.length === 0 && (
        <section className="rounded-2xl border border-dashed border-coral/60 bg-coral/10 p-4 text-sm text-slate-200">
          Belum ada sesi lari. Ketuk tombol <strong>+</strong> di pojok kanan bawah untuk mencatat lari atau mengimpor file .FIT/.GPX.
        </section>
      )}

      {/* Kartu 1: Latihan Berikutnya */}
      <section
        aria-label="Latihan Berikutnya"
        className={`sport-card border-l-[3.5px] p-4 ${next && s ? KIND_BORDER[s.kind] : 'border-l-sky-400'}`}
      >
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Latihan Berikutnya
        </div>

        {next && s ? (
          <>
            <p className="mt-1.5 text-sm font-semibold tabular-nums text-coral">{dateText}</p>
            <h2 className="mt-1 font-display text-2xl font-extrabold leading-snug text-white">{sessionTitle}</h2>

            <dl className="mt-3.5 grid grid-cols-2 gap-2.5 tabular-nums">
              <div className="sport-subcard p-3">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Jarak / Durasi</dt>
                <dd className="mt-1 font-display text-xl font-extrabold text-white">{targetLoadPrimary}</dd>
                {targetLoadSub && <div className="mt-0.5 text-xs text-slate-400">{targetLoadSub}</div>}
              </div>
              <div className="sport-subcard p-3">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Target Detak Jantung</dt>
                <dd className="mt-1 font-display text-xl font-extrabold text-emerald-400">
                  {next.hr ? `${next.hr[0]}–${next.hr[1]} bpm` : 'Isi di Profil'}
                </dd>
                <div className="mt-0.5 text-xs text-slate-400">
                  {next.hr ? 'Jadikan patokan utama' : 'Lengkapi HR maks'}
                </div>
              </div>
            </dl>
          </>
        ) : (
          <>
            <h2 className="mt-1.5 font-display text-xl font-extrabold text-white">Belum ada latihan terjadwal</h2>
            <p className="mt-1 text-sm text-slate-300">
              Atur tanggal lomba di tab Program untuk menampilkan jadwal latihan berikutnya di sini.
            </p>
          </>
        )}
      </section>

      {/* Kartu 2: Kondisi Tubuh & Pelatih */}
      <CoachCard workouts={workouts} profile={profile} />

      {/* Kartu 3: Progres Minggu Ini */}
      <section aria-label="Progres Minggu Ini" className="sport-card p-4">
        <h2 className="font-display text-base font-bold tracking-tight text-slate-100">Progres Minggu Ini</h2>

        <dl className="mt-3 grid grid-cols-2 gap-3 tabular-nums">
          <div className="sport-subcard p-3.5">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Jarak 7 Hari</dt>
            <dd className="mt-1 font-display text-2xl font-extrabold text-white">
              {km7.toFixed(1)}
              <span className="ml-1 text-sm font-bold text-slate-400">km</span>
            </dd>
          </div>
          <div className="sport-subcard p-3.5">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Poin Usaha <span className="font-medium normal-case tracking-normal">(TRIMP)</span>
            </dt>
            <dd className="mt-1 font-display text-2xl font-extrabold text-white">{Math.round(load.acute)}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-slate-300">Jarak lari 8 minggu terakhir (km)</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={weeks} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
              <Tooltip {...tip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="km" radius={[5, 5, 2, 2]}>
                {weeks.map((_, i) => <Cell key={i} fill={i === weeks.length - 1 ? '#FF6B5E' : '#FF6B5E55'} />)}
                <LabelList
                  dataKey="km"
                  position="top"
                  fill="#94a3b8"
                  fontSize={10}
                  formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : '')}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-400">Batang terang menunjukkan minggu berjalan.</p>
        </div>
      </section>

      {showShoeBanner && (
        <p
          role="status"
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium tabular-nums ${
            shoeMileage.status === 'replace'
              ? 'border-coral/35 bg-coral/10 text-coral'
              : 'border-amber-400/35 bg-amber-400/10 text-amber-200'
          }`}
        >
          👟 {shoeName}: {shoeMileage.totalKm}/{shoe.maxKm} km — bantalan mulai menipis.
        </p>
      )}
    </div>
  );
}
