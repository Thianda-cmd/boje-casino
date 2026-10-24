import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { FeatureMark, ItemGlyph } from '../art'
import { Callout, HudStyles, Party, WinBanner, type BannerInfo } from '../Hud'
import { resultOf } from '../rules'
import { ITEM_KINDS, type Feature, type ItemKind } from '../types'

/*
  The page art lab (#/dev/pusher-art, dev server only): Coin Cascade's flat pictures at every size the page uses them
  (the history pills, the paytable, the field strip, the banner, the celebration), and the stage's moments on a plain
  backdrop (the banner for each kind of result, COIN SHOWER! and QUAKE!, the Idol's and the Crown's celebration), so
  they can be looked at without playing drops.
*/

const SAMPLES: { wins: Partial<Record<ItemKind, number>>; feature?: Feature; bet?: number }[] = [
  { wins: { silver: 3 } },
  { wins: { silver: 2, gold: 1 } },
  { wins: { gold: 3, silver: 1 } },
  { wins: { gem: 1, silver: 2 } },
  { wins: { silver: 8, gold: 3 }, feature: 'shower' },
  { wins: { silver: 12, gold: 3, gem: 1 }, feature: 'quake' },
  { wins: { bar: 1, gold: 1, silver: 2 } },
]

export default function PusherArtLab() {
  const [banner, setBanner] = useState(1)
  const [party, setParty] = useState<'idol' | 'crown' | 'both' | null>(null)
  const [callout, setCallout] = useState<{ id: number; kind: 'shower' | 'quake' } | null>(null)
  const s = SAMPLES[banner]
  const r = resultOf(s.wins, s.feature)
  const b: BannerInfo = { id: String(banner), wins: r.wins, mult: r.mult, feature: r.feature, amount: Math.floor(10 * r.mult * 100 + 1e-6) / 100 }
  const pr = party === 'both' ? resultOf({ crown: 1, idol: 1, gold: 4, silver: 14 }, 'quake') : party ? resultOf({ [party]: 1, silver: 2 }) : null
  return (
    <div className="mx-auto max-w-[1200px] p-4 text-ink" data-lab>
      <HudStyles />
      <h1 className="mb-3 text-[20px] font-black">Coin Cascade page art</h1>
      <div className="flex flex-wrap items-end gap-6 rounded-xl bg-panel p-4" data-glyphs>
        {ITEM_KINDS.map((k) => (
          <div key={k} className="flex flex-col items-center gap-2">
            <div className="flex items-end gap-2">
              {[15, 22, 26, 40, 96, 136].map((n) => (
                <ItemGlyph key={n} kind={k} size={n} />
              ))}
            </div>
            <span className="text-[12px] text-muted">{k}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 text-gold">
          <FeatureMark kind="shower" size={12} />
          <FeatureMark kind="quake" size={12} />
          <FeatureMark kind="shower" size={32} />
          <FeatureMark kind="quake" size={32} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        {SAMPLES.map((x, i) => (
          <button key={i} onClick={() => setBanner(i)} className={`rounded-lg px-2.5 py-1 font-bold ${i === banner ? 'bg-sky text-bg' : 'bg-raised'}`}>
            {Object.entries(x.wins)
              .map(([k, n]) => `${n} ${k}`)
              .join(' + ')}
            {x.feature ? ` (${x.feature})` : ''}
          </button>
        ))}
        <button onClick={() => setCallout({ id: Date.now(), kind: 'shower' })} className="rounded-lg bg-raised px-2.5 py-1 font-bold">
          Shower callout
        </button>
        <button onClick={() => setCallout({ id: Date.now(), kind: 'quake' })} className="rounded-lg bg-raised px-2.5 py-1 font-bold">
          Quake callout
        </button>
        {(['idol', 'crown', 'both'] as const).map((k) => (
          <button key={k} onClick={() => setParty(k)} className="rounded-lg bg-gold px-2.5 py-1 font-bold text-bg">
            Party: {k}
          </button>
        ))}
      </div>
      <div className="relative mt-3 aspect-[16/10] w-full overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_35%,#1a2a86_0%,#0b1240_55%,#070b22_100%)]" data-stage>
        <AnimatePresence>
          <WinBanner key={b.id} b={b} />
        </AnimatePresence>
        <AnimatePresence>{callout && <Callout key={callout.id} kind={callout.kind} />}</AnimatePresence>
        <AnimatePresence>{party && pr && <Party key={party} p={{ id: party, wins: pr.wins, mult: pr.mult, amount: Math.floor(10 * pr.mult * 100 + 1e-6) / 100, feature: pr.feature }} compact={false} quick={false} onDone={() => setParty(null)} />}</AnimatePresence>
      </div>
    </div>
  )
}
