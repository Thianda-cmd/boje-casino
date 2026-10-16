/*
  Database schema for the casino, applied by /api/setup when SCHEMA_VERSION changes.

  Everything the browser touches is a SECURITY DEFINER function in the public schema, called
  through Supabase's REST API (POST /rest/v1/rpc/<name>). The tables themselves have row level
  security on and no policies, so they can't be read or written directly with the public key.

  Crash: rounds are created lazily by whichever call notices the last one is over, so there is no
  worker. Each round commits to sha256(seed) before bets open; the seed (and so the crash point)
  is only revealed once the rocket has blown.
  Accounts: Supabase Auth users, one profile row each holding the username, avatar and wallet.
  Live Blackjack: shared five-seat tables. Rounds advance lazily under a per-table advisory lock; the shoe never
  leaves the database and the hole card is only sent once the dealer plays. Wallets stay on the client, as in Crash.
  Case Battles: two to four seats open the same crates; every item is drawn when the last seat fills, under a
  per-battle advisory lock, and the rounds play out on the database clock. Wallets stay on the client.
  Double: one red, black and green strip spun for everyone. Rounds repeat lazily like Crash; each commits to
  sha256(seed) when it is created, the roll is revealed when betting closes and the seed once the strip has landed.
*/

export const SCHEMA_VERSION = '2026-10-16.3'

export const SCHEMA_SQL = /* sql */ `
set local lock_timeout = '8s';
set local statement_timeout = '60s';

-- the first multiplayer version kept its tables under these names
drop table if exists public.crash_bets;
drop table if exists public.crash_rounds;

create table if not exists public.app_meta (
  key text primary key,
  value text not null
);
alter table public.app_meta enable row level security;

/* ------------------------------------------------------------------ */
/*  Crash                                                              */
/* ------------------------------------------------------------------ */

create table if not exists public.crash_round (
  id bigint primary key,
  starts_at bigint not null,
  crashes_at bigint not null,
  crash numeric(10, 2) not null,
  seed text not null,
  hash text not null
);
create table if not exists public.crash_bet (
  round_id bigint not null references public.crash_round (id) on delete cascade,
  player text not null,
  name text not null,
  bet numeric(14, 2) not null,
  auto numeric(10, 2),
  cashed numeric(10, 2),
  primary key (round_id, player)
);
create index if not exists crash_bet_player on public.crash_bet (player, round_id desc);
alter table public.crash_round enable row level security;
alter table public.crash_bet enable row level security;
revoke all on public.crash_round, public.crash_bet, public.app_meta from anon, authenticated;

-- tests freeze time with set app.now_ms = '...'; never honoured on PostgREST connections
create or replace function public._now_ms() returns bigint
language sql volatile set search_path = public as $$
  select case
    when session_user <> 'authenticator' and nullif(current_setting('app.now_ms', true), '') is not null
      then current_setting('app.now_ms', true)::bigint
    else (extract(epoch from clock_timestamp()) * 1000)::bigint
  end
$$;

-- multiplier after ms of flight, floored to cents; the client draws the same curve
create or replace function public._crash_mult(ms bigint) returns numeric
language sql immutable set search_path = public as $$
  select floor(exp(0.08 * greatest(ms, 0) / 1000.0) * 100) / 100
$$;

-- P(crash >= x) = 0.97 / x: every cash-out target returns 97% on average
create or replace function public._crash_from_seed(seed text) returns numeric
language sql immutable set search_path = public as $$
  select least(1000, greatest(1,
    div(97 * 4503599627370496::numeric,
        4503599627370496 - ('x' || substr(encode(sha256(convert_to(seed || ':lumen', 'UTF8')), 'hex'), 1, 13))::bit(52)::bigint
    ) / 100.0
  ))::numeric(10, 2)
$$;

create or replace function public._crash_player(p text) returns text
language sql stable set search_path = public as $$
  select coalesce(auth.uid()::text, case when p ~ '^g_[a-z0-9]{12,40}$' then p end)
$$;

create or replace function public._crash_eff(cashed numeric, auto numeric, phase text, m numeric) returns numeric
language sql immutable set search_path = public as $$
  select coalesce(cashed, case when auto is not null and phase <> 'betting' and auto <= m then auto end)
$$;

create or replace function public._crash_current(now_ms bigint) returns public.crash_round
language plpgsql volatile set search_path = public as $$
declare
  r public.crash_round;
  s text;
  c numeric;
  t bigint;
begin
  select * into r from public.crash_round order by id desc limit 1;
  if found and now_ms < r.crashes_at + 3000 then
    return r;
  end if;
  -- one caller creates the next round; the rest wait here and then read it
  perform pg_advisory_xact_lock(735001);
  select * into r from public.crash_round order by id desc limit 1;
  if found and now_ms < r.crashes_at + 3000 then
    return r;
  end if;
  s := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  c := public._crash_from_seed(s);
  t := now_ms + 7000;
  insert into public.crash_round (id, starts_at, crashes_at, crash, seed, hash)
  values (coalesce(r.id, 0) + 1, t, t + round(ln(c) / 0.08 * 1000)::bigint, c, s, encode(sha256(convert_to(s, 'UTF8')), 'hex'))
  returning * into r;
  if r.id % 200 = 0 then
    delete from public.crash_round where id < r.id - 2000;
  end if;
  return r;
end $$;

create or replace function public._crash_phase(r public.crash_round, now_ms bigint) returns text
language sql immutable set search_path = public as $$
  select case when now_ms < r.starts_at then 'betting' when now_ms < r.crashes_at then 'running' else 'crashed' end
$$;

create or replace function public.crash_state(p_player text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint := public._now_ms();
  me text := public._crash_player(p_player);
  r public.crash_round := public._crash_current(now_ms);
  ph text := public._crash_phase(r, now_ms);
  m numeric;
begin
  m := case ph when 'running' then least(public._crash_mult(now_ms - r.starts_at), r.crash) when 'crashed' then r.crash else 1 end;
  return jsonb_build_object(
    'now', now_ms,
    'round', jsonb_build_object(
      'id', r.id, 'phase', ph, 'startsAt', r.starts_at, 'hash', r.hash,
      'crash', case when ph = 'crashed' then r.crash end,
      'seed', case when ph = 'crashed' then r.seed end),
    'bets', coalesce((
      select jsonb_agg(jsonb_build_object('name', b.name, 'bet', b.bet, 'cashed', public._crash_eff(b.cashed, b.auto, ph, m), 'me', b.player = me)
        order by b.bet desc, b.name)
      from (select * from public.crash_bet where round_id = r.id order by bet desc, name limit 50) b), '[]'::jsonb),
    'players', (select count(*) from public.crash_bet where round_id = r.id),
    'total', (select coalesce(sum(bet), 0) from public.crash_bet where round_id = r.id),
    'mine', (
      select jsonb_build_object('bet', b.bet, 'auto', b.auto, 'cashed', public._crash_eff(b.cashed, b.auto, ph, m))
      from public.crash_bet b where b.round_id = r.id and b.player = me),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'crash', h.crash) order by h.id desc)
      from (select id, crash from public.crash_round where crashes_at <= now_ms order by id desc limit 20) h), '[]'::jsonb),
    'past', coalesce((
      select jsonb_agg(jsonb_build_object('round', p.round_id, 'bet', p.bet, 'crash', p.crash, 'cashed', public._crash_eff(p.cashed, p.auto, 'crashed', p.crash)))
      from (
        select b.round_id, b.bet, b.auto, b.cashed, c.crash from public.crash_bet b join public.crash_round c on c.id = b.round_id
        where me is not null and b.player = me and c.crashes_at <= now_ms order by b.round_id desc limit 5
      ) p), '[]'::jsonb)
  );
end $$;

create or replace function public.crash_bet(p_player text, p_name text, p_bet numeric, p_auto numeric default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint := public._now_ms();
  me text := public._crash_player(p_player);
  r public.crash_round;
  nm text;
  n int;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if p_bet is null or p_bet < 0.1 or p_bet > 100000 then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if p_auto is not null and (p_auto < 1.01 or p_auto > 1000) then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  r := public._crash_current(now_ms);
  if now_ms >= r.starts_at - 150 then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  nm := coalesce(
    (select username from public.profiles where id = auth.uid()),
    nullif(left(trim(regexp_replace(coalesce(p_name, ''), '[^[:alnum:] _.-]', '', 'g')), 16), ''),
    'Player');
  insert into public.crash_bet (round_id, player, name, bet, auto)
  values (r.id, me, nm, round(p_bet, 2), round(p_auto, 2))
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'already'); end if;
  return jsonb_build_object('ok', true, 'round', r.id);
end $$;

create or replace function public.crash_cashout(p_player text, p_round bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint := public._now_ms();
  me text := public._crash_player(p_player);
  r public.crash_round;
  ph text;
  m numeric;
  b public.crash_bet;
  won numeric;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  select * into r from public.crash_round where id = p_round;
  if not found then return jsonb_build_object('ok', false, 'error', 'round'); end if;
  ph := public._crash_phase(r, now_ms);
  if ph = 'betting' then return jsonb_build_object('ok', false, 'error', 'not-started'); end if;
  select * into b from public.crash_bet where round_id = r.id and player = me for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no-bet'); end if;
  if ph = 'crashed' then
    won := public._crash_eff(b.cashed, b.auto, ph, r.crash);
    if won is null then return jsonb_build_object('ok', false, 'error', 'crashed', 'crash', r.crash); end if;
    return jsonb_build_object('ok', true, 'cashed', won);
  end if;
  m := least(public._crash_mult(now_ms - r.starts_at), r.crash);
  won := public._crash_eff(b.cashed, b.auto, ph, m);
  if won is null then
    won := m;
    update public.crash_bet set cashed = won where round_id = r.id and player = me;
  end if;
  return jsonb_build_object('ok', true, 'cashed', won);
end $$;

-- seed and hash of a finished round, for checking it was fair
create or replace function public.crash_round_info(p_round bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'hash', hash, 'crash', crash, 'seed', seed)
  from public.crash_round where id = p_round and crashes_at <= public._now_ms()
$$;

/* ------------------------------------------------------------------ */
/*  Accounts                                                           */
/* ------------------------------------------------------------------ */

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  avatar smallint not null default 0 check (avatar between 0 and 31),
  wallet jsonb not null default '{}'::jsonb,
  rev integer not null default 0,
  balance numeric(16, 2) not null default 0,
  xp numeric(18, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;

create table if not exists public.signup_attempt (
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists signup_attempt_ip on public.signup_attempt (ip, at desc);
alter table public.signup_attempt enable row level security;
revoke all on public.signup_attempt from anon, authenticated;

create or replace function public._valid_username(u text) returns boolean
language sql immutable set search_path = public as $$
  select u ~ '^[A-Za-z0-9_]{3,16}$'
$$;

-- a wallet blob is accepted if it is a plain object of a sane size with a sane balance
create or replace function public._valid_wallet(w jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
begin
  if w is null or jsonb_typeof(w) <> 'object' or octet_length(w::text) > 200000 then return false; end if;
  if jsonb_typeof(w -> 'balance') <> 'number' then return false; end if;
  return (w ->> 'balance')::numeric between 0 and 1e12;
exception when others then
  return false;
end $$;

create or replace function public._profile_json(p public.profiles) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('username', p.username, 'avatar', p.avatar, 'wallet', p.wallet, 'rev', p.rev, 'createdAt', p.created_at)
$$;

create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select public._valid_username(p_username) and not exists (select 1 from public.profiles where lower(username) = lower(p_username))
$$;

create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select public._profile_json(p) from public.profiles p where p.id = auth.uid()
$$;

create or replace function public._create_profile(p_id uuid, p_username text, p_wallet jsonb, p_avatar int) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  p public.profiles;
  w jsonb := case when public._valid_wallet(p_wallet) then p_wallet else '{}'::jsonb end;
begin
  select * into p from public.profiles where id = p_id;
  if found then return jsonb_build_object('ok', true, 'profile', public._profile_json(p)); end if;
  if not public._valid_username(p_username) then return jsonb_build_object('ok', false, 'error', 'username'); end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_username)) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  insert into public.profiles (id, username, avatar, wallet, balance, xp)
  values (p_id, p_username, abs(coalesce(p_avatar, 0)) % 32, w, coalesce((w ->> 'balance')::numeric, 0), coalesce((w ->> 'xp')::numeric, 0))
  returning * into p;
  return jsonb_build_object('ok', true, 'profile', public._profile_json(p));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'taken');
end $$;

-- the signed-in user makes their own profile (normally the sign-up endpoint already did)
create or replace function public.create_profile(p_username text, p_wallet jsonb default null, p_avatar int default 0) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  return public._create_profile(auth.uid(), p_username, p_wallet, p_avatar);
end $$;

-- the sign-up endpoint, with the service key
create or replace function public.admin_create_profile(p_id uuid, p_username text, p_wallet jsonb default null, p_avatar int default 0) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  return public._create_profile(p_id, p_username, p_wallet, p_avatar);
end $$;

-- optimistic save: only lands if nobody else saved since p_rev
create or replace function public.save_wallet(p_wallet jsonb, p_rev int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if not public._valid_wallet(p_wallet) then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  update public.profiles
     set wallet = p_wallet, rev = rev + 1, updated_at = now(),
         balance = (p_wallet ->> 'balance')::numeric,
         xp = coalesce((p_wallet ->> 'xp')::numeric, xp)
   where id = auth.uid() and rev = p_rev
  returning * into p;
  if found then return jsonb_build_object('ok', true, 'rev', p.rev); end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'no-profile'); end if;
  return jsonb_build_object('ok', false, 'error', 'conflict', 'wallet', p.wallet, 'rev', p.rev);
end $$;

create or replace function public.update_profile(p_username text default null, p_avatar int default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_username is not null and not public._valid_username(p_username) then return jsonb_build_object('ok', false, 'error', 'username'); end if;
  if p_username is not null and exists (select 1 from public.profiles where lower(username) = lower(p_username) and id <> auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  update public.profiles
     set username = coalesce(p_username, username),
         avatar = coalesce(abs(p_avatar) % 32, avatar),
         updated_at = now()
   where id = auth.uid()
  returning * into p;
  if not found then return jsonb_build_object('ok', false, 'error', 'no-profile'); end if;
  return jsonb_build_object('ok', true, 'profile', public._profile_json(p));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'taken');
end $$;

-- sign-up rate limit per address, used by the sign-up endpoint with the service key
create or replace function public.signup_gate(p_ip text) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  n int;
begin
  delete from public.signup_attempt where at < now() - interval '1 day';
  select count(*) into n from public.signup_attempt where ip = p_ip and at > now() - interval '1 hour';
  insert into public.signup_attempt (ip) values (p_ip);
  return n;
end $$;

/* ------------------------------------------------------------------ */
/*  Live Blackjack                                                     */
/* ------------------------------------------------------------------ */
-- Shared five-seat tables. Rounds advance lazily: whichever call notices a deadline has passed
-- advances the table while holding advisory lock (7351, table id). Reads take no lock. The shoe
-- never leaves the database and the hole card is only sent once the dealer plays.

create table if not exists public.bj_table (
  id smallint primary key,
  name text not null,
  min_bet numeric(14, 2) not null,
  max_bet numeric(14, 2) not null,
  seats smallint not null default 5 check (seats between 1 and 7),
  sort smallint not null default 0,
  listed boolean not null default true,     -- false: reachable by id, hidden from the lobby
  shoe smallint[] not null default '{}',    -- 312 cards; never returned to clients
  pos smallint not null default 0,          -- cards drawn so far (shoe[pos] is the last one)
  cut smallint not null default 0,          -- reshuffle before a deal once pos >= cut
  shoe_no int not null default 0,
  round_id bigint                           -- current round (plain pointer, no foreign key)
);

create table if not exists public.bj_round (
  id bigint generated by default as identity primary key,
  table_id smallint not null references public.bj_table (id) on delete cascade,
  phase text not null default 'waiting' check (phase in ('waiting', 'betting', 'turns', 'dealer')),
  ver int not null default 0,               -- bumped on every change clients can see
  opened_at bigint not null,                -- when the round last entered 'waiting'
  bet_ends_at bigint,
  deal_ends_at bigint,
  shuffled boolean not null default false,
  peek boolean not null default false,
  dealer smallint[] not null default '{}',
  dealer_at bigint[] not null default '{}', -- landing time of each dealer card
  hole_at bigint,                           -- when the hole card turns face up
  turn_seat smallint,
  turn_hand smallint,
  turn_at bigint,
  turn_ends_at bigint,                      -- shown to clients; the server allows 600 ms more
  turn_away boolean not null default false, -- the turn got the short (away) length
  results_at bigint,
  next_at bigint
);
create index if not exists bj_round_table on public.bj_round (table_id, id desc);

create table if not exists public.bj_seat (
  table_id smallint not null references public.bj_table (id) on delete cascade,
  seat smallint not null,
  player text not null,
  dev text,                                 -- browser id (its guest id) of the tab holding sid
  name text not null,
  avatar smallint not null default 0,
  sid text not null,                        -- the tab that controls this seat
  seen_at bigint not null,
  joined_at bigint not null,
  idle smallint not null default 0,         -- dealt rounds in a row without a bet
  leaving boolean not null default false,
  primary key (table_id, seat)
);
create unique index if not exists bj_seat_player on public.bj_seat (player);

create table if not exists public.bj_hand (
  round_id bigint not null references public.bj_round (id) on delete cascade,
  seat smallint not null,
  idx smallint not null default 0 check (idx in (0, 1)),
  player text not null,
  dev text,
  name text not null,
  avatar smallint not null default 0,
  sid text not null,                        -- only this tab may act on the hand
  bet numeric(14, 2) not null,              -- stake on this hand, a double included
  cards smallint[] not null default '{}',
  card_at bigint[] not null default '{}',
  doubled boolean not null default false,
  split boolean not null default false,
  done boolean not null default false,
  auto boolean not null default false,      -- stood by the clock or by leaving
  outcome text check (outcome in ('win', 'lose', 'push', 'blackjack', 'bust')),
  payout numeric(14, 2),
  primary key (round_id, seat, idx)
);
create index if not exists bj_hand_player on public.bj_hand (player, round_id desc);

create table if not exists public.bj_watch (
  table_id smallint not null references public.bj_table (id) on delete cascade,
  viewer text not null,
  seen_at bigint not null,
  primary key (table_id, viewer)
);
create index if not exists bj_watch_seen on public.bj_watch (table_id, seen_at);

create table if not exists public.bj_reaction (
  id bigint generated by default as identity primary key,
  table_id smallint not null references public.bj_table (id) on delete cascade,
  seat smallint not null,
  player text not null,
  code text not null,
  at bigint not null
);
create index if not exists bj_reaction_table on public.bj_reaction (table_id, at desc);
create index if not exists bj_reaction_player on public.bj_reaction (player, at desc);

alter table public.bj_table enable row level security;
alter table public.bj_round enable row level security;
alter table public.bj_seat enable row level security;
alter table public.bj_hand enable row level security;
alter table public.bj_watch enable row level security;
alter table public.bj_reaction enable row level security;
revoke all on public.bj_table, public.bj_round, public.bj_seat, public.bj_hand, public.bj_watch, public.bj_reaction from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

insert into public.bj_table (id, name, min_bet, max_bet, seats, sort, listed) values
  (1, 'Emerald', 1, 100, 5, 1, true),
  (2, 'Jade', 1, 100, 5, 2, true),
  (3, 'Sapphire', 5, 500, 5, 3, true),
  (4, 'Cobalt', 5, 500, 5, 4, true),
  (5, 'Ruby Room', 25, 2500, 5, 5, true),
  (6, 'High Roller', 100, 10000, 5, 6, true),
  (99, 'Test Table', 1, 100, 5, 99, false)
on conflict (id) do update set name = excluded.name, min_bet = excluded.min_bet, max_bet = excluded.max_bet,
  seats = excluded.seats, sort = excluded.sort, listed = excluded.listed;

/* ---------- helpers (not granted) ---------- */

create or replace function public._bj_player(p text) returns text
language sql stable set search_path = public as $$
  select coalesce(auth.uid()::text, case when p ~ '^g_[a-z0-9]{12,40}$' then p end)
$$;

-- the browser's own id: clients always send their guest id as p_player, signed in or not
create or replace function public._bj_dev(p text) returns text
language sql immutable set search_path = public as $$
  select case when p ~ '^g_[a-z0-9]{12,40}$' then p end
$$;

create or replace function public._bj_name(p_name text) returns text
language sql stable set search_path = public as $$
  select coalesce(
    (select username from public.profiles where id = auth.uid()),
    nullif(left(trim(regexp_replace(coalesce(p_name, ''), '[^[:alnum:] _.-]', '', 'g')), 16), ''),
    'Player')
$$;

-- signed-in players use their profile avatar; guests send guestAvatar(guestId)
create or replace function public._bj_avatar(p_avatar int) returns smallint
language sql stable set search_path = public as $$
  select coalesce((select avatar from public.profiles where id = auth.uid()),
                  ((coalesce(p_avatar, 0)::bigint % 16 + 16) % 16))::smallint
$$;

create or replace function public._bj_val(c smallint) returns int
language sql immutable set search_path = public as $$
  select case when c % 13 = 0 then 11 when c % 13 >= 9 then 10 else c % 13 + 1 end
$$;

create or replace function public._bj_total(cards smallint[]) returns int
language plpgsql immutable set search_path = public as $$
declare
  t int := 0;
  a int := 0;
  c smallint;
begin
  foreach c in array coalesce(cards, '{}'::smallint[]) loop
    t := t + public._bj_val(c);
    if c % 13 = 0 then a := a + 1; end if;
  end loop;
  while t > 21 and a > 0 loop
    t := t - 10;
    a := a - 1;
  end loop;
  return t;
end $$;

create or replace function public._bj_is_bj(cards smallint[]) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(cardinality(cards), 0) = 2 and public._bj_total(cards) = 21
$$;

-- six decks shuffled with strong randomness (gen_random_uuid uses pg_strong_random)
create or replace function public._bj_shoe() returns smallint[]
language sql volatile set search_path = public as $$
  select array_agg((i % 52)::smallint order by gen_random_uuid()) from generate_series(0, 311) i
$$;

-- next card from the table's shoe; an emergency reshuffle if a freak round empties it
create or replace function public._bj_draw(t_id int) returns smallint
language plpgsql volatile set search_path = public as $$
declare
  c smallint;
begin
  update public.bj_table
     set shoe = case when pos >= cardinality(shoe) then public._bj_shoe() else shoe end,
         pos = case when pos >= cardinality(shoe) then 1 else pos + 1 end
   where id = t_id
  returning shoe[pos] into c;
  return c;
end $$;

-- 15 s for a present player, 4 s when away (no heartbeat for 10 s) or leaving
create or replace function public._bj_turn_len(t_id int, p_seat int, now_ms bigint) returns bigint
language sql stable set search_path = public as $$
  select (case when exists (
    select 1 from public.bj_seat s
     where s.table_id = t_id and s.seat = p_seat and not s.leaving and s.seen_at >= now_ms - 10000
  ) then 15000 else 4000 end)::bigint
$$;

-- does this seat hold a hand in a round whose results are not out yet?
create or replace function public._bj_live(t_id int, p_seat int, now_ms bigint) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from public.bj_table t
      join public.bj_round r on r.id = t.round_id
      join public.bj_hand h on h.round_id = r.id and h.seat = p_seat
     where t.id = t_id and (r.phase <> 'dealer' or now_ms < r.results_at))
$$;

-- betting closes early once every present seated player has bet
create or replace function public._bj_all_in(rid bigint, t_id int, now_ms bigint) returns void
language sql volatile set search_path = public as $$
  update public.bj_round set bet_ends_at = now_ms + 1500, ver = ver + 1
   where id = rid and phase = 'betting' and bet_ends_at > now_ms + 1500
     and not exists (
       select 1 from public.bj_seat s
        where s.table_id = t_id and not s.leaving and s.seen_at >= now_ms - 10000
          and not exists (select 1 from public.bj_hand h where h.round_id = rid and h.seat = s.seat))
$$;

/* ---------- state machine (callers hold the table lock) ---------- */

-- dealer plays from 'base': the hole flips at base + 500 and draws follow every 850 ms; outcomes
-- are fixed now and only revealed at results_at
create or replace function public._bj_dealer(rid bigint, base bigint) returns void
language plpgsql volatile set search_path = public as $$
declare
  r public.bj_round;
  d smallint[];
  dat bigint[];
  flip bigint := base + 500;
  j int := 0;
  dt int;
  dbj boolean;
begin
  select * into r from public.bj_round where id = rid;
  d := r.dealer;
  dat := r.dealer_at;
  dbj := public._bj_is_bj(d);
  if not dbj and exists (
    select 1 from public.bj_hand h
     where h.round_id = rid and public._bj_total(h.cards) <= 21 and not (public._bj_is_bj(h.cards) and not h.split)
  ) then
    while public._bj_total(d) < 17 loop
      j := j + 1;
      d := d || public._bj_draw(r.table_id);
      dat := dat || (flip + j * 850);
    end loop;
  end if;
  dt := public._bj_total(d);
  update public.bj_hand h set done = true, outcome = case
      when public._bj_total(h.cards) > 21 then 'bust'
      when public._bj_is_bj(h.cards) and not h.split and not dbj then 'blackjack'
      when dbj and not (public._bj_is_bj(h.cards) and not h.split) then 'lose'
      when dbj then 'push'
      when dt > 21 or public._bj_total(h.cards) > dt then 'win'
      when public._bj_total(h.cards) = dt then 'push'
      else 'lose' end
   where h.round_id = rid;
  update public.bj_hand set payout = case outcome
      when 'blackjack' then round(bet * 2.5, 2) when 'win' then bet * 2 when 'push' then bet else 0 end
   where round_id = rid;
  update public.bj_round
     set phase = 'dealer', dealer = d, dealer_at = dat, hole_at = flip,
         turn_seat = null, turn_hand = null, turn_at = null, turn_ends_at = null, turn_away = false,
         results_at = flip + j * 850 + 800, next_at = flip + j * 850 + 800 + 5000, ver = ver + 1
   where id = rid;
end $$;

-- the next undecided hand after (a_seat, a_idx), or the dealer if there is none
create or replace function public._bj_next_turn(rid bigint, a_seat int, a_idx int, base bigint, now_ms bigint) returns void
language plpgsql volatile set search_path = public as $$
declare
  h record;
  tid smallint;
  st bigint := greatest(base, now_ms);
  len bigint;
begin
  select table_id into tid from public.bj_round where id = rid;
  -- hands of players who have left stand as the turn passes them
  update public.bj_hand x set done = true, auto = true
    from public.bj_seat s
   where x.round_id = rid and not x.done and s.table_id = tid and s.seat = x.seat and s.player = x.player and s.leaving
     and (x.seat > a_seat or (x.seat = a_seat and x.idx > a_idx));
  select seat, idx into h from public.bj_hand
   where round_id = rid and not done and (seat > a_seat or (seat = a_seat and idx > a_idx))
   order by seat, idx limit 1;
  if not found then
    perform public._bj_dealer(rid, st);
    return;
  end if;
  len := public._bj_turn_len(tid, h.seat, now_ms);
  update public.bj_round
     set phase = 'turns', turn_seat = h.seat, turn_hand = h.idx, turn_at = st,
         turn_ends_at = st + len, turn_away = len < 15000, ver = ver + 1
   where id = rid;
end $$;

-- betting is over: deal everything now, reveal it on a schedule
create or replace function public._bj_deal(rid bigint, now_ms bigint) returns void
language plpgsql volatile set search_path = public as $$
declare
  r public.bj_round;
  t public.bj_table;
  st bigint;
  k int := 0;
  n int;
  h record;
  d smallint[] := '{}';
  dat bigint[] := '{}';
  v_shuf boolean := false;
  v_pk boolean;
  dend bigint;
begin
  select * into r from public.bj_round where id = rid;
  select * into t from public.bj_table where id = r.table_id;
  st := greatest(r.bet_ends_at, now_ms);
  if t.pos >= t.cut or cardinality(t.shoe) is distinct from 312 then
    update public.bj_table set shoe = public._bj_shoe(), pos = 0, cut = 234 + floor(random() * 27)::int, shoe_no = shoe_no + 1
     where id = t.id;
    v_shuf := true;
    st := st + 2500;
  end if;
  st := st + 400;
  for n in 1..2 loop
    for h in select seat from public.bj_hand where round_id = rid and idx = 0 order by seat loop
      update public.bj_hand set cards = cards || public._bj_draw(t.id), card_at = card_at || (st + k * 380)
       where round_id = rid and seat = h.seat and idx = 0;
      k := k + 1;
    end loop;
    d := d || public._bj_draw(t.id);
    dat := dat || (st + k * 380);
    k := k + 1;
  end loop;
  dend := st + (k - 1) * 380 + 500;
  v_pk := public._bj_val(d[1]) >= 10;
  if v_pk then dend := dend + 1200; end if;
  update public.bj_hand set done = true where round_id = rid and public._bj_is_bj(cards);
  update public.bj_seat s
     set idle = case when exists (select 1 from public.bj_hand x where x.round_id = rid and x.seat = s.seat) then 0 else least(s.idle + 1, 100) end
   where s.table_id = t.id;
  update public.bj_round
     set phase = 'turns', deal_ends_at = dend, dealer = d, dealer_at = dat, shuffled = v_shuf, peek = v_pk, ver = ver + 1
   where id = rid;
  if v_pk and public._bj_is_bj(d) then
    perform public._bj_dealer(rid, dend - 500);      -- the hole flips as the peek ends
  else
    perform public._bj_next_turn(rid, 0, 0, dend, now_ms);
  end if;
end $$;

create or replace function public._bj_new_round(t_id int, now_ms bigint) returns void
language plpgsql volatile set search_path = public as $$
declare
  rid bigint;
begin
  insert into public.bj_round (table_id, opened_at) values (t_id, now_ms) returning id into rid;
  update public.bj_table set round_id = rid where id = t_id;
  delete from public.bj_seat where table_id = t_id and (leaving or idle >= 3);
  if rid % 100 = 0 then
    delete from public.bj_round
     where coalesce(next_at, opened_at) < now_ms - 3 * 86400000
       and id <> all (select round_id from public.bj_table where round_id is not null);
  end if;
end $$;

-- seats go when they hold no hand this round and are leaving, unseen for 30 s, or have sat for
-- 90 s in a round nobody has bet on; stale watchers and reactions go after 60 s
create or replace function public._bj_housekeep(t_id int, now_ms bigint) returns void
language plpgsql volatile set search_path = public as $$
declare
  r public.bj_round;
  n int;
begin
  select q.* into r from public.bj_round q join public.bj_table t on t.round_id = q.id where t.id = t_id;
  -- seats before watchers: bj_state locks rows in the same order, so the two can't deadlock
  delete from public.bj_seat s
   where s.table_id = t_id
     and (s.leaving or s.seen_at < now_ms - 30000
          or (r.phase = 'waiting' and greatest(s.joined_at, r.opened_at) <= now_ms - 90000))
     and not exists (select 1 from public.bj_hand h where h.round_id = r.id and h.seat = s.seat);
  get diagnostics n = row_count;
  if n > 0 then update public.bj_round set ver = ver + 1 where id = r.id; end if;
  delete from public.bj_watch where table_id = t_id and seen_at < now_ms - 60000;
  delete from public.bj_reaction where table_id = t_id and at < now_ms - 60000;
end $$;

-- cheap check run without the lock: does anything need advancing or cleaning?
create or replace function public._bj_due(t_id int, now_ms bigint) returns boolean
language sql stable set search_path = public as $$
  select coalesce((
    select r.id is null
        or (r.phase = 'betting' and now_ms >= r.bet_ends_at)
        or (r.phase = 'turns' and now_ms >= r.turn_ends_at + 600)
        or (r.phase = 'turns' and now_ms >= r.deal_ends_at and exists (
              select 1 from public.bj_seat s where s.table_id = t.id and s.seat = r.turn_seat and s.leaving))
        or (r.phase = 'dealer' and now_ms >= r.next_at)
        or exists (
             select 1 from public.bj_seat s
              where s.table_id = t.id
                and (s.leaving or s.seen_at < now_ms - 30000
                     or (r.phase = 'waiting' and greatest(s.joined_at, r.opened_at) <= now_ms - 90000))
                and not exists (select 1 from public.bj_hand h where h.round_id = r.id and h.seat = s.seat))
        or exists (select 1 from public.bj_watch w where w.table_id = t.id and w.seen_at < now_ms - 120000)
        or exists (select 1 from public.bj_reaction x where x.table_id = t.id and x.at < now_ms - 120000)
      from public.bj_table t left join public.bj_round r on r.id = t.round_id
     where t.id = t_id), false)
$$;

-- applies every transition that is due; a second call at the same now does nothing
create or replace function public._bj_advance(t_id int, now_ms bigint) returns void
language plpgsql volatile set search_path = public as $$
declare
  r public.bj_round;
  rid bigint;
  n int := 0;
begin
  -- the lock-then-read pattern needs a fresh snapshot per statement
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'live blackjack needs read committed isolation';
  end if;
  loop
    n := n + 1;
    exit when n > 25;
    select round_id into rid from public.bj_table where id = t_id;
    select * into r from public.bj_round where id = rid;
    if not found then
      perform public._bj_new_round(t_id, now_ms);
    elsif r.phase = 'betting' and now_ms >= r.bet_ends_at then
      perform public._bj_deal(r.id, now_ms);
    elsif r.phase = 'turns' and (now_ms >= r.turn_ends_at + 600 or (now_ms >= r.deal_ends_at and exists (
            select 1 from public.bj_seat s where s.table_id = t_id and s.seat = r.turn_seat and s.leaving))) then
      update public.bj_hand set done = true, auto = true
       where round_id = r.id and seat = r.turn_seat and idx = r.turn_hand;
      perform public._bj_next_turn(r.id, r.turn_seat, r.turn_hand, now_ms, now_ms);
    elsif r.phase = 'dealer' and now_ms >= r.next_at then
      perform public._bj_new_round(t_id, now_ms);
    else
      exit;
    end if;
  end loop;
  perform public._bj_housekeep(t_id, now_ms);
end $$;

/* ---------- what a client sees ---------- */

create or replace function public._bj_view(t_id int, me text, p_sid text, now_ms bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  t public.bj_table;
  r public.bj_round;
  ph text;
  look bigint := now_ms + 1000;             -- cards may be sent up to 1 s before they land
  dealing boolean;
  dealer_open boolean;
  show_results boolean;
begin
  select * into t from public.bj_table where id = t_id;
  select * into r from public.bj_round where id = t.round_id;
  ph := case
    when r.phase in ('waiting', 'betting') then r.phase
    when now_ms < r.deal_ends_at then 'dealing'
    when r.phase = 'turns' then 'turns'
    when now_ms < r.results_at then 'dealer'
    else 'done' end;
  dealing := ph = 'dealing';
  dealer_open := r.phase = 'dealer' and not dealing;
  show_results := ph in ('dealer', 'done') and r.results_at <= look;
  return jsonb_build_object(
    'now', now_ms,
    'table', jsonb_build_object(
      'id', t.id, 'name', t.name, 'min', t.min_bet, 'max', t.max_bet, 'seats', t.seats,
      -- dealer cards drawn but not shown yet still count as in the shoe
      'cardsLeft', greatest(cardinality(t.shoe) - t.pos, 0) + coalesce((
                     select count(*) from generate_subscripts(r.dealer, 1) as i where i > 2 and r.dealer_at[i] > look), 0),
      'shoeNo', t.shoe_no,
      'watchers', least(99, (select count(*) from public.bj_watch w
                    where w.table_id = t.id and w.seen_at > now_ms - 20000
                      and not exists (select 1 from public.bj_seat s where s.table_id = t.id and s.player = w.viewer)))),
    'round', jsonb_build_object(
      'id', r.id, 'ver', r.ver, 'phase', ph, 'openedAt', r.opened_at,
      'betEndsAt', r.bet_ends_at,
      'dealEndsAt', case when ph not in ('waiting', 'betting') then r.deal_ends_at end,
      'shuffle', ph not in ('waiting', 'betting') and r.shuffled,
      'peek', ph not in ('waiting', 'betting') and r.peek,
      'turn', case when ph = 'turns' then jsonb_build_object(
                'seat', r.turn_seat, 'hand', r.turn_hand, 'at', r.turn_at, 'endsAt', r.turn_ends_at, 'away', r.turn_away) end,
      'resultsAt', case when ph in ('dealer', 'done') then r.results_at end,
      'nextAt', case when ph in ('dealer', 'done') then r.next_at end),
    'dealer', coalesce((
      select jsonb_agg(jsonb_build_object(
               'c', case when i = 2 and not dealer_open then null else r.dealer[i] end,
               'at', r.dealer_at[i],
               'flip', case when i = 2 and dealer_open then r.hole_at end) order by i)
        from generate_subscripts(r.dealer, 1) as i
       where r.dealer_at[i] <= look and (i <= 2 or dealer_open)), '[]'::jsonb),
    'seats', (
      select jsonb_agg(case when s.seat is null then null else jsonb_build_object(
               'seat', g, 'name', s.name, 'avatar', s.avatar, 'guest', left(s.player, 2) = 'g_',
               'me', coalesce(s.player = me, false),
               'away', s.seen_at < now_ms - 10000, 'idle', s.idle, 'leaving', s.leaving) end order by g)
        from generate_series(1, t.seats) as g
        left join public.bj_seat s on s.table_id = t.id and s.seat = g),
    'hands', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seat', h.seat, 'idx', h.idx, 'name', h.name, 'avatar', h.avatar, 'guest', left(h.player, 2) = 'g_',
               'mine', coalesce(h.player = me, false),
               'ctl', coalesce(h.player = me and h.sid = p_sid, false),
               'bet', h.bet, 'doubled', h.doubled, 'split', h.split,
               'done', case when dealing then false else h.done end,
               'auto', case when dealing then false else h.auto end,
               'cards', coalesce((
                  select jsonb_agg(jsonb_build_object('c', h.cards[i], 'at', h.card_at[i]) order by i)
                    from generate_subscripts(h.cards, 1) as i where h.card_at[i] <= look), '[]'::jsonb),
               'outcome', case when show_results then h.outcome end,
               'payout', case when show_results then h.payout end) order by h.seat, h.idx)
        from public.bj_hand h where h.round_id = r.id), '[]'::jsonb),
    'mine', (
      select jsonb_build_object('table', s.table_id, 'seat', s.seat, 'active', coalesce(s.sid = p_sid, false),
               'idle', s.idle, 'leaving', s.leaving,
               'expiresAt', case when q.phase = 'waiting' then greatest(s.joined_at, q.opened_at) + 90000 end)
        from public.bj_seat s
        join public.bj_table b on b.id = s.table_id
        left join public.bj_round q on q.id = b.round_id
       where me is not null and s.player = me),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'seat', x.seat, 'code', x.code, 'at', x.at) order by x.id)
        from public.bj_reaction x where x.table_id = t.id and x.at > now_ms - 8000), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'total', public._bj_total(q.dealer), 'bj', public._bj_is_bj(q.dealer)) order by q.id desc)
        from (select id, dealer from public.bj_round
               where table_id = t.id and phase = 'dealer' and results_at <= now_ms order by id desc limit 12) q), '[]'::jsonb),
    'past', coalesce((
      select jsonb_agg(jsonb_build_object('round', p.round_id, 'table', p.table_id, 'bet', p.bet, 'payout', p.payout) order by p.round_id desc)
        from (select h.round_id, q.table_id, sum(h.bet) as bet, sum(h.payout) as payout
                from public.bj_hand h join public.bj_round q on q.id = h.round_id
               where me is not null and h.player = me and q.phase = 'dealer' and q.results_at <= now_ms
               group by h.round_id, q.table_id order by h.round_id desc limit 8) p), '[]'::jsonb)
  );
end $$;

/* ---------- public functions ---------- */

create or replace function public.bj_state(p_table int, p_player text default null, p_sid text default null, p_etag text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint := public._now_ms();
  me text := public._bj_player(p_player);
  v jsonb;
  e text;
  ext boolean;
begin
  if not exists (select 1 from public.bj_table where id = p_table) then return jsonb_build_object('error', 'table'); end if;
  -- the owner of a short (away) turn is back: give them the full 15 s
  ext := me is not null and p_sid is not null and exists (
    select 1 from public.bj_table t
      join public.bj_round r on r.id = t.round_id
      join public.bj_hand h on h.round_id = r.id and h.seat = r.turn_seat and h.idx = r.turn_hand
     where t.id = p_table and r.phase = 'turns' and r.turn_away and now_ms >= r.deal_ends_at
       and now_ms < r.turn_ends_at + 600 and h.player = me and h.sid = p_sid);
  -- whoever gets the lock advances; everyone else reads the last committed state
  if (ext or public._bj_due(p_table, now_ms)) and pg_try_advisory_xact_lock(7351, p_table) then
    now_ms := public._now_ms();
    perform public._bj_advance(p_table, now_ms);
    if ext then
      update public.bj_round r set turn_ends_at = r.turn_at + 15000, turn_away = false, ver = r.ver + 1
        from public.bj_table t, public.bj_hand h
       where t.id = p_table and r.id = t.round_id and r.phase = 'turns' and r.turn_away and now_ms >= r.deal_ends_at
         and now_ms < r.turn_ends_at + 600
         and h.round_id = r.id and h.seat = r.turn_seat and h.idx = r.turn_hand and h.player = me and h.sid = p_sid;
    end if;
  end if;
  if me is not null then
    -- heartbeat at most every 3 s; only the tab that controls the seat keeps it alive
    update public.bj_seat set seen_at = now_ms
     where player = me and table_id = p_table and sid = p_sid and seen_at < now_ms - 3000;
    -- watching, written at most every 5 s. Checked first: ON CONFLICT DO UPDATE locks the row even when its WHERE
    -- fails, which would make every poll a write (a transaction id, WAL and a commit flush)
    if not exists (select 1 from public.bj_watch where table_id = p_table and viewer = me and seen_at >= now_ms - 5000) then
      insert into public.bj_watch (table_id, viewer, seen_at) values (p_table, me, now_ms)
      on conflict (table_id, viewer) do update set seen_at = excluded.seen_at
       where public.bj_watch.seen_at < excluded.seen_at;
    end if;
  end if;
  v := public._bj_view(p_table, me, p_sid, now_ms);
  e := md5((v - 'now')::text);
  if p_etag is not null and p_etag = e then
    return jsonb_build_object('now', now_ms, 'etag', e, 'same', true);
  end if;
  return v || jsonb_build_object('etag', e);
end $$;

create or replace function public.bj_tables(p_player text default null, p_sid text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint;
  me text := public._bj_player(p_player);
  t record;
begin
  for t in select id from public.bj_table where listed order by id loop
    if public._bj_due(t.id, public._now_ms()) and pg_try_advisory_xact_lock(7351, t.id) then
      perform public._bj_advance(t.id, public._now_ms());
    end if;
  end loop;
  now_ms := public._now_ms();
  if me is not null and p_sid is not null then
    -- the Live Blackjack lobby keeps your seat alive too
    update public.bj_seat set seen_at = now_ms where player = me and sid = p_sid and seen_at < now_ms - 3000;
  end if;
  return jsonb_build_object(
    'now', now_ms,
    'tables', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'min', b.min_bet, 'max', b.max_bet, 'seats', b.seats,
        'players', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'name', s.name, 'avatar', s.avatar,
                                                                 'guest', left(s.player, 2) = 'g_') order by s.seat)
                               from public.bj_seat s where s.table_id = b.id), '[]'::jsonb),
        'watchers', least(99, (select count(*) from public.bj_watch w
                       where w.table_id = b.id and w.seen_at > now_ms - 20000
                         and not exists (select 1 from public.bj_seat s where s.table_id = b.id and s.player = w.viewer))),
        'phase', case when r.id is null or r.phase = 'waiting' then 'waiting'
                      when r.phase = 'betting' then 'betting'
                      when r.phase = 'turns' or now_ms < r.results_at then 'playing' else 'done' end,
        'betEndsAt', r.bet_ends_at) order by b.sort, b.id)
      from public.bj_table b left join public.bj_round r on r.id = b.round_id where b.listed), '[]'::jsonb),
    'mine', (select jsonb_build_object('table', s.table_id, 'seat', s.seat, 'active', coalesce(s.sid = p_sid, false))
               from public.bj_seat s where me is not null and s.player = me)
  );
end $$;

-- sit down, move seats, rename (same sid), or take the seat over from another tab (new sid)
create or replace function public.bj_sit(p_table int, p_seat int, p_player text, p_sid text default null, p_name text default null, p_avatar int default 0) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  dv text := public._bj_dev(p_player);
  now_ms bigint;
  t public.bj_table;
  s public.bj_seat;
  pre smallint;
  rid bigint;
  old_rid bigint;
  v_sid text;
  nm text := public._bj_name(p_name);
  av smallint := public._bj_avatar(p_avatar);
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  select * into t from public.bj_table where id = p_table;
  if not found then return jsonb_build_object('ok', false, 'error', 'table'); end if;
  if p_seat is null or p_seat < 1 or p_seat > t.seats then return jsonb_build_object('ok', false, 'error', 'seat'); end if;
  select table_id into pre from public.bj_seat where player = me;
  if pre is not null and pre <> p_table then
    perform pg_advisory_xact_lock(7351, least(pre, p_table));
    perform pg_advisory_xact_lock(7351, greatest(pre, p_table));
  else
    perform pg_advisory_xact_lock(7351, p_table);
  end if;
  now_ms := public._now_ms();
  perform public._bj_advance(p_table, now_ms);
  select round_id into rid from public.bj_table where id = p_table;
  select * into s from public.bj_seat where player = me;
  -- the seat moved to a table we did not lock (another tab sat elsewhere meanwhile)
  if found and s.table_id <> p_table and s.table_id is distinct from pre then
    return jsonb_build_object('ok', false, 'error', 'retry');
  end if;
  if found and s.table_id = p_table and s.seat = p_seat then
    if p_sid is not null and s.sid = p_sid then
      v_sid := s.sid;                       -- same tab: rename / refresh, control unchanged
      update public.bj_seat set name = nm, avatar = av, seen_at = now_ms, leaving = false, dev = coalesce(dv, dev)
       where table_id = p_table and seat = p_seat;
    else
      v_sid := replace(gen_random_uuid()::text, '-', '');
      update public.bj_seat set sid = v_sid, dev = dv, name = nm, avatar = av, seen_at = now_ms, leaving = false
       where table_id = p_table and seat = p_seat;
      -- same browser: this round's hands follow the seat to the new tab
      update public.bj_hand set sid = v_sid where round_id = rid and player = me and dv is not null and dev = dv;
    end if;
    update public.bj_round set ver = ver + 1 where id = rid;
    return jsonb_build_object('ok', true, 'seat', p_seat, 'sid', v_sid, 'state', public._bj_view(p_table, me, v_sid, now_ms));
  end if;
  if found and public._bj_live(s.table_id, s.seat, now_ms) then
    return jsonb_build_object('ok', false, 'error', 'busy', 'table', s.table_id, 'seat', s.seat);
  end if;
  -- someone sits there, or holds this round's hand there
  if exists (select 1 from public.bj_seat x where x.table_id = p_table and x.seat = p_seat)
     or exists (select 1 from public.bj_hand x where x.round_id = rid and x.seat = p_seat and x.player <> me) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  if found then
    delete from public.bj_seat where table_id = s.table_id and seat = s.seat;
    update public.bj_round set ver = ver + 1 where id = (select round_id from public.bj_table where id = s.table_id)
    returning id into old_rid;
    -- moving to another table is leaving this one: everyone still sitting there may have bet by now
    if s.table_id <> p_table then perform public._bj_all_in(old_rid, s.table_id, now_ms); end if;
  end if;
  v_sid := replace(gen_random_uuid()::text, '-', '');
  insert into public.bj_seat (table_id, seat, player, dev, name, avatar, sid, seen_at, joined_at)
  values (p_table, p_seat, me, dv, nm, av, v_sid, now_ms, now_ms);
  update public.bj_round set ver = ver + 1 where id = rid;
  return jsonb_build_object('ok', true, 'seat', p_seat, 'sid', v_sid, 'state', public._bj_view(p_table, me, v_sid, now_ms));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'taken');
end $$;

-- a guest who just signed up takes their seat and this round's hands into the new account
create or replace function public.bj_claim(p_table int, p_guest text, p_sid text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := auth.uid()::text;
  g text := public._bj_dev(p_guest);
  now_ms bigint;
  s public.bj_seat;
  rid bigint;
  nm text := public._bj_name(null);
  av smallint := public._bj_avatar(0);
begin
  if me is null or g is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if not exists (select 1 from public.bj_table where id = p_table) then return jsonb_build_object('ok', false, 'error', 'table'); end if;
  perform pg_advisory_xact_lock(7351, p_table);
  now_ms := public._now_ms();
  perform public._bj_advance(p_table, now_ms);
  select * into s from public.bj_seat where table_id = p_table and player = g and sid = p_sid;
  if not found then return jsonb_build_object('ok', false, 'error', 'not-seated'); end if;
  if exists (select 1 from public.bj_seat where player = me) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select round_id into rid from public.bj_table where id = p_table;
  update public.bj_seat set player = me, name = nm, avatar = av where table_id = p_table and seat = s.seat;
  update public.bj_hand set player = me, name = nm, avatar = av where round_id = rid and player = g;
  update public.bj_round set ver = ver + 1 where id = rid;
  return jsonb_build_object('ok', true, 'state', public._bj_view(p_table, me, p_sid, now_ms));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'busy');
end $$;

-- the page is going away (pagehide): look away now, so the seat frees in ~5 s unless this tab polls again
create or replace function public.bj_away(p_table int, p_player text, p_sid text) returns jsonb
language sql volatile security definer set search_path = public as $$
  with u as (
    update public.bj_seat set seen_at = least(seen_at, public._now_ms() - 25000)
     where table_id = p_table and player = public._bj_player(p_player) and sid = p_sid
    returning 1)
  select jsonb_build_object('ok', true, 'away', exists (select 1 from u))
$$;

-- works from any tab: betting -> bet cancelled and seat freed; mid-round -> hands stand, seat frees at round end
create or replace function public.bj_leave(p_table int, p_player text, p_sid text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  now_ms bigint;
  s public.bj_seat;
  r public.bj_round;
  cancelled numeric := 0;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if not exists (select 1 from public.bj_table where id = p_table) then return jsonb_build_object('ok', false, 'error', 'table'); end if;
  perform pg_advisory_xact_lock(7351, p_table);
  now_ms := public._now_ms();
  perform public._bj_advance(p_table, now_ms);
  select * into s from public.bj_seat where table_id = p_table and player = me;
  if not found then return jsonb_build_object('ok', true, 'gone', true); end if;
  select q.* into r from public.bj_round q join public.bj_table t on t.round_id = q.id where t.id = p_table;
  if r.phase in ('waiting', 'betting') then
    select coalesce(sum(bet), 0) into cancelled from public.bj_hand where round_id = r.id and seat = s.seat;
    delete from public.bj_hand where round_id = r.id and seat = s.seat;
    delete from public.bj_seat where table_id = p_table and seat = s.seat;
    if r.phase = 'betting' and not exists (select 1 from public.bj_hand where round_id = r.id) then
      -- the last bet is gone: the round waits again, with a fresh waiting-room clock
      update public.bj_round set phase = 'waiting', bet_ends_at = null, opened_at = now_ms, ver = ver + 1 where id = r.id;
    else
      update public.bj_round set ver = ver + 1 where id = r.id;
      perform public._bj_all_in(r.id, p_table, now_ms);
    end if;
    return jsonb_build_object('ok', true, 'cancelled', cancelled, 'round', r.id);
  end if;
  if public._bj_live(p_table, s.seat, now_ms) then
    update public.bj_seat set leaving = true where table_id = p_table and seat = s.seat;
    if r.phase = 'turns' and r.turn_seat = s.seat and now_ms >= r.deal_ends_at then
      update public.bj_hand set done = true, auto = true where round_id = r.id and seat = s.seat and not done;
      perform public._bj_next_turn(r.id, s.seat, 1, now_ms, now_ms);
    end if;
    update public.bj_round set ver = ver + 1 where id = r.id;
    return jsonb_build_object('ok', true, 'leaving', true, 'round', r.id);
  end if;
  delete from public.bj_seat where table_id = p_table and seat = s.seat;
  update public.bj_round set ver = ver + 1 where id = r.id;
  return jsonb_build_object('ok', true, 'round', r.id);
end $$;

create or replace function public.bj_bet(p_table int, p_round bigint, p_player text, p_sid text, p_amount numeric) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  now_ms bigint;
  t public.bj_table;
  s public.bj_seat;
  r public.bj_round;
  amt numeric := round(p_amount, 2);
  had numeric;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if not exists (select 1 from public.bj_table where id = p_table) then return jsonb_build_object('ok', false, 'error', 'table'); end if;
  perform pg_advisory_xact_lock(7351, p_table);
  now_ms := public._now_ms();
  perform public._bj_advance(p_table, now_ms);
  select * into t from public.bj_table where id = p_table;
  select * into s from public.bj_seat where table_id = p_table and player = me;
  if not found then return jsonb_build_object('ok', false, 'error', 'not-seated'); end if;
  if s.sid is distinct from p_sid then return jsonb_build_object('ok', false, 'error', 'other-tab'); end if;
  if s.leaving then return jsonb_build_object('ok', false, 'error', 'leaving'); end if;
  select * into r from public.bj_round where id = t.round_id;
  select bet into had from public.bj_hand where round_id = r.id and seat = s.seat and idx = 0;
  if found then
    if r.id = p_round and had = amt then    -- a retry of a bet that already landed
      return jsonb_build_object('ok', true, 'round', r.id, 'bet', had, 'state', public._bj_view(p_table, me, p_sid, now_ms));
    end if;
    return jsonb_build_object('ok', false, 'error', 'already', 'round', r.id, 'bet', had);
  end if;
  if r.id is distinct from p_round then return jsonb_build_object('ok', false, 'error', 'stale', 'round', r.id); end if;
  if r.phase not in ('waiting', 'betting') or (r.phase = 'betting' and now_ms >= r.bet_ends_at - 150) then
    return jsonb_build_object('ok', false, 'error', 'closed', 'round', r.id);
  end if;
  if amt is null or amt < t.min_bet then return jsonb_build_object('ok', false, 'error', 'min'); end if;
  if amt > t.max_bet then return jsonb_build_object('ok', false, 'error', 'max'); end if;
  insert into public.bj_hand (round_id, seat, idx, player, dev, name, avatar, sid, bet)
  values (r.id, s.seat, 0, me, s.dev, s.name, s.avatar, s.sid, amt);
  update public.bj_seat set seen_at = now_ms, idle = 0 where table_id = p_table and seat = s.seat;
  update public.bj_round set phase = 'betting', bet_ends_at = coalesce(bet_ends_at, now_ms + 12000), ver = ver + 1 where id = r.id;
  perform public._bj_all_in(r.id, p_table, now_ms);
  return jsonb_build_object('ok', true, 'round', r.id, 'bet', amt, 'state', public._bj_view(p_table, me, p_sid, now_ms));
end $$;

create or replace function public.bj_action(p_table int, p_round bigint, p_player text, p_sid text, p_hand int, p_n int, p_action text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  now_ms bigint;
  s public.bj_seat;
  r public.bj_round;
  h public.bj_hand;
  tot int;
  c0 smallint;
  c1 smallint;
  aces boolean;
  h0_done boolean;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if p_action is null or p_action not in ('hit', 'stand', 'double', 'split') then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if not exists (select 1 from public.bj_table where id = p_table) then return jsonb_build_object('ok', false, 'error', 'table'); end if;
  perform pg_advisory_xact_lock(7351, p_table);
  now_ms := public._now_ms();
  perform public._bj_advance(p_table, now_ms);
  select * into s from public.bj_seat where table_id = p_table and player = me;
  if not found then return jsonb_build_object('ok', false, 'error', 'not-seated'); end if;
  select q.* into r from public.bj_round q join public.bj_table t on t.round_id = q.id where t.id = p_table;
  if r.id is distinct from p_round then
    return jsonb_build_object('ok', false, 'error', 'stale', 'state', public._bj_view(p_table, me, p_sid, now_ms));
  end if;
  -- checked before the phase, so a dealer blackjack and a normal deal answer alike
  if r.phase in ('turns', 'dealer') and now_ms < r.deal_ends_at then
    return jsonb_build_object('ok', false, 'error', 'dealing', 'state', public._bj_view(p_table, me, p_sid, now_ms));
  end if;
  if r.phase <> 'turns' or r.turn_seat is distinct from s.seat or r.turn_hand is distinct from p_hand then
    return jsonb_build_object('ok', false, 'error', 'turn', 'state', public._bj_view(p_table, me, p_sid, now_ms));
  end if;
  select * into h from public.bj_hand where round_id = r.id and seat = s.seat and idx = p_hand for update;
  if not found or h.done or h.player <> me then
    return jsonb_build_object('ok', false, 'error', 'turn', 'state', public._bj_view(p_table, me, p_sid, now_ms));
  end if;
  if h.sid is distinct from p_sid then
    return jsonb_build_object('ok', false, 'error', 'other-tab', 'state', public._bj_view(p_table, me, p_sid, now_ms));
  end if;
  if cardinality(h.cards) is distinct from p_n then
    return jsonb_build_object('ok', false, 'error', 'stale', 'state', public._bj_view(p_table, me, p_sid, now_ms));
  end if;

  if p_action = 'hit' then
    h.cards := h.cards || public._bj_draw(p_table);
    tot := public._bj_total(h.cards);
    update public.bj_hand set cards = h.cards, card_at = card_at || now_ms, done = tot >= 21
     where round_id = r.id and seat = s.seat and idx = p_hand;
    if tot >= 21 then
      perform public._bj_next_turn(r.id, s.seat, p_hand, now_ms + 450, now_ms);
    else
      update public.bj_round set turn_at = now_ms, turn_ends_at = now_ms + 8000, turn_away = false, ver = ver + 1 where id = r.id;
    end if;
  elsif p_action = 'stand' then
    update public.bj_hand set done = true where round_id = r.id and seat = s.seat and idx = p_hand;
    perform public._bj_next_turn(r.id, s.seat, p_hand, now_ms, now_ms);
  elsif p_action = 'double' then
    if cardinality(h.cards) <> 2 or h.doubled then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'state', public._bj_view(p_table, me, p_sid, now_ms));
    end if;
    update public.bj_hand
       set bet = bet * 2, doubled = true, cards = cards || public._bj_draw(p_table), card_at = card_at || now_ms, done = true
     where round_id = r.id and seat = s.seat and idx = p_hand;
    perform public._bj_next_turn(r.id, s.seat, p_hand, now_ms + 500, now_ms);
  else
    if p_hand <> 0 or cardinality(h.cards) <> 2
       or public._bj_val(h.cards[1]) <> public._bj_val(h.cards[2])
       or exists (select 1 from public.bj_hand where round_id = r.id and seat = s.seat and idx = 1) then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'state', public._bj_view(p_table, me, p_sid, now_ms));
    end if;
    aces := h.cards[1] % 13 = 0;
    c0 := public._bj_draw(p_table);         -- hand 0 first, then hand 1, as in single-player
    c1 := public._bj_draw(p_table);
    update public.bj_hand set cards = array[h.cards[1], c0], card_at = array[h.card_at[1], now_ms + 300], split = true
     where round_id = r.id and seat = s.seat and idx = 0;
    insert into public.bj_hand (round_id, seat, idx, player, dev, name, avatar, sid, bet, cards, card_at, split)
    values (r.id, s.seat, 1, me, h.dev, h.name, h.avatar, h.sid, h.bet, array[h.cards[2], c1], array[h.card_at[2], now_ms + 650], true);
    update public.bj_hand set done = aces or public._bj_total(cards) = 21 where round_id = r.id and seat = s.seat;
    select done into h0_done from public.bj_hand where round_id = r.id and seat = s.seat and idx = 0;
    if h0_done then
      perform public._bj_next_turn(r.id, s.seat, 0, now_ms + 900, now_ms);
    else
      update public.bj_round set turn_hand = 0, turn_at = now_ms + 900, turn_ends_at = now_ms + 900 + 15000, turn_away = false, ver = ver + 1
       where id = r.id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'state', public._bj_view(p_table, me, p_sid, now_ms));
end $$;

create or replace function public.bj_react(p_table int, p_player text, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  now_ms bigint;
  s public.bj_seat;
  rid bigint;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if p_code is null or not (p_code = any (array['thumbs', 'haha', 'wow', 'cry', 'fire', 'clap', 'clover', 'cool',
                                                'nice', 'gl', 'hitme', 'ouch', 'hot', 'gg', 'ty', 'hurry'])) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  perform pg_advisory_xact_lock(7352, hashtext(me));   -- per player, so the rate limit is exact
  now_ms := public._now_ms();
  select * into s from public.bj_seat where table_id = p_table and player = me;
  if not found then return jsonb_build_object('ok', false, 'error', 'not-seated'); end if;
  if exists (select 1 from public.bj_reaction where player = me and at > now_ms - 1500)
     or (select count(*) from public.bj_reaction where player = me and at > now_ms - 15000) >= 6 then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;
  insert into public.bj_reaction (table_id, seat, player, code, at) values (p_table, s.seat, me, p_code, now_ms) returning id into rid;
  return jsonb_build_object('ok', true, 'id', rid, 'at', now_ms);
end $$;

-- settles a round the client missed; p_guest lets a just-signed-up player resolve rounds played as a guest
create or replace function public.bj_result(p_round bigint, p_player text, p_guest text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  g text := public._bj_dev(p_guest);
  now_ms bigint := public._now_ms();
  r public.bj_round;
begin
  if me is null and g is null then return jsonb_build_object('state', 'none'); end if;
  select * into r from public.bj_round where id = p_round;
  if not found then return jsonb_build_object('state', 'gone'); end if;
  if r.phase <> 'dealer' or now_ms < r.results_at then return jsonb_build_object('state', 'live'); end if;
  return coalesce((
    select jsonb_build_object('state', 'done', 'table', r.table_id, 'bet', sum(bet), 'payout', sum(payout))
      from public.bj_hand where round_id = r.id and player in (me, g) having count(*) > 0),
    jsonb_build_object('state', 'none'));
end $$;

-- everything about a finished round, for the history modal
create or replace function public.bj_round_info(p_round bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'table', r.table_id, 'at', r.results_at, 'dealer', to_jsonb(r.dealer),
    'hands', coalesce((select jsonb_agg(jsonb_build_object(
        'seat', h.seat, 'idx', h.idx, 'name', h.name, 'avatar', h.avatar, 'guest', left(h.player, 2) = 'g_',
        'bet', h.bet, 'cards', to_jsonb(h.cards), 'doubled', h.doubled, 'split', h.split, 'auto', h.auto,
        'outcome', h.outcome, 'payout', h.payout) order by h.seat, h.idx)
      from public.bj_hand h where h.round_id = r.id), '[]'::jsonb))
  from public.bj_round r where r.id = p_round and r.phase = 'dealer' and r.results_at <= public._now_ms()
$$;

/* ------------------------------------------------------------------ */
/*  Case Battles                                                       */
/* ------------------------------------------------------------------ */
-- Two to four seats (1v1, 1v1v1, 1v1v1v1, 2v2) each pay unit x crates and open the same crates in order. When
-- the last seat fills, the same transaction draws one item per seat per crate, fixes the winners and the payouts,
-- and sets the shared clock: a 3 s countdown, then one round every round_ms, then 1.5 s before the winner shows.
-- Nothing can change after that, so the results are sent from the start and the browsers play them on the clock.
-- Writers hold advisory lock (7353, battle id) and re-read after taking it; the per-player open-battle limit is
-- checked under lock (7354, hashtext(player)), always taken after the battle lock. Reads take no lock. Open
-- battles nobody fills are cancelled lazily, under the battle lock, by whichever call sees them expired.

create table if not exists public.cb_item (
  tier text not null check (tier in ('low', 'medium', 'high', 'extreme')),
  idx smallint not null,
  mult numeric(10, 2) not null,
  weight int not null check (weight > 0),
  lo int not null,                          -- a roll r in 0..99999 picks this item when lo <= r < hi
  hi int not null,
  primary key (tier, idx)
);

create table if not exists public.cb_battle (
  id bigint generated by default as identity primary key,
  status text not null default 'open' check (status in ('open', 'running', 'done', 'cancelled')),
  mode text not null check (mode in ('1v1', '1v1v1', '1v1v1v1', '2v2')),
  crazy boolean not null default false,
  unit numeric(14, 2) not null check (unit between 1 and 10000),
  cases text[] not null check (cardinality(cases) between 1 and 10),
  seats smallint not null check (seats between 2 and 4),
  listed boolean not null default true,     -- false: reachable by id, left out of the lobby lists (selftest)
  created_at bigint not null,
  closed_at bigint,                         -- when it was cancelled
  start_at bigint,                          -- the first round's reels start; the countdown runs before it
  end_at bigint,                            -- the winner is final and shown; 'running' reads 'done' from here
  round_ms int not null default 4800,
  results jsonb,                            -- results[seat - 1][round] = multiplier
  winners smallint[],
  payouts numeric(14, 2)[],                 -- in seat order
  pot numeric(16, 2)
);
create index if not exists cb_battle_open on public.cb_battle (status, created_at desc);
create index if not exists cb_battle_end on public.cb_battle (status, end_at desc);

create table if not exists public.cb_seat (
  battle_id bigint not null references public.cb_battle (id) on delete cascade,
  seat smallint not null,
  player text not null,                     -- auth uid, guest id or bot_<name>; never sent to clients
  dev text,                                 -- the browser's guest id
  name text not null,
  avatar smallint not null default 0,
  bot boolean not null default false,
  joined_at bigint not null,
  primary key (battle_id, seat),
  unique (battle_id, player)
);
create index if not exists cb_seat_player on public.cb_seat (player, battle_id desc);

alter table public.cb_item enable row level security;
alter table public.cb_battle enable row level security;
alter table public.cb_seat enable row level security;
revoke all on public.cb_item, public.cb_battle, public.cb_seat from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- the crate tables of src/games/cases/rules.ts, row for row: weights out of 100,000, each crate returns 98%
-- (tools/battles-sql/test.mjs checks they match)
delete from public.cb_item;
insert into public.cb_item (tier, idx, mult, weight, lo, hi)
select v.tier, v.idx, v.mult, v.weight, (sum(v.weight) over w - v.weight)::int, (sum(v.weight) over w)::int
  from (values
    ('low', 1, 0.3, 6000), ('low', 2, 0.5, 27500), ('low', 3, 0.8, 29750), ('low', 4, 1.2, 22000),
    ('low', 5, 1.6, 10000), ('low', 6, 2.5, 3500), ('low', 7, 5, 1000), ('low', 8, 10, 250),
    ('medium', 1, 0.2, 33440), ('medium', 2, 0.5, 25800), ('medium', 3, 0.8, 14000), ('medium', 4, 1.2, 12010),
    ('medium', 5, 1.8, 8000), ('medium', 6, 3, 4500), ('medium', 7, 6, 1600), ('medium', 8, 15, 500),
    ('medium', 9, 40, 120), ('medium', 10, 100, 30),
    ('high', 1, 0.1, 46320), ('high', 2, 0.4, 30170), ('high', 3, 0.7, 10000), ('high', 4, 1.5, 7000),
    ('high', 5, 3, 3800), ('high', 6, 7, 1500), ('high', 7, 15, 700), ('high', 8, 30, 300),
    ('high', 9, 60, 140), ('high', 10, 150, 60), ('high', 11, 500, 10),
    ('extreme', 1, 0.1, 53660), ('extreme', 2, 0.4, 39135), ('extreme', 3, 2, 3490), ('extreme', 4, 4, 2000),
    ('extreme', 5, 10, 900), ('extreme', 6, 25, 400), ('extreme', 7, 50, 240), ('extreme', 8, 100, 160),
    ('extreme', 9, 1000, 15)
  ) as v (tier, idx, mult, weight)
window w as (partition by v.tier order by v.idx);

do $$
begin
  if (select count(distinct tier) from public.cb_item) <> 4 or exists (
    select 1 from public.cb_item group by tier
    having sum(weight) <> 100000 or sum(weight * mult) <> 98000 or min(lo) <> 0 or max(hi) <> 100000
  ) then
    raise exception 'case battles: every crate must weigh 100000 and return 98 percent';
  end if;
end $$;

/* ---------- helpers (not granted) ---------- */

-- strong randomness: 52 bits of a v4 uuid (hex digits 18 to 30 carry no version or variant bits), scaled to 0..99999
create or replace function public._cb_roll() returns int
language sql volatile set search_path = public as $$
  select div(('x' || substr(replace(gen_random_uuid()::text, '-', ''), 18, 13))::bit(52)::bigint * 100000::numeric,
             4503599627370496)::int
$$;

create or replace function public._cb_pick(p_tier text, p_roll int) returns numeric
language sql stable set search_path = public as $$
  select mult from public.cb_item where tier = p_tier and p_roll >= lo and p_roll < hi
$$;

-- one item per seat per crate, drawn crate by crate (round-major: round 1 seats 1..n, then round 2, ...);
-- m[seat][round] = multiplier
create or replace function public._cb_deal(p_cases text[], p_seats int) returns numeric[]
language plpgsql volatile set search_path = public as $$
declare
  k int := cardinality(p_cases);
  m numeric[] := array_fill(0::numeric, array[p_seats, k]);
begin
  for r in 1..k loop
    for s in 1..p_seats loop
      m[s][r] := public._cb_pick(p_cases[r], public._cb_roll());
    end loop;
  end loop;
  return m;
end $$;

-- each seat's total from m[seat][round]
create or replace function public._cb_totals(m numeric[]) returns numeric[]
language sql immutable set search_path = public as $$
  select array(
    select (select sum(m[s][r]) from generate_series(1, array_length(m, 2)) r)
      from generate_series(1, array_length(m, 1)) s order by s)
$$;

-- the highest total wins (crazy: the lowest); 2v2 compares the team sums (seats 1-2 against 3-4) and both seats of
-- the winning team win; every tied seat wins, so a tied 2v2 makes all four winners. The pot is unit x every
-- multiplier, floored to cents, and each winner gets an equal share floored to cents: the payouts never add up
-- to more than the pot
create or replace function public._cb_settle(p_mode text, p_crazy boolean, p_unit numeric, p_totals numeric[],
                                             out winners smallint[], out payouts numeric[], out pot numeric)
language plpgsql immutable set search_path = public as $$
declare
  a numeric;
  b numeric;
  best numeric;
  share numeric;
begin
  pot := (floor(p_unit * (select sum(t) from unnest(p_totals) t) * 100) / 100)::numeric(16, 2);
  if p_mode = '2v2' then
    a := p_totals[1] + p_totals[2];
    b := p_totals[3] + p_totals[4];
    if a = b then
      winners := '{1,2,3,4}';
    elsif (a > b) <> p_crazy then
      winners := '{1,2}';
    else
      winners := '{3,4}';
    end if;
  else
    if p_crazy then
      select min(t) into best from unnest(p_totals) t;
    else
      select max(t) into best from unnest(p_totals) t;
    end if;
    winners := array(select i::smallint from generate_subscripts(p_totals, 1) i where p_totals[i] = best order by i);
  end if;
  share := (floor(pot * 100 / cardinality(winners)) / 100)::numeric(14, 2);
  payouts := array(select case when i = any (winners) then share else 0::numeric(14, 2) end
                     from generate_series(1, cardinality(p_totals)) i order by i);
end $$;

create or replace function public._cb_status(b public.cb_battle, now_ms bigint) returns text
language sql immutable set search_path = public as $$
  select case when b.status = 'running' and now_ms >= b.end_at then 'done' else b.status end
$$;

-- the battle lock; the lock-then-read pattern needs a fresh snapshot per statement
create or replace function public._cb_lock(p_battle bigint) returns void
language plpgsql volatile set search_path = public as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'case battles need read committed isolation';
  end if;
  perform pg_advisory_xact_lock(7353, (p_battle % 2147483647)::int);
end $$;

-- the player lock, for the open-battle limit; taken after a battle lock, never before one
create or replace function public._cb_plock(me text) returns void
language plpgsql volatile set search_path = public as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'case battles need read committed isolation';
  end if;
  perform pg_advisory_xact_lock(7354, hashtext(me));
end $$;

-- open battles this player sits in that have not expired
create or replace function public._cb_open_count(me text, now_ms bigint, p_except bigint) returns int
language sql stable set search_path = public as $$
  select count(*)::int
    from public.cb_seat s join public.cb_battle b on b.id = s.battle_id
   where s.player = me and b.status = 'open' and b.created_at > now_ms - 900000 and b.id is distinct from p_except
$$;

-- caller holds the battle lock: an open battle 15 minutes old is cancelled
create or replace function public._cb_expire(p_battle bigint, now_ms bigint) returns boolean
language plpgsql volatile set search_path = public as $$
begin
  update public.cb_battle set status = 'cancelled', closed_at = now_ms
   where id = p_battle and status = 'open' and created_at + 900000 <= now_ms;
  return found;
end $$;

-- caller holds the battle lock and has just filled the last seat: draw everything and start the clock
create or replace function public._cb_start(p_battle bigint, now_ms bigint) returns void
language plpgsql volatile set search_path = public as $$
declare
  b public.cb_battle;
  m numeric[];
  o record;
begin
  select * into b from public.cb_battle where id = p_battle;
  if b.status is distinct from 'open' or (select count(*) from public.cb_seat where battle_id = p_battle) <> b.seats then
    raise exception 'case battle % is not ready to start', p_battle;
  end if;
  m := public._cb_deal(b.cases, b.seats);
  select * into o from public._cb_settle(b.mode, b.crazy, b.unit, public._cb_totals(m));
  update public.cb_battle
     set status = 'running', start_at = now_ms + 3000,
         end_at = now_ms + 3000 + cardinality(b.cases) * b.round_ms + 1500,
         results = to_jsonb(m), winners = o.winners, payouts = o.payouts, pot = o.pot
   where id = p_battle;
end $$;

-- finished and cancelled battles go a week later: a browser that paid into one settles it with cb_result whenever it
-- comes back, and a week matches how long it remembers what it has settled
create or replace function public._cb_cleanup(now_ms bigint) returns void
language sql volatile set search_path = public as $$
  delete from public.cb_battle
   where (status in ('running', 'done') and end_at < now_ms - 604800000)
      or (status in ('open', 'cancelled') and created_at < now_ms - 604800000)
$$;

/* ---------- what a client sees ---------- */

-- BattleView in src/games/battles/types.ts; p_results false leaves the results out (lobby lists)
create or replace function public._cb_view(b public.cb_battle, me text, now_ms bigint, p_results boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'now', now_ms,
    'id', b.id,
    'status', public._cb_status(b, now_ms),
    'mode', b.mode,
    'crazy', b.crazy,
    'unit', b.unit,
    'cases', to_jsonb(b.cases),
    'cost', b.unit * cardinality(b.cases),
    'seats', (
      select jsonb_agg(case when s.seat is null then null else jsonb_build_object(
               'seat', g, 'name', s.name, 'avatar', s.avatar, 'guest', left(s.player, 2) = 'g_', 'bot', s.bot,
               'me', coalesce(s.player = me, false)) end order by g)
        from generate_series(1, b.seats) as g
        left join public.cb_seat s on s.battle_id = b.id and s.seat = g),
    'createdAt', b.created_at,
    'expiresAt', b.created_at + 900000,
    'startAt', b.start_at,
    'roundMs', b.round_ms,
    'endAt', b.end_at,
    'results', case when p_results then b.results end,
    'winners', to_jsonb(b.winners),
    'payouts', to_jsonb(b.payouts),
    'pot', b.pot)
$$;

/* ---------- public functions ---------- */

create or replace function public.cb_list(p_player text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint := public._now_ms();
  me text := public._bj_player(p_player);
  x record;
begin
  -- lazy expiry; a battle someone is acting on right now is left for the next call
  for x in select id from public.cb_battle where status = 'open' and created_at <= now_ms - 900000 order by created_at limit 20 loop
    if pg_try_advisory_xact_lock(7353, (x.id % 2147483647)::int) then
      perform public._cb_expire(x.id, now_ms);
    end if;
  end loop;
  return jsonb_build_object(
    'now', now_ms,
    'open', coalesce((
      select jsonb_agg(public._cb_view(b, me, now_ms, false) order by b.created_at desc, b.id desc)
        from public.cb_battle b
       where b.id in (select id from public.cb_battle
                       where status = 'open' and listed and created_at > now_ms - 900000
                       order by created_at desc, id desc limit 30)), '[]'::jsonb),
    'live', coalesce((
      select jsonb_agg(public._cb_view(b, me, now_ms, false) order by b.start_at desc, b.id desc)
        from public.cb_battle b
       where b.id in (select id from public.cb_battle
                       where status = 'running' and listed and end_at > now_ms
                       order by start_at desc, id desc limit 20)), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(public._cb_view(b, me, now_ms, true) order by b.end_at desc, b.id desc)
        from public.cb_battle b
       where b.id in (select id from public.cb_battle
                       where status = 'running' and listed and end_at <= now_ms
                       order by end_at desc, id desc limit 12)), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(public._cb_view(b, me, now_ms, public._cb_status(b, now_ms) = 'done') order by b.id desc)
        from public.cb_battle b
       where b.id in (select q.id from public.cb_seat s join public.cb_battle q on q.id = s.battle_id
                       where me is not null and s.player = me
                         and (q.status = 'open'
                              or (q.status = 'running' and q.end_at > now_ms - 600000)
                              or (q.status = 'cancelled' and q.closed_at > now_ms - 600000))
                       order by q.id desc limit 20)), '[]'::jsonb)
  );
end $$;

create or replace function public.cb_state(p_battle bigint, p_player text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint := public._now_ms();
  me text := public._bj_player(p_player);
  b public.cb_battle;
begin
  select * into b from public.cb_battle where id = p_battle;
  if not found then return jsonb_build_object('error', 'gone'); end if;
  if b.status = 'open' and b.created_at + 900000 <= now_ms then
    perform public._cb_lock(b.id);
    now_ms := public._now_ms();
    perform public._cb_expire(b.id, now_ms);
    select * into b from public.cb_battle where id = p_battle;
    if not found then return jsonb_build_object('error', 'gone'); end if;
  end if;
  return public._cb_view(b, me, now_ms, true);
end $$;

create or replace function public.cb_create(p_player text, p_name text, p_avatar int, p_mode text, p_crazy boolean,
                                            p_unit numeric, p_cases jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  now_ms bigint;
  n int := case p_mode when '1v1' then 2 when '1v1v1' then 3 when '1v1v1v1' then 4 when '2v2' then 4 end;
  u numeric := round(p_unit, 2);
  k int;
  cs text[];
  b public.cb_battle;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if jsonb_typeof(p_cases) = 'array' then
    k := jsonb_array_length(p_cases);
  end if;
  if k between 1 and 10 then
    select array_agg(e.v #>> '{}' order by e.i) into cs
      from jsonb_array_elements(p_cases) with ordinality as e (v, i)
     where jsonb_typeof(e.v) = 'string' and e.v #>> '{}' in ('low', 'medium', 'high', 'extreme');
  end if;
  if n is null or u is null or not (u between 1 and 10000) or cs is null or cardinality(cs) <> k or u * k > 100000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  perform public._cb_plock(me);
  now_ms := public._now_ms();
  if public._cb_open_count(me, now_ms, null) >= 3 then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
  insert into public.cb_battle (mode, crazy, unit, cases, seats, listed, created_at)
  values (p_mode, coalesce(p_crazy, false), u, cs, n, left(me, 10) <> 'g_selftest', now_ms)
  returning * into b;
  insert into public.cb_seat (battle_id, seat, player, dev, name, avatar, bot, joined_at)
  values (b.id, 1, me, public._bj_dev(p_player), public._bj_name(p_name), public._bj_avatar(p_avatar), false, now_ms);
  if b.id % 50 = 0 then perform public._cb_cleanup(now_ms); end if;
  return jsonb_build_object('ok', true, 'battle', public._cb_view(b, me, now_ms, true));
end $$;

-- p_seat null takes the first free seat
create or replace function public.cb_join(p_battle bigint, p_player text, p_name text, p_avatar int, p_seat int default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  now_ms bigint;
  b public.cb_battle;
  st int;
  filled int;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if not exists (select 1 from public.cb_battle where id = p_battle) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  perform public._cb_lock(p_battle);
  now_ms := public._now_ms();
  perform public._cb_expire(p_battle, now_ms);
  select * into b from public.cb_battle where id = p_battle;
  if not found then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if b.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'started'); end if;
  if exists (select 1 from public.cb_seat where battle_id = b.id and player = me) then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;
  if p_seat is null then
    select min(g) into st from generate_series(1, b.seats) as g
     where not exists (select 1 from public.cb_seat s where s.battle_id = b.id and s.seat = g);
    if st is null then return jsonb_build_object('ok', false, 'error', 'full'); end if;
  else
    if p_seat < 1 or p_seat > b.seats then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
    if exists (select 1 from public.cb_seat where battle_id = b.id and seat = p_seat) then
      return jsonb_build_object('ok', false, 'error', 'taken');
    end if;
    st := p_seat;
  end if;
  select count(*) into filled from public.cb_seat where battle_id = b.id;
  -- the limit counts open battles: a join that fills this one starts it, so it never counts
  if filled + 1 < b.seats then
    perform public._cb_plock(me);
    if public._cb_open_count(me, now_ms, b.id) >= 3 then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
  end if;
  insert into public.cb_seat (battle_id, seat, player, dev, name, avatar, bot, joined_at)
  values (b.id, st, me, public._bj_dev(p_player), public._bj_name(p_name), public._bj_avatar(p_avatar), false, now_ms);
  if filled + 1 = b.seats then perform public._cb_start(b.id, now_ms); end if;
  select * into b from public.cb_battle where id = p_battle;
  return jsonb_build_object('ok', true, 'battle', public._cb_view(b, me, now_ms, true));
end $$;

-- any seated player fills every empty seat with a house bot, which starts the battle
create or replace function public.cb_bots(p_battle bigint, p_player text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  now_ms bigint;
  b public.cb_battle;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if not exists (select 1 from public.cb_battle where id = p_battle) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  perform public._cb_lock(p_battle);
  now_ms := public._now_ms();
  perform public._cb_expire(p_battle, now_ms);
  select * into b from public.cb_battle where id = p_battle;
  if not found then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if b.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'started'); end if;
  if not exists (select 1 from public.cb_seat where battle_id = b.id and player = me) then
    return jsonb_build_object('ok', false, 'error', 'not-seated');
  end if;
  -- distinct names, none matching a player already seated
  insert into public.cb_seat (battle_id, seat, player, dev, name, avatar, bot, joined_at)
  select b.id, f.seat, 'bot_' || lower(k.name), null, k.name, k.avatar, true, now_ms
    from (select g as seat, row_number() over (order by g) as rn
            from generate_series(1, b.seats) as g
           where not exists (select 1 from public.cb_seat s where s.battle_id = b.id and s.seat = g)) f
    join (select v.name, v.avatar, row_number() over (order by random()) as rn
            from (values ('Otis', 2), ('Hazel', 5), ('Barnaby', 9), ('Juniper', 12),
                         ('Mabel', 7), ('Pip', 3), ('Nova', 14), ('Rocco', 10)) as v (name, avatar)
           where not exists (select 1 from public.cb_seat s where s.battle_id = b.id and lower(s.name) = lower(v.name))) k
      on k.rn = f.rn;
  perform public._cb_start(b.id, now_ms);
  select * into b from public.cb_battle where id = p_battle;
  return jsonb_build_object('ok', true, 'battle', public._cb_view(b, me, now_ms, true));
end $$;

-- before the battle fills: a player's seat frees, and the creator (seat 1) leaving cancels the battle
create or replace function public.cb_leave(p_battle bigint, p_player text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  now_ms bigint;
  b public.cb_battle;
  st int;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if not exists (select 1 from public.cb_battle where id = p_battle) then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  perform public._cb_lock(p_battle);
  now_ms := public._now_ms();
  perform public._cb_expire(p_battle, now_ms);
  select * into b from public.cb_battle where id = p_battle;
  if not found then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  select seat into st from public.cb_seat where battle_id = b.id and player = me;
  if b.status in ('running', 'done') then return jsonb_build_object('ok', false, 'error', 'started'); end if;
  if st is null then return jsonb_build_object('ok', false, 'error', 'not-seated'); end if;
  if b.status = 'cancelled' then return jsonb_build_object('ok', true, 'cancelled', true); end if;
  if st = 1 then
    update public.cb_battle set status = 'cancelled', closed_at = now_ms where id = b.id;
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;
  delete from public.cb_seat where battle_id = b.id and seat = st;
  return jsonb_build_object('ok', true, 'cancelled', false);
end $$;

-- settles a battle the client missed. The browser's guest id counts too, so a stake placed as a guest still
-- resolves after signing up in the same browser
create or replace function public.cb_result(p_battle bigint, p_player text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me text := public._bj_player(p_player);
  dv text := public._bj_dev(p_player);
  now_ms bigint := public._now_ms();
  b public.cb_battle;
  st int;
begin
  if me is null and dv is null then return jsonb_build_object('state', 'none'); end if;
  select * into b from public.cb_battle where id = p_battle;
  if not found then return jsonb_build_object('state', 'gone'); end if;
  if b.status = 'open' and b.created_at + 900000 <= now_ms then
    perform public._cb_lock(b.id);
    now_ms := public._now_ms();
    perform public._cb_expire(b.id, now_ms);
    select * into b from public.cb_battle where id = p_battle;
    if not found then return jsonb_build_object('state', 'gone'); end if;
  end if;
  select seat into st from public.cb_seat where battle_id = b.id and player in (me, dv) order by player = me desc limit 1;
  if st is null then return jsonb_build_object('state', 'none'); end if;
  if public._cb_status(b, now_ms) <> 'done' then return jsonb_build_object('state', public._cb_status(b, now_ms)); end if;
  return jsonb_build_object('state', 'done', 'cost', b.unit * cardinality(b.cases), 'payout', b.payouts[st]);
end $$;

/* ------------------------------------------------------------------ */
/*  Double                                                             */
/* ------------------------------------------------------------------ */
-- One strip of 33 tiles shared by everyone: roll 0 is green, 1 to 16 red, 17 to 32 black. Rounds repeat: 15 s of
-- betting, the strip spins for 6 s onto the roll, then 3 s showing the winners. Like Crash, rounds are created
-- lazily, under advisory lock (7355, 0), by whichever call sees the last one has finished showing. Each round commits
-- to sha256(seed) when it is created; the roll is the first 52 bits of sha256(seed + ':double') mod 33. Betting
-- closes 500 ms before the spin and the roll is revealed then, so every browser starts the same spin on time; the
-- seed is revealed once the strip has landed. Red and black pay 2x, green 32x: every bet returns 32/33 (96.97%).
-- A player may bet on several colours and add to a bet until betting closes, up to 100,000 per colour. Wallets stay
-- on the client, as in Crash.

create table if not exists public.dbl_round (
  id bigint primary key,
  starts_at bigint not null,                -- the strip starts to spin; betting closed 500 ms before
  ends_at bigint not null,                  -- the strip lands; the next round comes 3 s later
  roll smallint not null check (roll between 0 and 32),
  seed text not null,
  hash text not null
);
create table if not exists public.dbl_bet (
  round_id bigint not null references public.dbl_round (id) on delete cascade,
  player text not null,                     -- auth uid or guest id; never sent to clients
  color text not null check (color in ('red', 'green', 'black')),
  name text not null,
  avatar smallint not null default 0,
  amount numeric(14, 2) not null check (amount >= 1 and amount <= 100000),
  placed_at bigint not null,                -- the first chip on this colour, for a steady order
  primary key (round_id, player, color)
);
create index if not exists dbl_bet_player on public.dbl_bet (player, round_id desc);
create table if not exists public.dbl_watch (
  viewer text primary key,                  -- auth uid or guest id of a browser polling dbl_state
  seen_at bigint not null
);
create index if not exists dbl_watch_seen on public.dbl_watch (seen_at);
alter table public.dbl_round enable row level security;
alter table public.dbl_bet enable row level security;
alter table public.dbl_watch enable row level security;
revoke all on public.dbl_round, public.dbl_bet, public.dbl_watch from anon, authenticated;

/* ---------- helpers (not granted) ---------- */

-- the roll a seed gives; src/games/double/fair.ts runs the same formula in the browser
create or replace function public._dbl_roll(seed text) returns smallint
language sql immutable set search_path = public as $$
  select (('x' || substr(encode(sha256(convert_to(seed || ':double', 'UTF8')), 'hex'), 1, 13))::bit(52)::bigint % 33)::smallint
$$;

create or replace function public._dbl_phase(r public.dbl_round, now_ms bigint) returns text
language sql immutable set search_path = public as $$
  select case when now_ms < r.starts_at - 500 then 'betting' when now_ms < r.ends_at then 'spinning' else 'done' end
$$;

-- the round in play; once the last one has shown its winners for 3 s, one caller creates the next and the rest wait
-- on the lock and then read it. Every 100th round clears rounds over three days old and viewers gone a minute.
create or replace function public._dbl_current(now_ms bigint) returns public.dbl_round
language plpgsql volatile set search_path = public as $$
declare
  r public.dbl_round;
  s text;
  t bigint;
begin
  select * into r from public.dbl_round order by id desc limit 1;
  if found and now_ms < r.ends_at + 3000 then
    return r;
  end if;
  perform pg_advisory_xact_lock(7355, 0);
  select * into r from public.dbl_round order by id desc limit 1;
  if found and now_ms < r.ends_at + 3000 then
    return r;
  end if;
  s := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  t := now_ms + 15000;
  insert into public.dbl_round (id, starts_at, ends_at, roll, seed, hash)
  values (coalesce(r.id, 0) + 1, t, t + 6000, public._dbl_roll(s), s, encode(sha256(convert_to(s, 'UTF8')), 'hex'))
  returning * into r;
  if r.id % 100 = 0 then
    delete from public.dbl_round where ends_at < now_ms - 259200000;
    delete from public.dbl_watch where seen_at < now_ms - 60000;
  end if;
  return r;
end $$;

/* ---------- public functions ---------- */

-- Feed in src/games/double/net.ts. p_hist is the newest finished round the browser already has: when nothing has
-- finished since, the 100-round history is left out (null) and the browser keeps its copy. p_open lists (as a json
-- array, up to 50) the rounds the browser has paid into and not settled: those that have landed always come back in
-- past, so a round missed while 20 newer ones were played elsewhere still settles on what really happened.
drop function if exists public.dbl_state(text, bigint);
create or replace function public.dbl_state(p_player text default null, p_hist bigint default null, p_open jsonb default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint := public._now_ms();
  me text := public._bj_player(p_player);
  r public.dbl_round := public._dbl_current(now_ms);
  ph text := public._dbl_phase(r, now_ms);
  head bigint;
  asked bigint[] := array(
    select e::bigint from jsonb_array_elements_text(case when jsonb_typeof(p_open) = 'array' then p_open else '[]'::jsonb end) e
     where e ~ '^[0-9]{1,15}$' limit 50);
begin
  -- who is watching, for the online count; a viewer's row is rewritten at most every 5 s
  if me is not null then
    insert into public.dbl_watch as w (viewer, seen_at) values (me, now_ms)
    on conflict (viewer) do update set seen_at = excluded.seen_at where w.seen_at < excluded.seen_at - 5000;
  end if;
  select id into head from public.dbl_round where ends_at <= now_ms order by id desc limit 1;
  return jsonb_build_object(
    'now', now_ms,
    'round', jsonb_build_object(
      'id', r.id, 'phase', ph, 'startsAt', r.starts_at, 'endsAt', r.ends_at, 'hash', r.hash,
      'roll', case when ph <> 'betting' then r.roll end,
      'seed', case when ph = 'done' then r.seed end),
    'colors', (
      select jsonb_object_agg(c.color, jsonb_build_object(
               'total', coalesce((select sum(amount) from public.dbl_bet where round_id = r.id and color = c.color), 0),
               'players', (select count(*) from public.dbl_bet where round_id = r.id and color = c.color),
               'bets', coalesce((
                 select jsonb_agg(jsonb_build_object('name', b.name, 'avatar', b.avatar, 'amount', b.amount, 'me', coalesce(b.player = me, false))
                          order by b.amount desc, b.placed_at, b.name)
                   from (select * from public.dbl_bet where round_id = r.id and color = c.color
                          order by amount desc, placed_at, name limit 30) b), '[]'::jsonb)))
        from (values ('red'), ('green'), ('black')) as c (color)),
    'mine', (
      select jsonb_build_object('red', coalesce(sum(amount) filter (where color = 'red'), 0),
                                'green', coalesce(sum(amount) filter (where color = 'green'), 0),
                                'black', coalesce(sum(amount) filter (where color = 'black'), 0))
        from public.dbl_bet where round_id = r.id and player = me having count(*) > 0),
    'online', (select count(*) from public.dbl_watch where seen_at > now_ms - 20000),
    'head', head,
    'history', case when p_hist is not null and p_hist = head then null else coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'roll', h.roll) order by h.id desc)
        from (select id, roll from public.dbl_round where ends_at <= now_ms order by id desc limit 100) h), '[]'::jsonb) end,
    -- this player's last 20 finished rounds with a bet, and any of the asked ones, for settling rounds the browser
    -- missed: an asked round that has landed and is not here held no bet of this player's
    'past', coalesce((
      select jsonb_agg(jsonb_build_object('round', p.round_id, 'roll', p.roll, 'red', p.red, 'green', p.green, 'black', p.black)
               order by p.round_id desc)
        from (
          (select b.round_id, d.roll,
                  coalesce(sum(b.amount) filter (where b.color = 'red'), 0) red,
                  coalesce(sum(b.amount) filter (where b.color = 'green'), 0) green,
                  coalesce(sum(b.amount) filter (where b.color = 'black'), 0) black
             from public.dbl_bet b join public.dbl_round d on d.id = b.round_id
            where me is not null and b.player = me and d.ends_at <= now_ms
            group by b.round_id, d.roll order by b.round_id desc limit 20)
          union
          (select b.round_id, d.roll,
                  coalesce(sum(b.amount) filter (where b.color = 'red'), 0) red,
                  coalesce(sum(b.amount) filter (where b.color = 'green'), 0) green,
                  coalesce(sum(b.amount) filter (where b.color = 'black'), 0) black
             from public.dbl_bet b join public.dbl_round d on d.id = b.round_id
            where me is not null and b.player = me and d.ends_at <= now_ms and b.round_id = any(asked)
            group by b.round_id, d.roll)
        ) p), '[]'::jsonb)
  );
end $$;

-- adds p_amount to this player's bet on p_color in round p_round (null: whichever round is taking bets)
create or replace function public.dbl_bet(p_player text, p_name text, p_color text, p_amount numeric,
                                          p_round bigint default null, p_avatar int default 0) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  now_ms bigint := public._now_ms();
  me text := public._bj_player(p_player);
  amt numeric := round(p_amount, 2);
  r public.dbl_round;
  total numeric;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  if p_color is null or p_color not in ('red', 'green', 'black') or amt is null or not (amt between 1 and 100000) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  r := public._dbl_current(now_ms);
  if public._dbl_phase(r, now_ms) <> 'betting' or (p_round is not null and p_round <> r.id) then
    return jsonb_build_object('ok', false, 'error', 'closed', 'round', r.id);
  end if;
  insert into public.dbl_bet as b (round_id, player, color, name, avatar, amount, placed_at)
  values (r.id, me, p_color, public._bj_name(p_name), public._bj_avatar(p_avatar), amt, now_ms)
  on conflict (round_id, player, color) do update
    set amount = b.amount + excluded.amount, name = excluded.name, avatar = excluded.avatar
    where b.amount + excluded.amount <= 100000
  returning b.amount into total;
  if total is null then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
  return jsonb_build_object('ok', true, 'round', r.id, 'color', p_color, 'amount', total);
end $$;

-- seed, hash and roll of a round that has landed, for checking it was fair
create or replace function public.dbl_round_info(p_round bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'hash', hash, 'roll', roll, 'seed', seed, 'startsAt', starts_at, 'endsAt', ends_at)
  from public.dbl_round where id = p_round and ends_at <= public._now_ms()
$$;

-- who may call what: the browser gets the public functions, the service key gets the admin ones
revoke execute on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function
  public.crash_state(text),
  public.crash_bet(text, text, numeric, numeric),
  public.crash_cashout(text, bigint),
  public.crash_round_info(bigint),
  public.bj_tables(text, text),
  public.bj_state(int, text, text, text),
  public.bj_sit(int, int, text, text, text, int),
  public.bj_away(int, text, text),
  public.bj_leave(int, text, text),
  public.bj_bet(int, bigint, text, text, numeric),
  public.bj_action(int, bigint, text, text, int, int, text),
  public.bj_react(int, text, text),
  public.bj_result(bigint, text, text),
  public.bj_round_info(bigint),
  public.cb_list(text),
  public.cb_state(bigint, text),
  public.cb_create(text, text, int, text, boolean, numeric, jsonb),
  public.cb_join(bigint, text, text, int, int),
  public.cb_bots(bigint, text),
  public.cb_leave(bigint, text),
  public.cb_result(bigint, text),
  public.dbl_state(text, bigint, jsonb),
  public.dbl_bet(text, text, text, numeric, bigint, int),
  public.dbl_round_info(bigint),
  public.username_available(text)
to anon, authenticated;
grant execute on function
  public.my_profile(),
  public.create_profile(text, jsonb, int),
  public.save_wallet(jsonb, int),
  public.update_profile(text, int),
  public.bj_claim(int, text, text)
to authenticated;
grant execute on function public.admin_create_profile(uuid, text, jsonb, int), public.signup_gate(text) to service_role;

insert into public.app_meta (key, value) values ('schema', '${SCHEMA_VERSION}')
on conflict (key) do update set value = excluded.value;

notify pgrst, 'reload schema';
`
