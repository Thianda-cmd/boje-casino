/*
  Database schema for the casino, applied by /api/setup when SCHEMA_VERSION changes.

  Everything the browser touches is a SECURITY DEFINER function in the public schema, called
  through Supabase's REST API (POST /rest/v1/rpc/<name>). The tables themselves have row level
  security on and no policies, so they can't be read or written directly with the public key.

  Crash: rounds are created lazily by whichever call notices the last one is over, so there is no
  worker. Each round commits to sha256(seed) before bets open; the seed (and so the crash point)
  is only revealed once the rocket has blown.
  Accounts: Supabase Auth users, one profile row each holding the username, avatar and wallet.
*/

export const SCHEMA_VERSION = '2026-10-14.3'

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

create or replace function public._now_ms() returns bigint
language sql volatile set search_path = public as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
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

-- who may call what: the browser gets the public functions, the service key gets the admin ones
revoke execute on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function
  public.crash_state(text),
  public.crash_bet(text, text, numeric, numeric),
  public.crash_cashout(text, bigint),
  public.crash_round_info(bigint),
  public.username_available(text)
to anon, authenticated;
grant execute on function
  public.my_profile(),
  public.create_profile(text, jsonb, int),
  public.save_wallet(jsonb, int),
  public.update_profile(text, int)
to authenticated;
grant execute on function public.admin_create_profile(uuid, text, jsonb, int), public.signup_gate(text) to service_role;

insert into public.app_meta (key, value) values ('schema', '${SCHEMA_VERSION}')
on conflict (key) do update set value = excluded.value;

notify pgrst, 'reload schema';
`
