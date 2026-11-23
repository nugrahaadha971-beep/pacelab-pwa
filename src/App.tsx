import { useEffect, useState } from 'react';
import { Home, CalendarDays, BarChart3, History, User } from 'lucide-react';
import { db } from './db/database';
import type { UserProfile, Workout } from './analytics/types';
import Beranda from './components/Beranda';
import Program from './components/Program';
import Analitik from './components/Analitik';
import Riwayat from './components/Riwayat';
import Profil from './components/Profil';
import CatatSheet from './components/CatatSheet';

type Tab = 'beranda' | 'program' | 'analitik' | 'riwayat' | 'profil';
const TABS = [
  { id: 'beranda', label: 'Beranda', Icon: Home },
  { id: 'program', label: 'Program', Icon: CalendarDays },
  { id: 'analitik', label: 'Analitik', Icon: BarChart3 },
  { id: 'riwayat', label: 'Riwayat', Icon: History },
  { id: 'profil', label: 'Profil', Icon: User },
] as const;

export default function App() {
  const [tab, setTab] = useState<Tab>('beranda');
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
      <main className="mx-auto max-w-md px-4 pt-6">
        <Profil profile={null} onSaved={reload} />
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-navy-900 text-slate-100">
      <main className="mx-auto max-w-md px-4 pt-6 pb-28">
        {tab === 'beranda' && <Beranda profile={profile} workouts={workouts} />}
        {tab === 'program' && <Program profile={profile} workouts={workouts} onProfileChange={reload} />}
        {tab === 'analitik' && <Analitik profile={profile} workouts={workouts} />}
        {tab === 'riwayat' && <Riwayat workouts={workouts} reload={reload} />}
        {tab === 'profil' && <Profil profile={profile} onSaved={reload} />}
      </main>
      <CatatSheet profile={profile} onSaved={reload} />
      <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 border-t border-navy-700 bg-navy-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)} aria-label={label} aria-current={tab === id ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 py-2 text-[11px] ${tab === id ? 'text-coral' : 'text-slate-400'}`}>
              <Icon size={20} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
