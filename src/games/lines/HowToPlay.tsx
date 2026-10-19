import type { ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { GAME_U, Sym } from './art'
import { STEPS } from './Ladder'
import { BASE_SPINS, MAX_EXTRA } from './rules'

/*
  "How it works": the card and the reels, the four kinds of symbol (drawn as they land), the ladder at the bet, and
  the extra spins' pricing explained honestly (97% back on average, rounding and the price floor included), with the
  keys.
*/

function Key({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted">
      <kbd className="min-w-[52px] rounded-md border border-line bg-stage px-1.5 py-0.5 text-center text-[11.5px] font-bold text-ink">{k}</kbd>
      {children}
    </div>
  )
}

export function HowToPlay({ bet, onClose }: { bet: number; onClose: () => void }) {
  const symbols = [
    { s: { kind: 'num', n: 42, cell: null } as const, col: 2, name: 'Number', text: 'On your card in that column? It is marked.' },
    { s: { kind: 'joker' } as const, col: 0, name: 'Joker', text: 'Mark any number in its column. You choose; the best spot is suggested.' },
    { s: { kind: 'super' } as const, col: 0, name: 'Super Joker', text: 'Mark any number on the whole card.' },
    { s: { kind: 'free' } as const, col: 0, name: 'Free Spin', text: 'One more spin (on your paid-up spins only).' },
  ]
  return (
    <Modal onClose={onClose} title="How Lucky Lines works" width={500}>
      <p className="text-[13px] leading-relaxed text-muted">
        You get a 5 × 5 bingo card and {BASE_SPINS} spins for your bet. Each spin lands one symbol on each of the five reels, and each reel feeds the card column above it.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {symbols.map((x) => (
          <div key={x.name} className="flex items-center gap-2.5 rounded-lg bg-stage px-2.5 py-2">
            <Sym u={GAME_U} s={x.s} col={x.col} size={40} className="shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-extrabold">{x.name}</div>
              <div className="text-[11.5px] leading-snug text-muted">{x.text}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted">Every full row, column and diagonal is a line, 12 in all. When the game ends, the card pays the ladder for its lines:</p>
      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-lg bg-stage px-3 py-2 min-[420px]:grid-cols-2">
        {STEPS.map((s) => (
          <div key={s.lines} className="flex items-center justify-between gap-2 py-0.5 text-[12.5px]">
            <span className="font-bold text-muted">{s.lines === 12 ? 'Full card' : `${s.lines} lines`}</span>
            <span className="tnum flex items-center gap-1 font-extrabold">
              <span className="text-gold">{s.mult}×</span>
              <span className="text-dim">·</span>
              {fmt(bet * s.mult)}
              <Coin size={12} />
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        When your spins run out you can buy up to {MAX_EXTRA} extra spins, one at a time, or collect. An extra spin costs what it is worth to your card right now (the
        exact average rise of the ladder over one spin, placing jokers as suggested) divided by 0.97, rounded up to the cent and never under 1% of your bet. So extra
        spins return 97% of their price on average, a little less on small bets where the rounding counts. A card close to its next step makes a dearer spin, because
        that spin is worth more; a spin costing more than 5× your bet asks for a second press.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        The base game returns about 95.5% when you place jokers as suggested. Every spin is drawn the moment you press, and your card is saved after every step: close
        the page and it is here when you come back. Leaving while the extra-spin decision is up collects the card.
      </p>

      <div className="mt-4 flex flex-col gap-1.5">
        <Key k="Space">Play, spin, or place the suggested joker</Key>
        <Key k="1 – 5">Place a waiting joker in that column</Key>
        <Key k="A">Auto-place jokers on or off</Key>
        <Key k="E">Buy an extra spin (Space never buys one)</Key>
        <Key k="C">Collect</Key>
      </div>
    </Modal>
  )
}
