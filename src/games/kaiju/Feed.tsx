import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Coin, IconUsers } from '../../components/icons'
import { Avatar } from '../../art/Avatar'
import { PlayerName } from '../../components/profile/PlayerName'
import { fmt, fmtCompact } from '../../lib/format'
import { selName, selShort, sideId } from './rules'
import { KaijuPortrait } from './portraits'
import type { Bettor } from './net'
import type { Matchup, Sel, Side } from './types'

/*
  The crowd: this round's players, biggest first (the server sends the top 30 and never anyone's id), each with their
  avatar, their name (a signed-in player's opens their profile card: PlayerName), the selection they have the most on
  and their total. The stand-in's house bots are marked. Once the fight is decided, a row whose biggest selection won
  lights green.
*/

const sideOf = (s: Sel): Side | null => (s === 'win:a' || s === 'first:a' || s.startsWith('exact:a') ? 'a' : s === 'win:b' || s === 'first:b' || s.startsWith('exact:b') ? 'b' : null)

export const Bettors = memo(function Bettors({ rows, players, totals, matchup, hits, compact }: { rows: Bettor[]; players: number; totals: Record<Sel, { total: number; players: number }>; matchup: Matchup | null; hits: Sel[] | null; compact?: boolean }) {
  const staked = Object.values(totals).reduce((a, t) => a + t.total, 0)
  // names aren't unique (two guests may pick the same one), so namesakes are numbered
  const seen = new Map<string, number>()
  const keyOf = (b: Bettor) => {
    const k = b.me ? 'you:' : `${b.name}:${b.avatar}`
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return n ? `${k}#${n}` : k
  }
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-stage" data-bettors>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 text-[12px] font-bold text-muted">
        <span>The crowd</span>
        <span className="ml-auto flex items-center gap-1">
          <IconUsers size={13} /> <span className="tnum">{players}</span>
        </span>
        <span className="tnum flex items-center gap-1 text-ink">
          {fmtCompact(staked)} <Coin size={12} />
        </span>
      </div>
      <div className={`overflow-y-auto py-1 ${compact ? 'max-h-[260px]' : 'max-h-[340px]'}`}>
        {rows.length === 0 && <div className="px-3 py-5 text-center text-[12px] text-dim">No bets on this fight yet</div>}
        <AnimatePresence initial={false}>
          {matchup &&
            rows.map((b) => {
              const side = sideOf(b.sel)
              const won = hits ? hits.includes(b.sel) : null
              return (
                <motion.div
                  key={keyOf(b)}
                  layout="position"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className={`mx-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] ${b.me ? 'bg-accent/[.09] ring-1 ring-accent/40' : ''}`}
                >
                  <Avatar index={b.avatar} size={24} />
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className={`flex min-w-0 items-center gap-1 font-semibold ${b.me ? 'text-accent' : 'text-ink/90'}`}>
                      <PlayerName name={b.name} acct={b.acct} className="truncate">
                        {b.me ? 'You' : b.name}
                      </PlayerName>
                      {b.bot && <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] font-black tracking-wider text-white/55">BOT</span>}
                    </span>
                    <span className={`flex min-w-0 items-center gap-1 text-[11px] font-semibold ${won ? 'text-accent' : won === false ? 'text-dim' : 'text-muted'}`} title={selName(b.sel, matchup)}>
                      {side && <KaijuPortrait id={sideId(matchup, side)} size={14} mirror={side === 'b'} />}
                      <span className="truncate">
                        {selShort(b.sel, matchup)}
                        {b.sel.startsWith('exact') ? '' : b.sel.startsWith('win') ? ' to win' : b.sel.startsWith('first') ? ' first' : ''}
                      </span>
                      <span className="tnum shrink-0 text-dim">{fmt(b.amount, b.amount % 1 ? 2 : 0)}</span>
                    </span>
                  </div>
                  <span className={`tnum shrink-0 font-bold ${won ? 'text-accent' : 'text-ink/85'}`}>{fmt(b.total)}</span>
                </motion.div>
              )
            })}
        </AnimatePresence>
      </div>
    </div>
  )
})
