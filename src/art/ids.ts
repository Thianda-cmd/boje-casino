import { useId } from 'react'

/** A unique, CSS-safe id prefix for gradients and filters inside one SVG. The trailing underscore keeps prefixes from
 *  running into each other: React's ids count in base 32, so without it one prefix plus 'sg' could equal another plus 'g'. */
export function useUid() {
  return 'u' + useId().replace(/[^a-zA-Z0-9_-]/g, '') + '_'
}
