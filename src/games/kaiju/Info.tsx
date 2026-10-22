import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { IconCheck } from '../../components/icons'
import { fmt } from '../../lib/format'
import { MAX_BET } from '../../store/wallet'
import { BET_MS, BREAK_MS, CLOSE_MS, CYCLE_MS, RESULT_MS, ROUND_MS, WALKOUT_MS } from './clock'
import { keyOf, sha256 } from './fair'
import { CLIENT_CLOSE_MS, type PastFight, type Verification } from './live'
import { MARKETS, MAX_MULT, METHOD_NAME, ROSTER, RTP, STAKE_LIMIT, drawResult, fighter, matchupOf, selName, sideId } from './rules'
import { KaijuPortrait } from './portraits'
import { CORNER, MethodMark } from './art'
import type { Matchup, Odds, Result } from './types'

/*
  How Kaiju Clash works, and the fairness check.

  How it works: the fight night's timetable, every market and what wins it, this fight's full price list (each
  selection's chance and what it pays), how the chances come from the kaiju's stats (rules.ts, stated as it is), the
  roster, the limits, and the commit-reveal in a paragraph.

  The fairness check: for any round still on record, the hash published before betting, the key revealed at the
  close and the seed revealed at the final bell, checked here in the browser (the seed hashes to the hash; the key
  is SHA-256(seed + ":key")), and the result the key draws, with every selection it won. Anyone can also paste a seed
  and see what it gives.
*/

const s = (ms: number) => `${Math.round(ms / 100) / 10} s`
const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}%`

export function HowItWorks({ matchup, odds, onClose, onFair }: { matchup: Matchup | null; odds: Odds | null; onClose: () => void; onFair: () => void }) {
  const bets = BET_MS - CLOSE_MS - CLIENT_CLOSE_MS
  return (
    <Modal onClose={onClose} title="How Kaiju Clash works" width={680}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-ink/90">
        <p>
          Kaiju Clash is a live fight night in Neon Bay: every {Math.round(CYCLE_MS / 1000)} seconds two of eight kaiju meet in the plaza, and everyone watching bets on the same fight. Bets are open for about {Math.floor(bets / 1000)} seconds,
          then the kaiju walk out ({s(WALKOUT_MS)}) and fight up to three rounds of {s(ROUND_MS)} with {s(BREAK_MS)} between them. A knockout or a Splash ends it early; otherwise the three judges decide. The result shows for {s(RESULT_MS)}, then the next fight
          opens. Every tenth fight is the Main Event: a bigger show, the same maths.
        </p>
        <p>
          Pick a chip and tap prices on the board: each tap adds the chip to that selection. Bet on as many selections as you like; each pays on its own. Your chips leave your balance as you place them; if the server turns one away, it comes
          back. A selection pays its price times your stake (the stake included) when it wins. Keys: 1 to 8 pick a chip, U undoes, X clears, D doubles, R or Space rebets your last fight's bets.
        </p>

        <Section title="The markets">
          <ul className="flex flex-col gap-1.5">
            {MARKETS.map((m) => (
              <li key={m.id}>
                <b className="text-ink">{m.name}.</b> <span className="text-muted">{MARKET_TEXT[m.id]}</span>
              </li>
            ))}
          </ul>
        </Section>

        {matchup && odds && <PriceTable matchup={matchup} odds={odds} />}

        <Section title="Where the prices come from">
          <ul className="flex flex-col gap-1.5 text-[13px] text-muted">
            <li>
              Each fight ends one of 14 ways: either kaiju wins, by a knockout in round 1, 2 or 3, by a Splash in round 1, 2 or 3, or on the cards. Each way has a whole-number weight from the two kaiju's stats, and the weights add up to exactly 2²⁰. A
              kaiju's strength is 2 × power + grapple + 2 × tough + speed, plus 2 for each edge the matchup gives it (a grappler against a slow kaiju, speed against slowness, big power against a glass jaw); each kaiju wins in proportion to its
              strength to the fourth power.
            </li>
            <li>
              A win comes by knockout in proportion to power² × (13 − the loser's toughness) × (16 − the loser's speed), by Splash in proportion to 70 × grapple × (12 − the loser's speed), and on the cards in proportion to 185 × (the loser's
              toughness and speed and the winner's speed). A knockout or Splash falls in rounds 1, 2 and 3 as (3 + d) : (4 + d) : 5, where d grows with how much stronger the winner is: a mismatch ends early.
            </li>
            <li>The first strike: A lands first with weight (A's speed + 4) against (B's speed + 4), drawn on its own.</li>
            <li>
              Buildings: every round fought flattens 0 to 6 of them, from the two kaiju's chaos (a binomial of six with chance (chaos A + chaos B) / 36). The fight's total adds up the rounds it lasted, so an early finish flattens fewer. The line is
              the half number that makes Over and Under as close to even as it can be.
            </li>
            <li>
              Every selection's chance is worked out exactly, and its price is {RTP} ÷ the chance, rounded down to the cent: every selection returns just under {Math.round(RTP * 100)}% of what is staked on it, whichever you pick. Prices never pass{' '}
              {MAX_MULT}×; in practice the longest is under 30×.
            </li>
          </ul>
        </Section>

        <Section title="The fighters">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12px]">
              <thead className="text-[10px] font-black uppercase tracking-[.08em] text-dim">
                <tr>
                  <th className="py-1 pr-2">Kaiju</th>
                  {['Pow', 'Grp', 'Tgh', 'Spd', 'Chaos'].map((h) => (
                    <th key={h} className="px-1 py-1 text-right">
                      {h}
                    </th>
                  ))}
                  <th className="py-1 pl-3">Special</th>
                </tr>
              </thead>
              <tbody>
                {ROSTER.map((f) => (
                  <tr key={f.id} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-2">
                        <KaijuPortrait id={f.id} size={26} bg className="rounded-md" />
                        <span className="leading-tight">
                          <b className="text-ink">{f.name}</b>
                          <span className="block text-[10.5px] text-dim">{f.epithet}</span>
                        </span>
                      </span>
                    </td>
                    {[f.power, f.grapple, f.tough, f.speed, f.chaos].map((v, i) => (
                      <td key={i} className="tnum px-1 py-1.5 text-right font-bold text-ink">
                        {v}
                      </td>
                    ))}
                    <td className="py-1.5 pl-3 text-muted">{f.special}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <p className="text-[12.5px] text-muted">
          Limits: up to {fmt(STAKE_LIMIT, 0)} on one selection and {fmt(MAX_BET, 0)} in all on one fight. The fight card shows the next three fights and their prices ahead: each fight's pairing comes from its number alone, and no pairing fights
          twice in a row.
        </p>
        <div className="rounded-xl border border-line bg-panel2 p-3 text-[12.5px] text-muted">
          <b className="text-ink">Provably fair.</b> Every fight comes from a random seed whose SHA-256 hash is shown before anyone bets. When betting closes the key, SHA-256(seed + ":key"), is revealed: it draws the result (and the blow-by-blow
          script every browser plays), so nothing can change once you have bet. The seed itself is revealed at the final bell, so you can check the key and the hash.{' '}
          <button onClick={onFair} className="font-bold text-accent hover:underline">
            Check a fight
          </button>
        </div>
      </div>
    </Modal>
  )
}

const MARKET_TEXT: Record<string, string> = {
  win: 'Who wins the fight, by knockout, Splash or decision.',
  how: 'How it ends, whoever wins: a knockout on land, a Splash (the loser thrown into the bay), or the judges after three rounds.',
  exact: 'The winner and how it wins, together: six selections.',
  rnd: 'The round a knockout or Splash comes in, or Distance for a fight that goes to the judges.',
  first: 'Who lands the first blow of the fight (a blow that is blocked or dodged does not count).',
  dmg: "How many buildings the fight flattens, over or under the fight's line.",
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11.5px] font-black uppercase tracking-[.12em] text-muted">{title}</div>
      {children}
    </div>
  )
}

function PriceTable({ matchup, odds }: { matchup: Matchup; odds: Odds }) {
  return (
    <Section title={`This fight: ${fighter(matchup.a).name} vs ${fighter(matchup.b).name}`}>
      <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {MARKETS.map((m) => (
          <div key={m.id} className="mb-1.5">
            <div className="text-[11px] font-bold text-dim">{m.name}</div>
            {m.sels.map((sel) => (
              <div key={sel} className="flex items-center gap-2 border-b border-line/60 py-0.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-ink/90">{selName(sel, matchup)}</span>
                <span className="tnum w-14 text-right text-dim">{pct(odds.p[sel])}</span>
                <span className="tnum w-14 text-right font-bold text-ink">{odds.mult[sel].toFixed(2)}×</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ---------------- the fairness check ---------------- */

export function Fairness({ id, current, verify, history, onPick, onClose }: { id: number; current: number | null; verify: (id: number) => Promise<Verification>; history: PastFight[]; onPick: (id: number) => void; onClose: () => void }) {
  const [v, setV] = useState<Verification | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setV(null)
    verify(id).then((x) => alive && setV(x), () => alive && setV(null))
    return () => void (alive = false)
    // verify is the hook's and changes every render: the round is what this follows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  const m = matchupOf(id)
  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1200)
    })
  }
  const loading = !v
  const field = (label: string, value: string | null, placeholder: string) => (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-muted">
        {label}
        {value && (
          <button onClick={() => copy(label, value)} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-dim transition hover:bg-panel2 hover:text-ink">
            {copied === label ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className="break-all rounded-lg bg-stage px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink/90">{value || <span className="font-sans text-dim">{placeholder}</span>}</div>
    </div>
  )
  const isCurrent = current === id
  return (
    <Modal onClose={onClose} title={`Fight #${id}`} width={560}>
      <div className="flex flex-col gap-4">
        <Matchline m={m} result={v?.result ?? null} />
        {field('Hash, published before betting', v?.hash ?? null, loading ? 'Loading…' : v?.missing ? 'This fight is too old (or too far ahead) to look up' : '—')}
        {field('Key, revealed when betting closes', v?.key ?? null, loading ? 'Loading…' : isCurrent ? 'Revealed when betting closes' : '—')}
        {field('Seed, revealed at the final bell', v?.seed ?? null, loading ? 'Loading…' : isCurrent ? 'Revealed at the final bell' : '—')}
        {v && v.seed && (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <Check ok={v.hashOk}>The seed matches the published hash</Check>
            <Check ok={v.keyOk}>The key is SHA-256(seed + ":key")</Check>
            {v.result && <Check ok>{`The key draws: ${describe(m, v.result)}`}</Check>}
          </div>
        )}
        {v?.result && v.hits && (
          <div>
            <div className="mb-1.5 text-[12px] font-bold text-muted">Winning selections</div>
            <div className="flex flex-wrap gap-1.5">
              {v.hits.map((h) => (
                <span key={h} className="tnum rounded-full bg-gold/15 px-2 py-0.5 text-[11.5px] font-bold text-gold ring-1 ring-gold/30">
                  {selName(h, m)} <span className="text-ink/80">{v.odds.mult[h].toFixed(2)}×</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {!!history.length && (
          <div>
            <div className="mb-2 text-[12px] font-bold text-muted">Recent fights</div>
            <div className="flex flex-wrap gap-1.5">
              {history.slice(0, 18).map((h) => (
                <button key={h.id} onClick={() => onPick(h.id)} className={`rounded-full transition ${h.id === id ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel' : 'opacity-80 hover:opacity-100'}`} aria-label={`Fight ${h.id}`} title={`Fight #${h.id}`}>
                  <KaijuPortrait id={sideId(h.matchup, h.result.winner)} size={30} mood="win" bg className="rounded-full" />
                </button>
              ))}
              {current != null && current !== id && (
                <button onClick={() => onPick(current)} className="rounded-full bg-raised px-3 py-1.5 text-[12px] font-extrabold text-muted hover:bg-hover hover:text-ink">
                  Current fight
                </button>
              )}
            </div>
          </div>
        )}
        <SeedCheck id={id} />
        <p className="text-[12px] leading-relaxed text-dim">
          Each fight comes from a random seed whose SHA-256 hash is shown before anyone bets. The key, SHA-256(seed + ":key"), is revealed when betting closes and draws the result: each number drawn for a purpose is the first 52 bits of
          SHA-256(key:purpose:index), turned into a whole number below the total of the outcome weights. The same key writes the blow-by-blow script, so every browser plays the same fight. The seed is revealed at the final bell.
        </p>
      </div>
    </Modal>
  )
}

const describe = (m: Matchup, r: Result) => {
  const w = fighter(sideId(m, r.winner)).name
  return `${w} by ${METHOD_NAME[r.method]}${r.method === 'dec' ? '' : ` in round ${r.round}`}, ${fighter(sideId(m, r.first)).name} first, ${r.damage} building${r.damage === 1 ? '' : 's'}`
}

function Matchline({ m, result }: { m: Matchup; result: Result | null }) {
  return (
    <div className="flex items-center gap-3">
      {(['a', 'b'] as const).map((x) => (
        <span key={x} className={`flex items-center gap-2 ${x === 'b' ? 'order-3 flex-row-reverse text-right' : ''}`}>
          <span className="rounded-[11px] p-[1.5px]" style={{ background: CORNER[x].color }}>
            <KaijuPortrait id={sideId(m, x)} size={40} mirror={x === 'b'} bg mood={result ? (result.winner === x ? 'win' : 'ko') : 'calm'} className="rounded-[10px]" />
          </span>
          <span className="text-[15px] font-black leading-tight">{fighter(sideId(m, x)).name}</span>
        </span>
      ))}
      <span className="order-2 flex flex-1 flex-col items-center text-center">
        {result ? (
          <>
            <MethodMark method={result.method} size={20} />
            <span className="text-[11px] font-bold text-muted">{METHOD_NAME[result.method]}{result.method === 'dec' ? '' : ` · R${result.round}`}</span>
          </>
        ) : (
          <span className="text-[13px] font-black italic text-dim">vs</span>
        )}
        {m.main && <span className="mt-0.5 rounded bg-gold px-1 text-[9px] font-black uppercase tracking-wider text-[#2a1a00]">Main Event</span>}
      </span>
    </div>
  )
}

function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[13px] font-semibold">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok == null ? 'bg-raised' : ok ? 'bg-accent text-[#032412]' : 'bg-danger text-white'}`}>{ok == null ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" /> : ok ? <IconCheck size={12} /> : '!'}</span>
      <span>{children}</span>
    </div>
  )
}

/** paste a seed: its hash, its key and what it draws for this fight */
function SeedCheck({ id }: { id: number }) {
  const [seed, setSeed] = useState('')
  const m = matchupOf(id)
  const out = useMemo(() => {
    const t = seed.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(t)) return null
    const key = keyOf(t)
    const r = drawResult(key, m.a, m.b)
    return { hash: sha256(t), key, r }
  }, [seed, m.a, m.b])
  return (
    <details className="rounded-xl border border-line px-3 py-2">
      <summary className="cursor-pointer text-[12.5px] font-bold text-muted">Check a seed yourself</summary>
      <div className="mt-2 flex flex-col gap-2 text-[12px]">
        <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Paste a 64-character seed" className="w-full rounded-lg bg-stage px-3 py-2 font-mono text-[16px] text-ink outline-none ring-1 ring-line focus:ring-accent/60 sm:text-[12px]" spellCheck={false} />
        {out ? (
          <>
            <div className="break-all text-muted">
              <b className="text-ink">Hash</b> {out.hash}
            </div>
            <div className="break-all text-muted">
              <b className="text-ink">Key</b> {out.key}
            </div>
            <div className="text-ink">
              For fight #{id} ({fighter(m.a).name} vs {fighter(m.b).name}): {describe(m, out.r)}
            </div>
          </>
        ) : (
          seed && <div className="text-dim">A seed is 64 hexadecimal characters.</div>
        )}
      </div>
    </details>
  )
}

