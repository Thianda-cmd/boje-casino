/*
  The wardrobe: everything a player can wear, by kind (avatar, frame, banner, name colour, title, showcase badges),
  beside a live preview of their profile card.

  Anything wearable goes on with one press (wear() on the wallet, saved at once for an account; an account's avatar
  through update_profile). Anything not yet theirs is tried on instead: the preview shows it with a Try-on ribbon,
  and the bar under the preview says how to get it: its price and a Buy button (the shop's confirm step), or what
  unlocks it with how far along that is. Guests have no avatar to change (it belongs to an account), so their avatar
  presses are try-ons with the sign-up pitch. The Badges kind picks up to three earned achievements for the showcase.
*/
import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { BadgeIcon, CosmeticPreview, RARITY } from '../../art/cosmetics'
import { Coin, IconCheck, IconLock, IconX } from '../../components/icons'
import { fmt } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { AVATAR_COUNT, SHOWCASE, achievement, canWear, cosmetic, cosmeticsOf, earnedAchievements, type Cosmetic, type CosmeticKind } from '../../store/cosmetics'
import { Bar, CardHead, EASE, IconSparkle, KIND_NAME, LOOK_KEY, Panel, RarityTag, equip, saveSoon, unlockProgress, useIdentity, useLook, useWardrobe } from './kit'
import { ProfileCard } from './ProfileHeader'
import { BuyModal } from './Shop'
import { useAccountTab } from './tab'

type Kind = CosmeticKind | 'badges'
const KINDS: { id: Kind; name: string }[] = [
  { id: 'avatar', name: 'Avatar' },
  { id: 'frame', name: 'Frame' },
  { id: 'banner', name: 'Banner' },
  { id: 'nameColor', name: 'Name colour' },
  { id: 'title', name: 'Title' },
  { id: 'badges', name: 'Badges' },
]
const AVATARS = Array.from({ length: AVATAR_COUNT }, (_, i) => cosmetic(`avatar:${i}`)!)

export function CustomizeTab() {
  const me = useIdentity()
  const look = useLook()
  const xp = useWallet((s) => s.xp)
  const w = useWardrobe()
  const pushToast = useWallet((s) => s.pushToast)
  const [kind, setKind] = useState<Kind>('frame')
  const [trying, setTrying] = useState<string | null>(null)
  const [buying, setBuying] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = useRef<HTMLDivElement>(null)
  const tried = trying ? cosmetic(trying) : undefined
  const previewLook = tried && tried.kind !== 'avatar' ? { ...look, [LOOK_KEY[tried.kind]]: tried.id } : look
  const previewAvatar = tried?.kind === 'avatar' ? Number(tried.id.split(':')[1]) : me.avatar
  const list = kind === 'avatar' ? AVATARS : kind === 'badges' ? [] : cosmeticsOf(kind)
  const worn = (c: Cosmetic) => (c.kind === 'avatar' ? c.id === `avatar:${me.avatar}` : look[LOOK_KEY[c.kind]] === c.id)

  // on a phone the preview sits above the grid: a try-on scrolls up to it, and putting something on says so
  const narrow = () => !window.matchMedia?.('(min-width: 1024px)').matches
  const press = async (c: Cosmetic) => {
    if (worn(c)) return setTrying(null)
    const mine = canWear(c.id, w)
    if (!mine || (c.kind === 'avatar' && !me.account)) {
      const next = trying === c.id ? null : c.id
      setTrying(next)
      if (next && narrow()) preview.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setTrying(null)
    setBusy(true)
    const err = await equip(c)
    setBusy(false)
    if (err) pushToast({ kind: 'info', title: err })
    else {
      sfx.click()
      if (narrow()) pushToast({ kind: 'info', title: `Now wearing ${c.name}` })
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-1">
        <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5 sm:mx-0 sm:px-0">
          {KINDS.map((k) => {
            const items = k.id === 'avatar' ? AVATARS : k.id === 'badges' ? [] : cosmeticsOf(k.id)
            const have = k.id === 'badges' ? look.badges.length : items.filter((c) => canWear(c.id, w)).length
            return (
              <button
                key={k.id}
                onClick={() => (setKind(k.id), setTrying(null))}
                className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-bold transition ${kind === k.id ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.06)]' : 'bg-panel text-muted hover:bg-panel2 hover:text-ink'}`}
                data-wardrobe-kind={k.id}
              >
                {k.name}
                <span className="tnum text-dim">{k.id === 'badges' ? `${have}/${SHOWCASE}` : `${have}/${items.length}`}</span>
              </button>
            )
          })}
        </div>
        {kind === 'badges' ? (
          <BadgePicker />
        ) : (
          <Panel>
            <CardHead
              title={kind === 'avatar' ? 'Avatars' : KINDS.find((k) => k.id === kind)!.name + 's'}
              sub={kind === 'avatar' && !me.account ? 'Avatars belong to an account: try any on here, and create a free account to wear one.' : 'Press one to wear it. Anything locked can be tried on first.'}
            />
            <motion.div key={kind} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className={`grid gap-2.5 ${kind === 'avatar' ? 'grid-cols-4 sm:grid-cols-6 xl:grid-cols-8' : 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-5'}`}>
              {list.map((c) => (
                <ItemTile key={c.id} c={c} worn={worn(c)} mine={canWear(c.id, w)} selected={trying === c.id} small={kind === 'avatar'} disabled={busy} onPress={() => void press(c)} />
              ))}
            </motion.div>
          </Panel>
        )}
      </div>

      <div ref={preview} className="order-1 flex scroll-mt-20 flex-col gap-3 lg:sticky lg:top-[68px] lg:order-2">
        <ProfileCard
          look={previewLook}
          avatar={previewAvatar}
          name={me.name}
          xp={xp}
          ribbon={
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[.08em] backdrop-blur ${tried ? 'bg-gold text-[#2a1c00]' : 'bg-black/55 text-ink'}`}>
              {tried ? <IconSparkle size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              {tried ? 'Try-on' : 'Live'}
            </span>
          }
        />
        <AnimatePresence mode="wait" initial={false}>
          {tried ? <TryBar key={tried.id} c={tried} onBuy={() => setBuying(tried.id)} onStop={() => setTrying(null)} /> : <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-1 text-[12.5px] leading-relaxed text-muted">This is how other players see you{me.account ? ' on your public profile and in the games.' : '. Create an account to get a public profile.'}</motion.p>}
        </AnimatePresence>
      </div>
      <AnimatePresence>{buying && <BuyModal key={buying} id={buying} onClose={() => (setBuying(null), setTrying(null))} />}</AnimatePresence>
    </div>
  )
}

function ItemTile({ c, worn, mine, selected, small, disabled, onPress }: { c: Cosmetic; worn: boolean; mine: boolean; selected: boolean; small: boolean; disabled: boolean; onPress: () => void }) {
  const R = RARITY[c.rarity]
  const { avatar, account } = useIdentity()
  const source = useWallet(useShallow((s) => ({ xp: s.xp, rounds: s.rounds, totalWagered: s.totalWagered, totalWon: s.totalWon, biggestWin: s.biggestWin, dailyStreak: s.dailyStreak, heist: s.heist, challenges: s.challenges })))
  const prog = !mine ? unlockProgress(c, source) : null
  const locked = !mine
  const status = worn ? (
    <span className="text-accent">Wearing</span>
  ) : !locked ? (
    <span className="text-muted">{c.kind === 'avatar' && !account ? 'Try on' : c.price !== undefined ? 'Owned' : c.unlock ? 'Unlocked' : 'Free'}</span>
  ) : c.price !== undefined ? (
    <span className="tnum inline-flex items-center gap-1 text-gold">
      <Coin size={11} /> {fmt(c.price, 0)}
    </span>
  ) : (
    <span className="text-dim">{c.line}</span>
  )
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      disabled={disabled}
      onClick={onPress}
      title={`${c.name}: ${c.line}`}
      className={`relative flex min-w-0 flex-col items-center rounded-xl px-1.5 pb-2 pt-2.5 text-center transition ${worn ? 'bg-accent/[.08] ring-2 ring-accent' : selected ? 'bg-gold/[.08] ring-2 ring-gold' : 'bg-panel2/60 ring-1 ring-white/[.05] hover:bg-panel2 hover:ring-white/10'}`}
      data-item={c.id}
      data-state={worn ? 'worn' : mine ? 'mine' : 'locked'}
    >
      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full" style={{ background: R.color, boxShadow: `0 0 6px ${R.color}` }} title={R.name} />
      <span className="relative">
        <span className={locked ? 'opacity-55 saturate-[.6]' : undefined}>
          <CosmeticPreview id={c.id} size={small ? 56 : 72} avatar={avatar} />
        </span>
        {locked && (
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-stage text-muted ring-2 ring-panel">
            <IconLock size={12} />
          </span>
        )}
        {worn && (
          <span className="absolute -left-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[#032412] ring-2 ring-panel">
            <IconCheck size={13} />
          </span>
        )}
      </span>
      {!small && <span className="mt-2 w-full truncate px-1 text-[12.5px] font-bold">{c.name}</span>}
      <span className={`w-full truncate px-1 text-[10.5px] font-bold ${small ? 'mt-1.5' : 'mt-0.5'}`}>{status}</span>
      {prog && !small && <Bar pct={(prog.cur / prog.goal) * 100} color={R.color} className="mx-auto mt-1.5 h-1 w-4/5" />}
    </motion.button>
  )
}

/** under the preview while something is tried on: how to get it */
function TryBar({ c, onBuy, onStop }: { c: Cosmetic; onBuy: () => void; onStop: () => void }) {
  const me = useIdentity()
  const w = useWardrobe()
  const open = useAuth((s) => s.open)
  const available = useAuth((s) => s.available)
  const balance = useWallet((s) => s.balance)
  const source = useWallet(useShallow((s) => ({ xp: s.xp, rounds: s.rounds, totalWagered: s.totalWagered, totalWon: s.totalWon, biggestWin: s.biggestWin, dailyStreak: s.dailyStreak, heist: s.heist, challenges: s.challenges })))
  const mine = canWear(c.id, w)
  const prog = unlockProgress(c, source)
  const R = RARITY[c.rarity]
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: EASE }}>
      <Panel className="!p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background: `radial-gradient(circle, ${R.color}40, #0c1925 75%)` }}>
            <CosmeticPreview id={c.id} size={46} avatar={me.avatar} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-[15px] font-black">{c.name}</span>
              <RarityTag rarity={c.rarity} />
            </div>
            <div className="mt-0.5 text-[12px] text-muted">
              {KIND_NAME[c.kind]} · {c.line}
            </div>
          </div>
          <button onClick={onStop} aria-label="Stop trying on" className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-panel2 hover:text-ink">
            <IconX size={16} />
          </button>
        </div>
        {c.kind === 'avatar' && mine && !me.account ? (
          available ? (
            <button onClick={() => open('register')} className="mt-3.5 h-11 w-full rounded-xl bg-accent text-[14px] font-extrabold text-[#032412] transition hover:brightness-110">
              Create a free account to wear it
            </button>
          ) : (
            <p className="mt-3 text-[12px] text-dim">Accounts aren't available in this preview.</p>
          )
        ) : c.price !== undefined ? (
          <button onClick={onBuy} className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#ffd75e,#f2b134)] text-[14px] font-extrabold text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] transition hover:brightness-105" data-try-buy>
            <Coin size={16} /> Buy for {fmt(c.price, 0)}
            {balance < c.price && <span className="text-[11.5px] font-bold opacity-70">· {fmt(c.price - balance, 0)} short</span>}
          </button>
        ) : prog ? (
          <div className="mt-3.5 rounded-xl bg-stage px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 text-[12px] font-bold">
              <span className="text-muted">To unlock: {c.line.replace(/^./, (x) => x.toLowerCase())}</span>
              <span className="tnum shrink-0 text-dim">{prog.text}</span>
            </div>
            <Bar pct={(prog.cur / prog.goal) * 100} color={R.color} className="mt-2 h-1.5" />
          </div>
        ) : null}
      </Panel>
    </motion.div>
  )
}

/** up to three earned achievements for the showcase */
function BadgePicker() {
  const look = useLook()
  const w = useWardrobe()
  const wear = useWallet((s) => s.wear)
  const pushToast = useWallet((s) => s.pushToast)
  const setTab = useAccountTab((s) => s.setTab)
  const earned = earnedAchievements(w.source)
  const set = (badges: string[]) => {
    wear({ badges })
    saveSoon()
    sfx.click()
  }
  const toggle = (id: string) => {
    if (look.badges.includes(id)) set(look.badges.filter((b) => b !== id))
    else if (look.badges.length >= SHOWCASE) pushToast({ kind: 'info', title: `Your showcase holds ${SHOWCASE}. Take one out first.` })
    else set([...look.badges, id])
  }
  return (
    <Panel>
      <CardHead title="Showcase" sub={`Pick up to ${SHOWCASE} badges to show beside your name.`} />
      <div className="mb-5 grid grid-cols-3 gap-2.5">
        {Array.from({ length: SHOWCASE }, (_, i) => {
          const id = look.badges[i]
          const a = id ? achievement(id) : null
          return (
            <div key={i} className={`relative flex min-w-0 flex-col items-center rounded-xl px-2 py-3 text-center ${a ? 'bg-panel2' : 'border-2 border-dashed border-line'}`}>
              {a ? (
                <>
                  <BadgeIcon id={id} size={56} />
                  <div className="mt-1.5 w-full truncate text-[12px] font-bold">{a.name}</div>
                  <button onClick={() => toggle(id)} aria-label={`Take ${a.name} out`} className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-dim transition hover:bg-stage hover:text-ink">
                    <IconX size={14} />
                  </button>
                </>
              ) : (
                <div className="flex h-[76px] items-center text-[12px] font-bold text-dim">Slot {i + 1}</div>
              )}
            </div>
          )
        })}
      </div>
      {earned.length ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 xl:grid-cols-6">
          {earned.map((id) => {
            const on = look.badges.includes(id)
            return (
              <motion.button key={id} whileTap={{ scale: 0.96 }} onClick={() => toggle(id)} className={`relative flex min-w-0 flex-col items-center rounded-xl px-1.5 pb-2 pt-2.5 transition ${on ? 'bg-gold/[.08] ring-2 ring-gold' : 'bg-panel2/60 ring-1 ring-white/[.05] hover:bg-panel2'}`} data-badge-pick={id}>
                <BadgeIcon id={id} size={50} />
                <span className="mt-1.5 w-full truncate text-[11.5px] font-bold">{achievement(id)?.name}</span>
                {on && (
                  <span className="absolute -left-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-gold text-[#2a1c00] ring-2 ring-panel">
                    <IconCheck size={13} />
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl bg-stage/60 p-5 text-center">
          <div className="text-[14px] font-bold">No badges yet</div>
          <div className="mt-1 text-[12.5px] text-muted">Win a round, play 100 rounds, finish a challenge: every achievement is a badge.</div>
          <button onClick={() => setTab('achievements')} className="mt-3 h-9 rounded-full bg-raised px-4 text-[12.5px] font-bold transition hover:bg-hover">
            See achievements
          </button>
        </div>
      )}
    </Panel>
  )
}
