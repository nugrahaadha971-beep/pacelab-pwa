import { AlertTriangle, ArrowRight, BookOpen, CalendarDays, Footprints, Upload } from 'lucide-react';
import type { AppTab } from '../App';
import type { StatistikSubTab } from './Statistik';
import type { UserProfile, Workout } from '../analytics/types';
import { DAY_MS } from '../analytics/workload';
import { stripMarkdown } from '../analytics/raceDayAnalyzer';
import { backupOverdue } from '../db/backupReminder';
import { formatHrWithZone, resolveMaxHr, ZONE_LABEL, zoneRestingHr } from '../plans/hrZones';
import { formatDateId, isoFromRaceTs, remaining } from '../plans/schedule';
import { calcAllShoesMileage, loadShoes } from '../plans/shoeStore';
import { fmtHms, todayStr } from './format';
import { nextSession } from './nextSession';
import { KIND_LABEL } from './sessionMeta';
import { Button, ScreenHeader } from './ui';

interface BerandaProps {
  profile: UserProfile;
  workouts: Workout[];
  onNavigate: (tab: AppTab) => void;
  onOpenStatistik: (subTab: StatistikSubTab) => void;
  onOpenCatat: () => void;
}

const KIND_ACCENT: Record<string, string> = {
  recovery: 'text-[#BEF264]',
  long: 'text-sky-400',
  speed: 'text-rose-400',
  race: 'text-amber-400',
};

const dec = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',');

export default function Beranda({ profile, workouts, onNavigate, onOpenStatistik, onOpenCatat }: BerandaProps) {
  const now = Date.now();
  const next = nextSession(profile, workouts, now);

  const raceIso = profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : null;
  const raceRemaining = raceIso ? remaining(raceIso, todayStr()) : null;

  const last7Runs = workouts.filter((w) => w.date <= now && now - w.date <= 7 * DAY_MS);
  const km7 = last7Runs.reduce((sum, w) => sum + w.distanceKm, 0);

  const warningShoes = calcAllShoesMileage(workouts, loadShoes()).filter(
    (s) => s.status === 'warn' || s.status === 'replace',
  );

  const s = next?.session;
  const showName = s && s.name && s.kind !== 'race' && !['Easy Run', 'Long Run'].includes(s.name);
  const rawTitle = s
    ? s.convertedFrom || s.test === 'maf'
      ? s.name
      : `${KIND_LABEL[s.kind]}${showName ? ` · ${s.name}` : ''}`
    : '';
  const sessionTitle = rawTitle ? stripMarkdown(rawTitle) : '';

  const dateText =
    next && s
      ? next.isToday
        ? `Hari ini · ${formatDateId(s.date)}`
        : next.dayLabel === 'Besok'
          ? `Besok · ${formatDateId(s.date)}`
          : formatDateId(s.date)
      : '';

  const targetDistanceOrDuration =
    next && s
      ? s.kind === 'race'
        ? profile.targetDistance
        : s.distanceKm != null
          ? `${s.distanceKm.toFixed(1)} km`
          : next.durationMin != null
            ? `${Math.round(next.durationMin)} mnt`
            : 'Sesuai jadwal'
      : '–';

  const maxHr = resolveMaxHr(profile, workouts);
  const hrTuple: [number, number] | null =
    next && s && next.hr ? [next.hr[0], s.hr?.[1] ?? next.hr[1]] : null;
  const formattedHr = next && s ? formatHrWithZone(hrTuple, s.zone, maxHr, zoneRestingHr(profile)) : null;

  const targetHrText =
    next && s
      ? formattedHr
        ? formattedHr
        : s.zone
          ? ZONE_LABEL[s.zone]
          : 'Isi HR di Profil'
      : '–';

  const countdownText =
    raceRemaining == null
      ? 'Belum diatur'
      : raceRemaining.daysRemaining === 0
        ? 'Hari Ini'
        : raceRemaining.daysRemaining > 0
          ? `H-${raceRemaining.daysRemaining}`
          : 'Lewat';

  const countdownHint =
    raceRemaining == null
      ? 'Atur tanggal lomba'
      : raceRemaining.daysRemaining === 0
        ? 'Hari Lomba (H-0)'
        : raceRemaining.daysRemaining > 0
          ? `${raceRemaining.daysRemaining} hari lagi`
          : 'Perbarui target';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <ScreenHeader title="Hari Ini" subtitle="Ringkasan target, jadwal berikutnya & catatan lari" />
        <button
          type="button"
          onClick={onOpenCatat}
          className="inline-flex min-h-[48px] w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#BEF264] px-5 font-display text-sm font-extrabold text-[#09090B] shadow-[0_0_24px_rgba(190,242,100,0.2)] transition duration-150 hover:bg-[#d4fc82] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090B] sm:w-auto"
        >
          <Upload size={17} strokeWidth={2.4} aria-hidden />
          <span>Upload .FIT / Catat Lari</span>
        </button>
      </div>

      {backupOverdue(workouts.length, now) && (
        <section
          aria-label="Pengingat cadangan data"
          className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-sky-400/25 bg-sky-400/[0.07] px-4 py-3.5"
        >
          <p className="text-xs leading-relaxed text-zinc-200 sm:text-sm">
            Terakhir mencadangkan &gt; 14 hari lalu. Buka <strong className="text-white">Profil → Cadangan</strong>.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('profil')}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-2xl border border-sky-400/35 bg-sky-400/15 px-3.5 text-xs font-bold text-sky-300 transition hover:bg-sky-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <span>Buka Profil</span>
            <ArrowRight size={13} aria-hidden />
          </button>
        </section>
      )}

      {/* 1. Ringkasan Target & Progres Singkat */}
      <section aria-label="Ringkasan target dan progres singkat" className="sport-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-bold text-white">Target & Progres 7 Hari</h2>
          <span className="font-mono text-xs tabular-nums text-zinc-400">
            {last7Runs.length} sesi tercatat
          </span>
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2.5">
          <div className="sport-subcard p-3 sm:p-3.5">
            <dt className="text-[11px] font-medium text-zinc-400">Target Lomba</dt>
            <dd className="mt-1 font-mono text-base font-extrabold tabular-nums text-white sm:text-xl">
              {profile.targetDistance}
            </dd>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
              {fmtHms(profile.targetTimeSec)}
            </div>
          </div>

          <div className="sport-subcard p-3 sm:p-3.5">
            <dt className="text-[11px] font-medium text-zinc-400">Hitung Mundur</dt>
            <dd className="mt-1 font-mono text-base font-extrabold tabular-nums text-[#BEF264] sm:text-xl">
              {countdownText}
            </dd>
            <div className="mt-0.5 truncate text-[11px] tabular-nums text-zinc-400">
              {countdownHint}
            </div>
          </div>

          <div className="sport-subcard p-3 sm:p-3.5">
            <dt className="text-[11px] font-medium text-zinc-400">Jarak 7 Hari</dt>
            <dd className="mt-1 font-mono text-base font-extrabold tabular-nums text-sky-400 sm:text-xl">
              {dec(km7, 1)} <span className="font-sans text-xs font-semibold text-zinc-400">km</span>
            </dd>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
              {last7Runs.length} sesi lari
            </div>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpenStatistik('analitik')}
            className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-2xl border border-white/10 bg-[#18181D] px-4 text-xs font-bold text-zinc-100 transition hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <span>Detail Analitik →</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenStatistik('riwayat')}
            className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-2xl border border-white/10 bg-[#18181D] px-4 text-xs font-bold text-zinc-100 transition hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <span>Lihat Riwayat →</span>
          </button>
        </div>
      </section>

      {/* 2. Jadwal Singkat (Latihan Berikutnya) */}
      <section
        aria-label="Jadwal latihan berikutnya"
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#121215] p-5"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#BEF264]/10 blur-3xl"
        />

        <div className="relative flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
            <CalendarDays size={15} className="text-[#BEF264]" aria-hidden />
            <span>Latihan Berikutnya</span>
          </div>
          {next && (
            <span className={`text-xs font-semibold ${next.isToday ? 'text-[#BEF264]' : 'text-zinc-400'}`}>
              {dateText}
            </span>
          )}
        </div>

        {next && s ? (
          <>
            <h2 className="relative mt-2 font-display text-xl font-bold leading-tight tracking-tight sm:text-2xl">
              <span className={KIND_ACCENT[s.kind] ?? 'text-[#BEF264]'}>{sessionTitle}</span>
            </h2>

            <dl className="relative mt-3.5 grid grid-cols-2 gap-2.5">
              <div className="sport-subcard p-3 sm:p-3.5">
                <dt className="text-[11px] font-medium text-zinc-400">Target Jarak / Durasi</dt>
                <dd className="mt-1 font-mono text-base font-extrabold tabular-nums text-sky-400 sm:text-lg">
                  {targetDistanceOrDuration}
                </dd>
              </div>

              <div className="sport-subcard p-3 sm:p-3.5">
                <dt className="text-[11px] font-medium text-zinc-400">Target HR</dt>
                <dd
                  className={`mt-1 font-mono text-base font-extrabold tabular-nums sm:text-lg ${
                    next.hr ? 'text-[#BEF264]' : 'text-zinc-300'
                  }`}
                >
                  {targetHrText}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="relative mt-3 rounded-2xl border border-dashed border-white/10 bg-[#18181D]/60 p-4">
            <p className="text-sm font-semibold text-zinc-100">Belum ada jadwal latihan aktif</p>
            <p className="mt-1 text-xs text-zinc-400">
              Susun jadwal mandiri atau gunakan Susun AI di tab Jadwal.
            </p>
          </div>
        )}

        <div className="relative mt-4">
          <Button variant="primary" block={false} onClick={() => onNavigate('program')} className="gap-2">
            <span className="whitespace-nowrap">Atur / Lihat Jadwal →</span>
          </Button>
        </div>
      </section>

      {/* 3. Panduan Singkat */}
      <section aria-label="Panduan singkat latihan" className="sport-card p-5">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-sky-400" aria-hidden />
          <h2 className="font-display text-base font-bold text-white">Panduan Singkat</h2>
        </div>

        <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-zinc-300 sm:text-sm">
          <li className="flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-[#18181D]/60 px-3.5 py-2.5">
            <span className="font-mono text-xs font-extrabold text-[#BEF264]">01</span>
            <span>
              Prinsip <em>HR-First</em>: jadikan zona detak jantung sebagai patokan utama intensitas, bukan sekadar mengejar kecepatan.
            </span>
          </li>
          <li className="flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-[#18181D]/60 px-3.5 py-2.5">
            <span className="font-mono text-xs font-extrabold text-sky-400">02</span>
            <span>
              <em>Easy &amp; Long Run</em> di zona santai: pertahankan ritme nyaman sehingga Anda tetap bisa berbicara lancar saat berlari.
            </span>
          </li>
          <li className="flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-[#18181D]/60 px-3.5 py-2.5">
            <span className="font-mono text-xs font-extrabold text-rose-400">03</span>
            <span>
              <em>Speed / Interval</em> dipisah dari <em>Long Run</em>: sisipkan hari mudah atau istirahat di antaranya agar otot pulih optimal.
            </span>
          </li>
        </ol>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => onNavigate('program')}
            className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-2xl border border-[#BEF264]/35 bg-[#BEF264]/10 px-4 text-xs font-bold text-[#BEF264] transition hover:border-[#BEF264]/55 hover:bg-[#BEF264]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <span>Pelajari & Susun Program →</span>
          </button>
        </div>
      </section>

      {/* Peringatan Sepatu Aus (hanya tampil bila ada) */}
      {warningShoes.length > 0 && (
        <section
          aria-label="Peringatan sepatu aus"
          className="rounded-3xl border border-amber-400/30 bg-amber-400/[0.07] p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" aria-hidden />
              <h2 className="font-display text-sm font-bold text-amber-100">Peringatan Sepatu Lari</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('profil')}
              className="inline-flex min-h-[36px] items-center gap-1 text-xs font-bold text-[#BEF264] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              <span>Kelola di Profil</span>
              <ArrowRight size={13} aria-hidden />
            </button>
          </div>

          <ul className="mt-3 space-y-2">
            {warningShoes.map((item) => (
              <li
                key={item.shoe.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#121215]/90 px-3.5 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Footprints size={14} className="shrink-0 text-amber-400" aria-hidden />
                  <span className="truncate font-semibold text-white">{item.shoe.name}</span>
                </div>
                <div className="flex items-center gap-2.5 tabular-nums">
                  <span className="font-mono text-zinc-300">
                    {dec(item.totalKm, 0)} / {dec(item.shoe.maxKm, 0)} km ({Math.round(item.pct)}%)
                  </span>
                  <span className={`text-xs font-bold ${item.status === 'replace' ? 'text-rose-400' : 'text-amber-400'}`}>
                    {item.status === 'replace' ? 'Perlu Ganti' : 'Hampir Aus'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
