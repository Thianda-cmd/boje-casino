import { AnimatePresence, motion } from 'framer-motion'
import { useWallet } from '../store/wallet'
import { Coin } from './icons'
import { fmt } from '../lib/format'

export function Toasts() {
  const toasts = useWallet((s) => s.toasts)
  const dismiss = useWallet((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed right-3 top-[72px] z-50 flex w-[min(360px,calc(100vw-24px))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto flex items-center gap-3 rounded-xl border bg-panel2 px-4 py-3 text-left shadow-[0_16px_40px_-12px_rgba(0,0,0,.6)] ${
              t.kind === 'reward' ? 'border-gold/40' : t.kind === 'win' ? 'border-accent/40' : 'border-line'
            }`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${t.kind === 'reward' ? 'bg-gold' : t.kind === 'win' ? 'bg-accent' : t.kind === 'loss' ? 'bg-danger' : 'bg-sky'}`} />
            <span className="flex-1 text-[13px] font-semibold">{t.title}</span>
            {t.amount != null && (
              <span className="tnum flex items-center gap-1 text-[13px] font-bold text-accent">
                +{fmt(t.amount)} <Coin size={14} />
              </span>
            )}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
