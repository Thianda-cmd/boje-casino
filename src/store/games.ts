export type GameId = 'chicken' | 'kaiju' | 'showtime' | 'darts' | 'market' | 'deal' | 'pot' | 'summit' | 'crash' | 'double' | 'mines' | 'plinko' | 'dice' | 'limbo' | 'keno' | 'hilo' | 'wheel' | 'cases' | 'battles' | 'derby' | 'claw' | 'penalty' | 'scratch' | 'coinflip' | 'reef' | 'lines' | 'sicbo' | 'craps' | 'holdem' | 'plunder' | 'chompers' | 'popparty' | 'roboriot' | 'blackjack' | 'livebj' | 'baccarat' | 'roulette' | 'videopoker'

export type Category = 'originals' | 'slots' | 'table'

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
  { id: 'kaiju', name: 'Kaiju Clash', category: 'originals', tagline: 'A live monster fight night: back a kaiju, call the KO, the Splash into the bay or the round, and watch the city fall.', accent: '#ff3b6b', tag: 'live' },
  { id: 'showtime', name: 'Showtime', category: 'originals', tagline: 'A live game-show money wheel: everyone bets the same spin, with a Booster and four bonus rounds up to 20,000×.', accent: '#ff4d61', tag: 'live' },
  { id: 'darts', name: 'Bullseye', category: 'originals', tagline: 'Three darts at the board. Pick your target and your thrower; the total pays, up to 10,000× for a big finish.', accent: '#e8344e', tag: 'new' },
  { id: 'market', name: 'Market Rush', category: 'originals', tagline: 'A live price chart. Go Up or Down with up to 100× leverage and cash out before you are liquidated.', accent: '#00d1a0', tag: 'new' },
  { id: 'deal', name: "Banker's Deal", category: 'originals', tagline: 'Sixteen briefcases and a Banker on the phone. Take his offer, or play on for a case worth up to 250×.', accent: '#f2b134', tag: 'new' },
  { id: 'pot', name: 'Pot Luck', category: 'originals', tagline: 'Everyone pays into one pot; your share is your chance. Winner takes it all.', accent: '#a855f7', tag: 'live' },
  { id: 'summit', name: 'Summit', category: 'originals', tagline: 'Climb the mountain pitch by pitch: the safe Trail or the Sheer Wall, your call every time. Bank at any camp.', accent: '#38bdf8', tag: 'new' },
  { id: 'chicken', name: 'Chicken Road', category: 'originals', tagline: 'Cross lane by lane, cash out before the traffic gets you.', accent: '#f7a440', tag: 'hot' },
  { id: 'crash', name: 'Crash', category: 'originals', tagline: 'Everyone rides the same rocket. Cash out before it blows.', accent: '#9b7bff', tag: 'live' },
  { id: 'double', name: 'Double', category: 'originals', tagline: 'Red, black or green. One strip, and everyone bets the same spin.', accent: '#ef3e5c', tag: 'live' },
  { id: 'coinflip', name: 'Coin Flip', category: 'originals', tagline: 'Heads or tails. Win, then double it or walk away.', accent: '#f7c548', tag: 'new' },
  { id: 'reef', name: 'Reef Raid', category: 'originals', tagline: 'Fire bubble torpedoes at the reef. Every creature you net pays its multiplier, up to the 200× Golden Whale.', accent: '#22c7d8', tag: 'new' },
  { id: 'lines', name: 'Lucky Lines', category: 'slots', tagline: 'A bingo card and five reels. Mark your numbers, place your jokers and climb the ladder to 500×.', accent: '#8b5cf6', tag: 'new' },
  { id: 'mines', name: 'Mines', category: 'originals', tagline: 'Find gems, dodge mines, push your luck tile by tile.', accent: '#22d36f' },
  { id: 'plinko', name: 'Plinko', category: 'originals', tagline: 'Drop the ball through the pegs. Edges pay up to 1,000×.', accent: '#ff5fa2' },
  { id: 'dice', name: 'Dice', category: 'originals', tagline: 'Pick your odds, roll over or under.', accent: '#4cb4ff' },
  { id: 'limbo', name: 'Limbo', category: 'originals', tagline: 'Set a target multiplier and hope the number clears it.', accent: '#ffb02e' },
  { id: 'keno', name: 'Keno', category: 'originals', tagline: 'Pick up to 10 numbers, ten are drawn.', accent: '#a46bff' },
  { id: 'hilo', name: 'Hi-Lo', category: 'originals', tagline: 'Higher or lower? Chain your calls.', accent: '#2fd6c3' },
  { id: 'wheel', name: 'Wheel', category: 'originals', tagline: 'Spin the wheel, pick your risk.', accent: '#ff7a45' },
  { id: 'cases', name: 'Cases', category: 'originals', tagline: 'Pick a crate and watch the loot reel glide to your prize.', accent: '#ffb547' },
  { id: 'battles', name: 'Case Battles', category: 'originals', tagline: 'Open crates head to head. The biggest haul takes the whole pot.', accent: '#ff7a3d', tag: 'live' },
  { id: 'derby', name: 'Duck Derby', category: 'originals', tagline: 'Six rubber ducks, one wild river. Back a duck and cheer it home.', accent: '#ffd23f' },
  { id: 'claw', name: 'Lucky Claw', category: 'originals', tagline: 'Pick a plushie, drop the claw, and hope it holds on.', accent: '#ff6f91' },
  { id: 'penalty', name: 'Penalty Shootout', category: 'originals', tagline: 'Pick your corner, beat the keeper, and cash out before he guesses right.', accent: '#3ddc84' },
  { id: 'scratch', name: 'Scratch & Win', category: 'originals', tagline: 'Four lucky cards. Scratch the foil and match three to win.', accent: '#f5c542' },
  { id: 'plunder', name: 'Plunder Bay', category: 'slots', tagline: 'Pirate Megaways: up to 117,649 ways, cascades and a multiplier that never stops climbing.', accent: '#2fb7c9', tag: 'new' },
  { id: 'chompers', name: 'Chompers', category: 'slots', tagline: 'Cartoon monsters chomp every donut on the reels.', accent: '#2ee87f' },
  { id: 'popparty', name: 'Pop Party', category: 'slots', tagline: 'Balloon animals pop on a light-up floor; every pop lights a multiplier.', accent: '#ff4fb8' },
  { id: 'roboriot', name: 'Robo Riot', category: 'slots', tagline: 'Toy robots charge the Power Grid: magnets, zappers and boosters stack the cells.', accent: '#5cf2ff' },
  { id: 'blackjack', name: 'Blackjack', category: 'table', tagline: 'Six decks, dealer stands on soft 17, blackjack pays 3 to 2.', accent: '#4f8bff' },
  { id: 'livebj', name: 'Live Blackjack', category: 'table', tagline: 'Real players, one shoe. Pull up a seat at a shared table.', accent: '#f2a93b', tag: 'live' },
  { id: 'baccarat', name: 'Baccarat', category: 'table', tagline: 'Player, Banker or Tie. Squeeze the cards, follow the road.', accent: '#e8c46a' },
  { id: 'sicbo', name: 'Sic Bo', category: 'table', tagline: 'Three dice under the dome. Lucky multipliers strike the table every roll, up to 1,000 to 1.', accent: '#e0434f', tag: 'new' },
  { id: 'craps', name: 'Craps', category: 'table', tagline: 'Roll the bones down the felt. Pass Line, odds, place bets, hardways and the Fire Bet.', accent: '#17a673', tag: 'new' },
  { id: 'holdem', name: "Hold'em Showdown", category: 'table', tagline: 'Heads-up Texas Hold\u2019em against the dealer. Raise 4× on a monster, or fold and live to fight again.', accent: '#3b82f6', tag: 'new' },
  { id: 'roulette', name: 'Roulette', category: 'table', tagline: 'European single zero. Red, black, or your lucky number.', accent: '#ff4d61' },
  { id: 'videopoker', name: 'Video Poker', category: 'table', tagline: 'Jacks or Better. Hold, draw, chase the royal flush.', accent: '#2fb8ff' },
]

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'originals', name: 'Originals' },
  { id: 'slots', name: 'Slots' },
  { id: 'table', name: 'Table games' },
]

export const gameById = (id: GameId) => GAMES.find((g) => g.id === id)!

/** Games that have been taken out; old bet records still name them. */
const RETIRED: Record<string, string> = { slots: 'Gem Slots' }

/** Info for any id found in stored records: a live game, or a retired one that can no longer be opened. */
export function gameInfo(id: string): GameInfo & { retired?: boolean } {
  return GAMES.find((g) => g.id === id) ?? { id: id as GameId, name: RETIRED[id] ?? 'Retired game', category: 'originals', tagline: '', accent: '#6f7f95', retired: true }
}
