import { Avatar } from '../../art/Avatar'
import { CrateArt } from '../cases/art'
import { CRATES, type Tier } from '../cases/rules'
import { CRAZY, CrazyMark, Crown, ModeGlyph, TEAM } from './art'
import { sideOf } from './engine'
import type { BattleView, Mode, SeatView } from './types'

/* Small pieces the lobby, the create dialog and the battle view share. */

export const MODE_NAME: Record<Mode, string> = { '1v1': '1v1', '1v1v1': '1v1v1', '1v1v1v1': '1v1v1v1', '2v2': '2v2' }

export function ModeChip({ mode, crazy, size = 'md' }: { mode: Mode; crazy: boolean; size?: 'sm' | 'md' }) {
  const sm = size === 'sm'
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 rounded-md bg-white/[.06] font-extrabold text-ink/90 ${sm ? 'h-6 px-1.5 text-[11px]' : 'h-7 px-2 text-[12px]'}`}>
        <ModeGlyph mode={mode} size={sm ? 10 : 12} color={mode === '2v2' ? TEAM[0] : '#9fb3c8'} />
        {MODE_NAME[mode]}
      </span>
      {crazy && (
        <span className={`inline-flex items-center gap-1 rounded-md font-extrabold uppercase tracking-wide ${sm ? 'h-6 px-1.5 text-[10px]' : 'h-7 px-2 text-[11px]'}`} style={{ color: CRAZY, background: `${CRAZY}1f` }} title="Crazy: the lowest total wins">
          <CrazyMark size={sm ? 11 : 12} />
          Crazy
        </span>
      )}
    </span>
  )
}

/** Runs of the same crate, in order: [low, low, high] → [[low, 2], [high, 1]]. */
export function runsOf(cases: Tier[]): [Tier, number][] {
  const out: [Tier, number][] = []
  for (const t of cases) {
    const last = out[out.length - 1]
    if (last && last[0] === t) last[1]++
    else out.push([t, 1])
  }
  return out
}

/** The crates a battle opens, grouped into runs, as small crate pictures with counts. */
export function CrateRuns({ cases, size = 34, max = 6 }: { cases: Tier[]; size?: number; max?: number }) {
  const runs = runsOf(cases)
  const shown = runs.slice(0, max)
  const more = runs.slice(max).reduce((a, [, n]) => a + n, 0)
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.map(([t, n], i) => (
        <span key={i} className="relative shrink-0" title={`${CRATES[t].name}${n > 1 ? ` ×${n}` : ''}`}>
          <CrateArt tier={t} size={size} />
          {n > 1 && (
            <span className="tnum absolute -bottom-1 -right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#0c1823] px-1 text-[10px] font-black text-ink ring-1 ring-white/15">
              {n}
            </span>
          )}
        </span>
      ))}
      {more > 0 && <span className="tnum shrink-0 text-[11px] font-extrabold text-dim">+{more}</span>}
    </span>
  )
}

export function TagChip({ s }: { s: SeatView }) {
  if (s.me) return <span className="rounded bg-accent/15 px-1 text-[9.5px] font-black uppercase tracking-wide text-accent">You</span>
  if (s.bot) return <span className="rounded bg-white/10 px-1 text-[9.5px] font-black uppercase tracking-wide text-muted">Bot</span>
  if (s.guest) return <span className="rounded bg-white/[.06] px-1 text-[9.5px] font-black uppercase tracking-wide text-dim">Guest</span>
  return null
}

/** Everyone's seat in a row (empty seats dashed), split by side, winners crowned once `winners` is given. */
export function SeatRow({ b, size = 30, winners }: { b: BattleView; size?: number; winners?: number[] | null }) {
  return (
    <span className="flex shrink-0 items-center">
      {b.seats.map((s, i) => {
        const seat = i + 1
        const split = i > 0 && sideOf(b.mode, seat) !== sideOf(b.mode, seat - 1)
        const won = !!winners?.includes(seat)
        const ring = b.mode === '2v2' ? TEAM[sideOf(b.mode, seat)] : undefined
        return (
          <span key={i} className="flex items-center">
            {split && <span className="mx-1 text-[9px] font-black uppercase text-dim">vs</span>}
            <span className="relative" style={{ marginLeft: !split && i > 0 ? -size * 0.18 : 0 }} title={s ? s.name : 'Empty seat'}>
              {s ? (
                <span className={`block rounded-full ${winners && !won ? 'opacity-45 grayscale-[.6]' : ''}`} style={{ boxShadow: `0 0 0 2px #0f1e2b${ring ? `, 0 0 0 3.5px ${ring}` : won ? ', 0 0 0 3.5px #ffc23d' : ''}` }}>
                  <Avatar index={s.avatar} size={size} />
                </span>
              ) : (
                <span className="block rounded-full border-[1.5px] border-dashed border-white/25 bg-[#0c1823]" style={{ width: size, height: size, boxShadow: '0 0 0 2px #0f1e2b' }} />
              )}
              {won && <Crown size={Math.round(size * 0.56)} className="absolute -top-[42%] left-1/2 -translate-x-1/2 drop-shadow-[0_2px_2px_rgba(0,0,0,.5)]" />}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** "4:59" until an open battle is called off */
export function closesIn(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
