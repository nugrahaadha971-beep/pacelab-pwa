// Util tanggal untuk WeekStrip. Murni (tanpa DOM) dan memakai UTC agar tidak terpengaruh zona waktu/DST.
import type { IsoDate } from '../plans/schedule.ts';

export const DAY_SHORT_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
export const MONTH_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

function utc(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoOf(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export interface WeekDay {
  iso: IsoDate;
  dayLabel: string;
  dayOfMonth: number;
}

/** `count` hari berurutan mulai dari `startIso` (bukan harus Senin: minggu program bisa mulai kapan saja). */
export function weekDays(startIso: IsoDate, count = 7): WeekDay[] {
  const start = utc(startIso);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return { iso: isoOf(d), dayLabel: DAY_SHORT_ID[d.getUTCDay()], dayOfMonth: d.getUTCDate() };
  });
}

/** "14 Des – 20 Des 2026"; tahun ditulis di kedua ujung bila rentang melintasi pergantian tahun. */
export function formatWeekRange(startIso: IsoDate, endIso: IsoDate): string {
  const a = utc(startIso);
  const b = utc(endIso);
  const left = `${a.getUTCDate()} ${MONTH_SHORT_ID[a.getUTCMonth()]}`;
  const right = `${b.getUTCDate()} ${MONTH_SHORT_ID[b.getUTCMonth()]}`;
  return a.getUTCFullYear() === b.getUTCFullYear()
    ? `${left} – ${right} ${b.getUTCFullYear()}`
    : `${left} ${a.getUTCFullYear()} – ${right} ${b.getUTCFullYear()}`;
}
