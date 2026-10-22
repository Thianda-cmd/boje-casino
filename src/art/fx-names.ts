import type { CSSProperties } from 'react'
import { injectCss } from './fx-kit'

/*
  The nine animated name styles (Neon Sign, Frost, Lava, Glitch, Electric, Holo Foil, Gold Rush, Void, Prism), merged
  into NAME_STYLE in src/art/cosmetics.tsx, and the Mythic signature the title plates and rarity tags share.

  A name is one span of text, often cut short with an ellipsis, so every effect lives in that one element: a gradient
  clipped to the letters and moved (background-position), text shadows, and for two of them the ::before and ::after
  boxes (the glitch's torn colour slices, which copy the name from its data-text attribute, and the Prism's sparkles).
  Most move only every so often (a glint every few seconds, a glitch in short bursts on steps()), so a page of names
  repaints rarely; the neon flicker is opacity alone.

  Readability comes first: every style keeps a dark drop shadow under its letters (like the older styles), the light
  styles are light enough to read on the darkest banner and the shadow carries them on the brightest, and Void, the
  dark one, keeps a lit rim on every letter and only lets its shadow band pass through.

  The Mythic signature (bjx-prism-bg, bjx-prism-text, bjx-spark) is a slowly shifting rainbow and a twinkle: the
  Mythic title plate wears it (TitleChip), and the rarity tag can too.
*/

const SHADOW = 'drop-shadow(0 1px 1.5px rgba(0,0,0,.85)) drop-shadow(0 0 6px rgba(0,0,0,.35))'
const CLIP = '-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent'
const glow = (c: string, r = 6) => `filter:${SHADOW} drop-shadow(0 0 ${r}px ${c})`
const SPARK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M5 0Q5.7 4.3 10 5Q5.7 5.7 5 10Q4.3 5.7 0 5Q4.3 4.3 5 0Z' fill='white'/%3E%3C/svg%3E") center/contain no-repeat`
const RAINBOW = '#ff5f9e,#ffa45c 14%,#ffe66b 28%,#72ff9a 42%,#5fdcff 56%,#8f7bff 70%,#ff6bf0 84%,#ff5f9e'
const GLITCH_SHADOW = (r: string, c: string) => `text-shadow:${r} rgba(255,42,109,.9),${c} rgba(24,224,255,.9),0 1px 2px rgba(0,0,0,.9)`

injectCss(
  'bjx-names',
  `.bjx-n-neon{color:#fff0fb;text-shadow:0 0 1px #fff,0 0 4px #ff6ad5,0 0 9px #ff2fc0,0 0 18px rgba(255,47,192,.55),0 1px 2px rgba(0,0,0,.9);animation:bjx-n-buzz 5.2s linear infinite}
@keyframes bjx-n-buzz{0%,58%,61.6%,88%,90.4%,100%{opacity:1}58.6%{opacity:.32}59.2%{opacity:.95}60%{opacity:.4}60.8%{opacity:1}88.8%{opacity:.6}}
.bjx-n-frost{background-image:linear-gradient(100deg,transparent 42%,rgba(255,255,255,.95) 50%,transparent 58%),linear-gradient(180deg,#ffffff 0%,#e2f9ff 35%,#93ddff 70%,#55b8f2 100%);background-size:300% 100%,100% 100%;background-repeat:no-repeat;${CLIP};${glow('rgba(120,220,255,.45)', 5)};animation:bjx-n-glint 4.2s ease-in-out infinite}
@keyframes bjx-n-glint{0%{background-position:0% 0,0 0}50%,100%{background-position:100% 0,0 0}}
.bjx-n-lava{background-image:radial-gradient(circle at 30% 45%,rgba(140,24,0,.4) 0 11%,transparent 28%),linear-gradient(100deg,#ffd04a,#ff8a1f 18%,#ff4a14 34%,#ff7a1a 50%,#ffe36b 62%,#ff8a1f 74%,#ff5418 88%,#ffd04a);background-size:2.6em 1.3em,200% 100%;${CLIP};${glow('rgba(255,90,20,.6)', 7)};animation:bjx-n-lava 5s linear infinite}
@keyframes bjx-n-lava{from{background-position:0 0,0% 0}to{background-position:-2.6em 0,-200% 0}}
.bjx-n-glitch{position:relative;color:#f2fbff;${GLITCH_SHADOW('-1px 0', '1px 0')};animation:bjx-n-split 3.3s steps(1,end) infinite}
@keyframes bjx-n-split{0%,18.5%,54%,82%,100%{${GLITCH_SHADOW('-1px 0', '1px 0')}}17%{${GLITCH_SHADOW('-2.6px .5px', '2.2px -.5px')}}52%{${GLITCH_SHADOW('1.6px 0', '-1.6px 0')}}80.5%{${GLITCH_SHADOW('-3.6px 0', '3px 0')}}}
.bjx-n-glitch::before,.bjx-n-glitch::after{content:attr(data-text);position:absolute;left:0;top:0;width:100%;overflow:hidden;white-space:nowrap;text-overflow:clip;pointer-events:none;text-shadow:none}
.bjx-n-glitch::before{color:#ff6b9a;clip-path:inset(0 0 100% 0);animation:bjx-n-sliceA 3.3s steps(1,end) infinite}
.bjx-n-glitch::after{color:#7ff3ff;clip-path:inset(100% 0 0 0);animation:bjx-n-sliceB 3.3s steps(1,end) infinite}
@keyframes bjx-n-sliceA{0%,18.5%,82.5%,100%{clip-path:inset(0 0 100% 0);transform:none}17%{clip-path:inset(16% 0 54% 0);transform:translateX(-4px)}80.5%{clip-path:inset(58% 0 14% 0);transform:translateX(5px)}}
@keyframes bjx-n-sliceB{0%,19%,54%,100%{clip-path:inset(100% 0 0 0);transform:none}17.6%{clip-path:inset(62% 0 10% 0);transform:translateX(3px)}52%{clip-path:inset(30% 0 46% 0);transform:translateX(-5px)}}
.bjx-n-electric{background-image:repeating-linear-gradient(112deg,transparent 0 .52em,rgba(255,255,255,.95) .55em .6em,transparent .64em 1.15em),linear-gradient(180deg,#f0fcff 0%,#86e8ff 45%,#3aa8ff 100%);background-size:3.1em 100%,100% 100%;${CLIP};${glow('rgba(80,200,255,.6)', 5)};animation:bjx-n-zap 1.7s steps(1,end) infinite}
@keyframes bjx-n-zap{0%{background-position:0 0,0 0}14%{background-position:.9em 0,0 0;${glow('rgba(140,230,255,.95)', 8)}}20%{background-position:1.6em 0,0 0;${glow('rgba(80,200,255,.6)', 5)}}47%{background-position:2.2em 0,0 0}53%{background-position:.4em 0,0 0;${glow('rgba(170,240,255,1)', 9)}}57%{background-position:1.3em 0,0 0;${glow('rgba(80,200,255,.6)', 5)}}80%{background-position:2.6em 0,0 0}}
.bjx-n-holo{background-image:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.92) 50%,transparent 58%),linear-gradient(90deg,#ffc2ec,#fff3b0,#b8ffe0,#a8e6ff,#d9c2ff,#ffc2ec);background-size:300% 100%,200% 100%;background-repeat:no-repeat,repeat;${CLIP};${glow('rgba(210,180,255,.45)', 5)};animation:bjx-n-holo 4s linear infinite}
@keyframes bjx-n-holo{0%{background-position:0% 0,0% 0}50%{background-position:100% 0,-100% 0}100%{background-position:100% 0,-200% 0}}
.bjx-n-goldrush{background-image:linear-gradient(105deg,transparent 44%,#fff 50%,transparent 56%),linear-gradient(115deg,#d9a032,#ffd75e 14%,#fff7d0 22%,#ffd75e 30%,#e2a42a 46%,#ffe08a 60%,#f2b940 72%,#c98a14 86%,#d9a032);background-size:300% 100%,200% 100%;background-repeat:no-repeat,repeat;${CLIP};${glow('rgba(247,197,72,.55)', 6)};animation:bjx-n-gold 3.6s linear infinite}
@keyframes bjx-n-gold{0%{background-position:0% 0,0% 0}40%{background-position:100% 0,-80% 0}100%{background-position:100% 0,-200% 0}}
.bjx-n-void{background-image:linear-gradient(90deg,#e2d2ff,#a77bff 22%,#3a1173 40%,#0d0220 50%,#3a1173 60%,#a77bff 78%,#e2d2ff);background-size:250% 100%;-webkit-text-stroke:.5px rgba(214,184,255,.65);${CLIP};animation:bjx-n-void 5.5s ease-in-out infinite alternate}
@keyframes bjx-n-void{0%{background-position:0% 0;${glow('rgba(139,61,255,.45)', 3)}}50%{${glow('rgba(170,100,255,.9)', 9)}}100%{background-position:100% 0;${glow('rgba(139,61,255,.45)', 3)}}}
.bjx-n-prism{position:relative;background-image:linear-gradient(100deg,${RAINBOW});background-size:200% 100%;${CLIP};${glow('rgba(255,120,230,.45)', 6)};animation:bjx-n-prism 3s linear infinite}
@keyframes bjx-n-prism{to{background-position:-200% 0}}
.bjx-n-prism::before,.bjx-n-prism::after{content:'';position:absolute;width:.6em;height:.6em;background:${SPARK};pointer-events:none;animation:bjx-spark 2.4s ease-in-out infinite}
.bjx-n-prism::before{left:.02em;top:0}
.bjx-n-prism::after{right:.06em;bottom:.04em;width:.48em;height:.48em;animation-delay:-1.2s}
@keyframes bjx-spark{0%,100%{opacity:0;transform:scale(.2) rotate(0)}40%{opacity:1;transform:scale(1) rotate(45deg)}70%{opacity:0;transform:scale(.35) rotate(90deg)}}
.bjx-spark{background:${SPARK};animation:bjx-spark 2.4s ease-in-out infinite}
@keyframes bjx-prism-pan{to{background-position:-200% 0}}
.bjx-prism-bg{background-image:linear-gradient(100deg,#c2187a,#7a1fd1 14%,#3a2be0 28%,#1279d6 42%,#0e9f7a 56%,#cf870c 70%,#d4402c 84%,#c2187a)!important;background-size:200% 100%!important;animation:bjx-prism-pan 6s linear infinite}
.bjx-prism-text{background-image:linear-gradient(100deg,${RAINBOW});background-size:200% 100%;${CLIP};animation:bjx-prism-pan 3s linear infinite}
@keyframes bjx-t-turn{to{transform:rotate(360deg)}}
.bjx-t-turn{animation:bjx-t-turn 6s linear infinite}
@keyframes bjx-t-glow{0%,100%{box-shadow:inset 0 0 0 1px rgba(255,250,220,.6),0 0 14px -4px rgba(247,197,72,.8)}50%{box-shadow:inset 0 0 0 1px rgba(255,250,220,.85),0 0 20px -3px rgba(255,214,102,1)}}
.bjx-t-legend{animation:bjx-t-glow 3s ease-in-out infinite}`,
)

/** the new name styles, by id (merged into NAME_STYLE: all of the look is in the class) */
export const NAME_FX: Record<string, { style: CSSProperties; cls?: string }> = {
  'name:neon': { style: {}, cls: 'bjx-n-neon' },
  'name:frost': { style: {}, cls: 'bjx-n-frost' },
  'name:lava': { style: {}, cls: 'bjx-n-lava' },
  'name:glitch': { style: {}, cls: 'bjx-n-glitch' },
  'name:electric': { style: {}, cls: 'bjx-n-electric' },
  'name:holo': { style: {}, cls: 'bjx-n-holo' },
  'name:goldrush': { style: {}, cls: 'bjx-n-goldrush' },
  'name:void': { style: {}, cls: 'bjx-n-void' },
  'name:prism': { style: {}, cls: 'bjx-n-prism' },
}

/** the Mythic signature, for anything that shows a Mythic: an animated rainbow background, rainbow text, a twinkle */
export const MYTHIC = { bg: 'bjx-prism-bg', text: 'bjx-prism-text', spark: 'bjx-spark' } as const
