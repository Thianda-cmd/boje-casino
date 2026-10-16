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
*/

export const SCHEMA_VERSION = '2026-10-15.1'

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
