/*
  The Shop: the cosmetics sold for coins (src/store/cosmetics.ts, every one with a price), by kind and rarity.

  At the top, today's pick (one item not yet owned, the same all day) beside the wallet; then the filters and the
  grid. Each card shows the item on a stage lit in its rarity's colour, its price, and whether it is owned or worn.
  A press opens the confirm step: the item tried on the player's own profile card, the price and the balance after,
  then Buy (buyCosmetic). A purchase is celebrated in the dialog (a burst of confetti in the item's colours) and
  offers to wear it straight away. Coins are play money: the copy says how to earn more, never how to buy them.
*/
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal } from '../../components/Modal'
import { Coin, IconCheck, IconLock } from '../../components/icons'
import { CosmeticPreview, RARITY } from '../../art/cosmetics'
import { fmt } from '../../lib/format'
import { navigate } from '../../lib/router'
import { sfx } from '../../lib/sound'
import { dayKey } from '../../store/rewards'
import { useWallet } from '../../store/wallet'
import { COSMETICS, canWear, cosmetic, type Cosmetic, type CosmeticKind, type Rarity } from '../../store/cosmetics'
import { Coins, EASE, Glow, IconBag, IconSparkle, KIND_NAME, LOOK_KEY, Panel, RARITY_ORDER, RarityTag, equip, useIdentity, useLook, useWardrobe } from './kit'
import { ProfileCard } from './ProfileHeader'

const FOR_SALE = COSMETICS.filter((c) => c.price !== undefined)
type Sort = 'price' | '-price' | 'rarity'
const KINDS: { id: 'all' | CosmeticKind; name: string }[] = [
  { id: 'all', name: 'Everything' },
  { id: 'frame', name: 'Frames' },
  { id: 'banner', name: 'Banners' },
  { id: 'nameColor', name: 'Name colours' },
  { id: 'title', name: 'Titles' },
  { id: 'avatar', name: 'Avatars' },
]

/** whether a cosmetic is what the player wears now */
function useWorn() {
  const look = useLook()
  const { avatar } = useIdentity()
  return (c: Cosmetic) => (c.kind === 'avatar' ? `avatar:${avatar}` === c.id : look[LOOK_KEY[c.kind]] === c.id)
}

export function ShopTab() {
  const balance = useWallet((s) => s.balance)
  const w = useWardrobe()
  const worn = useWorn()
  const [kind, setKind] = useState<'all' | CosmeticKind>('all')
  const [rarity, setRarity] = useState<'all' | Rarity>('all')
  const [sort, setSort] = useState<Sort>('price')
  const [buying, setBuying] = useState<string | null>(null)
  const owned = FOR_SALE.filter((c) => canWear(c.id, w)).length
  const cheapest = Math.min(Infinity, ...FOR_SALE.filter((c) => !canWear(c.id, w)).map((c) => c.price!))
  // today's pick: the same item all day, among those not owned yet (the priciest kinds first)
  const pick = useMemo(() => {
    const left = FOR_SALE.filter((c) => !canWear(c.id, w) && (c.rarity === 'epic' || c.rarity === 'legendary'))
    const pool = left.length ? left : FOR_SALE.filter((c) => !canWear(c.id, w))
    if (!pool.length) return null
    let h = 0
    for (const ch of dayKey()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return pool[h % pool.length]
  }, [w])
  const items = FOR_SALE.filter((c) => (kind === 'all' || c.kind === kind) && (rarity === 'all' || c.rarity === rarity)).sort((a, b) =>
    sort === 'price' ? a.price! - b.price! : sort === '-price' ? b.price! - a.price! : RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || b.price! - a.price!,
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {pick ? <Featured c={pick} onBuy={() => setBuying(pick.id)} /> : <AllOwned />}
        <Panel className="flex flex-col">
          <Glow color="#f7c548" className="-right-16 -top-16 h-56 w-56" opacity={0.16} />
          <div className="text-[12.5px] font-bold text-dim">Your balance</div>
          <div className="tnum mt-1 flex items-center gap-2 text-[30px] font-black leading-none tracking-tight" data-shop-balance>
            {fmt(balance)} <Coin size={24} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-panel2/70 px-3 py-2.5 ring-1 ring-white/[.04]">
              <div className="text-[11.5px] font-bold text-dim">Collection</div>
              <div className="tnum text-[17px] font-black">
                {owned} <span className="text-[13px] text-dim">/ {FOR_SALE.length}</span>
              </div>
            </div>
            <div className="rounded-xl bg-panel2/70 px-3 py-2.5 ring-1 ring-white/[.04]">
              <div className="text-[11.5px] font-bold text-dim">Cheapest left</div>
              <div className="tnum text-[17px] font-black">{cheapest === Infinity ? '–' : fmt(cheapest, 0)}</div>
            </div>
          </div>
          <p className="mt-auto pt-4 text-[12px] leading-relaxed text-muted">Coins are play money. Earn more from the daily bonus, missions, challenges and level-ups.</p>
          <button onClick={() => navigate('/rewards')} className="mt-3 h-11 rounded-xl bg-[linear-gradient(180deg,#ffd75e,#f2b134)] text-[14px] font-extrabold text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] transition hover:brightness-105">
            Get free coins
          </button>
        </Panel>
      </div>

      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5 sm:mx-0 sm:px-0">
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-bold transition ${kind === k.id ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.06)]' : 'bg-panel text-muted hover:bg-panel2 hover:text-ink'}`}
            >
              {k.name}
              <span className="tnum text-dim">{k.id === 'all' ? FOR_SALE.length : FOR_SALE.filter((c) => c.kind === k.id).length}</span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex gap-1 rounded-full bg-panel p-1">
            {(['all', ...RARITY_ORDER] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRarity(r)}
                aria-label={r === 'all' ? 'Every rarity' : RARITY[r].name}
                title={r === 'all' ? 'Every rarity' : RARITY[r].name}
                className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold transition ${rarity === r ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
              >
                {r === 'all' ? 'All' : <span className="h-2.5 w-2.5 rounded-full" style={{ background: RARITY[r].color }} />}
                {r !== 'all' && <span className="hidden 2xl:inline">{RARITY[r].name}</span>}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort"
            className="h-9 rounded-full border-0 bg-panel px-3.5 text-[12.5px] font-bold text-muted outline-none transition hover:text-ink"
          >
            <option value="price">Price: low to high</option>
            <option value="-price">Price: high to low</option>
            <option value="rarity">Rarest first</option>
          </select>
        </div>
      </div>

      <motion.div layout className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <AnimatePresence initial={false}>
          {items.map((c) => (
            <ShopCard key={c.id} c={c} owned={canWear(c.id, w)} worn={worn(c)} afford={balance >= c.price!} onOpen={() => setBuying(c.id)} />
          ))}
        </AnimatePresence>
      </motion.div>
      {!items.length && <div className="rounded-2xl border border-dashed border-line bg-panel/50 p-8 text-center text-[13.5px] text-muted">Nothing in the shop matches these filters.</div>}

      <AnimatePresence>{buying && <BuyModal key={buying} id={buying} onClose={() => setBuying(null)} />}</AnimatePresence>
    </div>
  )
}

function Featured({ c, onBuy }: { c: Cosmetic; onBuy: () => void }) {
  const R = RARITY[c.rarity]
  const { avatar } = useIdentity()
  return (
    <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/[.05]" style={{ background: `radial-gradient(120% 140% at 85% 30%, ${R.color}40, transparent 55%), linear-gradient(135deg, #172d3f, #0d1b28)` }} data-featured={c.id}>
      <div className="pointer-events-none absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 14px)' }} />
      <div className="relative flex flex-col-reverse gap-4 p-5 sm:flex-row sm:items-center sm:p-7">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-[.12em] text-gold">
            <IconSparkle size={16} /> Today's pick
          </div>
          <div className="mt-2 text-[28px] font-black leading-tight tracking-tight sm:text-[34px]">{c.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-muted">
            <RarityTag rarity={c.rarity} /> {KIND_NAME[c.kind]} · {c.line}
          </div>
          <button onClick={onBuy} className="mt-5 inline-flex h-12 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#ffd75e,#f2b134)] px-6 text-[15px] font-extrabold text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] transition hover:brightness-105">
            <Coin size={18} /> {fmt(c.price!, 0)}
          </button>
        </div>
        <motion.div className="mx-auto shrink-0 sm:mx-0" initial={{ scale: 0.9, rotate: -4, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }}>
          <div className="bjc-float drop-shadow-[0_18px_30px_rgba(0,0,0,.5)]">
            <CosmeticPreview id={c.id} size={c.kind === 'banner' ? 170 : 160} avatar={avatar} />
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function AllOwned() {
  return (
    <Panel className="flex flex-col items-center justify-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 text-gold">
        <IconCheck size={26} />
      </span>
      <div className="mt-3 text-[18px] font-black">You own the whole shop</div>
      <div className="mt-1 text-[13px] text-muted">Every cosmetic for sale is yours. Wear them in Customize.</div>
    </Panel>
  )
}

function ShopCard({ c, owned, worn, afford, onOpen }: { c: Cosmetic; owned: boolean; worn: boolean; afford: boolean; onOpen: () => void }) {
  const R = RARITY[c.rarity]
  const { avatar } = useIdentity()
  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: EASE }}
      whileHover={{ y: -3 }}
      onClick={onOpen}
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-panel text-left shadow-[0_18px_40px_-28px_rgba(0,0,0,.9)] ring-1 ring-white/[.04] transition-shadow hover:ring-white/10"
      data-shop-item={c.id}
    >
      <div className="relative flex h-[128px] items-center justify-center overflow-hidden sm:h-[140px]" style={{ background: `radial-gradient(circle at 50% 45%, ${R.color}38, transparent 68%), linear-gradient(180deg, #14293b, #0c1925)` }}>
        <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${R.color}, transparent)` }} />
        <div className="transition-transform duration-300 group-hover:scale-[1.06]">
          <CosmeticPreview id={c.id} size={c.kind === 'banner' ? 104 : 96} avatar={avatar} />
        </div>
        {(owned || worn) && (
          <span className={`absolute left-2 top-2.5 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-extrabold ${worn ? 'bg-accent text-[#032412]' : 'bg-black/55 text-ink backdrop-blur'}`}>
            <IconCheck size={11} /> {worn ? 'Wearing' : 'Owned'}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="truncate text-[14px] font-extrabold">{c.name}</div>
        <div className="mt-0.5 truncate text-[11.5px] font-bold">
          <span className="text-dim">{KIND_NAME[c.kind]} · </span>
          <span style={{ color: R.color }}>{R.name}</span>
        </div>
        <div className="mt-2.5">
          {owned ? (
            <span className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-stage text-[12.5px] font-bold text-muted">{worn ? 'Worn now' : 'In your wardrobe'}</span>
          ) : (
            <span className={`tnum flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13.5px] font-extrabold transition ${afford ? 'bg-gold/15 text-gold group-hover:bg-gold group-hover:text-[#2a1c00]' : 'bg-stage text-dim'}`}>
              {afford ? <Coin size={15} /> : <IconLock size={13} />}
              {fmt(c.price!, 0)}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}

/** a burst of confetti in the item's colours, from the middle of its box */
function Confetti({ colors }: { colors: string[] }) {
  const bits = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => {
        const a = (i / 34) * Math.PI * 2 + (i % 3) * 0.2
        const d = 90 + ((i * 37) % 70)
        return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8 - 30, r: ((i * 53) % 360) - 180, c: colors[i % colors.length], w: i % 3 ? 7 : 5, h: i % 3 ? 11 : 5, delay: (i % 5) * 0.02 }
      }),
    [colors],
  )
  return (
    <div className="pointer-events-none absolute left-1/2 top-[40%] z-20" aria-hidden>
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="absolute rounded-[2px]"
          style={{ width: b.w, height: b.h, background: b.c, marginLeft: -b.w / 2, marginTop: -b.h / 2 }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.4 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 90], rotate: b.r * 3, opacity: [1, 1, 0], scale: 1 }}
          transition={{ duration: 1.5, delay: b.delay, ease: [0.15, 0.7, 0.4, 1], times: [0, 0.5, 1] }}
        />
      ))}
    </div>
  )
}

/** the confirm step, then the celebration */
export function BuyModal({ id, onClose }: { id: string; onClose: () => void }) {
  const c = cosmetic(id)!
  const R = RARITY[c.rarity]
  const balance = useWallet((s) => s.balance)
  const buy = useWallet((s) => s.buyCosmetic)
  const pushToast = useWallet((s) => s.pushToast)
  const look = useLook()
  const me = useIdentity()
  const xp = useWallet((s) => s.xp)
  const w = useWardrobe()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const owned = canWear(id, w)
  const tryLook = c.kind === 'avatar' ? look : { ...look, [LOOK_KEY[c.kind]]: id }
  const tryAvatar = c.kind === 'avatar' ? Number(id.split(':')[1]) : me.avatar
  const short = Math.max(0, c.price! - balance)
  const confirm = () => {
    const r = buy(id)
    if (r === 'ok') {
      sfx.bigWin()
      setDone(true)
    } else pushToast({ kind: 'info', title: r === 'coins' ? 'Not enough coins for that.' : r === 'owned' ? 'You already own that.' : "That isn't for sale." })
  }
  const wear = async () => {
    setBusy(true)
    const err = await equip(c)
    setBusy(false)
    if (err) pushToast({ kind: 'info', title: err })
    else {
      sfx.click()
      pushToast({ kind: 'reward', title: `Now wearing ${c.name}` })
      onClose()
    }
  }
  return (
    <Modal onClose={onClose} title={done ? "It's yours!" : owned ? c.name : 'Confirm purchase'} width={440}>
      <div className="relative" data-buy={id}>
        {done && <Confetti colors={[R.color, R.light, '#f7c548', '#ffffff', '#22d36f']} />}
        {done && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-x-4 -top-4 h-[300px] rounded-[40px]"
            style={{ background: `radial-gradient(closest-side, ${R.color}66, transparent)` }}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: [0, 1, 0.55], scale: [0.7, 1.08, 1] }}
            transition={{ duration: 1.1, ease: EASE }}
          />
        )}
        <motion.div className="relative" animate={done ? { scale: [1, 1.04, 1] } : {}} transition={{ duration: 0.5, ease: EASE }}>
          <ProfileCard
            look={tryLook}
            avatar={tryAvatar}
            name={me.name}
            xp={xp}
            ribbon={
              <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-ink backdrop-blur">
                {done ? <IconCheck size={11} /> : <IconSparkle size={12} />} {done ? 'Yours' : 'Try-on'}
              </span>
            }
          />
        </motion.div>
        <div className="mt-4 flex items-start gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background: `radial-gradient(circle, ${R.color}40, #0c1925 75%)` }}>
            <CosmeticPreview id={id} size={54} avatar={me.avatar} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-black">{c.name}</span>
              <RarityTag rarity={c.rarity} />
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted">
              {KIND_NAME[c.kind]} · {c.line}
            </div>
          </div>
        </div>
        {c.kind === 'avatar' && !me.account && <p className="mt-3 rounded-lg bg-stage px-3 py-2 text-[12px] text-muted">Avatars show on an account. You can buy it now; it's yours to wear once you create one.</p>}

        <AnimatePresence mode="wait" initial={false}>
          {done || owned ? (
            <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
              {done && (
                <div className="tnum mb-3 flex items-center justify-between rounded-xl bg-stage px-3.5 py-2.5 text-[13px] font-bold">
                  <span className="text-muted">New balance</span>
                  <Coins amount={balance} digits={2} className="text-ink" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={onClose} className="h-12 rounded-xl bg-raised text-[14px] font-bold text-ink transition hover:bg-hover">
                  {done ? 'Keep shopping' : 'Close'}
                </button>
                <button
                  disabled={busy || (c.kind === 'avatar' && !me.account)}
                  onClick={() => void wear()}
                  className="h-12 rounded-xl bg-accent text-[14px] font-extrabold text-[#032412] shadow-[0_8px_22px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busy ? 'Saving…' : 'Wear it now'}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="confirm" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-4">
              <div className="tnum overflow-hidden rounded-xl bg-stage text-[13px] font-bold">
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-muted">Price</span>
                  <Coins amount={c.price!} className="text-gold" />
                </div>
                <div className="flex items-center justify-between border-t border-line px-3.5 py-2.5">
                  <span className="text-muted">Your balance</span>
                  <Coins amount={balance} digits={2} />
                </div>
                <div className="flex items-center justify-between border-t border-line px-3.5 py-2.5">
                  <span className="text-muted">After</span>
                  <span className={short ? 'text-danger' : ''}>{short ? `${fmt(short)} short` : <Coins amount={balance - c.price!} digits={2} />}</span>
                </div>
              </div>
              {short > 0 && (
                <p className="mt-3 text-[12.5px] text-muted">
                  You need {fmt(short)} more coins.{' '}
                  <button onClick={() => (onClose(), navigate('/rewards'))} className="font-bold text-accent hover:underline">
                    Free coins in Rewards
                  </button>
                </p>
              )}
              <div className="mt-4 grid grid-cols-[1fr_1.4fr] gap-2">
                <button onClick={onClose} className="h-12 rounded-xl bg-raised text-[14px] font-bold text-ink transition hover:bg-hover">
                  Cancel
                </button>
                <button
                  disabled={short > 0}
                  onClick={confirm}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#ffd75e,#f2b134)] text-[14.5px] font-extrabold text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                  data-confirm-buy
                >
                  <IconBag size={17} /> Buy for {fmt(c.price!, 0)}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}
