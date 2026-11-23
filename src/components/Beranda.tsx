import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, DAY_MS } from '../analytics/workload';
import type { AcwrStatus } from '../analytics/workload';
import { weeklyKm } from './historyFilter';
import CoachCard from './CoachCard';
import { nextSession } from './nextSession';
import { KIND_BORDER, KIND_LABEL } from './sessionMeta';
import { InfoHint, KpiTile, ScreenHeader, StatusPill } from './ui';
import type { Tone } from './ui';

const tip = { contentStyle: { background: '#101829', border: '1px solid #243456', color: '#e2e8f0', fontSize: 12 } };

/** Status beban dalam bahasa sehari-hari; istilah teknis dalam kurung. */
const STATUS: Record<AcwrStatus, { tone: Exclude<Tone, 'neutral'>; short: string; text: string; border: string }> = {
  unknown: {
    tone: 'info', short: 'Data belum cukup',
    text: 'Catat lebih banyak sesi agar status beban bisa dihitung.', border: 'border-l-sky-400',
  },
  undertraining: {
    tone: 'warn', short: 'Beban ringan',
    text: 'Beban Anda di bawah kebiasaan sebelumnya. Boleh menambah latihan sedikit demi sedikit.', border: 'border-l-amber-400',
  },
  sweet_spot: {
    tone: 'good', short: 'Aman',
    text: 'Beban seimbang dengan kebiasaan Anda. Lanjutkan sesuai jadwal.', border: 'border-l-emerald-400',
  },
  high_fatigue: {
    tone: 'bad', short: 'Terlalu berat',
    text: 'Beban naik tajam dibanding kebiasaan Anda. Kurangi intensitas dan beri waktu untuk pulih.', border: 'border-l-coral',
  },
};

export default function Beranda({ profile, workouts }: { profile: UserProfile; workouts: Workout[] }) {
  const t = Date.now();
  const load = acwr(workouts, profile, t);
  const km7 = workouts.filter((w) => w.date > t - 7 * DAY_MS).reduce((s, w) => s + w.distanceKm, 0);
  const weeks = weeklyKm(workouts, t, 8);
  const st = STATUS[load.status];
  const next = nextSession(profile, workouts, t);
  const s = next?.session;
  const showName = s && s.name && s.kind !== 'race' && !['Easy Run', 'Long Run'].includes(s.name);
  const sessionTitle = s ? (s.convertedFrom || s.test === 'maf' ? s.name : `${KIND_LABEL[s.kind]}${showName ? ` · ${s.name}` : ''}`) : '';

  return (
    <div className="space-y-4">
      <ScreenHeader title="Beranda" subtitle="Ringkasan latihan dan saran untuk hari ini" />
      {workouts.length === 0 && (
        <section className="rounded-2xl border border-dashed border-coral/60 bg-coral/10 p-4 text-sm text-slate-200">
          Belum ada sesi. Ketuk tombol <strong>+</strong> di pojok kanan bawah untuk mengimpor berkas .FIT/.GPX atau mencatat sesi manual. Setelah itu saran pelatih dan grafik akan aktif.
        </section>
      )}

      <section aria-label="Misi hari ini" className={`sport-card border-l-[3.5px] p-4 ${next && s ? KIND_BORDER[s.kind] : st.border}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {next ? (next.isToday ? 'Misi hari ini' : `Misi berikutnya · ${next.dayLabel}`) : 'Status latihan'}
          </div>
          <StatusPill tone={st.tone}>{st.short}{load.ratio != null ? ` · ${load.ratio.toFixed(2)}` : ''}</StatusPill>
        </div>

        {next && s ? (
          <>
            <h2 className="mt-2 font-display text-lg font-extrabold text-white">{sessionTitle}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 tabular-nums">
              <div className="sport-subcard p-3">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Utamakan HR (bpm)</dt>
                <dd className="mt-0.5 font-display text-base font-extrabold text-emerald-400">
                  {next.hr ? `${next.hr[0]}–${next.hr[1]}` : 'Isi di Profil'}
                </dd>
              </div>
              <div className="sport-subcard p-3">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Target pace (/km)</dt>
                <dd className="mt-0.5 font-display text-base font-extrabold text-white">{next.paceText ?? (s.zone === 'maf' ? 'Sesuai HR' : '–')}</dd>
              </div>
            </dl>
            {next.durationMin != null && s.kind !== 'race' && (
              <p className="mt-2 text-sm tabular-nums text-slate-300">Sekitar {Math.round(next.durationMin)} menit. Detak jantung jadi patokan utama, pace hanya perkiraan.</p>
            )}
          </>
        ) : (
          <>
            <h2 className="mt-2 font-display text-lg font-extrabold text-white">Belum ada sesi terjadwal</h2>
            <p className="mt-1 text-sm text-slate-300">Isi tanggal lomba di tab Program untuk melihat sesi latihan berikutnya.</p>
          </>
        )}

        <p className="mt-3 text-sm leading-relaxed text-slate-300">{st.text}</p>
        <div className="mt-1 text-xs text-slate-400">
          <InfoHint label="Apa itu rasio beban?" term="ACWR">
            Membandingkan beban latihan 7 hari terakhir dengan rata-rata mingguan sebelumnya. Antara 0,8 dan 1,3 dianggap aman.
          </InfoHint>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <KpiTile label="Beban 7 hari" term="TRIMP" value={Math.round(load.acute)} />
        <KpiTile label="Jarak 7 hari" value={km7.toFixed(1)} unit="km" />
      </div>

      <section className="sport-card p-4">
        <h2 className="text-sm font-semibold text-slate-300">Volume mingguan · 8 minggu terakhir (km)</h2>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={weeks} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
            <Tooltip {...tip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="km" radius={[5, 5, 2, 2]}>
              {weeks.map((_, i) => <Cell key={i} fill={i === weeks.length - 1 ? '#FF6B5E' : '#FF6B5E55'} />)}
              <LabelList dataKey="km" position="top" fill="#94a3b8" fontSize={10}
                formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : '')} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-400">Batang terang adalah minggu berjalan.</p>
      </section>

      <CoachCard workouts={workouts} profile={profile} />
    </div>
  );
}
