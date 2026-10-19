/*
  The daily bonus: a new one opens 22 hours after each claim, every day in a row pays more up to day 7, and 48 hours
  without a claim restarts the streak. Seven tiles show the week: claimed days ticked, today's raised and glowing, and
  day 7's big pile set apart. The rules themselves sit behind the "i".
*/
import { motion } from 'framer-motion'
import { DAILY_COOLDOWN, DAILY_STREAK_RESET, dailyReward, useWallet } from '../../store/wallet'
import { Coin, IconCheck, IconFire, IconGift } from '../../components/icons'
import { fmtDuration } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import { ClaimButton, EASE, Eyebrow, Glow, Panel, Popover, nb, useClaim } from './kit'
import { dailyState } from './daily'

export function DailyBonus() {
  const now = useNow(1000)
  const dailyLast = useWallet((s) => s.dailyLast)
  const dailyStreak = useWallet((s) => s.dailyStreak)
  const claimDaily = useWallet((s) => s.claimDaily)
  const claim = useClaim()
  const d = dailyState(dailyLast, dailyStreak, now)
  const todayCoins = dailyReward(d.day)
  // what the claim after this one pays, if the streak holds (claimed: the next one; ready: the one after today's)
  const next = dailyReward(Math.min(d.day + 1, 7))
  const hours = (ms: number) => ms / 3600_000
  const grace = hours(DAILY_STREAK_RESET - DAILY_COOLDOWN)
  const sub = !d.ready
    ? `Next bonus: ${next} coins in ${nb(fmtDuration(d.left))}. Then you have ${grace} hours to claim it before your streak resets.`
    : !dailyLast
      ? `Claim ${todayCoins} coins now. Every day in a row pays more, up to ${dailyReward(7)} on day 7.`
      : !d.alive
        ? `Over ${hours(DAILY_STREAK_RESET)} hours have passed since your last claim, so your streak restarts at day 1.`
        : `Claim ${todayCoins} coins now; the next one pays ${next}. Claim within ${nb(fmtDuration(dailyLast + DAILY_STREAK_RESET - now))} to keep your streak.`

  return (
    <Panel className="flex flex-col" id="daily-bonus">
      <Glow color="#f7c548" opacity={0.12} className="-right-24 -top-28 h-80 w-80" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow className="text-gold">
            <IconGift size={18} /> Daily bonus
          </Eyebrow>
          <div className="mt-1 text-[22px] font-black tracking-tight">{d.ready ? `Day ${d.day} is ready` : `Day ${d.day} claimed`}</div>
          <p className="tnum mt-0.5 text-pretty text-[13px] text-muted">{sub}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* the streak: "3 days in a row" ("3 in a row" on a phone); with no streak the phone leaves it to the text */}
          <span className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-extrabold ${d.streak ? 'bg-[#ff8a3d]/12 text-[#ff9a52]' : 'bg-stage text-dim max-sm:hidden'}`}>
            <IconFire size={15} />
            {d.streak ? (
              <span className="tnum">
                {d.streak}
                <span className="max-sm:hidden"> {d.streak === 1 ? 'day' : 'days'}</span> in a row
              </span>
            ) : (
              <span>{dailyLast ? 'Streak reset' : 'No streak yet'}</span>
            )}
          </span>
          <Popover label="How the daily bonus works" title="How the daily bonus works">
            A new bonus opens {hours(DAILY_COOLDOWN)} hours after each claim. Every day in a row pays more, up to {dailyReward(7)} coins on day 7 and every day after. Go {hours(DAILY_STREAK_RESET)} hours without claiming and you're back to day 1.
          </Popover>
        </div>
      </div>

      {/* the week, centred in whatever height the card is given beside the history */}
      <div className="relative mt-5 flex flex-1 items-center">
        <div className="grid w-full grid-cols-7 gap-1.5 sm:gap-2">
          {Array.from({ length: 7 }, (_, i) => {
            const day = i + 1
            const done = d.ready ? day < d.day : day <= d.day
            const today = d.ready && day === d.day
            const big = day === 7
            return (
              <motion.div
                key={day}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: today ? -3 : 0 }}
                transition={{ delay: i * 0.04, duration: 0.35, ease: EASE }}
                className={`relative flex flex-col items-center gap-1.5 rounded-xl px-0.5 pb-2.5 pt-2 sm:gap-2 lg:gap-2.5 lg:pb-3.5 lg:pt-3 ${
                  today
                    ? 'bg-[linear-gradient(180deg,rgba(247,197,72,.26),rgba(247,197,72,.06))] shadow-[0_10px_24px_-12px_rgba(247,197,72,.8)] ring-2 ring-gold/80'
                    : done
                      ? 'bg-accent/[.08] ring-1 ring-accent/25'
                      : big
                        ? 'bg-[linear-gradient(180deg,rgba(155,123,255,.22),rgba(155,123,255,.05))] ring-1 ring-violet/35'
                        : 'bg-stage ring-1 ring-white/[.04]'
                }`}
              >
                <span className={`text-[10px] font-bold sm:text-[11px] ${today ? 'text-gold' : done ? 'text-accent' : big ? 'text-violet' : 'text-dim'}`}>
                  Day {day}
                  {big ? '+' : ''}
                </span>
                {done ? (
                  <span className="flex h-8 items-center justify-center">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[#032412] shadow-[0_4px_12px_-4px_rgba(34,211,111,.8)]">
                      <IconCheck size={14} />
                    </span>
                  </span>
                ) : (
                  <CoinPile n={big ? 4 : Math.min(3, 1 + Math.floor(i / 2))} faded={!today && !big} />
                )}
                <span className={`tnum text-[12px] font-black sm:text-[14px] ${done ? 'text-accent' : today ? 'text-gold' : big ? 'text-ink' : 'text-muted'}`}>{dailyReward(day)}</span>
                {today && <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-gold/40 motion-safe:animate-pulse" />}
              </motion.div>
            )
          })}
        </div>
      </div>

      <div className="relative pt-5">
        <ClaimButton ready={d.ready} progress={1 - d.left / DAILY_COOLDOWN} onClick={() => claim(claimDaily(), 'Daily bonus claimed')}>
          {d.ready ? (
            <>
              <Coin size={18} /> Claim {dailyReward(d.day)} coins
            </>
          ) : (
            <span className="tnum">Next bonus in {fmtDuration(d.left)}</span>
          )}
        </ClaimButton>
      </div>
    </Panel>
  )
}

const PILE = [
  [10, 0],
  [2, 3],
  [18, 3],
  [10, 9],
] as const

/** A small heap of coins; more coins on later streak days. */
function CoinPile({ n, faded }: { n: number; faded: boolean }) {
  return (
    <div className={`relative h-8 w-10 max-sm:scale-[.82] ${faded ? 'opacity-45 grayscale-[.5]' : ''}`}>
      {PILE.slice(0, n).map(([left, bottom], i) => (
        <span key={i} className="absolute" style={{ left, bottom }}>
          <Coin size={20} />
        </span>
      ))}
    </div>
  )
}
