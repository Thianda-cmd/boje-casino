/*
  The account page's shared pieces: who is on the page (an account, or the guest on this device), their wardrobe and
  the look they can wear, saving what the public profile shows, the account number, how far along an achievement or a
  locked cosmetic is, small headings and tags, and the icons the shared set doesn't have. The card, the bar and the
  coin amounts come from the Rewards page's kit, so the two pages read as one casino.
*/
import { useEffect, useMemo, useState, type ReactNode, type SVGProps } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAuth } from '../../store/auth'
import { authMessage, save, updateProfile } from '../../lib/account'
import { defaultName, guestAvatar } from '../../lib/identity'
import { fmtCompact } from '../../lib/format'
import { CHALLENGES, TIERS, levelFromXp, tierIndexOf, useWallet, wardrobeOf, type WalletState } from '../../store/wallet'
import { COSMETICS, achievement, cleanLook, wearable, type Achievement, type Cosmetic, type Rarity } from '../../store/cosmetics'
import { RARITY } from '../../art/cosmetics'

export { Bar, Coins, EASE, Glow, KINDS, KindTile, Panel, Popover, SectionTitle, timeAgo, IconClock, IconCrown, IconInfo, IconStack, IconTarget } from '../rewards/kit'

/** who is on the page: an account's username and avatar, or the guest's name and avatar on this device */
export function useIdentity() {
  const status = useAuth((s) => s.status)
  const profile = useAuth((s) => s.profile)
  const uid = useAuth((s) => s.uid)
  const email = useAuth((s) => s.email)
  const account = status === 'user' && !!profile
  return {
    account,
    name: profile?.username ?? defaultName(),
    avatar: profile?.avatar ?? guestAvatar(),
    uid,
    email,
    createdAt: account ? profile!.createdAt : '',
  }
}

/** what the wallet has earned and bought, for the cosmetics checks; it changes only when progress does */
export function useWardrobe() {
  const s = useWallet(useShallow((w) => ({ xp: w.xp, rounds: w.rounds, totalWagered: w.totalWagered, totalWon: w.totalWon, biggestWin: w.biggestWin, dailyStreak: w.dailyStreak, heist: w.heist, challenges: w.challenges, owned: w.owned })))
  return useMemo(() => wardrobeOf(s), [s])
}

/** the look as it can be worn now */
export function useLook() {
  const look = useWallet((s) => s.look)
  const w = useWardrobe()
  return useMemo(() => wearable(cleanLook(look), w), [look, w])
}

/** whether a media query matches, following it as the window changes */
export function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const m = window.matchMedia?.(query)
    if (!m) return
    const f = () => setOn(m.matches)
    f()
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [query])
  return on
}

/** an account's change that its public profile shows (the look, the bio, privacy) is saved straight away */
export function saveSoon() {
  if (useAuth.getState().status === 'user') void save()
}

/** the look's field a cosmetic kind is worn in (avatars are the account's, not the look's) */
export const LOOK_KEY = { frame: 'frame', aura: 'aura', banner: 'banner', backdrop: 'backdrop', nameColor: 'nameColor', title: 'title' } as const

/**
 * Puts a cosmetic on. An avatar is the account's (update_profile); a guest has none to change, so it says so. The rest
 * go on the look (the wallet checks it may be worn), saved straight away for an account. Returns an error to show, or null.
 */
export async function equip(c: Cosmetic): Promise<string | null> {
  if (c.kind === 'avatar') {
    if (useAuth.getState().status !== 'user') return 'Avatars belong to an account. Create a free one to wear it.'
    const r = await updateProfile({ avatar: Number(c.id.split(':')[1]) })
    return r.ok ? null : authMessage(r.error)
  }
  useWallet.getState().wear({ [LOOK_KEY[c.kind]]: c.id })
  saveSoon()
  return null
}

/** the account number shown to the player: BJ- and six digits, from the account's id */
export function accountNumber(uid: string | null) {
  if (!uid) return null
  let h = 0x811c9dc5
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `BJ-${String(100000 + (h % 900000))}`
}

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic']
export const KIND_NAME: Record<Cosmetic['kind'], string> = { avatar: 'Avatar', frame: 'Frame', aura: 'Aura', banner: 'Banner', backdrop: 'Backdrop', nameColor: 'Name colour', title: 'Title' }

/** a rarity as a small coloured tag; a Mythic's runs round the rainbow, with a twinkle for its dot */
export function RarityTag({ rarity, className = '' }: { rarity: Rarity; className?: string }) {
  const r = RARITY[rarity]
  if (rarity === 'mythic')
    return (
      <span
        className={`bjc-pan inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-black uppercase leading-none tracking-[.08em] text-white ${className}`}
        style={{ backgroundImage: 'linear-gradient(90deg,#ff4fd8,#ffb347,#5dff9a,#3fd8ff,#9b7bff,#ff4fd8)', textShadow: '0 1px 2px rgba(40,0,50,.7)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.45), 0 0 10px -2px rgba(255,79,216,.7)' }}
        data-rarity="mythic"
      >
        <svg width="8" height="8" viewBox="-5 -5 10 10" className="bjc-tw shrink-0" aria-hidden>
          <path d="M0 -5Q.8 -.8 5 0Q.8 .8 0 5Q-.8 .8 -5 0Q-.8 -.8 0 -5Z" fill="#fff" />
        </svg>
        {r.name}
      </span>
    )
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-black uppercase leading-none tracking-[.08em] ${className}`} style={{ color: r.light, background: `${r.color}24`, boxShadow: `inset 0 0 0 1px ${r.color}40` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
      {r.name}
    </span>
  )
}

/** the prismatic edge every Mythic item's tile wears: a thin rainbow border that keeps running round (put it last in a relative, rounded box) */
export function PrismEdge({ width = 1.5 }: { width?: number }) {
  return (
    <span
      aria-hidden
      className="bjc-pan pointer-events-none absolute inset-0 rounded-[inherit]"
      style={{ padding: width, backgroundImage: 'linear-gradient(90deg,#ff4fd8,#ffb347,#5dff9a,#3fd8ff,#9b7bff,#ff4fd8)', WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)' }}
    />
  )
}

export interface Progress {
  cur: number
  goal: number
  /** "312 / 1,000 rounds" */
  text: string
  /** complete but waiting to be claimed (a challenge) */
  ready?: boolean
}

type Source = Pick<WalletState, 'xp' | 'rounds' | 'totalWagered' | 'totalWon' | 'biggestWin' | 'dailyStreak' | 'heist' | 'challenges'>

const MILESTONE: Record<string, [(s: Source) => number, number, string]> = {
  'first-win': [(s) => (s.totalWon > 0 ? 1 : 0), 1, 'win'],
  'rounds-100': [(s) => s.rounds ?? 0, 100, 'rounds'],
  'rounds-1000': [(s) => s.rounds ?? 0, 1000, 'rounds'],
  'rounds-10000': [(s) => s.rounds ?? 0, 10000, 'rounds'],
  'wagered-10k': [(s) => s.totalWagered, 10_000, 'wagered'],
  'wagered-100k': [(s) => s.totalWagered, 100_000, 'wagered'],
  'wagered-1m': [(s) => s.totalWagered, 1_000_000, 'wagered'],
  'bigwin-1k': [(s) => s.biggestWin, 1000, 'best win'],
  'bigwin-10k': [(s) => s.biggestWin, 10_000, 'best win'],
  'bigwin-100k': [(s) => s.biggestWin, 100_000, 'best win'],
  'streak-7': [(s) => s.dailyStreak, 7, 'days'],
  'heist-master': [(s) => s.heist?.best ?? 0, 8, 'vaults'],
}

/** how far along an achievement is, where it can be counted */
export function achievementProgress(a: Achievement, s: Source): Progress | null {
  const m = MILESTONE[a.id]
  if (m) {
    const cur = Math.min(m[1], Math.max(0, m[0](s)))
    return { cur, goal: m[1], text: m[2] === 'win' ? (cur ? 'Won' : 'Not yet') : `${fmtCompact(Math.floor(cur))} / ${fmtCompact(m[1])} ${m[2]}` }
  }
  if (a.id.startsWith('tier-')) {
    const t = TIERS[Number(a.id.slice(5))]
    const level = levelFromXp(s.xp).level
    return { cur: Math.min(level, t.min), goal: t.min, text: `Level ${level} / ${t.min}` }
  }
  if (a.id.startsWith('challenge:')) {
    const c = CHALLENGES.find((x) => x.id === a.id.slice(10))
    if (!c) return null
    const st = s.challenges?.[c.id]
    const cur = Math.min(c.goal, st?.progress ?? 0)
    const ready = !!st && !st.claimed && cur >= c.goal
    return { cur: st?.claimed ? c.goal : cur, goal: c.goal, ready, text: ready ? 'Done: claim it in Rewards' : c.goal > 1 ? `${fmtCompact(cur)} / ${fmtCompact(c.goal)}` : 'Not yet' }
  }
  return null
}

/** how far along a locked cosmetic's unlock is (a level, a tier, a challenge, an achievement) */
export function unlockProgress(c: Cosmetic, s: Source): Progress | null {
  const u = c.unlock
  if (!u) return null
  const level = levelFromXp(s.xp).level
  if (u.level !== undefined) return { cur: Math.min(level, u.level), goal: u.level, text: `Level ${level} / ${u.level}` }
  if (u.tier !== undefined) return { cur: Math.min(tierIndexOf(level) >= u.tier ? TIERS[u.tier].min : level, TIERS[u.tier].min), goal: TIERS[u.tier].min, text: `Level ${level} / ${TIERS[u.tier].min}` }
  if (u.achievement !== undefined) {
    const a = achievement(u.achievement)
    return a ? achievementProgress(a, s) : null
  }
  if (u.challenge !== undefined) {
    const a = achievement(`challenge:${u.challenge}`)
    return a ? achievementProgress(a, s) : null
  }
  return null
}

/** the cosmetics an achievement unlocks (a tier's achievement shares its tier's unlocks) */
export function unlocksOf(a: Achievement): Cosmetic[] {
  const ch = a.id.startsWith('challenge:') ? a.id.slice(10) : null
  const tier = a.id.startsWith('tier-') ? Number(a.id.slice(5)) : null
  return COSMETICS.filter((c) => c.unlock && !c.unlock.level && (c.unlock.achievement === a.id || (ch !== null && c.unlock.challenge === ch) || (tier !== null && c.unlock.tier === tier)))
}

/** a small heading inside a card, with an optional line under it and something on the right */
export function CardHead({ icon, title, sub, right }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[15.5px] font-extrabold tracking-tight">
          {icon && <span className="text-muted">{icon}</span>}
          {title}
        </div>
        {sub && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

/** a figure in a tile: a label over a big number */
export function Figure({ label, value, tone, sub, icon }: { label: string; value: ReactNode; tone?: string; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-panel2/70 px-3.5 py-3 ring-1 ring-white/[.04]">
      <div className="flex items-center gap-1.5 truncate text-[11.5px] font-bold text-dim">
        {icon}
        {label}
      </div>
      <div className={`tnum mt-1 truncate text-[19px] font-black tracking-tight ${tone ?? ''}`}>{value}</div>
      {sub && <div className="tnum mt-0.5 truncate text-[11.5px] font-semibold text-dim">{sub}</div>}
    </div>
  )
}

/* ---------------- icons ---------------- */

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = ({ size = 20, ...p }: P) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p })

export const IconBrush = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 4.5 19.5 9.5 11 18l-5-5z" />
    <path d="M6 13c-2 0-3 1.6-3 3.5V20h3.5C8.4 20 10 19 10 17" />
    <path d="M16 3l5 5" />
  </svg>
)
export const IconBag = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 8h14l-1.2 12H6.2z" />
    <path d="M9 10V6.5a3 3 0 0 1 6 0V10" />
  </svg>
)
export const IconGear = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    <circle cx="12" cy="12" r="7" />
  </svg>
)
export const IconShield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2.8 19.5 6v5.6c0 4.6-3.1 8-7.5 9.6-4.4-1.6-7.5-5-7.5-9.6V6z" />
    <path d="M8.8 12.2l2.2 2.2 4.2-4.6" />
  </svg>
)
export const IconMedal = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="15" r="5.5" />
    <path d="M8.5 10.5 5.5 3h4l2.5 5M15.5 10.5l3-7.5h-4L12 8" />
    <path d="M12 12.6l.8 1.6 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2z" fill="currentColor" stroke="none" />
  </svg>
)
export const IconEye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
export const IconSparkle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3c.6 4.2 2.4 6.2 6.6 6.8-4.2.6-6 2.6-6.6 6.8-.6-4.2-2.4-6.2-6.6-6.8C9.6 9.2 11.4 7.2 12 3Z" />
    <path d="M19 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z" />
  </svg>
)
export const IconHourglass = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9" />
  </svg>
)
export const IconPin = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2.8l2.9 5.9 6.4.9-4.6 4.5 1.1 6.4L12 17.5l-5.8 3 1.1-6.4-4.6-4.5 6.4-.9z" />
  </svg>
)
