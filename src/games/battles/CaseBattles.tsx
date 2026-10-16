import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { BojeLoader } from '../../components/Loader'
import { useStake } from '../../components/ui'
import { carried } from '../../lib/account'
import { defaultName, guestId } from '../../lib/identity'
import { navigate, useRoute } from '../../lib/router'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { createBattle, joinBattle, type Setup } from './actions'
import Battle from './Battle'
import CreateModal, { defaultSetup } from './Create'
import { migrateGuest, pruneSettled } from './ledger'
import Lobby from './Lobby'
import { connect, tryShared } from './net'
import type { BattleServer, BattleView } from './types'

/* Case Battles: #/game/battles is the lobby, #/game/battles/<id> a battle. Battles run in the database
   (api/_lib/schema.js); without it the same rules run in the browser against the house bots (local.ts). */

export default function CaseBattles() {
  const route = useRoute()
  const m = route.match(/^\/game\/battles\/(\d+)/)
  const id = m ? Number(m[1]) : null
  const uid = useAuth((s) => s.uid)
  const username = useAuth((s) => s.profile?.username ?? null)
  const who = uid ?? 'guest'
  const name = username ?? defaultName()
  const stake = useStake()
  const pushToast = useWallet((s) => s.pushToast)
  const [server, setServer] = useState<BattleServer | null>(null)
  const [stuck, setStuck] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [setup, setSetup] = useState<Setup | null>(null)

  useEffect(() => {
    let alive = true
    let again: ReturnType<typeof setTimeout> | undefined
    const go = () =>
      connect().then(
        (s) => alive && setServer(s),
        // no shared battles and the offline stand-in could not be fetched (the network is down): keep asking
        () => {
          if (!alive) return
          setStuck(true)
          again = setTimeout(go, 4000)
        },
      )
    go()
    return () => {
      alive = false
      clearTimeout(again)
    }
  }, [])

  useEffect(() => {
    if (!server) return
    // stakes a guest had open when signing up were paid from the wallet the account took over, so they settle there
    const c = carried()
    if (c) migrateGuest(c.to, guestId, c.at)
    pruneSettled(who)
  }, [server, who])

  const retry = async () => {
    setConnecting(true)
    const s = await tryShared()
    setConnecting(false)
    if (s) setServer(s)
    else pushToast({ kind: 'info', title: 'The shared battles are still unavailable.' })
  }

  const create = async (s: Setup, bots: boolean) => {
    if (!server) return false
    const b = await createBattle(server, who, s, name, bots, stake)
    if (b) navigate(`/game/battles/${b.id}`)
    return !!b
  }
  const join = async (b: BattleView) => {
    if (!server) return
    const r = await joinBattle(server, who, b, null, name, stake)
    if (r) navigate(`/game/battles/${r.id}`)
  }

  if (!server)
    return (
      <div className="flex h-[calc(100dvh-108px)] min-h-[420px] flex-col items-center justify-center gap-5 rounded-2xl bg-panel2/50 px-4 text-center">
        <BojeLoader />
        {stuck && (
          <div className="max-w-[320px] text-[13px] leading-relaxed text-muted">
            <p className="text-[15px] font-bold text-ink">Can't reach Case Battles</p>
            <p className="mt-1">Check your connection. This page keeps trying, or you can reload it.</p>
            <button onClick={() => location.reload()} className="mt-3 rounded-lg bg-raised px-4 py-2 font-bold text-ink transition hover:bg-hover">
              Reload
            </button>
          </div>
        )}
      </div>
    )
  return (
    <>
      {id != null ? (
        <Battle key={`${id}:${server.online}:${who}`} server={server} id={id} who={who} name={name} connecting={connecting} onRetry={retry} />
      ) : (
        <Lobby server={server} who={who} connecting={connecting} onRetry={retry} onCreate={() => setSetup(defaultSetup())} onJoin={join} />
      )}
      <AnimatePresence>{setup && <CreateModal initial={setup} name={name} onCreate={create} onClose={() => setSetup(null)} />}</AnimatePresence>
    </>
  )
}
