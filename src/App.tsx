import { useEffect, useState } from 'react';
import { BarChart3, CalendarDays, History, Home, Plus, User } from 'lucide-react';
import { db } from './db/database';
import type { UserProfile, Workout } from './analytics/types';
import Beranda from './components/Beranda';
import Program from './components/Program';
import Analitik from './components/Analitik';
import Riwayat from './components/Riwayat';
import Profil from './components/Profil';
import CatatSheet from './components/CatatSheet';
import BrandLogo from './components/BrandLogo';
import { fmtHms } from './components/format';

export type AppTab = 'beranda' | 'program' | 'analitik' | 'riwayat' | 'profil';

const LEFT_TABS = [
  { id: 'beranda', label: 'Beranda', Icon: Home },
  { id: 'program', label: 'Program', Icon: CalendarDays },
] as const;

const RIGHT_TABS = [
  { id: 'analitik', label: 'Analitik', Icon: BarChart3 },
  { id: 'riwayat', label: 'Riwayat', Icon: History },
] as const;

const MAIN_TABS = [...LEFT_TABS, ...RIGHT_TABS] as const;

export default function App() {
  const [tab, setTab] = useState<AppTab>('beranda');
  const [catatOpen, setCatatOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  const reload = async () => {
    setProfile((await db.userProfile.get('default')) ?? null);
    setWorkouts(await db.workouts.toArray());
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  useEffect(() => {
    const splash = document.getElementById('initial-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    const timer = window.setTimeout(() => {
      splash.remove();
    }, 320);
    return () => window.clearTimeout(timer);
  }, []);

  if (profile === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#09090B] text-sm text-zinc-400">
        Memuat data latihan…
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="min-h-dvh bg-[#09090B] text-zinc-100">
        <main className="mx-auto max-w-xl px-4 pb-12 pt-8 sm:px-6">
          <Profil profile={null} onSaved={reload} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#09090B] text-zinc-100">
      {/* Desktop Left Sidebar (>= 768px): 4 Tab Utama + CTA Catat Lari */}
      <aside
        aria-label="Navigasi desktop"
        className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-60 md:flex-col md:border-r md:border-white/10 md:bg-[#0B0B0E]/90 md:backdrop-blur-md lg:w-64"
      >
        <div className="flex h-16 items-center px-5">
          <button
            type="button"
            onClick={() => setTab('beranda')}
            aria-label="PACELAB Beranda"
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <BrandLogo size={32} showText />
          </button>
        </div>

        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => setCatatOpen(true)}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-[#BEF264] px-4 font-display text-sm font-extrabold text-[#09090B] shadow-[0_0_24px_rgba(190,242,100,0.2)] transition duration-150 hover:bg-[#d4fc82] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090B]"
          >
            <Plus size={18} strokeWidth={2.6} aria-hidden />
            <span className="whitespace-nowrap">Catat Lari</span>
          </button>
        </div>

        <nav aria-label="Menu utama" className="flex-1 space-y-1 px-3">
          {MAIN_TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-2xl border px-3.5 text-sm font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                  active
                    ? 'border-[#BEF264]/25 bg-[#BEF264]/10 text-[#BEF264]'
                    : 'border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.4 : 2} aria-hidden />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="rounded-2xl border border-white/[0.07] bg-[#121215] px-3.5 py-3 text-xs">
            <div className="text-[11px] font-medium text-zinc-400">Target Lomba</div>
            <div className="mt-1 flex items-baseline justify-between gap-2 tabular-nums">
              <span className="font-mono text-sm font-bold text-[#BEF264]">{profile.targetDistance}</span>
              <span className="font-mono text-zinc-200">{fmtHms(profile.targetTimeSec)}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Top Header (< 768px) — Logo + Ikon Profil Pojok Kanan Atas */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#09090B]/85 backdrop-blur-md md:hidden">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <button
            type="button"
            onClick={() => setTab('beranda')}
            aria-label="PACELAB Beranda"
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <BrandLogo size={30} showText />
          </button>
          <button
            type="button"
            onClick={() => setTab('profil')}
            aria-label="Profil"
            aria-current={tab === 'profil' ? 'page' : undefined}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
              tab === 'profil'
                ? 'border-[#BEF264]/45 bg-[#BEF264]/15 text-[#BEF264]'
                : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/20 hover:text-white'
            }`}
          >
            <User size={18} aria-hidden />
          </button>
        </div>
      </header>

      {/* Main Content Canvas */}
      <div className="md:pl-60 lg:pl-64">
        {/* Desktop Top Utility Bar (>= 768px) — Ikon Profil Pojok Kanan Atas */}
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-end border-b border-white/10 bg-[#09090B]/85 px-6 backdrop-blur-md md:flex lg:px-8">
          <button
            type="button"
            onClick={() => setTab('profil')}
            aria-label="Profil & Pengaturan"
            aria-current={tab === 'profil' ? 'page' : undefined}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
              tab === 'profil'
                ? 'border-[#BEF264]/45 bg-[#BEF264]/15 text-[#BEF264]'
                : 'border-white/10 bg-[#121215] text-zinc-300 hover:border-white/20 hover:text-white'
            }`}
          >
            <User size={15} aria-hidden />
            <span className="whitespace-nowrap">Profil</span>
          </button>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 sm:px-6 md:pb-12 md:pt-6 lg:px-8">
          {tab === 'beranda' && (
            <Beranda
              profile={profile}
              workouts={workouts}
              onNavigate={setTab}
            />
          )}
          {tab === 'program' && (
            <div className="mx-auto max-w-4xl">
              <Program profile={profile} workouts={workouts} onProfileChange={reload} />
            </div>
          )}
          {tab === 'analitik' && <Analitik profile={profile} workouts={workouts} />}
          {tab === 'riwayat' && (
            <div className="mx-auto max-w-4xl">
              <Riwayat profile={profile} workouts={workouts} reload={reload} />
            </div>
          )}
          {tab === 'profil' && (
            <div className="mx-auto max-w-3xl">
              <Profil profile={profile} workouts={workouts} onSaved={reload} />
            </div>
          )}
        </main>
      </div>

      <CatatSheet profile={profile} open={catatOpen} onClose={() => setCatatOpen(false)} onSaved={reload} />

      {/* Mobile Fixed Bottom Navigation Bar (< 768px): 4 Tab + 1 Tombol Tengah (+) */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#09090B]/90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <nav
          aria-label="Navigasi utama"
          className="pointer-events-auto mx-auto grid max-w-lg grid-cols-5 items-center px-2 py-1.5"
        >
          {LEFT_TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                  active ? 'text-[#BEF264]' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {active && (
                  <span aria-hidden className="absolute top-0.5 h-0.5 w-6 rounded-full bg-[#BEF264]" />
                )}
                <Icon size={20} strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}

          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setCatatOpen(true)}
              aria-label="Catat lari"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[#BEF264] text-[#09090B] shadow-[0_0_20px_rgba(190,242,100,0.35)] transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090B]"
            >
              <Plus size={24} strokeWidth={2.75} aria-hidden />
            </button>
          </div>

          {RIGHT_TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
                  active ? 'text-[#BEF264]' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {active && (
                  <span aria-hidden className="absolute top-0.5 h-0.5 w-6 rounded-full bg-[#BEF264]" />
                )}
                <Icon size={20} strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
