# Boje Casino (play money)

A Stake-style casino with thirteen games. Originals: Chicken Road, Crash, Mines, Plinko, Dice, Limbo, Keno, Hi-Lo
and Wheel. Table and machine games: Blackjack, Roulette, Slots and Video Poker. Vault Heist is a free skill game
that pays coins. Coins are play money only. Guests keep their wallet in the browser (localStorage); signed-in
players have it saved to their account.

## Run
    npm install
    npm run dev            # http://localhost:5173
    npm run build          # static site in dist/ (relative paths, hash routing)
    npm run build:single   # one self-contained HTML file in dist-single/ (offline, no accounts)

## Stack
Vite + React 19 + TypeScript, Tailwind CSS v4, Framer Motion, Zustand, supabase-js. Plinko and Crash draw on
canvas; Slots is a three.js scene, loaded only when the game opens. Hash routing and relative asset paths mean `dist/` works as-is inside Capacitor:

    npm i @capacitor/core @capacitor/cli && npx cap init "Boje Casino" com.example.boje --web-dir dist
    npm i @capacitor/ios @capacitor/android && npx cap add ios && npx cap add android
    VITE_API_BASE=https://lumen-casino.vercel.app npm run build && npx cap sync

A native build has no same-origin `/api`, so `VITE_API_BASE` points it at the deployed site.

## Art
Chicken Road is the only pixel-art game (src/lib/pixel.ts, sprites in `src/games/chicken/`): sprites are strings
of palette keys rendered once to tiny canvases and scaled up with `image-rendering: pixelated`.
Every other game and the site UI use a modern casino style. Its art is vector SVG drawn in React components in
`src/art/` (cards, chips, gems, bomb, rocket, roulette wheel, prize wheel, vault, avatars, VIP badges) and the lobby
covers in `src/components/covers.tsx`. The Slots symbols are 3D models built in code (`src/games/slots/models.ts`):
faceted gems lofted from outlines, a gold crown and Boje coin, the star and the multiplier orbs. No image files ship.

Brand: the Boje mark (a cut gem with a B) and its loaders are in `src/components/Loader.tsx`: the big loader for
pages and games, a small spinner for buttons, and a plain-CSS copy of the big one in `index.html` that shows
before any script has run. Local storage keys still start with `lumen.` so existing wallets carry over.

## Backend (Supabase through Vercel)
The browser talks to Supabase directly. The public URL and key come from the build env
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, set by the Vercel Supabase integration) or, failing
that, from `/api/config` at runtime. All game and account logic in the database lives in SECURITY DEFINER
Postgres functions defined in `api/_lib/schema.js`.

Vercel functions in `api/`:
- `setup.js`: applies the schema when its version changes (`POST /api/setup`). Needs `POSTGRES_URL`.
- `auth.js`: sign-up (rate limited per IP) and account deletion, which need the service key.
- `config.js`: the public Supabase URL and key for the browser.
- `selftest.js`: an end-to-end check of Crash and accounts. It only answers `?key=` matching the `SELFTEST_KEY` env var (set in Vercel; keep a copy in an untracked `.env.local`).

Without the backend (or in the single-file preview) Crash runs the same rules locally for one player and
accounts are hidden.

## Multiplayer Crash
Rounds are shared by everyone through `crash_state`, `crash_bet` and `crash_cashout`. Rounds are created lazily
by whichever call sees the last one finish, the crash point is drawn on the server and only revealed once it
happens, and cash-outs are timed by the database clock. Signed-in players show up under their username.

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
- Challenges: 15 one-time goals, one per game plus Explorer and High Roller (e.g. 25× in Crash, a 2% Dice win);
  only bets of 25+ count.

## Game math
- Chicken Road: per-lane survival 90/80/70/55% (Easy → Daredevil), multiplier = 0.97 / survival^lanes.
- Mines: 5×5, multiplier = 0.97 / P(all picks safe).
- Plinko: 8/12/16 rows, low/medium/high risk tables.
- Crash: P(crash ≥ x) = 0.97 / x.
- Blackjack: 6 decks, dealer stands on soft 17, 3:2 blackjack, double on any two, one split.
- Dice: payout 99 / win chance, roll 0.00 to 100.00.
- Limbo: P(result ≥ x) = 0.99 / x.
- Keno: 40 numbers, 10 drawn, 1 to 10 picks, four risk tables at about 99% return (src/games/keno/tables.ts).
- Hi-Lo: endless deck, each correct call multiplies by 0.99 / P(call).
- Wheel: 10 to 50 segments, three risks; every table sums to 0.99 × segments.
- Roulette: European single zero, a bet covering n numbers pays 36 / n.
- Slots: 6 × 5 grid that pays anywhere: 8+ of a symbol win, winners shatter and the rest tumble down until nothing
  more wins. 4+ stars pay 3×, 5× or 100× and start 10 free spins (3+ stars in free spins add 5). In free spins,
  multiplier orbs (2× to 100×) add up and multiply any spin that wins. Buy free spins for 100× the bet; max win
  5,000×. Simulated return about 96.5% for the base game and for bought free spins
  (`node --experimental-strip-types tools/slots-sim.ts 2000000 100000`). The whole round is drawn when the bet
  is placed (`rules.ts`) and the screen plays it back through the 3D scene (`scene.ts`).
- Video Poker: Jacks or Better, 9/6 full pay (about 99.5% with perfect play); "Best hold" picks the hold with
  the highest expected return.
