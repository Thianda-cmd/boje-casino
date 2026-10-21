import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { fmt, round2 } from '../../lib/format'
import { scratchSfx } from './sound'
import { CARDS, coinLabel, isMax, isPrize, multLabel, symbolOf, type CardId, type Outcome } from './rules'
import { BONUS, CARD_H, CARD_R, CARD_W, cellCenter, cellRect, hasBonus } from './layout'
import { CardFace, THEMES, tableSlot } from './cardart'
import { BONUS_AREA, PANEL_AREA, ScratchEngine, type CoinFn, type Piece } from './engine'
import { FOIL } from './foil'
import { SymbolArt } from './symbols'
import { SERPENTINE, hotPairs, nextCell } from './reveal'
import type { Fx } from './fx'

/*
  One scratch card on the stage. The printed face and the symbols are DOM (SVG), the foil is the engine's canvas laid
  over them at the card's real pixel size. The pointer (mouse, pen or finger) scratches; the card is touch-action: none
  while it can be scratched, so a finger drags the coin rather than the page (and pan-y otherwise, so a sideways swipe
  can change cards while the page still scrolls).

  It reports each area as it comes out (`onReveal`) and once everything is out (`onDone`); the game decides what that
  means. The card shows what it can see by itself: two of a top-three prize pulse while their third is still covered,
  and the moment the third of a kind comes out the winners are circled one by one, hop, and send a copy of themselves
  into the prize table's row. `present` then shows the result: the rest of a winning grid steps back, and once
  `stampOn` the prize is stamped on the header. On Gold Rush a dynamite that comes out blasts the foil off the rest of
  its row.
*/

export type CardMode = 'display' | 'play' | 'done'
export type Speed = 'normal' | 'turbo' | 'instant'

export interface CardHandle {
  /** the coin works through the card by itself; resolves when everything is out */
  revealAll: (speed: Speed) => Promise<void>
  /** client coordinates of a design point */
  client: (x: number, y: number) => { x: number; y: number }
  /** a cell's box in client coordinates */
  cellBox: (i: number) => DOMRect | null
  /** a little jolt, as the stamp lands */
  jolt: (power: number) => void
  /** clears one area's foil at once (the Frenzy spot, when the grid has already lost) */
  reveal: (area: number) => void
}

interface Props {
  id: CardId
  serial: string
  outcome: Outcome | null
  mode: CardMode
  /** the price the card is printed at */
  price: number
  scale: number
  fx: Fx | null
  /** show the result on the card */
  present: boolean
  /** the stamp may land */
  stampOn: boolean
  /** what the card paid, for the stamp */
  amount: number
  /** the card was paid while the player was away */
  away?: boolean
  /** the pointer may scratch (not while the coin works by itself) */
  interactive: boolean
  /** the grid has won and the Frenzy spot is still covered: it pulses */
  hintBonus?: boolean
  onReveal?: (area: number) => void
  onDone?: () => void
  /** the stamp has landed */
  onStamp?: () => void
  /** the coin is about to work the deciding cell slowly */
  onDeciding?: () => void
  /** the pointer went down on a card that isn't bought */
  onPoke?: () => void
  /** a sideways swipe on a card not in play: 1 for the next card, -1 for the one before */
  onSwipe?: (dir: number) => void
}

/** a rubber stamp's worn texture, made once: mostly ink with specks and scratches missing */
let stampMask: string | null = null
function inkMask() {
  if (stampMask) return stampMask
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 150
    const x = c.getContext('2d')!
    x.fillStyle = '#000'
    x.fillRect(0, 0, 150, 150)
    x.globalCompositeOperation = 'destination-out'
    // fine specks where the rubber missed, a few faint drags, and a couple of patches printed thin
    for (let i = 0; i < 170; i++) {
      x.globalAlpha = 0.3 + Math.random() * 0.6
      x.beginPath()
      x.arc(Math.random() * 150, Math.random() * 150, 0.3 + Math.random() * 0.8, 0, Math.PI * 2)
      x.fill()
    }
    x.globalAlpha = 0.28
    x.lineWidth = 0.7
    for (let i = 0; i < 7; i++) {
      x.beginPath()
      const y = Math.random() * 150
      x.moveTo(Math.random() * 40, y)
      x.lineTo(70 + Math.random() * 80, y + (Math.random() - 0.5) * 16)
      x.stroke()
    }
    for (let i = 0; i < 3; i++) {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 20)
      g.addColorStop(0, 'rgba(0,0,0,.35)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      x.setTransform(1, 0, 0, 1, Math.random() * 150, Math.random() * 150)
      x.globalAlpha = 1
      x.fillStyle = g
      x.fillRect(-20, -20, 40, 40)
    }
    stampMask = c.toDataURL()
  } catch {
    stampMask = ''
  }
  return stampMask
}

/** the coin that scratches by itself during Reveal all */
function SweepCoin() {
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden>
      <defs>
        <radialGradient id="scr-coin" cx=".38" cy=".32" r=".8">
          <stop offset="0" stopColor="#fff6c4" />
          <stop offset=".45" stopColor="#ffd34a" />
          <stop offset=".85" stopColor="#e09a14" />
          <stop offset="1" stopColor="#9a5f06" />
        </radialGradient>
      </defs>
      <g transform="rotate(-24 29 29)">
        <ellipse cx="29" cy="32" rx="26" ry="18" fill="#9a5f06" />
        <ellipse cx="29" cy="29" rx="26" ry="18" fill="url(#scr-coin)" />
        <ellipse cx="29" cy="29" rx="19" ry="12.5" fill="none" stroke="#b8780a" strokeWidth="2" />
        <path d="M17 22 A20 13 0 0 1 33 16" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".7" />
      </g>
    </svg>
  )
}

/** a marker-pen loop round a cell: a little more than a full turn, slightly wobbly, as if drawn by hand */
export function loopPath(cx: number, cy: number, seed: number) {
  const pts: string[] = []
  const n = 36
  const a0 = -1.9 + seed * 0.7
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = a0 + t * Math.PI * 2 * 1.1
    const r = 1 + 0.035 * Math.sin(a * 3 + seed * 4) + t * 0.05
    pts.push(`${(cx + Math.cos(a) * 49 * r).toFixed(1)} ${(cy + Math.sin(a) * 47 * r).toFixed(1)}`)
  }
  return `M${pts.join('L')}`
}

export const Cell = memo(function Cell({ id, i, sym, price, state, popKey, hop, hot }: { id: CardId; i: number; sym: number; price: number; state: 'idle' | 'win' | 'lose'; popKey: number; hop: number; hot: boolean }) {
  const r = cellRect(i)
  const t = THEMES[id]
  const c = CARDS[id]
  const prize = isPrize(c, sym) ? c.prizes[sym] : null
  const ref = useRef<HTMLDivElement>(null)
  // the symbol pops as the last of its foil falls away
  useEffect(() => {
    if (!popKey || !ref.current?.animate) return
    ref.current.animate(
      [
        { transform: 'scale(.82)', filter: 'brightness(1.5)' },
        { transform: 'scale(1.1)', filter: 'brightness(1.15)', offset: 0.45 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' },
    )
  }, [popKey])
  // a winner hops as its ring closes
  useEffect(() => {
    if (!hop || !ref.current?.animate) return
    ref.current.animate(
      [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-13px) scale(1.16)', offset: 0.4 },
        { transform: 'translateY(2px) scale(.97)', offset: 0.75 },
        { transform: 'translateY(0) scale(1)' },
      ],
      { duration: 460, easing: 'cubic-bezier(.3,.9,.4,1)' },
    )
  }, [hop])
  return (
    <div
      className={`absolute flex flex-col items-center justify-center transition-[opacity,filter] duration-500 ${hot ? 'scr-hot' : ''}`}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 10, opacity: state === 'lose' ? 0.42 : 1, filter: state === 'lose' ? 'grayscale(.65)' : 'none' }}
    >
      <div ref={ref} className={state === 'win' ? 'scr-winsym' : ''} style={prize ? { width: 70, height: 70, marginTop: -4 } : { width: 62, height: 62 }}>
        <SymbolArt sym={symbolOf(c, sym)} size={prize ? 70 : 62} />
      </div>
      {prize && (
        <span className="tnum mt-[1px] rounded-full px-2 text-[11.5px] font-extrabold leading-[17px]" style={{ background: t.pill.bg, color: t.pill.fg }}>
          {coinLabel(round2(price * prize.mult))}
        </span>
      )}
    </div>
  )
})

export const ScratchCard = forwardRef<CardHandle, Props>(function ScratchCard(
  { id, serial, outcome, mode, price, scale, fx, present, stampOn, amount, away, interactive, hintBonus, onReveal, onDone, onStamp, onDeciding, onPoke, onSwipe },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const designRef = useRef<HTMLDivElement>(null)
  const foilHost = useRef<HTMLDivElement>(null)
  const piecesRef = useRef<HTMLDivElement>(null)
  const coinRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ScratchEngine | null>(null)
  const [pops, setPops] = useState<number[]>(() => new Array(11).fill(0))
  /** which areas are out, for the card's own reading of the board */
  const [out, setOut] = useState<boolean[]>(() => new Array(11).fill(mode === 'done'))
  const cb = useRef({ onReveal, onDone, onStamp, onDeciding, onPoke, onSwipe, fx, mode })
  cb.current = { onReveal, onDone, onStamp, onDeciding, onPoke, onSwipe, fx, mode }
  const bonus = hasBonus(id)
  const theme = THEMES[id]
  const card = CARDS[id]
  const doneSent = useRef(false)

  const client = (x: number, y: number) => {
    const r = designRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: r.left + (x / CARD_W) * r.width, y: r.top + (y / CARD_H) * r.height }
  }

  /* ---------------- the engine ---------------- */

  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const dpr = () => Math.min(2, window.devicePixelRatio || 1)

  // made in a layout effect, so the foil is up before the first paint (a new card never flashes its symbols)
  useLayoutEffect(() => {
    const e = new ScratchEngine(id, bonus, {
      reveal: (area, piece) => {
        if (piece) dropPiece(piece)
        if (area !== PANEL_AREA) {
          setPops((p) => p.map((v, i) => (i === area ? v + 1 : v)))
          setOut((o) => o.map((v, i) => (i === area ? true : v)))
          cb.current.onReveal?.(area)
          if (area < 9) blast(area)
        }
        if (e.done && !doneSent.current) {
          doneSent.current = true
          // after the last symbol's own pop (not if the card has gone by then)
          window.setTimeout(() => e.live && cb.current.onDone?.(), 120)
        }
      },
      flecks: (x, y, vx, vy, n) => {
        const f = cb.current.fx
        if (!f) return
        const p = client(x, y)
        const k = (designRef.current?.getBoundingClientRect().width ?? CARD_W) / CARD_W
        f.flecks(p.x, p.y, vx * k, vy * k, n, FOIL[id].flecks, Math.max(0.8, k))
      },
    })
    engineRef.current = e
    e.canvas.className = 'scr-foil absolute inset-0 h-full w-full'
    foilHost.current!.appendChild(e.canvas)
    e.setScale(scaleRef.current * dpr())
    // a card that arrives finished (paid while away) has no foil left
    if (cb.current.mode === 'done') {
      e.clearAll()
      doneSent.current = true
    }
    e.composite()
    if (import.meta.env.DEV) (window as unknown as { __scratchEngine?: ScratchEngine }).__scratchEngine = e
    // fonts arriving late would leave the badges in a fallback face
    let live = true
    document.fonts?.load('800 30px Manrope').then(() => live && e.repaint(), () => {})
    return () => {
      live = false
      e.dispose()
      e.canvas.remove()
      engineRef.current = null
      if (import.meta.env.DEV) {
        const w = window as unknown as { __scratchEngine?: ScratchEngine }
        if (w.__scratchEngine === e) delete w.__scratchEngine
      }
    }
    // a new card is a new component (keyed by the game)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the foil is drawn at the card's real pixel size
  useLayoutEffect(() => {
    engineRef.current?.setScale(scale * dpr())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  /** a revealed area's leftover foil fades off the card, shedding flakes */
  const dropPiece = (piece: Piece) => {
    const host = piecesRef.current
    if (!host) return
    const c = piece.canvas
    c.style.cssText = `position:absolute;left:${piece.x}px;top:${piece.y}px;width:${piece.w}px;height:${piece.h}px;pointer-events:none`
    host.appendChild(c)
    const panel = piece.area === PANEL_AREA
    const remove = () => {
      c.remove()
      c.width = c.height = 0
    }
    if (c.animate) {
      const a = c.animate(
        panel
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: 'translate(0,0) scale(1) rotate(0deg)' },
              { opacity: 0.85, transform: 'translate(0,-3px) scale(1.03) rotate(-1deg)', offset: 0.3 },
              { opacity: 0, transform: `translate(${(Math.random() - 0.5) * 10}px,-10px) scale(1.07) rotate(${(Math.random() - 0.5) * 6}deg)` },
            ],
        { duration: panel ? 520 : 380, easing: 'cubic-bezier(.2,.7,.3,1)' },
      )
      a.onfinish = remove
      a.oncancel = remove
    } else remove()
    // shavings off the piece
    const f = cb.current.fx
    if (f && !panel) {
      const k = (designRef.current?.getBoundingClientRect().width ?? CARD_W) / CARD_W
      for (let j = 0; j < 3; j++) {
        const p = client(piece.x + piece.w * (0.2 + Math.random() * 0.6), piece.y + piece.h * (0.2 + Math.random() * 0.6))
        f.flecks(p.x, p.y, (Math.random() - 0.5) * 300 * k, (Math.random() - 0.5) * 300 * k, 2, FOIL[id].flecks, Math.max(0.8, k))
      }
    }
  }

  /**
   * Gold Rush's own trick: a dynamite that comes out goes off and blows the foil off the rest of its row. Only how the
   * card comes out changes; what it holds was fixed when it was bought.
   */
  const outcomeRef = useRef(outcome)
  outcomeRef.current = outcome
  const blast = (area: number) => {
    const o = outcomeRef.current
    const e = engineRef.current
    if (id !== 'gold' || !o || !e || cb.current.mode !== 'play' || symbolOf(card, o.board[area]) !== 'dynamite') return
    const row = Math.floor(area / 3) * 3
    const targets = [row, row + 1, row + 2].filter((i) => i !== area && !e.revealed[i])
    if (!targets.length) return
    window.setTimeout(() => {
      const eng = engineRef.current
      if (!eng || eng !== e) return
      scratchSfx.blast()
      const f = cb.current.fx
      const c = cellCenter(area)
      const p = client(c.x, c.y)
      const k = (designRef.current?.getBoundingClientRect().width ?? CARD_W) / CARD_W
      f?.sparks(p.x, p.y, 10, 46 * k, '#ffd24a')
      f?.smoke(p.x, p.y - 10 * k, 9, 50 * k)
      jolt(1.6)
      targets.forEach((i, j) =>
        window.setTimeout(() => {
          if (engineRef.current !== e) return
          const q = cellCenter(i)
          const pq = client(q.x, q.y)
          f?.smoke(pq.x, pq.y, 4, 40 * k)
          e.reveal(i)
        }, 120 + j * 110),
      )
    }, 300)
  }

  /* ---------------- pointer ---------------- */

  const interactiveRef = useRef(interactive)
  interactiveRef.current = interactive

  useEffect(() => {
    const el = designRef.current!
    let pressed: number | null = null
    let voice: ReturnType<typeof scratchSfx.scrape> | null = null
    let raf = 0
    let swipe: { id: number; x: number; y: number; t: number } | null = null
    const toDesign = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: ((e.clientX - r.left) / r.width) * CARD_W, y: ((e.clientY - r.top) / r.height) * CARD_H }
    }
    const radius = (e: PointerEvent) => (e.pointerType === 'touch' ? 19 : 15.5)
    const sound = () => {
      const eng = engineRef.current
      if (voice && eng) voice.set(Math.min(1, eng.speed / 1.6), eng.removing)
      if (pressed != null) raf = requestAnimationFrame(sound)
    }
    const down = (e: PointerEvent) => {
      const eng = engineRef.current
      if (e.button > 0) return
      if (cb.current.mode !== 'play') {
        // a card on display or finished: a tap asks to buy, a sideways swipe changes cards
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
        if (cb.current.mode === 'display') cb.current.onPoke?.()
        return
      }
      if (!interactiveRef.current || !eng) return
      e.preventDefault()
      pressed = e.pointerId
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer is already gone */
      }
      const p = toDesign(e)
      eng.down(p.x, p.y, radius(e))
      eng.hover(p.x, p.y)
      voice?.stop()
      voice = scratchSfx.scrape(id)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(sound)
    }
    const move = (e: PointerEvent) => {
      const eng = engineRef.current
      if (!eng) return
      if (pressed === e.pointerId && interactiveRef.current) {
        const list = e.getCoalescedEvents?.() ?? []
        let p = toDesign(e)
        for (const ev of list.length ? list : [e]) {
          p = toDesign(ev)
          eng.move(p.x, p.y, radius(e), ev.timeStamp || performance.now())
        }
        eng.hover(p.x, p.y)
      } else if (e.pointerType === 'mouse' && pressed == null && cb.current.mode !== 'done') {
        const p = toDesign(e)
        eng.hover(p.x, p.y)
      }
    }
    const up = (e: PointerEvent) => {
      if (swipe && swipe.id === e.pointerId) {
        const dx = e.clientX - swipe.x
        const dy = e.clientY - swipe.y
        if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6 && performance.now() - swipe.t < 700) cb.current.onSwipe?.(dx < 0 ? 1 : -1)
        swipe = null
      }
      if (pressed !== e.pointerId) return
      pressed = null
      engineRef.current?.up()
      if (e.pointerType !== 'mouse') engineRef.current?.leave()
      voice?.stop()
      voice = null
      cancelAnimationFrame(raf)
    }
    const leave = () => engineRef.current?.leave()
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
      el.removeEventListener('pointerleave', leave)
      voice?.stop()
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- the handle ---------------- */

  /** a little jolt of the whole card */
  function jolt(power: number) {
    const el = rootRef.current
    if (!el?.animate) return
    const a = 3 * power
    el.animate(
      [
        { transform: 'translate(0,0) rotate(0)' },
        { transform: `translate(0,${a}px) rotate(${-0.4 * power}deg)` },
        { transform: `translate(0,${-a * 0.5}px) rotate(${0.3 * power}deg)` },
        { transform: 'translate(0,0) rotate(0)' },
      ],
      { duration: 300, easing: 'ease-out' },
    )
  }

  const coin: CoinFn = (p) => {
    const el = coinRef.current
    if (!el) return
    if (!p) {
      el.style.opacity = '0'
      return
    }
    el.style.opacity = '1'
    el.style.transform = `translate3d(${(p.x - 29).toFixed(1)}px, ${(p.y - (p.lifted ? 36 : 29)).toFixed(1)}px, 0) scale(${p.lifted ? 1.1 : 1})`
    el.style.filter = p.lifted ? 'drop-shadow(0 14px 10px rgba(0,0,0,.3))' : 'drop-shadow(0 5px 4px rgba(0,0,0,.4))'
  }

  useImperativeHandle(ref, () => ({
    revealAll: async (speed) => {
      const eng = engineRef.current
      if (!eng || eng.done || !outcome) return
      if (speed === 'instant') {
        const order = [...SERPENTINE.filter((i) => !eng.revealed[i]), ...(bonus && !eng.revealed[BONUS_AREA] ? [BONUS_AREA] : [])]
        await eng.cascade(order, 24)
        return
      }
      const fast = speed === 'turbo'
      const v = fast ? 5.2 : 2.6
      const voice = scratchSfx.scrape(id)
      let raf = 0
      const sound = () => {
        voice.set(Math.min(1, eng.speed / 1.6), eng.removing)
        raf = requestAnimationFrame(sound)
      }
      raf = requestAnimationFrame(sound)
      try {
        // until the grid is out, or the card is gone (a disposed engine scratches nothing: going round again would never
        // end, and never yield to the page either)
        while (eng.live) {
          const next = nextCell(card, outcome.board, eng.cellsOut)
          if (!next) break
          if (next.deciding) {
            // the coin hovers over the deciding cell for a breath, then works it slowly
            cb.current.onDeciding?.()
            await new Promise((r) => setTimeout(r, fast ? 140 : 320))
            await eng.scratchArea(next.cell, fast ? 0.5 : 0.24, coin, true)
          } else await eng.scratchArea(next.cell, v, coin)
          if (!eng.revealed[next.cell]) break
        }
        // the Frenzy spot last (a losing grid clears it by itself)
        await new Promise((r) => setTimeout(r, 60))
        if (eng.live && bonus && !eng.revealed[BONUS_AREA]) await eng.scratchArea(BONUS_AREA, fast ? 2.2 : 1.2, coin)
      } finally {
        eng.park(coin)
        cancelAnimationFrame(raf)
        voice.stop()
      }
    },
    client,
    cellBox: (i) => {
      const d = designRef.current?.getBoundingClientRect()
      if (!d) return null
      const r = cellRect(i)
      const k = d.width / CARD_W
      return new DOMRect(d.left + r.x * k, d.top + r.y * k, r.w * k, r.h * k)
    },
    reveal: (area) => engineRef.current?.reveal(area),
    jolt,
  }))

  /* ---------------- reading the board ---------------- */

  const won = !!outcome && outcome.prize >= 0
  // the third of a kind is out: the win is circled at once, whether or not the rest of the card is
  const marked = won && outcome.line.every((i) => out[i])
  const hot = useMemo(() => (outcome && mode === 'play' && !marked ? new Set(hotPairs(card, outcome.board, out)) : new Set<number>()), [outcome, mode, marked, card, out])
  // after the circles, the table row lights as the copies land in it
  const [tableLit, setTableLit] = useState(false)
  const [hops, setHops] = useState<number[]>([0, 0, 0])
  useEffect(() => {
    if (!marked || !outcome) return
    const timers = outcome.line.map((_, k) =>
      window.setTimeout(() => {
        setHops((h) => h.map((v, j) => (j === k ? v + 1 : v)))
        scratchSfx.ring(k)
      }, 120 + k * 190),
    )
    timers.push(window.setTimeout(() => setTableLit(true), 1050))
    return () => timers.forEach(clearTimeout)
  }, [marked, outcome])
  // a card shown already finished (paid while away) lights its row straight away
  useEffect(() => {
    if (mode === 'done' && won && !tableLit && away) setTableLit(true)
  }, [mode, won, tableLit, away])

  const cellState = (i: number): 'idle' | 'win' | 'lose' => (!present || !outcome || !won ? (marked && outcome?.line.includes(i) ? 'win' : 'idle') : outcome.line.includes(i) ? 'win' : 'lose')
  const shownW = Math.round(CARD_W * scale)
  const shownH = Math.round(CARD_H * scale)
  const stampShown = present && stampOn && !!outcome

  return (
    <div ref={rootRef} className="relative" style={{ width: shownW, height: shownH }}>
      {/* the card's shadow on the table */}
      <div className="pointer-events-none absolute inset-x-[4%] -bottom-[3%] top-[6%] rounded-[24px] bg-black/50 blur-xl" />
      <div
        ref={designRef}
        data-scr-design={mode}
        className={`absolute left-0 top-0 origin-top-left select-none ${mode === 'play' && interactive ? 'scr-coin-cursor' : ''}`}
        style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})`, touchAction: mode === 'play' ? 'none' : 'pan-y', borderRadius: CARD_R }}
      >
        <CardFace id={id} serial={serial} win={tableLit && outcome ? outcome.prize : -1} price={price} />

        {/* under the foil */}
        {outcome && outcome.board.map((s, i) => <Cell key={i} id={id} i={i} sym={s} price={price} state={cellState(i)} popKey={pops[i]} hop={marked ? hops[outcome.line.indexOf(i)] ?? 0 : 0} hot={hot.has(s) && out[i]} />)}
        {bonus && outcome && <BonusValue mult={outcome.bonus} pop={pops[BONUS_AREA]} hot={!!(present && won && outcome.bonus > 1)} />}

        {/* the foil and its loose pieces */}
        <div ref={foilHost} className="pointer-events-none absolute inset-0" style={{ filter: 'drop-shadow(0 1.3px 0.7px rgba(0,0,0,.55))' }} />
        <div ref={piecesRef} className="pointer-events-none absolute inset-0" />

        {/* two of a top-three prize with the third still covered: their cells pulse */}
        {hot.size > 0 && outcome && (
          <div className="pointer-events-none absolute inset-0 z-[3]">
            {outcome.board.map((s, i) => {
              if (!hot.has(s) || !out[i]) return null
              const r = cellRect(i)
              return <div key={i} className="scr-hotring absolute rounded-[13px]" style={{ left: r.x - 3, top: r.y - 3, width: r.w + 6, height: r.h + 6, boxShadow: `0 0 0 3px ${theme.win}, 0 0 18px 5px ${theme.win}` }} />
            })}
          </div>
        )}

        {/* the win, circled one cell at a time, and copies of the symbol flying into the table */}
        {marked && outcome && <WinMarks id={id} outcome={outcome} />}

        {/* the grid has won: the Frenzy spot asks to be scratched */}
        <AnimatePresence>
          {bonus && hintBonus && (
            <motion.div
              key="hint"
              className="pointer-events-none absolute z-[2]"
              style={{ left: BONUS.cx - BONUS.r - 7, top: BONUS.cy - BONUS.r - 7, width: BONUS.r * 2 + 14, height: BONUS.r * 2 + 14 }}
              initial={{ opacity: 0, scale: 1.4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
            >
              <div className="scr-hint absolute inset-0 rounded-full" style={{ boxShadow: '0 0 0 4px #fff, 0 0 0 7px #4a0d2c, 0 0 22px 8px rgba(255,225,74,.9)' }} />
              <div className="absolute left-1/2 top-full mt-[6px] -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2.5 py-[3px] text-[11px] font-extrabold uppercase tracking-wider text-[#4a0d2c] shadow-[0_3px_0_#4a0d2c]">
                Scratch me!
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* the coin of Reveal all */}
        <div ref={coinRef} className="pointer-events-none absolute left-0 top-0 z-[5] opacity-0 transition-opacity duration-150" style={{ willChange: 'transform' }}>
          <SweepCoin />
        </div>

        {/* the header steps back under the stamp, so the ink reads cleanly */}
        <AnimatePresence>
          {stampShown && (
            <motion.div
              key="hush"
              className="pointer-events-none absolute z-[3]"
              style={{
                left: 10,
                top: 10,
                width: CARD_W - 20,
                height: 134,
                borderRadius: 16,
                background: `linear-gradient(${theme.paper[0]}, ${theme.paper[1]})`,
                ...(bonus ? { WebkitMaskImage: `radial-gradient(circle at ${BONUS.cx - 10}px ${BONUS.cy - 10}px, transparent ${BONUS.r + 22}px, #000 ${BONUS.r + 26}px)`, maskImage: `radial-gradient(circle at ${BONUS.cx - 10}px ${BONUS.cy - 10}px, transparent ${BONUS.r + 22}px, #000 ${BONUS.r + 26}px)` } : {}),
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.84 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, delay: 0.05 }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>{stampShown && <Stamp key="stamp" id={id} outcome={outcome!} amount={amount} away={!!away} onLand={() => cb.current.onStamp?.()} />}</AnimatePresence>
        {mode === 'display' && <div className="pointer-events-none absolute inset-0" style={{ borderRadius: CARD_R, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }} />}
      </div>
      <span className="sr-only">
        {card.name}: {mode === 'play' ? 'scratch the foil to reveal nine symbols' : mode === 'done' && outcome ? (won ? `won ${fmt(amount)} coins (${multLabel(outcome.mult)})` : 'no win') : 'buy this card to play'}
      </span>
    </div>
  )
})

/** the marker rings round the winners, drawn one after another, and copies of the symbol flying into the table */
function WinMarks({ id, outcome }: { id: CardId; outcome: Outcome }) {
  const t = THEMES[id]
  const slot = tableSlot(id, outcome.prize)
  const sym = symbolOf(CARDS[id], outcome.board[outcome.line[0]])
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-[3]" width={CARD_W} height={CARD_H} viewBox={`0 0 ${CARD_W} ${CARD_H}`} aria-hidden>
        {outcome.line.map((i, k) => {
          const c = cellCenter(i)
          const d = loopPath(c.x, c.y, k + i)
          const delay = k * 0.19
          return (
            <g key={i}>
              <motion.path d={d} fill="none" stroke={t.ink} strokeOpacity=".45" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay, ease: [0.5, 0, 0.3, 1] }} />
              <motion.path d={d} fill="none" stroke={t.win} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay, ease: [0.5, 0, 0.3, 1] }} style={{ filter: `drop-shadow(0 0 4px ${t.win})` }} />
            </g>
          )
        })}
      </svg>
      {outcome.line.map((i, k) => {
        const c = cellCenter(i)
        const tx = slot.x + slot.size / 2
        const ty = slot.y + slot.size / 2
        const lift = Math.min(c.y, ty) - 60
        return (
          <motion.div
            key={i}
            className="pointer-events-none absolute z-[4]"
            style={{ left: 0, top: 0, width: 40, height: 40, marginLeft: -20, marginTop: -20 }}
            initial={{ x: c.x, y: c.y, scale: 0.9, opacity: 0 }}
            animate={{ x: [c.x, (c.x + tx) / 2 + (k - 1) * 30, tx], y: [c.y, lift, ty], scale: [0.9, 1.1, 0.55], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 0.6, delay: 0.45 + k * 0.1, ease: [0.45, 0, 0.35, 1], times: [0, 0.45, 1], opacity: { duration: 0.6, delay: 0.45 + k * 0.1, times: [0, 0.1, 0.85, 1] } }}
          >
            <SymbolArt sym={sym} size={40} />
          </motion.div>
        )
      })}
    </>
  )
}

/** Fruit Frenzy's multiplier under the bonus foil */
export function BonusValue({ mult, pop, hot }: { mult: number; pop: number; hot: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pop || !ref.current?.animate) return
    ref.current.animate([{ transform: 'scale(.6)' }, { transform: 'scale(1.18)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 460, easing: 'cubic-bezier(.3,1.5,.5,1)' })
  }, [pop])
  return (
    <div className="absolute flex items-center justify-center" style={{ left: BONUS.cx - BONUS.r, top: BONUS.cy - BONUS.r, width: BONUS.r * 2, height: BONUS.r * 2 }}>
      <div
        ref={ref}
        className={`tnum flex h-full w-full items-center justify-center rounded-full font-extrabold leading-none ${hot ? 'scr-winsym' : ''}`}
        style={{
          background: mult >= 5 ? 'radial-gradient(circle at 38% 32%, #fff9c4, #ffd21a 55%, #ff9a00)' : mult > 1 ? 'radial-gradient(circle at 38% 32%, #fff, #ffe9f3 60%, #ffc2dc)' : 'radial-gradient(circle at 38% 32%, #fff, #f1e4ea)',
          color: '#4a0d2c',
          fontSize: mult >= 10 ? 25 : 29,
          boxShadow: hot ? '0 0 0 3px #ffe14a, 0 0 18px 4px rgba(255,225,74,.8)' : 'inset 0 -3px 0 rgba(74,13,44,.18)',
          letterSpacing: '-.5px',
        }}
      >
        <span style={{ fontSize: '0.62em', marginRight: 1, marginTop: 2 }}>×</span>
        {mult}
      </div>
    </div>
  )
}

/** The prize stamped on the card's header, where it hides none of the symbols. */
export function Stamp({ id, outcome, amount, away, onLand }: { id: CardId; outcome: Outcome; amount: number; away: boolean; onLand: () => void }) {
  const t = THEMES[id]
  const won = outcome.prize >= 0
  const mask = inkMask()
  // Fruit Frenzy keeps its Frenzy spot in view
  const sx = id === 'fruit' ? 126 : CARD_W / 2
  const sy = 80
  const base = won ? CARDS[id].prizes[outcome.prize].mult : 0
  const ink = won ? t.stamp : t.dark ? '#9a90c4' : '#5d6f82'
  const landed = useRef(false)
  const inkStyle = mask ? { WebkitMaskImage: `url(${mask})`, maskImage: `url(${mask})`, WebkitMaskSize: '150px 150px', maskSize: '150px 150px' } : {}
  const kicker = away ? 'Paid while away' : outcome.top ? (isMax(outcome) && id === 'fruit' ? 'Grand jackpot' : 'Jackpot') : outcome.mult === 1 ? 'Stake back' : 'Winner'
  return (
    <motion.div
      className="pointer-events-none absolute z-[4]"
      style={{ left: sx, top: sy, x: '-50%', y: '-50%' }}
      initial={{ opacity: 0, scale: 2.4, rotate: won ? -24 : 16 }}
      animate={{ opacity: 1, scale: 1, rotate: won ? -8 : 6 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ delay: 0.05, type: 'spring', stiffness: 560, damping: 27, mass: 0.9 }}
      onAnimationComplete={() => {
        if (landed.current) return
        landed.current = true
        onLand()
      }}
    >
      <div className="relative">
        {/* the paper the ink sits on, so it reads over the header art */}
        <div className="absolute -inset-[3px] rounded-[19px]" style={{ background: t.dark ? 'rgba(12,8,28,.93)' : 'rgba(255,251,238,.95)', boxShadow: '0 10px 26px -8px rgba(0,0,0,.65)' }} />
        <div className="relative flex min-w-[150px] flex-col items-center rounded-[16px] px-5 pb-2 pt-2.5 text-center" style={{ color: ink, border: `5px double ${ink}`, ...inkStyle }}>
          {won ? (
            <>
              <div className="whitespace-nowrap text-[12px] font-extrabold uppercase leading-none tracking-[.3em]" style={{ paddingLeft: '.3em' }}>
                {kicker}
              </div>
              <div className="tnum mt-1 whitespace-nowrap text-[40px] font-extrabold leading-[1] tracking-tight">{coinLabel(amount)}</div>
              {outcome.bonus > 1 ? (
                <div className="tnum text-[11.5px] font-extrabold leading-tight opacity-90">
                  {multLabel(base)} × {outcome.bonus} Frenzy = {multLabel(outcome.mult)}
                </div>
              ) : (
                <div className="tnum text-[11.5px] font-extrabold leading-tight opacity-90">{multLabel(outcome.mult)} the price</div>
              )}
            </>
          ) : (
            <>
              <div className="text-[30px] font-extrabold uppercase leading-none tracking-[.06em]">No win</div>
              <div className="mt-1.5 whitespace-nowrap text-[10.5px] font-extrabold uppercase leading-none tracking-[.24em]" style={{ paddingLeft: '.24em' }}>
                {away ? 'While you were away' : 'Try again'}
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}
