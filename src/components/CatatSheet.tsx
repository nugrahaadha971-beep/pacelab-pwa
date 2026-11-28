import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { UserProfile } from '../analytics/types';
import QuickLog from './QuickLog';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Sheet "Catat Lari" yang dipicu dari tombol + Electric Lime di navigasi atau CTA Beranda.
 */
export default function CatatSheet({
  profile,
  open,
  onClose,
  onSaved,
}: {
  profile: UserProfile;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prevFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="catat-judul"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#121215] px-5 pt-3 shadow-2xl sm:rounded-3xl sm:pt-5"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#27272E] sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="catat-judul" className="font-display text-lg font-bold text-white">Catat Lari</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <QuickLog profile={profile} onSaved={onSaved} onDone={onClose} />
      </div>
    </div>
  );
}
