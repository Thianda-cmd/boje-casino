import type { SVGProps } from 'react'

/* Casino Tycoon's line icon (the nav, the reward history, the finder): a little casino with a marquee sign over its
   roof, a star on top and an arched door, drawn in the stroke style of the site's other icons. */

export function TycoonIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <path d="M4.5 21V11.5h15V21M3 11.5h18" />
      <rect x="7" y="6" width="10" height="5.5" rx="1.2" />
      <path d="m12 1.6.75 1.5 1.65.25-1.2 1.15.3 1.6L12 5.3l-1.5.8.3-1.6-1.2-1.15 1.65-.25Z" strokeWidth={1.4} />
      <path d="M10 21v-3.2a2 2 0 0 1 4 0V21M7.5 15h1.2M15.3 15h1.2" />
    </svg>
  )
}
