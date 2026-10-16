# Boje Casino (play money)

A Stake-style casino with twenty games. Originals: Chicken Road, Crash, Mines, Plinko, Dice, Limbo, Keno, Hi-Lo,
Wheel, Cases, Case Battles and Duck Derby. Table and machine games: Blackjack, Live Blackjack, Baccarat, Roulette,
Video Poker, Chompers, Pop Party and Robo Riot.
Vault Heist is a free skill game that pays coins. Coins are play money only. Guests keep their wallet in the
browser (localStorage); signed-in players have it saved to their account.

## Run
    npm install
    npm run dev            # http://localhost:5173
    npm run build          # static site in dist/ (relative paths, hash routing)
    npm run build:single   # one self-contained HTML file in dist-single/ (offline, no accounts)

## Stack
Vite + React 19 + TypeScript, Tailwind CSS v4, Framer Motion, Zustand, supabase-js. Plinko and Crash draw on
canvas; the slots (Chompers, Pop Party and Robo Riot) are three.js scenes, loaded only when the game opens. Hash
routing and relative asset paths mean `dist/` works as-is inside Capacitor:

    npm i @capacitor/core @capacitor/cli && npx cap init "Boje Casino" com.example.boje --web-dir dist
    npm i @capacitor/ios @capacitor/android && npx cap add ios && npx cap add android
    VITE_API_BASE=https://lumen-casino.vercel.app npm run build && npx cap sync

A native build has no same-origin `/api`, so `VITE_API_BASE` points it at the deployed site.

## Art
Chicken Road is the only pixel-art game (src/lib/pixel.ts, sprites in `src/games/chicken/`): sprites are strings
of palette keys rendered once to tiny canvases and scaled up with `image-rendering: pixelated`.
Every other game and the site UI use a modern casino style. Its art is vector SVG drawn in React components in
`src/art/` (cards, chips, gems, bomb, rocket, roulette wheel, prize wheel, vault, avatars, VIP badges) and the lobby
covers in `src/components/covers.tsx`; the Cases crates and loot are in `src/games/cases/art.tsx` (Case Battles
reuses them, with its own badges in `src/games/battles/art.tsx`). The slot symbols
are 3D models built in code (`models.ts` in
`src/games/chompers/`, `src/games/popparty/` and `src/games/roboriot/`). No image files ship.

Brand: the Boje mark (a cut gem with a B) and its loaders are in `src/components/Loader.tsx`. The loaders are one
quiet motion: the gem is cut into six facets and a soft light travels round them. The big loader (pages and games,
with an optional label and progress line), a small spinner for buttons, and a plain-CSS copy of the big one in
`index.html` that shows before any script has run. All of them run on the page's clock, so a hand-over never
restarts the light, and the boot screen stays up until the first page has mounted (`src/lib/boot.ts`). Local
storage keys still start with `lumen.` so existing wallets carry over.

## Backend (Supabase through Vercel)
The browser talks to Supabase directly. The public URL and key come from the build env
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, set by the Vercel Supabase integration) or, failing
that, from `/api/config` at runtime. All game and account logic in the database lives in SECURITY DEFINER
Postgres functions defined in `api/_lib/schema.js`.

Vercel functions in `api/`:
- `setup.js`: applies the schema when its version changes (`POST /api/setup`). Needs `POSTGRES_URL`.
- `auth.js`: sign-up (rate limited per IP) and account deletion, which need the service key.
- `config.js`: the public Supabase URL and key for the browser.
- `selftest.js`: an end-to-end check of Crash, Live Blackjack (on the hidden test table 99), Case Battles (on hidden
  battles of `g_selftest` guests, left out of the lobby) and accounts. It only answers `?key=` matching the
  `SELFTEST_KEY` env var (set in Vercel; keep a copy in an untracked `.env.local`).

Without the backend (or in the single-file preview) Crash runs the same rules locally for one player and
accounts are hidden.

## Multiplayer Crash
Rounds are shared by everyone through `crash_state`, `crash_bet` and `crash_cashout`. Rounds are created lazily
by whichever call sees the last one finish, the crash point is drawn on the server and only revealed once it
happens, and cash-outs are timed by the database clock. Signed-in players show up under their username.

## Multiplayer Blackjack
Live Blackjack seats up to five players at shared tables (six listed, from 1–100 up to 100–10,000). Everything
runs in Postgres functions (`bj_tables`, `bj_state`, `bj_sit`, `bj_bet`, `bj_action`, `bj_leave`, `bj_react`, ...):
like Crash, rounds advance lazily, so whichever call notices a deadline has passed deals, moves the turn on or
plays the dealer, under a per-table advisory lock. The shoe never leaves the database and the hole card is only
sent once the dealer plays; cards and results are sent up to a second early with the time they land, and the
browser reveals them on the server clock, so every player sees the same deal at the same moment. Browsers poll
`bj_state` (faster near a deadline, slower when only watching or hidden; unchanged states answer with a short
etag reply). Stakes leave the wallet when a bet or double is sent and sit in a per-round ledger in localStorage
until the round settles or is refunded, so a reload or a lost connection can't lose or double-pay a round
(`src/games/livebj/ledger.ts`). A round you walk away from plays on (your hands stand when their turn runs out)
and pays out wherever you are in the app: while a stake is open, `App.tsx` keeps calling `bj_tables` and
`bj_result` until it settles. One tab controls a seat; a duplicated tab watches until you choose Play here.
Without the backend the same rules run in the browser (`engine.ts`, `local.ts`) with house bots, marked BOT;
that code is its own chunk, fetched only when the shared tables don't answer.

## Case Battles
Two to four players open the same crates, one per round, side by side: 1v1, 1v1v1, 1v1v1v1 or 2v2 (the team totals
decide), with up to ten crates of any tiers at a stake of 1 to 10,000 per crate (a seat costs at most 100,000). The
biggest total wins the whole pot, or in a crazy battle the smallest; ties split it. Anyone can join an open battle
from the lobby or a shared link, and whoever sits in one can call the house bots to fill every empty seat. Everything
runs in Postgres functions (`cb_list`, `cb_state`, `cb_create`, `cb_join`, `cb_bots`, `cb_leave`, `cb_result`) under a
per-battle advisory lock: when the last seat fills, the same transaction draws every item, decides the winners and
sets the clock (a 3 s countdown, a round every 4.8 s, the winner 1.5 s after the last). Nothing can change after that,
so the browser gets the results at once and plays them on the server clock: every seat's reel is one Web Animation
whose time is set from the server, so everyone sees the same spins land at the same moment, and a page opened (or
reloaded) mid-battle picks the spin up where it is. Open battles nobody fills are called off after 15 minutes, lazily,
and a creator who leaves calls the battle off; battles are kept for a week after they end, so a stake left open
settles whenever its browser comes back. A player may sit in three open battles at once. Browsers poll `cb_state`
(quickly while a battle waits for players, then only to confirm the end) and `cb_list` in the lobby. The seat's cost
leaves the wallet when the create or join is sent and sits in a per-battle ledger in localStorage under a Web Lock
(`src/games/battles/ledger.ts`): it is paid out once when the winner is shown, refunded if the battle is called off or
the seat was never taken (a lost answer is resolved with `cb_result`, and a create whose answer was lost is found
among your own battles), and a battle you walk away from still pays out wherever you are, because `App.tsx` (and any
battle page you're watching) keeps calling `cb_result` while a stake is open. Without the backend the same rules run
in the browser (`engine.ts`, `local.ts`, battles kept in localStorage) against the house bots, who also open battles
of their own to keep the lobby busy; that code is its own chunk.

## Accounts
Email and password through Supabase Auth, with a username and one of 16 avatars. Signing up from a guest wallet
carries its coins into the new account. The wallet is cached on the device and saved a moment after it changes
(and when the page is hidden) with a revision number, so two devices can't silently overwrite each other: a
stale save is refused and the newer server copy wins. The Account page changes username, avatar and password,
logs out and deletes the account.

Password-reset emails need the Supabase project's Site URL and Redirect URLs set to the live site
(Authentication > URL Configuration), and a custom SMTP sender for anything beyond a few test emails.

## Economy (src/store/wallet.ts)
- Start with 1,000 coins.
- Daily bonus: 100 → 500 over a 7-day streak, 22h cooldown, streak resets after 48h.
- Levels: 1 XP per coin wagered, each level needs more XP; level-ups pay 75 × level.
- Emergency refill: 50 coins, only below 10 coins, once per 30 minutes.
- Vault Heist: crack up to eight dials by timing each pick; the bag holds 10, 25, 50, 90, 150, 250, 400 and 650
  coins after each vault, banked whenever you like and lost on a miss. Three lockpicks, one back every 45 min.
- Challenges: 21 one-time goals, one per game except Live Blackjack, plus Explorer and High Roller (e.g. 25× in
  Crash, a 2% Dice win); Live Blackjack rounds count towards Explorer and High Roller. Only bets of 25+ count.

## Game math
- Chicken Road: per-lane survival 90/80/70/55% (Easy → Daredevil), multiplier = 0.97 / survival^lanes.
- Mines: 5×5, multiplier = 0.97 / P(all picks safe).
- Plinko: 8/12/16 rows, low/medium/high risk tables.
- Crash: P(crash ≥ x) = 0.97 / x.
- Blackjack: 6 decks, dealer stands on soft 17, 3:2 blackjack, double on any two, one split.
- Live Blackjack: the same rules on a shared 6-deck shoe (reshuffled at a random cut between 234 and 260 cards),
  the dealer peeks with an ace or ten up, double after split allowed, 15 s per decision (8 s after a hit).
- Baccarat: Punto Banco on an 8-deck shoe (the first card sets the burn; once the cut card, 14 to 26 cards from the
  end, comes out, one last hand is dealt before the shuffle), naturals on 8 or 9, Player draws on 0 to 5, Banker by
  the full third-card tableau. Player 1:1, Banker 0.95:1, Tie 8:1 (Player and Banker push), Player Pair and Banker
  Pair 11:1. Exact house edges: Banker 1.06%, Player 1.24%, Tie 14.36%, each pair 10.36%
  (src/games/baccarat/rules.ts; `node --experimental-strip-types --import ./tools/ts-resolve.mjs
  tools/baccarat-test.ts` checks the tableau case by case, enumerates the shoe exactly and simulates rounds through
  the real shoe). The scoreboard (bead plate, Big Road) and the cards left in the shoe are kept on the device; a
  reload reshuffles the unseen cards.
- Dice: payout 99 / win chance, roll 0.00 to 100.00.
- Limbo: P(result ≥ x) = 0.99 / x.
- Keno: 40 numbers, 10 drawn, 1 to 10 picks, four risk tables at about 99% return (src/games/keno/tables.ts).
- Hi-Lo: endless deck, each correct call multiplies by 0.99 / P(call).
- Wheel: 10 to 50 segments, three risks; every table sums to 0.99 × segments.
- Cases: four crates, each a table of whole weights out of 100,000 that returns exactly 98%
  (src/games/cases/rules.ts). Wooden (low) 0.3× to 10×, 1× or more 36.8% of the time; Steel (medium) 0.2× to 100×,
  26.8%; Gold (high) 0.1× to 500×, 13.5%; Obsidian (extreme) 0.1× to 1,000×, 7.2%, with 100× or more 1 in 571. The
  item is drawn when the crate opens and the reel is built to stop on it, its fillers drawn from the same table.
  Open one to five crates at once: one item is drawn for each, separately, and their reels stack up and land one
  after another; the stake is bet × crates and the round settles once, with the best multiplier recorded.
  Rarity follows the multiplier: under 1× common, 1× uncommon, 2× rare, 10× epic, 100× legendary
  (`node --experimental-strip-types --import ./tools/ts-resolve.mjs tools/cases-test.ts` checks the sums and samples
  the picker).
- Case Battles: every seat pays unit × crates and draws from the same Cases tables, so each seat's expected return
  is 98% of its cost in every mode (the seats are symmetric): exactly 98% with whole-coin stakes, a hair under when
  odd cents or a three-way split leave a fraction of a cent. The pot is unit × the sum of every multiplier drawn,
  floored to the cent, and each winner gets floor(pot / winners × 100) / 100; the offline stand-in decides with the
  same arithmetic (`tools/battles-sql/crosscheck.mjs` checks it against the SQL battle by battle).
- Duck Derby: six ducks; before each race the chances 32/22/16/12/10/8% are dealt to them at random. The whole
  finishing order is drawn when the race starts by successive weighted sampling (Harville: the winner by the chances,
  then second from the rest renormalised, and so on). Win (first), Place (first or second, P = pᵢ + Σⱼ pⱼpᵢ/(1 − pⱼ))
  and Forecast (exact first and second, P = pₐp_b/(1 − pₐ)) each pay 0.97 / P exactly, so every bet returns 97%: Win
  3.03× to 12.13×, Place 1.68× to 5.54×, Forecast 9.37× to 111.55×. One stake for the whole slip (up to 12 bets),
  one settle when the podium shows; the race (src/games/derby/race.ts) is built to end in the drawn order
  (`node --experimental-strip-types --import ./tools/ts-resolve.mjs tools/derby-test.ts` enumerates all 720 orders
  on all 720 deals with exact fractions; `tools/derby-race-test.ts` checks thousands of planned races).
- Roulette: European single zero, a bet covering n numbers pays 36 / n.
- Pop Party: 7 × 7 floor; 5+ touching balloons pay, winners pop and the rest float up until nothing wins. Every
  pop lights the tile underneath, and each further pop doubles it up to ×128; a win is multiplied by the sum of
  the tiles under it. 3+ disco balls pay 2× to 100× and start 10 to 30 free spins (Disco Night), where the floor
  stays lit. Pump It! (paid spins) and Pin Drop (free spins) rescue dead drops. Buy 10 free spins for 100×, Super
  (every tile starts at ×2) for 525×; Party Mode costs 1.25× and starts Disco Night about 1.6× as often. Max win
  10,000×. Simulated return 96.0% for paid spins and for Party Mode, 96.1% for the 100× buy and 95.8% for Super,
  each within ±0.12 at 95% confidence (`node --experimental-strip-types tools/popparty-sim.ts`).
- Chompers: 5 × 4 reels, 1,024 ways; wilds land on reels 2 to 5 and each one eats every donut on the screen.
  3, 4 or 5 eggs pay 2×, 5× or 20× and start 10, 15 or 20 free spins (1 in 247 paid spins), where every fourth
  wild adds 10 spins and lifts the donut multiplier to 2×, 3× and then 10×. Each feature opens with a Feast Pick
  modifier: hungry (starts at 2×) 28%, donut rain 32%, wild crowd 15% or +5 spins 25%. Buy 10 free spins for
  100×, Super Feast (starts at 2× and adds a second modifier) for 175×; Hungry Mode costs 1.25× and starts free
  spins about 1.55× as often (1 in 159). Max win 10,000×. Simulated return 96.1% for paid spins, Hungry Mode,
  the 100× buy and Super, each within ±0.07 at 95% confidence (`node --experimental-strip-types tools/chompers-sim.ts`).
- Robo Riot: 5 × 5 tubes, 3,125 ways from the left (wilds on reels 2 to 5; hit rate 58%). Power cells and Magnet,
  Zap and Boost bots carry values from 1× to 50×; 6+ start the Power Grid (1 in 233 paid spins, 23% of them through
  Volt's Power Surge when 4 or 5 land): they lock on 25 sockets, every empty socket respins on its own and any
  arrival resets the respins to 3. Bots work on the power cells only, never on each other: Zap bots double 3 random
  cells, Boost bots add their value to every cell, Magnet bots collect every cell's value, and each bot pays its own
  value too. Gold bots land only on respins (13% of Power Grids) and fire again whenever a new cell clamps in; a
  full board (1 in 259) doubles the total. Buy the Power Grid for 100×, Super (a gold bot from the start) for 425×;
  Overclock costs 1.25× and starts the Power Grid 1.63× as often (1 in 143). Max win 20,000×. Simulated return
  96.0% for paid spins, 96.1% for Overclock, the 100× buy and Super, each within ±0.07 at 95% confidence
  (`node --experimental-strip-types tools/roboriot-sim.ts`; tests in `tools/roboriot-test.ts`).
- Video Poker: Jacks or Better, 9/6 full pay (about 99.5% with perfect play); "Best hold" picks the hold with
  the highest expected return.
