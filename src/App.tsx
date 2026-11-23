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

type Tab = 'beranda' | 'program' | 'analitik' | 'riwayat' | 'profil';

const LEFT_TABS = [
  { id: 'beranda', label: 'Beranda', Icon: Home },
  { id: 'program', label: 'Program', Icon: CalendarDays },
] as const;

const RIGHT_TABS = [
  { id: 'analitik', label: 'Analitik', Icon: BarChart3 },
  { id: 'riwayat', label: 'Riwayat', Icon: History },
] as const;

export default function App() {
  const [tab, setTab] = useState<Tab>('beranda');
  const [catatOpen, setCatatOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  const reload = async () => {
    setProfile((await db.userProfile.get('default')) ?? null);
    setWorkouts(await db.workouts.toArray());
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  if (profile === undefined) return <p className="p-6 text-slate-400">Memuat…</p>;
  if (profile === null) {
    return (
      <div className="min-h-dvh bg-[#070709] text-slate-100">
        <main className="mx-auto max-w-md px-4 pt-6 pb-10">
          <Profil profile={null} onSaved={reload} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#070709] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#070709]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2.5">
          <button
            type="button"
            onClick={() => setTab('beranda')}
            className="font-display text-lg font-bold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
          >
            PACE<span className="text-volt">LAB</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('profil')}
            aria-label="Profil"
            aria-current={tab === 'profil' ? 'page' : undefined}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
              tab === 'profil'
                ? 'border-volt/50 bg-volt/15 text-volt'
                : 'border-white/10 bg-[#111216] text-slate-300 hover:border-white/20 hover:text-white'
            }`}
          >
            <User size={15} aria-hidden />
            <span>Profil</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pt-5 pb-32">
        {tab === 'beranda' && <Beranda profile={profile} workouts={workouts} />}
        {tab === 'program' && <Program profile={profile} workouts={workouts} onProfileChange={reload} />}
        {tab === 'analitik' && <Analitik profile={profile} workouts={workouts} />}
        {tab === 'riwayat' && <Riwayat workouts={workouts} reload={reload} />}
        {tab === 'profil' && <Profil profile={profile} workouts={workouts} onSaved={reload} />}
      </main>

      <CatatSheet profile={profile} open={catatOpen} onClose={() => setCatatOpen(false)} onSaved={reload} />

      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4"
        style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
      >
        <nav
          aria-label="Navigasi utama"
          className="pointer-events-auto mx-auto grid max-w-md grid-cols-5 items-center rounded-full border border-white/10 bg-[#111216]/90 px-2 py-1.5 shadow-2xl backdrop-blur-xl"
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
                className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                  active ? 'text-volt' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 2} aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}

          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setCatatOpen(true)}
              aria-label="Catat sesi"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-volt text-[#070709] shadow-[0_0_20px_rgba(200,255,0,0.35)] transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-[#111216]"
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
                className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                  active ? 'text-volt' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 2} aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
