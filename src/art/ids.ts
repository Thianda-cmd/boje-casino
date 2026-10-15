import { useId } from 'react'

/** A unique, CSS-safe id prefix for gradients and filters inside one SVG. */
export function useUid() {
  return 'u' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
}
