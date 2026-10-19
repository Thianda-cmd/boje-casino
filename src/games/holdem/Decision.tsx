import { AnimatePresence, motion } from 'framer-motion'
import { fmt } from '../../lib/format'
import type { Action } from './rules'

/*
  The player's decisions: the buttons for what can be done now (Check, Bet 4× and 3× before the flop; Check, Bet 2×
  on the flop; Fold, Bet 1× at the river), passive on the left and bets on the right, each with its key and what it
  costs (a fold, what it gives up), or, when it can't be done, why (a bet the balance can't cover). With advice on,
  the recommended button wears a gold ring and an "Advice" flag, and the advice line above the buttons says why in one
  sentence.

  Two shapes: 'panel' in the side panel on a desktop, 'bar' along the foot of the stage where the panel sits below it.
*/

export interface Choice {
  action: Action
  label: string
  /** the key that makes it, as its hint shows it */
  key: string
  /** what it stakes (bets only) */
  cost?: number
  /** the line under a move that stakes nothing: what a fold gives up */
  sub?: string
  /** a second line, where there is room (the side panel): "Trips still pays" */
  note?: string
  /** another key that makes it, said under it where the key hints show: "or Space" */
  alt?: string
  /** why it can't be done now */
  blocked?: string
}

/** a button to shake (a move refused), or 'all' of them nudged (Space at the river: the player must choose) */
export interface Shake {
  action: Action | 'all'
  n: number
}

const KEY_HINT = 'rounded border px-1 text-[10px] font-bold leading-[14px]'

export function DecisionButtons({
  choices,
  advised,
  onPick,
  variant,
  keys,
  shake,
}: {
  choices: Choice[]
  advised: Action | null
  onPick: (a: Action) => void
  variant: 'panel' | 'bar'
  /** show the key hints (not on touch screens) */
  keys: boolean
  shake: Shake | null
}) {
  const bar = variant === 'bar'
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
      {choices.map((c) => {
        const bet = c.cost != null
        const on = advised === c.action && !c.blocked
        const tone = c.action === 'fold' ? 'fold' : bet ? 'bet' : 'check'
        const shaken = !!shake && (shake.action === c.action || shake.action === 'all')
        const look =
          tone === 'bet'
            ? 'bg-accent text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] hover:brightness-110'
            : tone === 'fold'
              ? 'bg-[#3b2230] text-[#ffc2ca] shadow-[inset_0_-3px_0_rgba(0,0,0,.25)] hover:bg-[#4a2a3a]'
              : 'bg-raised text-ink shadow-[inset_0_-3px_0_rgba(0,0,0,.2),inset_0_1px_0_rgba(255,255,255,.05)] hover:bg-hover'
        return (
          <motion.button
            key={`${c.action}${shaken ? shake.n : ''}`}
            type="button"
            onClick={() => onPick(c.action)}
            aria-disabled={!!c.blocked}
            aria-label={`${c.label}${c.cost != null ? `, ${fmt(c.cost)} coins` : ''}${c.blocked ? `: ${c.blocked}` : ''}${on ? ' (advised)' : ''}`}
            whileTap={c.blocked ? undefined : { scale: 0.97 }}
            animate={!shaken ? { x: 0, y: 0 } : shake.action === 'all' ? { y: [0, -5, 0, -2, 0] } : { x: [0, -6, 5, -3, 2, 0] }}
            transition={{ duration: 0.34 }}
            className={`relative flex flex-col items-center justify-center rounded-lg px-2 font-extrabold transition ${bar ? 'h-[52px]' : 'min-h-[58px]'} ${look} ${c.blocked ? 'cursor-not-allowed opacity-45 saturate-50' : ''}`}
            style={on ? { boxShadow: '0 0 0 2.5px #f7c548, 0 0 22px -2px rgba(247,197,72,.75)' } : undefined}
          >
            {on && (
              <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gold px-1.5 py-[1px] text-[9px] font-black uppercase tracking-[.12em] text-[#2a1c00] shadow">
                Advice
              </span>
            )}
            {on && (
              // a soft halo breathing round it: the ring is drawn once and only its opacity moves (no repaints)
              <motion.span
                className="pointer-events-none absolute -inset-[5px] rounded-[12px] ring-[3px] ring-gold/30"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
            <span className={`flex items-center gap-1.5 leading-tight ${bar ? 'text-[15px]' : 'text-[16px]'}`}>
              {c.label}
              {keys && <span className={`${KEY_HINT} ${tone === 'bet' ? 'border-black/20 text-black/45' : 'border-white/15 text-white/40'}`}>{c.key}</span>}
            </span>
            {(c.blocked || c.cost != null || c.sub || (keys && c.alt)) && (
              <span className={`tnum max-w-full truncate font-bold leading-tight opacity-75 ${bar ? 'text-[10.5px]' : 'text-[11.5px]'}`}>
                {c.blocked ?? (c.cost != null ? fmt(c.cost) : (c.sub ?? c.alt))}
              </span>
            )}
            {!bar && c.note && <span className="max-w-full truncate text-[10.5px] font-bold leading-tight opacity-55">{c.note}</span>}
          </motion.button>
        )
      })}
    </div>
  )
}

/** The advice in a sentence, above the buttons */
export function AdviceLine({ why, compact }: { why: string | null; compact: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {why && (
        <motion.div
          key={why}
          className={`flex items-start gap-2 rounded-lg bg-[#2a2310]/80 ring-1 ring-gold/30 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2, transition: { duration: 0.12 } }}
          transition={{ duration: 0.2 }}
          role="status"
        >
          <span className={`mt-[1px] shrink-0 rounded-full bg-gold font-black uppercase tracking-[.1em] text-[#2a1c00] ${compact ? 'px-1.5 text-[8.5px] leading-[15px]' : 'px-1.5 text-[9.5px] leading-[16px]'}`}>Advice</span>
          <span className={`font-semibold leading-snug text-[#ffe6a6] ${compact ? 'text-[11.5px]' : 'text-[12.5px]'}`}>{why}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
