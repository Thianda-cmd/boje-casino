/*
  Today's three missions beside the Lucky Wheel they unlock. Every player gets the same three on a given day (see
  src/store/rewards.ts); they fill as the player plays and reset at local midnight. Each row shows what to do, how far
  along it is and what it pays; a finished one turns into its claim button. The featured game's mission carries the
  game's cover, which opens it, and the variety mission shows the games already played today.

  Anything finished but not claimed resets with the day too, so in the last hours before midnight the reset chip turns
  amber and asks for the claim.
*/
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { MISSION_MIN_BET, WHEEL_PRIZES, dayKey, missionTarget, missionText, missionsFor, msToMidnight, type Mission } from '../../store/rewards'
import { missionsToday, useWallet } from '../../store/wallet'
import { GAMES, gameById, type GameId } from '../../store/games'
import { GameCover } from '../../components/covers'
import { GameIcon } from '../../components/GameIcon'
import { Coin, IconBolt, IconCheck, IconChevron, IconTrophy } from '../../components/icons'
import { fmt, fmtDuration } from '../../lib/format'
import { navigate } from '../../lib/router'
import { sfx } from '../../lib/sound'
import { useNow } from '../../lib/useNow'
import { Bar, ClaimButton, EASE, Eyebrow, Glow, IconLayers, IconPlay, IconStack, IconTarget, IconWheel, KindTile, Panel, Popover, nb, useLater } from './kit'
import { WheelCard } from './WheelCard'

const gameName = (id: GameId) => gameById(id).name

/** each kind's colour and icon */
const LOOK: Record<Mission['kind'], { color: string; icon: ReactNode }> = {
  rounds: { color: '#4cb4ff', icon: <IconPlay size={21} /> },
  wager: { color: '#f7c548', icon: <IconStack size={21} /> },
  games: { color: '#9b7bff', icon: <IconLayers size={21} /> },
  featured: { color: '#22d36f', icon: <IconPlay size={21} /> },
  bigwin: { color: '#ff5fa2', icon: <IconBolt size={21} /> },
  wins: { color: '#22d36f', icon: <IconTrophy size={21} /> },
}

/** "12 / 25 rounds", "312 / 750 coins", "Not yet" */
function counter(m: Mission, progress: number) {
  const p = Math.min(progress, missionTarget(m))
  const of = (unit: string) => `${fmt(Math.floor(p), 0)} / ${fmt(m.goal, 0)} ${unit}`
  switch (m.kind) {
    case 'rounds':
    case 'featured':
      return of('rounds')
    case 'wager':
      return of('coins')
    case 'games':
      return of('games')
    case 'wins':
      return of('wins')
    case 'bigwin':
      return p >= 1 ? 'Done' : 'Not yet'
  }
}

export function DailyMissions() {
  const now = useNow(1000)
  const missions = useWallet((s) => s.missions)
  const pushToast = useWallet((s) => s.pushToast)
  const later = useLater()
  const m = missionsToday(missions, dayKey(now))
  const list = missionsFor(m.day)
  const claimed = m.claimed.filter(Boolean).length
  const done = list.filter((mi, i) => m.claimed[i] || (m.progress[i] ?? 0) >= missionTarget(mi)).length
  const total = list.reduce((a, mi) => a + mi.reward, 0)
  const collected = list.reduce((a, mi, i) => a + (m.claimed[i] ? mi.reward : 0), 0)

  const claim = (i: number) => {
    const before = missionsToday(useWallet.getState().missions).wheel
    const got = useWallet.getState().claimMission(i)
    if (!got) return
    sfx.rewards.mission()
    pushToast({ kind: 'reward', title: 'Mission reward claimed', amount: got })
    if (before === 'locked' && missionsToday(useWallet.getState().missions).wheel === 'ready') {
      later(() => sfx.rewards.unlock(), 380)
      pushToast({ kind: 'reward', title: 'Lucky Wheel unlocked: your spin is ready' })
    }
  }

  const title = claimed === 3 ? 'All three done' : done === 3 ? 'All three finished' : done ? `${done} of 3 finished` : "Today's missions"

  return (
    <Panel flush id="daily-missions">
      <Glow color="#22d36f" opacity={0.1} className="-left-32 -top-40 h-96 w-96" />
      <Glow color="#ff5fa2" opacity={0.12} className="-right-40 top-10 h-[460px] w-[460px]" />
      <div className="relative grid lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <Eyebrow className="text-accent">
                <IconTarget size={18} /> Daily missions
              </Eyebrow>
              <div className="mt-1 text-[22px] font-black tracking-tight">{title}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="tnum flex h-9 items-center gap-1.5 rounded-full bg-stage px-3 text-[12px] font-bold text-muted">
                New missions in <span className="text-ink">{nb(fmtDuration(msToMidnight(now)))}</span>
              </span>
              <Popover label="How missions work" title="How missions work">
                Everyone gets the same three missions each day. They reset at midnight (your time); a mission you finished but didn't claim is paid to you then, and a wheel spin you earned is spun for you, so nothing is lost. Rounds count from bets of {MISSION_MIN_BET} coins; the wager mission counts every coin.
              </Popover>
            </div>
          </div>
          <p className="mt-1 text-pretty text-[13px] text-muted">Claim all three to unlock a free spin of the Lucky Wheel.</p>
          <div className="mt-4 flex flex-col gap-2.5">
            {list.map((mi, i) => (
              <MissionRow key={`${m.day}${i}`} mission={mi} index={i} progress={m.progress[i] ?? 0} claimed={m.claimed[i]} played={m.games} onClaim={() => claim(i)} />
            ))}
          </div>
          {/* what today is worth: the three rewards and the spin they unlock */}
          <div className="mt-auto pt-4">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl bg-black/20 px-4 py-3 text-[13px] font-bold text-muted ring-1 ring-white/[.04]">
              <span className="flex items-center gap-1.5">
                <Coin size={15} /> Today pays <span className="tnum text-gold">{fmt(total, 0)}</span>
              </span>
              <span className="text-dim">+</span>
              <span className="flex items-center gap-1.5">
                <IconWheel size={15} className="text-[#ff7ab8]" /> a spin worth <span className="tnum text-ink">{fmt(WHEEL_PRIZES[0].amount, 0)}–{fmt(WHEEL_PRIZES[WHEEL_PRIZES.length - 1].amount, 0)}</span>
              </span>
              <span className="tnum ml-auto text-[12px] text-dim">{fmt(collected, 0)} collected</span>
            </div>
          </div>
        </div>
        <div className="relative border-t border-white/[.05] bg-black/15 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <WheelCard />
        </div>
      </div>
    </Panel>
  )
}

function MissionRow({
  mission,
  index,
  progress,
  claimed,
  played,
  onClaim,
}: {
  mission: Mission
  index: number
  progress: number
  claimed: boolean
  played: string[]
  onClaim: () => void
}) {
  const look = LOOK[mission.kind]
  const game = mission.kind === 'featured' && mission.game ? gameById(mission.game) : null
  const color = game ? game.accent : look.color
  const { title, desc } = missionText(mission, gameName)
  const target = missionTarget(mission)
  const ready = !claimed && progress >= target
  const pct = (Math.min(progress, target) / target) * 100
  const playedGames = mission.kind === 'games' ? GAMES.filter((g) => played.includes(g.id)) : []

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: EASE }}
      className={`relative flex gap-3 rounded-xl p-3 sm:gap-3.5 sm:p-3.5 ${
        ready ? 'bg-gold/[.07] shadow-[0_12px_30px_-18px_rgba(247,197,72,.7)] ring-2 ring-gold/60' : claimed ? 'bg-accent/[.05] ring-1 ring-accent/20' : 'bg-stage/70 ring-1 ring-white/[.04]'
      }`}
    >
      {game ? (
        <button
          onClick={() => navigate(`/game/${game.id}`)}
          aria-label={`Play ${game.name}`}
          className="group relative h-[58px] w-[46px] shrink-0 overflow-hidden rounded-lg shadow-[0_8px_18px_-8px_rgba(0,0,0,.8)] ring-2 transition-transform hover:-translate-y-0.5"
          style={{ ['--tw-ring-color' as string]: `${game.accent}aa` }}
        >
          <GameCover id={game.id} />
          <span className="absolute inset-x-0 bottom-0 flex h-4 items-center justify-center bg-black/65 text-[9px] font-extrabold uppercase tracking-wider text-white">Play</span>
        </button>
      ) : (
        <KindTile color={color} size={44} className={claimed ? 'opacity-60' : ''}>
          {look.icon}
        </KindTile>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className={`min-w-0 pt-0.5 text-[15px] font-extrabold leading-tight ${claimed ? 'text-muted' : ''}`}>
            {title}
            {game && <span className="ml-2 inline-flex translate-y-[-1px] rounded-full bg-accent/12 px-2 py-0.5 align-middle text-[10px] font-extrabold uppercase tracking-wider text-accent">Featured</span>}
          </div>
          <span className={`tnum flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-extrabold ${claimed ? 'bg-accent/10 text-accent' : 'bg-gold/10 text-gold'}`}>
            {claimed ? <IconCheck size={13} /> : <Coin size={13} />} {mission.reward}
          </span>
        </div>
        <div className="mt-0.5 text-pretty text-[12.5px] leading-snug text-muted">{desc}</div>
        {playedGames.length > 0 && !claimed && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[11px] font-bold text-dim">Played today</span>
            {playedGames.map((g) => (
              <span key={g.id} title={g.name} className="flex h-6 w-6 items-center justify-center rounded-md" style={{ color: g.accent, background: `${g.accent}1f` }}>
                <GameIcon id={g.id} size={14} />
              </span>
            ))}
          </div>
        )}
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Bar pct={claimed || ready ? 100 : pct} color={claimed ? '#22d36f' : ready ? '#f7c548' : color} className="h-2 flex-1" track="bg-white/[.07]" label={title} />
            <span className={`tnum shrink-0 text-[12px] font-bold ${claimed ? 'text-accent' : ready ? 'text-gold' : 'text-muted'}`}>{claimed ? 'Claimed' : counter(mission, progress)}</span>
          </div>
          {ready ? (
            <ClaimButton ready onClick={onClaim} className="h-10 w-full shrink-0 sm:w-[150px]">
              <Coin size={16} /> Claim {mission.reward}
            </ClaimButton>
          ) : (
            game &&
            !claimed && (
              <button onClick={() => navigate(`/game/${game.id}`)} className="group flex h-9 w-full shrink-0 items-center justify-center gap-0.5 rounded-lg bg-raised/70 pl-3 pr-2 text-[12.5px] font-bold text-muted transition hover:bg-hover hover:text-ink sm:w-[150px]">
                Play {game.name} <IconChevron size={14} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            )
          )}
        </div>
      </div>
    </motion.div>
  )
}
