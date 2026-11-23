import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, DAY_MS } from '../analytics/workload';
import { formatDateId } from '../plans/schedule';
import { calcAllShoesMileage, loadShoes } from '../plans/shoeStore';
import { weeklyKm } from './historyFilter';
import CoachCard from './CoachCard';
import { nextSession } from './nextSession';
import { KIND_BORDER, KIND_LABEL } from './sessionMeta';
import { ScreenHeader } from './ui';

const tip = {
  contentStyle: {
    background: '#111216',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    color: '#f4f5f7',
    fontSize: 12,
  },
};

export default function Beranda({ profile, workouts }: { profile: UserProfile; workouts: Workout[] }) {
  const t = Date.now();
  const load = acwr(workouts, profile, t);
  const km7 = workouts.filter((w) => w.date > t - 7 * DAY_MS).reduce((s, w) => s + w.distanceKm, 0);
  const weeks = weeklyKm(workouts, t, 8);
  const next = nextSession(profile, workouts, t);
  const shoes = loadShoes();
  const warningShoes = calcAllShoesMileage(workouts, shoes).filter(
    (entry) => entry.status === 'warn' || entry.status === 'replace',
  );
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
      ? `Pace ${next.paceText}`
      : null;

  return (
    <div className="space-y-4">
      <ScreenHeader title="Beranda" subtitle="Siap lari hari ini?" />

      {workouts.length === 0 && (
        <section className="rounded-3xl border border-dashed border-volt/45 bg-volt/[0.06] p-4 text-sm text-slate-200">
          Belum ada sesi lari. Ketuk tombol <strong className="text-volt">+</strong> di bawah untuk catat lari pertamamu.
        </section>
      )}

      {/* Kartu 1: Latihan Berikutnya (Hero Gradient) */}
      <section
        aria-label="Latihan Berikutnya"
        className={`rounded-3xl border border-white/[0.08] border-l-[3.5px] bg-gradient-to-br from-[#191B22] via-[#111216] to-[#0D1208] p-5 ${next && s ? KIND_BORDER[s.kind] : 'border-l-volt'}`}
      >
        <div className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Latihan Berikutnya
        </div>

        {next && s ? (
          <>
            <p className="mt-1.5 text-sm font-bold text-volt">{dateText}</p>
            <h2 className="mt-1 font-display text-2xl font-bold leading-snug text-white">{sessionTitle}</h2>

            <dl className="mt-4 grid grid-cols-2 gap-3">
              <div className="sport-subcard p-3.5">
                <dt className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">Jarak / Durasi</dt>
                <dd className="mt-1 font-mono text-xl font-extrabold tabular-nums text-white">{targetLoadPrimary}</dd>
                {targetLoadSub && <div className="mt-0.5 font-sans text-xs text-slate-400">{targetLoadSub}</div>}
              </div>
              <div className="sport-subcard p-3.5">
                <dt className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">Target Detak Jantung</dt>
                <dd className={`mt-1 font-mono text-xl font-extrabold tabular-nums ${next.hr ? 'text-volt' : 'text-slate-300'}`}>
                  {next.hr ? `${next.hr[0]}–${next.hr[1]} bpm` : 'Isi di Profil'}
                </dd>
                <div className="mt-0.5 font-sans text-xs text-slate-400">
                  {next.hr ? 'Jadikan patokan utama' : 'Lengkapi HR maks'}
                </div>
              </div>
            </dl>
          </>
        ) : (
          <>
            <h2 className="mt-1.5 font-display text-xl font-bold text-white">Belum ada jadwal aktif</h2>
            <p className="mt-1 text-sm text-slate-300">
              Atur tanggal lomba di tab Program buat tampilkan jadwal latihanmu di sini.
            </p>
          </>
        )}
      </section>

      {/* Kartu 2: Kondisi Tubuh & Pelatih */}
      <CoachCard workouts={workouts} profile={profile} />

      {/* Kartu 3: Progres Minggu Ini */}
      <section aria-label="Progres Minggu Ini" className="sport-card p-4">
        <h2 className="font-display text-base font-bold tracking-tight text-white">Progres Minggu Ini</h2>

        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="sport-subcard p-3.5">
            <dt className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Jarak 7 Hari</dt>
            <dd className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-white">
              {km7.toFixed(1)}
              <span className="ml-1 font-sans text-xs font-bold text-slate-400">km</span>
            </dd>
          </div>
          <div className="sport-subcard p-3.5">
            <dt className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Poin Usaha <span className="font-medium normal-case tracking-normal">(TRIMP)</span>
            </dt>
            <dd className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-volt">{Math.round(load.acute)}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-slate-300">Jarak 8 minggu terakhir (km)</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={weeks} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
              <Tooltip {...tip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="km" radius={[6, 6, 2, 2]}>
                {weeks.map((_, i) => <Cell key={i} fill={i === weeks.length - 1 ? '#C8FF00' : '#C8FF0045'} />)}
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
          <p className="text-xs text-slate-400">Batang Volt Lime adalah minggu berjalan.</p>
        </div>
      </section>

      {warningShoes.length > 0 && (
        <div className="space-y-2">
          {warningShoes.map((entry) => (
            <p
              key={entry.shoe.id}
              role="status"
              className={`rounded-2xl border px-3.5 py-2.5 text-xs font-medium ${
                entry.status === 'replace'
                  ? 'border-coral/40 bg-coral/10 text-coral'
                  : 'border-amber-400/35 bg-amber-400/10 text-amber-200'
              }`}
            >
              👟 {entry.shoe.name}: <span className="font-mono font-bold">{entry.totalKm.toFixed(2)}/{entry.shoe.maxKm} km</span> —{' '}
              {entry.status === 'replace' ? 'bantalan sudah aus, pertimbangkan ganti baru.' : 'bantalan mulai menipis.'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
