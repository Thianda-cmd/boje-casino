import { useLayoutEffect, useRef, useState } from 'react'

/** Tracks an element's content size. */
export function useSize<T extends HTMLElement>(initial = { w: 800, h: 600 }) {
  const ref = useRef<T>(null)
  const [size, setSize] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}
