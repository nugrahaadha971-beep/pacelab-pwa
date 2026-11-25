import { useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Footprints,
  HeartPulse,
  Plus,
  Route,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { UserProfile, Workout } from '../analytics/types';
import { acwr, DAY_MS, efficiencyFactor, efTrend, type AcwrStatus } from '../analytics/workload';
import { PENALTY_RULES } from '../analytics/predictor';
import { stripMarkdown } from '../analytics/raceDayAnalyzer';
import { ZONE_LABEL } from '../plans/hrZones';
import { fmtPace } from '../plans/pace';
import { formatDateId, isoFromRaceTs, remaining } from '../plans/schedule';
import { calcAllShoesMileage, loadShoes } from '../plans/shoeStore';
import { fmtHms, todayStr } from './format';
import { weeklyKm } from './historyFilter';
import CoachCard from './CoachCard';
import RaceDayCard from './RaceDayCard';
import { nextSession } from './nextSession';
import { KIND_LABEL } from './sessionMeta';
import { useDialog } from './useDialog';
import { Button, ScreenHeader, StatusPill, type Tone } from './ui';

interface BerandaProps {
  profile: UserProfile;
  workouts: Workout[];
  onOpenCatat?: () => void;
  onNavigate?: (tab: 'program' | 'analitik' | 'riwayat' | 'profil') => void;
}

const ACWR_META: Record<AcwrStatus, { label: string; tone: Exclude<Tone, 'neutral'>; accent: string }> = {
  unknown: { label: 'Kurang', tone: 'info', accent: 'text-zinc-200' },
  undertraining: { label: 'Ringan', tone: 'info', accent: 'text-sky-400' },
  sweet_spot: { label: 'Optimal', tone: 'good', accent: 'text-[#BEF264]' },
  high_fatigue: { label: 'Tinggi', tone: 'bad', accent: 'text-rose-400' },
};

const KIND_ACCENT: Record<string, string> = {
  recovery: 'text-[#BEF264]',
  long: 'text-sky-400',
  speed: 'text-rose-400',
  race: 'text-amber-400',
};

interface WeeklyBarTooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { label: string; km: number } }>;
  targetKm?: number;
}

function WeeklyBarTooltip({ active, payload, targetKm }: WeeklyBarTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const km = Number(item.value ?? 0);
  const label = item.payload?.label ?? '';
  return (
    <div className="rounded-2xl border border-white/15 bg-[#121215]/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur-md">
      <div className="font-semibold text-zinc-300">Minggu {label}</div>
      <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-sky-400">
        {km.toFixed(1)} <span className="font-sans text-xs font-medium text-zinc-400">km</span>
      </div>
      {targetKm != null && targetKm > 0 && (
        <div className="mt-0.5 text-[11px] tabular-nums text-zinc-400">
          Target: {targetKm} km ({Math.round((km / targetKm) * 100)}%)
        </div>
      )}
    </div>
  );
}

function CoachModal({
  open,
  onClose,
  workouts,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  workouts: Workout[];
  profile: UserProfile;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#121215] px-5 pt-3 shadow-2xl sm:rounded-3xl sm:pt-5"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#27272E] sm:hidden" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="coach-modal-title" className="font-display text-base font-bold text-white">
            Pelatih AI & Kesiapan
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Pelatih AI"
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <CoachCard workouts={workouts} profile={profile} embedded />
      </div>
    </div>
  );
}

export default function Beranda({ profile, workouts, onOpenCatat, onNavigate }: BerandaProps) {
  const [coachOpen, setCoachOpen] = useState(false);

  const t = Date.now();
  const load = acwr(workouts, profile, t);
  const ef = efTrend(workouts, t);

  // Fallback EF terbaru jika data hanya tersedia di luar jendela 14 hari atau hanya 1 sesi
  const latestAerobicEf = [...workouts]
    .filter((w) => w.date <= t && (w.workoutType === 'easy' || w.workoutType === 'long_run'))
    .sort((a, b) => b.date - a.date)
    .map((w) => w.efficiencyFactor ?? efficiencyFactor(w))
    .find((v): v is number => v != null && Number.isFinite(v)) ?? null;
  const displayEf = ef.recent ?? latestAerobicEf;

  // Metrik minggu ini (7 hari terakhir) vs minggu lalu (8-14 hari lalu)
  const w7 = workouts.filter((w) => w.date > t - 7 * DAY_MS && w.date <= t);
  const prevW7 = workouts.filter((w) => w.date > t - 14 * DAY_MS && w.date <= t - 7 * DAY_MS);

  const km7 = w7.reduce((s, w) => s + w.distanceKm, 0);
  const prevKm7 = prevW7.reduce((s, w) => s + w.distanceKm, 0);
  const kmDeltaPct = prevKm7 > 0 ? ((km7 - prevKm7) / prevKm7) * 100 : null;

  const dur7 = w7.reduce((s, w) => s + w.durationSec, 0);
  const avgPace7 = km7 > 0 && dur7 > 0 ? dur7 / km7 : null;
  const prevDur7 = prevW7.reduce((s, w) => s + w.durationSec, 0);
  const prevAvgPace7 = prevKm7 > 0 && prevDur7 > 0 ? prevDur7 / prevKm7 : null;
  const paceDeltaSec = avgPace7 != null && prevAvgPace7 != null ? avgPace7 - prevAvgPace7 : null;

  const weeks = weeklyKm(workouts, t, 8);
  const hasAnyWeeklyKm = weeks.some((w) => w.km > 0);
  const next = nextSession(profile, workouts, t);

  const shoes = loadShoes();
  const shoeEntries = calcAllShoesMileage(workouts, shoes);
  const primaryShoe = shoeEntries.find((e) => e.shoe.isDefault) ?? shoeEntries[0] ?? null;
  const warningShoes = shoeEntries.filter((e) => e.status === 'warn' || e.status === 'replace');

  const weeklyTargetKm = profile.weeklyTargetKm ?? PENALTY_RULES[profile.targetDistance]?.weeklyKm ?? 30;
  const weeklyPct = weeklyTargetKm > 0 ? Math.min(100, Math.round((km7 / weeklyTargetKm) * 100)) : 0;

  const raceIso = profile.targetRaceDate > 0 ? isoFromRaceTs(profile.targetRaceDate) : null;
  const raceRemaining = raceIso ? remaining(raceIso, todayStr()) : null;

  const s = next?.session;
  const showName = s && s.name && s.kind !== 'race' && !['Easy Run', 'Long Run'].includes(s.name);
  const rawSessionTitle = s
    ? s.convertedFrom || s.test === 'maf'
      ? s.name
      : `${KIND_LABEL[s.kind]}${showName ? ` · ${s.name}` : ''}`
    : '';
  const sessionTitle = stripMarkdown(rawSessionTitle);

  const dateText =
    next && s
      ? next.isToday
        ? `Hari ini · ${formatDateId(s.date)}`
        : next.dayLabel === 'Besok'
          ? `Besok · ${formatDateId(s.date)}`
          : formatDateId(s.date)
      : null;

  const targetLoadPrimary =
    next && s
      ? s.kind === 'race'
        ? profile.targetDistance
        : s.distanceKm != null
          ? `${s.distanceKm.toFixed(1)} km`
          : next.durationMin != null
            ? `${Math.round(next.durationMin)} menit`
            : 'Sesuai jadwal'
      : '–';

  const targetLoadSub =
    next && s && s.kind !== 'race' && s.distanceKm != null && next.durationMin != null
      ? `Estimasi ${Math.round(next.durationMin)} menit`
      : next?.paceText
        ? `Pace ${next.paceText}`
        : null;

  const hrZoneName = s?.zone ? ZONE_LABEL[s.zone] : null;
  const acwrMeta = ACWR_META[load.status];

  // Ring progress SVG geometry
  const ringR = 38;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - weeklyPct / 100);

  return (
    <div className="space-y-5">
      <ScreenHeader
        title="Beranda"
        subtitle="Metrik inti, sesi berikutnya & analisa hari lomba"
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCoachOpen(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-full border border-[#BEF264]/35 bg-[#BEF264]/10 px-3.5 py-2 font-display text-xs font-bold text-[#BEF264] transition hover:border-[#BEF264]/55 hover:bg-[#BEF264]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              <Sparkles size={14} aria-hidden />
              <span>Pelatih AI</span>
            </button>

            {onOpenCatat && (
              <Button
                variant="primary"
                block={false}
                onClick={onOpenCatat}
                className="hidden min-h-[40px] gap-1.5 py-2 md:inline-flex"
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                <span className="whitespace-nowrap">Catat Lari</span>
              </Button>
            )}
          </div>
        }
      />

      {workouts.length === 0 && (
        <section className="flex flex-col justify-between gap-3 rounded-3xl border border-dashed border-[#BEF264]/45 bg-[#BEF264]/[0.06] p-4 sm:flex-row sm:items-center">
          <div className="text-sm text-zinc-200">
            Belum ada riwayat lari tercatat. Catat sesi pertamamu untuk mengaktifkan metrik ACWR, Efficiency Factor, dan proyeksi lomba.
          </div>
          {onOpenCatat && (
            <Button variant="primary" block={false} onClick={onOpenCatat} className="shrink-0 gap-1.5">
              <Plus size={16} strokeWidth={2.5} aria-hidden />
              <span className="whitespace-nowrap">Catat Lari Pertama</span>
            </Button>
          )}
        </section>
      )}

      {/* BENTO GRID UTAMA */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12 lg:gap-5">
        {/* ROW 1 LEFT: Kartu Sesi Berikutnya */}
        <section
          aria-label="Sesi Berikutnya"
          className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-[#121215] p-5 sm:p-6 lg:col-span-7"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[#BEF264]/10 blur-3xl"
          />

          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
              <span className="font-semibold text-zinc-300">
                Sesi Berikutnya
                {dateText && (
                  <>
                    <span className="mx-1.5 text-zinc-600" aria-hidden>·</span>
                    <span className={next?.isToday ? 'font-bold text-[#BEF264]' : 'text-zinc-300'}>
                      {dateText}
                    </span>
                  </>
                )}
              </span>
              {raceRemaining && raceRemaining.daysRemaining >= 0 && (
                <span className="font-mono text-xs tabular-nums text-zinc-400">
                  {profile.targetDistance} <span className="text-zinc-600" aria-hidden>·</span>{' '}
                  <strong className="text-zinc-200">H-{raceRemaining.daysRemaining}</strong>
                </span>
              )}
            </div>

            {next && s ? (
              <>
                <h2 className="mt-2.5 max-w-2xl font-display text-2xl font-bold leading-snug tracking-tight text-white sm:text-3xl">
                  <span className={KIND_ACCENT[s.kind] ?? 'text-[#BEF264]'}>{sessionTitle}</span>
                </h2>

                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <div className="sport-subcard p-3.5">
                    <dt className="text-xs font-medium text-zinc-400">Durasi / Jarak</dt>
                    <dd className="mt-1 font-mono text-lg font-extrabold tabular-nums text-sky-400 sm:text-xl">
                      {targetLoadPrimary}
                    </dd>
                    {targetLoadSub && (
                      <div className="mt-0.5 text-xs tabular-nums text-zinc-400">{targetLoadSub}</div>
                    )}
                  </div>

                  <div className="sport-subcard p-3.5">
                    <dt className="text-xs font-medium text-zinc-400">Target HR Zone</dt>
                    <dd className={`mt-1 font-mono text-lg font-extrabold tabular-nums sm:text-xl ${next.hr ? 'text-[#BEF264]' : 'text-zinc-300'}`}>
                      {next.hr ? `${next.hr[0]}–${next.hr[1]} bpm` : (hrZoneName ?? 'Sesuai HR')}
                    </dd>
                    <div className="mt-0.5 text-xs text-zinc-400">
                      {next.hr && hrZoneName ? hrZoneName : 'Lengkapi HR maks di Profil'}
                    </div>
                  </div>
                </dl>
              </>
            ) : (
              <div className="mt-3">
                <h2 className="font-display text-2xl font-bold text-white">Belum ada jadwal aktif</h2>
                <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-zinc-400">
                  Atur target tanggal lomba di Program atau langsung catat sesi lari mandiri hari ini.
                </p>
              </div>
            )}
          </div>

          <div className="relative mt-5 flex flex-wrap items-center gap-2.5 border-t border-white/[0.07] pt-4">
            {onOpenCatat && (
              <Button variant="primary" block={false} onClick={onOpenCatat} className="gap-2">
                <Plus size={17} strokeWidth={2.5} aria-hidden />
                <span className="whitespace-nowrap">Catat Lari</span>
              </Button>
            )}
            {onNavigate && (
              <Button variant="secondary" block={false} onClick={() => onNavigate('program')} className="gap-2">
                <CalendarDays size={16} aria-hidden />
                <span className="whitespace-nowrap">{next && s ? 'Lihat Program' : 'Atur Jadwal'}</span>
              </Button>
            )}
          </div>
        </section>

        {/* ROW 1 RIGHT: Grid 2x2 Metrik Utama */}
        <section
          aria-label="Metrik Utama"
          className="grid grid-cols-2 gap-3 lg:col-span-5"
        >
          {/* 1. Jarak Mingguan */}
          <div className="sport-card flex flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400">Jarak Mingguan</span>
              <Route size={15} className="text-sky-400" aria-hidden />
            </div>
            <div className="mt-2 font-mono text-2xl font-extrabold tabular-nums text-sky-400">
              {km7.toFixed(1)}
              <span className="ml-1 font-sans text-xs font-semibold text-zinc-400">km</span>
            </div>
            <div className="mt-1.5 text-xs tabular-nums">
              {kmDeltaPct == null ? (
                <span className="text-zinc-500">Minggu lalu: 0 km</span>
              ) : Math.abs(Math.round(kmDeltaPct)) === 0 ? (
                <span className="text-zinc-400">Sama vs minggu lalu</span>
              ) : kmDeltaPct > 0 ? (
                <span className="inline-flex items-center gap-0.5 font-medium text-[#BEF264]">
                  <ArrowUpRight size={13} aria-hidden />
                  +{Math.round(kmDeltaPct)}%
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 font-medium text-amber-400">
                  <ArrowDownRight size={13} aria-hidden />
                  {Math.round(kmDeltaPct)}%
                </span>
              )}
            </div>
          </div>

          {/* 2. Rata-rata Pace */}
          <div className="sport-card flex flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400">Rata-rata Pace</span>
              <Timer size={15} className="text-[#BEF264]" aria-hidden />
            </div>
            <div className="mt-2 font-mono text-2xl font-extrabold tabular-nums text-[#BEF264]">
              {avgPace7 != null ? fmtPace(avgPace7) : '–'}
              <span className="ml-1 font-sans text-xs font-semibold text-zinc-400">/km</span>
            </div>
            <div className="mt-1.5 text-xs tabular-nums">
              {paceDeltaSec == null ? (
                <span className="text-zinc-500">7 hari terakhir</span>
              ) : Math.abs(Math.round(paceDeltaSec)) < 1 ? (
                <span className="text-zinc-400">Stabil vs minggu lalu</span>
              ) : paceDeltaSec < 0 ? (
                <span className="inline-flex items-center gap-0.5 font-medium text-[#BEF264]">
                  <ArrowUpRight size={13} aria-hidden />
                  {Math.abs(Math.round(paceDeltaSec))} dtk lebih cepat
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 font-medium text-sky-400">
                  <ArrowDownRight size={13} aria-hidden />
                  {Math.round(paceDeltaSec)} dtk lebih santai
                </span>
              )}
            </div>
          </div>

          {/* 3. Skor ACWR (angka + badge status singkat) */}
          <div className="sport-card flex flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400">Skor ACWR</span>
              <Activity size={15} className="text-zinc-400" aria-hidden />
            </div>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-1.5">
              <span className={`font-mono text-2xl font-extrabold tabular-nums ${acwrMeta.accent}`}>
                {load.ratio != null ? load.ratio.toFixed(2) : '–'}
              </span>
              <StatusPill tone={acwrMeta.tone}>{acwrMeta.label}</StatusPill>
            </div>
            <div className="mt-1.5 text-xs tabular-nums text-zinc-400">
              TRIMP 7h: <strong className="font-mono text-zinc-200">{Math.round(load.acute)}</strong>
            </div>
          </div>

          {/* 4. Efficiency Factor (EF) */}
          <div className="sport-card flex flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400">Efficiency Factor</span>
              <HeartPulse size={15} className="text-sky-400" aria-hidden />
            </div>
            <div className="mt-2 font-mono text-2xl font-extrabold tabular-nums text-white">
              {displayEf != null ? displayEf.toFixed(2) : '–'}
              <span className="ml-1 font-sans text-xs font-semibold text-zinc-400">EF</span>
            </div>
            <div className="mt-1.5 text-xs tabular-nums">
              {ef.changePct != null ? (
                <span
                  className={`inline-flex items-center gap-0.5 font-medium ${
                    ef.changePct >= 2 ? 'text-[#BEF264]' : ef.changePct <= -3 ? 'text-amber-400' : 'text-zinc-400'
                  }`}
                >
                  {ef.changePct >= 0 ? (
                    <ArrowUpRight size={13} aria-hidden />
                  ) : (
                    <ArrowDownRight size={13} aria-hidden />
                  )}
                  {ef.changePct >= 0 ? '+' : ''}
                  {ef.changePct.toFixed(1)}% vs 14h
                </span>
              ) : (
                <span className="text-zinc-500">Kecepatan ÷ HR</span>
              )}
            </div>
          </div>
        </section>

        {/* ROW 2: Analisa D-Day Lomba */}
        <RaceDayCard profile={profile} workouts={workouts} className="lg:col-span-12" />

        {/* ROW 3 LEFT: Target Mingguan & Rotasi Sepatu */}
        <section
          aria-label="Target Volume Mingguan"
          className="sport-card flex flex-col justify-between p-5 lg:col-span-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-white">Target Mingguan</h2>
              <p className="mt-0.5 text-xs text-zinc-400">Akumulasi 7 hari terakhir</p>
            </div>
            <StatusPill tone={weeklyPct >= 100 ? 'good' : weeklyPct >= 50 ? 'info' : 'warn'}>
              {weeklyPct >= 100 ? 'Tercapai' : `${weeklyPct}%`}
            </StatusPill>
          </div>

          <div className="my-4 flex items-center gap-4">
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
              <svg viewBox="0 0 96 96" className="h-24 w-24 -rotate-90" role="img" aria-label={`Progres mingguan ${weeklyPct}%`}>
                <circle cx="48" cy="48" r={ringR} fill="none" stroke="#27272E" strokeWidth="8" />
                <circle
                  cx="48"
                  cy="48"
                  r={ringR}
                  fill="none"
                  stroke={weeklyPct >= 100 ? '#BEF264' : '#38BDF8'}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={ringC}
                  strokeDashoffset={ringOffset}
                  className="transition-all duration-300"
                />
              </svg>
              <span className="absolute font-mono text-base font-extrabold tabular-nums text-white">
                {weeklyPct}%
              </span>
            </div>

            <div className="min-w-0 space-y-1">
              <div className="font-mono text-2xl font-extrabold tabular-nums text-sky-400">
                {km7.toFixed(1)}
                <span className="ml-1 font-sans text-xs font-semibold text-zinc-400">/ {weeklyTargetKm} km</span>
              </div>
              <div className="text-xs tabular-nums text-zinc-400">
                {km7 >= weeklyTargetKm
                  ? `Melampaui target +${(km7 - weeklyTargetKm).toFixed(1)} km`
                  : `Tersisa ${(weeklyTargetKm - km7).toFixed(1)} km lagi`}
              </div>
              <div className="text-xs tabular-nums text-zinc-400">
                Target lomba: <strong className="text-zinc-200">{profile.targetDistance} · {fmtHms(profile.targetTimeSec)}</strong>
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.07] pt-3">
            {warningShoes.length > 0 ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-amber-300">
                  {warningShoes[0].shoe.name} perlu dicek
                </span>
                <span className="shrink-0 font-mono font-bold tabular-nums text-amber-300">
                  {warningShoes[0].totalKm.toFixed(0)}/{warningShoes[0].shoe.maxKm} km
                </span>
              </div>
            ) : primaryShoe ? (
              <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <Footprints size={14} className="shrink-0 text-zinc-400" aria-hidden />
                  <span className="truncate text-zinc-300">{primaryShoe.shoe.name}</span>
                </span>
                <span className="shrink-0 font-mono font-semibold tabular-nums text-zinc-200">
                  {primaryShoe.totalKm.toFixed(0)}/{primaryShoe.shoe.maxKm} km
                </span>
              </div>
            ) : (
              <div className="text-xs text-zinc-400">
                Tambahkan sepatu lari di Profil untuk melacak jarak pakai.
              </div>
            )}
          </div>
        </section>

        {/* ROW 3 RIGHT: Tren Volume 8 Minggu */}
        <section aria-label="Tren Volume 8 Minggu" className="sport-card flex flex-col justify-between p-5 lg:col-span-7">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-white">Volume 8 Minggu</h2>
              <p className="mt-0.5 text-xs text-zinc-400">Jarak tempuh mingguan (km)</p>
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums text-[#BEF264]">
              Minggu ini {km7.toFixed(1)} km
            </span>
          </div>

          {hasAnyWeeklyKm ? (
            <div className="mt-4 h-[210px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} margin={{ top: 18, right: 6, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="berandaCyanBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#38BDF8" stopOpacity={0.25} />
                    </linearGradient>
                    <linearGradient id="berandaLimeBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#BEF264" stopOpacity={1} />
                      <stop offset="100%" stopColor="#BEF264" stopOpacity={0.45} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={38} />
                  <Tooltip
                    content={<WeeklyBarTooltip targetKm={profile.weeklyTargetKm} />}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  {profile.weeklyTargetKm != null && profile.weeklyTargetKm > 0 && (
                    <ReferenceLine
                      y={profile.weeklyTargetKm}
                      stroke="#BEF264"
                      strokeDasharray="4 4"
                      strokeOpacity={0.65}
                    />
                  )}
                  <Bar dataKey="km" radius={[8, 8, 2, 2]} maxBarSize={36}>
                    {weeks.map((_, i) => (
                      <Cell
                        key={i}
                        fill={i === weeks.length - 1 ? 'url(#berandaLimeBar)' : 'url(#berandaCyanBar)'}
                      />
                    ))}
                    <LabelList
                      dataKey="km"
                      position="top"
                      fill="#a1a1aa"
                      fontSize={10}
                      formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : '')}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="my-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#18181D]/60 px-4 py-10 text-center">
              <Route size={22} className="text-zinc-500" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-zinc-300">Belum ada grafik volume</p>
              <p className="mt-1 text-xs text-zinc-500">Catat lari pertamamu untuk melihat tren jarak 8 minggu.</p>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
            <span>Batang hijau limau menandakan minggu berjalan.</span>
            {profile.weeklyTargetKm != null && (
              <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                Garis putus: target {profile.weeklyTargetKm} km
              </span>
            )}
          </div>
        </section>
      </div>

      {/* Modal / Drawer Pelatih AI */}
      <CoachModal
        open={coachOpen}
        onClose={() => setCoachOpen(false)}
        workouts={workouts}
        profile={profile}
      />
    </div>
  );
}
