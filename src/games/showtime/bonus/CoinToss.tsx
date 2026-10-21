import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { MAX_WIN, type CoinToss as CoinTossRound } from '../rules'
import { fmtX } from '../words'
import { showtimeSfx } from '../sound'
import { BonusShell, ResultPlate, shownX } from './kit'

/*
  Coin Toss: a coin with a multiplier on each face (gold heads, blue tails). The faces are shown, boosted if the
  Booster lit the round, the coin goes up turning over and over, and the face that lands up pays.
*/

type Step = 'faces' | 'boost' | 'toss' | 'landed' | 'done'

export function CoinTossShow({ round, boost, stake, win, onDone }: { round: CoinTossRound; boost: number; stake: number; win: number; onDone: () => void }) {
  const [step, setStep] = useState<Step>('faces')
  const boosted = boost > 1
  const [faces, setFaces] = useState<[number, number]>(round.faces)
  useEffect(() => {
    const t: number[] = []
    const at = (ms: number, f: () => void) => t.push(window.setTimeout(f, ms))
    showtimeSfx.bonusIn()
    let ms = 1400
    if (boosted) {
      at(ms, () => {
        setStep('boost')
        setFaces([shownX(round.faces[0], boost), shownX(round.faces[1], boost)])
        showtimeSfx.boost(boost)
      })
      ms += 1300
    }
    at(ms, () => {
      setStep('toss')
      showtimeSfx.toss()
    })
    at(ms + 2300, () => {
      setStep('landed')
      showtimeSfx.coinLand()
      showtimeSfx.reveal(win)
    })
    at(ms + 3000, () => setStep('done'))
    at(ms + 5000, onDone)
    return () => t.forEach(clearTimeout)
    // the show runs once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const tossed = step === 'landed' || step === 'done'
  // eight and a half turns, or eight for heads; rotateX 0 shows heads, 180 tails
  const turns = 360 * 8 + (round.up ? 180 : 0)
  return (
    <BonusShell spot="coin" boost={boost} stake={stake} bg="radial-gradient(ellipse at 50% 30%, #4a2410 0%, #1d0e22 60%, #0d0a1c 100%)">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 pb-8 pt-14 sm:gap-6">
        <div className="flex w-full max-w-[560px] items-stretch justify-center gap-3 sm:gap-6">
          {[0, 1].map((i) => {
            const lit = tossed && round.up === i
            const out = tossed && round.up !== i
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: out ? 0.35 : 1, y: 0, scale: lit ? 1.08 : 1 }}
                transition={{ delay: 0.25 + i * 0.12, type: 'spring', stiffness: 300, damping: 22 }}
                className="relative flex flex-1 flex-col items-center gap-1 rounded-2xl px-3 py-3 ring-2 sm:py-4"
                style={{
                  background: i ? 'linear-gradient(180deg,#1e4f9a,#122a5a)' : 'linear-gradient(180deg,#9a6a12,#5a3a08)',
                  boxShadow: lit ? `0 0 40px -6px ${i ? '#4cb4ff' : '#f7c548'}` : undefined,
                  borderColor: 'transparent',
                  outline: lit ? `3px solid ${i ? '#4cb4ff' : '#f7c548'}` : undefined,
                }}
              >
                <span className="text-[12px] font-black uppercase tracking-[.2em] text-white/75">{i ? 'Tails' : 'Heads'}</span>
                <motion.span key={faces[i]} initial={step === 'boost' ? { scale: 1.6, color: '#fff' } : false} animate={{ scale: 1 }} className="tnum text-[32px] font-black leading-none text-white sm:text-[44px]">
                  {fmtX(faces[i])}
                </motion.span>
              </motion.div>
            )
          })}
        </div>
        {/* the coin */}
        <div className="relative h-[140px] w-[140px] [perspective:800px] sm:h-[170px] sm:w-[170px]">
          <motion.div
            className="absolute inset-0 [transform-style:preserve-3d]"
            initial={{ rotateX: 0, y: 0 }}
            animate={step === 'toss' || tossed ? { rotateX: turns, y: [0, -150, -170, 0], scale: [1, 0.8, 0.8, 1] } : { rotateX: 0, y: 0 }}
            transition={{ rotateX: { duration: 2.2, ease: [0.2, 0.6, 0.3, 1] }, y: { duration: 2.2, times: [0, 0.45, 0.55, 1], ease: 'easeInOut' }, scale: { duration: 2.2, times: [0, 0.45, 0.55, 1] } }}
          >
            <CoinFace side={0} value={faces[0]} />
            <CoinFace side={1} value={faces[1]} />
          </motion.div>
          <div className="absolute -bottom-6 left-1/2 h-4 w-28 -translate-x-1/2 rounded-full bg-black/50 blur-md" />
        </div>
        <div className="h-5 text-center text-[13px] font-bold text-white/70">
          {step === 'faces' && 'A prize on each face'}
          {step === 'boost' && `The Booster multiplies both faces ×${boost}`}
          {step === 'toss' && 'Up it goes…'}
          {tossed && `${round.up ? 'Tails' : 'Heads'}!`}
        </div>
      </div>
      {step === 'done' && <ResultPlate x={win} capped={win >= MAX_WIN} color={round.up ? '#4cb4ff' : '#f7c548'} />}
    </BonusShell>
  )
}

function CoinFace({ side, value }: { side: 0 | 1; value: number }) {
  const gold = side === 0
  return (
    <div
      className="absolute inset-0 flex items-center justify-center rounded-full [backface-visibility:hidden]"
      style={{
        transform: side ? 'rotateX(180deg)' : undefined,
        background: gold ? 'radial-gradient(circle at 35% 30%, #fff3b0, #f7c548 45%, #b9741a 100%)' : 'radial-gradient(circle at 35% 30%, #d6efff, #4cb4ff 45%, #1d5aa8 100%)',
        boxShadow: `inset 0 0 0 7px ${gold ? '#c98d14' : '#2a6fc0'}, inset 0 0 0 11px ${gold ? '#ffe28a' : '#9fd6ff'}, 0 18px 40px -12px rgba(0,0,0,.8)`,
      }}
    >
      <span className="tnum text-[30px] font-black sm:text-[36px]" style={{ color: gold ? '#6b3f05' : '#0e2f66' }}>
        {fmtX(value)}
      </span>
    </div>
  )
}
