import { memo } from 'react'
import { ItemArt } from './art'
import { CRATES, RARITY, multLabel, type Rarity, type Tile } from './rules'

/* The loot card every reel shows (Cases and Case Battles): a rarity-lit plate with the item and its multiplier. */

export const RARITY_TEXT: Record<Rarity, string> = { common: '#c3cfdb', uncommon: '#eafff3', rare: '#d6e8ff', epic: '#ecdfff', legendary: '#ffe7a8' }

export const TileFace = memo(function TileFace({ tile, w, h }: { tile: Tile; w: number; h: number }) {
  const it = CRATES[tile.tier].items[tile.item]
  const r = RARITY[it.rarity]
  return (
    <>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          borderRadius: Math.round(w * 0.11),
          background: 'linear-gradient(180deg,#182b3a 0%,#101e2a 100%)',
          boxShadow: `inset 0 0 0 1px ${r.color}40, inset 0 1px 0 rgba(255,255,255,.07), 0 8px 16px -10px rgba(0,0,0,.8)`,
        }}
      >
        <div className="absolute inset-0" style={{ background: `radial-gradient(62% 48% at 50% 40%, ${r.glow}, transparent 72%)` }} />
        <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: `linear-gradient(0deg, ${r.color}33, transparent)` }} />
        <div className="absolute inset-x-[22%] bottom-0 rounded-t-full" style={{ height: Math.max(2, Math.round(w * 0.025)), background: r.color }} />
      </div>
      <div className="absolute inset-x-0 flex justify-center" style={{ top: h * 0.1 }}>
        <ItemArt kind={it.kind} size={Math.round(Math.min(w * 0.6, h * 0.56))} />
      </div>
      <div
        className="tnum absolute inset-x-0 text-center font-extrabold leading-none"
        style={{ bottom: h * 0.1, fontSize: Math.max(10, Math.round(Math.min(w * 0.13, h * 0.12))), color: RARITY_TEXT[it.rarity], textShadow: '0 1px 2px rgba(0,0,0,.6)' }}
      >
        {multLabel(it.mult)}
      </div>
    </>
  )
})
