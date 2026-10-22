import { useEffect, useState } from 'react'
import { Avatar } from '../../../art/Avatar'
import { fmt } from '../../../lib/format'
import { useWallet } from '../../../store/wallet'
import { callsUntil, fallenBy, healthAt } from '../fight'
import { MARKETS, METHOD_NAME, fighter, selName } from '../rules'
import { useKaijuLive, reasonText, type KaijuLive, type Verification } from '../live'
import type { Sel } from '../types'

/*
  Dev lab #/dev/live: the live controller (live.ts useKaijuLive) on its own, before the page and the stage exist.
  Every number the hook returns is on screen, every action has a button, and the hook is on window.__kjLive so the
  tools (tools/kaiju-live.mjs) can drive it and read it. Against the stand-in on a plain dev server, or the shared
  fight night through the PGlite shim (vite --mode shim).
*/

const CHIPS = [1, 5, 25, 100, 1000]

function useFrame(on = true) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    let raf = 0
    const f = () => {
      set((x) => (x + 1) % 1e9)
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [on])
}

export default function LiveLab() {
  const live = useKaijuLive()
  const balance = useWallet((s) => s.balance)
  const [chip, setChip] = useState(25)
  const [say, setSay] = useState('')
  const [proof, setProof] = useState<Verification | null>(null)
  useFrame()
  ;(window as unknown as { __kjLive?: KaijuLive }).__kjLive = live
  const r = live.round
  const t = live.now()
  const left = r ? Math.max(0, r.betUntil - t) : 0
  const ms = r ? t - r.times.fightAt : 0
  const [ha, hb] = r?.fight && ms >= 0 ? healthAt(r.fight, Math.min(ms, r.fight.endsAt)) : [100, 100]
  const calls = r?.fight && ms >= 0 ? callsUntil(r.fight, ms).slice(-3) : []
  const fallen = r?.fight && ms >= 0 ? fallenBy(r.fight, ms) : 0
  const act = async (p: Promise<{ ok: boolean }>) => {
    const res = await p
    setSay(reasonText(res) ?? (res.ok ? 'ok' : ''))
  }
  const sel = (s: Sel) => {
    const hit = r?.hits?.includes(s)
    const mine = live.mine[s] ?? 0
    const crowd = live.totals[s]
    return (
      <button
        key={s}
        data-sel={s}
        disabled={r?.phase !== 'bets'}
        onClick={() => act(live.actions.place({ [s]: chip }))}
        className={`flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left ring-1 transition disabled:cursor-default ${hit ? 'bg-accent/20 ring-accent' : 'bg-raised ring-line hover:bg-hover'} ${r?.hits && !hit ? 'opacity-50' : ''}`}
      >
        <span className="text-[12.5px] font-extrabold text-ink">{r ? selName(s, r.matchup) : s}</span>
        <span className="tnum text-[15px] font-black text-gold">{live.odds ? `${live.odds.mult[s].toFixed(2)}×` : '—'}</span>
        <span className="tnum text-[11px] font-semibold text-muted">
          {mine > 0 && <b className="mr-1.5 text-accent">you {fmt(mine)}</b>}
          {fmt(crowd.total, 0)} · {crowd.players}p · {live.odds ? `${(live.odds.p[s] * 100).toFixed(1)}%` : ''}
        </span>
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-3 p-1 text-[13px]" data-lab="kaiju-live" data-round={r?.id} data-phase={r?.phase} data-ready={live.ready ? 1 : 0}>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-panel p-3">
        <h1 className="mr-2 text-[20px] font-black">Kaiju live lab</h1>
        <Tag>{live.conn}</Tag>
        <Tag>{live.book}</Tag>
        <Tag>online {live.online}</Tag>
        {live.bots > 0 && <Tag>bots {live.bots}</Tag>}
        <Tag>balance {fmt(balance)}</Tag>
        {live.busy && <Tag>waiting to settle</Tag>}
        {live.sending && <Tag>sending…</Tag>}
        <span className="ml-auto text-muted">
          {live.me.name} {live.me.guest ? '(guest)' : ''}
        </span>
        {live.conn === 'solo' && (
          <button onClick={() => void live.actions.retry()} className="rounded-lg bg-raised px-3 py-1.5 font-bold hover:bg-hover">
            Retry shared
          </button>
        )}
      </div>

      {!r ? (
        <div className="rounded-2xl bg-panel p-6 text-muted">Joining the fight night…</div>
      ) : (
        <>
          <div className={`grid gap-3 rounded-2xl p-4 lg:grid-cols-[1fr_auto_1fr] ${r.main ? 'bg-[linear-gradient(120deg,#3a2a06,#1a1530)] ring-1 ring-gold/50' : 'bg-panel'}`}>
            <Corner id={r.matchup.a} side="A" health={ha} />
            <div className="flex flex-col items-center justify-center gap-1 text-center">
              <div className="text-[11px] font-black uppercase tracking-[.2em] text-muted">
                {r.main ? 'Main Event · ' : ''}Round #{r.id}
              </div>
              <div className="text-[28px] font-black uppercase text-ink" data-phase-label>
                {r.phase}
              </div>
              <div className="tnum text-[13px] font-bold text-muted">
                {r.phase === 'bets' ? `bets close in ${(left / 1000).toFixed(1)} s` : r.phase === 'fight' || r.phase === 'result' ? `${(ms / 1000).toFixed(1)} s from the bell` : ''}
              </div>
              <div className="tnum text-[12px] text-dim">
                buildings {fallen} / line {live.odds?.line}
              </div>
              {r.over && r.result && (
                <div className="mt-1 rounded-lg bg-black/30 px-3 py-1 text-[13px] font-black text-gold" data-result>
                  {fighter(r.result.winner === 'a' ? r.matchup.a : r.matchup.b).name} by {METHOD_NAME[r.result.method]} in round {r.result.round} · first {r.result.first.toUpperCase()} · {r.result.damage} down
                </div>
              )}
              <div className="mt-1 max-w-[340px] truncate font-mono text-[10px] text-dim">hash {r.hash ?? '…'}</div>
              <div className="max-w-[340px] truncate font-mono text-[10px] text-dim">key {r.key ?? '(at the close)'}</div>
            </div>
            <Corner id={r.matchup.b} side="B" health={hb} right />
          </div>

          {calls.length > 0 && (
            <div className="rounded-2xl bg-panel p-3 text-[12.5px] text-muted">
              {calls.map((c) => (
                <div key={c.t}>{c.text}</div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-panel p-3">
            {CHIPS.map((v) => (
              <button key={v} onClick={() => setChip(v)} className={`tnum rounded-full px-3 py-1.5 font-black ${chip === v ? 'bg-accent text-[#032412]' : 'bg-raised text-ink'}`}>
                {v}
              </button>
            ))}
            <span className="mx-2 h-6 w-px bg-line" />
            <Btn on={() => act(live.actions.undo())} off={!live.canUndo}>
              Undo
            </Btn>
            <Btn on={() => act(live.actions.clear())} off={r.phase !== 'bets' || !live.staked}>
              Clear
            </Btn>
            <Btn on={() => act(live.actions.double())} off={r.phase !== 'bets' || !live.staked}>
              ×2
            </Btn>
            <Btn on={() => act(live.actions.rebet())} off={r.phase !== 'bets' || !live.last}>
              Rebet
            </Btn>
            <span className="tnum ml-2 font-bold text-ink">staked {fmt(live.staked)}</span>
            <span className="ml-auto text-[12px] text-muted" data-say>
              {say}
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {MARKETS.map((m) => (
              <div key={m.id} className="rounded-2xl bg-panel p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-[14px] font-black">{m.name}</span>
                  <span className="text-[11px] text-dim">{m.line}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">{m.sels.map(sel)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Your last result">
          {live.lastSettled ? (
            <div className="flex flex-col gap-1" data-settled={live.lastSettled.round}>
              <div className="font-bold text-ink">
                #{live.lastSettled.round} {fighter(live.lastSettled.matchup.a).name} vs {fighter(live.lastSettled.matchup.b).name}
              </div>
              <div className="tnum">
                bet {fmt(live.lastSettled.bet)} · paid {fmt(live.lastSettled.payout)} · net <b className={live.lastSettled.net >= 0 ? 'text-accent' : 'text-danger'}>{fmt(live.lastSettled.net)}</b>
                {live.lastSettled.refund > 0 && ` · back ${fmt(live.lastSettled.refund)}`}
              </div>
              <div className="text-[12px] text-muted">won: {live.lastSettled.won.join(', ') || 'nothing'}</div>
            </div>
          ) : (
            <span className="text-dim">Nothing settled on this page yet.</span>
          )}
        </Panel>
        <Panel title={`Bettors (${live.players})`}>
          <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto" data-bettors>
            {live.bettors.map((b, i) => (
              <div key={i} className={`flex items-center gap-2 ${b.me ? 'text-accent' : 'text-ink/85'}`}>
                <Avatar index={b.avatar} size={22} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {b.name}
                  {b.acct ? ' ·acct' : ''}
                  {b.bot ? ' ·bot' : ''}
                </span>
                <span className="tnum text-[11px] text-muted">{r ? selName(b.sel, r.matchup) : b.sel}</span>
                <span className="tnum w-16 text-right font-bold">{fmt(b.total)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Next fights">
          {live.next.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="font-semibold">
                #{n.id} {fighter(n.matchup.a).name} vs {fighter(n.matchup.b).name}
                {n.matchup.main ? ' ★' : ''}
              </span>
              <span className="tnum text-gold">
                {n.odds.mult['win:a'].toFixed(2)} / {n.odds.mult['win:b'].toFixed(2)}
              </span>
            </div>
          ))}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Panel title={`History (${live.history.length})`}>
          <div className="flex flex-wrap gap-1.5" data-history>
            {live.history.slice(0, 30).map((h) => (
              <button key={h.id} onClick={() => void live.actions.verify(h.id).then(setProof)} className="tnum rounded-lg bg-raised px-2 py-1 text-[11px] font-bold hover:bg-hover">
                {fighter(h.result.winner === 'a' ? h.matchup.a : h.matchup.b).name} {METHOD_NAME[h.result.method]} R{h.result.round} · {h.result.damage}
              </button>
            ))}
          </div>
          {proof && (
            <div className="mt-2 rounded-xl bg-stage p-2 font-mono text-[11px] text-muted" data-proof={proof.id}>
              #{proof.id} hash {proof.hashOk == null ? '?' : proof.hashOk ? 'ok' : 'BAD'} · key {proof.keyOk == null ? '?' : proof.keyOk ? 'ok' : 'BAD'} · {proof.result ? `${proof.result.winner} ${proof.result.method} r${proof.result.round}` : 'no result'}
              {proof.missing ? ' · missing' : ''}
            </div>
          )}
        </Panel>
        <Panel title="Standings (last 50)">
          <table className="tnum w-full text-[12px]">
            <tbody>
              {live.standings.map((s) => (
                <tr key={s.id}>
                  <td className="py-0.5 font-bold">{fighter(s.id).name}</td>
                  <td className="text-right">
                    {s.wins}-{s.losses}
                  </td>
                  <td className="text-right text-muted">KO {s.ko}</td>
                  <td className="text-right text-muted">Sp {s.splash}</td>
                  <td className="text-right text-muted">Dec {s.dec}</td>
                  <td className="pl-2 text-right font-mono text-[11px]">{s.form.join('')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  )
}

function Corner({ id, side, health, right }: { id: Parameters<typeof fighter>[0]; side: string; health: number; right?: boolean }) {
  const f = fighter(id)
  return (
    <div className={`flex flex-col gap-1.5 ${right ? 'items-end text-right' : ''}`}>
      <div className="text-[11px] font-black uppercase tracking-widest" style={{ color: f.colors.glow }}>
        {side} corner
      </div>
      <div className="text-[24px] font-black leading-none">{f.name}</div>
      <div className="text-[12px] text-muted">{f.epithet}</div>
      <div className="h-2.5 w-full max-w-[260px] overflow-hidden rounded-full bg-black/40">
        <div className={`h-full rounded-full ${right ? 'ml-auto' : ''}`} style={{ width: `${health}%`, background: f.colors.glow }} />
      </div>
    </div>
  )
}

const Tag = ({ children }: { children: React.ReactNode }) => <span className="rounded-full bg-raised px-2.5 py-1 text-[11.5px] font-bold text-muted">{children}</span>
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl bg-panel p-3">
    <div className="mb-2 text-[12px] font-black uppercase tracking-wider text-muted">{title}</div>
    {children}
  </div>
)
const Btn = ({ on, off, children }: { on: () => void; off: boolean; children: React.ReactNode }) => (
  <button onClick={on} disabled={off} className="rounded-lg bg-raised px-3 py-1.5 font-bold text-ink hover:bg-hover disabled:opacity-40">
    {children}
  </button>
)
