import { FIGHT_MS, WALKOUT_MS, fightRoundAt, roundStart } from './clock'
import { fighter, sideId } from './rules'
import type { KaijuId, Matchup, Method, Result, Side } from './types'

/*
  Kaiju Clash's words: the ringside commentary, the announcer's walkout, the round titles, the result and the
  judges' line, and a little colour for the tale of the tape.

  The commentary is picked by the fight script (fight.ts) as it writes each beat, from the script's own stream of
  numbers, so every browser reads the same line at the same moment. A caller never repeats a line within a fight
  while its group has others left. Lines name the kaiju with their own moves: Rexor bites and whips its tail, Kraka
  lashes tentacles, Lumina beats her wings, so the same template reads differently in every matchup.

  Placeholders: {a} the kaiju doing it, {b} the other one, {sp} the special's name ({SP} in capitals; never the
  subject of a verb, as Titan-X's Eye Lasers are plural), {bld} a building, {r} the round, and each kaiju's moves
  {jab}, {heavy}, {tail}, {grab}.
*/

/** each kaiju's moves as the commentary names them */
export const MOVES: Record<KaijuId, { jab: string; heavy: string; tail: string; grab: string }> = {
  rexor: { jab: 'a raking claw', heavy: 'a bone-crunching bite', tail: 'tail', grab: 'jaws' },
  gorrath: { jab: 'a hooking left', heavy: 'a sledgehammer right', tail: 'backhand', grab: 'huge hands' },
  titan: { jab: 'a piston jab', heavy: 'a hydraulic uppercut', tail: 'spinning fist', grab: 'steel claws' },
  kraka: { jab: 'a tentacle lash', heavy: 'a crushing coil', tail: 'tentacle whip', grab: 'tentacles' },
  lumina: { jab: 'a wing flick', heavy: 'a diving strike', tail: 'wing', grab: 'clawed legs' },
  pincer: { jab: 'a pincer snap', heavy: 'the big claw', tail: 'claw swing', grab: 'claws' },
  bedrock: { jab: 'a stone jab', heavy: 'a landslide of a punch', tail: 'spinning slab', grab: 'stone fists' },
  voltra: { jab: 'a snapping bite', heavy: 'a coiled strike', tail: 'tail', grab: 'coils' },
}

/** colour for the tale of the tape (not used by the maths) */
export const TAPE: Record<KaijuId, { height: string; weight: string; from: string }> = {
  rexor: { height: '118 m', weight: '60,000 t', from: 'Ogasa Trench' },
  gorrath: { height: '104 m', weight: '48,000 t', from: 'The Ashlands' },
  titan: { height: '96 m', weight: '72,000 t', from: 'Kurogane Works' },
  kraka: { height: '82 m', weight: '39,000 t', from: 'The Black Deep' },
  lumina: { height: '74 m', weight: '9,000 t', from: 'The Glowing Forest' },
  pincer: { height: '70 m', weight: '55,000 t', from: 'Fortress Reef' },
  bedrock: { height: '128 m', weight: '95,000 t', from: 'Mount Grumble' },
  voltra: { height: '140 m', weight: '41,000 t', from: 'Thunder Strait' },
}

export type CallKind =
  | 'open1' | 'openN' | 'open3' | 'first' | 'jab' | 'heavy' | 'tail' | 'charge' | 'special' | 'specialMiss' | 'specialBlock'
  | 'block' | 'dodge' | 'grab' | 'throw' | 'knockInto' | 'thrownInto' | 'stomp' | 'missInto' | 'tailInto'
  | 'knockdown' | 'getup' | 'roar' | 'taunt' | 'circle' | 'drive' | 'toward' | 'low' | 'flurry' | 'ko' | 'koSpecial' | 'koInto' | 'splash'
  | 'bell' | 'endRound' | 'victory' | 'comeback'

export const CALLS: Record<CallKind, readonly string[]> = {
  open1: [
    'And we are under way in Neon Bay!',
    '{a} and {b} stride into the middle of the plaza!',
    'The ground shakes as {a} and {b} close in!',
    'Round 1! The rooftops are packed and the crowd goes wild!',
    'Here we go! {a} meets {b} in the middle!',
    'Two monsters, one plaza. Let them fight!',
    'The bell rings out over the bay, and {a} wastes no time!',
  ],
  openN: [
    'Round {r}! {a} comes out swinging',
    'Round {r}, and {a} looks hungry',
    '{a} and {b} back at it for round {r}!',
    'Round {r}: half the plaza is already rubble',
    'Into round {r} we go!',
    'Round {r}! {b} has had a minute to think about it',
  ],
  open3: [
    'The final round! Everything on the line!',
    'Round 3! Now or never in Neon Bay!',
    'Last round! {a} and {b} meet in the middle one more time',
    'Round 3, the championship round! Leave nothing in the tank!',
  ],
  first: [
    '{a} lands first!',
    'First blood to {a}!',
    '{a} draws first blood!',
    '{a} strikes first and the crowd roars!',
    '{a} gets on the board first!',
    'The first clean shot of the night belongs to {a}!',
  ],
  jab: [
    '{a} pops {b} with {jab}',
    'Sharp shot from {a}!',
    '{a} stings {b} with {jab}',
    '{a} lands {jab}',
    'Quick hands from {a}!',
    '{a} tags {b} again',
    'Snappy work from {a}!',
    '{jab} from {a} finds a gap',
    '{a} keeps {b} honest with {jab}',
  ],
  heavy: [
    '{a} UNLOADS on {b}!',
    '{heavy} from {a}! What a shot!',
    '{a} hits like a falling skyscraper!',
    'BOOM! {a} connects with {heavy}!',
    '{b} felt that one all the way to the bay!',
    'A thunderous blow from {a}!',
    '{a} puts everything into {heavy}!',
    'Oh, that one shook the windows downtown!',
    '{heavy} from {a}, and {b} is rocked!',
  ],
  tail: [
    "{a}'s {tail} whips round and catches {b}!",
    '{a} spins, CRACK, the {tail} connects!',
    '{b} never saw that {tail} coming!',
    'A sweeping {tail} from {a} sends {b} reeling!',
    "{a} turns and the {tail} cracks across {b}'s jaw!",
  ],
  charge: [
    '{a} charges like a freight train!',
    '{a} lowers the head and CHARGES!',
    'Body slam from {a}! {b} is rocked!',
    '{a} barrels into {b}!',
    'Full-speed charge from {a}, straight through {b}!',
    '{a} runs {b} over like a runaway tram!',
  ],
  special: [
    '{SP}! {b} takes it full on!',
    '{a} unleashes the {sp}! Direct hit!',
    '{a} finds the mark with the {sp}!',
    '{a} lets rip with the {SP}!',
  ],
  specialMiss: [
    '{b} ducks under the {sp}!',
    'Wide with the {sp}!',
    '{b} sidesteps the {sp}!',
    'Missed! {a} lights up the sky with the {sp} instead',
    '{a} fires the {sp} and hits nothing but night',
  ],
  specialBlock: [
    '{b} weathers the {sp} behind its guard!',
    '{b} braces and blocks the {sp}!',
    '{b} shrugs off the {sp}! Great defence!',
  ],
  block: [
    '{b} takes it on the guard',
    'Blocked!',
    '{b} shells up and takes it',
    'Good defence from {b}',
    '{b} turns it away',
    'Nothing doing: {b} blocks',
    '{b} eats it on the arms',
  ],
  dodge: [
    '{b} slips it!',
    'Too slow, {a}!',
    '{b} sways clear',
    'Swing and a miss from {a}!',
    '{a} hits nothing but air',
    '{b} is too quick for that',
    'Whiff! {a} nearly falls over',
  ],
  grab: [
    '{a} gets hold of {b}!',
    '{a} wraps up {b}!',
    '{a} has {b} in those {grab}!',
    'Clinch! {a} has {b} tied up',
    '{a} grabs {b} and will not let go!',
  ],
  throw: [
    '{a} hurls {b} across the plaza!',
    'Up and over! {a} throws {b}!',
    '{a} tosses {b} like a parked car!',
    '{a} spins and LAUNCHES {b}!',
    'What a throw from {a}!',
  ],
  knockInto: [
    '{b} crashes through the {bld}!',
    '{b} is sent flying into the {bld}!',
    'There goes the {bld}!',
    '{a} drives {b} right through the {bld}!',
    'The {bld} did not stand a chance!',
    '{b} flattens the {bld} on the way back!',
    'Into the {bld} goes {b}! Bricks everywhere!',
  ],
  thrownInto: [
    '{a} throws {b} straight through the {bld}!',
    '{b} lands on the {bld}! What a mess!',
    'Right into the {bld}! {a} has no respect for property!',
  ],
  stomp: [
    '{a} stomps the {bld} flat!',
    '{a} takes out the {bld} just to make a point!',
    'Not the {bld}! {a} smashes it to rubble!',
    '{a} kicks over the {bld}!',
    'Somebody call the insurers: {a} levels the {bld}!',
    '{a} takes a moment to demolish the {bld}',
  ],
  missInto: [
    '{a} misses {b} with the {sp} and levels the {bld}!',
    '{b} ducks, and the {bld} takes the {sp} instead!',
    'Wild {sp}! The {bld} is history!',
    '{a} fires the {sp} past {b} and the {bld} comes down!',
  ],
  tailInto: [
    "{a}'s {tail} clips the {bld} and down it comes!",
    '{a} swings wide and the {bld} pays for it!',
    'Collateral damage! The {bld} is caught in the swing!',
  ],
  knockdown: [
    '{b} is DOWN!',
    'Down goes {b}! Down goes {b}!',
    '{b} hits the deck!',
    '{a} drops {b}!',
    '{b} goes down hard and the whole bay shakes!',
  ],
  getup: [
    '{b} is back up!',
    '{b} beats the count!',
    '{b} shakes it off and rises!',
    "{b} isn't done yet!",
    '{b} hauls itself up out of the rubble!',
  ],
  roar: [
    '{a} roars at the moon!',
    '{a} lets the whole bay hear it!',
    'What a roar from {a}!',
    '{a} bellows, and car alarms go off all over town!',
    '{a} roars. The news helicopters back off a little',
  ],
  taunt: [
    '{a} beckons {b} in',
    '{a} is enjoying this!',
    '{a} showboats for the helicopters!',
    '{a} invites {b} to try that again',
    '{a} shrugs off the last one and grins',
  ],
  circle: [
    '{a} and {b} circle each other',
    'Cagey stuff from both of them',
    '{a} sizing up {b}',
    'A moment to breathe in Neon Bay',
  ],
  drive: [
    '{a} is backing {b} toward the water!',
    "{b}'s heels are at the edge of the bay!",
    '{a} pushes {b} onto the waterfront!',
    '{b} is running out of plaza!',
    '{a} has {b} pinned against the shore!',
  ],
  toward: [
    '{a} backs {b} up toward the {bld}',
    'The fight spills toward the {bld}!',
    '{b} is backing into the {bld}...',
    'Uh oh: {a} is driving {b} at the {bld}',
    'Somebody evacuate the {bld}!',
  ],
  low: [
    '{b} is running on empty!',
    '{b} is in serious trouble!',
    '{b} can barely stand!',
    '{b} is hanging on by a thread!',
  ],
  flurry: [
    'Both kaiju swinging for the fences!',
    'What an exchange!',
    'They are trading blows in the middle of the plaza!',
    'Toe to toe! Neither one backing down!',
  ],
  ko: [
    "{a} FLATTENS {b}! IT'S ALL OVER!",
    "KNOCKOUT! {b} won't be getting up!",
    'Lights out for {b}! {a} wins it!',
    '{a} with the finishing blow! {b} is OUT!',
    'Timber! {b} goes down and stays down!',
  ],
  koSpecial: [
    '{a} finishes it with the {SP}! {b} is OUT!',
    '{a} ends it with the {SP}! KNOCKOUT!',
  ],
  koInto: [
    "{a} knocks {b} clean through the {bld}! IT'S OVER!",
    'KNOCKOUT! {b} goes down under what used to be the {bld}!',
    "{b} crashes through the {bld} and that's the fight!",
  ],
  splash: [
    '{a} launches {b} into the bay! SPLASH!',
    'SPLASH! {b} is swimming with the fishes!',
    'Into the drink! {a} wins by Splash!',
    '{a} throws {b} clean into Neon Bay!',
    'Man overboard! {b} is in the bay!',
  ],
  bell: [
    "There's the final bell! It goes to the judges",
    'The bell! Both still standing: over to the judges!',
    "That's the fight! We go to the scorecards",
    'Three rounds, no knockout. The judges will decide it',
  ],
  endRound: [
    'Bell! End of round {r}',
    "That's round {r}. Back to the corners",
    'End of round {r}, and what a round',
  ],
  victory: [
    '{a} stands tall over the wreckage',
    '{a} roars in triumph!',
    '{a} is the king of Neon Bay tonight!',
    'Nobody is arguing with {a} tonight',
  ],
  comeback: [
    '{a} is fighting back!',
    "Don't count {a} out!",
    'The tide is turning! {a} is rallying!',
  ],
}

/** each kaiju's own lines for its special landing, used before the generic ones */
export const SPECIAL_CALLS: Record<KaijuId, readonly string[]> = {
  rexor: ["Rexor's plates glow blue: ATOMIC BREATH!", 'A torrent of blue fire from Rexor!', 'Rexor lights up the bay: ATOMIC BREATH!'],
  gorrath: ['Gorrath plants both fists: the GROUND POUND rattles the bay!', 'GROUND POUND! The whole plaza jumps!', 'Gorrath slams the ground and the shockwave flattens {b}!'],
  titan: ["Titan-X's visor flares red: EYE LASERS!", 'Twin red beams from Titan-X!', 'Target locked. EYE LASERS!'],
  kraka: ['Kraka spins up the INK CYCLONE!', 'A black whirlwind of ink swallows {b}!', 'INK CYCLONE! {b} is dragged off its feet!'],
  lumina: ['Lumina beats her wings: DUST STORM!', 'A glittering DUST STORM blinds {b}!', "The Moth Queen's wings blaze gold: DUST STORM!"],
  pincer: ['Pincer tucks into its shell: SHELL CRUSH!', 'SHELL CRUSH! Pincer rolls right over {b}!', 'The Living Fortress spins like a wrecking ball!'],
  bedrock: ['Bedrock rips up a boulder: BOULDER HURL!', 'BOULDER HURL! Right on target!', 'Bedrock throws half a mountain at {b}!'],
  voltra: ["Voltra's coils crackle: CHAIN LIGHTNING!", 'CHAIN LIGHTNING! {b} lights up like a neon sign!', 'The Storm Serpent strikes and the bay flashes white!'],
}

export interface Vars {
  /** the kaiju doing it and the other one */
  a: KaijuId
  b: KaijuId
  bld?: string
  r?: number
}

/** a template filled in */
export function fill(t: string, v: Vars): string {
  const A = fighter(v.a)
  const B = fighter(v.b)
  const mv = MOVES[v.a]
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const out = t
    .replace(/\{a\}/g, A.name)
    .replace(/\{b\}/g, B.name)
    .replace(/\{sp\}/g, A.special)
    .replace(/\{SP\}/g, A.special.toUpperCase())
    .replace(/\{bld\}/g, v.bld ?? 'building')
    .replace(/\{r\}/g, String(v.r ?? 1))
    .replace(/\{jab\}/g, mv.jab)
    .replace(/\{heavy\}/g, mv.heavy)
    .replace(/\{tail\}/g, mv.tail)
    .replace(/\{grab\}/g, mv.grab)
  return cap(out)
}

/**
 * A commentator for one fight: say(kind, vars) picks a line from the group with the script's numbers (rand gives
 * [0, 1)), never one it has already used in this fight while the group has others left.
 */
export function makeCaller(rand: () => number) {
  const used = new Set<string>()
  return (kind: CallKind, v: Vars): string => {
    const own = kind === 'special' ? SPECIAL_CALLS[v.a] : []
    let pool = [...own, ...CALLS[kind]].filter((t) => !used.has(t))
    if (!pool.length) {
      for (const t of [...own, ...CALLS[kind]]) used.delete(t)
      pool = [...own, ...CALLS[kind]]
    }
    // a kaiju's own special lines come first when there are any left
    const mine = pool.filter((t) => own.includes(t))
    const from = mine.length && rand() < 0.75 ? mine : pool
    const t = from[Math.floor(rand() * from.length)]
    used.add(t)
    return fill(t, v)
  }
}

/* ---------------- the show around the fight ---------------- */

/** the announcer's lines over the walkout, ms after it starts; each kaiju roars in its spotlight on its line */
export function walkoutLines(m: Matchup): { at: number; who: Side | null; text: string }[] {
  const A = fighter(m.a)
  const B = fighter(m.b)
  return [
    { at: 0, who: null, text: m.main ? "Ladies and gentlemen, it's the MAIN EVENT in Neon Bay!" : 'Live from the plaza in Neon Bay!' },
    { at: 1000, who: 'a', text: `In the red corner: ${A.epithet}, ${A.name.toUpperCase()}!` },
    { at: 2900, who: 'b', text: `In the blue corner: ${B.epithet}, ${B.name.toUpperCase()}!` },
    { at: WALKOUT_MS - 1200, who: null, text: m.main ? "Lock up your skyscrapers: it's FIGHT NIGHT!" : 'Fighters, to your marks!' },
  ]
}

export const roundTitle = (k: number) => `ROUND ${k}`

/** the line under a round's title */
export function roundLine(k: number, m: Matchup): string {
  if (k === 3) return 'The final round'
  if (k === 2) return `${fighter(m.a).name} and ${fighter(m.b).name} go again`
  return m.main ? 'The Main Event is under way' : `${fighter(m.a).name} vs ${fighter(m.b).name}`
}

export const METHOD_TITLE: Record<Method, string> = { ko: 'KNOCKOUT', splash: 'SPLASH', dec: 'DECISION' }

/** the big line at the end ("KNOCKOUT! Bedrock flattens Lumina in round 2!"); n picks a variant (any whole number) */
export function resultLine(m: Matchup, r: Result, n = 0): string {
  const W = fighter(sideId(m, r.winner)).name
  const L = fighter(sideId(m, r.winner === 'a' ? 'b' : 'a')).name
  const pick = (xs: string[]) => xs[((n % xs.length) + xs.length) % xs.length]
  if (r.method === 'ko')
    return pick([
      `KNOCKOUT! ${W} flattens ${L} in round ${r.round}!`,
      `KNOCKOUT! ${W} puts ${L} down for good in round ${r.round}!`,
      `KNOCKOUT! It's all over: ${W} knocks out ${L} in round ${r.round}!`,
    ])
  if (r.method === 'splash')
    return pick([
      `SPLASH! ${W} throws ${L} into the bay in round ${r.round}!`,
      `SPLASH! ${L} takes a swim, courtesy of ${W}, in round ${r.round}!`,
      `SPLASH! ${W} sends ${L} into Neon Bay in round ${r.round}!`,
    ])
  return pick([`DECISION! ${W} wins on the judges' cards!`, `DECISION! ${W} takes it on points!`, `DECISION! The judges give it to ${W}!`])
}

/** what kind of decision three cards make, for the winner: all three, two and a draw, or two to one */
export function decisionKind(cards: [number, number][], winner: Side): 'unanimous' | 'majority' | 'split' {
  const w = winner === 'a' ? 0 : 1
  const ahead = cards.filter((c) => c[w] > c[1 - w]).length
  const even = cards.filter((c) => c[0] === c[1]).length
  return ahead === 3 ? 'unanimous' : even ? 'majority' : 'split'
}

/** the judges' line for a decision: "Unanimous decision for Lumina: 29-28, 30-27, 29-28" (the winner's score first) */
export function judgesLine(m: Matchup, r: Result, cards: [number, number][]): string {
  const w = r.winner === 'a' ? 0 : 1
  const kind = decisionKind(cards, r.winner)
  const scores = cards.map((c) => `${c[w]}-${c[1 - w]}`).join(', ')
  const name = fighter(sideId(m, r.winner)).name
  return `${kind === 'unanimous' ? 'Unanimous' : kind === 'majority' ? 'Majority' : 'Split'} decision for ${name}: ${scores}`
}

/** when a fight ended, as the result writes it: "0:07 of round 2" (the final bell for a decision) */
export function finishText(endsAt: number): string {
  if (endsAt >= FIGHT_MS) return 'the final bell'
  const { round } = fightRoundAt(endsAt)
  const s = Math.max(0, Math.floor((endsAt - roundStart(round)) / 1000))
  return `0:${String(s).padStart(2, '0')} of round ${round}`
}
