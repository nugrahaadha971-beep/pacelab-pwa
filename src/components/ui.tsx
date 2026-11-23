/**
 * Komponen UI dasar PACELAB.
 * Palet OLED Obsidian (#070709 / #111216 / #191B22) dengan aksen Volt Lime (#C8FF00) & Hyper Coral (#FF4D2D).
 */
import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Gabungkan nama kelas, abaikan nilai kosong. */
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-volt',
  warn: 'text-amber-400',
  bad: 'text-coral',
  info: 'text-sky-400',
  neutral: 'text-slate-100',
};

/* ---------------------------------------------------------------- Button */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-solid';

const BUTTON_STYLE: Record<ButtonVariant, string> = {
  primary: 'min-h-[48px] bg-volt text-[#070709] font-extrabold shadow-[0_0_20px_rgba(200,255,0,0.25)] hover:brightness-105',
  secondary: 'min-h-[44px] border border-white/10 bg-[#191B22] text-slate-100 font-semibold hover:border-white/20',
  danger: 'min-h-[44px] border border-coral/60 bg-transparent text-coral font-semibold hover:bg-coral/10',
  /** Tombol konfirmasi tindakan yang tidak bisa dibatalkan (di dalam dialog). */
  'danger-solid': 'min-h-[44px] bg-coral text-[#070709] font-extrabold',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Lebar penuh (default: true, sesuai pola tombol di layar HP). */
  block?: boolean;
}

/** Tombol dengan area sentuh minimal 44 px (utama 48 px) dan indikator fokus Volt Lime yang jelas. */
export function Button({ variant = 'primary', block = true, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        'inline-flex items-center justify-center rounded-2xl px-4 py-2 font-display text-sm transition',
        'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-[#070709]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_STYLE[variant],
        block && 'w-full',
        className,
      )}
    />
  );
}

/** Tombol aksi utama: Volt Lime penuh dengan glow halus. */
export function PrimaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button variant="primary" {...props} />;
}

/* ----------------------------------------------------------------- Field */

const CONTROL =
  'mt-1 block min-h-[44px] w-full rounded-2xl border bg-[#111216] px-3.5 py-2 text-slate-100 tabular-nums ' +
  'placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-volt/35 disabled:opacity-60';

interface FieldFrameProps {
  label: string;
  /** Penjelas kecil di bawah kolom, misalnya format yang diharapkan. */
  hint?: string;
  /** Pesan kesalahan; bila ada, kolom ditandai Hyper Coral. */
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
        className={cx(CONTROL, error ? 'border-coral' : 'border-white/10 focus:border-volt', className)}
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
        className={cx(CONTROL, error ? 'border-coral' : 'border-white/10 focus:border-volt', className)}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

/* ------------------------------------------------------------ StatusPill */

const PILL_STYLE: Record<Exclude<Tone, 'neutral'>, string> = {
  good: 'bg-volt/15 text-volt',
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

/** Kartu metrik Bento: label kecil, angka besar JetBrains Mono, satuan, dan catatan berwarna. */
export function KpiTile({ label, term, value, unit, context, tone = 'neutral' }: KpiTileProps) {
  return (
    <div className="sport-card p-4">
      <div className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {label}
        {term && <span className="ml-1 font-medium normal-case tracking-normal">({term})</span>}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-extrabold tabular-nums text-white">
        {value}
        {unit && <span className="ml-1 font-sans text-xs font-bold text-slate-400">{unit}</span>}
      </div>
      {context && <div className={cx('mt-1 font-sans text-xs font-medium', tone === 'neutral' ? 'text-slate-400' : TONE_TEXT[tone])}>{context}</div>}
    </div>
  );
}

/* ---------------------------------------------------------- ScreenHeader */

/** Judul layar seragam: judul Space Grotesk, subjudul ringkas, dan slot tombol aksi di kanan. */
export function ScreenHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/* -------------------------------------------------------------- InfoHint */

/**
 * Istilah dengan penjelasan satu kalimat yang dibuka dengan ketukan.
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
        className="inline-flex min-h-[44px] items-center gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
      >
        <span>{label}{term && <span className="text-slate-400"> ({term})</span>}</span>
        <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#191B22] text-[10px] font-extrabold text-slate-300">i</span>
        <span className="sr-only">{open ? 'Tutup penjelasan' : 'Buka penjelasan'}</span>
      </button>
      {open && (
        <span id={panel} role="note" className="mt-1.5 block rounded-2xl border border-white/[0.08] bg-[#191B22] px-3 py-2 text-xs font-normal leading-relaxed text-slate-200">
          {children}
        </span>
      )}
    </span>
  );
}

/* ---------------------------------------------------------- SegmentedTabs */

/**
 * Tab bergaya pill gelap, tinggi minimal 44 px, aksen Volt Lime saat aktif.
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
      className="grid gap-1 rounded-full border border-white/[0.08] bg-[#111216] p-1"
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
            'min-h-[40px] rounded-full font-display text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt',
            value === t.id ? 'bg-volt text-[#070709] shadow-sm' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
