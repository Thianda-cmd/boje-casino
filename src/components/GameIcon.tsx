import type { GameId } from '../store/games'

// Small 20px monochrome icons for navigation.
export function GameIcon({ id, size = 20 }: { id: GameId; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    case 'chicken':
      return (
        <svg {...p}>
          <path d="M15 4c0-1.5 2-2 2.5-.5C19 3 20 4.5 18.5 5.5" />
          <path d="M18 7l3 1-3 1" />
          <path d="M18 9.5c0 5-3 9.5-8 9.5S3 16 3 12.5c3 1 5-1 6-3 1.5-3 3.5-5 6-5 1.7 0 3 1.3 3 3Z" />
          <path d="M9 19v2M13 19v2" />
        </svg>
      )
    case 'blackjack':
      return (
        <svg {...p}>
          <rect x="3" y="5" width="11" height="15" rx="2" />
          <path d="M14 7.5 18.5 6a2 2 0 0 1 2.4 1.3l2 7a2 2 0 0 1-1.3 2.4L16 18.5" />
          <path d="M8.5 10.5c-1-1.3-3 0-1.8 1.6L8.5 14l1.8-1.9c1.2-1.6-.8-2.9-1.8-1.6Z" />
        </svg>
      )
    case 'mines':
      return (
        <svg {...p}>
          <path d="M7 4h10l4 5-9 11L3 9Z" />
          <path d="M3 9h18M9 4l3 16 3-16" />
        </svg>
      )
    case 'plinko':
      return (
        <svg {...p}>
          <circle cx="12" cy="4" r="1.2" fill="currentColor" />
          <circle cx="8.5" cy="9" r="1.2" fill="currentColor" />
          <circle cx="15.5" cy="9" r="1.2" fill="currentColor" />
          <circle cx="5" cy="14" r="1.2" fill="currentColor" />
          <circle cx="12" cy="14" r="1.2" fill="currentColor" />
          <circle cx="19" cy="14" r="1.2" fill="currentColor" />
          <path d="M3 20h18" />
        </svg>
      )
    case 'dice':
      return (
        <svg {...p}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
          <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'limbo':
      return (
        <svg {...p}>
          <path d="m6 12 6-6 6 6" />
          <path d="m6 19 6-6 6 6" />
        </svg>
      )
    case 'keno':
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="3.4" />
          <circle cx="16" cy="8" r="3.4" />
          <circle cx="8" cy="16" r="3.4" />
          <circle cx="16" cy="16" r="3.4" fill="currentColor" />
        </svg>
      )
    case 'hilo':
      return (
        <svg {...p}>
          <path d="M8 20V4M4.5 7.5 8 4l3.5 3.5" />
          <path d="M16 4v16M12.5 16.5 16 20l3.5-3.5" />
        </svg>
      )
    case 'wheel':
      return (
        <svg {...p}>
          <circle cx="12" cy="13" r="8.5" />
          <path d="M12 4.5v17M3.5 13h17M6 7l12 12M18 7 6 19" opacity=".55" />
          <circle cx="12" cy="13" r="2" fill="currentColor" />
          <path d="m10 1.8 2 2.6 2-2.6Z" fill="currentColor" />
        </svg>
      )
    case 'chompers':
      return (
        <svg {...p}>
          <path d="M7 7.6 5.6 3.8 9.4 5.6M17 7.6l1.4-3.8-3.8 1.8" />
          <path d="M4 13.5a8 8 0 0 1 16 0V17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z" />
          <circle cx="9.3" cy="11" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="14.7" cy="11" r="1.3" fill="currentColor" stroke="none" />
          <path d="M7.5 15h9M9 15l1 1.6 1-1.6 1 1.6 1-1.6 1 1.6 1-1.6" />
        </svg>
      )
    case 'cases':
      return (
        <svg {...p}>
          {/* a crate with its lid lifted and a glint of loot rising out */}
          <path d="M4 12.5h16v6.3a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.8Z" />
          <rect x="2.8" y="7.6" width="18.4" height="3.2" rx="1.1" />
          <path d="M12 12.5v3.2M7.5 15.5v2M16.5 15.5v2" />
          <path d="M12 1.5l.65 1.45L14.1 3.6l-1.45.65L12 5.7l-.65-1.45L9.9 3.6l1.45-.65Z" fill="currentColor" strokeWidth="1" />
        </svg>
      )
    case 'baccarat':
      return (
        <svg {...p}>
          {/* a card face up and one being squeezed, its corner peeled back */}
          <rect x="2" y="4.5" width="9" height="14" rx="1.8" />
          <path d="M6.5 9.2 8.4 11.5 6.5 13.8 4.6 11.5Z" fill="currentColor" stroke="none" />
          <path d="M17 18.5h2.7a1.8 1.8 0 0 0 1.8-1.8V6.3a1.8 1.8 0 0 0-1.8-1.8h-5.4a1.8 1.8 0 0 0-1.8 1.8V14Z" />
          <path d="M13 14h4v4.5Z" fill="currentColor" fillOpacity=".35" />
        </svg>
      )
    case 'roboriot':
      return (
        <svg {...p}>
          <path d="M12 2.5v3" />
          <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
          <rect x="4" y="6" width="16" height="12" rx="4" />
          <circle cx="9" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <path d="M2 10.5v3M22 10.5v3M9 21h6" />
        </svg>
      )
    case 'popparty':
      return (
        <svg {...p}>
          <path d="M11 3c-3.6 0-6.2 2.8-6.2 6.4 0 3.9 3.1 6.9 6.2 7.7 3.1-.8 6.2-3.8 6.2-7.7C17.2 5.8 14.6 3 11 3Z" />
          <path d="M10 17.2l1 1.6 1-1.6" />
          <path d="M11 18.8c-1.2.9 1.2 1.6 0 2.7" />
          <path d="M8.2 6.6c-.9.7-1.4 1.7-1.5 2.8" opacity=".6" />
          <path d="M19.5 2.8v3.4M17.8 4.5h3.4" />
        </svg>
      )
    case 'livebj':
      return (
        <svg {...p}>
          <rect x="2.5" y="6" width="10" height="14" rx="1.8" transform="rotate(-8 7.5 13)" />
          <rect x="9" y="5" width="10" height="14" rx="1.8" transform="rotate(6 14 12)" />
          <circle cx="20" cy="4.5" r="2.2" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'videopoker':
      return (
        <svg {...p}>
          <rect x="3.5" y="6" width="10" height="14" rx="1.8" transform="rotate(-9 8.5 13)" />
          <rect x="10.5" y="4" width="10" height="14" rx="1.8" transform="rotate(7 15.5 11)" />
          <path d="M13.6 8.6l1.2 1.6 1.4-2 1.4 2 1.2-1.6-.5 3.6h-4.2z" fill="currentColor" stroke="none" transform="rotate(7 15.5 11)" />
        </svg>
      )
    case 'roulette':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 3v4.8M12 16.2V21M3 12h4.8M16.2 12H21" opacity=".55" />
          <circle cx="16.6" cy="6.8" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'crash':
      return (
        <svg {...p}>
          <path d="M3 20c7 0 11-3 15-13" />
          <path d="M14 6l4.5 1 1-4.5" />
          <path d="M3 3v17h18" opacity=".45" />
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <rect x="2.5" y="5" width="15" height="14" rx="2.5" />
          <path d="M5.5 9.5h9v5h-9z" />
          <path d="M10 9.5v5" opacity=".55" />
          <path d="M17.5 12H20V6.5" />
          <circle cx="20" cy="5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      )
  }
}
