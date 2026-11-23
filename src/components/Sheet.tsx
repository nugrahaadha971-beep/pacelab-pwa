import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialog } from './useDialog';

/** Sheet dasar: latar gelap, panel dari bawah, area aman iOS/Android, perilaku dialog lengkap. */
export default function Sheet({ title, titleId, onClose, children, z = 'z-50' }: {
  title: string; titleId: string; onClose: () => void; children: ReactNode; z?: string;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div className={`fixed inset-0 ${z} flex items-end bg-black/70 backdrop-blur-sm`} onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#111216] px-4 pt-3 shadow-2xl"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#272A35]" />
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-lg font-bold text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Tutup"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-300 hover:bg-[#191B22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt">
            <X size={22} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
