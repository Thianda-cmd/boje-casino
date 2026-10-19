/*
  The Coin Vault's door, as the floor shows it from the front: a gold door with its wheel in a dark frame of bolts.
  Alone (the HUD, the cards) or in a ring that fills as the vault does (the vault card, and the Rewards page's card,
  which takes this file and nothing else of the game's).
*/

const INK = '#25183a'

/** the Coin Vault's round door (the floor's vault from the front), optionally turning its wheel */
export function VaultDoorIcon({ size = 48, spin = false }: { size?: number; spin?: boolean }) {
  const bolts = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2
    return [24 + Math.cos(a) * 18.4, 24 + Math.sin(a) * 18.4]
  })
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <g stroke={INK} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round">
        <circle cx="24" cy="24" r="21.5" fill="#3d3a6e" />
        {bolts.map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r="1.5" fill="#ffd36b" strokeWidth="1" />
        ))}
        <circle cx="24" cy="24" r="15.5" fill="#ffd36b" />
        <circle cx="24" cy="24" r="10.5" fill="none" stroke="#c9952b" strokeWidth="2" />
        <g style={spin ? { transformOrigin: '24px 24px', animation: 'ty-spin 1.6s cubic-bezier(.3,.7,.3,1)' } : undefined}>
          <path d="M24 13.5v21M14.9 18.75l18.2 10.5M14.9 29.25l18.2-10.5" strokeWidth="2.6" />
          <circle cx="24" cy="24" r="3.6" fill="#fff3c8" />
        </g>
        <path d="M13 15.5c1.5-2 3.4-3.4 5.6-4.2" stroke="#fff6cf" strokeWidth="1.8" fill="none" opacity=".9" />
      </g>
    </svg>
  )
}

/** the door in a ring that fills as the vault does (`spin` turns its wheel each time it changes) */
export function VaultRing({ fill, size, spin }: { fill: number; size: number; spin: number }) {
  const r = 46
  const c = 2 * Math.PI * r
  const full = fill >= 1
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {full && <div className="ty-motion absolute -inset-2 rounded-full bg-[radial-gradient(closest-side,rgba(255,207,74,.55),transparent)]" style={{ animation: 'ty-glow 1.6s ease-in-out infinite' }} />}
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(0,0,0,.4)" strokeWidth="7" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={full ? '#ffe08a' : '#f7c548'} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, fill))} style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.22,1,.36,1)' }} />
      </svg>
      <div className="absolute inset-[13%]">
        <VaultDoorIcon key={spin} size={Math.round(size * 0.74)} spin={spin > 0} />
      </div>
    </div>
  )
}
