import { memo, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '../../art/Avatar'
import { AnimatedNumber } from '../../components/ui'
import { Coin, IconCheck, IconUsers } from '../../components/icons'
import { Modal } from '../../components/Modal'
import { PlayerName } from '../../components/profile/PlayerName'
import { fmt } from '../../lib/format'
import { BotTag, Crown, Token, colourOf } from './art'
import { verifyRound, type Verdict } from './fair'
import { asDeposits, type Feed, type PotServer, type RoundInfo, type Winner } from './net'
import { BET_MS, MAX_DEPOSIT, MAX_DEPOSITS, MAX_PER_PLAYER, MIN_DEPOSIT, RAKE, SHOW_MS, SPIN_MS, potOf, ranges, ticketsOf, winnings } from './rules'

/* The pieces of the Pot Luck page: the players and their chances, the live feed, the recent winners, your chance,
   the quick amounts, the fairness check and the rules. */

export const pct = (x: number) => {
  const v = x * 100
  return v >= 99.95 ? '100%' : v >= 10 ? `${v.toFixed(1)}%` : v >= 0.1 ? `${v.toFixed(2)}%` : v > 0 ? '<0.1%' : '0%'
}

/* ---------- players ---------- */

export interface PlayerRow {
  key: string
  name: string
  avatar: number
  bot: boolean
  me: boolean
  /** a signed-in player: the name opens their profile */
  acct?: boolean
  amount: number
  share: number
  colour: string
}

/** Everyone in the pot, biggest first, with their chance; you are highlighted, and the winner crowned once drawn. */
export const Players = memo(function Players({ rows, pot, round, winner, open, className = '' }: { rows: PlayerRow[]; pot: number; round: number; winner: string | null; open: boolean; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl bg-[#0c1823]/85 ring-1 ring-white/[.06] ${className}`}>
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[.05] px-3.5 py-2.5 text-[12px] font-bold">
        <span className="text-ink">Players</span>
        <span className="flex items-center gap-1 text-muted">
          <IconUsers size={13} /> <span className="tnum">{rows.length}</span>
        </span>
        <span className="tnum ml-auto flex items-center gap-1 text-ink">
          <AnimatedNumber key={round} value={pot} /> <Coin size={13} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-dim">{open ? 'The jar is empty. Be the first in.' : 'Nobody paid in'}</div>}
        <AnimatePresence initial={false}>
          {rows.map((r) => {
            const won = winner === r.key
            const lost = winner != null && !won
            return (
              <motion.div
                key={r.key}
                layout="position"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: lost ? 0.5 : 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className={`relative mx-1.5 my-0.5 flex items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 ${won ? 'bg-gold/[.12] ring-1 ring-gold/60' : r.me ? 'bg-accent/[.09] ring-1 ring-accent/45' : ''}`}
              >
                <motion.div className="pointer-events-none absolute inset-y-0 left-0" style={{ background: r.colour, opacity: 0.1 }} initial={false} animate={{ width: `${Math.max(1, r.share * 100)}%` }} transition={{ type: 'spring', stiffness: 160, damping: 24 }} />
                <span className="relative h-7 w-1 shrink-0 rounded-full" style={{ background: r.colour }} />
                <span className="relative">
                  <Avatar index={r.avatar} size={26} />
                  {won && <Crown size={16} className="absolute -right-1.5 -top-2.5 rotate-12" />}
                </span>
                <span className="relative flex min-w-0 flex-1 flex-col leading-tight">
                  <span className={`flex min-w-0 items-center gap-1.5 text-[13px] font-bold ${r.me ? 'text-accent' : 'text-ink/90'}`}>
                    <PlayerName name={r.name} acct={r.acct} className="truncate">
                      {r.me ? 'You' : r.name}
                    </PlayerName>
                    {r.bot && <BotTag />}
                  </span>
                  <span className="tnum text-[11px] font-semibold text-muted">{fmt(r.amount)}</span>
                </span>
                <span className={`tnum relative text-[13px] font-black ${won ? 'text-gold' : r.me ? 'text-accent' : 'text-ink'}`}>{won ? 'WON' : pct(r.share)}</span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
})

/* ---------- the live feed ---------- */

export interface FeedLine {
  key: string
  name: string
  avatar: number
  amount: number
  me: boolean
  bot: boolean
  acct?: boolean
  colour: string
  at: number
}

/** What just happened: who paid in, newest first. */
export const LiveFeed = memo(function LiveFeed({ lines, now, className = '' }: { lines: FeedLine[]; now: number; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl bg-[#0c1823]/85 ring-1 ring-white/[.06] ${className}`}>
      <div className="flex shrink-0 items-center gap-2 px-3.5 pb-1.5 pt-2.5 text-[12px] font-bold text-ink">
        <span className="h-2 w-2 animate-pulse rounded-full bg-danger shadow-[0_0_8px_rgba(255,77,97,.8)]" />
        Live
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-1.5 pb-1.5">
        {lines.length === 0 && <div className="px-2 py-3 text-[12px] text-dim">Waiting for the first coins…</div>}
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.div
              key={l.key}
              layout="position"
              initial={{ opacity: 0, y: -10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]"
            >
              <Avatar index={l.avatar} size={20} />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink/85">
                <PlayerName name={l.name} acct={l.acct} className={l.me ? 'font-extrabold text-accent' : 'font-extrabold text-ink'}>
                  {l.me ? 'You' : l.name}
                </PlayerName>{' '}
                added{' '}
                <span className="tnum font-extrabold" style={{ color: l.colour }}>
                  {fmt(l.amount, l.amount % 1 ? 2 : 0)}
                </span>
              </span>
              <span className="tnum shrink-0 text-[11px] font-semibold text-dim">{Math.max(0, Math.round((now - l.at) / 1000))}s</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
})

/* ---------- recent winners ---------- */

export const Winners = memo(function Winners({ items, onPick, compact }: { items: Winner[]; onPick: (id: number) => void; compact?: boolean }) {
  return (
    <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [mask-image:linear-gradient(90deg,#000_85%,transparent)]">
      {!compact && <span className="mr-1 shrink-0 text-[11px] font-semibold uppercase tracking-[.12em] text-dim">Winners</span>}
      <AnimatePresence initial={false}>
        {items.map((w) => (
          <motion.button
            key={w.id}
            layout
            layoutDependency={items[0]?.id}
            initial={{ opacity: 0, scale: 0.5, x: -10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 480, damping: 30 }}
            onClick={() => onPick(w.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[.05] py-1 pl-1 pr-2.5 ring-1 ring-white/[.06] transition hover:bg-white/10"
            aria-label={`Round ${w.id}: ${w.name} won ${fmt(winnings(w.pot))} with ${pct(w.pot ? w.amount / w.pot : 0)}`}
          >
            <Avatar index={w.avatar} size={compact ? 20 : 22} />
            <span className="tnum text-[12px] font-extrabold text-gold">{fmtShort(winnings(w.pot))}</span>
            {!compact && <span className="tnum text-[11px] font-bold text-dim">{pct(w.pot ? w.amount / w.pot : 0)}</span>}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
})

export const fmtShort = (v: number) => (v >= 100_000 ? `${(v / 1000).toFixed(0)}K` : v >= 10_000 ? `${(v / 1000).toFixed(1)}K` : fmt(v, v >= 1000 || v % 1 === 0 ? 0 : 2))

/* ---------- your chance ---------- */

export function ChanceCard({
  share,
  mine,
  pot,
  count,
  result,
  open,
  children,
}: {
  share: number
  mine: number
  pot: number
  count: number
  /** this round's outcome for you, once drawn */
  result: { won: boolean; payout: number; bet: number; refund: number } | null
  open: boolean
  children?: ReactNode
}) {
  const inPot = mine > 0
  return (
    <div className="relative overflow-hidden rounded-xl bg-stage p-3.5 ring-1 ring-white/[.04]">
      <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full opacity-60 blur-2xl" style={{ background: inPot ? 'rgba(34,211,111,.22)' : 'rgba(247,197,72,.12)' }} />
      <div className="relative flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold text-muted">Your chance</div>
          <div className={`tnum mt-0.5 text-[34px] font-black leading-none tracking-tight ${inPot ? 'text-accent' : 'text-white/25'}`} style={inPot ? { textShadow: '0 0 24px rgba(34,211,111,.35)' } : undefined}>
            {inPot ? pct(share) : '0%'}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 pt-0.5">
          <div className="flex gap-1" aria-label={`${count} of ${MAX_DEPOSITS} payments`}>
            {Array.from({ length: MAX_DEPOSITS }, (_, i) => (
              <span key={i} className={`h-2 w-2 rounded-full ${i < count ? 'bg-accent shadow-[0_0_6px_rgba(34,211,111,.8)]' : 'bg-white/10'}`} />
            ))}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-dim">payments</span>
        </div>
      </div>
      <div className="relative mt-2.5 text-[12px] leading-relaxed">
        {result && (result.bet > 0 || result.refund > 0) ? (
          result.won ? (
            <span className="font-bold text-accent">
              You won <span className="tnum">{fmt(result.payout)}</span>: <span className="tnum">+{fmt(result.payout - result.bet)}</span> profit
            </span>
          ) : result.bet > 0 ? (
            <span className="font-semibold text-muted">
              Not this time. <span className="tnum text-ink/80">{fmt(result.bet)}</span> went into the pot.
            </span>
          ) : (
            <span className="font-semibold text-muted">{fmt(result.refund)} never reached the pot, so it came back.</span>
          )
        ) : inPot ? (
          <span className="font-semibold text-muted">
            <span className="tnum font-bold text-ink">{fmt(mine)}</span> of <span className="tnum font-bold text-ink">{fmt(pot)}</span>. If your ticket is drawn you take{' '}
            <span className="tnum font-bold text-gold">{fmt(winnings(pot))}</span>.
          </span>
        ) : (
          <span className="font-semibold text-dim">{open ? 'Every coin you pay in is a ticket. Your chance is your share of the pot.' : 'Pay in when the next round opens.'}</span>
        )}
      </div>
      {children}
    </div>
  )
}

/** Set the amount in one tap. */
export function QuickAmounts({ value, max, onPick, disabled }: { value: number; max: number; onPick: (v: number) => void; disabled?: boolean }) {
  const opts: [string, number][] = [
    ['10', 10],
    ['50', 50],
    ['100', 100],
    ['500', 500],
    ['1K', 1000],
    ['Max', Math.max(MIN_DEPOSIT, Math.floor(Math.min(max, MAX_DEPOSIT) * 100) / 100)],
  ]
  return (
    <div className="-mt-2 grid grid-cols-6 gap-1.5">
      {opts.map(([label, v]) => (
        <button
          key={label}
          disabled={disabled}
          onClick={() => onPick(v)}
          className={`h-10 rounded-lg text-[12px] font-bold transition disabled:opacity-50 ${value === v ? 'bg-hover text-ink ring-1 ring-white/10' : 'bg-raised text-muted hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/* ---------- fairness ---------- */

/** A round's published hash and, once its wheel has landed, the revealed seed checked here in the browser. */
export function FairnessModal({ server, feed, history, id, landed, onPick, onClose }: { server: PotServer; feed: Feed; history: Winner[]; id: number; landed: boolean; onPick: (id: number) => void; onClose: () => void }) {
  const current = feed.round.id === id ? feed.round : null
  const [info, setInfo] = useState<RoundInfo | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'pending' | 'missing'>('loading')
  const [copied, setCopied] = useState<string | null>(null)
  const done = !current || (landed && current.seed != null)

  useEffect(() => {
    let alive = true
    setVerdict(null)
    setInfo(null)
    if (!done) {
      setState('pending')
      return
    }
    setState('loading')
    server
      .roundInfo(id)
      .catch(() => null)
      .then((r) => {
        if (!alive) return
        if (!r) return setState('missing')
        setInfo(r)
        setState('ready')
        setVerdict(verifyRound(r.seed, r.hash, asDeposits(r.deposits), r.ticket, r.opensAt))
      })
    return () => void (alive = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, done])

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1200)
    })
  }
  const hash = current?.hash ?? info?.hash ?? ''
  const ds = info ? asDeposits(info.deposits) : []
  const win = verdict && verdict.index >= 0 ? ds[verdict.index] : null
  const winAcct = !!(win && info?.deposits[verdict!.index]?.acct)
  const winAmount = win ? ds.filter((d) => d.who === win.who).reduce((a, d) => a + ticketsOf(d.amount), 0) / 100 : 0
  const pot = info ? potOf(ds) : 0
  const range = win && verdict ? ranges(ds)[verdict.index] : null
  const field = (label: string, value: string | null, placeholder: string) => (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-muted">
        {label}
        {value && (
          <button onClick={() => copy(label, value)} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-dim transition hover:bg-panel2 hover:text-ink">
            {copied === label ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className="break-all rounded-lg bg-stage px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink/90">{value || <span className="font-sans text-dim">{placeholder}</span>}</div>
    </div>
  )
  const check = (ok: boolean | null | undefined, text: ReactNode) => (
    <div className="flex items-center gap-2 text-[13px] font-semibold">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok == null ? 'bg-raised' : ok ? 'bg-accent text-[#032412]' : 'bg-danger text-white'}`}>
        {ok == null ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" /> : ok ? <IconCheck size={12} /> : '!'}
      </span>
      <span className="min-w-0">{text}</span>
    </div>
  )

  return (
    <Modal onClose={onClose} title={`Round #${id}`} width={540}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {win ? (
            <>
              <span className="relative">
                <Avatar index={win.avatar} size={46} />
                <Crown size={20} className="absolute -right-2 -top-3 rotate-12" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[19px] font-black leading-tight">
                  <PlayerName name={win.name} acct={winAcct}>
                    {win.me ? 'You' : win.name}
                  </PlayerName>{' '}
                  won <span className="tnum text-gold">{fmt(winnings(pot))}</span>
                </div>
                <div className="tnum text-[12px] font-semibold text-muted">
                  {fmt(winAmount)} of a {fmt(pot)} pot: a {pct(pot ? winAmount / pot : 0)} chance
                </div>
              </div>
            </>
          ) : (
            <div className="text-[22px] font-black leading-none text-ink">{state === 'pending' ? (current?.phase === 'betting' ? 'Taking coins' : 'Drawing') : state === 'loading' ? 'Checking…' : 'Round'}</div>
          )}
          {!server.online && <span className="ml-auto shrink-0 rounded-full bg-raised px-2.5 py-1 text-[11px] font-bold text-muted">Solo round</span>}
        </div>
        {field('Hash, published before anyone paid in', hash || null, 'Not available')}
        {field('Seed', state === 'ready' ? info!.seed : null, state === 'pending' ? 'Revealed when the wheel lands' : state === 'missing' ? 'This round is too old to look up' : 'Loading…')}
        {state === 'ready' && info && (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            {check(verdict?.hashOk, 'The seed matches the published hash')}
            {check(
              verdict ? verdict.ticketOk && verdict.index >= 0 : null,
              verdict && range ? (
                <>
                  The seed draws ticket <span className="tnum font-black">{(verdict.ticket + 1).toLocaleString('en-US')}</span> of <span className="tnum">{info.tickets.toLocaleString('en-US')}</span>, which{' '}
                  {win?.me ? 'you' : win?.name} held (tickets {(range.from + 1).toLocaleString('en-US')} to {range.to.toLocaleString('en-US')})
                </>
              ) : (
                'Working out the winning ticket'
              ),
            )}
            {verdict?.botsOk != null && check(verdict.botsOk, `The house bots are the ones the hash set (${ds.filter((d) => d.bot).length} of them)`)}
          </div>
        )}
        {state === 'ready' && ds.length > 0 && (
          <div>
            <div className="mb-2 text-[12px] font-bold text-muted">Every deposit, in the order paid</div>
            <div className="flex max-h-[176px] flex-col gap-1 overflow-y-auto rounded-xl bg-stage p-2">
              {ranges(ds).map((r, i) => {
                const d = ds[i]
                const hit = verdict?.index === i
                return (
                  <div key={i} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] ${hit ? 'bg-gold/[.12] ring-1 ring-gold/50' : ''}`}>
                    <Token colour={colourOf(d.p, d.me)} size={13} />
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink/85">
                      <PlayerName name={d.name} acct={info?.deposits[i]?.acct}>
                        {d.me ? 'You' : d.name}
                      </PlayerName>{' '}
                      {d.bot && <BotTag className="ml-1" />}
                    </span>
                    <span className="tnum font-bold text-ink">{fmt(d.amount)}</span>
                    <span className="tnum w-[128px] text-right text-[11px] font-semibold text-dim">
                      #{(r.from + 1).toLocaleString('en-US')}–{r.to.toLocaleString('en-US')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div>
          <div className="mb-2 text-[12px] font-bold text-muted">Recent rounds</div>
          <div className="flex flex-wrap gap-1.5">
            {history.slice(0, 14).map((h) => (
              <button key={h.id} onClick={() => onPick(h.id)} className={`rounded-full transition ${h.id === id ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel' : 'opacity-75 hover:opacity-100'}`} aria-label={`Round ${h.id}`}>
                <Avatar index={h.avatar} size={28} />
              </button>
            ))}
            {feed.round.id !== id && (
              <button onClick={() => onPick(feed.round.id)} className="rounded-full bg-raised px-3 py-1.5 text-[12px] font-extrabold text-muted hover:bg-hover hover:text-ink">
                Current round
              </button>
            )}
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-dim">
          Each round draws from a random seed. Its SHA-256 hash is shown before anyone pays in, so the draw can't be changed afterwards. When the wheel lands the seed is revealed and your browser checks it:
          u is the first 52 bits of SHA-256(seed + ":pot") over 2^52, and the winning ticket is floor(u × tickets), counting a ticket for every cent in the order the coins went in. The house bots
          come from the hash too (SHA-256(hash + ":bots:" + n)), so they were fixed before anyone else paid in.
        </p>
      </div>
    </Modal>
  )
}

/* ---------- the rules ---------- */

export function InfoModal({ onClose }: { onClose: () => void }) {
  const row = (k: ReactNode, v: ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-[13px] last:border-0">
      <span className="text-muted">{k}</span>
      <span className="tnum text-right font-bold text-ink">{v}</span>
    </div>
  )
  return (
    <Modal onClose={onClose} title="How Pot Luck works" width={520}>
      <div className="flex flex-col gap-4 text-[13px] leading-relaxed text-ink/85">
        <p>
          One pot, shared by everyone at the table. Pay coins in while the jar is open; every cent is a ticket, numbered in the order the coins went in. When betting closes one ticket is drawn, and
          whoever holds it takes the whole pot less a {Math.round(RAKE * 100)}% rake.
        </p>
        <div className="rounded-xl bg-stage px-3.5 py-1">
          {row('Your chance', 'your coins ÷ the pot')}
          {row('The winner takes', `the pot less ${Math.round(RAKE * 100)}%`)}
          {row('Return to player', `${Math.round((1 - RAKE) * 100)}% of every coin, on average`)}
          {row('Each payment', `${MIN_DEPOSIT} to ${fmt(MAX_DEPOSIT, 0)}`)}
          {row('Each round', `up to ${MAX_DEPOSITS} payments, ${fmt(MAX_PER_PLAYER, 0)} in all`)}
          {row('A round', `${BET_MS / 1000} s to pay in, a ${SPIN_MS / 1000} s draw, ${SHOW_MS / 1000} s for the winner`)}
        </div>
        <p>
          The return is exact and the same however you play: a player with a tenth of the pot wins a tenth of the time and takes {Math.round((1 - RAKE) * 100)}% of the pot, so on average each coin comes
          back as {(1 - RAKE).toFixed(2)} (the winnings are rounded down to the cent). Paying in early or late, a little or a lot, changes your chance and what you stand to win, never the average.
        </p>
        <p>
          House bots join every round with the house's coins (two to five of them, marked BOT), so there is always a pot. A bot's win is the house's; the house's only edge is the rake on players' coins.
          The bots are set by the round's published hash, before anyone else pays in.
        </p>
        <p>
          Every round is provably fair: its hash is published before anyone pays in and its seed revealed after the draw, and the shield button checks any round in your browser. Leave the page or
          close it mid-round and your coins stay in; a pot you win is paid as soon as you are back in the casino.
        </p>
      </div>
    </Modal>
  )
}

