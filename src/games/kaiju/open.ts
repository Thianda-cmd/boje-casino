/*
  Whether a player has Kaiju Clash stakes waiting to settle, read straight from the ledger's keys (ledger.ts keeps one
  per open round under this prefix). It is its own small module so App.tsx can ask on every tick without loading the
  rules and the fight script; the background settler loads those only when there is something to settle.
*/

export const OPEN_PREFIX = 'lumen.kaiju.p.'

export function hasKaijuStakes(who: string): boolean {
  const prefix = `${OPEN_PREFIX}${who}.`
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(prefix)) return true
  } catch {
    /* storage blocked: the page settles its own */
  }
  return false
}
