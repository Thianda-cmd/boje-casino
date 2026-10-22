import { memo, type Ref } from 'react'
import { motion } from 'framer-motion'
import { fighter, sideId } from './rules'
import { KaijuPortrait } from './portraits'
import { CORNER, MethodMark } from './art'
import { TAPE } from './words'
import type { PastFight, Standing } from './live'
import type { Fighter, Matchup, Odds, Side } from './types'

/*
  The tale of the tape, over the stage while bets are open: the betting clock at the top (the fight's number, or the
  Main Event in gold, and the seconds left with a bar running down; the page's loop writes both through refs, so the
  tape itself never re-renders for them), and a band across the foot of the stage with the two kaiju face to face:
  portraits in their corner colours, names and epithets, how each one fights, their record and form over the last 50
  fights, the price and chance to win, the five stats head to head (each bar grows toward its own kaiju), the tape's
  colour (height, weight, where it comes from), and how these two have done against each other lately. On a phone
  the band keeps the faces, prices and stats and drops the rest.
*/

const STATS: [keyof Pick<Fighter, 'power' | 'grapple' | 'tough' | 'speed' | 'chaos'>, string][] = [
  ['power', 'Power'],
  ['grapple', 'Grapple'],
  ['tough', 'Tough'],
  ['speed', 'Speed'],
  ['chaos', 'Chaos'],
]

/** the last fights between these two (either corner), newest first */
function meetings(history: PastFight[], m: Matchup) {
  return history.filter((h) => (h.matchup.a === m.a && h.matchup.b === m.b) || (h.matchup.a === m.b && h.matchup.b === m.a))
}

export const Tape = memo(function Tape({
  id,
  matchup: m,
  odds,
  standings,
  history,
  compact,
  urgent,
  countRef,
  barRef,
}: {
  id: number
  matchup: Matchup
  odds: Odds
  standings: Standing[]
  history: PastFight[]
  compact: boolean
  /** the last three seconds */
  urgent: boolean
  countRef: Ref<HTMLSpanElement>
  barRef: Ref<HTMLDivElement>
}) {
  const A = fighter(m.a)
  const B = fighter(m.b)
  const st = (s: Side) => standings.find((x) => x.id === sideId(m, s))
  const met = meetings(history, m)
  const h2h = met.reduce((acc, h) => {
    const w = h.result.winner === 'a' ? h.matchup.a : h.matchup.b
    acc[w === m.a ? 0 : 1]++
    return acc
  }, [0, 0])
  const lastMet = met[0]
  const gold = m.main
  return (
    <>
      {/* the clock */}
      <motion.div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.3 }}>
        <div className={`mt-2 flex flex-col items-center rounded-2xl px-4 pb-2 pt-1.5 text-center ring-1 backdrop-blur-sm transition-shadow duration-300 sm:mt-3 sm:px-6 ${gold ? 'bg-[#1f1604]/80 ring-gold/50' : 'bg-[#060b1a]/75 ring-white/10'} ${urgent ? 'shadow-[0_0_36px_-6px_rgba(255,77,97,.85)]' : ''}`}>
          <span className={`text-[9.5px] font-black uppercase tracking-[.22em] sm:text-[11px] ${gold ? 'text-gold' : 'text-white/55'}`}>{gold ? `★ Main Event · Fight #${id} ★` : `Fight #${id}`}</span>
          <span className="flex items-baseline gap-2">
            <span className="text-[11px] font-black uppercase tracking-[.14em] text-white/80 sm:text-[13px]">Bets close in</span>
            <span ref={countRef} className={`tnum w-[2.6ch] text-left font-black leading-none transition-colors ${urgent ? 'text-[#ff6b7d]' : 'text-white'} ${compact ? 'text-[22px]' : 'text-[30px]'}`} />
          </span>
          <div className="mt-1 h-1 w-[150px] overflow-hidden rounded-full bg-white/10 sm:w-[220px]">
            <div ref={barRef} className={`h-full w-full origin-left rounded-full ${urgent ? 'bg-danger' : gold ? 'bg-gold' : 'bg-accent'}`} />
          </div>
        </div>
      </motion.div>

      {/* the band */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      >
        <div className={`bg-[linear-gradient(180deg,transparent,rgba(5,8,20,.82)_26%,rgba(5,8,20,.94))] ${compact ? 'px-2.5 pb-2 pt-6' : 'px-5 pb-4 pt-12'}`}>
          {compact ? (
            <div className="mx-auto flex max-w-[560px] flex-col gap-1.5">
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <Corner side="a" f={A} standing={st('a')} price={odds.mult['win:a']} chance={odds.p['win:a']} compact gold={gold} />
                <span className="pb-3 text-[15px] font-black italic text-white/45">VS</span>
                <Corner side="b" f={B} standing={st('b')} price={odds.mult['win:b']} chance={odds.p['win:b']} compact gold={gold} />
              </div>
              <div className="flex flex-col gap-[2px]">
                {STATS.map(([k, label]) => (
                  <StatRow key={k} label={label} a={A[k]} b={B[k]} compact />
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto grid max-w-[1100px] grid-cols-[1fr_minmax(260px,340px)_1fr] items-end gap-5">
              <Corner side="a" f={A} standing={st('a')} price={odds.mult['win:a']} chance={odds.p['win:a']} compact={false} gold={gold} />
              <div className="flex flex-col gap-[3px] pb-0.5">
                <ChanceBar a={odds.p['win:a']} />
                {STATS.map(([k, label]) => (
                  <StatRow key={k} label={label} a={A[k]} b={B[k]} compact={false} />
                ))}
                <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] gap-x-2 text-[10.5px] font-bold">
                  {(['height', 'weight', 'from'] as const).map((k) => (
                    <TapeRow key={k} label={k === 'from' ? 'Home' : k === 'height' ? 'Height' : 'Weight'} a={TAPE[m.a][k]} b={TAPE[m.b][k]} />
                  ))}
                </div>
                <div className="mt-1 text-center text-[10.5px] font-semibold text-white/50">
                  {lastMet ? (
                    <span className="inline-flex items-center gap-1">
                      Head to head {h2h[0]}–{h2h[1]} · last time
                      <MethodMark method={lastMet.result.method} size={11} />
                      {fighter(lastMet.result.winner === 'a' ? lastMet.matchup.a : lastMet.matchup.b).name} won
                    </span>
                  ) : (
                    'First meeting in the last 50 fights'
                  )}
                </div>
              </div>
              <Corner side="b" f={B} standing={st('b')} price={odds.mult['win:b']} chance={odds.p['win:b']} compact={false} gold={gold} />
            </div>
          )}
        </div>
      </motion.div>
    </>
  )
})

function Corner({ side, f, standing, price, chance, compact, gold }: { side: Side; f: Fighter; standing?: Standing; price: number; chance: number; compact: boolean; gold: boolean }) {
  const c = CORNER[side]
  const right = side === 'b'
  const fav = chance > 0.5
  return (
    <div className={`flex min-w-0 items-end gap-2 sm:gap-3 ${right ? 'flex-row-reverse text-right' : ''}`}>
      <div className="relative shrink-0 rounded-2xl p-[2px]" style={{ background: gold ? 'linear-gradient(135deg,#ffe28a,#b07a12)' : c.color, boxShadow: `0 0 26px -6px ${c.color}` }}>
        <KaijuPortrait id={f.id} size={compact ? 44 : 84} mirror={right} mood="fierce" bg className="rounded-[14px]" />
      </div>
      <div className="min-w-0 pb-0.5">
        <div className={`text-[9px] font-black uppercase tracking-[.18em] sm:text-[10px]`} style={{ color: c.color }}>
          {c.name}
        </div>
        <div className={`truncate font-black uppercase italic leading-none tracking-tight text-white ${compact ? 'text-[15px]' : 'text-[26px]'}`} style={{ textShadow: '0 2px 0 rgba(0,0,0,.5)' }}>
          {f.name}
        </div>
        {!compact && <div className="truncate text-[12px] font-bold text-white/70">{f.epithet}</div>}
        {!compact && <div className="mt-0.5 line-clamp-2 text-[11px] font-semibold italic leading-snug text-white/45">{f.style}</div>}
        <div className={`mt-1 flex items-center gap-1.5 ${right ? 'justify-end' : ''}`}>
          <span className={`tnum rounded-md px-1.5 py-0.5 font-black ${compact ? 'text-[11px]' : 'text-[13px]'} ${fav ? 'bg-accent text-[#032412]' : 'bg-white/12 text-white'}`}>{price.toFixed(2)}×</span>
          <span className={`tnum font-bold text-white/60 ${compact ? 'text-[10px]' : 'text-[11.5px]'}`}>{Math.round(chance * 100)}%</span>
        </div>
        {standing && standing.fights > 0 && (
          <div className={`mt-1 flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
            {!compact && (
              <span className="tnum mr-0.5 text-[10.5px] font-bold text-white/55">
                {standing.wins}–{standing.losses}
                {standing.ko ? ` · ${standing.ko} KO` : ''}
              </span>
            )}
            {standing.form.map((x, i) => (
              <span key={i} className={`flex items-center justify-center rounded-[4px] font-black ${compact ? 'h-3 w-3 text-[7.5px]' : 'h-4 w-4 text-[9px]'} ${x === 'W' ? 'bg-accent text-[#032412]' : 'bg-danger/80 text-white'}`}>
                {x}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatRow({ label, a, b, compact }: { label: string; a: number; b: number; compact: boolean }) {
  const bar = (v: number, other: number, side: Side) => (
    <div className={`flex h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[.07] ${side === 'a' ? 'justify-end' : ''}`}>
      <div className="h-full rounded-full" style={{ width: `${v * 10}%`, background: v >= other ? CORNER[side].color : `${CORNER[side].color}88` }} />
    </div>
  )
  return (
    <div className={`grid items-center gap-1.5 ${compact ? 'grid-cols-[14px_1fr_54px_1fr_14px]' : 'grid-cols-[16px_1fr_64px_1fr_16px]'}`}>
      <span className={`tnum text-right font-black ${a > b ? 'text-white' : 'text-white/50'} ${compact ? 'text-[10px]' : 'text-[12px]'}`}>{a}</span>
      {bar(a, b, 'a')}
      <span className={`text-center font-black uppercase tracking-[.08em] text-white/55 ${compact ? 'text-[8px]' : 'text-[9.5px]'}`}>{label}</span>
      {bar(b, a, 'b')}
      <span className={`tnum font-black ${b > a ? 'text-white' : 'text-white/50'} ${compact ? 'text-[10px]' : 'text-[12px]'}`}>{b}</span>
    </div>
  )
}

function TapeRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <>
      <span className="truncate text-right text-white/80">{a}</span>
      <span className="text-center text-[9px] font-black uppercase tracking-[.1em] text-white/40">{label}</span>
      <span className="truncate text-white/80">{b}</span>
    </>
  )
}

function ChanceBar({ a }: { a: number }) {
  return (
    <div className="mb-1">
      <div className="mb-0.5 flex justify-between text-[9.5px] font-black uppercase tracking-[.12em] text-white/45">
        <span>{Math.round(a * 100)}%</span>
        <span>Chance to win</span>
        <span>{Math.round((1 - a) * 100)}%</span>
      </div>
      <div className="flex h-[7px] overflow-hidden rounded-full">
        <div style={{ width: `${a * 100}%`, background: CORNER.a.color }} />
        <div className="w-[2px] bg-black/60" />
        <div className="flex-1" style={{ background: CORNER.b.color }} />
      </div>
    </div>
  )
}
