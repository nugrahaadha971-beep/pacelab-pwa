import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { UserProfile } from '../analytics/types';
import QuickLog from './QuickLog';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Tombol + mengambang dan sheet "Catat sesi".
 * Isi sheet adalah QuickLog (dua tab: catat manual dan impor file); sheet menutup sendiri setelah berhasil menyimpan.
 */
export default function CatatSheet({ profile, onSaved }: { profile: UserProfile; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
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
      fabRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Catat sesi"
        className="fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-coral text-navy-950 shadow-lg shadow-coral/40 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
        style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
      >
        <Plus size={28} strokeWidth={2.75} aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setOpen(false)}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="catat-judul"
            onClick={(e) => e.stopPropagation()}
            className="mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-white/10 bg-navy-900 px-4 pt-3 shadow-2xl"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
          >
            <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-navy-700" />
            <div className="mb-3 flex items-center justify-between">
              <h2 id="catat-judul" className="text-lg font-bold">Catat sesi</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup"
                className="flex h-11 w-11 items-center justify-center rounded-full text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            <QuickLog profile={profile} onSaved={onSaved} onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
