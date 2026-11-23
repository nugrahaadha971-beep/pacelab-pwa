import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { UserProfile } from '../analytics/types';
import QuickLog from './QuickLog';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Sheet "Catat sesi" yang dipicu dari tombol + Volt Lime di floating dock.
 * Isi sheet adalah QuickLog (catat manual & impor file); menutup otomatis setelah simpan.
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
    const prevOverflow = document.body.style.overflow;
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
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="catat-judul"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#111216] px-4 pt-3 shadow-2xl"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#272A35]" />
        <div className="mb-3 flex items-center justify-between">
          <h2 id="catat-judul" className="font-display text-lg font-bold text-white">Catat Sesi</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-300 hover:bg-[#191B22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
          >
            <X size={22} aria-hidden />
          </button>
        </div>
        <QuickLog profile={profile} onSaved={onSaved} onDone={onClose} />
      </div>
    </div>
  );
}
