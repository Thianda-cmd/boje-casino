import { useEffect } from 'react'

/*
  The boot screen in index.html (the faceted gem) stays up until the first page has really mounted, so a game that
  loads lazily never shows a second loader beside it, and for at least a moment, so it never just flickers.
*/

const MIN_MS = 700
let done = false

export function bootDone() {
  if (done) return
  done = true
  const boot = document.getElementById('boot')
  if (!boot) return
  setTimeout(
    () => {
      boot.classList.add('gone')
      setTimeout(() => boot.remove(), 450)
    },
    Math.max(0, MIN_MS - performance.now()),
  )
}

/** whether the boot screen is still on the page (showing or fading out) */
export const booting = () => !!document.getElementById('boot')

/** Rendered next to a page: its first commit means the page is on screen, so the boot screen can go. */
export function BootDone() {
  useEffect(bootDone, [])
  return null
}
