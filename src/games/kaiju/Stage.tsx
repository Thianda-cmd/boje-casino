import { useEffect, useRef, useState } from 'react'
import type { KaijuId, StageProps } from './types'
import type { KaijuStage } from './stage/scene'
import { KaijuPortrait } from './portraits'

/*
  Kaiju Clash's 3D stage as a React component: Neon Bay at night with the round's two kaiju, played from the shared
  clock and the fight script (stage/scene.ts does the work; stage/director.ts decides what is shown when). The 3D code
  loads on its own, after the page, so the lobby never pays for it; until it is up (or if the browser can't do
  WebGL) the stage shows the matchup's portraits over the night skyline instead.

  Props (types.ts StageProps): `view` the round (its fight once betting has closed), `now` the shared clock, `onEvent`
  what the page should hear, once each, on the live clock (stage/director.ts stageEvents):
    bell      a round's bell (1 to 3)
    roar      a kaiju roars (the walkout, a roar in the fight, the winner's celebration): who
    land      a blow lands: who is the striker; heavy for heavies, charges, specials and throws (a throw lands when the
              thrown kaiju hits the ground)
    block     a blow is blocked: who is the striker whose blow was stopped
    collapse  a building comes down: which (arena.ts BUILDINGS) and who brought it down
    ko        the knockout blow: who is the winner
    splash    the loser hits the bay: who is the winner
    final     the final bell of a fight that goes the distance (an early finish has no final bell)
  Events are for sounds and flourishes; anything that must be right (banners, health) should follow the clock, since
  a page that was away hears nothing of what it missed.

  After a knockout or a Splash the stage freezes the blow, plays it on in slow motion and then replays the finishing
  beat from another angle (stage/director.ts replayOf); while the replay runs the stage letterboxes itself, shows a
  REPLAY tag in its bottom-right corner and sets data-replay on its element, for a page that wants to hold back an
  overlay meanwhile.

  It stops drawing when it is scrolled out of sight or the tab is hidden, and under reduced motion it holds steady
  wide shots without shakes, flashes or slow motion.
*/

declare global {
  interface Window {
    __kjStage?: KaijuStage
  }
}

export default function Stage({ view, now, onEvent, className = '' }: StageProps) {
  const host = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const bars = useRef<HTMLDivElement>(null)
  const tag = useRef<HTMLDivElement>(null)
  const scene = useRef<KaijuStage | null>(null)
  const latest = useRef({ view, now, onEvent })
  latest.current = { view, now, onEvent }
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    let on = true
    let sc: KaijuStage | null = null
    let ro: ResizeObserver | null = null
    let io: IntersectionObserver | null = null
    let seen = true
    const calmQ = matchMedia('(prefers-reduced-motion: reduce)')
    const low = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 560
    const sync = () => sc?.setActive(seen && !document.hidden)
    const onCalm = () => sc?.setCalm(calmQ.matches)
    import('./stage/scene')
      .then(({ KaijuStage }) => {
        if (!on || !host.current) return
        try {
          sc = new KaijuStage(host.current, { low, calm: calmQ.matches })
        } catch {
          setState('failed')
          return
        }
        scene.current = sc
        sc.now = () => latest.current.now()
        sc.onEvent = (e) => latest.current.onEvent?.(e)
        sc.onFail = () => on && setState('failed')
        sc.overlay = { flash: flash.current ?? undefined, bars: bars.current ?? undefined, tag: tag.current ?? undefined }
        sc.setView(latest.current.view)
        const fit = () => {
          const r = host.current?.getBoundingClientRect()
          if (r) sc?.resize(r.width, r.height)
        }
        ro = new ResizeObserver(fit)
        ro.observe(host.current)
        fit()
        io = new IntersectionObserver(
          ([en]) => {
            seen = en.isIntersecting
            sync()
          },
          { threshold: 0 },
        )
        io.observe(host.current)
        document.addEventListener('visibilitychange', sync)
        calmQ.addEventListener('change', onCalm)
        if (import.meta.env.DEV) window.__kjStage = sc
        return sc.ready.then(() => on && setState('ready'))
      })
      .catch(() => on && setState('failed'))
    return () => {
      on = false
      ro?.disconnect()
      io?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      calmQ.removeEventListener('change', onCalm)
      if (import.meta.env.DEV && window.__kjStage === sc) delete window.__kjStage
      sc?.dispose()
      scene.current = null
    }
  }, [])

  useEffect(() => {
    scene.current?.setView(view)
  }, [view])

  // the replay tag is the scene's to show; this mirrors it as an attribute for the page
  useEffect(() => {
    const el = tag.current
    const w = wrap.current
    if (!el || !w) return
    const mo = new MutationObserver(() => w.toggleAttribute('data-replay', el.style.opacity === '1'))
    mo.observe(el, { attributes: true, attributeFilter: ['style'] })
    return () => mo.disconnect()
  }, [])

  const m = view?.matchup
  return (
    <div ref={wrap} className={`relative overflow-hidden bg-[#0c0820] ${className}`}>
      <div ref={host} className="absolute inset-0" />
      {state !== 'ready' && <Poster a={m?.a} b={m?.b} failed={state === 'failed'} />}
      {/* the edges a touch darker, so whatever the page lays over the stage reads */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(6,4,18,0.55)_100%)]" />
      <div ref={flash} aria-hidden className="pointer-events-none absolute inset-0 bg-white opacity-0 mix-blend-screen" />
      <div ref={bars} aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300">
        <div className="absolute inset-x-0 top-0 h-[7%] bg-black/85" />
        <div className="absolute inset-x-0 bottom-0 h-[7%] bg-black/85" />
      </div>
      <div ref={tag} aria-hidden className="pointer-events-none absolute bottom-[2.2%] right-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-black tracking-[0.18em] text-white opacity-0 transition-opacity duration-300 sm:text-[11px]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
        REPLAY
      </div>
    </div>
  )
}

/** what the stage shows until the 3D is up (or instead of it): the night sky, a skyline, the two fighters facing off */
function Poster({ a, b, failed }: { a?: KaijuId; b?: KaijuId; failed: boolean }) {
  const towers = [8, 14, 6, 20, 11, 26, 9, 17, 30, 12, 22, 7, 15, 24, 10, 18, 6, 13]
  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(180deg,#0b0828_0%,#24104a_48%,#6a1d5c_78%,#a8306f_100%)]">
      <div className="absolute right-[14%] top-[12%] h-[16%] w-auto rounded-full bg-[#f6efd6] shadow-[0_0_60px_20px_rgba(160,140,255,0.25)]" style={{ aspectRatio: '1' }} />
      <svg className="absolute inset-x-0 bottom-0 h-[42%] w-full" viewBox="0 0 180 40" preserveAspectRatio="none" aria-hidden>
        {towers.map((h, i) => (
          <rect key={i} x={i * 10} y={40 - h} width={9} height={h} fill="#120a26" />
        ))}
        <rect x={0} y={36} width={180} height={4} fill="#0a0618" />
      </svg>
      {a && b && (
        <div className="absolute inset-0 flex items-center justify-center gap-[8%] pb-[4%]">
          <KaijuPortrait id={a} size={120} mood="fierce" className="h-[38%] w-auto drop-shadow-[0_6px_18px_rgba(0,0,0,0.6)]" />
          <span className="text-[clamp(18px,4vw,40px)] font-black italic text-white/90 [text-shadow:0_3px_0_#0b1020]">VS</span>
          <KaijuPortrait id={b} size={120} mood="fierce" mirror className="h-[38%] w-auto drop-shadow-[0_6px_18px_rgba(0,0,0,0.6)]" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-[6%] text-center text-[12px] font-bold text-white/60">
        {failed ? 'The 3D stage needs WebGL: the fight plays on in the commentary.' : 'Lighting up Neon Bay…'}
      </div>
    </div>
  )
}
