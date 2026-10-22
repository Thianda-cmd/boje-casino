/*
  The Achievements tab: every badge there is (src/store/cosmetics.ts: the milestones, the VIP tiers and one for each
  challenge), earned or still locked, worked out from the wallet the same way a public profile works them out.

  The head counts what is earned, by rarity, beside the showcase. Below, the badges by group, filtered to all, earned
  or locked; each card shows how far along it is where that can be counted, what it unlocks in the wardrobe, and a pin
  to put an earned one in the showcase (three at most). A challenge that is done but not claimed points to Rewards,
  since the badge comes with the claim.
*/
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { BadgeIcon, RARITY } from '../../art/cosmetics'
import { IconCheck } from '../../components/icons'
import { navigate } from '../../lib/router'
import { sfx } from '../../lib/sound'
import { useWallet } from '../../store/wallet'
import { MILESTONES, SHOWCASE, allAchievements, earnedAchievements, type Achievement } from '../../store/cosmetics'
import { Bar, EASE, Glow, IconPin, KIND_NAME, Panel, RARITY_ORDER, RarityTag, achievementProgress, saveSoon, unlocksOf, useLook, useWardrobe } from './kit'
import { Showcase } from './ProfileHeader'

type Filter = 'all' | 'earned' | 'locked'

export function AchievementsTab() {
  const w = useWardrobe()
  const look = useLook()
  const wear = useWallet((s) => s.wear)
  const pushToast = useWallet((s) => s.pushToast)
  const source = useWallet(useShallow((s) => ({ xp: s.xp, rounds: s.rounds, totalWagered: s.totalWagered, totalWon: s.totalWon, biggestWin: s.biggestWin, dailyStreak: s.dailyStreak, heist: s.heist, challenges: s.challenges })))
  const [filter, setFilter] = useState<Filter>('all')
  const all = allAchievements()
  const earned = new Set(earnedAchievements(w.source))
  const groups: { name: string; sub: string; list: readonly Achievement[] }[] = [
    { name: 'Milestones', sub: 'Rounds, coins wagered, big wins, streaks and the vaults.', list: MILESTONES.filter((m) => !m.id.startsWith('tier-')) },
    { name: 'VIP tiers', sub: 'One for every tier you reach.', list: MILESTONES.filter((m) => m.id.startsWith('tier-')) },
    { name: 'Challenges', sub: 'Claim a challenge in Rewards and its badge is yours.', list: all.filter((a) => a.id.startsWith('challenge:')) },
  ]
  const pin = (id: string) => {
    const on = look.badges.includes(id)
    if (!on && look.badges.length >= SHOWCASE) return pushToast({ kind: 'info', title: `Your showcase holds ${SHOWCASE}. Unpin one first.` })
    wear({ badges: on ? look.badges.filter((b) => b !== id) : [...look.badges, id] })
    saveSoon()
    sfx.click()
  }
  const pct = (earned.size / all.length) * 100
  const R = 42
  const C = 2 * Math.PI * R
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <Glow color="#f7c548" className="-left-20 -top-24 h-72 w-72" opacity={0.12} />
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <div className="relative h-[104px] w-[104px] shrink-0">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="7" />
                <motion.circle cx="50" cy="50" r={R} fill="none" stroke="#f7c548" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - Math.max(0.01, pct / 100)) }} transition={{ duration: 1, ease: EASE }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="tnum text-[26px] font-black leading-none" data-earned-count>
                  {earned.size}
                </span>
                <span className="tnum text-[11px] font-bold text-dim">of {all.length}</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[20px] font-black tracking-tight">Achievements</div>
              <div className="mt-0.5 text-[13px] text-muted">Every badge you earn shows on your profile.</div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                {RARITY_ORDER.map((r) => {
                  const list = all.filter((a) => a.rarity === r)
                  return (
                    <span key={r} className="tnum inline-flex items-center gap-1.5 text-[12px] font-bold text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: RARITY[r].color }} />
                      {list.filter((a) => earned.has(a.id)).length}/{list.length}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-stage/70 p-3.5 ring-1 ring-white/[.04] md:ml-auto">
            <div className="mb-2 text-[12px] font-bold text-dim">Showcase · pin up to {SHOWCASE}</div>
            <Showcase badges={look.badges} size={46} />
          </div>
        </div>
      </Panel>

      <div className="flex gap-1 self-start rounded-full bg-panel p-1">
        {(['all', 'earned', 'locked'] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`h-8 rounded-full px-4 text-[13px] font-bold capitalize transition ${filter === f ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>
            {f}
          </button>
        ))}
      </div>

      {groups.map((g) => {
        const list = g.list.filter((a) => filter === 'all' || (filter === 'earned' ? earned.has(a.id) : !earned.has(a.id)))
        if (!list.length) return null
        return (
          <section key={g.name}>
            <div className="mb-2.5 flex items-end justify-between gap-3 px-0.5">
              <div>
                <h3 className="text-[17px] font-black tracking-tight">{g.name}</h3>
                <p className="text-[12.5px] text-muted">{g.sub}</p>
              </div>
              <span className="tnum shrink-0 text-[12.5px] font-bold text-dim">
                {g.list.filter((a) => earned.has(a.id)).length} / {g.list.length}
              </span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((a, i) => (
                <Card key={a.id} a={a} i={i} has={earned.has(a.id)} pinned={look.badges.includes(a.id)} onPin={() => pin(a.id)} source={source} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Card({ a, i, has, pinned, onPin, source }: { a: Achievement; i: number; has: boolean; pinned: boolean; onPin: () => void; source: Parameters<typeof achievementProgress>[1] }) {
  const prog = achievementProgress(a, source)
  const unlocks = unlocksOf(a)
  const R = RARITY[a.rarity]
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 12) * 0.02, duration: 0.25 }}
      className={`relative flex min-w-0 gap-3 overflow-hidden rounded-2xl p-3.5 ring-1 ${has ? 'bg-panel ring-white/[.06]' : 'bg-panel/60 ring-white/[.03]'}`}
      data-achievement={a.id}
      data-earned={has ? '1' : '0'}
    >
      {has && <div className="pointer-events-none absolute inset-y-0 left-0 w-24" style={{ background: `radial-gradient(circle at 0% 50%, ${R.color}22, transparent 70%)` }} />}
      <BadgeIcon id={a.id} size={58} locked={!has} className="relative" />
      <div className="relative min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className={`min-w-0 flex-1 truncate text-[14px] font-extrabold ${has ? '' : 'text-ink/80'}`}>{a.name}</span>
          {has && (
            <button onClick={onPin} aria-pressed={pinned} aria-label={pinned ? 'Unpin from showcase' : 'Pin to showcase'} title={pinned ? 'In your showcase' : 'Pin to your showcase'} className={`-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${pinned ? 'bg-gold/15 text-gold' : 'text-dim hover:bg-panel2 hover:text-ink'}`}>
              <IconPin size={15} fill={pinned ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">{a.line}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RarityTag rarity={a.rarity} />
          {has && (
            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-accent">
              <IconCheck size={12} /> Earned
            </span>
          )}
        </div>
        {!has && prog && (
          <div className="mt-2">
            {prog.ready ? (
              <button onClick={() => navigate('/rewards')} className="h-8 rounded-lg bg-gold px-3 text-[12px] font-extrabold text-[#2a1c00] transition hover:brightness-105">
                Claim in Rewards
              </button>
            ) : (
              <>
                <Bar pct={(prog.cur / prog.goal) * 100} color={R.color} className="h-1.5" />
                <div className="tnum mt-1 text-[11px] font-semibold text-dim">{prog.text}</div>
              </>
            )}
          </div>
        )}
        {unlocks.length > 0 && (
          <div className="mt-2 truncate text-[11px] font-semibold text-dim">
            Unlocks{' '}
            {unlocks.map((c, k) => (
              <span key={c.id}>
                {k ? ', ' : ''}
                <span className="text-muted">
                  {c.name} {KIND_NAME[c.kind].toLowerCase()}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
