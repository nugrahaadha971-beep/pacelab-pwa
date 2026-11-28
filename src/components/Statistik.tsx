import { BarChart3, History } from 'lucide-react';
import type { UserProfile, Workout } from '../analytics/types';
import Analitik from './Analitik';
import Riwayat from './Riwayat';
import { ScreenHeader } from './ui';

export type StatistikSubTab = 'analitik' | 'riwayat';

interface StatistikProps {
  profile: UserProfile;
  workouts: Workout[];
  reload: () => void;
  subTab: StatistikSubTab;
  onSubTabChange: (tab: StatistikSubTab) => void;
}

export default function Statistik({
  profile,
  workouts,
  reload,
  subTab,
  onSubTabChange,
}: StatistikProps) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <ScreenHeader title="Statistik" subtitle="Ringkasan performa & riwayat aktivitas" />

        <div
          role="tablist"
          aria-label="Tampilan Statistik"
          className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-[#121215] p-1 sm:w-64"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'analitik'}
            onClick={() => onSubTabChange('analitik')}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 font-display text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
              subTab === 'analitik'
                ? 'bg-[#BEF264] text-[#09090B]'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <BarChart3 size={15} aria-hidden />
            <span>Analitik</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'riwayat'}
            onClick={() => onSubTabChange('riwayat')}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 font-display text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] ${
              subTab === 'riwayat'
                ? 'bg-[#BEF264] text-[#09090B]'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            <History size={15} aria-hidden />
            <span>Riwayat</span>
          </button>
        </div>
      </div>

      {subTab === 'analitik' ? (
        <Analitik profile={profile} workouts={workouts} embedded />
      ) : (
        <div className="mx-auto max-w-4xl">
          <Riwayat profile={profile} workouts={workouts} reload={reload} embedded />
        </div>
      )}
    </div>
  );
}
