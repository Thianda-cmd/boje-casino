import { useState, type ReactNode } from 'react'
import { CosmeticPreview, FramedAvatar, NameTag, ProfileBanner, TitleChip } from '../../art/cosmetics'
import { Backdrop } from '../../art/backdrops'
import { CrateArt } from '../account/Crates'
import { CRATES, cosmeticsOf } from '../../store/cosmetics'
import { useRoute } from '../../lib/router'

/*
  #/dev/scenes: every banner and backdrop, and the crates, for building and screenshots (tools/scenes-sheet.mjs).
  Each banner is shown live at full width, then cropped the way the pages crop it (a wide profile header, a phone
  header, the narrow card, the hover card) and as the shop's tiles; each backdrop full size with a profile card over
  it (to judge how readable the page stays) and as a tile. ?only=<id> shows one; ?kind=banner|backdrop|crate one kind;
  ?still=1 draws everything still.
*/

const params = (route: string) => new URLSearchParams(route.split('?')[1] ?? '')

function Row({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[15px] font-black tracking-tight">{title}</h2>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </section>
  )
}
const Label = ({ children }: { children: ReactNode }) => <div className="mt-1 text-[10.5px] font-bold text-dim">{children}</div>

function BannerSet({ id, still }: { id: string; still: boolean }) {
  const c = cosmeticsOf('banner').find((b) => b.id === id)
  return (
    <Row title={`${c?.name ?? id} · ${id}`}>
      <div data-shot={id}>
        <ProfileBanner id={id} still={still} className="h-[240px] w-[800px] rounded-xl" />
        <Label>800 × 240, live</Label>
      </div>
      <div>
        <ProfileBanner id={id} still={still} className="h-[188px] w-[1000px] max-w-full rounded-xl">
          <div className="absolute bottom-3 left-6 flex items-end gap-3">
            <FramedAvatar avatar={7} frame="frame:gold" size={96} />
            <div className="pb-2">
              <NameTag name="LuckyLuna" color="name:gold" className="text-[28px]" />
              <div>
                <TitleChip id="title:legend" />
              </div>
            </div>
          </div>
        </ProfileBanner>
        <Label>profile header, wide (avatar over the corner)</Label>
      </div>
      <div>
        <ProfileBanner id={id} still={still} className="h-[124px] w-[360px] rounded-xl" />
        <Label>phone header</Label>
      </div>
      <div>
        <ProfileBanner id={id} still className="h-[84px] w-[300px] rounded-xl">
          <div className="absolute bottom-2 left-3">
            <NameTag name="AceHigh" color="name:default" className="text-[17px]" />
          </div>
        </ProfileBanner>
        <Label>hover card (still)</Label>
      </div>
      <div>
        <CosmeticPreview id={id} size={104} />
        <Label>shop tile</Label>
      </div>
      <div>
        <CosmeticPreview id={id} size={170} />
        <Label>featured</Label>
      </div>
    </Row>
  )
}

function BackdropSet({ id, still }: { id: string; still: boolean }) {
  const c = cosmeticsOf('backdrop').find((b) => b.id === id)
  return (
    <Row title={`${c?.name ?? id} · ${id}`}>
      <div data-shot={id} className="relative h-[420px] w-[760px] overflow-hidden rounded-xl">
        <Backdrop id={id} still={still} className="absolute inset-0" />
        <div className="absolute inset-x-12 top-8 overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">
          <ProfileBanner id="banner:galaxy" still className="h-[90px]" />
          <div className="flex items-end gap-3 px-4 pb-4">
            <div className="-mt-10">
              <FramedAvatar avatar={3} frame="frame:neon" size={80} />
            </div>
            <div className="pb-1">
              <NameTag name="NeonNate" color="name:ice" className="text-[22px]" />
              <div className="text-[12px] text-muted">Here for the 180s and the big multipliers.</div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-6 left-12 right-12 grid grid-cols-3 gap-3">
          {['Rounds', 'Wagered', 'Best win'].map((k) => (
            <div key={k} className="rounded-xl bg-panel px-3 py-2.5">
              <div className="text-[11px] font-bold text-dim">{k}</div>
              <div className="text-[18px] font-black">12,345</div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative h-[300px] w-[170px] overflow-hidden rounded-xl">
        <Backdrop id={id} still={still} className="absolute inset-0" />
        <Label>phone</Label>
      </div>
      <div>
        <CosmeticPreview id={id} size={72} />
        <Label>72</Label>
      </div>
      <div>
        <CosmeticPreview id={id} size={96} />
        <Label>96</Label>
      </div>
      <div>
        <CosmeticPreview id={id} size={160} />
        <Label>160</Label>
      </div>
      <div>
        <CosmeticPreview id={id} size={36} />
        <Label>36 still</Label>
      </div>
    </Row>
  )
}

export default function ScenesLab() {
  const q = params(useRoute())
  const only = q.get('only')
  const kind = q.get('kind')
  const [still, setStill] = useState(q.get('still') === '1')
  const banners = cosmeticsOf('banner').map((c) => c.id)
  const backdrops = cosmeticsOf('backdrop').map((c) => c.id)
  const show = (k: string, id: string) => (only ? only === id : !kind || kind === k)
  return (
    <div className="p-4 sm:p-6" data-lab="scenes">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-[22px] font-black">Scenes</h1>
        <button onClick={() => setStill(!still)} className="h-8 rounded-full bg-raised px-3 text-[12.5px] font-bold">
          {still ? 'Still' : 'Live'}
        </button>
        <span className="text-[12px] text-dim">?only=id · ?kind=banner|backdrop|crate · ?still=1</span>
      </div>
      {banners.filter((id) => show('banner', id)).map((id) => (
        <BannerSet key={id} id={id} still={still} />
      ))}
      {backdrops.filter((id) => show('backdrop', id)).map((id) => (
        <BackdropSet key={id} id={id} still={still} />
      ))}
      {(only ? only.startsWith('crate') : !kind || kind === 'crate') && (
        <Row title="Crates">
          {CRATES.filter((c) => !only || only === c.id).map((c) => (
            <div key={c.id} data-shot={c.id} className="flex flex-col items-center gap-2 rounded-xl bg-panel p-4">
              <CrateArt id={c.id} size={200} />
              <div className="flex gap-3">
                <CrateArt id={c.id} size={96} still />
                <CrateArt id={c.id} size={56} still />
              </div>
              <Label>{c.name}</Label>
            </div>
          ))}
        </Row>
      )}
    </div>
  )
}
