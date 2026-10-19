import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { VAULT_MIN } from './engine'
import type { AwayReport } from './casino'
import { CashIcon } from './art'
import { VaultDoorIcon } from './door'
import { Rolling, useStable } from './kit'
import { coinWord, plural, spell } from './words'

/*
  "While you were away": the card that greets a player coming back. How long they were gone, the Cash their
  managers made meanwhile (counting up from nothing), the coins the vault gathered (rolling up to what it holds now),
  the milestones waiting, and one button that takes it all: the vault and every milestone ready, each paid on its
  own. A player with no managers yet hears that they would have earned with one.
*/

const fmtCoins = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function AwayCard({
  r,
  coins,
  dueCoins,
  onCollect,
  onClose,
}: {
  r: AwayReport
  /** coins in the vault now, and the coins of the milestones waiting now */
  coins: number
  dueCoins: number
  /** take it all (the vault, then the milestones); gets where the press was, for the coins to fly from */
  onCollect: (x: number, y: number) => void
  onClose: () => void
}) {
  const [cash, setCash] = useState(0)
  const [shown, setShown] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      setCash(r.cash)
      setShown(true)
    }, 350)
    return () => clearTimeout(t)
  }, [r])
  const close = useStable(onClose)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [close])
  const vault = shown ? coins : r.vaultBefore
  const capped = r.ms > r.limit
  const full = coins >= r.cap
  const vaultReady = coins >= VAULT_MIN
  const total = (vaultReady ? coins : 0) + dueCoins
  const take = vaultReady && dueCoins > 0 ? 'Collect & claim all' : vaultReady ? 'Collect' : dueCoins > 0 ? 'Claim milestones' : ''
  return (
    <motion.div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-3 sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="While you were away"
        initial={{ y: 40, scale: 0.92, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 24, opacity: 0, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 340, damping: 26 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-full max-w-[420px] overflow-hidden rounded-3xl p-5 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] ring-1 ring-white/10"
        style={{ background: 'radial-gradient(130% 90% at 50% 0%, #34295a 0%, #1a2236 55%, #121d2b 100%)' }}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,207,74,.35),transparent)]" />
        <div className="relative text-[12px] font-extrabold uppercase tracking-[.16em] text-gold">While you were away</div>
        <div className="relative mt-1 text-[26px] font-black leading-tight text-white">Welcome back!</div>
        <div className="relative mt-1 text-[13px] font-semibold text-muted">
          You were gone {spell(r.ms)}
          {capped && r.managers > 0 && <span className="block text-[12px] text-dim">Managers work up to {spell(r.limit)} while you're away</span>}
        </div>

        {r.managers > 0 ? (
          <div className="relative mt-4 rounded-2xl bg-black/30 px-4 py-3 ring-1 ring-[#5fe39a]/20">
            <div className="text-[12px] font-bold text-muted">Your {plural(r.managers, 'manager')} earned</div>
            <div className="mt-1 flex items-center justify-center gap-2">
              <CashIcon size={30} />
              <Rolling value={cash} className="text-[32px] font-black leading-none tracking-tight text-[#5fe39a]" />
            </div>
          </div>
        ) : (
          <div className="relative mt-4 rounded-2xl bg-black/30 px-4 py-3 text-[12.5px] font-semibold leading-snug text-muted">Hire a manager and your casino earns Cash while you're away too.</div>
        )}

        <div className="relative mt-2.5 flex items-center gap-3 rounded-2xl bg-black/30 px-3.5 py-3 text-left ring-1 ring-gold/25">
          <VaultDoorIcon size={44} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold text-muted">The Coin Vault filled up</div>
            <div className="flex items-baseline gap-1.5 text-white">
              <Rolling value={vault} format={fmtCoins} className="text-[22px] font-black leading-none" />
              <span className="tnum text-[12px] font-bold text-white/45">/ {fmtCoins(r.cap)}</span>
              <Coin size={15} className="self-center" />
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/40">
              <motion.div className="h-full w-full origin-left rounded-full bg-gold" initial={{ scaleX: Math.min(1, r.vaultBefore / r.cap) }} animate={{ scaleX: Math.min(1, vault / r.cap) }} transition={{ delay: 0.35, duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
            </div>
          </div>
        </div>
        {full && <div className="relative mt-1.5 text-[11.5px] font-bold text-gold/80">It's full: it stopped filling until you collect.</div>}
        {dueCoins > 0 && r.due > 0 && (
          <div className="relative mt-2 flex items-center justify-center gap-1.5 text-[12.5px] font-bold text-gold">
            {plural(r.due, 'milestone')} ready · {coinWord(dueCoins)} <Coin size={13} />
          </div>
        )}

        <div className="relative mt-4 flex flex-col gap-2">
          {take && (
            <motion.button
              ref={btn}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                const b = btn.current?.getBoundingClientRect()
                onCollect(b ? b.left + b.width / 2 : innerWidth / 2, b ? b.top + b.height / 2 : innerHeight / 2)
              }}
              className="relative flex h-12 items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] text-[15px] font-black text-[#3a2400] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)]"
            >
              <span className="ty-motion pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/45" style={{ animation: 'ty-shine 2.4s ease-in-out infinite' }} />
              <span className="relative flex items-center gap-1.5">
                {take} · <span className="tnum">{fmtCoins(total)}</span> <Coin size={16} />
              </span>
            </motion.button>
          )}
          <button onClick={onClose} className={`h-11 rounded-xl text-[14px] font-extrabold transition ${take ? 'text-muted hover:bg-white/[.05] hover:text-ink' : 'bg-gradient-to-b from-[#4fdc82] to-[#2bb862] text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.14)]'}`}>
            Back to the floor
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
