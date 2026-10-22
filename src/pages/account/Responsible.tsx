/*
  Responsible play: the tools a real casino gives its players, on play money, for the habit.

  - A daily loss limit: today's loss (stakes less payouts since midnight) against it on a meter. Setting or lowering it
    takes effect at once; raising or removing it waits LIMIT_DELAY (a day), shown with when it lands, so it can't be
    lifted in the heat of a bad run. Bets past it are refused (the wallet says why).
  - A session reminder every so many minutes (src/components/profile/Reminder.tsx), with the session so far.
  - A cool-off: betting locked for an hour, a day, a week or a month, after a confirm. It can be lengthened, never
    ended early.
  And honest copy: the coins are play money, these tools are here anyway, and where to find real help.
*/
import { useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal } from '../../components/Modal'
import { Coin, IconCheck, IconLock } from '../../components/icons'
import { spoken, useSessionMs } from '../../components/profile/Reminder'
import { fmt, fmtDuration } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import { sfx } from '../../lib/sound'
import { useAuth } from '../../store/auth'
import { LIMIT_DELAY, currentLimits, lossToday, useWallet } from '../../store/wallet'
import { Bar, CardHead, EASE, Glow, IconClock, IconHourglass, IconShield, Panel } from './kit'

const when = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const PRESETS = [100, 500, 1000, 5000, 10000]
const REMINDERS: (number | null)[] = [null, 15, 30, 60, 120]
const COOL: { hours: number; name: string; line: string }[] = [
  { hours: 1, name: '1 hour', line: 'A short pause' },
  { hours: 24, name: '24 hours', line: 'Until this time tomorrow' },
  { hours: 24 * 7, name: '7 days', line: 'A week away' },
  { hours: 24 * 30, name: '30 days', line: 'A month away' },
]

export function LimitsTab() {
  const now = useNow(1000)
  const limits = useWallet((s) => s.limits)
  const cur = currentLimits(limits, now)
  const account = useAuth((s) => s.status === 'user')
  const cooling = cur.coolOffUntil > now
  const chips: [string, string, boolean][] = [
    ['Loss limit', cur.lossPerDay !== null ? `${fmt(cur.lossPerDay, 0)} a day` : 'None', cur.lossPerDay !== null],
    ['Reminder', cur.reminderMin ? `Every ${spoken(cur.reminderMin * 60_000)}` : 'Off', !!cur.reminderMin],
    ['Cool-off', cooling ? `Until ${when(cur.coolOffUntil)}` : 'Off', cooling],
  ]
  return (
    <div className="flex flex-col gap-4">
      <Panel flush>
        <div className="relative overflow-hidden bg-[radial-gradient(ellipse_at_10%_0%,rgba(34,211,111,.18),transparent_55%),radial-gradient(ellipse_at_100%_100%,rgba(76,180,255,.16),transparent_55%)] p-5 sm:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent ring-1 ring-accent/30">
              <IconShield size={34} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[22px] font-black leading-tight tracking-tight sm:text-[26px]">Play for fun, on your terms</h2>
              <p className="mt-1.5 max-w-[680px] text-[13.5px] leading-relaxed text-muted">
                Boje Casino uses play money only: coins can't be bought, cashed out or swapped for anything real. Real casinos give their players tools to stay in control, and so do we, because good habits are worth practising where nothing is at stake. Your limits are kept {account ? 'with your account, on every device' : 'in this browser'}.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {chips.map(([k, v, on]) => (
              <div key={k} className="flex items-center gap-3 rounded-xl bg-panel/70 px-3.5 py-3 backdrop-blur">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${on ? 'bg-accent text-[#032412]' : 'bg-raised text-dim'}`}>{on ? <IconCheck size={14} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-bold text-dim">{k}</span>
                  <span className="block truncate text-[13.5px] font-extrabold">{v}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <LossLimit now={now} />
        <div className="flex flex-col gap-4">
          <Reminder />
          <CoolOff now={now} />
        </div>
      </div>
      <Help />
    </div>
  )
}

function LossLimit({ now }: { now: number }) {
  const limits = useWallet((s) => s.limits)
  const loss = useWallet((s) => lossToday(s))
  const setLimits = useWallet((s) => s.setLimits)
  const pushToast = useWallet((s) => s.pushToast)
  const cur = currentLimits(limits, now)
  const [text, setText] = useState('')
  const want = Math.round(Number(text.replace(/[^\d.]/g, '')))
  const apply = (v: number | null) => {
    const before = cur.lossPerDay
    setLimits({ lossPerDay: v })
    const after = currentLimits(useWallet.getState().limits)
    sfx.click()
    setText('')
    if (after.pending) pushToast({ kind: 'info', title: `Raising or removing a limit waits a day: it takes effect ${when(after.pending.at)}.` })
    else if (v !== null && after.lossPerDay === v && before !== v) pushToast({ kind: 'info', title: `Daily loss limit set to ${fmt(v, 0)} coins.` })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (want > 0) apply(want)
  }
  const used = cur.lossPerDay ? Math.max(0, loss) / cur.lossPerDay : 0
  const left = cur.lossPerDay !== null ? Math.max(0, cur.lossPerDay - Math.max(0, loss)) : null
  return (
    <Panel>
      <Glow color={used >= 0.8 ? '#ff4d61' : '#22d36f'} className="-right-20 -top-20 h-60 w-60" opacity={0.12} />
      <CardHead icon={<Coin size={18} />} title="Daily loss limit" sub="The most you can lose in a day: your stakes less what you win back, since midnight." />
      <div className="rounded-xl bg-stage/70 p-4 ring-1 ring-white/[.04]" data-loss-today>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[11.5px] font-bold text-dim">{loss > 0 ? 'Lost today' : 'Today so far'}</div>
            <div className={`tnum text-[26px] font-black leading-tight tracking-tight ${loss > 0 ? '' : loss < 0 ? 'text-accent' : ''}`}>
              {loss < 0 ? `+${fmt(-loss)}` : fmt(loss)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11.5px] font-bold text-dim">Limit</div>
            <div className="tnum text-[18px] font-extrabold" data-loss-limit>
              {cur.lossPerDay !== null ? fmt(cur.lossPerDay, 0) : 'None'}
            </div>
          </div>
        </div>
        {cur.lossPerDay !== null && (
          <>
            <Bar pct={used * 100} color={used >= 1 ? '#ff4d61' : used >= 0.8 ? '#f7a440' : '#22d36f'} className="mt-3 h-2" track="bg-black/35" label="Loss limit used" />
            <div className="tnum mt-1.5 flex justify-between text-[11.5px] font-semibold text-dim">
              <span>{used >= 1 ? 'Limit reached: betting is paused until midnight' : `${fmt(left ?? 0)} left today`}</span>
              <span>{Math.min(100, Math.round(used * 100))}%</span>
            </div>
          </>
        )}
      </div>
      <AnimatePresence initial={false}>
        {cur.pending && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-gold/10 px-3.5 py-3 text-[12.5px] ring-1 ring-gold/25" data-pending>
              <IconHourglass size={16} className="mt-0.5 shrink-0 text-gold" />
              <span className="text-muted">
                <b className="text-ink">{cur.pending.lossPerDay === null ? 'Removing your limit' : `Raising it to ${fmt(cur.pending.lossPerDay, 0)}`}</b> takes effect {when(cur.pending.at)} (in {fmtDuration(cur.pending.at - now)}). Set a lower limit to cancel it.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => apply(p)} className={`tnum h-9 rounded-full px-3.5 text-[13px] font-bold transition ${cur.lossPerDay === p ? 'bg-accent text-[#032412]' : 'bg-raised text-ink hover:bg-hover'}`} data-loss-preset={p}>
            {fmt(p, 0)}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-2.5 flex gap-2">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg border-2 border-raised bg-stage px-3 transition focus-within:border-hover">
          <Coin size={17} />
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" placeholder="Your own amount" aria-label="Daily loss limit" className="tnum h-full w-full min-w-0 bg-transparent text-[15px] font-bold outline-none placeholder:font-semibold placeholder:text-dim" data-loss-input />
        </label>
        <button type="submit" disabled={!(want > 0)} className="h-12 shrink-0 rounded-lg bg-accent px-5 text-[14px] font-extrabold text-[#032412] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40" data-loss-set>
          Set limit
        </button>
      </form>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[12px] leading-snug text-dim">Lower takes effect at once. Higher, or none, waits {LIMIT_DELAY / 3600_000} hours.</p>
        {cur.lossPerDay !== null && !(cur.pending && cur.pending.lossPerDay === null) && (
          <button onClick={() => apply(null)} className="h-9 shrink-0 rounded-full bg-stage px-3.5 text-[12.5px] font-bold text-muted transition hover:text-ink">
            Remove limit
          </button>
        )}
      </div>
    </Panel>
  )
}

function Reminder() {
  const limits = useWallet((s) => s.limits)
  const setLimits = useWallet((s) => s.setLimits)
  const min = currentLimits(limits).reminderMin
  const ms = useSessionMs(1000)
  const next = min ? (Math.floor(ms / (min * 60_000)) + 1) * min * 60_000 - ms : null
  return (
    <Panel>
      <CardHead icon={<IconClock size={18} />} title="Session reminder" sub="A note of how long you've been playing, and how today has gone." />
      <div className="flex gap-1 rounded-full bg-stage p-1" role="radiogroup" aria-label="Remind me every">
        {REMINDERS.map((m) => (
          <button key={m ?? 0} role="radio" aria-checked={min === m} onClick={() => (setLimits({ reminderMin: m }), sfx.click())} className={`relative h-9 flex-1 rounded-full text-[12.5px] font-bold transition-colors ${min === m ? 'text-ink' : 'text-muted hover:text-ink'}`} data-reminder={m ?? 0}>
            {min === m && <motion.span layoutId="rmd-pick" className="absolute inset-0 -z-0 rounded-full bg-raised shadow-[0_2px_6px_rgba(0,0,0,.25)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span className="relative">{m ? (m < 60 ? `${m}m` : `${m / 60}h`) : 'Off'}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-stage/70 px-3.5 py-2.5">
          <div className="text-[11.5px] font-bold text-dim">This session</div>
          <div className="tnum text-[16px] font-extrabold">{fmtDuration(ms)}</div>
        </div>
        <div className="rounded-xl bg-stage/70 px-3.5 py-2.5">
          <div className="text-[11.5px] font-bold text-dim">Next reminder</div>
          <div className="tnum text-[16px] font-extrabold">{next !== null ? `in ${fmtDuration(next)}` : 'Off'}</div>
        </div>
      </div>
    </Panel>
  )
}

function CoolOff({ now }: { now: number }) {
  const limits = useWallet((s) => s.limits)
  const setLimits = useWallet((s) => s.setLimits)
  const pushToast = useWallet((s) => s.pushToast)
  const cur = currentLimits(limits, now)
  const [asking, setAsking] = useState<(typeof COOL)[number] | null>(null)
  const cooling = cur.coolOffUntil > now
  const confirm = () => {
    if (!asking) return
    setLimits({ coolOffHours: asking.hours })
    pushToast({ kind: 'info', title: `Cool-off on until ${when(currentLimits(useWallet.getState().limits).coolOffUntil)}.` })
    setAsking(null)
  }
  return (
    <Panel>
      <CardHead icon={<IconLock size={18} />} title="Take a cool-off" sub="Pause betting for a while. A cool-off can be made longer, never shorter." />
      {cooling && (
        <div className="mb-3 rounded-xl bg-sky/10 p-4 ring-1 ring-sky/25" data-cooloff-active>
          <div className="text-[11.5px] font-bold text-sky">Betting is paused</div>
          <div className="tnum mt-0.5 text-[24px] font-black leading-tight tracking-tight">{fmtDuration(cur.coolOffUntil - now)}</div>
          <div className="mt-0.5 text-[12px] text-muted">Until {when(cur.coolOffUntil)}. You can still visit, browse and collect rewards.</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {COOL.map((c) => {
          const ends = now + c.hours * 3600_000
          const shorter = cooling && ends <= cur.coolOffUntil
          return (
            <button key={c.hours} disabled={shorter} onClick={() => setAsking(c)} className="rounded-xl bg-panel2/70 px-3.5 py-3 text-left ring-1 ring-white/[.05] transition hover:bg-panel2 hover:ring-white/10 disabled:cursor-not-allowed disabled:opacity-40" data-cooloff={c.hours}>
              <div className="text-[14.5px] font-extrabold">{c.name}</div>
              <div className="text-[11.5px] font-semibold text-dim">{shorter ? 'Shorter than now' : c.line}</div>
            </button>
          )
        })}
      </div>
      <AnimatePresence>
        {asking && (
          <Modal onClose={() => setAsking(null)} title="Start a cool-off?" width={420}>
            <div className="flex flex-col items-center text-center" data-cooloff-confirm>
              <motion.div initial={{ scale: 0.7, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky/15 text-sky ring-1 ring-sky/30">
                <IconLock size={30} />
              </motion.div>
              <div className="mt-3 text-[22px] font-black">{asking.name}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                You won't be able to place a bet until <b className="text-ink">{when(Math.max(cur.coolOffUntil, now + asking.hours * 3600_000))}</b>. This can't be undone or ended early, on this device or any other.
              </p>
              <div className="mt-5 grid w-full grid-cols-2 gap-2">
                <button onClick={() => setAsking(null)} className="h-12 rounded-xl bg-raised text-[14px] font-bold text-ink transition hover:bg-hover">
                  Not now
                </button>
                <button onClick={confirm} className="h-12 rounded-xl bg-sky text-[14px] font-extrabold text-[#03233a] transition hover:brightness-110" data-cooloff-go>
                  Start cool-off
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </Panel>
  )
}

function Tip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-stage/60 p-3.5">
      <div className="text-[13.5px] font-extrabold">{title}</div>
      <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{children}</div>
    </div>
  )
}

function Help() {
  return (
    <Panel>
      <CardHead title="Keeping it fun" sub="Whatever the stakes, the same habits help." />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: EASE }} className="grid gap-2.5 md:grid-cols-3">
        <Tip title="Decide before you play">Pick how long you'll play and what you're happy to lose, and stop when you reach either one.</Tip>
        <Tip title="Don't chase losses">Every round is independent. Raising your stake to win back a loss usually makes the loss bigger.</Tip>
        <Tip title="Take breaks">Step away regularly. The session reminder above can nudge you.</Tip>
      </motion.div>
      <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
        If gambling with real money is causing problems for you or someone close to you, free and confidential help is available, for example from{' '}
        <a href="https://www.begambleaware.org" target="_blank" rel="noreferrer" className="font-bold text-accent hover:underline">
          BeGambleAware
        </a>{' '}
        in the UK and the{' '}
        <a href="https://www.ncpgambling.org" target="_blank" rel="noreferrer" className="font-bold text-accent hover:underline">
          National Council on Problem Gambling
        </a>{' '}
        in the US.
      </p>
    </Panel>
  )
}
