import { useEffect, useRef, useState } from 'react'
import { Label, NumberField, Segmented, sleep } from './ui'
import { Coin } from './icons'

/* Autobet shared by the quick games: run N rounds (or until stopped) with optional profit and loss stops. */

export type Mode = 'manual' | 'auto'

export function ModeTabs({ mode, onChange, disabled }: { mode: Mode; onChange: (m: Mode) => void; disabled?: boolean }) {
  return (
    <Segmented
      value={mode}
      onChange={onChange}
      disabled={disabled}
      options={[
        { value: 'manual', label: 'Manual' },
        { value: 'auto', label: 'Auto' },
      ]}
    />
  )
}

export interface AutoConfig {
  /** 0 = until stopped */
  count: number
  stopProfit: number
  stopLoss: number
}

/** `round` plays one bet to completion and resolves with its net result, or null if it could not be placed. */
export function useAutoBet(round: () => Promise<number | null>, delay = 250) {
  const [running, setRunning] = useState(false)
  const [left, setLeft] = useState<number | null>(null)
  const [cfg, setCfg] = useState<AutoConfig>({ count: 10, stopProfit: 0, stopLoss: 0 })
  const stopRef = useRef(false)
  const roundRef = useRef(round)
  roundRef.current = round
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg

  useEffect(() => () => void (stopRef.current = true), [])

  const start = async () => {
    if (running) return
    const c = cfgRef.current
    stopRef.current = false
    setRunning(true)
    let profit = 0
    let done = 0
    setLeft(c.count || null)
    while (!stopRef.current && (c.count === 0 || done < c.count)) {
      const net = await roundRef.current()
      if (net == null) break
      done++
      profit += net
      if (c.count) setLeft(c.count - done)
      if (c.stopProfit > 0 && profit >= c.stopProfit) break
      if (c.stopLoss > 0 && -profit >= c.stopLoss) break
      if (!stopRef.current) await sleep(delay)
    }
    setRunning(false)
    setLeft(null)
  }
  const stop = () => void (stopRef.current = true)
  return { running, left, cfg, setCfg, start, stop }
}

export function AutoSettings({ auto, stops = true }: { auto: ReturnType<typeof useAutoBet>; stops?: boolean }) {
  const { cfg, setCfg, running } = auto
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label right={auto.left != null ? `${auto.left} left` : undefined}>Number of bets</Label>
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <NumberField value={cfg.count} digits={0} min={0} max={10000} disabled={running} onCommit={(v) => setCfg({ ...cfg, count: Math.round(v) })} suffix={cfg.count === 0 ? '∞' : undefined} />
          <div className="grid grid-cols-3 gap-1">
            {[10, 50, 0].map((n) => (
              <button
                key={n}
                disabled={running}
                onClick={() => setCfg({ ...cfg, count: n })}
                className={`h-12 min-w-10 rounded-lg px-2 text-[13px] font-bold transition disabled:opacity-50 ${cfg.count === n ? 'bg-hover text-ink' : 'bg-raised text-muted hover:text-ink'}`}
              >
                {n === 0 ? '∞' : n}
              </button>
            ))}
          </div>
        </div>
      </div>
      {stops && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Stop on profit" value={cfg.stopProfit} min={0} max={1e7} disabled={running} onCommit={(v) => setCfg({ ...cfg, stopProfit: v })} suffix={<Coin size={14} />} />
          <NumberField label="Stop on loss" value={cfg.stopLoss} min={0} max={1e7} disabled={running} onCommit={(v) => setCfg({ ...cfg, stopLoss: v })} suffix={<Coin size={14} />} />
        </div>
      )}
    </div>
  )
}
