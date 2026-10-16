export type GameId = 'chicken' | 'crash' | 'mines' | 'plinko' | 'dice' | 'limbo' | 'keno' | 'hilo' | 'wheel' | 'slots' | 'chompers' | 'popparty' | 'blackjack' | 'livebj' | 'roulette' | 'videopoker'

export type Category = 'originals' | 'table'

export interface GameInfo {
  id: GameId
  name: string
  category: Category
  /** one line for the lobby hover and search */
  tagline: string
  accent: string
  tag?: 'new' | 'live' | 'hot'
}

export const GAMES: GameInfo[] = [
  { id: 'chicken', name: 'Chicken Road', category: 'originals', tagline: 'Cross lane by lane, cash out before the traffic gets you.', accent: '#f7a440', tag: 'hot' },
  { id: 'crash', name: 'Crash', category: 'originals', tagline: 'Everyone rides the same rocket. Cash out before it blows.', accent: '#9b7bff', tag: 'live' },
  { id: 'mines', name: 'Mines', category: 'originals', tagline: 'Find gems, dodge mines, push your luck tile by tile.', accent: '#22d36f' },
  { id: 'plinko', name: 'Plinko', category: 'originals', tagline: 'Drop the ball through the pegs. Edges pay up to 1,000×.', accent: '#ff5fa2' },
  { id: 'dice', name: 'Dice', category: 'originals', tagline: 'Pick your odds, roll over or under.', accent: '#4cb4ff' },
  { id: 'limbo', name: 'Limbo', category: 'originals', tagline: 'Set a target multiplier and hope the number clears it.', accent: '#ffb02e' },
  { id: 'keno', name: 'Keno', category: 'originals', tagline: 'Pick up to 10 numbers, ten are drawn.', accent: '#a46bff' },
  { id: 'hilo', name: 'Hi-Lo', category: 'originals', tagline: 'Higher or lower? Chain your calls.', accent: '#2fd6c3' },
  { id: 'wheel', name: 'Wheel', category: 'originals', tagline: 'Spin the wheel, pick your risk.', accent: '#ff7a45' },
  { id: 'slots', name: 'Slots', category: 'originals', tagline: 'Gems pay anywhere, tumble, and multiply in free spins.', accent: '#e05cff', tag: 'new' },
  { id: 'chompers', name: 'Chompers', category: 'originals', tagline: 'Cartoon monsters chomp every donut on the reels.', accent: '#2ee87f', tag: 'new' },
  { id: 'popparty', name: 'Pop Party', category: 'originals', tagline: 'Balloon animals pop on a light-up floor; every pop lights a multiplier.', accent: '#ff4fb8', tag: 'new' },
  { id: 'blackjack', name: 'Blackjack', category: 'table', tagline: 'Six decks, dealer stands on soft 17, blackjack pays 3 to 2.', accent: '#4f8bff' },
  { id: 'livebj', name: 'Live Blackjack', category: 'table', tagline: 'Real players, one shoe. Pull up a seat at a shared table.', accent: '#f2a93b', tag: 'live' },
  { id: 'roulette', name: 'Roulette', category: 'table', tagline: 'European single zero. Red, black, or your lucky number.', accent: '#ff4d61' },
  { id: 'videopoker', name: 'Video Poker', category: 'table', tagline: 'Jacks or Better. Hold, draw, chase the royal flush.', accent: '#2fb8ff', tag: 'new' },
]

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'originals', name: 'Originals' },
  { id: 'table', name: 'Table games' },
]

export const gameById = (id: GameId) => GAMES.find((g) => g.id === id)!
