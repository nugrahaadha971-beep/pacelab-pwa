/**
 * Komponen UI dasar PACELAB (tahap 1).
 * Berdiri sendiri: tidak mengimpor logika analitik, parser, atau database,
 * dan hanya memakai token Tailwind yang sudah ada (navy, coral, emerald, amber).
 */
import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Gabungkan nama kelas, abaikan nilai kosong. */
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-coral',
  info: 'text-sky-400',
  neutral: 'text-slate-100',
};

/* ---------------------------------------------------------------- Button */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-solid';

const BUTTON_STYLE: Record<ButtonVariant, string> = {
  primary: 'min-h-[46px] bg-coral text-navy-950 font-extrabold shadow-lg shadow-coral/20',
  secondary: 'min-h-[44px] border border-navy-600 bg-transparent text-slate-100 font-semibold',
  danger: 'min-h-[44px] border border-red-500/60 bg-transparent text-red-400 font-semibold',
  /** Tombol konfirmasi tindakan yang tidak bisa dibatalkan (di dalam dialog). */
  'danger-solid': 'min-h-[44px] bg-red-600 text-white font-bold',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Lebar penuh (default: true, sesuai pola tombol di layar HP). */
  block?: boolean;
}

/** Tombol dengan area sentuh minimal 44 px (utama 46 px) dan indikator fokus yang jelas. */
export function Button({ variant = 'primary', block = true, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        'inline-flex items-center justify-center rounded-xl px-4 py-2 font-display text-sm transition',
        'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_STYLE[variant],
        block && 'w-full',
        className,
      )}
    />
  );
}

/** Tombol aksi utama: coral penuh, tinggi minimal 46 px. */
export function PrimaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button variant="primary" {...props} />;
}

/* ----------------------------------------------------------------- Field */

const CONTROL =
  'mt-1 block min-h-[44px] w-full rounded-xl border bg-navy-900 px-3 py-2 text-slate-100 tabular-nums ' +
  'placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-coral/40 disabled:opacity-60';

interface FieldFrameProps {
  label: string;
  /** Penjelas kecil di bawah kolom, misalnya format yang diharapkan. */
  hint?: string;
  /** Pesan kesalahan; bila ada, kolom ditandai merah. */
  error?: string;
  /** Istilah teknis dalam kurung, ditampilkan redup di samping label. */
  term?: string;
}

function FieldFrame({
  id, label, term, hint, error, children,
}: FieldFrameProps & { id: string; children: ReactNode }) {
  return (
    <div className="block">
      <label htmlFor={id} className="text-sm font-semibold text-slate-200">
        {label}
        {term && <span className="ml-1 font-normal text-slate-400">({term})</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="mt-1 text-xs text-coral">{error}</p>
      ) : hint ? (
        <p id={`${id}-msg`} className="mt-1 text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

/** Kolom isian dengan label yang selalu terlihat (bukan placeholder). */
export function Field({
  label, term, hint, error, id, className, ...rest
}: FieldFrameProps & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} term={term} hint={hint} error={error}>
      <input
        id={fid}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        className={cx(CONTROL, error ? 'border-coral' : 'border-navy-700 focus:border-coral', className)}
      />
    </FieldFrame>
  );
}

/** Pilihan dropdown dengan label terlihat, gaya sama dengan Field. */
export function SelectField({
  label, term, hint, error, id, className, children, ...rest
}: FieldFrameProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} term={term} hint={hint} error={error}>
      <select
        id={fid}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        className={cx(CONTROL, error ? 'border-coral' : 'border-navy-700 focus:border-coral', className)}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

/* ------------------------------------------------------------ StatusPill */

const PILL_STYLE: Record<Exclude<Tone, 'neutral'>, string> = {
  good: 'bg-emerald-400/15 text-emerald-300',
  warn: 'bg-amber-400/15 text-amber-300',
  bad: 'bg-coral/15 text-coral',
  info: 'bg-sky-400/15 text-sky-300',
};

/** Status berupa titik warna + kata, sehingga tetap terbaca tanpa membedakan warna. */
export function StatusPill({ tone = 'info', children }: { tone?: Exclude<Tone, 'neutral'>; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', PILL_STYLE[tone])}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- KpiTile */

interface KpiTileProps {
  /** Nama dalam bahasa sehari-hari, mis. "Beban 7 hari". */
  label: string;
  /** Istilah teknis dalam kurung, mis. "TRIMP". */
  term?: string;
  value: string | number;
  /** Satuan, mis. "km". */
  unit?: string;
  /** Catatan tren satu baris, mis. "naik 8% dari minggu lalu". Warnanya mengikuti `tone`. */
  context?: string;
  tone?: Tone;
}

/** Kartu metrik Bento: label kecil kapital, angka besar, satuan, dan catatan berwarna. */
export function KpiTile({ label, term, value, unit, context, tone = 'neutral' }: KpiTileProps) {
  return (
    <div className="sport-card p-3.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {label}
        {term && <span className="ml-1 font-medium normal-case tracking-normal">({term})</span>}
      </div>
      <div className="mt-1 font-display text-2xl font-extrabold tabular-nums text-white">
        {value}
        {unit && <span className="ml-1 text-sm font-bold text-slate-400">{unit}</span>}
      </div>
      {context && <div className={cx('mt-0.5 text-xs font-medium tabular-nums', tone === 'neutral' ? 'text-slate-400' : TONE_TEXT[tone])}>{context}</div>}
    </div>
  );
}

/* ---------------------------------------------------------- ScreenHeader */

/** Judul layar seragam: judul, subjudul ringkas, dan slot tombol aksi di kanan. */
export function ScreenHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/* -------------------------------------------------------------- InfoHint */

/**
 * Istilah dengan penjelasan satu kalimat yang dibuka dengan ketukan.
 * Contoh: <InfoHint label="Rasio beban" term="ACWR">Membandingkan beban 7 hari ...</InfoHint>
 */
export function InfoHint({ label, term, children }: { label: string; term?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <span className="inline-block align-baseline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panel}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        <span>{label}{term && <span className="text-slate-400"> ({term})</span>}</span>
        <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-navy-700 text-[10px] font-extrabold text-slate-300">i</span>
        <span className="sr-only">{open ? 'Tutup penjelasan' : 'Buka penjelasan'}</span>
      </button>
      {open && (
        <span id={panel} role="note" className="mt-1.5 block rounded-xl bg-navy-700 px-3 py-2 text-xs font-normal leading-relaxed text-slate-200">
          {children}
        </span>
      )}
    </span>
  );
}

/* ---------------------------------------------------------- SegmentedTabs */

/**
 * Tab bergaya pill gelap (dua atau lebih pilihan), tinggi minimal 44 px.
 * Panel isi dibuat oleh pemanggil dengan id `${idBase}-panel-${id}`
 * dan aria-labelledby `${idBase}-tab-${id}`.
 */
export function SegmentedTabs<T extends string>({
  idBase, label, tabs, value, onChange,
}: {
  idBase: string;
  label: string;
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid gap-1 rounded-2xl border border-white/[0.07] bg-navy-900 p-1"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`${idBase}-panel-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cx(
            'min-h-[44px] rounded-xl font-display text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral',
            value === t.id ? 'bg-navy-700 text-white shadow-sm' : 'text-slate-400',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
