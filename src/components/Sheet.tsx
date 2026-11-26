import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialog } from './useDialog';

/** Sheet dasar: latar gelap #121215, panel dari bawah/tengah, area aman iOS/Android. */
export default function Sheet({
  title,
  titleId,
  onClose,
  children,
  footer,
  z = 'z-50',
  wide = false,
}: {
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  z?: string;
  wide?: boolean;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div
      className={`fixed inset-0 ${z} flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4`}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90dvh] ${
          footer ? 'flex flex-col overflow-hidden' : 'overflow-y-auto px-5 pt-3 sm:pt-5'
        } rounded-t-3xl border border-white/10 bg-[#121215] shadow-2xl sm:rounded-3xl`}
        style={
          footer
            ? undefined
            : { paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }
        }
      >
        <div className={footer ? 'shrink-0 px-5 pt-3 sm:pt-5' : undefined}>
          <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#27272E] sm:hidden" />
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={titleId} className="font-display text-lg font-bold text-white">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEF264]"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
        </div>

        {footer ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
            <div
              className="shrink-0 border-t border-white/10 bg-[#121215] px-5 pt-3"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            >
              {footer}
            </div>
          </>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
