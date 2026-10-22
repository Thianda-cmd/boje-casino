# Boje Casino (play money)

A Stake-style casino with thirty-seven games. Originals: Showtime (a game-show money wheel), Bullseye (darts), Market
Rush (a live trading chart), Banker's Deal (briefcases and a Banker's offers), Pot Luck (a live player-versus-player
pot), Summit (a mountain climb), Chicken Road, Crash, Double, Coin Flip, Reef Raid, Mines, Plinko, Dice, Limbo, Keno, Hi-Lo,
Wheel, Cases, Case Battles, Duck Derby, Lucky Claw, Penalty Shootout and Scratch & Win. Slots: Lucky Lines, Plunder Bay, Chompers, Pop Party and Robo Riot. Table games:
Blackjack, Live Blackjack, Baccarat, Sic Bo, Craps, Hold'em Showdown, Roulette and Video Poker.
Vault Heist (a skill game) and Casino Tycoon (an idle game) are free and pay coins. Coins are play money only. Guests keep their wallet in the
browser (localStorage); signed-in players have it saved to their account.

## Run
    npm install
    npm run dev            # http://localhost:5173
    npm run build          # static site in dist/ (relative paths, hash routing)
    npm run build:single   # one self-contained HTML file in dist-single/ (offline, no accounts)

## Stack
Vite + React 19 + TypeScript, Tailwind CSS v4, Framer Motion, Zustand, supabase-js. Plinko and Crash draw on
canvas; the slots (Chompers, Pop Party, Robo Riot and Plunder Bay) are three.js scenes, loaded only when the game opens.
The wallet is saved to localStorage in batches (src/lib/storage.ts): its writes, and Reef Raid's ledger with them, land
together at the end of a task and at most every 250 ms while they keep coming, any other write lands them first, and
hiding or leaving the page writes everything at once (`tools/storage-test.ts`). Hash
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
`src/games/chompers/`, `src/games/popparty/`, `src/games/roboriot/` and `src/games/plunder/`). No image files ship.

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
  battles of `g_selftest` guests, left out of the lobby), Double (reads, and a bet the server refuses, so nothing
  shows in the shared columns) and accounts. It only answers `?key=` matching the `SELFTEST_KEY` env var (set in
  Vercel; keep a copy in an untracked `.env.local`).

Without the backend (or in the single-file preview) Crash runs the same rules locally for one player, Double runs
them locally against house bots, and accounts are hidden.

## Multiplayer Crash
Rounds are shared by everyone through `crash_state`, `crash_bet` and `crash_cashout`. Rounds are created lazily
by whichever call sees the last one finish, the crash point is drawn on the server and only revealed once it
happens, and cash-outs are timed by the database clock. Signed-in players show up under their username.

## Multiplayer Double
One strip of 33 tiles (0 green, 1–16 red, 17–32 black) is spun for everyone through `dbl_state`, `dbl_bet` and
`dbl_round_info`. Rounds repeat like Crash's, created lazily under an advisory lock by whichever call sees the last one
finish: 15 s of betting, a 6 s spin, then 3 s showing the winners. Each round commits to sha256(seed) when it is
created; betting closes half a second before the spin, when the roll is revealed, so every browser starts the same
spin on the server clock (one Web Animation of transform only whose time is set from the server, so a page opened or
reloaded mid-spin picks it up where it is), and the seed is revealed once the strip lands. A player may back several
colours and add to a bet until betting closes, up to 100,000 per colour; the columns list the 30 biggest bets per
colour by username (or guest name), never by id. Browsers poll `dbl_state` around the close, the spin and the landing
(slower when hidden), and the 100-roll history is only sent when it has changed. Chips leave the wallet when they are
sent and wait in a per-round ledger in localStorage under a Web Lock (`src/games/double/ledger.ts`): a round settles
once, on what the browser paid and the server holds, so a chip that never reached the table comes back and a refused
one is refunded at once; a round missed while away settles the next time Double opens, because each poll names the
browser's unsettled rounds (`p_open`) and `dbl_state` returns the player's bets on any of them that have landed, however
many rounds came after (a stake older than the three days rounds are kept counts as lost). Without the backend the
same rules run in the browser with house bots (marked BOT): rounds follow the wall clock and each seed is sha256 of a
secret kept on the device, so every tab, and a reload, sees the same rounds.

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
Email and password through Supabase Auth, with a username and an avatar (16 free, 16 more earned or bought).
Signing up from a guest wallet carries its coins into the new account. The wallet is cached on the device and saved
a moment after it changes (and when the page is hidden) with a revision number, so two devices can't silently
overwrite each other: a stale save is refused and the newer server copy wins.

The Account page (src/pages/account/) is a casino account dashboard: an overview on the player's banner (balance,
VIP progress, an account number), Customize (a wardrobe with a live preview of the profile), the cosmetics Shop,
Statistics, a unified History of bets, rewards and purchases, Achievements (pick three for the showcase), Settings
and security (username, email, password, bio, privacy, log out, delete) and Responsible play.

Cosmetics and achievements (src/store/cosmetics.ts): 32 avatars, 14 frames, 12 banners, 9 name colours and 13 titles,
each free, earned (a level, a VIP tier, a challenge or an achievement) or sold for coins; bought items are kept in the
wallet's `owned`, unlocks are worked out from the wallet. Achievements are milestones (rounds, coins wagered, the
biggest win, the daily streak, Vault Heist, VIP tiers) plus one per challenge. The look, bio and privacy (share
stats, share big wins, appear in search and the leaderboards) are kept in the wallet, so they are saved with it.

Public profiles (src/pages/Player.tsx at #/player/<name>, src/lib/profiles.ts): the server's profile_view reads a
signed-in player's saved wallet and returns only what is public: the look (every id checked against a whitelist of
the catalog), bio, level, member since, online, and, if shared, stats, favourite games, achievements and recent big
wins. The Players page (#/players) searches players and shows the leaderboards (top level, most wagered, biggest
win, online now, newest). Names of signed-in players in Crash, Double, Pot Luck, Live Blackjack and Case Battles
open their profile (a hover card on desktop, a tap card on phones); guests' names are plain text. A signed-in
player's browser pings presence every minute while the page is in view. (`tools/profile-test.ts`,
`tools/profile-sql/test.mjs`, `tools/profile-sql/live-names.mjs`, `tools/account-check.mjs`,
`tools/community-check.mjs`.)

Responsible play (store/wallet.ts Limits), as a real casino offers it, on play money: a daily loss limit (stakes
less payouts since midnight; lowering it takes effect at once, raising or removing it after 24 hours), a session
reminder every so many minutes, and a cool-off (1 hour to 30 days) that can't be ended early. placeBet refuses a bet
the limits don't allow and says why.

Password-reset emails need the Supabase project's Site URL and Redirect URLs set to the live site
(Authentication > URL Configuration), and a custom SMTP sender for anything beyond a few test emails.

## Economy (src/store/wallet.ts)
- Start with 1,000 coins.
- Daily bonus: 100 → 500 over a 7-day streak, 22h cooldown, streak resets after 48h.
- Levels: 1 XP per coin wagered, each level needs more XP; level-ups pay 75 × level. VIP tiers (Bronze, Silver, Gold,
  Platinum, Diamond at levels 0, 5, 12, 25, 40) set the rakeback rate (0.2%, 0.3%, 0.4%, 0.5%, 0.75% of every stake,
  set aside as you play and claimable any time) and pay a one-time tier-up bonus (1,000, 3,000, 8,000 and 20,000).
- Daily missions (src/store/rewards.ts): three a day, the same for everyone on a given date, one from each group
  (play rounds or wager coins; play different games or the day's featured game; land a big multiple or win rounds),
  paying 60 to 180 each; rounds count from 10-coin bets. Claiming all three unlocks one Lucky Wheel spin (50 to 1,000
  coins, about 159 on average), drawn when spun and kept until collected. They reset at local midnight. The last 40
  rewards are kept as a history.
- Emergency refill: 50 coins, only below 10 coins, once per 30 minutes.
- Vault Heist: crack up to eight dials by timing each pick; the bag holds 10, 25, 50, 90, 150, 250, 400 and 650
  coins after each vault, plus a bonus for each gold notch hit, banked whenever you like and lost on a miss. Three
  lockpicks, one back every 45 min; practice runs cost none and pay nothing.
- Casino Tycoon (src/games/tycoon/engine.ts): an idle game. Ten attractions earn Cash, the game's own currency, in
  cycles; counts of 25, 50 and 100 halve an attraction's cycle and every 100 from 200 doubles its pay; managers run
  them while away (8 hours, 12 with a perk); 33 upgrades double pay; selling the casino gives Stars (25 × ∛(lifetime
  Cash / 10¹²)), each +2% to all pay, five cities and five perks. Cash never turns into coins: coins come from the
  Coin Vault, which fills at 10 to 62 coins an hour by progress and holds 4 to 9 hours' worth, from 32 one-time
  milestones (about 13,000 coins in all) and from golden chips (5 to 20) offered to an active player. The save is
  part of the wallet, so an account carries it (`tools/tycoon-test.ts` checks prices, the clock, the vault and
  sales; `tools/tycoon-sim.ts` plays it for pacing: a dedicated player reaches Riverside on day 2 and Monaco Heights
  around day 14, earning roughly 600 to 2,000 coins a day).
- Challenges: 32 one-time goals, one per game except Live Blackjack, plus Explorer and High Roller (e.g. 25× in
  Crash, a 2% Dice win); Live Blackjack rounds count towards Explorer and High Roller. Only bets of 25+ count,
  except towards High Roller, which counts every bet.

## Game math
- Chicken Road: per-lane survival 90/80/70/55% (Easy → Daredevil), multiplier = 0.97 / survival^lanes.
- Mines: 5×5, multiplier = 0.97 / P(all picks safe).
- Plinko: 8/12/16 rows, low/medium/high risk tables.
- Crash: P(crash ≥ x) = 0.97 / x.
- Double: 33 tiles, roll = the first 52 bits of sha256(seed + ":double") mod 33. Red (1–16) and black (17–32) pay 2×
  (16/33 × 2), green (0) pays 32× (1/33 × 32), so every bet returns 32/33 = 96.97%; one stake and one settle per round
  over all your colours (`cd tools/double-sql && node test.mjs` runs the rounds on PGlite, checks the 33 rolls are
  uniform and match the browser's formula, and the payouts).
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
- Lucky Claw: eight prize plushies tagged 1.5×, 2×, 3×, 5×, 10×, 25×, 50× and 100×; the grab wins with chance
  exactly 0.97 / multiplier (a whole number of ways out of 30,000: 19,400 down to 291), so every prize returns 97%
  (64.67% down to 0.97%). The outcome is drawn when the claw drops (src/games/claw/rules.ts); how a loss looks (slips
  on the lift 30%, wriggles free mid-carry 28%, bounces off the chute 20%, grabs the neighbour 22%) and whether a win
  gives a scare on the way are drawn from the outcome alone, the same for every prize. One stake per grab, one settle
  when the outcome shows (`node --experimental-strip-types --import ./tools/ts-resolve.mjs tools/claw-test.ts`
  checks the sums exactly, samples the win rates and checks that the show only follows the outcome).
- Penalty Shootout: the goal mouth is six zones and the keeper covers 1 to 4 of them on his dive (Easy, Medium, Hard,
  Expert), so a shot scores with chance p = 5/6, 4/6, 3/6 or 2/6 wherever it is aimed. Pay the bet, take up to 10
  penalties and cash out after any goal; a save ends the run with nothing. Cashing out after n goals pays 0.97 / pⁿ
  floored to the cent (worked in whole numbers): Easy 1.16× to 6.00×, Medium 1.45× to 55.93×, Hard 1.94× to 993.28×,
  Expert 2.91× to 57,277.53×, and ten goals in a row (a Perfect 10) cash out by themselves. The game has no memory, so
  every way of playing returns 97% before the floor: exactly 97% on Hard and Expert, 96.53% to 97% on Easy and Medium.
  Each shot is drawn when it is struck, from one number and before its zone is looked at (src/games/penalty/rules.ts);
  the keeper's read (a random set of his zones that holds the shot on a save and misses it on a goal), his dive (at
  the ball on a save, to the read zone nearest it on a goal, which makes the fingertip near misses) and how the ball
  goes in or is kept out are drawn after it, from the outcome. On a goal the scene plans his dive so that no part of
  him touches the ball as drawn, seen from the camera, all the way in (`node tools/penalty-qa-honest.mjs` drives the
  scene through every keeper, zone and outcome on the dev server and measures it against his meshes). One tap on a
  zone shoots there; money only moves on a deliberate press (taps in quick succession only hurry the show, never line
  up a shot or start a run, and for 1.2 s after a run ends, however it ended, a press only hurries). One stake
  per run, taken with the first shot; from each shot's draw the run's value is kept as a pending payout, so it settles
  once: on a cash-out, when a save shows, after a Perfect 10's celebration (so nothing covers it), or, cashed out and
  said so, as soon as the page is left mid-run (`node --experimental-strip-types --import ./tools/ts-resolve.mjs
  tools/penalty-test.ts` checks every multiplier and return with exact fractions, replays random streams through all
  six zones, samples the scoring rate per zone and checks the keeper's reads and dives).
- Scratch & Win: four cards, nine symbols under the foil out of twelve per card (eight prizes and four blanks that never
  pay); three of a kind win that symbol's prize, at most one prize a card. Each prize table is whole weights out of
  1,000,000 and returns exactly 96%: Lucky Clover (low) 1× to 100×, wins 39.27% of the time; Gold Rush (medium) 1× to
  500×, 27.22%; Fruit Frenzy (medium-high) 1× to 250×, 17.07%, its grid returning 60% times a Frenzy spot drawn on its own
  (×1 65%, ×2 23%, ×3 8%, ×5 3%, ×10 1%, ×1.6 on average), so up to 2,500× (the seven with the ×10 spot, 1 in 333,333);
  Diamond Deluxe (high) 1× to 5,000×, 12.49%, the diamond 1 in 22,727. Standard deviations 3.5, 8.9, 11.0 and 34.9. The
  prize is drawn when the card is bought and the board built to show it (src/games/scratch/rules.ts): the winning symbol
  on three cells picked uniformly, every other cell filled uniformly from the card's other symbols, blanks included, with
  no symbol more than twice, so a card never shows a second win and the top symbol shows as a near-miss pair exactly as
  often as a blank (a losing card shows 0/1/2/3/4 pairs 2.5/22/47/26/3% of the time). A card's "top prize" (the
  `scratch-top` challenge, the Jackpot stamp) is its top symbol, whatever the Frenzy spot says; the celebration's title
  goes by the multiple (Big win 50×, Mega 250×, Epic 1,000×, Legendary 2,500×). Reveal all and autoplay only choose the
  order the coin works in (src/games/scratch/reveal.ts: with two of a top-three prize out, the deciding cell goes last),
  and a Gold Rush dynamite only blasts foil off its row. One stake per card (a stack of 5 or 10 is staked at once, every
  card's prize drawn then; autoplay buys one card a round), one settle per card: when its last foil comes off, or for a
  celebrated win when the coins reach the balance (or the celebration is skipped; until it starts the card can't be put
  away); leaving with cards still owed pays each of them once, and they are shown again "Paid while away"
  (`node --experimental-strip-types --import ./tools/ts-resolve.mjs tools/scratch-test.ts` checks the sums in integers,
  reads thousands of boards back, tests their independence from everything but the prize and samples the draw;
  `tools/scratch-qa-rtp.ts` re-derives the returns and the pair spread on its own and pays boards read back blind).
- Coin Flip: call Heads (the Boje gem, green) or Tails (the crown, on blue), pay the bet and flip; a flip wins with
  chance exactly 1/2 whatever is called. After a win cash out or flip again, calling either side; a loss ends the streak
  with nothing. Cashing out after n wins pays 0.97 × 2ⁿ (97 × 2ⁿ hundredths, so always whole cents: 1.94×, 3.88×, 7.76×
  up to 63,569.92× after 16), and the sixteenth win cashes out by itself. The game has no memory, so every way of
  playing, any stopping rule and any calls, returns exactly 97% on whole-coin bets (odd-cent payouts are floored to the
  cent, worked in whole numbers, which costs less than a cent a streak). Each flip is drawn when it is thrown, from one
  number and before the call is looked at (src/games/coinflip/rules.ts); the face follows from the outcome and the
  call. The coin's flight is real rigid-body physics worked out ahead (src/games/coinflip/physics.ts: a disc on a
  sprung, damped velvet with friction and rolling drag, the rim's lowest point found exactly, so it bounces, rolls on
  its rim and spins down like Euler's disk), and a flight is shown landing on the drawn face only by turning the disc
  within itself (it is the same disc either way up and at any turn about its axis) and turning the whole flight about
  the vertical so it is flicked from the camera's side (the table and gravity are the same from every side), so it
  starts exactly as the coin lay and its height, tilt and bounces are the flight's own. The result is called once the
  face is decided (the coin never passes upright again) and the coin stays within 30° of flat, while it still rolls and
  wobbles; then the camera circles the resting coin until its emblem stands upright (the coin is never moved). Flips
  early in a streak and turbo are quick (about 1.4 s and 0.75 s to the result); from three wins the landing is shown low
  and in slow motion (about 2.3 s). One stake per streak, taken with the first flip; from each flip's draw the streak's
  value is kept as a pending payout (meta: flips, cashed, sides), so it settles once: on a cash-out, when a losing face
  shows, or, cashed out and said so, as soon as the page is left mid-streak (a streak paid as the page began to leave
  is over even if the page stays, as after a cancelled navigation: it is never flipped on or paid again; a streak lost
  while away is announced too) (`node --experimental-strip-types --import ./tools/ts-resolve.mjs
  tools/coinflip-test.ts` checks every multiplier and the floor, the return of every stopping point and thousands of
  mixed strategies with exact fractions, samples random strategies on the real draw, and checks that the same random
  stream wins on the same flips whatever is called; `tools/coinflip-physics.ts` checks that every accepted flight, from
  any rest pose and turned to any side, starts as the coin lay and ends flat on the drawn face, and that the result is
  only called once the face can no longer change).
- Reef Raid: a fish-table arcade game. Creatures swim across the reef and every torpedo costs the cannon's level (1 to
  100 coins); it bursts into a net on the first creature it touches, which is caught with chance 0.97 / its value and
  then pays value × the shot's cost, so every shot returns exactly 97% whatever it hits (aiming only trades the size of
  a win against its odds). Values: clownfish 2×, blue tang 3×, pufferfish 4×, angelfish 6×, seahorse 8×, sea turtle
  12×, octopus 20×, manta ray 30×, hammerhead 60×, Golden Whale 200×. The bomb crab (10×) also catches every ordinary
  creature in its blast and the zap jelly (5×) up to 6 linked ones, all as one catch whose value is the sum (taken at
  the moment of the hit); the treasure chest spins a wheel of 20× to 150× and is caught with chance 0.97 / the wheel's
  mean (56.875). Each hit is decided once, the moment the net touches (src/games/reef/rules.ts `resolveHit`); a torpedo
  that touches nothing in 8 s fizzles and is refunded. Shots are charged as they are fired and catches paid as they
  land (a chest's once its wheel stops); they are recorded in batches (every 100 shots, or once the reef has been quiet
  for 3 s) through a ledger that is saved as it changes, so a closed or crashed page refunds the torpedoes still in the
  water, pays any chest win still owed and records the shots that landed, once (`tools/reef-test.ts` checks every species' return exactly and by sampling, the wheel, and
  thousands of random sessions against a mock wallet: no coin is ever lost or invented).
- Lucky Lines: a 5 × 5 bingo card (column c holds five numbers from 15c+1 to 15c+15) played with five reels, one per
  column. Each spin lands, per reel, out of 15 + 1 + 0.25 + 0.5: one of the column's 15 numbers (marked if it is on
  the card), a Joker (mark any number in that column), a Super Joker (any number on the card) or, on paid-up spins, a
  Free Spin. Rows, columns and diagonals are lines; the ladder pays 0.3×, 0.75×, 1.5×, 2.5×, 5×, 10×, 20×, 40× and 80×
  for 2 to 10 lines and 500× for a full card. A game is 10 spins plus free spins (1.75 a game on average); placing
  jokers as suggested it returns 95.5% (3 million games, ±0.9; `tools/lines-sim.ts`). Then up to 10 extra spins can be
  bought one at a time, each priced at the exact expected rise of the ladder over one spin (every combination of the
  five reels counted, jokers placed as suggested) ÷ 0.97, so each returns 97% of its price. The game is saved after
  every step and resumes after a reload (`tools/lines-test.ts` checks the cards, the reel weights, jokers, lines and
  the ladder, and the extra spin's value against a simulation).
- Craps (src/games/craps/rules.ts): Pass Line and Don't Pass (1.41% and 1.36% house edge), Come and Don't Come with
  their own points, free odds behind them at true odds (3-4-5× behind pass, lays up to 6× the flat bet; 0% edge; come
  odds off on the come-out), place bets (9:5, 7:5, 7:6; off on the come-out unless working), the Field (2 pays 2:1, 12
  pays 3:1; 2.78%), hardways (7:1 and 9:1), one-roll props (Any 7 4:1, Any Craps 7:1, Aces and Boxcars 30:1, Ace-Deuce
  and Yo 15:1) and the Fire Bet (4, 5 or 6 different points before a seven-out pay 24:1, 249:1, 999:1; returns 79.2%,
  worked out by a Markov chain). Bets stay on the table across rolls and are saved; each roll is drawn when thrown
  and applied once, even if the page closes mid-throw. A decided bet counts as one wager; a place bet that wins pays
  and stays up (`tools/craps-test.ts` checks every bet on every roll from every table state against a direct reading
  of the rules, the exact edges, the Fire Bet by simulation, and long random sessions for coin conservation).
- Hold'em Showdown (src/games/holdem/rules.ts): heads-up Texas Hold'em against the dealer. Ante and an equal Blind
  (and an optional Trips); check or bet 4× or 3× before the flop, 2× on the flop, 1× or fold on the river. The dealer
  qualifies with a pair. A win pays the Play 1:1, the Ante 1:1 (returned if the dealer didn't qualify) and the Blind
  by hand (straight 1:1, flush 3:2, full house 3:1, quads 10:1, straight flush 50:1, royal 500:1); a tie returns
  everything. Trips pays 3, 5, 6, 8, 30, 40, 50 to 1 on the player's hand, folded or not, and returns 98.1%. Played by
  the built-in advice (a pre-flop chart, the flop rules, and on the river the exact best move over every dealer hand
  that can still come) it returns about 99.3% of everything wagered (`tools/holdem-test.ts` checks the evaluator on
  all 2,598,960 five-card hands and the known seven-card frequencies, every settlement rule, and the returns).
- Roulette: European single zero, a bet covering n numbers pays 36 / n.
- Bullseye (src/games/darts/rules.ts): three darts at a regulation board, paid on their total (0 to 180). The player
  picks a target (Treble 20, Treble 19 or the Bull) and a thrower (Pro, Regular, Wild: a round Gaussian scatter of 14,
  26 or 42 mm). Each region's chance is the scatter integrated over it on a polar grid whose cells line up with the
  wires, so the odds are exact up to a few parts in a million (and match a million continuous throws per setup); a
  dart is drawn by region from that table, then placed inside its region. Totals follow by convolution. Each of the
  nine setups has its own paytable: nothing below par (the total beaten 42% of the time), from par up c / T^0.86
  where T is the chance of that total or more, rounded to tidy steps and capped at 10,000×, with c solved so the
  table returns as close to 97% as it can without going over (96.93% to 97.00%). `tools/darts-test.ts` checks the
  geometry, the grid against continuous throws, every table and sampled rounds.
- Banker's Deal (src/games/deal/rules.ts): sixteen briefcases on one of three boards of prizes (multiples of the
  stake): Classic (top 5×, average 0.857×), Gold (top 25×) and Diamond (top 250×, one game in 500), with Gold's
  chance solved so that playing every game to the end returns exactly 96%. The player keeps a case and opens the rest
  in rounds of 4, 4, 3, 2 and 1; after each round, and at the final two (where the player may also swap), the Banker
  offers 75%, 84%, 90%, 94%, 97% and 99% of the unopened prizes' average, less up to 3% for his mood, rounded down.
  An offer never exceeds what the player's case is worth on average, so no way of playing returns more than 96%
  (dealing at the first offer returns about 70%, at the final two about 94%). A case's prize is drawn only when it is
  opened (the player's at the end), so a stored game never holds a prize the player hasn't seen; each draw and offer
  is stored before it is shown. `tools/deal-test.ts` checks the boards, the course of a game, every offer's bound,
  the fairness of the draws and six ways of playing.
- Summit (src/games/summit/rules.ts): ten pitches to the summit; at each the player picks a route, Trail (holds
  90%), Ridge (66%), Cliff (40%) or Sheer Wall (20%), which multiplies the climb by 1/p when it holds and ends it
  when it doesn't. Banking after any pitch pays the stake × 97% × every step climbed (capped at 10,000×, which only
  the boldest routes reach), so every mix of routes and every moment to bank returns exactly 97% until the cap. Each
  pitch is drawn when its route is chosen and stored before it is shown; a climb in progress resumes after a reload
  and is paid once (`tools/summit-test.ts`, `tools/summit-money.mjs`).
- Pot Luck (src/games/pot/rules.ts): a live pot on the database clock (20 s of betting, the draw, the winner). Every
  cent paid in is a ticket, numbered in the order paid; the draw takes u from sha256(seed + ':pot') (the hash of the
  seed is published when the round opens) and the holder of ticket floor(u × tickets) wins the pot less a 4% rake.
  So each player's chance is their share of the pot and every coin returns 96% on average, whoever else plays. House
  bots (2 to 5 a round, 5 to 5,000 coins each) keep rounds going; their coins are the house's. `tools/pot-test.ts`
  checks the tickets, the draw, every player's exact return over random rounds, the limits and the bots' plan.
- Market Rush (src/games/market/rules.ts): a price that ticks ten times a second as a martingale (each tick multiplies
  it by 1 + σz with z bounded, mean 0, variance 1; σ by the market's mood, Calm, Steady or Wild). A position Up or Down
  at 1× to 100× leverage costs a 2% fee and is worth margin + notional × the price's move, so closing at any moment is
  worth the stake less the fee on average. It is liquidated, for nothing, at 20% of its stake; a tick can only carry it
  a bounded way past that line, so liquidation is on average a gain for the house and no way of playing returns more
  than 98% (`tools/market-test.ts` simulates seven strategies at 1×, 10× and 100×). A position worth 1,000 stakes
  closes itself. The price is stored before each tick is drawn on screen, and leaving the page closes open positions
  at the current price.
- Showtime (src/games/showtime/rules.ts): a 54-segment money wheel, 21 × 1, 13 × 2, 7 × 5, 4 × 10 (paying their value
  to 1) and four bonus rounds: Coin Toss (4 segments; a multiplier on each face of a tossed coin), Peg Drop (2; a puck
  drops onto 16 slots, two of them DOUBLEs that double the row and drop again), Prize Wall (2; the player picks one of
  60 hidden prizes) and Mega Spin (1; a 64-segment wheel with 4 DOUBLEs and 2 TRIPLEs that multiply the wheel and spin
  it again; the player picks one of three flappers). Bonus wins are capped at 20,000×. Before every spin the Booster
  lights one spot with ×2 to ×50 (or misses, 32.5% of the time); a boosted spot's win, or every multiplier of a
  boosted bonus round, is multiplied. The Booster's chance for each spot is solved from the exact (capped) bonus
  distributions so every spot returns exactly 96%. The whole round, bonus included, is drawn at Spin; the tile or
  flapper the player picks is shown the drawn result, which is equivalent since all are alike until revealed
  (`tools/showtime-test.ts` checks the exact returns, the shape of drawn rounds and a 3-million-round sample;
  `tools/showtime-money.mjs` checks every round is paid once when the show ends, the page is left or reloaded
  mid-show, or a page died).
- Sic Bo: three dice, 52 spots: Small / Big and Odd / Even (1 to 1, lose on any triple), the totals 4 to 17 (50, 25,
  15, 10, 7, 6, 5 to 1 from the ends inwards), doubles (8 to 1), triples (160 to 1), any triple (24 to 1), the 15
  two-dice combinations (5 to 1) and the singles (1, 2 or 14 to 1 as the number shows on one, two or three dice).
  Lucky strikes: before the dice are shaken, each of the 42 lucky spots (totals, doubles, triples, any triple,
  combinations) is struck on its own with a fixed chance, and if none is, one is picked by the same weights (about
  3.2 strikes a roll); a struck spot's odds are multiplied by ×2 to ×25 (triples ×2 to ×6), up to 1,000 to 1. The
  strike chances are solved so that every lucky spot returns exactly 97%; Small, Big, Odd, Even and the singles
  return 97.22%. The strikes and the dice are drawn together when the dice are rolled, from separate numbers, so the
  dice never depend on the strikes. The dice really tumble: src/games/sicbo/physics.ts simulates three rounded cubes
  in the shaken dome (corner and edge contacts against the felt, a slippery cove, the glass and each other) from the
  previous roll's resting poses, planned in a worker while the strikes play, and each die is shown landing on its
  drawn face only by turning its pips within the body while it flies clear of everything (a cube is the same cube
  after a quarter, third or half turn), so its path is physics' own (`tools/sicbo-physics-test.ts` plays all 216
  outcomes, normal and turbo, and checks the faces, the rest poses, overlaps and that pips only turn in clear flight;
  `tools/sicbo-test.ts` checks every spot's payouts on all 216 rolls against an
  independent reading of the rules, every spot's exact return, and samples the strikes, multipliers, dice and returns).
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
- Plunder Bay: Megaways, six reels that land 2 to 7 symbols each on every spin, so 64 to 117,649 ways (about 1,270
  on an average paid spin), paid from the left; the Jolly Roger is wild on reels 2 to 6. Winners blast away and the
  rest cascade down until nothing wins (hit rate 34%, the cascades add 58% to the first board's wins). 4, 5 or 6+
  treasure maps pay 2×, 5× or 20× and start 12, 17 or 22 free spins (Treasure Hunt, 1 in 251 paid spins), on reels
  where the crew is commoner than the low symbols; 3, 4 or 5+ maps there add 5, 8 or 12 spins (up to 100). The win
  multiplier starts at ×1 and rises by one after every winning cascade step, never resetting in the hunt: a 12-spin
  hunt ends on ×7.7 on average and reaches ×10 in 26% of them (30% of natural hunts). Buy 12 free spins for 100×:
  median 41×, under 10× 18% of the time, 100× or more 26%. Max win 20,000× (about 1 in 1.7 million buys, an
  estimated 1 in 365 million paid spins; it takes under 0.01% of the return). Simulated return 96.05% for paid
  spins and 96.10% for the buy, each within ±0.06 at 95% confidence (`node --experimental-strip-types
  tools/plunder-sim.ts`; tests in `tools/plunder-test.ts`).
- Video Poker: Jacks or Better, 9/6 full pay (about 99.5% with perfect play); "Best hold" picks the hold with
  the highest expected return.
