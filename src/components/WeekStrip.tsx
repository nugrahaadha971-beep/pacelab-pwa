import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SessionCategory } from '../plans/workoutTypes';
import type { IsoDate } from '../plans/schedule';
import { todayStr } from './format';
import { formatWeekRange, weekDays } from './weekDays';

export interface WeekSessionDot {
  id: string;
  date: IsoDate; // YYYY-MM-DD
  category: SessionCategory;
}

interface WeekStripProps {
  weekStartIso: IsoDate; // Senin minggu aktif (YYYY-MM-DD)
  /** Hari setelah tanggal ini (mis. minggu terakhir sebelum lomba) ditampilkan redup dan tidak bisa dipilih. */
  weekEndIso?: IsoDate;
  todayIso?: IsoDate;
  selectedDate: IsoDate | null;
  sessions: WeekSessionDot[];
  onSelectDate: (iso: IsoDate | null) => void;
  onShiftWeek?: (delta: -1 | 1) => void;
  canShiftPrev?: boolean;
  canShiftNext?: boolean;
}

const DOT_COLOR: Record<SessionCategory, string> = {
  easy: 'bg-emerald-400',
  long: 'bg-purple-400',
  speed: 'bg-sky-400',
  race: 'bg-amber-400',
};

const KIND_ID: Record<SessionCategory, string> = {
  easy: 'Easy',
  long: 'Long Run',
  speed: 'Speed',
  race: 'Lomba',
};

const ARROW_CLS =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#18181D] text-zinc-200 transition hover:border-white/20 hover:text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]';

export const WeekStrip: React.FC<WeekStripProps> = ({
  weekStartIso,
  weekEndIso,
  todayIso,
  selectedDate,
  sessions,
  onSelectDate,
  onShiftWeek,
  canShiftPrev = true,
  canShiftNext = true,
}) => {
  const days = weekDays(weekStartIso);
  const lastIso = weekEndIso ?? days[days.length - 1].iso;
  const effectiveToday = todayIso ?? todayStr();

  return (
    <section
      aria-label="Pilih hari dalam minggu ini"
      className="sport-card space-y-2.5 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        {onShiftWeek ? (
          <button
            type="button"
            onClick={() => onShiftWeek(-1)}
            disabled={!canShiftPrev}
            aria-label="Minggu sebelumnya"
            className={ARROW_CLS}
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
        ) : (
          <span className="w-11" aria-hidden />
        )}
        <div className="font-display text-xs font-bold tabular-nums text-zinc-100 sm:text-sm">
          {formatWeekRange(weekStartIso, lastIso)}
        </div>
        {onShiftWeek ? (
          <button
            type="button"
            onClick={() => onShiftWeek(1)}
            disabled={!canShiftNext}
            aria-label="Minggu berikutnya"
            className={ARROW_CLS}
          >
            <ChevronRight size={18} aria-hidden />
          </button>
        ) : (
          <span className="w-11" aria-hidden />
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Hari dalam minggu ini">
        {days.map((d) => {
          const dayDots = sessions.filter((s) => s.date === d.iso);
          const outside = d.iso > lastIso;
          const isSelected = selectedDate === d.iso;
          const isToday = d.iso === effectiveToday;
          const sessionText =
            dayDots.length === 0
              ? 'tidak ada sesi'
              : dayDots.map((s) => KIND_ID[s.category]).join(', ');

          return (
            <button
              key={d.iso}
              type="button"
              disabled={outside}
              aria-pressed={isSelected}
              aria-label={`${d.dayLabel} ${d.dayOfMonth}${isToday ? ', hari ini' : ''}, ${sessionText}`}
              onClick={() => onSelectDate(isSelected ? null : d.iso)}
              className={`flex min-h-[58px] flex-col items-center justify-center rounded-xl border py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] disabled:opacity-30 ${
                isSelected
                  ? 'border-[#BEF264] bg-[#BEF264]/15 text-white'
                  : isToday
                    ? 'border-zinc-500/70 bg-[#18181D] text-zinc-100'
                    : 'border-white/[0.07] bg-[#09090B]/70 text-zinc-400 hover:border-white/20'
              }`}
            >
              <span className={`text-[10px] ${isToday ? 'font-bold text-[#BEF264]' : ''}`}>
                {d.dayLabel}
              </span>
              <span className="my-0.5 font-mono text-xs font-extrabold tabular-nums text-zinc-100">
                {d.dayOfMonth}
              </span>
              <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                {dayDots.slice(0, 3).map((dot) => (
                  <span
                    key={dot.id}
                    className={`h-1.5 w-1.5 rounded-full ${DOT_COLOR[dot.category]}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="flex items-center justify-between border-t border-white/[0.08] pt-2 text-xs">
          <span className="text-zinc-400">Menampilkan satu hari</span>
          <button
            type="button"
            onClick={() => onSelectDate(null)}
            className="min-h-[44px] px-2 font-semibold text-[#BEF264] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            Semua hari
          </button>
        </div>
      )}
    </section>
  );
};

export default WeekStrip;
