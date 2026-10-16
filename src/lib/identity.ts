import { rand } from './rng'
import { safeStorage } from './storage'

/* Who a guest is in the multiplayer games (Crash, Live Blackjack): a random id kept on this device,
   a display name they can change and an avatar picked from the id. Signed-in players are told apart
   by their account on the server instead; the keys keep their old names so nobody gets a new id. */

function stored(key: string, make: () => string, valid: (v: string) => boolean = () => true) {
  const v = safeStorage.getItem(key)
  if (v && valid(v)) return v
  const n = make()
  safeStorage.setItem(key, n)
  return n
}

export const guestId = stored(
  'lumen.crash.gid',
  () => 'g_' + Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join(''),
  (v) => /^g_[a-z0-9]{12,40}$/.test(v),
)
export const defaultName = () => stored('lumen.crash.name', () => `Player${Math.floor(1000 + rand() * 9000)}`)
export const saveName = (n: string) => safeStorage.setItem('lumen.crash.name', n)

/** A stable avatar for a guest: FNV-1a of the id, one of the 16 designs. */
export function guestAvatar(id = guestId) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 16
}
