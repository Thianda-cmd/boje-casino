import { useEffect, useReducer, useRef, useState } from 'react'
import { CardBack } from '../../art/Card'
import { BojeLoader, Spinner } from '../../components/Loader'
import { ActionButton } from '../../components/ui'
import { carried } from '../../lib/account'
import { guestId } from '../../lib/identity'
import { navigate, useRoute } from '../../lib/router'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { migrateGuest, pruneSettled } from './ledger'
import Lobby from './Lobby'
import { connect, sidTable, tryShared } from './net'
import Table from './Table'
import type { TableServer } from './types'

/* Live Blackjack: shared five-seat tables. #/game/livebj is the lobby, #/game/livebj/<id> a table.
   Rounds run in the database (api/_lib/schema.js); without it the same rules run locally with bots. */

export default function LiveBlackjack() {
  const route = useRoute()
  const m = route.match(/^\/game\/livebj\/(\d+)/)
  const table = m ? Number(m[1]) : null
  const uid = useAuth((s) => s.uid)
  const pushToast = useWallet((s) => s.pushToast)
  const [server, setServer] = useState<TableServer | null>(null)
  const [connecting, setConnecting] = useState(true)
  const [autoSit, setAutoSit] = useState<number | null>(null)
  const [stuck, setStuck] = useState(false)
  const [, hostChanged] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    let alive = true
    let again: ReturnType<typeof setTimeout> | undefined
    const go = () =>
      connect().then(
        (s) => {
          if (!alive) return
          setServer(s)
          setConnecting(false)
        },
        // no shared tables and the offline stand-in could not be fetched (the network is down): keep asking, since the
        // shared tables answer as soon as it is back, but browsers remember a failed chunk until the page reloads
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

  // the offline tables run in one tab at a time: this page holds them while it is open, or offers to take them over
  useEffect(() => server?.host?.use(hostChanged), [server])
  const elsewhere = !!server?.host?.elsewhere
  const wasElsewhere = useRef(false)
  useEffect(() => {
    // taken over from another tab: their rounds settle into this tab's wallet, so first pick up what that tab saved
    // to it (wallets don't follow each other between tabs)
    if (wasElsewhere.current && !elsewhere) void useWallet.persist.rehydrate()
    wasElsewhere.current = elsewhere
  }, [elsewhere])

  useEffect(() => {
    if (!server) return
    const c = carried()
    // stakes a guest had open when signing up were paid from the wallet the account took over, so they settle there,
    // even when Live Blackjack wasn't open at the time
    if (c) migrateGuest(c.to, guestId, c.at)
    pruneSettled(uid ?? 'guest')
    // a guest who just signed up: their seat (and the hands on it) moves into the new account
    if (!uid || !server.online || c?.to !== uid || !(Date.now() - c.at < 10 * 60_000)) return
    const held = sidTable()
    if (held != null) void server.claim(held)
  }, [server, uid])

  const retry = async () => {
    setConnecting(true)
    const s = await tryShared()
    setConnecting(false)
    if (s) setServer(s)
    else pushToast({ kind: 'info', title: 'The shared tables are still unavailable.' })
  }

  const open = (id: number, sit: boolean) => {
    setAutoSit(sit ? id : null)
    navigate(`/game/livebj/${id}`)
  }

  if (!server)
    return (
      <div className="flex h-[calc(100dvh-108px)] min-h-[420px] flex-col items-center justify-center gap-5 rounded-2xl bg-panel2/50 px-4 text-center">
        <BojeLoader />
        {stuck && (
          <div className="max-w-[320px] text-[13px] leading-relaxed text-muted">
            <p className="text-[15px] font-bold text-ink">Can't reach the tables</p>
            <p className="mt-1">Check your connection. This page keeps trying, or you can reload it.</p>
            <button onClick={() => location.reload()} className="mt-3 rounded-lg bg-raised px-4 py-2 font-bold text-ink transition hover:bg-hover">
              Reload
            </button>
          </div>
        )}
      </div>
    )
  if (elsewhere) return <OtherTab onTake={() => server.host!.take()} connecting={connecting} onRetry={retry} />
  return table != null ? (
    <Table
      key={`${table}:${server.book}`}
      server={server}
      table={table}
      autoSit={autoSit === table}
      onAutoSit={() => setAutoSit(null)}
      connecting={connecting}
      onRetry={retry}
    />
  ) : (
    <Lobby server={server} connecting={connecting} onRetry={retry} onOpen={open} />
  )
}

/** The offline tables are running in another tab of this browser. */
function OtherTab({ onTake, connecting, onRetry }: { onTake: () => Promise<void>; connecting: boolean; onRetry: () => void }) {
  const [taking, setTaking] = useState(false)
  return (
    <div className="flex h-[calc(100dvh-108px)] min-h-[420px] flex-col items-center justify-center gap-5 rounded-2xl bg-panel2/50 px-4 text-center">
      <div className="flex" aria-hidden>
        {[-10, 10].map((r) => (
          <CardBack key={r} width={54} height={76} className="-mx-1.5 drop-shadow-[0_6px_10px_rgba(0,0,0,.45)]" style={{ transform: `rotate(${r}deg)` }} />
        ))}
      </div>
      <div className="max-w-[340px] text-[13px] leading-relaxed text-muted">
        <p className="text-[15px] font-bold text-ink">Live Blackjack is open in another tab</p>
        <p className="mt-1">The offline tables run in one tab at a time. Your seat and any open bets come with them.</p>
      </div>
      <div className="w-full max-w-[220px]">
        <ActionButton
          tone="gold"
          disabled={taking}
          onClick={() => {
            setTaking(true)
            void onTake().finally(() => setTaking(false))
          }}
        >
          {taking && <Spinner size={16} />} Play here
        </ActionButton>
        <button onClick={onRetry} disabled={connecting} className="mt-3 flex w-full items-center justify-center gap-2 text-[12px] font-bold text-muted transition hover:text-ink disabled:opacity-50">
          {connecting && <Spinner size={12} />} Try the shared tables again
        </button>
      </div>
    </div>
  )
}
