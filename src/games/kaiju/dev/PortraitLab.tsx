import type { KaijuId } from '../types'
import { KaijuPortrait, type Mood } from '../portraits'
import { KaijuCover, KaijuIcon } from '../cover'

/*
  The portrait lab (#/dev/portrait, dev server only): every kaiju's portrait in every mood, plain and on its tile, at
  the sizes the page uses, mirrored for the B corner, next to the lobby cover at tile size and the nav icon.
  tools/kaiju-models.mjs screenshots it too.
*/

const IDS: KaijuId[] = ['rexor', 'gorrath', 'titan', 'kraka', 'lumina', 'pincer', 'bedrock', 'voltra']
const MOODS: Mood[] = ['calm', 'fierce', 'hurt', 'ko', 'win']

export default function PortraitLab() {
  return (
    <div className="flex flex-col gap-6 p-4" data-lab="portrait">
      <h1 className="text-[22px] font-black text-ink">Kaiju portraits</h1>
      <div className="overflow-x-auto rounded-2xl bg-panel p-4" data-shot="moods">
        <div className="grid w-max grid-cols-[90px_repeat(5,108px)_repeat(5,108px)] items-center gap-2">
          <div />
          {MOODS.map((m) => (
            <div key={m} className="text-center text-[12px] font-bold text-muted">{m}</div>
          ))}
          {MOODS.map((m) => (
            <div key={m + 'bg'} className="text-center text-[12px] font-bold text-muted">{m} · tile</div>
          ))}
          {IDS.map((id) => (
            <div key={id} className="contents">
              <div className="text-[13px] font-extrabold capitalize text-ink">{id}</div>
              {MOODS.map((m) => (
                <div key={m} className="grid place-items-center rounded-xl bg-panel2 p-1">
                  <KaijuPortrait id={id} size={96} mood={m} />
                </div>
              ))}
              {MOODS.map((m) => (
                <div key={m} className="grid place-items-center p-1">
                  <KaijuPortrait id={id} size={96} mood={m} bg mirror />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-6 rounded-2xl bg-panel p-4" data-shot="sizes">
        {[24, 32, 40, 56].map((s) => (
          <div key={s} className="flex flex-col gap-2">
            <div className="text-[12px] font-bold text-muted">{s}px</div>
            <div className="flex gap-1.5">
              {IDS.map((id) => (
                <KaijuPortrait key={id} id={id} size={s} bg />
              ))}
            </div>
            <div className="flex gap-1.5">
              {IDS.map((id) => (
                <KaijuPortrait key={id} id={id} size={s} />
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 rounded-xl bg-panel2 p-3">
          <KaijuPortrait id="rexor" size={120} mood="fierce" bg />
          <span className="text-[28px] font-black italic text-gold">VS</span>
          <KaijuPortrait id="gorrath" size={120} mood="fierce" bg mirror />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-6 rounded-2xl bg-panel p-4" data-shot="cover">
        {[[200, 250], [160, 200], [128, 160]].map(([w, h]) => (
          <div key={w} className="relative overflow-hidden rounded-2xl" style={{ width: w, height: h }}>
            <KaijuCover />
          </div>
        ))}
        <div className="flex items-center gap-4 rounded-xl bg-panel2 p-4 text-ink">
          {[16, 20, 24, 32].map((s) => (
            <KaijuIcon key={s} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          <span className="text-[14px] font-bold">Kaiju Clash</span>
        </div>
      </div>
    </div>
  )
}
