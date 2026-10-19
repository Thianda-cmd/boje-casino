/*
  The other ways to free coins: Vault Heist (a timing game that pays, limited by lockpicks that come back over time),
  Casino Tycoon (an idle game whose Coin Vault fills with coins by the hour: its card shows the vault and opens the
  game) and the emergency refill for a nearly empty balance. They sit under the VIP section.
*/
import { motion } from 'framer-motion'
import { FAUCET_AMOUNT, FAUCET_COOLDOWN, FAUCET_THRESHOLD, HEIST_LOOT, HEIST_MAX_PICKS, HEIST_REGEN, heistPicks, useWallet } from '../../store/wallet'
import { Coin, IconBolt, IconCheck, IconChevron, IconLock, IconVault } from '../../components/icons'
import { Lockpick, VaultDoor } from '../../art/Vault'
import { fmt, fmtCompact, fmtDuration } from '../../lib/format'
import { navigate } from '../../lib/router'
import { useNow } from '../../lib/useNow'
import { ClaimButton, Eyebrow, Glow, Panel, useClaim } from './kit'
import { TycoonIcon } from '../../games/tycoon/icon'
import { useTycoonStatus } from '../../games/tycoon/status'
import { VaultRing } from '../../games/tycoon/door'
import { CITIES, MILESTONES, N_ATTR, VAULT_MIN, coinRate, newSave } from '../../games/tycoon/engine'

export function HeistCard() {
  const now = useNow(1000)
  const heist = useWallet((s) => s.heist)
  const { picks, next } = heistPicks(heist, now)
  const best = heist.best ?? 0
  return (
    <Panel className="flex flex-col">
      <Glow color="#f7c548" opacity={0.12} className="-left-24 -top-24 h-96 w-96" />
      <div className="relative flex items-start gap-5">
        <VaultDoor size={96} className="hidden shrink-0 drop-shadow-[0_14px_26px_rgba(0,0,0,.6)] sm:block" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow className="text-gold">
              <IconVault size={18} /> Vault Heist
            </Eyebrow>
            <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-extrabold text-accent">Free to play</span>
          </div>
          <div className="mt-1 text-[22px] font-black tracking-tight">
            Crack all {HEIST_LOOT.length} vaults for {fmt(HEIST_LOOT[HEIST_LOOT.length - 1], 0)} coins
          </div>
          <p className="mt-1 text-pretty text-[13px] text-muted">
            Tap as the needle crosses the notch to crack each vault; gold notches add a bonus. Bank the bag any time, but one miss and the alarm takes it.
          </p>
        </div>
      </div>

      <div className="relative mt-4">
        <div className="text-[11px] font-bold text-dim">What the bag holds after each vault</div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {HEIST_LOOT.map((loot, i) => {
            const hit = i < best
            return (
              <div key={i} className={`rounded-lg px-1 py-1.5 text-center ring-1 ${hit ? 'bg-gold/[.1] ring-gold/30' : 'bg-stage ring-white/[.04]'}`}>
                <div className={`text-[10px] font-bold ${hit ? 'text-gold/80' : 'text-dim'}`}>Vault {i + 1}</div>
                <div className={`tnum text-[13px] font-black ${hit ? 'text-gold' : 'text-muted'}`}>{loot}</div>
              </div>
            )
          })}
        </div>
        {heist.runs > 0 && (
          <div className="tnum mt-2 text-pretty text-[12px] text-dim">
            Your best: {best} of {HEIST_LOOT.length} vaults · {fmt(heist.earned, 0)} coins banked over {heist.runs} {heist.runs === 1 ? 'run' : 'runs'}
          </div>
        )}
      </div>

      <div className="relative mt-auto flex flex-col gap-2 pt-4 sm:flex-row sm:items-stretch">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-stage px-3 py-2 ring-1 ring-white/[.04]">
          <div className="flex shrink-0 gap-0.5">
            {Array.from({ length: HEIST_MAX_PICKS }, (_, i) => (
              <Lockpick key={i} on={i < picks} size={26} />
            ))}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="tnum text-[12.5px] font-bold">{next ? `Next pick in ${fmtDuration(next)}` : `${picks} of ${HEIST_MAX_PICKS} lockpicks ready`}</div>
            <div className="text-pretty text-[11.5px] text-dim">One per run; one comes back every {HEIST_REGEN / 60_000} minutes.</div>
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/heist')}
          className="flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gold px-5 text-[15px] font-extrabold text-[#2a1c00] shadow-[0_8px_22px_-10px_rgba(247,197,72,.8),inset_0_-3px_0_rgba(0,0,0,.16)] transition hover:brightness-105 sm:h-auto sm:min-h-12 sm:w-[210px]"
        >
          {picks ? 'Play Vault Heist' : 'Practice run · no coins'} <IconChevron size={16} />
        </motion.button>
      </div>
    </Panel>
  )
}

/** what the vault fills at, from a brand-new casino to Monaco Heights with everything open */
const TYCOON_RATES = [coinRate(newSave(0)), coinRate({ ...newSave(0, CITIES[CITIES.length - 1].stars), owned: new Array(N_ATTR).fill(1) })]
const TYCOON_MILESTONES = MILESTONES.reduce((a, m) => a + m.coins, 0)

export function TycoonCard() {
  const st = useTycoonStatus(1000)
  const full = !!st && st.fullIn === 0
  const ready = !!st && (st.vault >= VAULT_MIN || st.due > 0)
  return (
    <Panel className="flex flex-col">
      <Glow color="#f5b83d" opacity={full ? 0.2 : 0.12} className="-right-24 -top-24 h-96 w-96" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-5">
          <div className="hidden shrink-0 sm:block">
            <VaultRing fill={st ? st.vault / st.cap : 0.35} size={96} spin={0} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow className="text-[#ffcf4a]">
                <TycoonIcon width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> Casino Tycoon
              </Eyebrow>
              <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-extrabold text-accent">Idle game</span>
            </div>
            <div className="mt-1 text-[22px] font-black tracking-tight">{!st ? 'A casino that pays while you’re away' : full ? 'Your Coin Vault is full' : 'Your Coin Vault is filling'}</div>
            <p className="mt-1 text-pretty text-[13px] text-muted">
              Build a casino from a claw machine to penthouse suites and hire managers to run it. Its Coin Vault fills with coins every hour, {TYCOON_RATES[0]} to {TYCOON_RATES[1]} an hour as it grows, and
              milestones pay {fmt(TYCOON_MILESTONES, 0)} coins more.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 lg:w-[300px]">
          {st && (
            <div className="flex items-center gap-3 rounded-xl bg-stage px-3 py-2 ring-1 ring-white/[.04]">
              <div className="min-w-0 flex-1">
                <div className="tnum flex items-center gap-1.5 text-[15px] font-black">
                  {fmt(st.vault)} <span className="text-[12px] font-bold text-dim">/ {fmt(st.cap)}</span> <Coin size={15} />
                </div>
                <div className="tnum text-[11.5px] text-dim">{full ? 'Full: it has stopped filling' : `+${fmt(st.rate, 1)} an hour · full in ${fmtDuration(st.fullIn)}`}</div>
              </div>
              {st.due > 0 && (
                <span className="tnum shrink-0 rounded-full bg-gold/15 px-2 py-1 text-[11px] font-extrabold text-gold">
                  {st.due} {st.due === 1 ? 'milestone' : 'milestones'} · {fmt(st.dueCoins, 0)}
                </span>
              )}
            </div>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/tycoon')}
            className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-gold px-5 text-[15px] font-extrabold text-[#2a1c00] shadow-[0_8px_22px_-10px_rgba(247,197,72,.8),inset_0_-3px_0_rgba(0,0,0,.16)] transition hover:brightness-105"
          >
            {!st ? 'Open your casino' : ready ? 'Collect in Casino Tycoon' : 'Open Casino Tycoon'} <IconChevron size={16} />
          </motion.button>
        </div>
      </div>
    </Panel>
  )
}

export function RefillCard() {
  const now = useNow(1000)
  const balance = useWallet((s) => s.balance)
  const faucetLast = useWallet((s) => s.faucetLast)
  const claimFaucet = useWallet((s) => s.claimFaucet)
  const claim = useClaim()
  const left = FAUCET_COOLDOWN - (now - faucetLast)
  const cooling = left > 0
  const eligible = balance < FAUCET_THRESHOLD
  const ready = eligible && !cooling
  const minutes = FAUCET_COOLDOWN / 60_000
  return (
    <Panel className="flex flex-col" id="refill">
      <Glow color="#4cb4ff" opacity={0.13} className="-right-24 -top-28 h-80 w-80" />
      <Eyebrow className="relative text-sky">
        <IconBolt size={18} /> Emergency refill
      </Eyebrow>
      <div className="relative mt-1 flex items-center gap-1.5 text-[22px] font-black tracking-tight">
        <span className="tnum">+{FAUCET_AMOUNT}</span> <Coin size={20} />
      </div>
      <p className="relative mt-0.5 text-pretty text-[13px] text-muted">
        {FAUCET_AMOUNT} free coins when your balance drops below {FAUCET_THRESHOLD}, once every {minutes} minutes.
      </p>
      <div className="relative mt-4 flex flex-col gap-2">
        <Condition ok={eligible} label={`Balance below ${FAUCET_THRESHOLD}`} value={eligible ? fmt(balance) : `You have ${balance >= 10_000 ? fmtCompact(balance) : fmt(balance)}`} />
        <Condition ok={!cooling} label={`Once every ${minutes} min`} value={cooling ? `Next in ${fmtDuration(left)}` : 'Ready'} />
      </div>
      <div className="relative mt-auto pt-5">
        <ClaimButton ready={ready} tone="sky" progress={cooling ? 1 - left / FAUCET_COOLDOWN : undefined} onClick={() => claim(claimFaucet(), 'Refill claimed')}>
          {ready ? (
            <>Claim {FAUCET_AMOUNT} coins</>
          ) : eligible ? (
            <span className="tnum">Next refill in {fmtDuration(left)}</span>
          ) : (
            <>
              <IconLock size={16} /> Your balance is too high
            </>
          )}
        </ClaimButton>
      </div>
    </Panel>
  )
}

function Condition({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] ring-1 ${ok ? 'bg-accent/[.06] ring-accent/20' : 'bg-stage ring-white/[.04]'}`}>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-accent text-[#032412]' : 'bg-raised text-dim'}`}>
        {ok ? <IconCheck size={12} /> : <IconLock size={11} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted">{label}</span>
      <span className={`tnum font-bold ${ok ? 'text-ink' : 'text-dim'}`}>{value}</span>
    </div>
  )
}
