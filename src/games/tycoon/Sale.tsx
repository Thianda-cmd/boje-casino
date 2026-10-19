import { useEffect, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { CITIES, STAR_BONUS, cityIndex, hasPerk, milestonesDue, starsOnSale, type Save } from './engine'
import type { Sold } from './casino'
import { CityEmblem, StarIcon } from './art'
import { useStable } from './kit'

/*
  Selling the casino: the confirmation (what it brings, what the player keeps and what starts over, a new city if the
  Stars reach one, and the milestones waiting, which are paid on the way out), then the celebration once it is sold.
*/

const mult = (stars: number) => `×${(1 + stars * STAR_BONUS).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

function List({ title, tone, items }: { title: string; tone: string; items: ReactNode[] }) {
  return (
    <div className="rounded-xl bg-stage px-3 py-2.5">
      <div className={`text-[11.5px] font-extrabold uppercase tracking-wider ${tone}`}>{title}</div>
      <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] font-semibold text-muted">
        {items.map((x, k) => (
          <li key={k} className="flex gap-1.5">
            <span className={tone}>•</span>
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SellConfirm({ s, onSell, onClose }: { s: Save; onSell: () => void; onClose: () => void }) {
  const add = starsOnSale(s)
  const city = cityIndex(s.stars)
  const next = cityIndex(s.stars + add)
  const after = s.stars + add
  const due = milestonesDue(s)
  const dueCoins = due.reduce((a, m) => a + m.coins, 0)
  return (
    <Modal onClose={onClose} title="Sell the casino?" width={460}>
      <div className="flex flex-col items-center rounded-2xl px-4 py-4 text-center" style={{ background: 'radial-gradient(120% 120% at 50% 0%, #3d2f10 0%, #1c2433 70%)' }}>
        <div className="flex items-center gap-2 text-[34px] font-black leading-none text-gold">
          +{add.toLocaleString('en-US')} <StarIcon size={32} />
        </div>
        <div className="mt-2 text-[13px] font-bold text-muted">
          All pay {mult(s.stars)} → <span className="text-[#5fe39a]">{mult(after)}</span>
        </div>
        {next > city && (
          <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-black/30 px-3 py-2 text-left">
            <CityEmblem k={next} size={38} />
            <div className="text-[13px] font-extrabold leading-tight text-white">
              You move to {CITIES[next].name}!
              <div className="text-[11.5px] font-semibold text-muted">A new city: the vault holds more, and fills faster as you reopen.</div>
            </div>
          </div>
        )}
      </div>
      {due.length > 0 && (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-gold/[.09] px-3 py-2.5 text-left ring-1 ring-gold/25">
          <Coin size={22} />
          <div className="text-[12.5px] font-semibold leading-snug text-muted">
            <b className="text-white">
              {due.length === 1 ? '1 milestone' : `${due.length} milestones`} ready ({dueCoins.toLocaleString('en-US')} coins)
            </b>{' '}
            {due.length === 1 ? 'is' : 'are'} paid to you as you sell.
          </div>
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <List title="You keep" tone="text-accent" items={['Your Stars, and every one adds 2%', 'The Coin Vault and its coins', 'Milestones, paid and to come', 'Whales tipped, chips caught']} />
        <List
          title="Starts over"
          tone="text-[#ff8a8a]"
          items={['Cash', hasPerk(after, 3) ? 'Attractions (you start with 10 Claw Machines and 5 Slot Machines)' : 'Attractions', 'Managers', 'Upgrades']}
        />
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onSell}
          className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b sm:flex-1 from-[#ffe08a] to-[#f2a93b] text-[15px] font-black text-[#3a2400] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] hover:brightness-105"
        >
          Sell for {add.toLocaleString('en-US')} <StarIcon size={17} />
        </motion.button>
        <button onClick={onClose} className="h-12 rounded-xl bg-raised sm:flex-1 text-[14px] font-extrabold text-ink transition hover:bg-hover">
          Keep playing
        </button>
      </div>
    </Modal>
  )
}

/** the casino sold: the Stars it brought, the milestones it paid on the way out, and the new city if there is one */
export function SoldCard({ sold, onClose }: { sold: Sold; onClose: () => void }) {
  const moved = sold.city > sold.wasCity
  // it closes by itself after a while (the page's handler may change meanwhile: the timer keeps running)
  const close = useStable(onClose)
  useEffect(() => {
    const t = setTimeout(close, moved ? 6500 : 4500)
    return () => clearTimeout(t)
  }, [moved, close])
  return (
    <motion.div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        initial={{ scale: 0.7, opacity: 0, rotate: -3 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="relative w-full max-w-[380px] overflow-hidden rounded-3xl px-6 pb-6 pt-7 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] ring-1 ring-gold/40"
        style={{ background: 'radial-gradient(130% 100% at 50% 0%, #4a3812 0%, #23243a 60%, #151f2e 100%)' }}
      >
        {Array.from({ length: 14 }, (_, k) => (
          <motion.span
            key={k}
            className="absolute left-1/2 top-[38%]"
            initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
            animate={{ x: Math.cos((k / 14) * Math.PI * 2) * 150, y: Math.sin((k / 14) * Math.PI * 2) * 110, scale: 1, opacity: 0, rotate: 180 }}
            transition={{ duration: 1.4, delay: 0.15 + (k % 3) * 0.05, ease: 'easeOut' }}
          >
            <StarIcon size={18} />
          </motion.span>
        ))}
        <div className="relative text-[12px] font-extrabold uppercase tracking-[.18em] text-gold">Casino sold</div>
        <div className="relative mt-3 flex items-center justify-center gap-2 text-[44px] font-black leading-none text-white">
          +{sold.added.toLocaleString('en-US')} <StarIcon size={40} />
        </div>
        <div className="relative mt-2 text-[13.5px] font-bold text-muted">
          {sold.stars.toLocaleString('en-US')} Stars: all pay <span className="text-[#5fe39a]">{mult(sold.stars)}</span>
        </div>
        {sold.coins > 0 && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.35 }} className="relative mx-auto mt-3 flex w-fit items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1 text-[13px] font-black text-gold ring-1 ring-gold/30">
            +{sold.coins.toLocaleString('en-US')} <Coin size={15} /> from {sold.milestones === 1 ? 'a milestone' : `${sold.milestones} milestones`}
          </motion.div>
        )}
        {moved && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="relative mt-5 flex flex-col items-center">
            <CityEmblem k={sold.city} size={84} />
            <div className="mt-2 text-[22px] font-black text-white">Welcome to {CITIES[sold.city].name}!</div>
          </motion.div>
        )}
        <button onClick={onClose} className="relative mt-5 h-11 w-full rounded-xl bg-gradient-to-b from-[#4fdc82] to-[#2bb862] text-[14px] font-black text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.14)]">
          Open the new casino
        </button>
      </motion.div>
    </motion.div>
  )
}
