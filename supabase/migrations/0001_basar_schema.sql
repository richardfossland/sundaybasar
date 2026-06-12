-- ============================================================================
-- SundayBasar — database schema  (idempotent: safe to re-run)
--
-- Lives in a dedicated `basar` Postgres schema so it can coexist with the
-- other SundaySuite apps (SundayChess/Market/Harvest/Turnering/Quiz) in the
-- SAME shared Supabase project — respecting the free-tier 2-project limit.
--
-- Architecture: session-scoped, NO user auth. STRICTER than the sibling apps
-- because real money (Vipps) is involved:
--   • Public tables are SELECT-only for anon — EVERY write goes through a
--     SECURITY DEFINER RPC. No client-side trust anywhere.
--   • The host holds a per-session host_secret (returned ONCE by
--     create_session) required by every host RPC.
--   • Players hold a per-player secret (returned ONCE by join_session).
--   • Draws are performed server-side (strong RNG via gen_random_uuid order)
--     and recorded in a LOCKED append-only audit log. The winner row is
--     invisible to clients until reveal_draw publishes it as an event.
--   • Lot numbering is serialized through basar.lot_counters (row-locked
--     upsert) — concurrent allocations can never duplicate a number.
--   • Lot numbers are NEVER reused after a revoked allocation; gaps in the
--     sequence are an audit feature, not a bug.
--
-- ⚠️  AFTER running this migration you MUST add `basar` to the project's
--     exposed schemas:  Dashboard → Settings → API → "Exposed schemas" → add
--     `basar` → Save. Without that, PostgREST will not route basar.* calls.
-- ============================================================================

create extension if not exists "pgcrypto";
create schema if not exists basar;

-- ── SESSION STATE ───────────────────────────────────────────────────────────
create table if not exists basar.sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_id text not null,
  phase text not null default 'open' check (phase in ('open','ended')),
  -- tildeling: how players obtain lots. kjop = Vipps + manual host allocation;
  -- gratis = every joining player auto-receives `gratis_lodd` lots.
  tildeling text not null check (tildeling in ('kjop','gratis')),
  -- trekning: klassisk = lot stays in pot (can win again); vinner_ut = winning
  -- lot removed at draw time (voiding does NOT restore it); runder = each round
  -- has its own lot sale, one prize per round, numbering restarts per round.
  trekning text not null check (trekning in ('klassisk','vinner_ut','runder')),
  vipps_number text,
  vipps_link text,
  price_per_lodd int not null default 10 check (price_per_lodd >= 0),
  gratis_lodd int not null default 5 check (gratis_lodd between 1 and 100),
  current_round int not null default 1,
  current_prize_id uuid,
  current_draw_id uuid,
  draw_state text not null default 'idle'
    check (draw_state in ('idle','spinning','revealed')),
  player_count int not null default 0,
  created_at timestamptz default now()
);

-- ── HOST SECRET (locked; minted by create_session, returned exactly once) ───
create table if not exists basar.host_secrets (
  session_id uuid primary key references basar.sessions(id) on delete cascade,
  secret text not null default encode(gen_random_bytes(24), 'hex')
);

-- ── PUBLIC PLAYER INFO (no secrets) ─────────────────────────────────────────
create table if not exists basar.players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references basar.sessions(id) on delete cascade,
  name text not null,
  is_offline bool not null default false,  -- host-added participant w/o phone
  is_online bool not null default true,
  created_at timestamptz default now()
);
create index if not exists idx_basar_players_session on basar.players (session_id);

-- ── PER-PLAYER SECRET (locked; offline players have no row) ─────────────────
create table if not exists basar.player_secrets (
  player_id uuid primary key references basar.players(id) on delete cascade,
  secret text not null default encode(gen_random_bytes(24), 'hex')
);

-- ── LOT NUMBER COUNTER (locked, internal — serializes numbering) ────────────
create table if not exists basar.lot_counters (
  session_id uuid references basar.sessions(id) on delete cascade,
  round int not null,
  last_number int not null default 0,
  primary key (session_id, round)
);

-- ── ALLOCATIONS (public audit of every host tap; enables undo) ──────────────
create table if not exists basar.allocations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references basar.sessions(id) on delete cascade,
  player_id uuid references basar.players(id) on delete cascade,
  round int not null,
  count int not null check (count between 1 and 200),
  from_number int not null,
  to_number int not null,
  kind text not null check (kind in ('kjop','gratis_auto','ekstra')),
  revoked bool not null default false,
  created_at timestamptz default now()
);
create index if not exists idx_basar_allocations_session on basar.allocations (session_id);

-- ── LOTS / ÅRER (public — lot numbers are public info at a basar) ───────────
create table if not exists basar.lots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references basar.sessions(id) on delete cascade,
  round int not null default 1,
  number int not null,
  player_id uuid references basar.players(id) on delete cascade,
  allocation_id uuid references basar.allocations(id) on delete cascade,
  removed bool not null default false,  -- vinner_ut: taken out of the pot
  created_at timestamptz default now(),
  unique (session_id, round, number)
);
create index if not exists idx_basar_lots_session_round on basar.lots (session_id, round);
create index if not exists idx_basar_lots_player on basar.lots (player_id);

-- ── PRIZES (public) ─────────────────────────────────────────────────────────
create table if not exists basar.prizes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references basar.sessions(id) on delete cascade,
  name text not null,
  description text,
  position int not null,
  created_at timestamptz default now()
);
create index if not exists idx_basar_prizes_session on basar.prizes (session_id);

-- ── DRAWS (locked append-only audit log — winner must not leak pre-reveal) ──
create table if not exists basar.draws (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references basar.sessions(id) on delete cascade,
  prize_id uuid references basar.prizes(id) on delete cascade,
  round int not null,
  -- lot may be deleted later only via a revoked allocation of a voided draw;
  -- the denormalized lot_number/player_name keep the audit intact regardless.
  lot_id uuid references basar.lots(id) on delete set null,
  lot_number int not null,
  player_id uuid references basar.players(id) on delete set null,
  player_name text not null,
  revealed bool not null default false,
  voided bool not null default false,
  void_reason text,
  created_at timestamptz default now(),
  revealed_at timestamptz
);
create index if not exists idx_basar_draws_session on basar.draws (session_id);

-- ── PUBLIC EVENT LOG (realtime feed; carries reveal payloads) ───────────────
create table if not exists basar.events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references basar.sessions(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_basar_events_session on basar.events (session_id);

-- ── ROW LEVEL SECURITY ──────────────────────────────────────────────────────
alter table basar.sessions       enable row level security;
alter table basar.host_secrets   enable row level security;
alter table basar.players        enable row level security;
alter table basar.player_secrets enable row level security;
alter table basar.lot_counters   enable row level security;
alter table basar.allocations    enable row level security;
alter table basar.lots           enable row level security;
alter table basar.prizes         enable row level security;
alter table basar.draws          enable row level security;
alter table basar.events         enable row level security;

-- Public tables: SELECT-only. ALL writes go through SECURITY DEFINER RPCs —
-- stricter than the sibling apps because money is involved.
drop policy if exists "sessions r" on basar.sessions;
create policy "sessions r" on basar.sessions for select using (true);
drop policy if exists "players r" on basar.players;
create policy "players r" on basar.players for select using (true);
drop policy if exists "allocations r" on basar.allocations;
create policy "allocations r" on basar.allocations for select using (true);
drop policy if exists "lots r" on basar.lots;
create policy "lots r" on basar.lots for select using (true);
drop policy if exists "prizes r" on basar.prizes;
create policy "prizes r" on basar.prizes for select using (true);
drop policy if exists "events r" on basar.events;
create policy "events r" on basar.events for select using (true);

-- Base privileges for a NON-public schema: unlike `public`, Supabase does not
-- auto-grant these, so PostgREST's anon/authenticated roles need them
-- explicitly. Grant broadly first, THEN revoke down to the intended surface.
grant usage on schema basar to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema basar to anon, authenticated, service_role;
grant execute on all functions in schema basar to anon, authenticated, service_role;
alter default privileges in schema basar grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema basar grant execute on functions to anon, authenticated, service_role;

-- Public tables: strip write privileges (RLS would block writes anyway —
-- belt and braces, and it makes the privilege surface auditable).
revoke insert, update, delete on basar.sessions    from anon, authenticated;
revoke insert, update, delete on basar.players     from anon, authenticated;
revoke insert, update, delete on basar.allocations from anon, authenticated;
revoke insert, update, delete on basar.lots        from anon, authenticated;
revoke insert, update, delete on basar.prizes      from anon, authenticated;
revoke insert, update, delete on basar.events      from anon, authenticated;

-- Secret tables: revoke ALL direct anon/authenticated access (service_role
-- keeps it for admin). Reachable only through the SECURITY DEFINER RPCs.
revoke all on basar.host_secrets   from anon, authenticated;
revoke all on basar.player_secrets from anon, authenticated;
revoke all on basar.lot_counters   from anon, authenticated;
revoke all on basar.draws          from anon, authenticated;

-- Realtime: ONLY tables with no secrets and no pre-reveal leak.
-- (host_secrets, player_secrets, lot_counters, draws intentionally absent;
--  allocations omitted too — lots/events carry everything clients need.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'basar' and tablename = 'sessions'
  ) then
    execute 'alter publication supabase_realtime add table basar.sessions';
    execute 'alter publication supabase_realtime add table basar.players';
    execute 'alter publication supabase_realtime add table basar.lots';
    execute 'alter publication supabase_realtime add table basar.prizes';
    execute 'alter publication supabase_realtime add table basar.events';
  end if;
end $$;

-- ============================================================================
-- RPCs (all SECURITY DEFINER, jsonb {ok,...} returns, Norwegian errors).
-- Host RPCs take (p_session_id, p_host_secret) as the first two args.
-- ============================================================================

-- Internal: verify a player's secret.
create or replace function basar._verify(p_player_id uuid, p_secret text)
returns boolean language sql security definer
set search_path = basar, public, extensions as $$
  select exists (
    select 1 from basar.player_secrets
    where player_id = p_player_id and secret = p_secret
  );
$$;

-- Internal: verify the host secret for a session.
create or replace function basar._verify_host(p_session_id uuid, p_host_secret text)
returns boolean language sql security definer
set search_path = basar, public, extensions as $$
  select exists (
    select 1 from basar.host_secrets
    where session_id = p_session_id and secret = p_host_secret
  );
$$;

-- Internal: allocate p_count sequentially-numbered lots to a player.
-- The lot_counters upsert takes a row lock — concurrent allocators are
-- serialized and can never produce duplicate numbers.
create or replace function basar._allocate(
  p_session_id uuid, p_player_id uuid, p_round int, p_count int, p_kind text
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare v_to int; v_from int; v_alloc_id uuid; v_name text;
begin
  insert into basar.lot_counters (session_id, round, last_number)
    values (p_session_id, p_round, p_count)
  on conflict (session_id, round)
    do update set last_number = basar.lot_counters.last_number + p_count
  returning last_number into v_to;
  v_from := v_to - p_count + 1;

  insert into basar.allocations (session_id, player_id, round, count, from_number, to_number, kind)
    values (p_session_id, p_player_id, p_round, p_count, v_from, v_to, p_kind)
    returning id into v_alloc_id;

  insert into basar.lots (session_id, round, number, player_id, allocation_id)
    select p_session_id, p_round, n, p_player_id, v_alloc_id
    from generate_series(v_from, v_to) n;

  select name into v_name from basar.players where id = p_player_id;
  insert into basar.events (session_id, type, payload)
    values (p_session_id, 'lots_allocated', jsonb_build_object(
      'player_id', p_player_id, 'player_name', v_name, 'count', p_count,
      'from_number', v_from, 'to_number', v_to, 'kind', p_kind, 'round', p_round));

  return jsonb_build_object('ok', true, 'allocation_id', v_alloc_id,
    'from_number', v_from, 'to_number', v_to);
end; $$;

-- 0. Create a session. Server-generates the join code AND the host secret in
--    one transaction; the host secret is returned exactly ONCE.
create or replace function basar.create_session(
  p_host_id text, p_tildeling text, p_trekning text,
  p_vipps_number text default null, p_vipps_link text default null,
  p_price int default 10, p_gratis_lodd int default 5
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare v_code text; v_sid uuid; v_secret text; i int;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if p_tildeling not in ('kjop','gratis') then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig tildelingsmodus'); end if;
  if p_trekning not in ('klassisk','vinner_ut','runder') then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig trekningsmodus'); end if;
  if p_tildeling = 'kjop' and char_length(trim(coalesce(p_vipps_number,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Vippsnummer må fylles ut'); end if;
  if p_price < 0 or p_price > 10000 then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig pris'); end if;
  if p_gratis_lodd < 1 or p_gratis_lodd > 100 then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig antall lodd'); end if;
  if char_length(trim(coalesce(p_host_id,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Mangler vert-id'); end if;

  for i in 1..20 loop
    v_code := '';
    for _ in 1..4 loop
      v_code := v_code || substr(alphabet, (get_byte(gen_random_bytes(1), 0) % 24) + 1, 1);
    end loop;
    begin
      insert into basar.sessions (code, host_id, tildeling, trekning,
        vipps_number, vipps_link, price_per_lodd, gratis_lodd)
      values (v_code, p_host_id, p_tildeling, p_trekning,
        nullif(trim(coalesce(p_vipps_number,'')), ''),
        nullif(trim(coalesce(p_vipps_link,'')), ''), p_price, p_gratis_lodd)
      returning id into v_sid;
      exit;
    exception when unique_violation then
      if i = 20 then
        return jsonb_build_object('ok', false, 'error', 'Klarte ikke lage kode — prøv igjen');
      end if;
    end;
  end loop;

  insert into basar.host_secrets (session_id) values (v_sid) returning secret into v_secret;
  return jsonb_build_object('ok', true, 'session_id', v_sid, 'code', v_code,
    'host_secret', v_secret);
end; $$;

-- 1. Join a session. Creates player + secret atomically; returns the secret
--    ONCE. In gratis mode, auto-allocates the configured number of lots.
create or replace function basar.join_session(p_code text, p_name text)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare s record; pid uuid; sec text;
begin
  select * into s from basar.sessions where code = upper(trim(p_code));
  if s is null then return jsonb_build_object('ok', false, 'error', 'Ukjent kode'); end if;
  if s.phase <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'Basaren er avsluttet'); end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Skriv inn et navn'); end if;

  insert into basar.players (session_id, name)
    values (s.id, trim(p_name)) returning id into pid;
  insert into basar.player_secrets (player_id) values (pid) returning secret into sec;
  update basar.sessions set player_count = player_count + 1 where id = s.id;

  if s.tildeling = 'gratis' then
    perform basar._allocate(s.id, pid, s.current_round, s.gratis_lodd, 'gratis_auto');
  end if;

  return jsonb_build_object('ok', true, 'player_id', pid, 'session_id', s.id,
    'secret', sec);
end; $$;

-- 2. Public: revealed draws (incl. voided, flagged) for reconnect/results.
--    Never returns an unrevealed draw — the locked draws table stays dark
--    until reveal_draw flips the flag.
create or replace function basar.get_revealed_draws(p_session_id uuid)
returns jsonb language sql security definer
set search_path = basar, public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_id', d.id, 'prize_id', d.prize_id, 'prize_name', p.name,
    'round', d.round, 'lot_number', d.lot_number,
    'player_id', d.player_id, 'player_name', d.player_name,
    'voided', d.voided, 'void_reason', d.void_reason,
    'revealed_at', d.revealed_at) order by d.revealed_at), '[]')
  from basar.draws d join basar.prizes p on p.id = d.prize_id
  where d.session_id = p_session_id and d.revealed = true;
$$;

-- 3. Presence (player secret-gated, best effort).
create or replace function basar.set_online(p_player_id uuid, p_secret text, p_online bool)
returns void language plpgsql security definer
set search_path = basar, public, extensions as $$
begin
  if basar._verify(p_player_id, p_secret) then
    update basar.players set is_online = p_online where id = p_player_id;
  end if;
end; $$;

-- ── HOST RPCs ───────────────────────────────────────────────────────────────

-- 4. Update settings. vipps/pris always editable; tildeling/trekning/
--    gratis_lodd are LOCKED once any lot exists (pass null to leave as-is).
create or replace function basar.update_settings(
  p_session_id uuid, p_host_secret text,
  p_vipps_number text default null, p_vipps_link text default null,
  p_price int default null,
  p_tildeling text default null, p_trekning text default null,
  p_gratis_lodd int default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare has_lots bool;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if p_price is not null and (p_price < 0 or p_price > 10000) then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig pris'); end if;

  if p_tildeling is not null or p_trekning is not null or p_gratis_lodd is not null then
    select exists (select 1 from basar.lots where session_id = p_session_id) into has_lots;
    if has_lots then
      return jsonb_build_object('ok', false, 'error',
        'Modus kan ikke endres etter at årer er delt ut');
    end if;
    if p_tildeling is not null and p_tildeling not in ('kjop','gratis') then
      return jsonb_build_object('ok', false, 'error', 'Ugyldig tildelingsmodus'); end if;
    if p_trekning is not null and p_trekning not in ('klassisk','vinner_ut','runder') then
      return jsonb_build_object('ok', false, 'error', 'Ugyldig trekningsmodus'); end if;
    if p_gratis_lodd is not null and (p_gratis_lodd < 1 or p_gratis_lodd > 100) then
      return jsonb_build_object('ok', false, 'error', 'Ugyldig antall lodd'); end if;
  end if;

  update basar.sessions set
    vipps_number = coalesce(nullif(trim(coalesce(p_vipps_number,'')), ''), vipps_number),
    vipps_link   = case when p_vipps_link is null then vipps_link
                        else nullif(trim(p_vipps_link), '') end,
    price_per_lodd = coalesce(p_price, price_per_lodd),
    tildeling    = coalesce(p_tildeling, tildeling),
    trekning     = coalesce(p_trekning, trekning),
    gratis_lodd  = coalesce(p_gratis_lodd, gratis_lodd)
  where id = p_session_id;
  return jsonb_build_object('ok', true);
end; $$;

-- 5. Prizes.
create or replace function basar.add_prize(
  p_session_id uuid, p_host_secret text, p_name text, p_description text default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare v_pos int; v_id uuid;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Premien må ha et navn'); end if;
  select coalesce(max(position) + 1, 1) into v_pos
    from basar.prizes where session_id = p_session_id;
  insert into basar.prizes (session_id, name, description, position)
    values (p_session_id, trim(p_name), nullif(trim(coalesce(p_description,'')), ''), v_pos)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'prize_id', v_id);
end; $$;

create or replace function basar.update_prize(
  p_session_id uuid, p_host_secret text, p_prize_id uuid,
  p_name text, p_description text default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Premien må ha et navn'); end if;
  update basar.prizes set name = trim(p_name),
    description = nullif(trim(coalesce(p_description,'')), '')
    where id = p_prize_id and session_id = p_session_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Ukjent premie'); end if;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function basar.delete_prize(
  p_session_id uuid, p_host_secret text, p_prize_id uuid
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if exists (select 1 from basar.draws
             where prize_id = p_prize_id and not voided) then
    return jsonb_build_object('ok', false, 'error', 'Premien er allerede trukket');
  end if;
  delete from basar.prizes where id = p_prize_id and session_id = p_session_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Ukjent premie'); end if;
  return jsonb_build_object('ok', true);
end; $$;

-- Swap with the neighbor above/below (simple, race-free reordering).
create or replace function basar.move_prize(
  p_session_id uuid, p_host_secret text, p_prize_id uuid, p_direction text
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare cur record; nb record;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if p_direction not in ('up','down') then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig retning'); end if;
  select * into cur from basar.prizes
    where id = p_prize_id and session_id = p_session_id for update;
  if cur is null then return jsonb_build_object('ok', false, 'error', 'Ukjent premie'); end if;
  if p_direction = 'up' then
    select * into nb from basar.prizes
      where session_id = p_session_id and position < cur.position
      order by position desc limit 1 for update;
  else
    select * into nb from basar.prizes
      where session_id = p_session_id and position > cur.position
      order by position asc limit 1 for update;
  end if;
  if nb is null then return jsonb_build_object('ok', true); end if;  -- already at edge
  update basar.prizes set position = nb.position where id = cur.id;
  update basar.prizes set position = cur.position where id = nb.id;
  return jsonb_build_object('ok', true);
end; $$;

-- 6. Add a participant without a phone (no secret row → cannot act as player).
--    In gratis mode they auto-receive lots like everyone else.
create or replace function basar.add_offline_player(
  p_session_id uuid, p_host_secret text, p_name text
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare s record; pid uuid;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  select * into s from basar.sessions where id = p_session_id;
  if s.phase <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'Basaren er avsluttet'); end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Skriv inn et navn'); end if;
  insert into basar.players (session_id, name, is_offline, is_online)
    values (p_session_id, trim(p_name), true, false) returning id into pid;
  update basar.sessions set player_count = player_count + 1 where id = p_session_id;
  if s.tildeling = 'gratis' then
    perform basar._allocate(p_session_id, pid, s.current_round, s.gratis_lodd, 'gratis_auto');
  end if;
  return jsonb_build_object('ok', true, 'player_id', pid);
end; $$;

-- 7. Allocate lots to a player (the host tap after seeing the Vipps payment).
create or replace function basar.allocate_lots(
  p_session_id uuid, p_host_secret text, p_player_id uuid, p_count int,
  p_kind text default 'kjop'
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare s record;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if p_count is null or p_count < 1 or p_count > 200 then
    return jsonb_build_object('ok', false, 'error', 'Antall må være 1–200'); end if;
  if p_kind not in ('kjop','ekstra') then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig type'); end if;
  select * into s from basar.sessions where id = p_session_id;
  if s.phase <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'Basaren er avsluttet'); end if;
  if not exists (select 1 from basar.players
                 where id = p_player_id and session_id = p_session_id) then
    return jsonb_build_object('ok', false, 'error', 'Ukjent deltaker'); end if;
  return basar._allocate(p_session_id, p_player_id, s.current_round, p_count, p_kind);
end; $$;

-- 8. Undo an allocation (mis-tap). Blocked once any of its lots has a
--    non-voided draw. Numbers are never reused — the gap stays as audit.
create or replace function basar.revoke_allocation(
  p_session_id uuid, p_host_secret text, p_allocation_id uuid
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare a record; v_name text;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  select * into a from basar.allocations
    where id = p_allocation_id and session_id = p_session_id for update;
  if a is null then return jsonb_build_object('ok', false, 'error', 'Ukjent tildeling'); end if;
  if a.revoked then return jsonb_build_object('ok', false, 'error', 'Allerede angret'); end if;
  if exists (
    select 1 from basar.draws d
    join basar.lots l on l.id = d.lot_id
    where l.allocation_id = p_allocation_id and not d.voided
  ) then
    return jsonb_build_object('ok', false, 'error',
      'Kan ikke angres — et av årene har vunnet en trekning');
  end if;
  delete from basar.lots where allocation_id = p_allocation_id;
  update basar.allocations set revoked = true where id = p_allocation_id;
  select name into v_name from basar.players where id = a.player_id;
  insert into basar.events (session_id, type, payload)
    values (p_session_id, 'allocation_revoked', jsonb_build_object(
      'allocation_id', p_allocation_id, 'player_id', a.player_id,
      'player_name', v_name, 'count', a.count,
      'from_number', a.from_number, 'to_number', a.to_number));
  return jsonb_build_object('ok', true);
end; $$;

-- 9. Start a draw. The conditional UPDATE on draw_state is the concurrency
--    gate (double-tap / two host tabs ⇒ second caller gets 0 rows).
--    Winner is chosen server-side: order by gen_random_uuid() = uniform pick
--    backed by pgcrypto's strong RNG, no modulo bias. The draw row is created
--    with revealed=false — invisible to clients (draws is a locked table)
--    until reveal_draw publishes it.
create or replace function basar.start_draw(
  p_session_id uuid, p_host_secret text, p_prize_id uuid
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare s record; lot record; v_name text; v_draw_id uuid;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;

  -- Claim the spin slot (serialization point).
  update basar.sessions set draw_state = 'spinning', current_prize_id = p_prize_id
    where id = p_session_id and phase = 'open' and draw_state = 'idle';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'En trekning pågår allerede');
  end if;
  select * into s from basar.sessions where id = p_session_id;

  -- Validate under the claim; on any failure release the claim and report.
  if not exists (select 1 from basar.prizes
                 where id = p_prize_id and session_id = p_session_id) then
    update basar.sessions set draw_state = 'idle', current_prize_id = null
      where id = p_session_id;
    return jsonb_build_object('ok', false, 'error', 'Ukjent premie');
  end if;
  if exists (select 1 from basar.draws where prize_id = p_prize_id and not voided) then
    update basar.sessions set draw_state = 'idle', current_prize_id = null
      where id = p_session_id;
    return jsonb_build_object('ok', false, 'error', 'Premien er allerede trukket');
  end if;

  -- Candidate pool: this round's lots, not removed, and (re-draw rule) never
  -- a lot previously drawn for THIS prize — voided or not.
  select l.* into lot from basar.lots l
    where l.session_id = p_session_id and l.round = s.current_round
      and not l.removed
      and not exists (select 1 from basar.draws d
                      where d.prize_id = p_prize_id and d.lot_id = l.id)
    order by gen_random_uuid() limit 1;
  if lot is null then
    update basar.sessions set draw_state = 'idle', current_prize_id = null
      where id = p_session_id;
    return jsonb_build_object('ok', false, 'error', 'Ingen årer i potten');
  end if;

  select name into v_name from basar.players where id = lot.player_id;
  insert into basar.draws (session_id, prize_id, round, lot_id, lot_number, player_id, player_name)
    values (p_session_id, p_prize_id, s.current_round, lot.id, lot.number, lot.player_id, v_name)
    returning id into v_draw_id;
  update basar.sessions set current_draw_id = v_draw_id where id = p_session_id;

  -- vinner_ut: the lot leaves the pot at draw time; voiding does NOT restore it.
  if s.trekning = 'vinner_ut' then
    update basar.lots set removed = true where id = lot.id;
  end if;

  insert into basar.events (session_id, type, payload)
    values (p_session_id, 'draw_started', jsonb_build_object(
      'prize_id', p_prize_id,
      'prize_name', (select name from basar.prizes where id = p_prize_id)));
  return jsonb_build_object('ok', true, 'draw_id', v_draw_id);
end; $$;

-- 10. Reveal the winner (ends the suspense animation).
create or replace function basar.reveal_draw(p_session_id uuid, p_host_secret text)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare s record; d record; v_prize_name text;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  update basar.sessions set draw_state = 'revealed'
    where id = p_session_id and draw_state = 'spinning';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Ingen trekning pågår'); end if;
  select * into s from basar.sessions where id = p_session_id;
  update basar.draws set revealed = true, revealed_at = now()
    where id = s.current_draw_id returning * into d;
  select name into v_prize_name from basar.prizes where id = d.prize_id;
  insert into basar.events (session_id, type, payload)
    values (p_session_id, 'draw_revealed', jsonb_build_object(
      'draw_id', d.id, 'prize_id', d.prize_id, 'prize_name', v_prize_name,
      'round', d.round, 'lot_number', d.lot_number,
      'player_id', d.player_id, 'player_name', d.player_name));
  return jsonb_build_object('ok', true, 'draw_id', d.id,
    'prize_name', v_prize_name, 'lot_number', d.lot_number,
    'player_id', d.player_id, 'player_name', d.player_name);
end; $$;

-- 11. Acknowledge the revealed winner → back to idle. In runder mode this
--     ends the round: round counter advances and (gratis) everyone present
--     auto-receives fresh lots for the new round.
create or replace function basar.acknowledge_draw(p_session_id uuid, p_host_secret text)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare s record; p record;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  update basar.sessions
    set draw_state = 'idle', current_prize_id = null, current_draw_id = null
    where id = p_session_id and draw_state = 'revealed';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Ingen avslørt trekning'); end if;
  select * into s from basar.sessions where id = p_session_id;
  if s.trekning = 'runder' then
    update basar.sessions set current_round = current_round + 1
      where id = p_session_id
      returning current_round into s.current_round;
    if s.tildeling = 'gratis' then
      for p in select id from basar.players where session_id = p_session_id loop
        perform basar._allocate(p_session_id, p.id, s.current_round, s.gratis_lodd, 'gratis_auto');
      end loop;
    end if;
    insert into basar.events (session_id, type, payload)
      values (p_session_id, 'round_started', jsonb_build_object('round', s.current_round));
  end if;
  return jsonb_build_object('ok', true, 'round', s.current_round);
end; $$;

-- 12. Void a revealed draw ("vinneren er ikke til stede"). Append-only: the
--     draw row stays in the audit log with its reason. The prize becomes
--     re-drawable; the voided lot stays excluded for that prize (and in
--     vinner_ut it stays removed from the pot entirely).
create or replace function basar.void_draw(
  p_session_id uuid, p_host_secret text, p_draw_id uuid, p_reason text default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare d record; v_prize_name text;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  select * into d from basar.draws
    where id = p_draw_id and session_id = p_session_id for update;
  if d is null then return jsonb_build_object('ok', false, 'error', 'Ukjent trekning'); end if;
  if not d.revealed then
    return jsonb_build_object('ok', false, 'error', 'Trekningen er ikke avslørt'); end if;
  if d.voided then
    return jsonb_build_object('ok', false, 'error', 'Allerede annullert'); end if;
  update basar.draws set voided = true,
    void_reason = nullif(trim(coalesce(p_reason,'')), '')
    where id = p_draw_id;
  -- If this was the active draw, release the slot so the host can redraw.
  update basar.sessions
    set draw_state = 'idle', current_prize_id = null, current_draw_id = null
    where id = p_session_id and current_draw_id = p_draw_id;
  select name into v_prize_name from basar.prizes where id = d.prize_id;
  insert into basar.events (session_id, type, payload)
    values (p_session_id, 'draw_voided', jsonb_build_object(
      'draw_id', p_draw_id, 'prize_id', d.prize_id, 'prize_name', v_prize_name,
      'lot_number', d.lot_number, 'player_name', d.player_name,
      'reason', nullif(trim(coalesce(p_reason,'')), '')));
  return jsonb_build_object('ok', true);
end; $$;

-- 13. End the session.
create or replace function basar.end_session(p_session_id uuid, p_host_secret text)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  update basar.sessions
    set phase = 'ended', draw_state = 'idle',
        current_prize_id = null, current_draw_id = null
    where id = p_session_id and phase = 'open';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Allerede avsluttet'); end if;
  insert into basar.events (session_id, type, payload)
    values (p_session_id, 'session_ended', '{}');
  return jsonb_build_object('ok', true);
end; $$;

-- 14. Full audit log (host only) — includes unrevealed and voided rows.
create or replace function basar.get_draw_log(p_session_id uuid, p_host_secret text)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  return jsonb_build_object('ok', true, 'draws', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'draw_id', d.id, 'prize_id', d.prize_id, 'prize_name', p.name,
      'round', d.round, 'lot_number', d.lot_number,
      'player_id', d.player_id, 'player_name', d.player_name,
      'revealed', d.revealed, 'voided', d.voided, 'void_reason', d.void_reason,
      'created_at', d.created_at, 'revealed_at', d.revealed_at)
      order by d.created_at), '[]')
    from basar.draws d join basar.prizes p on p.id = d.prize_id
    where d.session_id = p_session_id));
end; $$;

-- ── FUNCTION PRIVILEGES ─────────────────────────────────────────────────────
-- Internal helpers must not be callable from PostgREST. Revoking from PUBLIC
-- matters: functions are PUBLIC-executable by default, so revoking only from
-- anon/authenticated would leave them reachable through the PUBLIC grant.
revoke execute on function basar._verify(uuid, text) from public, anon, authenticated;
revoke execute on function basar._verify_host(uuid, text) from public, anon, authenticated;
revoke execute on function basar._allocate(uuid, uuid, int, int, text) from public, anon, authenticated;

grant execute on function
  basar.create_session, basar.join_session, basar.get_revealed_draws,
  basar.set_online, basar.update_settings,
  basar.add_prize, basar.update_prize, basar.delete_prize, basar.move_prize,
  basar.add_offline_player, basar.allocate_lots, basar.revoke_allocation,
  basar.start_draw, basar.reveal_draw, basar.acknowledge_draw, basar.void_draw,
  basar.end_session, basar.get_draw_log
  to anon, authenticated;
