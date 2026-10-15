import { shade, sprite, texture, type Palette } from '../../lib/pixel'

/* ------------------------------------------------------------------ */
/*  Chicken (16×16, facing right)                                      */
/* ------------------------------------------------------------------ */

const CHICKEN_PAL: Palette = {
  W: '#fbfbf6',
  w: '#dde2e9',
  g: '#b3bcc8',
  R: '#ea3348',
  r: '#ad1f30',
  O: '#ffa62b',
  o: '#d07a12',
  K: '#141414',
}
const OUTLINE = '#1a1f29'

const CHICKEN_IDLE = [
  '................',
  '..........RR....',
  '.........RRRR...',
  '.........WWWW...',
  '........WWWWWW..',
  '........WWWKWWOO',
  '........WWWWWWoo',
  '...W....WWWWWR..',
  '..WW...WWWWWWr..',
  '..WWWWWWWWWWW...',
  '..WWWWWWwwWWW...',
  '..wWWWWwggwWW...',
  '...wWWWWwwWWw...',
  '....wwwwwwww....',
  '......O..O......',
  '.....OO.OO......',
]
const CHICKEN_BLINK = CHICKEN_IDLE.map((r, i) => (i === 5 ? '........WWWgWWOO' : r))
const CHICKEN_HOP = CHICKEN_IDLE.map((r, i) =>
  i === 9 ? '..WWWWWWggWWW...' : i === 10 ? '..WWWWWgwwWWW...' : i === 14 ? '.....OO.OO......' : i === 15 ? '................' : r,
)

const COOKED = [
  '................',
  '................',
  '......bbbbb.....',
  '....bbBBBBBbb...',
  '...bBBLLBBBBBb..',
  '..bBBLLLBBBBBBb.',
  '..bBBLLBBBBBBBb.',
  '..bBBBBBBBBBBBb.',
  '..bBBBBBBBBBBBb.',
  '...bBBBBBBBBBb..',
  '....bbBBBBBbbWW.',
  '......bbbbb.WWWW',
  '............WWW.',
  '................',
]
const COOKED_PAL: Palette = { b: '#6b3a14', B: '#c27a32', L: '#eab06a', W: '#f1e6cf' }

export const chicken = {
  idle: () => sprite('chk-idle', CHICKEN_IDLE, CHICKEN_PAL, OUTLINE),
  blink: () => sprite('chk-blink', CHICKEN_BLINK, CHICKEN_PAL, OUTLINE),
  hop: () => sprite('chk-hop', CHICKEN_HOP, CHICKEN_PAL, OUTLINE),
  cooked: () => sprite('chk-cooked', COOKED, COOKED_PAL, OUTLINE),
}

/* ------------------------------------------------------------------ */
/*  Vehicles (top-down, driving downward: lights at the bottom)        */
/* ------------------------------------------------------------------ */

const SEDAN = [
  '..kkkkkkkkkk..',
  '.kCCCCCCCCCCk.',
  '.kCtCCCCCCtCk.',
  'nkCCCCCCCCCCkn',
  'nkCDDDDDDDDCkn',
  'nkCDDDDDDDDCkn',
  '.kCCCCCCCCCCk.',
  '.kCLLLLLLLLCk.',
  '.kCLLLLLLLLCk.',
  '.kCLLLLLLLLCk.',
  '.kCLLLLLLLLCk.',
  '.kCLLLLLLLLCk.',
  '.kCCCCCCCCCCk.',
  '.kCDDDDDDDDCk.',
  '.kCDdDDDDDDCk.',
  '.kCDDDDDDDDCk.',
  'nkCCCCCCCCCCkn',
  'nkCCCCCCCCCCkn',
  'nkCCCCCCCCCCkn',
  '.kCCCCCCCCCCk.',
  '.kChhCCCChhCk.',
  '.kkCCCCCCCCkk.',
  '..kkkkkkkkkk..',
]

const TAXI = SEDAN.map((r, i) => (i === 6 || i === 12 ? '.kQqQqQqQqQqk.' : i === 9 ? '.kCLLSSSSLLCk.' : r))
const POLICE = SEDAN.map((r, i) => (i === 9 ? '.kCbbbbrrrrCk.' : i === 8 || i === 10 ? '.kCLLLLLLLLCk.' : i === 3 || i === 17 ? 'nkKKKKKKKKKKkn' : r))

const TRUCK = [
  'kkkkkkkkkkkkkk',
  'ktXXXXXXXXXXtk',
  'kXXXXXXXXXXXXk',
  'kxxxxxxxxxxxxk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kxxxxxxxxxxxxk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kxxxxxxxxxxxxk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kxxxxxxxxxxxxk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kxxxxxxxxxxxxk',
  'kXXXXXXXXXXXXk',
  'kXXXXXXXXXXXXk',
  'kkkkkkkkkkkkkk',
  'nnn..kkkk..nnn',
  '.kkkkkkkkkkkk.',
  '.kCCCCCCCCCCk.',
  'nkCLLLLLLLLCkn',
  'nkCLLLLLLLLCkn',
  '.kCCCCCCCCCCk.',
  '.kCDDDDDDDDCk.',
  '.kCDdDDDDDDCk.',
  '.kCDDDDDDDDCk.',
  'nkCCCCCCCCCCkn',
  'nkCCCCCCCCCCkn',
  '.kChhCCCChhCk.',
  '..kkkkkkkkkk..',
]

function carPal(c: string): Palette {
  return {
    k: shade(c, -0.6),
    C: c,
    L: shade(c, 0.2),
    D: '#1b2836',
    d: '#6d8ca8',
    t: '#ff3b3b',
    h: '#fff3b0',
    n: '#0e1116',
    Q: '#151515',
    q: '#f4f4f4',
    S: '#222831',
    b: '#2f6bff',
    r: '#ff3046',
    K: '#151a22',
    X: '#dfe5ec',
    x: '#a9b5c3',
  }
}

export type VehicleKind = 'sedan' | 'taxi' | 'police' | 'truck'
export const CAR_COLORS = ['#4cb4ff', '#ff6b5c', '#9b7bff', '#22d36f', '#ff8fc7', '#e8eff6', '#ff9f43']

export function vehicle(kind: VehicleKind, color: string) {
  switch (kind) {
    case 'taxi':
      return sprite('taxi', TAXI, carPal('#f7c548'))
    case 'police':
      return sprite('police', POLICE, carPal('#eef2f7'))
    case 'truck':
      return sprite(`truck-${color}`, TRUCK, carPal(color))
    default:
      return sprite(`sedan-${color}`, SEDAN, carPal(color))
  }
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

const MANHOLE = [
  '.....kkkkkk.....',
  '...kkMMMMMMkk...',
  '..kMMMMMMMMMMk..',
  '.kMMmMMmMMmMMMk.',
  '.kMMMMMMMMMMMMk.',
  'kMMmMMmMMmMMmMMk',
  'kMMMMMMMMMMMMMMk',
  'kMmMMmMMmMMmMMMk',
  'kMMMMMMMMMMMMMMk',
  'kMMmMMmMMmMMmMMk',
  'kMMMMMMMMMMMMMMk',
  '.kMMmMMmMMmMMMk.',
  '.kMMMMMMMMMMMMk.',
  '..kMMMMMMMMMMk..',
  '...kkMMMMMMkk...',
  '.....kkkkkk.....',
]
export type ManholeState = 'idle' | 'current' | 'passed' | 'dead'
const MANHOLE_PAL: Record<ManholeState, Palette> = {
  idle: { M: '#46525f', m: '#2c343e', k: '#171c23' },
  current: { M: '#d9a93a', m: '#9c7316', k: '#4a3608' },
  passed: { M: '#2f9e5f', m: '#1d6b3e', k: '#0d331f' },
  dead: { M: '#a8323f', m: '#6d1a24', k: '#33090f' },
}
export const manhole = (s: ManholeState) => sprite(`manhole-${s}`, MANHOLE, MANHOLE_PAL[s])

const BARRIER = [
  'kkkkkkkkkkkkkkkkkk',
  'kYYYKKKYYYKKKYYYYk',
  'kYYKKKYYYKKKYYYKKk',
  'kkkkkkkkkkkkkkkkkk',
  '..kPk........kPk..',
  '..kPk........kPk..',
  '..kkk........kkk..',
]
export const barrier = () => sprite('barrier', BARRIER, { k: '#121212', Y: '#f7c548', K: '#262626', P: '#9aa7b4' })

const COIN = ['..kkkk..', '.kGGGGk.', 'kGgGGGGk', 'kGgGGyGk', 'kGgGGyGk', 'kGGGGyGk', '.kGyyGk.', '..kkkk..']
export const coin = () => sprite('coin', COIN, { k: '#7a5208', G: '#f7c548', g: '#fff1a8', y: '#c9901c' })

const EGG = [
  '....kkkk....',
  '...kGGGGk...',
  '..kGgGGGGk..',
  '..kGgGGGGk..',
  '.kGgGGGGGGk.',
  '.kGgGGGGGGk.',
  'kGGgGGGGGGGk',
  'kGGGGGGGGGGk',
  'kGGGGGGGGyGk',
  'kGGGGGGGGyGk',
  '.kGGGGGGyGk.',
  '.kyGGGGGyyk.',
  '..kyyyyyyk..',
  '...kkkkkk...',
]
export const goldenEgg = () => sprite('egg', EGG, { k: '#6b4706', G: '#f7c548', g: '#fff4b8', y: '#c9901c' })

const BUSH = [
  '....gggg......',
  '..ggGGGGgg....',
  '.gGGGlGGGGg...',
  'gGGlGGGGlGGgg.',
  'gGGGGGGGGGGGGg',
  'gGlGGGGGlGGGGg',
  '.gGGGGGGGGGGg.',
  '..ggggggggggg.',
]
export const bush = () => sprite('bush', BUSH, { g: '#1d5e34', G: '#2f9150', l: '#5fd17f' }, '#0f2e1a')

const FLOWER = ['.r.', 'rYr', '.r.', '.g.', 'gg.']
export const flower = (c: string) => sprite(`flower-${c}`, FLOWER, { r: c, Y: '#ffe36b', g: '#2f9150' })

const LAMP = [
  'kkkkkk',
  'kYYYYk',
  'kkkkkk',
  '..kk..',
  '..kk..',
  '..kk..',
  '..kk..',
  '..kk..',
  '..kk..',
  '..kk..',
  '..kk..',
  '.kkkk.',
  'kkkkkk',
]
export const lamp = () => sprite('lamp', LAMP, { k: '#3b4552', Y: '#fff1a8' })

/* ------------------------------------------------------------------ */
/*  Tiling textures                                                    */
/* ------------------------------------------------------------------ */

export const asphalt = () =>
  texture('asphalt', 32, 32, (ctx, rnd) => {
    ctx.fillStyle = '#2a3039'
    ctx.fillRect(0, 0, 32, 32)
    const tones = ['#262b33', '#2f363f', '#333a44', '#242930']
    for (let i = 0; i < 380; i++) {
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)]
      ctx.fillRect(Math.floor(rnd() * 32), Math.floor(rnd() * 32), 1, 1)
    }
  })

export const stoneBricks = () =>
  texture('stone', 16, 16, (ctx, rnd) => {
    ctx.fillStyle = '#5b6570'
    ctx.fillRect(0, 0, 16, 16)
    const tones = ['#535d68', '#646e79', '#6b7581', '#56606a']
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)]
      ctx.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1)
    }
    ctx.fillStyle = '#3d454e'
    // mortar: rows of 4px bricks, offset every other row
    for (const y of [3, 7, 11, 15]) ctx.fillRect(0, y, 16, 1)
    for (const [y, xs] of [
      [0, [7, 15]],
      [4, [3, 11]],
      [8, [7, 15]],
      [12, [3, 11]],
    ] as [number, number[]][])
      for (const x of xs) ctx.fillRect(x, y, 1, 3)
    ctx.fillStyle = 'rgba(255,255,255,.08)'
    for (const y of [0, 4, 8, 12]) ctx.fillRect(0, y, 16, 1)
  })

export const grass = () =>
  texture('grass', 16, 16, (ctx, rnd) => {
    ctx.fillStyle = '#3b8a45'
    ctx.fillRect(0, 0, 16, 16)
    const tones = ['#347c3e', '#45994f', '#4fa85a', '#2f7238']
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)]
      ctx.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1)
    }
  })

export const curb = () =>
  texture('curb', 4, 16, (ctx, rnd) => {
    ctx.fillStyle = '#8a95a1'
    ctx.fillRect(0, 0, 4, 16)
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = rnd() > 0.5 ? '#7b8692' : '#98a3ae'
      ctx.fillRect(Math.floor(rnd() * 4), Math.floor(rnd() * 16), 1, 1)
    }
    ctx.fillStyle = '#5f6a75'
    ctx.fillRect(0, 15, 4, 1)
    ctx.fillRect(3, 0, 1, 16)
  })
