import { GAMES } from '../store/games'
import { navigate } from '../lib/router'
import { IconCheck, Logo } from './icons'

/* The foot of every page: what the site is, where things are, and the play-money promise. */

const COLUMNS: [string, [string, string][]][] = [
  [
    'Casino',
    [
      ['/', 'Lobby'],
      ['/rewards', 'Rewards'],
      ['/history', 'My bets'],
      ['/players', 'Players'],
      ['/account', 'Account'],
    ],
  ],
  [
    'Free coins',
    [
      ['/rewards', 'Daily bonus'],
      ['/heist', 'Vault Heist'],
      ['/tycoon', 'Casino Tycoon'],
    ],
  ],
  [
    'Popular',
    [
      ['/game/chicken', 'Chicken Road'],
      ['/game/crash', 'Crash'],
      ['/game/plinko', 'Plinko'],
      ['/game/livebj', 'Live Blackjack'],
    ],
  ],
]

export function Footer() {
  return (
    <footer className="mt-14 border-t border-line pb-4 pt-8">
      <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-[1.9fr_1fr_1fr_1fr] sm:gap-x-6">
        <div className="col-span-3 sm:col-span-1">
          <button onClick={() => navigate('/')} aria-label="Lobby">
            <Logo />
          </button>
          <p className="mt-3 max-w-[340px] text-[13px] leading-relaxed text-muted">
            {GAMES.length} games, a daily bonus and free coins to play them with. Everything here runs on play money, just for fun.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {['Play money only', 'Nothing to buy', 'Free to play'].map((x) => (
              <span key={x} className="flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-[11.5px] font-bold text-muted">
                <IconCheck size={12} className="text-accent" strokeWidth={3} /> {x}
              </span>
            ))}
          </div>
        </div>
        {COLUMNS.map(([title, links]) => (
          <nav key={title} className="flex flex-col items-start gap-2">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-dim">{title}</div>
            {links.map(([to, name]) => (
              <button key={name} onClick={() => navigate(to)} className="text-left text-[13.5px] font-semibold text-muted transition hover:text-ink">
                {name}
              </button>
            ))}
          </nav>
        ))}
      </div>
      <div className="mt-8 flex flex-col gap-1.5 border-t border-line pt-4 text-[12px] text-dim sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} Boje Casino</span>
        <span className="text-pretty">Coins have no cash value and can't be bought, sold or withdrawn. Take a break whenever you like.</span>
      </div>
    </footer>
  )
}
