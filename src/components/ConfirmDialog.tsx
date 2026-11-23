import type { ReactNode } from 'react';
import { Button } from './ui';
import { useDialog } from './useDialog';

/**
 * Dialog konfirmasi di dalam aplikasi, pengganti `confirm()` bawaan browser.
 * Fokus awal jatuh pada tombol Batal (pilihan yang aman).
 */
export default function ConfirmDialog({ id, title, children, confirmLabel, onConfirm, onCancel }: {
  id: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useDialog<HTMLDivElement>(onCancel);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-6" onClick={onCancel}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-judul`} aria-describedby={`${id}-isi`}
        onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-white/10 bg-navy-800 p-5 shadow-2xl">
        <div aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-lg font-extrabold text-red-300">!</div>
        <h2 id={`${id}-judul`} className="mt-3 text-lg font-bold">{title}</h2>
        <div id={`${id}-isi`} className="mt-1 text-sm leading-relaxed text-slate-300">{children}</div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onCancel}>Batal</Button>
          <Button variant="danger-solid" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
