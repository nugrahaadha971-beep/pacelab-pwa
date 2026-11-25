/**
 * Komponen UI dasar PACELAB.
 * Palet Athlete Dark Mode (#09090B / #121215 / #18181D) dengan aksen Electric Lime (#BEF264) & Cyan (#38BDF8).
 */
import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Gabungkan nama kelas, abaikan nilai kosong. */
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-[#BEF264]',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
  info: 'text-sky-400',
  neutral: 'text-zinc-100',
};

/* ---------------------------------------------------------------- Button */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-solid';

const BUTTON_STYLE: Record<ButtonVariant, string> = {
  primary: 'min-h-[48px] bg-[#BEF264] text-[#09090B] font-extrabold shadow-[0_0_24px_rgba(190,242,100,0.2)] hover:bg-[#d4fc82]',
  secondary: 'min-h-[44px] border border-white/10 bg-[#18181D] text-zinc-100 font-semibold hover:border-white/20 hover:bg-[#202027]',
  danger: 'min-h-[44px] border border-rose-500/50 bg-transparent text-rose-400 font-semibold hover:bg-rose-500/10',
  /** Tombol konfirmasi tindakan yang tidak bisa dibatalkan (di dalam dialog). */
  'danger-solid': 'min-h-[44px] bg-rose-500 text-white font-extrabold hover:bg-rose-400',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Lebar penuh (default: true, sesuai pola tombol di layar HP). */
  block?: boolean;
}

/** Tombol dengan area sentuh minimal 44 px (utama 48 px) dan indikator fokus Electric Lime yang jelas. */
export function Button({ variant = 'primary', block = true, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        'inline-flex items-center justify-center rounded-2xl px-4 py-2 font-display text-sm transition duration-150',
        'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090B]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_STYLE[variant],
        block && 'w-full',
        className,
      )}
    />
  );
}

/** Tombol aksi utama: Electric Lime penuh dengan glow halus. */
export function PrimaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button variant="primary" {...props} />;
}

/* ----------------------------------------------------------------- Field */

const CONTROL =
  'mt-1 block min-h-[44px] w-full rounded-2xl border bg-[#121215] px-3.5 py-2 text-zinc-100 tabular-nums ' +
  'placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#BEF264]/35 disabled:opacity-60';

interface FieldFrameProps {
  label: string;
  /** Penjelas kecil di bawah kolom, misalnya format yang diharapkan. */
  hint?: string;
  /** Pesan kesalahan; bila ada, kolom ditandai Rose. */
  error?: string;
  /** Istilah teknis dalam kurung, ditampilkan redup di samping label. */
  term?: string;
}

function FieldFrame({
  id, label, term, hint, error, children,
}: FieldFrameProps & { id: string; children: ReactNode }) {
  return (
    <div className="block">
      <label htmlFor={id} className="text-sm font-semibold text-zinc-200">
        {label}
        {term && <span className="ml-1 font-normal text-zinc-400">({term})</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="mt-1 text-xs text-rose-400">{error}</p>
      ) : hint ? (
        <p id={`${id}-msg`} className="mt-1 text-xs text-zinc-400">{hint}</p>
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
        className={cx(CONTROL, error ? 'border-rose-500' : 'border-white/10 focus:border-[#BEF264]', className)}
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
        className={cx(CONTROL, error ? 'border-rose-500' : 'border-white/10 focus:border-[#BEF264]', className)}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

/* ------------------------------------------------------------ StatusPill */

const PILL_STYLE: Record<Exclude<Tone, 'neutral'>, string> = {
  good: 'border border-[#BEF264]/30 bg-[#BEF264]/10 text-[#BEF264]',
  warn: 'border border-amber-400/30 bg-amber-400/10 text-amber-300',
  bad: 'border border-rose-500/30 bg-rose-500/10 text-rose-400',
  info: 'border border-sky-400/30 bg-sky-400/10 text-sky-300',
};

/** Status berupa titik indikator + label teks eksplisit agar tetap terbaca tanpa mengandalkan warna saja. */
export function StatusPill({ tone = 'info', children }: { tone?: Exclude<Tone, 'neutral'>; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', PILL_STYLE[tone])}>
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
  /** Opsional: kelas warna aksen untuk angka utama. */
  accentClass?: string;
}

/** Kartu metrik Bento: label ringkas, angka besar JetBrains Mono tabular-nums, satuan, dan catatan tren. */
export function KpiTile({ label, term, value, unit, context, tone = 'neutral', accentClass }: KpiTileProps) {
  return (
    <div className="sport-card flex flex-col justify-between p-4 transition-colors hover:border-white/15">
      <div className="font-sans text-xs font-medium text-zinc-400">
        {label}
        {term && <span className="ml-1 text-zinc-500">({term})</span>}
      </div>
      <div className={cx('mt-2 font-mono text-2xl font-extrabold tracking-tight tabular-nums sm:text-[26px]', accentClass ?? 'text-white')}>
        {value}
        {unit && <span className="ml-1 font-sans text-xs font-semibold text-zinc-400">{unit}</span>}
      </div>
      {context && (
        <div className={cx('mt-1.5 font-sans text-xs font-medium tabular-nums', tone === 'neutral' ? 'text-zinc-400' : TONE_TEXT[tone])}>
          {context}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- ScreenHeader */

/** Judul layar seragam: judul Plus Jakarta Sans, subjudul ringkas, dan slot tombol aksi di kanan. */
export function ScreenHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
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
        className="inline-flex min-h-[44px] items-center gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
      >
        <span>{label}{term && <span className="text-zinc-400"> ({term})</span>}</span>
        <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#18181D] text-[10px] font-extrabold text-zinc-300">i</span>
        <span className="sr-only">{open ? 'Tutup penjelasan' : 'Buka penjelasan'}</span>
      </button>
      {open && (
        <span id={panel} role="note" className="mt-1.5 block rounded-2xl border border-white/10 bg-[#18181D] px-3 py-2 text-xs font-normal leading-relaxed text-zinc-200">
          {children}
        </span>
      )}
    </span>
  );
}

/* ---------------------------------------------------------- SegmentedTabs */

/**
 * Tab bergaya segmented control gelap, tinggi minimal 44 px, aksen Electric Lime saat aktif.
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
      className="grid gap-1 rounded-2xl border border-white/10 bg-[#121215] p-1"
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
            'min-h-[40px] whitespace-nowrap rounded-xl px-3 font-display text-sm font-bold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]',
            value === t.id ? 'bg-[#BEF264] text-[#09090B] shadow-sm' : 'text-zinc-400 hover:text-zinc-100',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
