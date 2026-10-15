import { useEffect, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { IconX } from './icons'

/** Centred dialog on desktop, bottom sheet on phones. Render inside AnimatePresence. */
export function Modal({ onClose, children, title, width = 460 }: { onClose: () => void; children: ReactNode; title?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ y: 40, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: width }}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,.85)] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center gap-3 px-5 pb-1 pt-4">
          <div className="min-w-0 flex-1 text-[17px] font-extrabold">{title}</div>
          <button onClick={onClose} className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-panel2 hover:text-ink" aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-2">{children}</div>
      </motion.div>
    </motion.div>
  )
}
