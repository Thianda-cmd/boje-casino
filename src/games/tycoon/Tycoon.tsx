import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BojeLoader } from '../../components/Loader'
import { Coin } from '../../components/icons'
import { isMuted, sfx } from '../../lib/sound'
import { rand } from '../../lib/rng'
import { flushStorage, safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import {
  ATTRACTIONS,
  CHIP_EVERY,
  MILESTONES,
  N_ATTR,
  UPGRADES,
  WHALE_EVERY,
  autoRate,
  chipCoins,
  cityIndex,
  coinRate,
  costOf,
  cyclePay,
  cycleTime,
  fmtCash,
  managerCost,
  milestonesDue,
  rateOf,
  starsOnSale,
  vaultAt,
  vaultCap,
} from './engine'
import { Casino, type AwayReport, type Moment, type Snapshot, type Sold } from './casino'
import type { FloorView, TycoonScene } from './scene'
import { AttractionIcon, ManagerFace, StarIcon } from './art'
import { VaultDoorIcon } from './door'
import { FlyLayer, TycoonStyles, flyCoins, riseText, useLater, useStable } from './kit'
import { Banner, BoostChip, CashCard, Pops, RepChip, WhaleChip, popCash, type BannerData, type BannerTone } from './Hud'
import { VaultCard } from './Vault'
import { Panel, type Badges, type TabId } from './Panel'
import { BUY_MODES, FloorTab, type BuyMode, type Layout } from './FloorTab'
import { ManagersTab } from './ManagersTab'
import { UpgradesTab } from './UpgradesTab'
import { StarsTab } from './StarsTab'
import { MilestonesTab } from './MilestonesTab'
import { AwayCard } from './AwayCard'
import { HowItWorks } from './HowItWorks'
import { SellConfirm, SoldCard } from './Sale'
import { MANAGERS, coinWord } from './words'

/*
  Casino Tycoon: an idle game that earns real coins. The player builds a casino floor (the toon diorama in
  scene.ts, loaded lazily with three.js) out of ten attractions, hires managers to run them, buys upgrades, sells
  the casino for Stars and moves up through five cities. The game itself is the engine (engine.ts, pure); the save
  and every payment go through the Casino (casino.ts); this page joins them to the floor and the panel.

  The page runs like this:
    - one tab at a time plays for a player (a Web Lock): a second one waits, says so, and takes over (reading the
      stored wallet afresh) once the first lets go. The casino opens, and the floor is built, once the player's
      wallet has loaded and the lock is held; opening catches up on the time away and greets the player with what
      it brought (AwayCard), and one button there takes the vault and the milestones waiting;
    - a ticker brings the save up to now a few times a second and hands the floor its view (setState). The page
      itself draws at most four times a second from it, and only when something it shows changed (an action draws
      at once): the rows and tabs are memoised on what they show, so a draw costs little. The save is written after
      every action and as the page goes; between, only when something the clock can't work out changed (casino.ts);
    - the floor reports taps: a plot selects its row in the panel (and runs it, without a manager), the vault
      collects. Its pay moments pop the Cash they paid over the attraction, softly sounded. A Run held down (or a
      phone row's icon) runs round after round;
    - an active player (pressed or typed in the last few minutes, the page in view) is now and then offered a whale
      (a tip within 20 s of his arrival: ×5 Cash for 45 s; the HUD's chip counts down and shows him) and a golden
      chip (a few real coins). Without WebGL they appear over the floor's stand-in instead, and the rest of the game
      plays in the panel as usual.
  Around them: the HUD (Hud.tsx), the Coin Vault (Vault.tsx), the panel (Panel.tsx and its five tabs), the cards
  for coming back, how it works and selling, and the sounds (sfx.tycoon, with a quiet ambience bed).

  Three layouts: wide (the floor, and the vault over the panel beside it), tablet (the floor over the panel, its
  rows two to a line) and phone (the floor over the panel's compact rows, the vault a pill over the floor).

  Dev only: window.__tycoon = { save, setSave(fn), skip(ms), cash(n), whale(), chip(), fillVault(), away(ms),
  casino, scene }: skip moves the clock on (the managers earn, the vault fills), away(ms) reopens the casino as if
  the player had been gone that long (the card greets them).
*/

/** the engine's clock ticks this often (ms) */
const TICK_MS = 150
/** the page draws from the ticker at most this often (ms); an action draws at once */
const DRAW_MS = 250
/** and the save is offered to the wallet this often while the page is open (it writes only what is worth it) (ms) */
const SAVE_MS = 10_000
/** a player counts as active this long after a press or a key (ms): whales and chips come only to them */
const ACTIVE_MS = 3 * 60_000
/** the whale waits this long to be tipped once at his spot, a golden chip to be caught (ms) */
const WHALE_STAY = 20_000
const CHIP_STAY = 12_000
/** at most one Cash pop over the floor this often (ms): a busy floor's pops are a steady sparkle, not a cloud */
const POP_MS = 320
const BUY_KEY = 'lumen.tycoon.buy'
const BANNER_MS = 2400
const lockName = (uid: string | null) => `lumen.tycoon.${uid ?? 'guest'}`
const between = ([a, b]: readonly [number, number]) => a + rand() * (b - a)

const storedMode = (): BuyMode => {
  const raw = safeStorage.getItem(BUY_KEY)
  return BUY_MODES.find((m) => String(m) === raw) ?? 1
}

/** a media query's answer, kept up to date */
function useMedia(q: string) {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const f = () => setOn(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [q])
  return on
}

export default function Tycoon() {
  const authStatus = useAuth((s) => s.status)
  const authOpen = useAuth((s) => s.view != null)
  const uid = useAuth((s) => s.uid)
  const wide = useMedia('(min-width: 1024px)')
  const tablet = useMedia('(min-width: 640px)')
  const layout: Layout = wide ? 'wide' : tablet ? 'tablet' : 'phone'
  const [, refresh] = useReducer((n: number) => n + 1, 0)

  // whether this tab holds the player's casino (the lock), whether another tab has it, and the casino once open
  const [held, setHeld] = useState(false)
  const [elsewhere, setElsewhere] = useState(false)
  const [gen, setGen] = useState(0)
  const [casino, setCasino] = useState<Casino | null>(null)
  const [away, setAway] = useState<AwayReport | null>(null)

  // the floor
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<TycoonScene | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState(0.04)

  // the panel and what is over it
  const [tab, setTab] = useState<TabId>('floor')
  const [mode, setMode] = useState<BuyMode>(storedMode)
  const [selected, setSelected] = useState(-1)
  const [reveal, setReveal] = useState(0)
  const [runs, setRuns] = useState<number[]>(() => new Array(N_ATTR).fill(0))
  const [how, setHow] = useState(false)
  const [selling, setSelling] = useState(false)
  const [sold, setSold] = useState<Sold | null>(null)
  const [banner, setBanner] = useState<BannerData | null>(null)
  // the whale is on the floor waiting for a tip; without the 3D floor, he and a golden chip are offered as buttons
  const [whaleOut, setWhaleOut] = useState(false)
  const [flatWhale, setFlatWhale] = useState(0)
  const [flatChip, setFlatChip] = useState<{ until: number; x: number; y: number } | null>(null)

  const later = useLater()
  const seq = useRef(0)
  const queue = useRef<(BannerData & { rank: number })[]>([])
  const showing = useRef<{ rank: number; until: number }>({ rank: 0, until: 0 })
  const lastPop = useRef({ at: 0, per: new Array<number>(N_ATTR).fill(0) })
  const lastTap = useRef({ x: innerWidth / 2, y: innerHeight / 2 })
  const bed = useRef<ReturnType<typeof sfx.tycoon.ambience>>(null)
  /** the Run buttons held down: their rounds start again as they end */
  const holds = useRef(new Set<number>())
  /** when the page last drew from the ticker, and what it showed then (see draw) */
  const drawn = useRef({ at: 0, hard: '', soft: '' })
  const modal = away != null || how || selling || sold != null || authOpen
  const live = useRef({ casino, modal, floor: ready || failed })
  live.current = { casino, modal, floor: ready || failed }

  /* ---------------- the floor's view ---------------- */

  const push = useCallback(() => {
    const sc = sceneRef.current
    const c = live.current.casino
    if (!sc || !c) return
    const s = c.save
    const now = Date.now()
    const boosted = s.boostUntil > now && s.boostMult > 1
    const view: FloorView = {
      owned: s.owned,
      progress: s.progress,
      cycle: s.owned.map((_, i) => cycleTime(s, i)),
      running: s.running,
      managers: s.managers,
      afford: s.owned.map((n, i) => n === 0 && costOf(s, i, 1) <= s.cash),
      city: cityIndex(s.stars),
      income: autoRate(s) * (boosted ? s.boostMult : 1),
      boost: boosted,
      vault: Math.min(1, vaultAt(s, now) / vaultCap(s)),
    }
    sc.setState(view)
  }, [])

  /**
   * Draws the page from the ticker when what it shows has changed: at once for a change in what stands on the floor
   * (a round ending, a milestone reached), at most every DRAW_MS for the numbers that run (Cash, the vault, timers).
   */
  const draw = () => {
    const c = live.current.casino
    if (!c) return
    const s = c.save
    const now = Date.now()
    const hard = `${s.owned.join()}|${s.running.map(Number).join('')}|${s.managers.map(Number).join('')}|${s.upgrades.length}|${s.milestones.length}|${milestonesDue(s).length}|${s.stars}|${s.sales}`
    const soft = `${s.cash}|${Math.floor(vaultAt(s, now) * 100)}|${Math.ceil((s.boostUntil - now) / 1000)}|${Math.ceil((sceneRef.current?.whaleLeft() ?? 0) / 1000)}`
    const d = drawn.current
    const t = performance.now()
    if (hard === d.hard && (soft === d.soft || t - d.at < DRAW_MS)) return
    drawn.current = { at: t, hard, soft }
    refresh()
  }

  /* ---------------- banners ---------------- */

  const say = (tone: BannerTone, icon: ReactNode, title: string, sub: string | undefined, rank: number) => {
    const b = { key: ++seq.current, tone, icon, title, sub, rank }
    const now = performance.now()
    // a bigger moment cuts in; anything else waits its turn (a few at most)
    if (showing.current.until <= now || rank > showing.current.rank) show(b)
    else {
      queue.current = [...queue.current, b].sort((x, y) => y.rank - x.rank).slice(0, 3)
    }
  }
  const show = (b: BannerData & { rank: number }) => {
    showing.current = { rank: b.rank, until: performance.now() + BANNER_MS }
    setBanner(b)
    later(() => {
      setBanner((x) => (x?.key === b.key ? null : x))
      const next = queue.current.shift()
      if (next) later(() => show(next), 120)
    }, BANNER_MS)
  }

  const moment = (m: Moment) => {
    const c = live.current.casino
    if (!c) return
    switch (m.kind) {
      case 'open':
        sfx.tycoon.open()
        say('gold', <AttractionIcon i={m.i} size={34} />, 'Grand opening!', ATTRACTIONS[m.i].name, 3)
        sceneRef.current?.focus(m.i, false)
        break
      case 'step':
        sfx.tycoon.step()
        say('green', <AttractionIcon i={m.i} size={34} />, `${ATTRACTIONS[m.i].name} ×${m.at}!`, m.n > 1 ? `${m.n} steps at once: ${2 ** m.n}× better` : m.at <= 100 ? 'Twice as fast' : 'Pays double', 2)
        break
      case 'all':
        sfx.tycoon.step()
        say('gold', <StarIcon size={30} />, `Every attraction at ${m.at}!`, 'All pay doubled', 3)
        break
      case 'hire':
        sfx.tycoon.hire()
        say('sky', <ManagerFace i={m.i} size={36} />, `${MANAGERS[m.i].name} is hired!`, `The ${ATTRACTIONS[m.i].name} runs on its own`, 2)
        break
      case 'upgrade': {
        const u = UPGRADES.find((x) => x.id === m.id)
        sfx.tycoon.upgrade()
        if (u) say('violet', u.target >= 0 ? <AttractionIcon i={u.target} size={34} /> : <StarIcon size={30} />, u.name.split(':')[0], `${u.target >= 0 ? ATTRACTIONS[u.target].name : 'The whole floor'} pays ×2`, 1)
        break
      }
      case 'reached': {
        const ms = m.ids.map((id) => MILESTONES.find((x) => x.id === id)!)
        const coins = ms.reduce((a, x) => a + x.coins, 0)
        sfx.tycoon.reached()
        say('gold', <Coin size={28} />, ms.length > 1 ? `${ms.length} milestones reached!` : `Milestone: ${ms[0].name}`, `Claim ${coins.toLocaleString('en-US')} coins in Milestones`, 2)
        break
      }
    }
  }

  /* ---------------- what the floor reports ---------------- */

  const pick = (i: number) => {
    const c = live.current.casino
    if (!c || live.current.modal) return
    setSelected(i)
    setReveal((r) => r + 1)
    setTab('floor')
    sceneRef.current?.select(i)
    if (c.save.owned[i] > 0 && !c.save.managers[i]) run(i)
  }

  /** an attraction paid on the floor: its Cash pops over it (a few a second at most), with a soft coin */
  const paidOnFloor = (i: number) => {
    const c = live.current.casino
    const sc = sceneRef.current
    if (!c || !sc) return
    const now = performance.now()
    const lp = lastPop.current
    const since = (now - (lp.per[i] || now - 1100)) / 1000
    lp.per[i] = now
    sfx.tycoon.cycle(i)
    if (now - lp.at < POP_MS) return
    lp.at = now
    const s = c.save
    const boosted = s.boostUntil > Date.now() && s.boostMult > 1
    const T = cycleTime(s, i)
    // a fast attraction pays many rounds between pops: show what it made since the last one
    const amount = (T >= 1 || !s.managers[i] ? cyclePay(s, i) : rateOf(s, i) * Math.min(3, since)) * (boosted ? s.boostMult : 1)
    const p = sc.project(i, { x: 0, y: 0 })
    popCash(p.x, p.y, fmtCash(amount), boosted)
  }

  /* ---------------- actions ---------------- */

  const run = (i: number) => {
    const c = live.current.casino
    if (!c || !c.tap(i)) return
    sfx.tycoon.run()
    setRuns((r) => r.map((n, k) => (k === i ? n + 1 : n)))
    push()
    refresh()
  }

  const buyIt = (i: number, k: number, at: DOMRect) => {
    const c = casino
    if (!c) return
    const opening = c.save.owned[i] === 0
    if (!c.buy(i, k)) return
    if (!opening) sfx.tycoon.buy(k)
    riseText(at.left + at.width / 2, at.top, `+${k.toLocaleString('en-US')}`, '#5fe39a')
    setSelected(i)
    sceneRef.current?.select(i)
    push()
    refresh()
  }

  const hireIt = (i: number) => {
    if (casino?.hire(i)) {
      holds.current.delete(i)
      push()
      refresh()
    }
  }

  const upgradeIt = (id: string) => {
    if (casino?.upgrade(id)) {
      push()
      refresh()
    }
  }

  /** coins paid: they fly from (x, y) to the balance, with a "+n" and the sound */
  const paidOut = (paid: number, x: number, y: number, n: number) => {
    sfx.tycoon.collect(paid)
    flyCoins(x, y, n)
    riseText(x, y - 18, `+${coinWord(Math.round(paid * 100) / 100)}`, '#f7c548')
  }

  const collect = (x: number, y: number) => {
    const c = live.current.casino
    if (!c) return
    const paid = c.collectVault()
    if (!paid) return
    paidOut(paid, x, y, 6 + Math.round(Math.sqrt(paid)))
    push()
    refresh()
  }
  /** the away card's button: the vault, then every milestone waiting */
  const takeAll = (x: number, y: number) => {
    const c = live.current.casino
    setAway(null)
    if (!c) return
    const paid = c.collectVault() + c.claimAll()
    if (!paid) return
    paidOut(paid, x, y, 8 + Math.round(Math.sqrt(paid)))
    push()
    refresh()
  }
  const vaultFull = () => {
    sfx.tycoon.reached()
    say('gold', <VaultDoorIcon size={34} />, 'Your Coin Vault is full!', 'Collect it to keep it filling', 2)
  }

  const claim = (id: string, x: number, y: number) => {
    const paid = casino?.claim(id) ?? 0
    if (!paid) return
    sfx.tycoon.claim(paid)
    flyCoins(x, y, 5 + Math.round(Math.sqrt(paid) / 2))
    riseText(x, y - 18, `+${coinWord(paid)}`, '#f7c548')
    refresh()
  }
  const claimAll = (x: number, y: number) => {
    const paid = casino?.claimAll() ?? 0
    if (!paid) return
    sfx.tycoon.claim(paid)
    flyCoins(x, y, 14)
    riseText(x, y - 18, `+${coinWord(paid)}`, '#f7c548')
    refresh()
  }

  const sellIt = () => {
    const c = casino
    setSelling(false)
    const r = c?.sell()
    if (!r) return
    holds.current.clear()
    sfx.tycoon.sale()
    if (r.city > r.wasCity) later(() => sfx.tycoon.city(), 1500)
    // the milestones paid on the way out come to the balance as the card opens
    if (r.coins > 0)
      later(() => {
        sfx.tycoon.claim(r.coins)
        flyCoins(innerWidth / 2, innerHeight / 2, 12)
      }, 700)
    setSold(r)
    setTab('floor')
    setSelected(-1)
    sceneRef.current?.select(-1)
    // the new casino starts at its front, where its first machines go
    sceneRef.current?.front()
    push()
    refresh()
  }

  const select = (i: number) => {
    setSelected(i)
    sceneRef.current?.select(i)
    sceneRef.current?.focus(i, false)
  }

  /** a Run held down (or let go): while it is held its rounds start again as they end (the ticker sees to it) */
  const hold = (i: number, on: boolean) => {
    if (on) holds.current.add(i)
    else holds.current.delete(i)
  }

  // the panel's handlers keep one identity, so its memoised rows and tabs draw only when what they show changes
  const h = {
    buy: useStable(buyIt),
    run: useStable(run),
    hold: useStable(hold),
    hire: useStable(hireIt),
    select: useStable(select),
    upgrade: useStable(upgradeIt),
    claim: useStable(claim),
    claimAll: useStable(claimAll),
    collect: useStable(collect),
    sell: useStable(() => setSelling(true)),
    stars: useStable(() => setTab('stars')),
  }

  /* ---------------- the whale and the golden chip ---------------- */

  const tipped = () => {
    const c = live.current.casino
    if (!c?.tipWhale()) return
    sfx.tycoon.tip()
    say('gold', <TopHat />, 'Big tipper!', `×${c.save.boostMult} Cash for ${Math.round((c.save.boostUntil - Date.now()) / 1000)} seconds`, 4)
    push()
    refresh()
  }
  const caught = (x: number, y: number) => {
    const c = live.current.casino
    if (!c) return
    const paid = c.catchChip(chipCoins(rand))
    sfx.tycoon.catch()
    if (paid) {
      flyCoins(x, y, 8)
      riseText(x, y - 20, `+${coinWord(paid)}`, '#f7c548')
      say('gold', <Coin size={30} />, 'Golden chip!', `+${coinWord(paid)} coins`, 3)
    }
    refresh()
  }
  const offerWhale = () => {
    const sc = sceneRef.current
    const ok = sc
      ? sc.spawnWhale({
          stay: WHALE_STAY,
          onTip: () => {
            setWhaleOut(false)
            tipped()
          },
          onMiss: () => setWhaleOut(false),
        })
      : true
    if (!ok) return
    if (sc) setWhaleOut(true)
    else {
      setFlatWhale(Date.now() + WHALE_STAY)
      later(() => setFlatWhale((u) => (u && u <= Date.now() ? 0 : u)), WHALE_STAY + 50)
    }
    sfx.tycoon.whale()
    say('gold', <TopHat />, 'A whale walked in!', `Tap him for ×5 Cash: he waits ${WHALE_STAY / 1000}s`, 3)
  }
  const offerChip = () => {
    const sc = sceneRef.current
    if (sc) {
      if (!sc.spawnChip({ stay: CHIP_STAY, onCatch: () => caught(lastTap.current.x, lastTap.current.y) })) return
    } else {
      setFlatChip({ until: Date.now() + CHIP_STAY, x: 0.2 + rand() * 0.6, y: 0.35 + rand() * 0.4 })
      later(() => setFlatChip((f) => (f && f.until <= Date.now() ? null : f)), CHIP_STAY + 50)
    }
    sfx.tycoon.chip()
    say('gold', <Coin size={30} />, 'A golden chip!', 'Tap it on the floor for a few coins', 2)
  }

  // what the floor, the ticker and the offers call: always this render's handlers
  const on = useRef({ pick, paidOnFloor, moment, run, draw, vault: () => {}, vaultFull, offerWhale, offerChip })
  on.current = { pick, paidOnFloor, moment, run, draw, vault: () => collect(lastTap.current.x, lastTap.current.y), vaultFull, offerWhale, offerChip }

  /* ---------------- one tab per player, and the casino ---------------- */

  // One tab at a time plays a player's casino: two would each save over the other's. The page holds the player's
  // lock while it is open (a tab that closes or dies lets go) and opens the casino only once it has it; a second tab
  // waits, says so, and picks the casino up as soon as the first lets go.
  useEffect(() => {
    if (authStatus === 'loading') return
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks) {
      setHeld(true)
      return () => setHeld(false)
    }
    const quit = new AbortController()
    let gone = false
    let release = () => {}
    // a moment's wait is this page starting over (its old lock on its way out); any longer, another tab has it
    const slow = window.setTimeout(() => setElsewhere(true), 1500)
    locks
      .request(lockName(uid), { signal: quit.signal }, async () => {
        if (gone) return
        // the tab that had it saved as it went: read the wallet afresh, so this one carries on from there
        await useWallet.persist.rehydrate()
        if (gone) return
        return new Promise<void>((done) => {
          release = done
          clearTimeout(slow)
          setElsewhere(false)
          setHeld(true)
        })
      })
      .catch(() => {
        // given up because the page went first; or locks refused here (a page with no origin): play without one
        if (gone) return
        clearTimeout(slow)
        setHeld(true)
      })
    return () => {
      gone = true
      clearTimeout(slow)
      quit.abort()
      // the casino's last save is on its way to storage before another tab can take over
      live.current.casino?.close()
      flushStorage()
      release()
      setHeld(false)
    }
  }, [authStatus, uid])

  // with the lock: open the casino (catching up on the time away)
  useEffect(() => {
    if (!held) return
    const c = new Casino()
    setCasino(c)
    setAway(c.away)
    // (a page opened by a press may sound; one reloaded may not yet, and the browser would only complain)
    if (c.away && navigator.userActivation?.hasBeenActive !== false) sfx.tycoon.welcome()
    return () => {
      c.close()
      setCasino(null)
    }
  }, [held, gen])

  /* ---------------- the floor ---------------- */

  // The floor is built once this tab holds the casino: a tab waiting for another to let go draws nothing behind its
  // notice (a full floor is a lot of frames for a page no one plays).
  useEffect(() => {
    if (!held) return
    let alive = true
    const host = hostRef.current!
    let sc: TycoonScene | null = null
    let ro: ResizeObserver | null = null
    const lost = () => {
      // the GPU let go of the floor: the panel plays on alone
      if (!alive) return
      setFailed(true)
      setTimeout(() => {
        if (sceneRef.current === sc) sceneRef.current = null
        sc?.dispose()
        sc = null
      }, 0)
    }
    import('./scene')
      .then(({ TycoonScene }) => {
        if (!alive) return
        if (!TycoonScene.supported()) throw new Error('no WebGL')
        sc = new TycoonScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __tycoonScene?: TycoonScene }).__tycoonScene = sc
        sc.onProgress = (p) => alive && setProgress(0.05 + p * 0.95)
        sc.onPick = (i) => on.current.pick(i)
        sc.onCycle = (i) => on.current.paidOnFloor(i)
        sc.onVault = () => on.current.vault()
        sc.onLost = lost
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc?.resize(r.width, r.height)
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        push()
        return sc.ready.then(() => {
          if (!alive) return
          push()
          setReady(true)
        })
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      ro?.disconnect()
      if (import.meta.env.DEV) {
        const w = window as unknown as { __tycoonScene?: TycoonScene }
        if (w.__tycoonScene === sc) delete w.__tycoonScene
      }
      sc?.dispose()
      sceneRef.current = null
      setReady(false)
    }
  }, [push, held])

  // A press on the floor: where it was (the vault's coins and a chip's fly from there). A press anywhere starts the
  // bed of the casino, inside the gesture (browsers only let audio start in one).
  useEffect(() => {
    const host = hostRef.current!
    const tap = (e: PointerEvent) => {
      lastTap.current = { x: e.clientX, y: e.clientY }
    }
    const wake = () => {
      if (!bed.current && !isMuted()) bed.current = sfx.tycoon.ambience()
    }
    // a Run held down is let go wherever the press ends
    const letGo = () => holds.current.clear()
    host.addEventListener('pointerdown', tap)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('pointerup', letGo)
    window.addEventListener('blur', letGo)
    return () => {
      host.removeEventListener('pointerdown', tap)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('pointerup', letGo)
      window.removeEventListener('blur', letGo)
      bed.current?.stop()
      bed.current = null
    }
  }, [])

  // the scene takes no input under a card or a dialog
  useEffect(() => sceneRef.current?.setInput(!modal), [modal, ready])

  /* ---------------- the clock ---------------- */

  useEffect(() => {
    if (!casino) return
    casino.onMoment = (m) => on.current.moment(m)
    // Out of view counts as away: the clock stops (a tab left open in the background earns what a closed one would,
    // up to the offline limit) and coming back greets the player with what the time brought.
    let left: Snapshot | null = null
    // the vault filling up while the player watches is worth a word (once a fill)
    let full = casino.vault() >= vaultCap(casino.save)
    const tick = () => {
      if (document.visibilityState === 'hidden') return
      const paid = casino.tick()
      // a Run held down starts the next round as soon as one ends
      for (const i of holds.current) if (!casino.save.running[i] && !casino.save.managers[i]) on.current.run(i)
      const nowFull = casino.vault() >= vaultCap(casino.save)
      if (nowFull && !full) on.current.vaultFull()
      full = nowFull
      push()
      // the floor sees most rounds end for itself; this catches the fast ones its progress check misses
      for (const i of paid) sceneRef.current?.cycle(i)
      on.current.draw()
    }
    tick()
    const ticker = window.setInterval(tick, TICK_MS)
    const saver = window.setInterval(() => casino.persist(), SAVE_MS)
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        left = casino.snapshot()
        casino.persist(true)
        holds.current.clear()
        return
      }
      const r = left && casino.since(left)
      left = null
      if (r) {
        setAway(r)
        sfx.tycoon.welcome()
      }
      tick()
    }
    const leave = () => casino.persist(true)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', leave)
    // The wallet brought a save this casino didn't write: the account's copy, played on another device (taken up if
    // newer), or a whole other wallet (the account's conflict path, or another site tab's): its coins came with it,
    // so its save is taken up whatever its age, and the coins and what paid them agree again.
    const unsub = useWallet.subscribe((st, prev) => {
      if (st.tycoon === prev.tycoon || casino.isOwn(st.tycoon)) return
      const replaced = st.balance !== prev.balance || st.rewardLog !== prev.rewardLog
      if (casino.adopt(st.tycoon, replaced)) {
        push()
        refresh()
      }
    })
    return () => {
      clearInterval(ticker)
      clearInterval(saver)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', leave)
      unsub()
      casino.onMoment = undefined
    }
  }, [casino, push])

  // whales and golden chips, now and then, for a player who is here and playing
  useEffect(() => {
    if (!casino) return
    let nextWhale = Date.now() + between(WHALE_EVERY)
    let nextChip = Date.now() + between(CHIP_EVERY)
    let lastInput = Date.now()
    const input = () => {
      lastInput = Date.now()
    }
    const t = window.setInterval(() => {
      const now = Date.now()
      if (document.visibilityState !== 'visible' || now - lastInput > ACTIVE_MS || live.current.modal || !live.current.floor) {
        // they wait for the player: someone coming back gets a little while before the next one
        nextWhale = Math.max(nextWhale, now + 30_000)
        nextChip = Math.max(nextChip, now + 30_000)
        return
      }
      if (now >= nextWhale) {
        on.current.offerWhale()
        nextWhale = now + between(WHALE_EVERY)
      }
      if (now >= nextChip) {
        on.current.offerChip()
        nextChip = now + between(CHIP_EVERY)
      }
    }, 1000)
    window.addEventListener('pointerdown', input)
    window.addEventListener('keydown', input)
    window.addEventListener('wheel', input, { passive: true })
    return () => {
      clearInterval(t)
      window.removeEventListener('pointerdown', input)
      window.removeEventListener('keydown', input)
      window.removeEventListener('wheel', input)
      sceneRef.current?.clearWhale()
      sceneRef.current?.clearChip()
    }
  }, [casino])

  useEffect(() => {
    safeStorage.setItem(BUY_KEY, String(mode))
  }, [mode])

  // dev: every state can be set up and screenshotted
  useEffect(() => {
    if (!import.meta.env.DEV || !casino) return
    const w = window as unknown as { __tycoon?: unknown }
    const after = () => {
      casino.persist(true)
      push()
      refresh()
    }
    const hook = {
      get save() {
        return casino.save
      },
      setSave: (fn: (s: Casino['save']) => Casino['save']) => {
        casino.save = fn(casino.save)
        after()
      },
      skip: (ms: number) => {
        casino.skip(ms)
        after()
      },
      cash: (n: number) => {
        casino.save = { ...casino.save, cash: casino.save.cash + n }
        after()
      },
      whale: () => on.current.offerWhale(),
      chip: () => on.current.offerChip(),
      fillVault: () => {
        const s = casino.save
        casino.save = { ...s, vault: 0, vaultSince: Date.now() - (vaultCap(s) / coinRate(s)) * 3_600_000 - 1000 }
        after()
      },
      away: (ms: number) => {
        casino.leave(ms)
        setGen((g) => g + 1)
      },
      casino,
      get scene() {
        return sceneRef.current
      },
    }
    w.__tycoon = hook
    return () => {
      if (w.__tycoon === hook) delete w.__tycoon
    }
  }, [casino, push])

  /* ---------------- the page ---------------- */

  const s = casino?.save
  const now = Date.now()
  const boostLeft = s && s.boostMult > 1 ? s.boostUntil - now : 0
  const boost = boostLeft > 0 && s ? s.boostMult : 1
  const coins = s ? vaultAt(s, now) : 0
  const badges: Badges = {}
  let dueCoins = 0
  if (s) {
    const hires = s.managers.filter((m, i) => !m && s.owned[i] > 0 && managerCost(s, i) <= s.cash).length
    const ups = UPGRADES.filter((u) => !s.upgrades.includes(u.id) && u.cost <= s.cash).length
    const due = milestonesDue(s)
    dueCoins = due.reduce((a, m) => a + m.coins, 0)
    const add = starsOnSale(s)
    if (hires) badges.managers = { n: hires, tone: 'sky' }
    if (ups) badges.upgrades = { n: ups, tone: 'violet' }
    if (add > 0 && add >= Math.max(1, s.stars)) badges.stars = { n: `+${add >= 1000 ? `${Math.floor(add / 1000)}K` : add}`, tone: 'gold' }
    if (due.length) badges.milestones = { n: due.length, tone: 'gold' }
  }
  const compact = !wide
  const whaleLeft = whaleOut ? (sceneRef.current?.whaleLeft() ?? 0) : 0

  const howButton = (
    <button
      onClick={() => setHow(true)}
      aria-label="How Casino Tycoon works"
      title="How it works"
      className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0b1621]/75 text-white/80 ring-1 ring-white/10 backdrop-blur-sm transition hover:text-white"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
        <path d="M9.2 9.2a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1.1-1.3 2v.7M12 17.6v.1" />
      </svg>
    </button>
  )
  const chips = s && (
    <AnimatePresence>
      {boostLeft > 0 && <BoostChip key="boost" left={boostLeft} mult={s.boostMult} compact={compact} />}
      {whaleOut && <WhaleChip key="whale" left={whaleLeft} compact={compact} onClick={() => sceneRef.current?.focusWhale()} />}
    </AnimatePresence>
  )
  const cashCard = s && <CashCard cash={away ? away.cashBefore : s.cash} income={autoRate(s) * boost} boost={boost} open={s.owned.some((n) => n > 0)} compact={compact} />
  // On a wide floor the HUD stacks down the left (Cash, then Stars and the boost) with How it works on the right. On
  // a smaller one its middle must stay clear: Cash and the vault share the top edge with the whale's and the boost's
  // chips on a row of their own under them, and the Stars and How it works sit on the road along the bottom, where
  // the banners drop in too.
  const hud = s && (
    <>
      {compact ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-1.5 p-2">
            <div className="flex items-start justify-between gap-2">
              {cashCard}
              <VaultCard coins={coins} cap={vaultCap(s)} rate={coinRate(s)} compact onCollect={h.collect} />
            </div>
            <div className="flex items-center gap-1.5">{chips}</div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-2 p-2">
            <RepChip stars={s.stars} city={cityIndex(s.stars)} compact onClick={h.stars} />
            {howButton}
          </div>
        </>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3">
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            {cashCard}
            <div className="flex items-center gap-1.5">
              <RepChip stars={s.stars} city={cityIndex(s.stars)} compact={false} onClick={h.stars} />
              {chips}
            </div>
          </div>
          {howButton}
        </div>
      )}
      <Banner banner={banner} top={compact ? undefined : 136} bottom={compact ? 54 : undefined} />
      <Pops />
      {failed && flatWhale > 0 && (
        <motion.button
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onClick={() => {
            setFlatWhale(0)
            tipped()
          }}
          className="pointer-events-auto absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-2xl bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] px-4 py-3 text-[14px] font-black text-[#3a2400] shadow-[0_14px_30px_-10px_rgba(0,0,0,.7)]"
        >
          <TopHat /> Tip the whale: ×5 Cash
        </motion.button>
      )}
      {failed && flatChip && (
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1, rotate: 360 }}
          transition={{ type: 'spring', stiffness: 200, damping: 14 }}
          onClick={(e) => {
            setFlatChip(null)
            caught(e.clientX, e.clientY)
          }}
          className="pointer-events-auto absolute z-20 -ml-7 -mt-7 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ left: `${flatChip.x * 100}%`, top: `${flatChip.y * 100}%`, background: 'radial-gradient(circle at 35% 30%, #fff6cf, #ffd23f 45%, #c98a12)', boxShadow: '0 0 30px rgba(255,207,74,.8), inset 0 0 0 4px rgba(122,75,0,.5)' }}
          aria-label="Catch the golden chip"
        >
          <StarIcon size={24} />
        </motion.button>
      )}
    </>
  )

  const floor = (
    <section className={`relative overflow-hidden rounded-2xl border border-line bg-[#7ec8f0] ${wide ? 'min-w-0 flex-1' : 'h-[40%] min-h-[240px] shrink-0'}`} style={{ touchAction: 'none' }}>
      <div ref={hostRef} className="absolute inset-0" />
      {failed && <FlatFloor />}
      {hud}
      <AnimatePresence>
        {(!ready || !casino) && !failed && (
          <motion.div key="loading" className="absolute inset-0 z-30 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_35%,#2a3f63_0%,#16233a_55%,#0d1726_100%)]" exit={{ opacity: 0, transition: { duration: 0.45 } }}>
            {elsewhere && !casino ? <Elsewhere /> : <BojeLoader label="Opening your casino" progress={progress} />}
          </motion.div>
        )}
      </AnimatePresence>
      {failed && elsewhere && !casino && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0d1726]/90">
          <Elsewhere />
        </div>
      )}
    </section>
  )

  const body = s && (
    <>
      {tab === 'floor' && (
        <FloorTab
          s={s}
          boost={boost}
          mode={mode}
          onMode={setMode}
          selected={selected}
          reveal={reveal}
          runs={runs}
          layout={layout}
          onBuy={h.buy}
          onRun={h.run}
          onHold={h.hold}
          onHire={h.hire}
          onSelect={h.select}
        />
      )}
      {tab === 'managers' && <ManagersTab s={s} onHire={h.hire} />}
      {tab === 'upgrades' && <UpgradesTab s={s} onUpgrade={h.upgrade} />}
      {tab === 'stars' && <StarsTab s={s} onSell={h.sell} />}
      {tab === 'milestones' && <MilestonesTab s={s} onClaim={h.claim} onClaimAll={h.claimAll} />}
    </>
  )

  return (
    <>
      <TycoonStyles />
      {/* exactly the room between the header and the bottom of the screen (below lg, down to the bottom nav, with the
          page's own bottom padding taken back by the negative margin), so the page never scrolls: the floor pans
          and the panel scrolls inside itself */}
      <div className={wide ? 'flex h-[calc(100dvh-116px)] min-h-[600px] gap-3' : '-mb-6 flex h-[calc(100dvh-148px-env(safe-area-inset-bottom,0px))] min-h-[560px] flex-col gap-2 sm:h-[calc(100dvh-156px-env(safe-area-inset-bottom,0px))]'}>
        {floor}
        <div className={wide ? 'flex w-[380px] shrink-0 flex-col gap-3 xl:w-[410px]' : 'flex min-h-0 flex-1 flex-col'}>
          {wide && s && <VaultCard coins={coins} cap={vaultCap(s)} rate={coinRate(s)} compact={false} onCollect={h.collect} />}
          {s ? (
            <Panel tab={tab} onTab={setTab} badges={badges} phone={layout === 'phone'}>
              {body}
            </Panel>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-2xl bg-panel p-6 text-center text-[13px] font-semibold text-dim">{elsewhere ? 'Casino Tycoon is open in another tab.' : 'Opening your casino…'}</div>
          )}
        </div>
      </div>
      <AnimatePresence>
        {away && s && <AwayCard key="away" r={away} coins={coins} dueCoins={dueCoins} onCollect={takeAll} onClose={() => setAway(null)} />}
        {how && s && <HowItWorks key="how" s={s} onClose={() => setHow(false)} />}
        {selling && s && <SellConfirm key="sell" s={s} onSell={sellIt} onClose={() => setSelling(false)} />}
        {sold && <SoldCard key="sold" sold={sold} onClose={() => setSold(null)} />}
      </AnimatePresence>
      <FlyLayer />
    </>
  )
}

/** the whale's top hat, for his banners (and the HUD's chip while he waits) */
function TopHat() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <g stroke="#25183a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M4 23.5c6-2.4 18-2.4 24 0" fill="none" strokeWidth="2.6" />
        <path d="M9.5 22.6V7.5h13v15.1Z" fill="#2a2233" />
        <path d="M9.5 18h13" stroke="#ffd23f" strokeWidth="2.6" />
      </g>
    </svg>
  )
}

/** another tab has the casino */
function Elsewhere() {
  return (
    <div className="max-w-[300px] px-4 text-center">
      <div className="mx-auto w-fit">
        <VaultDoorIcon size={64} />
      </div>
      <div className="mt-3 text-[16px] font-black text-white">Casino Tycoon is open in another tab</div>
      <div className="mt-1 text-[13px] font-semibold text-white/60">Your casino plays in one tab at a time. Close the other one and it carries on here.</div>
    </div>
  )
}

/** the floor's stand-in when this device can't draw it: the panel plays on */
function FlatFloor() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_50%_30%,#2b4a6e_0%,#16233a_60%,#0d1726_100%)] px-6 text-center">
      <div className="flex -space-x-2">
        {[0, 1, 4, 7].map((i) => (
          <AttractionIcon key={i} i={i} size={52} />
        ))}
      </div>
      <div className="max-w-[300px] text-[13px] font-semibold text-white/65">This device can't draw the casino floor, but your casino runs just the same: play it from the panel.</div>
    </div>
  )
}
