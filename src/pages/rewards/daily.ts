/*
  The daily bonus's state at a moment, in one small module of its own: the Rewards page and the lobby's daily card
  both show it, and the lobby ships in the main bundle, so this needs nothing but the wallet's constants (importing
  the rest of ./rewards would drag the page into the lobby).

  The rules (from the wallet): a bonus opens DAILY_COOLDOWN after each claim, each day in a row pays more up to day
  7, and going DAILY_STREAK_RESET without a claim starts the streak again at day 1.
*/
import { DAILY_COOLDOWN, DAILY_STREAK_RESET } from '../../store/wallet'

/** The daily bonus now: ready or not, whether the streak is alive, the day it would pay, ms until the next one. */
export function dailyState(dailyLast: number, dailyStreak: number, now: number) {
  const ready = now - dailyLast >= DAILY_COOLDOWN
  const alive = dailyLast > 0 && now - dailyLast < DAILY_STREAK_RESET
  const day = ready ? (alive ? Math.min(dailyStreak + 1, 7) : 1) : dailyStreak
  return { ready, alive, day, streak: alive ? dailyStreak : 0, left: DAILY_COOLDOWN - (now - dailyLast) }
}
