import { useEffect, useState, type ReactNode } from 'react'
import { CosmeticPreview, FramedAvatar, NameTag, ProfileBanner, RARITY, TitleChip } from '../../art/cosmetics'
import { Aura } from '../../art/auras'
import { useRoute } from '../../lib/router'
import { cosmeticsOf, type Cosmetic } from '../../store/cosmetics'

/*
  The cosmetics lab (#/dev/cosmetics, dev server only): the animated frames, auras, name styles and title plates at
  every size they are shown at, for building them and for screenshots (tools/cosmetics-sheet.mjs).

  ?s= picks a section: frames (each new frame at 28/40/64/96/160, then with an aura at 64/96/160), all-frames (all
  twenty-six side by side), auras (each at 64 and 128, framed and bare), names (every style on a run of banners), titles
  (every plate), previews (shop and wardrobe tiles), profile (the header as a player page shows it), and list (fifty
  rows of 40 px avatars with names and titles, with a frame-rate meter). &still=1 pauses every animation in place,
  which is what reduced motion shows.
*/

const NEW_FRAMES = ['frost', 'glitch', 'plasma', 'orbit', 'runes', 'kaiju', 'inferno', 'storm', 'liquidgold', 'serpent', 'blackhole', 'prism'].map((k) => `frame:${k}`)
const AURAS = cosmeticsOf('aura').filter((c) => c.id !== 'aura:none')
const NEW_NAMES = ['neon', 'frost', 'lava', 'glitch', 'electric', 'holo', 'goldrush', 'void', 'prism'].map((k) => `name:${k}`)
const SECTIONS = ['frames', 'zoom', 'zoom-auras', 'all-frames', 'auras', 'names', 'titles', 'previews', 'profile', 'list'] as const
type Section = (typeof SECTIONS)[number]
const name = (id: string) => cosmeticsOf(id.split(':')[0] === 'name' ? 'nameColor' : (id.split(':')[0] as Cosmetic['kind'])).find((c) => c.id === id)?.name ?? id

function Tag({ c }: { c?: Cosmetic }) {
  if (!c) return null
  const r = RARITY[c.rarity]
  return (
    <span className="rounded-full px-2 py-[2px] text-[10px] font-black uppercase tracking-[.08em]" style={{ color: r.light, background: `${r.color}24`, boxShadow: `inset 0 0 0 1px ${r.color}40` }}>
      {r.name}
    </span>
  )
}

function Row({ title, c, children }: { title: string; c?: Cosmetic; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-panel p-4 ring-1 ring-white/[.06]">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-extrabold text-ink">
        {title} <Tag c={c} />
      </div>
      <div className="flex flex-wrap items-end gap-x-9 gap-y-6">{children}</div>
    </div>
  )
}

const Cell = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col items-center gap-2">
    {children}
    <span className="text-[10.5px] font-bold text-dim">{label}</span>
  </div>
)

function Fps() {
  const [text, setText] = useState('measuring…')
  useEffect(() => {
    let raf = 0
    let n = 0
    let start = performance.now()
    let last = start
    let worst = 0
    const tick = (now: number) => {
      worst = Math.max(worst, now - last)
      last = now
      n++
      if (now - start > 1000) {
        setText(`${Math.round((1000 * n) / (now - start))} fps · worst frame ${worst.toFixed(1)} ms`)
        n = 0
        start = now
        worst = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <span className="tnum rounded-lg bg-stage px-3 py-1.5 text-[12px] font-bold text-accent">{text}</span>
}

const frameOf = (id: string) => cosmeticsOf('frame').find((c) => c.id === id)

function body(s: Section) {
  switch (s) {
    case 'frames':
      return NEW_FRAMES.map((f, i) => {
        const aura = AURAS[i % AURAS.length].id
        return (
          <Row key={f} title={name(f)} c={frameOf(f)}>
            {[28, 40, 64, 96, 160].map((px) => (
              <Cell key={px} label={`${px}`}>
                <FramedAvatar avatar={(i * 5 + 16) % 32} frame={f} size={px} />
              </Cell>
            ))}
            {[64, 96, 160].map((px) => (
              <Cell key={`a${px}`} label={`${px} + ${name(aura)}`}>
                <span className="inline-block" style={{ padding: px * 0.25 }}>
                  <FramedAvatar avatar={(i * 5 + 16) % 32} frame={f} size={px} aura={aura} />
                </span>
              </Cell>
            ))}
          </Row>
        )
      })
    case 'zoom':
      return (
        <div className="grid grid-cols-4 gap-4">
          {NEW_FRAMES.map((f, i) => (
            <div key={f} className="flex flex-col items-center gap-2 rounded-2xl bg-panel py-10 ring-1 ring-white/[.06]">
              <FramedAvatar avatar={(i * 5 + 16) % 32} frame={f} size={200} />
              <span className="mt-4 text-[13px] font-extrabold">{name(f)}</span>
            </div>
          ))}
        </div>
      )
    case 'zoom-auras':
      return (
        <div className="grid grid-cols-4 gap-4">
          {AURAS.map((a, i) => (
            <div key={a.id} className="flex flex-col items-center gap-2 rounded-2xl bg-panel py-14 ring-1 ring-white/[.06]">
              <FramedAvatar avatar={(i * 7 + 3) % 32} frame={['frame:gold', 'frame:neon', 'frame:diamond', 'frame:bronze'][i % 4]} size={170} aura={a.id} />
              <span className="mt-12 text-[13px] font-extrabold">{a.name}</span>
            </div>
          ))}
        </div>
      )
    case 'all-frames':
      return (
        <Row title="Every frame at 96 and 40">
          {cosmeticsOf('frame').map((f, i) => (
            <Cell key={f.id} label={f.name}>
              <FramedAvatar avatar={(i * 3 + 2) % 32} frame={f.id} size={96} />
              <FramedAvatar avatar={(i * 3 + 2) % 32} frame={f.id} size={40} />
            </Cell>
          ))}
        </Row>
      )
    case 'auras':
      return AURAS.map((a, i) => (
        <Row key={a.id} title={a.name} c={a}>
          {[64, 128].map((px) => (
            <Cell key={px} label={`${px} framed`}>
              <span className="inline-block" style={{ padding: px * 0.25 }}>
                <FramedAvatar avatar={(i * 7 + 3) % 32} frame={['frame:gold', 'frame:neon', 'frame:diamond', 'frame:bronze'][i % 4]} size={px} aura={a.id} />
              </span>
            </Cell>
          ))}
          <Cell label="96 bare">
            <span className="inline-block" style={{ padding: 24 }}>
              <FramedAvatar avatar={(i * 7 + 3) % 32} frame="frame:none" size={96} aura={a.id} />
            </span>
          </Cell>
          <Cell label="Aura alone 64">
            <span className="inline-block rounded-xl bg-stage" style={{ padding: 16 }}>
              <Aura id={a.id} size={64} />
            </span>
          </Cell>
        </Row>
      ))
    case 'names': {
      const banners = cosmeticsOf('banner')
      const names = [...NEW_NAMES, ...cosmeticsOf('nameColor').map((c) => c.id).filter((id) => !NEW_NAMES.includes(id))]
      return names.map((n, k) => (
        <Row key={n} title={name(n)} c={cosmeticsOf('nameColor').find((c) => c.id === n)}>
          <div className="flex flex-wrap gap-2">
            {banners.slice(k % 4, (k % 4) + 9).map((b) => (
              <ProfileBanner key={b.id} id={b.id} still className="rounded-lg">
                <div className="flex h-[52px] w-[200px] items-center justify-center px-2">
                  <NameTag name="LuckyLuna77" color={n} className="block truncate text-[19px] leading-tight" />
                </div>
              </ProfileBanner>
            ))}
            <div className="flex h-[52px] w-[130px] items-center rounded-lg bg-panel2 px-3">
              <NameTag name="A long player name here" color={n} className="block truncate text-[14px] leading-tight" />
            </div>
            <div className="flex h-[52px] w-[150px] items-center justify-center rounded-lg bg-[#f4f0e6] px-3">
              <NameTag name="On light" color={n} className="block truncate text-[17px] leading-tight" />
            </div>
          </div>
        </Row>
      ))
    }
    case 'titles':
      return (
        <>
          <Row title="Every title plate">
            {cosmeticsOf('title').map((t) => (
              <TitleChip key={t.id} id={t.id} />
            ))}
          </Row>
          <Row title="Legendary and Mythic, close up">
            {cosmeticsOf('title')
              .filter((t) => t.rarity === 'legendary' || t.rarity === 'mythic')
              .map((t) => (
                <span key={t.id} className="inline-block origin-left" style={{ transform: 'scale(2.4)', marginRight: 150, marginBottom: 20 }}>
                  <TitleChip id={t.id} />
                </span>
              ))}
          </Row>
          <Row title="Plates in a truncated row (as PlayerChip uses them)">
            {cosmeticsOf('title')
              .filter((t) => t.rarity === 'mythic' || t.rarity === 'legendary')
              .map((t) => (
                <span key={t.id} className="flex w-[90px] min-w-0">
                  <TitleChip id={t.id} className="truncate" />
                </span>
              ))}
          </Row>
        </>
      )
    case 'previews': {
      const items = [...NEW_FRAMES, ...AURAS.map((a) => a.id), ...NEW_NAMES, 'title:immortal', 'title:cosmic', 'title:glitched']
      return [160, 96, 72, 46].map((px) => (
        <Row key={px} title={`CosmeticPreview at ${px}`}>
          {items.map((id) => (
            <div key={id} className="rounded-2xl bg-panel2 p-2">
              <CosmeticPreview id={id} size={px} avatar={21} frame="frame:gold" />
            </div>
          ))}
        </Row>
      ))
    }
    case 'profile':
      return [
        ['banner:galaxy', 'frame:blackhole', 'aura:prism', 'name:prism', 'title:immortal'],
        ['banner:neon', 'frame:glitch', 'aura:lightning', 'name:glitch', 'title:glitched'],
        ['banner:aurora', 'frame:serpent', 'aura:shadow', 'name:void', 'title:cosmic'],
        ['banner:jackpot', 'frame:liquidgold', 'aura:coins', 'name:goldrush', 'title:tycoon'],
        ['banner:default', 'frame:kaiju', 'aura:atomic', 'name:electric', 'title:kaiju-king'],
        ['banner:sunset', 'frame:inferno', 'aura:embers', 'name:lava', 'title:menace'],
      ].map(([b, f, a, n, t], i) => (
        <div key={i} className="overflow-hidden rounded-2xl bg-panel ring-1 ring-white/[.07]">
          <ProfileBanner id={b} className="h-[150px]" />
          <div className="relative flex flex-wrap items-end gap-x-10 gap-y-2 px-8 pb-8 sm:px-14">
            <div className="-mt-[70px]">
              <FramedAvatar avatar={(i * 9 + 21) % 32} frame={f} size={140} aura={a} className="drop-shadow-[0_14px_26px_rgba(0,0,0,.6)]" />
            </div>
            <div className="min-w-0 pb-2">
              <NameTag name={['Nebula', 'gl1tch_k1d', 'Ouroboros', 'MidasTouch', 'RexorFan', 'HotStreak'][i]} color={n} className="block truncate text-[33px] font-black leading-tight tracking-tight" />
              <div className="mt-1.5">
                <TitleChip id={t} className="text-[12px]" />
              </div>
            </div>
          </div>
        </div>
      ))
    case 'list': {
      const frames = cosmeticsOf('frame').map((c) => c.id)
      const names = cosmeticsOf('nameColor').map((c) => c.id)
      const titles = cosmeticsOf('title').map((c) => c.id)
      return (
        <div className="rounded-2xl bg-panel p-3 ring-1 ring-white/[.06]">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[13px] font-extrabold">Fifty rows at 40 px</span>
            <Fps />
          </div>
          <div className="grid grid-cols-2 gap-1">
            {Array.from({ length: 50 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-1.5 odd:bg-panel2/60">
                <span className="tnum w-6 text-right text-[12px] font-bold text-dim">{i + 1}</span>
                <FramedAvatar avatar={i % 32} frame={frames[(i * 7) % frames.length]} size={40} />
                <span className="min-w-0">
                  <NameTag name={`Player ${i + 1}`} color={names[i % names.length]} className="block truncate text-[14.5px] leading-tight" />
                  <span className="mt-1 flex min-w-0">
                    <TitleChip id={titles[(i * 5) % titles.length]} className="truncate" />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    }
  }
}

export default function CosmeticsLab() {
  const route = useRoute()
  const q = new URLSearchParams(route.split('?')[1] ?? '')
  const s = (SECTIONS as readonly string[]).includes(q.get('s') ?? '') ? (q.get('s') as Section) : 'frames'
  const still = q.get('still') === '1'
  const link = (to: Section, hold: boolean) => `#/dev/cosmetics?s=${to}${hold ? '&still=1' : ''}`
  return (
    <div className="mx-auto max-w-[1500px] p-6" data-lab="cosmetics" {...(still ? { 'data-bjx-off': '' } : {})}>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="mr-3 text-[22px] font-black">Cosmetics lab</h1>
        {SECTIONS.map((k) => (
          <a key={k} href={link(k, still)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-extrabold ${k === s ? 'bg-accent text-[#06210f]' : 'bg-panel2 text-muted hover:text-ink'}`}>
            {k}
          </a>
        ))}
        <a href={link(s, !still)} className="ml-2 rounded-full bg-panel2 px-3 py-1.5 text-[12.5px] font-extrabold text-muted hover:text-ink">
          {still ? 'Animate' : 'Hold still'}
        </a>
      </div>
      <div className="flex flex-col gap-4" data-section={s}>
        {body(s)}
      </div>
    </div>
  )
}
