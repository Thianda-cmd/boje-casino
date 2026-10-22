import { levelFromXp, tierIndexOf } from './levels'

/*
  Cosmetics and achievements: what a player can wear on their profile and what they have earned.

  A player's look has seven parts: their avatar (one of AVATAR_COUNT designs; the first 16 are free), a frame round
  it, an aura (an animated effect round the framed avatar), a banner behind their profile, a backdrop (an animated
  scene behind their whole profile page), the colour of their name, and a title under it, plus up to three badges in
  their showcase. Each cosmetic is free (every player has it), unlocked by progress (a level, a VIP tier, a challenge,
  an achievement), bought in the shop with coins, or found in a crate (CRATES: a crate drops one cosmetic its owner
  doesn't have yet; the crate-only ones, most of them Mythic, can't be had any other way). Bought and dropped items
  are kept in the wallet's `owned` list; unlocks are worked out from the wallet whenever they are needed, so they can
  never be lost.

  Achievements are badges earned by playing: milestones (rounds, coins wagered, the biggest win), VIP tiers, the daily
  streak, Vault Heist, and one for every challenge completed. They are worked out from a few wallet fields
  (`AchievementSource`), which a public profile also carries, so anyone's badges can be shown the same way.

  The ids here are part of the stored data and the server's whitelist (api/_lib/schema.js): never rename one.

  The wallet imports this module (it checks purchases against the catalog), so this one never imports the wallet:
  the levels come from src/store/levels.ts, and the wallet hands over its challenges (setChallenges) as it loads.
  The challenge badges are made the first time they are asked for.
*/

/** the challenges, as the wallet defines them: only what the badges need */
interface ChallengeInfo {
  id: string
  game?: string
  title: string
  desc: string
  reward: number
}
let challenges: readonly ChallengeInfo[] = []
let all: { list: readonly Achievement[]; byId: Map<string, Achievement> } | null = null
export function setChallenges(list: readonly ChallengeInfo[]) {
  challenges = list
  all = null
}

export type CosmeticKind = 'avatar' | 'frame' | 'aura' | 'banner' | 'backdrop' | 'nameColor' | 'title'
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

/** what unlocks a cosmetic without buying it */
export interface Unlock {
  level?: number
  /** a VIP tier index (0 Bronze … 4 Diamond) */
  tier?: number
  /** a challenge id, once claimed */
  challenge?: string
  /** an achievement id */
  achievement?: string
  /** found only in this crate (CRATES): never unlocked by progress, only owned once dropped */
  crate?: string
}

export interface Cosmetic {
  id: string
  kind: CosmeticKind
  name: string
  /** one line for the shop and the tooltip */
  line: string
  rarity: Rarity
  /** coins in the shop; absent: not for sale (free, or earned only) */
  price?: number
  /** how it is earned (absent with no price: free for everyone) */
  unlock?: Unlock
}

export const AVATAR_COUNT = 32
/** avatars every player has */
export const FREE_AVATARS = 16

const avatars: Cosmetic[] = [
  ...Array.from({ length: FREE_AVATARS }, (_, i): Cosmetic => ({ id: `avatar:${i}`, kind: 'avatar', name: `Avatar ${i + 1}`, line: 'A classic', rarity: 'common' })),
  { id: 'avatar:16', kind: 'avatar', name: 'Clover', line: 'Reach level 3', rarity: 'common', unlock: { level: 3 } },
  { id: 'avatar:17', kind: 'avatar', name: 'Horseshoe', line: 'Reach level 6', rarity: 'common', unlock: { level: 6 } },
  { id: 'avatar:18', kind: 'avatar', name: 'Lucky Seven', line: 'Reach level 10', rarity: 'rare', unlock: { level: 10 } },
  { id: 'avatar:19', kind: 'avatar', name: 'Golden Dice', line: 'Reach Gold', rarity: 'rare', unlock: { tier: 2 } },
  { id: 'avatar:20', kind: 'avatar', name: 'Platinum Chip', line: 'Reach Platinum', rarity: 'epic', unlock: { tier: 3 } },
  { id: 'avatar:21', kind: 'avatar', name: 'Diamond', line: 'Reach Diamond', rarity: 'legendary', unlock: { tier: 4 } },
  { id: 'avatar:22', kind: 'avatar', name: 'Rocket', line: 'In the shop', rarity: 'common', price: 1500 },
  { id: 'avatar:23', kind: 'avatar', name: 'Pirate', line: 'In the shop', rarity: 'common', price: 1500 },
  { id: 'avatar:24', kind: 'avatar', name: 'Robot', line: 'In the shop', rarity: 'rare', price: 3000 },
  { id: 'avatar:25', kind: 'avatar', name: 'Dragon', line: 'In the shop', rarity: 'rare', price: 4000 },
  { id: 'avatar:26', kind: 'avatar', name: 'Wizard', line: 'In the shop', rarity: 'rare', price: 4000 },
  { id: 'avatar:27', kind: 'avatar', name: 'Ninja', line: 'In the shop', rarity: 'epic', price: 7500 },
  { id: 'avatar:28', kind: 'avatar', name: 'Phoenix', line: 'In the shop', rarity: 'epic', price: 10000 },
  { id: 'avatar:29', kind: 'avatar', name: 'Bullseye', line: 'Score a 180 in Bullseye', rarity: 'epic', unlock: { challenge: 'darts-180' } },
  { id: 'avatar:30', kind: 'avatar', name: 'Golden Whale', line: 'Catch the Golden Whale in Reef Raid', rarity: 'epic', unlock: { challenge: 'reef-whale' } },
  { id: 'avatar:31', kind: 'avatar', name: 'The Banker', line: "Beat the Banker in Banker's Deal", rarity: 'legendary', unlock: { challenge: 'deal-big' } },
]

const frames: Cosmetic[] = [
  { id: 'frame:none', kind: 'frame', name: 'No frame', line: 'Just you', rarity: 'common' },
  { id: 'frame:bronze', kind: 'frame', name: 'Bronze', line: 'Every player starts here', rarity: 'common' },
  { id: 'frame:silver', kind: 'frame', name: 'Silver', line: 'Reach Silver', rarity: 'common', unlock: { tier: 1 } },
  { id: 'frame:gold', kind: 'frame', name: 'Gold', line: 'Reach Gold', rarity: 'rare', unlock: { tier: 2 } },
  { id: 'frame:platinum', kind: 'frame', name: 'Platinum', line: 'Reach Platinum', rarity: 'epic', unlock: { tier: 3 } },
  { id: 'frame:diamond', kind: 'frame', name: 'Diamond', line: 'Reach Diamond', rarity: 'legendary', unlock: { tier: 4 } },
  { id: 'frame:neon', kind: 'frame', name: 'Neon', line: 'A glowing tube of light', rarity: 'rare', price: 2500 },
  { id: 'frame:pixel', kind: 'frame', name: 'Pixel', line: 'Straight out of the arcade', rarity: 'rare', price: 4000 },
  { id: 'frame:flame', kind: 'frame', name: 'Flame', line: 'On a hot streak', rarity: 'epic', price: 6000 },
  { id: 'frame:laurel', kind: 'frame', name: 'Laurel', line: 'A champion’s wreath', rarity: 'epic', price: 9000 },
  { id: 'frame:crown', kind: 'frame', name: 'Crown', line: 'Fit for royalty', rarity: 'legendary', price: 20000 },
  { id: 'frame:holo', kind: 'frame', name: 'Hologram', line: 'Shifts colour as it turns', rarity: 'legendary', price: 30000 },
  { id: 'frame:explorer', kind: 'frame', name: 'Compass', line: 'Complete the Explorer challenge', rarity: 'rare', unlock: { challenge: 'explorer' } },
  { id: 'frame:highroller', kind: 'frame', name: 'High Roller', line: 'Wager 1,000,000 coins', rarity: 'legendary', unlock: { achievement: 'wagered-1m' } },
  { id: 'frame:frost', kind: 'frame', name: 'Frostbite', line: 'Ice that grows as you watch', rarity: 'rare', price: 6000 },
  { id: 'frame:glitch', kind: 'frame', name: 'Glitch', line: 'A frame that can’t quite load', rarity: 'epic', price: 10000 },
  { id: 'frame:plasma', kind: 'frame', name: 'Plasma', line: 'Electric arcs that never sit still', rarity: 'epic', price: 12000 },
  { id: 'frame:orbit', kind: 'frame', name: 'Orbit', line: 'Three moons on tilted rings', rarity: 'epic', price: 14000 },
  { id: 'frame:runes', kind: 'frame', name: 'Arcane', line: 'Rune circles turning both ways', rarity: 'epic', unlock: { crate: 'crate:neon' } },
  { id: 'frame:kaiju', kind: 'frame', name: 'Kaiju', line: 'Call an exact result in Kaiju Clash', rarity: 'epic', unlock: { challenge: 'kaiju-exact' } },
  { id: 'frame:inferno', kind: 'frame', name: 'Inferno', line: 'A ring of roaring fire', rarity: 'legendary', price: 28000 },
  { id: 'frame:storm', kind: 'frame', name: 'Thunderhead', line: 'Storm clouds and forked lightning', rarity: 'legendary', price: 32000 },
  { id: 'frame:liquidgold', kind: 'frame', name: 'Liquid Gold', line: 'Molten gold, still flowing', rarity: 'legendary', price: 40000 },
  { id: 'frame:serpent', kind: 'frame', name: 'Ouroboros', line: 'A dragon chasing its own tail', rarity: 'legendary', unlock: { crate: 'crate:cosmic' } },
  { id: 'frame:blackhole', kind: 'frame', name: 'Event Horizon', line: 'Light bends around you', rarity: 'mythic', unlock: { crate: 'crate:mythic' } },
  { id: 'frame:prism', kind: 'frame', name: 'Prism', line: 'Every colour, refracted', rarity: 'mythic', unlock: { crate: 'crate:mythic' } },
]

const auras: Cosmetic[] = [
  { id: 'aura:none', kind: 'aura', name: 'No aura', line: 'Just the frame', rarity: 'common' },
  { id: 'aura:sparkles', kind: 'aura', name: 'Stardust', line: 'Reach level 8', rarity: 'common', unlock: { level: 8 } },
  { id: 'aura:embers', kind: 'aura', name: 'Embers', line: 'Sparks drifting up', rarity: 'rare', price: 4000 },
  { id: 'aura:bubbles', kind: 'aura', name: 'Bubbles', line: 'Rising from the deep', rarity: 'rare', price: 4000 },
  { id: 'aura:snow', kind: 'aura', name: 'Snowfall', line: 'A quiet flurry', rarity: 'rare', price: 4000 },
  { id: 'aura:hearts', kind: 'aura', name: 'Smitten', line: 'Hearts floating up', rarity: 'rare', unlock: { crate: 'crate:neon' } },
  { id: 'aura:butterflies', kind: 'aura', name: 'Butterflies', line: 'A flutter of colour', rarity: 'epic', price: 9000 },
  { id: 'aura:pixels', kind: 'aura', name: '8-Bit', line: 'Pixels breaking away', rarity: 'epic', price: 10000 },
  { id: 'aura:coins', kind: 'aura', name: 'Coin Orbit', line: 'Gold coins circling', rarity: 'epic', price: 11000 },
  { id: 'aura:lightning', kind: 'aura', name: 'Static', line: 'Arcs that snap round you', rarity: 'epic', unlock: { crate: 'crate:neon' } },
  { id: 'aura:halo', kind: 'aura', name: 'Halo', line: 'Reach Platinum', rarity: 'legendary', unlock: { tier: 3 } },
  { id: 'aura:atomic', kind: 'aura', name: 'Atomic', line: 'Win a Round 1 bet in Kaiju Clash', rarity: 'legendary', unlock: { challenge: 'kaiju-r1' } },
  { id: 'aura:shadow', kind: 'aura', name: 'Shadowflame', line: 'Dark violet fire', rarity: 'legendary', unlock: { crate: 'crate:cosmic' } },
  { id: 'aura:prism', kind: 'aura', name: 'Prism', line: 'Every colour, refracted', rarity: 'mythic', unlock: { crate: 'crate:mythic' } },
]

const banners: Cosmetic[] = [
  { id: 'banner:default', kind: 'banner', name: 'Night', line: 'The house colours', rarity: 'common' },
  { id: 'banner:felt', kind: 'banner', name: 'Green Felt', line: 'A seat at the table', rarity: 'common', unlock: { level: 2 } },
  { id: 'banner:sunset', kind: 'banner', name: 'Sunset Strip', line: 'Neon on a warm evening', rarity: 'common', price: 1000 },
  { id: 'banner:ocean', kind: 'banner', name: 'Deep Reef', line: 'Calm water, bright fish', rarity: 'common', price: 1000 },
  { id: 'banner:neon', kind: 'banner', name: 'Neon City', line: 'The city that never sleeps', rarity: 'rare', price: 3000 },
  { id: 'banner:arcade', kind: 'banner', name: 'Arcade', line: 'Pixels and high scores', rarity: 'rare', price: 3000 },
  { id: 'banner:galaxy', kind: 'banner', name: 'Galaxy', line: 'Lucky stars', rarity: 'epic', price: 7500 },
  { id: 'banner:vault', kind: 'banner', name: 'The Vault', line: 'Crack all eight vaults in Vault Heist', rarity: 'epic', unlock: { achievement: 'heist-master' } },
  { id: 'banner:gold', kind: 'banner', name: 'Gold Bars', line: 'Reach Gold', rarity: 'rare', unlock: { tier: 2 } },
  { id: 'banner:diamond', kind: 'banner', name: 'Diamond Lounge', line: 'Reach Diamond', rarity: 'legendary', unlock: { tier: 4 } },
  { id: 'banner:jackpot', kind: 'banner', name: 'Jackpot', line: 'Win 10,000 coins in one round', rarity: 'legendary', unlock: { achievement: 'bigwin-10k' } },
  { id: 'banner:aurora', kind: 'banner', name: 'Aurora', line: 'Ribbons of light', rarity: 'legendary', price: 25000 },
  { id: 'banner:matrix', kind: 'banner', name: 'Code Rain', line: 'Falling green glyphs', rarity: 'rare', price: 5000 },
  { id: 'banner:sakura', kind: 'banner', name: 'Sakura', line: 'Petals under a full moon', rarity: 'rare', price: 5000 },
  { id: 'banner:warp', kind: 'banner', name: 'Hyperspace', line: 'Stars at light speed', rarity: 'epic', price: 9000 },
  { id: 'banner:synthwave', kind: 'banner', name: 'Synthwave', line: 'Chrome sun, endless grid', rarity: 'epic', price: 9000 },
  { id: 'banner:vegas', kind: 'banner', name: 'Vegas Lights', line: 'Marquee bulbs chasing round', rarity: 'epic', price: 12000 },
  { id: 'banner:storm', kind: 'banner', name: 'Supercell', line: 'Rain and lightning', rarity: 'epic', unlock: { crate: 'crate:neon' } },
  { id: 'banner:kaiju', kind: 'banner', name: 'Kaiju City', line: 'Win a long shot on the winner in Kaiju Clash', rarity: 'epic', unlock: { challenge: 'kaiju-upset' } },
  { id: 'banner:volcano', kind: 'banner', name: 'Eruption', line: 'Lava and rising embers', rarity: 'legendary', price: 26000 },
  { id: 'banner:abyss', kind: 'banner', name: 'Abyss', line: 'Glowing jellyfish in the deep', rarity: 'legendary', unlock: { crate: 'crate:cosmic' } },
  { id: 'banner:singularity', kind: 'banner', name: 'Singularity', line: 'A black hole, slowly turning', rarity: 'mythic', unlock: { crate: 'crate:mythic' } },
]

const backdrops: Cosmetic[] = [
  { id: 'backdrop:none', kind: 'backdrop', name: 'No backdrop', line: 'The house colours', rarity: 'common' },
  { id: 'backdrop:stars', kind: 'backdrop', name: 'Starlight', line: 'Reach level 5', rarity: 'common', unlock: { level: 5 } },
  { id: 'backdrop:snow', kind: 'backdrop', name: 'Blizzard', line: 'Snow on the wind', rarity: 'rare', price: 5000 },
  { id: 'backdrop:matrix', kind: 'backdrop', name: 'Code Rain', line: 'Falling green glyphs', rarity: 'rare', price: 6000 },
  { id: 'backdrop:sakura', kind: 'backdrop', name: 'Sakura', line: 'Petals on the breeze', rarity: 'rare', price: 6000 },
  { id: 'backdrop:fireflies', kind: 'backdrop', name: 'Fireflies', line: 'A warm summer night', rarity: 'rare', unlock: { crate: 'crate:neon' } },
  { id: 'backdrop:coins', kind: 'backdrop', name: 'Coin Rain', line: 'It’s raining coins', rarity: 'epic', price: 10000 },
  { id: 'backdrop:chips', kind: 'backdrop', name: 'Chip Shower', line: 'Casino chips tumbling down', rarity: 'epic', price: 10000 },
  { id: 'backdrop:warp', kind: 'backdrop', name: 'Warp Speed', line: 'Punch it', rarity: 'epic', price: 12000 },
  { id: 'backdrop:confetti', kind: 'backdrop', name: 'Confetti', line: 'Win 10,000 coins in one round', rarity: 'epic', unlock: { achievement: 'bigwin-10k' } },
  { id: 'backdrop:embers', kind: 'backdrop', name: 'Ember Storm', line: 'A sky full of sparks', rarity: 'legendary', price: 22000 },
  { id: 'backdrop:storm', kind: 'backdrop', name: 'Thunderstorm', line: 'Rain, wind and lightning', rarity: 'legendary', unlock: { crate: 'crate:cosmic' } },
  { id: 'backdrop:aurora', kind: 'backdrop', name: 'Aurora', line: 'The northern lights', rarity: 'legendary', unlock: { crate: 'crate:cosmic' } },
  { id: 'backdrop:prism', kind: 'backdrop', name: 'Prism', line: 'Every colour, refracted', rarity: 'mythic', unlock: { crate: 'crate:mythic' } },
]

const nameColors: Cosmetic[] = [
  { id: 'name:default', kind: 'nameColor', name: 'White', line: 'Clean and simple', rarity: 'common' },
  { id: 'name:green', kind: 'nameColor', name: 'Felt Green', line: 'Reach level 4', rarity: 'common', unlock: { level: 4 } },
  { id: 'name:ice', kind: 'nameColor', name: 'Ice', line: 'Cool under pressure', rarity: 'common', price: 1500 },
  { id: 'name:rose', kind: 'nameColor', name: 'Rose', line: 'A touch of colour', rarity: 'common', price: 1500 },
  { id: 'name:violet', kind: 'nameColor', name: 'Violet', line: 'Royal purple', rarity: 'rare', price: 3500 },
  { id: 'name:gold', kind: 'nameColor', name: 'Gold', line: 'Reach Gold', rarity: 'rare', unlock: { tier: 2 } },
  { id: 'name:fire', kind: 'nameColor', name: 'Fire', line: 'Burns as it moves', rarity: 'epic', price: 12000 },
  { id: 'name:rainbow', kind: 'nameColor', name: 'Rainbow', line: 'Every colour at once', rarity: 'legendary', price: 25000 },
  { id: 'name:diamond', kind: 'nameColor', name: 'Diamond', line: 'Reach Diamond', rarity: 'legendary', unlock: { tier: 4 } },
  { id: 'name:neon', kind: 'nameColor', name: 'Neon Sign', line: 'Buzzing pink neon', rarity: 'rare', price: 6000 },
  { id: 'name:frost', kind: 'nameColor', name: 'Frost', line: 'An icy shimmer', rarity: 'rare', price: 6000 },
  { id: 'name:lava', kind: 'nameColor', name: 'Lava', line: 'Molten and flowing', rarity: 'epic', price: 12000 },
  { id: 'name:glitch', kind: 'nameColor', name: 'Glitch', line: 'Split, jittering, unstable', rarity: 'epic', price: 14000 },
  { id: 'name:electric', kind: 'nameColor', name: 'Electric', line: 'Crackling with current', rarity: 'epic', unlock: { crate: 'crate:neon' } },
  { id: 'name:holo', kind: 'nameColor', name: 'Holo Foil', line: 'A foil sheen that sweeps across', rarity: 'legendary', price: 30000 },
  { id: 'name:goldrush', kind: 'nameColor', name: 'Gold Rush', line: 'Win 100,000 coins in one round', rarity: 'legendary', unlock: { achievement: 'bigwin-100k' } },
  { id: 'name:void', kind: 'nameColor', name: 'Void', line: 'Dark matter with a violet pulse', rarity: 'legendary', unlock: { crate: 'crate:cosmic' } },
  { id: 'name:prism', kind: 'nameColor', name: 'Prism', line: 'Every colour, refracted', rarity: 'mythic', unlock: { crate: 'crate:mythic' } },
]

const titles: Cosmetic[] = [
  { id: 'title:none', kind: 'title', name: 'No title', line: 'Let your play speak', rarity: 'common' },
  { id: 'title:newcomer', kind: 'title', name: 'Newcomer', line: 'Every legend starts somewhere', rarity: 'common' },
  { id: 'title:regular', kind: 'title', name: 'Regular', line: 'Reach level 5', rarity: 'common', unlock: { level: 5 } },
  { id: 'title:lucky', kind: 'title', name: 'Lucky Charm', line: 'In the shop', rarity: 'common', price: 2000 },
  { id: 'title:night-owl', kind: 'title', name: 'Night Owl', line: 'In the shop', rarity: 'common', price: 2000 },
  { id: 'title:explorer', kind: 'title', name: 'Explorer', line: 'Complete the Explorer challenge', rarity: 'rare', unlock: { challenge: 'explorer' } },
  { id: 'title:card-shark', kind: 'title', name: 'Card Shark', line: 'Complete the Card Shark challenge', rarity: 'rare', unlock: { challenge: 'card-shark' } },
  { id: 'title:veteran', kind: 'title', name: 'Veteran', line: 'Play 1,000 rounds', rarity: 'rare', unlock: { achievement: 'rounds-1000' } },
  { id: 'title:big-fish', kind: 'title', name: 'Big Fish', line: 'In the shop', rarity: 'epic', price: 8000 },
  { id: 'title:high-roller', kind: 'title', name: 'High Roller', line: 'Wager 100,000 coins', rarity: 'epic', unlock: { achievement: 'wagered-100k' } },
  { id: 'title:jackpot-hunter', kind: 'title', name: 'Jackpot Hunter', line: 'Win 10,000 coins in one round', rarity: 'epic', unlock: { achievement: 'bigwin-10k' } },
  { id: 'title:legend', kind: 'title', name: 'Legend', line: 'Reach Diamond', rarity: 'legendary', unlock: { tier: 4 } },
  { id: 'title:tycoon', kind: 'title', name: 'Tycoon', line: 'In the shop', rarity: 'legendary', price: 40000 },
  { id: 'title:showstopper', kind: 'title', name: 'Showstopper', line: 'In the shop', rarity: 'rare', price: 5000 },
  { id: 'title:menace', kind: 'title', name: 'Menace', line: 'In the shop', rarity: 'epic', price: 9000 },
  { id: 'title:mastermind', kind: 'title', name: 'Mastermind', line: 'In the shop', rarity: 'epic', price: 12000 },
  { id: 'title:glitched', kind: 'title', name: 'Glitched', line: 'Found in the Neon Crate', rarity: 'epic', unlock: { crate: 'crate:neon' } },
  { id: 'title:kaiju-king', kind: 'title', name: 'Kaiju King', line: 'Win a long shot on the winner in Kaiju Clash', rarity: 'epic', unlock: { challenge: 'kaiju-upset' } },
  { id: 'title:whale', kind: 'title', name: 'The Whale', line: 'Wager 1,000,000 coins', rarity: 'legendary', unlock: { achievement: 'wagered-1m' } },
  { id: 'title:cosmic', kind: 'title', name: 'Cosmic', line: 'Found in the Cosmic Crate', rarity: 'legendary', unlock: { crate: 'crate:cosmic' } },
  { id: 'title:immortal', kind: 'title', name: 'Immortal', line: 'Found in the Mythic Crate', rarity: 'mythic', unlock: { crate: 'crate:mythic' } },
]

export const COSMETICS: readonly Cosmetic[] = [...avatars, ...frames, ...auras, ...banners, ...backdrops, ...nameColors, ...titles]
const byId = new Map(COSMETICS.map((c) => [c.id, c]))
export const cosmetic = (id: string) => byId.get(id)
export const cosmeticsOf = (kind: CosmeticKind) => COSMETICS.filter((c) => c.kind === kind)

/* ---------------- crates ---------------- */

/*
  A crate is bought with coins and drops one cosmetic from its pool that the player can't wear yet (not owned, not
  unlocked), picked by weight: each item weighs its rarity's weight (CRATE_WEIGHT). The crate-only cosmetics
  (unlock.crate) are in their crate's pool and no other; the rest of a pool is from the shop. Once a player can wear everything in
  a crate, it can't be bought. Every chance is shown before buying.
*/
export interface Crate {
  id: string
  name: string
  line: string
  price: number
  /** its colour in the shop */
  rarity: Rarity
  /** the cosmetic ids it can drop */
  pool: readonly string[]
}
/** how much each rarity weighs in a crate's draw */
export const CRATE_WEIGHT: Record<Rarity, number> = { common: 120, rare: 100, epic: 45, legendary: 12, mythic: 3 }

const crateOnly = (crate: string) => COSMETICS.filter((c) => c.unlock?.crate === crate).map((c) => c.id)
export const CRATES: readonly Crate[] = [
  {
    id: 'crate:neon',
    name: 'Neon Crate',
    line: 'Rare and Epic looks, with seven you can only find here',
    price: 3000,
    rarity: 'rare',
    pool: [
      ...crateOnly('crate:neon'),
      'frame:frost', 'name:neon', 'name:frost', 'aura:embers', 'aura:bubbles', 'aura:snow', 'banner:matrix', 'banner:sakura',
      'backdrop:matrix', 'backdrop:sakura', 'backdrop:snow', 'title:showstopper',
    ],
  },
  {
    id: 'crate:cosmic',
    name: 'Cosmic Crate',
    line: 'Epic and Legendary looks, with seven you can only find here',
    price: 10000,
    rarity: 'epic',
    pool: [
      ...crateOnly('crate:cosmic'),
      'frame:plasma', 'frame:orbit', 'frame:glitch', 'banner:warp', 'banner:synthwave', 'banner:vegas', 'name:glitch', 'name:lava',
      'aura:coins', 'aura:butterflies', 'aura:pixels', 'backdrop:coins', 'backdrop:chips', 'backdrop:warp', 'title:menace', 'title:mastermind',
    ],
  },
  {
    id: 'crate:mythic',
    name: 'Mythic Crate',
    line: 'Legendary and Mythic only: the rarest looks in the casino',
    price: 30000,
    rarity: 'mythic',
    pool: [
      ...crateOnly('crate:mythic'),
      'frame:inferno', 'frame:storm', 'frame:liquidgold', 'banner:volcano', 'name:holo', 'backdrop:embers',
    ],
  },
]
const crateById = new Map(CRATES.map((c) => [c.id, c]))
export const crateOf = (id: string) => crateById.get(id)

/* ---------------- achievements ---------------- */

/** the wallet fields achievements are worked out from (a public profile carries the same) */
export interface AchievementSource {
  xp: number
  rounds: number
  totalWagered: number
  totalWon: number
  biggestWin: number
  dailyStreak: number
  heistBest: number
  /** ids of the challenges claimed */
  claimed: readonly string[]
}

export interface Achievement {
  id: string
  name: string
  line: string
  rarity: Rarity
  /** what draws its badge: a milestone's emblem, a VIP tier, or a challenge's game */
  icon: string
  earned: (s: AchievementSource) => boolean
}

const milestone = (id: string, name: string, line: string, rarity: Rarity, icon: string, earned: (s: AchievementSource) => boolean): Achievement => ({ id, name, line, rarity, icon, earned })

export const MILESTONES: readonly Achievement[] = [
  milestone('first-win', 'First Win', 'Win a round', 'common', 'star', (s) => s.totalWon > 0),
  milestone('rounds-100', 'Getting Started', 'Play 100 rounds', 'common', 'rounds', (s) => s.rounds >= 100),
  milestone('rounds-1000', 'Veteran', 'Play 1,000 rounds', 'rare', 'rounds', (s) => s.rounds >= 1000),
  milestone('rounds-10000', 'Lifer', 'Play 10,000 rounds', 'legendary', 'rounds', (s) => s.rounds >= 10000),
  milestone('wagered-10k', 'In the Game', 'Wager 10,000 coins', 'common', 'coins', (s) => s.totalWagered >= 10_000),
  milestone('wagered-100k', 'High Roller', 'Wager 100,000 coins', 'epic', 'coins', (s) => s.totalWagered >= 100_000),
  milestone('wagered-1m', 'Whale', 'Wager 1,000,000 coins', 'legendary', 'coins', (s) => s.totalWagered >= 1_000_000),
  milestone('bigwin-1k', 'Big Win', 'Win 1,000 coins in one round', 'rare', 'trophy', (s) => s.biggestWin >= 1000),
  milestone('bigwin-10k', 'Jackpot', 'Win 10,000 coins in one round', 'epic', 'trophy', (s) => s.biggestWin >= 10_000),
  milestone('bigwin-100k', 'Mega Jackpot', 'Win 100,000 coins in one round', 'legendary', 'trophy', (s) => s.biggestWin >= 100_000),
  milestone('streak-7', 'Seven Days', 'Claim the daily bonus seven days running', 'rare', 'calendar', (s) => s.dailyStreak >= 7),
  milestone('heist-master', 'Master Thief', 'Crack all eight vaults in Vault Heist', 'epic', 'vault', (s) => s.heistBest >= 8),
  milestone('tier-1', 'Silver', 'Reach Silver', 'common', 'tier-1', (s) => tierIndexOf(levelFromXp(s.xp).level) >= 1),
  milestone('tier-2', 'Gold', 'Reach Gold', 'rare', 'tier-2', (s) => tierIndexOf(levelFromXp(s.xp).level) >= 2),
  milestone('tier-3', 'Platinum', 'Reach Platinum', 'epic', 'tier-3', (s) => tierIndexOf(levelFromXp(s.xp).level) >= 3),
  milestone('tier-4', 'Diamond', 'Reach Diamond', 'legendary', 'tier-4', (s) => tierIndexOf(levelFromXp(s.xp).level) >= 4),
]

/** every achievement: the milestones, then one for every challenge (its badge drawn with the challenge's game, or a star) */
function achievementsIndex() {
  if (all) return all
  const badges: Achievement[] = challenges.map((c) => ({
    id: `challenge:${c.id}`,
    name: c.title,
    line: c.desc,
    rarity: c.reward >= 4000 ? 'epic' : c.reward >= 2500 ? 'rare' : 'common',
    icon: c.game ? `game:${c.game}` : 'star',
    earned: (s: AchievementSource) => s.claimed.includes(c.id),
  }))
  const list = [...MILESTONES, ...badges]
  all = { list, byId: new Map(list.map((a) => [a.id, a])) }
  return all
}
export const allAchievements = () => achievementsIndex().list
export const achievement = (id: string) => achievementsIndex().byId.get(id)
export const earnedAchievements = (s: AchievementSource) => allAchievements().filter((a) => a.earned(s)).map((a) => a.id)

/* ---------------- looks ---------------- */

/** what a player wears; ids from COSMETICS, badges from ACHIEVEMENTS (up to SHOWCASE) */
export interface Look {
  frame: string
  aura: string
  banner: string
  backdrop: string
  nameColor: string
  title: string
  badges: string[]
}
export const SHOWCASE = 3
export const DEFAULT_LOOK: Look = { frame: 'frame:bronze', aura: 'aura:none', banner: 'banner:default', backdrop: 'backdrop:none', nameColor: 'name:default', title: 'title:newcomer', badges: [] }

/** a look read from anywhere (storage, the server), with anything unknown put back to the default */
export function cleanLook(x: unknown): Look {
  const l = (x && typeof x === 'object' ? x : {}) as Partial<Look>
  const pick = (id: unknown, kind: CosmeticKind, fallback: string) => (typeof id === 'string' && byId.get(id)?.kind === kind ? id : fallback)
  return {
    frame: pick(l.frame, 'frame', DEFAULT_LOOK.frame),
    aura: pick(l.aura, 'aura', DEFAULT_LOOK.aura),
    banner: pick(l.banner, 'banner', DEFAULT_LOOK.banner),
    backdrop: pick(l.backdrop, 'backdrop', DEFAULT_LOOK.backdrop),
    nameColor: pick(l.nameColor, 'nameColor', DEFAULT_LOOK.nameColor),
    title: pick(l.title, 'title', DEFAULT_LOOK.title),
    badges: Array.isArray(l.badges) ? [...new Set(l.badges.filter((b): b is string => typeof b === 'string' && !!achievement(b)))].slice(0, SHOWCASE) : [],
  }
}

/** what a cosmetic needs to be worn: unlocked by progress, bought, or free */
export interface Wardrobe {
  source: AchievementSource
  owned: readonly string[]
}

/** whether progress alone unlocks a cosmetic (free ones always) */
export function unlockedBy(c: Cosmetic, s: AchievementSource): boolean {
  if (!c.unlock) return c.price === undefined
  const u = c.unlock
  if (u.crate !== undefined) return false
  const level = levelFromXp(s.xp).level
  if (u.level !== undefined && level < u.level) return false
  if (u.tier !== undefined && tierIndexOf(level) < u.tier) return false
  if (u.challenge !== undefined && !s.claimed.includes(u.challenge)) return false
  if (u.achievement !== undefined && !achievement(u.achievement)?.earned(s)) return false
  return true
}

/** whether a player may wear a cosmetic */
export const canWear = (id: string, w: Wardrobe) => {
  const c = byId.get(id)
  return !!c && (w.owned.includes(id) || unlockedBy(c, w.source))
}

/** the look as it can be worn: anything no longer wearable falls back to the default, unearned badges drop */
export function wearable(look: Look, w: Wardrobe): Look {
  const earned = new Set(earnedAchievements(w.source))
  const keep = (id: string, fallback: string) => (canWear(id, w) ? id : fallback)
  return {
    frame: keep(look.frame, DEFAULT_LOOK.frame),
    aura: keep(look.aura, DEFAULT_LOOK.aura),
    banner: keep(look.banner, DEFAULT_LOOK.banner),
    backdrop: keep(look.backdrop, DEFAULT_LOOK.backdrop),
    nameColor: keep(look.nameColor, DEFAULT_LOOK.nameColor),
    title: keep(look.title, DEFAULT_LOOK.title),
    badges: look.badges.filter((b) => earned.has(b)).slice(0, SHOWCASE),
  }
}

/** what a crate can still drop for a player: its pool less what they can already wear, each with its chance */
export function crateDrops(crate: Crate, w: Wardrobe): { id: string; chance: number }[] {
  const left = crate.pool.filter((id) => byId.has(id) && !canWear(id, w))
  const total = left.reduce((a, id) => a + CRATE_WEIGHT[byId.get(id)!.rarity], 0)
  return left.map((id) => ({ id, chance: CRATE_WEIGHT[byId.get(id)!.rarity] / total }))
}

/** an avatar index a player may use */
export const canUseAvatar = (i: number, w: Wardrobe) => i >= 0 && i < AVATAR_COUNT && canWear(`avatar:${i}`, w)
