/*
  The top of the Rewards page: the title, then one strip that answers "what's in it for me right now". On the left the
  chest (open on a heap of gold when something is waiting), the coins ready in big type with a tile for each kind of
  reward (a tap scrolls to its card) and Claim all; on the right what the history says the player collected today and
  over the week, with a small bar for each day.

  The count matches the badge on the Rewards button. A Lucky Wheel spin counts as ready but Claim all leaves it for the
  player: the strip points to the wheel instead, and while the wheel turns it says so (its prize is held back until it
  lands). Close to midnight it warns when finished missions or a spin would be lost with the day.

  The strip's buttons sit on its left half on a wide screen because the site's toasts stack in the top right corner,
  and every claim raises one.
*/
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { useWallet } from '../../store/wallet'
import type { RewardKind } from '../../store/rewards'
import { RewardChest } from '../../art/RewardChest'
import { Coin } from '../../components/icons'
import { fmt, fmtDuration } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { rewardsSfx } from './sound'
import { useNow } from '../../lib/useNow'
import { ClaimButton, Glow, IconWheel, KINDS, KindTile, Panel, nb, useLater } from './kit'
import { dailyState } from './daily'
import { claimEverything, earnedFromLog, pickReady, readyRewards, useWheelUi, type ReadyItem } from './ready'

/** each ready item's kind (for its colour and icon) and the card a tap on its tile scrolls to */
const ITEM: Record<ReadyItem['key'], { kind: RewardKind; target: string }> = {
  refill: { kind: 'refill', target: 'refill' },
  daily: { kind: 'daily', target: 'daily-bonus' },
  levels: { kind: 'level', target: 'vip' },
  missions: { kind: 'mission', target: 'daily-missions' },
  wheel: { kind: 'wheel', target: 'lucky-wheel' },
  rakeback: { kind: 'rakeback', target: 'rakeback' },
  tier: { kind: 'tier', target: 'tier-bonus' },
  challenges: { kind: 'challenge', target: 'challenges' },
}

const coinsText = (n: number) => fmt(n, n % 1 ? 2 : 0)

export function RewardsHeader() {
  const now = useNow(1000)
  const s = useWallet(useShallow(pickReady))
  const rewardLog = useWallet((w) => w.rewardLog)
  const pushToast = useWallet((w) => w.pushToast)
  const spinning = useWheelUi((u) => u.spinning)
  const reduce = useReducedMotion()
  const later = useLater()

  const items = readyRewards(s, now, spinning)
  const count = items.reduce((a, i) => a + i.count, 0)
  const paying = items.filter((i) => i.amount !== null)
  const coins = Math.round(paying.reduce((a, i) => a + (i.amount ?? 0), 0) * 100) / 100
  const spinReady = items.some((i) => i.key === 'wheel' && i.amount === null)
  const earned = earnedFromLog(rewardLog, now)
  const daily = dailyState(s.dailyLast, s.dailyStreak, now)

  const claimAll = () => {
    const r = claimEverything(useWheelUi.getState().spinning)
    if (r.sum > 0) {
      if (r.n) rewardsSfx.collect(r.n)
      else rewardsSfx.rakeback()
      pushToast({ kind: 'reward', title: r.n === 0 ? 'Rakeback claimed' : r.n === 1 ? 'Reward claimed' : `${r.n} rewards claimed`, amount: r.sum })
    }
    if (r.unlocked) {
      later(() => rewardsSfx.unlock(), 450)
      pushToast({ kind: 'reward', title: 'Lucky Wheel unlocked: your spin is ready' })
    }
  }
  const show = (id: string) => {
    sfx.click()
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: id === 'lucky-wheel' ? 'center' : 'start' })
  }

  // the big line: the coins waiting, or the spin when it's all there is, or what's coming next. Rakeback below the
  // badge's line doesn't open the chest; it waits in a chip, still claimable.
  const open = count > 0
  // rewards with coins that count (as the badge counts them); small rakeback alone doesn't
  const counted = paying.some((i) => i.count > 0)
  const rakebackOnly = !counted && paying.length > 0
  let eyebrow: string
  let headline: ReactNode
  if (counted) {
    eyebrow = `${count} ${count === 1 ? 'reward' : 'rewards'} ready`
    headline = (
      <span className="tnum flex items-center gap-2 text-gold">
        {coinsText(coins)} <Coin size={26} />
      </span>
    )
  } else if (spinReady) {
    eyebrow = '1 reward ready'
    headline = <span className="text-[#ff8cc0]">Lucky Wheel spin</span>
  } else if (spinning) {
    eyebrow = 'Lucky Wheel'
    headline = <span className="text-[#ff8cc0]">Spinning…</span>
  } else {
    eyebrow = 'All caught up'
    headline = <span className="tnum text-[22px] sm:text-[24px]">Next bonus in {nb(fmtDuration(daily.left))}</span>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="px-0.5">
        <h1 className="text-[24px] font-black tracking-tight">Rewards</h1>
        <p className="text-[13px] text-muted">Free play-money coins, every day.</p>
      </div>

      <Panel flush>
        <Glow color={counted ? '#f7c548' : spinReady || spinning ? '#ff5fa2' : '#9b7bff'} opacity={open ? 0.16 : 0.1} className="-left-24 -top-40 h-96 w-[520px]" />
        <div className="relative flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
            <div className="flex min-w-0 items-center gap-4">
              {/* beside the text from a small tablet up; tucked into the corner on a phone */}
              <motion.div
                className="shrink-0 max-sm:absolute max-sm:right-3 max-sm:top-3"
                animate={open && !reduce ? { y: [0, -3, 0] } : { y: 0 }}
                transition={open && !reduce ? { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
              >
                <RewardChest open={open} twinkle={!reduce} size={84} className="max-sm:h-auto max-sm:w-[66px]" />
              </motion.div>
              <div className="min-w-0">
                {/* on a phone the chest sits in the corner beside these two lines */}
                <div className="max-sm:pr-[70px]">
                  <div className="text-[13px] font-bold text-muted">{eyebrow}</div>
                  <div className="mt-0.5 text-[30px] font-black leading-[1.1] tracking-tight sm:text-[34px]">{headline}</div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {counted &&
                    paying.map((i) => {
                      const look = KINDS[ITEM[i.key].kind]
                      return (
                        <button
                          key={i.key}
                          onClick={() => show(ITEM[i.key].target)}
                          title={`${i.label[0].toUpperCase()}${i.label.slice(1)}: ${coinsText(i.amount ?? 0)} coins`}
                          aria-label={`${i.label}, ${coinsText(i.amount ?? 0)} coins: show it`}
                          className="relative rounded-[11px] transition-transform hover:-translate-y-0.5"
                        >
                          <KindTile color={look.color} size={34} className="rounded-[11px]">
                            {look.icon(17)}
                          </KindTile>
                          {i.count > 1 && <span className="tnum absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-black text-[#0b1220]">{i.count}</span>}
                        </button>
                      )
                    })}
                  {rakebackOnly && (
                    <button
                      onClick={() => show('rakeback')}
                      className="tnum flex h-[34px] items-center gap-1.5 rounded-full bg-[#2fd6c3]/12 px-3 text-[12px] font-extrabold text-[#3fe3cf] ring-1 ring-[#2fd6c3]/25 transition hover:bg-[#2fd6c3]/20"
                    >
                      {KINDS.rakeback.icon(15)} {coinsText(coins)} rakeback to collect
                    </button>
                  )}
                  {((spinReady && counted) || spinning) && (
                    <button
                      onClick={() => show('lucky-wheel')}
                      className="flex h-[34px] items-center gap-1.5 rounded-full bg-[#ff5fa2]/15 px-3 text-[12px] font-extrabold text-[#ff8cc0] ring-1 ring-[#ff5fa2]/25 transition hover:bg-[#ff5fa2]/25"
                    >
                      <IconWheel size={15} /> {spinning ? 'Wheel spinning…' : '+ a wheel spin'}
                    </button>
                  )}
                  {!paying.length && !spinReady && !spinning && <span className="text-[13px] text-dim">New rewards land here as you play.</span>}
                </div>
              </div>
            </div>
            {spinReady && !counted ? (
              <ClaimButton ready tone="pink" onClick={() => show('lucky-wheel')} className="h-12 w-full shrink-0 sm:w-[150px]" burst={0}>
                <IconWheel size={18} /> Spin it
              </ClaimButton>
            ) : (
              // with nothing at all to claim there's no button: the shut chest and "All caught up" say it
              paying.length > 0 && (
                <ClaimButton ready tone={rakebackOnly ? 'green' : 'gold'} onClick={claimAll} className="h-12 w-full shrink-0 sm:w-[150px]" burst={rakebackOnly ? 1 : 1.4}>
                  {counted ? 'Claim all' : `Claim ${coinsText(coins)}`}
                </ClaimButton>
              )
            )}
          </div>

          <Earned today={earned.today} week={earned.week} days={earned.days} floor={earned.weekPartial} now={now} />
        </div>
      </Panel>
    </div>
  )
}

/** Today's and the week's takings, side by side, and the week as seven small bars (today the brightest). */
function Earned({ today, week, days, floor, now }: { today: number; week: number; days: number[]; floor: boolean; now: number }) {
  const max = Math.max(...days)
  const d = new Date(now)
  const name = (i: number) => (i === 6 ? 'Today' : new Date(d.getFullYear(), d.getMonth(), d.getDate() - (6 - i)).toLocaleDateString('en-US', { weekday: 'short' }))
  return (
    <div className="flex items-center gap-3 whitespace-nowrap rounded-xl bg-black/20 px-3.5 py-3 ring-1 ring-white/[.04] sm:gap-4 sm:px-4 lg:w-[380px] lg:shrink-0">
      <div className="min-w-0">
        <div className="text-[11.5px] font-bold text-dim">Earned today</div>
        <div className="tnum mt-0.5 flex items-center gap-1 text-[18px] font-black">
          {coinsText(today)} <Coin size={15} />
        </div>
      </div>
      <span className="h-9 w-px shrink-0 bg-white/[.07]" />
      <div className="min-w-0">
        <div className="text-[11.5px] font-bold text-dim">Last 7 days</div>
        <div className="tnum mt-0.5 flex items-center gap-1 text-[18px] font-black">
          {coinsText(week)}
          {floor ? '+' : ''} <Coin size={15} />
        </div>
      </div>
      <div className="ml-auto flex h-10 shrink-0 items-end gap-[3px]" role="img" aria-label={`Coins each day: ${days.map((v, i) => `${name(i)} ${coinsText(v)}`).join(', ')}`}>
        {days.map((v, i) => (
          <span key={i} title={`${name(i)}: ${coinsText(v)} coins`} className="flex h-full w-[7px] items-end sm:w-[9px]">
            {v > 0 ? (
              <motion.span
                className="block w-full origin-bottom rounded-t-[3px] rounded-b-[1px]"
                style={{ height: `${Math.max(12, (v / max) * 100)}%`, background: i === 6 ? '#f7c548' : 'rgba(247,197,72,.42)' }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : (
              <span className="block h-[3px] w-full rounded-full bg-white/[.1]" />
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
