import { memo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { VAULT_MIN } from './engine'
import { VaultRing } from './door'
import { Rolling } from './kit'
import { spell } from './words'

/*
  The Coin Vault: the one place Cash turns into real coins, filling by the hour up to what it holds, and the reason
  to come back. On a wide screen it is a card over the panel: the door in a ring that fills, the coins in it rolling
  up, its rate and when it will be full, and a big Collect. On a phone it is a pill over the floor with the same
  ring and a Collect of its own. A full vault glows and its button shines; it stops filling until it is emptied.
  (Right after a sale it can hold more than the new casino's vault does at first: it keeps them, and shows full.)
*/

const fmtCoins = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** the vault with its Collect: coins in it now, what it holds, its rate an hour; `onCollect` gets where the press
 *  was, for the coins to fly from */
export const VaultCard = memo(function VaultCard({ coins, cap, rate, onCollect, compact }: { coins: number; cap: number; rate: number; onCollect: (x: number, y: number) => void; compact: boolean }) {
  const [spin, setSpin] = useState(0)
  const btn = useRef<HTMLButtonElement>(null)
  const fill = cap > 0 ? Math.min(1, coins / cap) : 0
  const full = fill >= 1
  const ready = coins >= VAULT_MIN
  const left = full ? 0 : ((cap - coins) / Math.max(0.01, rate)) * 3_600_000
  const press = () => {
    if (!ready) return
    const r = btn.current?.getBoundingClientRect()
    setSpin((s) => s + 1)
    onCollect(r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight / 2)
  }
  const shine = full && <span className="ty-motion pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/45" style={{ animation: 'ty-shine 2.4s ease-in-out infinite' }} />

  if (compact)
    return (
      <div className={`pointer-events-auto flex shrink-0 items-center gap-2 rounded-2xl bg-[#0b1621]/85 py-1.5 pl-1.5 pr-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,.8)] ring-1 backdrop-blur-sm ${full ? 'ring-gold/70' : 'ring-white/10'}`}>
        <VaultRing fill={fill} size={38} spin={spin} />
        <div className="min-w-0 whitespace-nowrap leading-none">
          <div className="flex items-center gap-1 text-[15px] font-black text-white">
            <Rolling value={coins} format={fmtCoins} />
            <Coin size={13} />
          </div>
          <div className="tnum mt-1 text-[10.5px] font-bold text-white/55">{full ? 'Vault full' : `Full in ${spell(left)}`}</div>
        </div>
        <motion.button
          ref={btn}
          whileTap={ready ? { scale: 0.92 } : undefined}
          onClick={press}
          disabled={!ready}
          aria-label="Collect the Coin Vault"
          className={`relative h-9 overflow-hidden rounded-xl px-2.5 text-[12.5px] font-black transition ${ready ? 'bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] text-[#3a2400] shadow-[inset_0_-2px_0_rgba(0,0,0,.16)]' : 'bg-white/[.06] text-white/35'}`}
        >
          {shine}
          <span className="relative">Collect</span>
        </motion.button>
      </div>
    )

  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-3.5 ring-1 transition-[box-shadow] duration-500 ${full ? 'ring-gold/60 shadow-[0_0_40px_-12px_rgba(247,197,72,.75)]' : 'ring-white/[.05]'}`}
      style={{ background: 'radial-gradient(120% 140% at 12% 0%, #3a2c14 0%, #1d2230 48%, #142131 100%)' }}
    >
      <div className="flex items-center gap-3.5">
        <VaultRing fill={fill} size={74} spin={spin} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] font-extrabold uppercase tracking-[.12em] text-gold">Coin Vault</span>
            <span className="tnum text-[11.5px] font-bold text-white/55">+{rate.toLocaleString('en-US', { maximumFractionDigits: 1 })} / hour</span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5 text-white">
            <Rolling value={coins} format={fmtCoins} className="text-[26px] font-black leading-none tracking-tight" />
            <span className="tnum text-[13px] font-bold text-white/45">/ {fmtCoins(cap)}</span>
            <Coin size={17} className="self-center" />
          </div>
          <div className="tnum mt-1.5 text-[12px] font-semibold text-white/60">{full ? 'Full: collect it to keep it filling' : ready ? `Full in ${spell(left)}` : `Filling · full in ${spell(left)}`}</div>
        </div>
      </div>
      <motion.button
        ref={btn}
        whileTap={ready ? { scale: 0.97 } : undefined}
        onClick={press}
        disabled={!ready}
        className={`relative mt-3 flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl text-[15px] font-black transition ${
          ready ? 'bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] text-[#3a2400] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] hover:brightness-105' : 'cursor-default bg-white/[.06] text-white/40'
        }`}
      >
        {shine}
        {ready ? (
          <span className="relative flex items-center gap-1.5">
            Collect <span className="tnum">{fmtCoins(coins)}</span> <Coin size={16} />
          </span>
        ) : (
          <span className="relative flex items-center gap-1.5">
            Collect from {VAULT_MIN} <Coin size={15} />
          </span>
        )}
      </motion.button>
    </div>
  )
})
