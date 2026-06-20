-- 0011 — auction module: hollandsk (descending price) + live "klubbe" staging.
--
-- Adds the two formats the first auction PR deferred:
--   • hollandsk — price drops on a schedule; first to tap "Kjøp nå" wins.
--     start_dutch stamps the clock; dutch_take resolves first-click-wins under a
--     row lock (same serialization technique as place_bid / lot_counters).
--   • live "call_stage" — the auctioneer flags "Første/Andre gang" on a live item
--     (live bidding itself already uses the ascending place_bid engine).
--
-- The dutch_* columns already exist (migration 0007); this adds live_stage,
-- teaches create_auction_item / get_auction_state about them, and adds the RPCs.
-- Idempotent (create or replace / drop-if-exists; nothing destructive to data).

alter table basar.auction_items add column if not exists live_stage text
  check (live_stage is null or live_stage in ('first','second'));

-- ── create_auction_item: now accepts dutch parameters ───────────────────────
-- Dropped + recreated (signature grows by 4 trailing optional args). Named-param
-- callers that omit them (the existing frontend) are unaffected.
drop function if exists basar.create_auction_item(
  uuid, text, text, text, text, text, numeric, numeric, text, text, numeric, numeric, timestamptz, integer);

create or replace function basar.create_auction_item(
  p_session_id uuid, p_host_secret text,
  p_title text, p_description text, p_category text, p_format text,
  p_start_price numeric default 0, p_min_increment numeric default 10,
  p_image_url text default null, p_donor_name text default null,
  p_reserve_price numeric default null, p_buy_now_price numeric default null,
  p_deadline timestamptz default null, p_antisnipe_seconds int default 10,
  p_dutch_start numeric default null, p_dutch_floor numeric default null,
  p_dutch_step numeric default null, p_dutch_interval_seconds int default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare v_pos int; v_id uuid; v_start numeric; v_inc numeric;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if char_length(trim(coalesce(p_title,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Objektet må ha en tittel'); end if;
  if p_category not in ('tjeneste','gjenstand','opplevelse','mystery') then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig kategori'); end if;
  if p_format not in ('live','stille','hollandsk') then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig format'); end if;
  v_start := coalesce(p_start_price, 0);
  v_inc := coalesce(p_min_increment, 10);
  if v_start < 0 then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig startpris'); end if;
  if v_inc <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Budøkning må være positiv'); end if;
  if p_image_url is not null and trim(p_image_url) <> '' and p_image_url !~ '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig bilde-URL'); end if;
  if p_reserve_price is not null and p_reserve_price < v_start then
    return jsonb_build_object('ok', false, 'error', 'Reservepris må være minst startpris'); end if;
  if p_buy_now_price is not null and p_buy_now_price < v_start then
    return jsonb_build_object('ok', false, 'error', 'Kjøp-nå-pris må være minst startpris'); end if;

  -- Dutch items need a valid descending curve (start > floor >= 0, step/interval > 0).
  if p_format = 'hollandsk' then
    if p_dutch_start is null or p_dutch_floor is null or p_dutch_step is null
       or p_dutch_interval_seconds is null then
      return jsonb_build_object('ok', false, 'error', 'Hollandsk auksjon krever start/gulv/fall/intervall'); end if;
    if p_dutch_floor < 0 or p_dutch_start <= p_dutch_floor then
      return jsonb_build_object('ok', false, 'error', 'Startpris må være større enn gulvpris'); end if;
    if p_dutch_step <= 0 or p_dutch_interval_seconds <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Prisfall og intervall må være positive'); end if;
  end if;

  select coalesce(max(position) + 1, 1) into v_pos
    from basar.auction_items where session_id = p_session_id;
  insert into basar.auction_items (session_id, position, title, description,
    image_url, category, format, donor_name, start_price, min_increment,
    reserve_price, buy_now_price, deadline, antisnipe_seconds,
    dutch_start, dutch_floor, dutch_step, dutch_interval_seconds)
  values (p_session_id, v_pos, trim(p_title),
    nullif(trim(coalesce(p_description,'')), ''),
    nullif(trim(coalesce(p_image_url,'')), ''), p_category, p_format,
    nullif(trim(coalesce(p_donor_name,'')), ''), v_start, v_inc,
    p_reserve_price, p_buy_now_price, p_deadline, coalesce(p_antisnipe_seconds, 10),
    p_dutch_start, p_dutch_floor, p_dutch_step, p_dutch_interval_seconds)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'item_id', v_id);
end; $$;

-- ── activate_item: also clears any stale live stage ─────────────────────────
create or replace function basar.activate_item(
  p_session_id uuid, p_host_secret text, p_item_id uuid
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare it record;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  select * into it from basar.auction_items
    where id = p_item_id and session_id = p_session_id for update;
  if it is null then return jsonb_build_object('ok', false, 'error', 'Ukjent objekt'); end if;
  if it.status = 'sold' then
    return jsonb_build_object('ok', false, 'error', 'Solgt objekt kan ikke aktiveres'); end if;
  if it.status <> 'active' then
    update basar.auction_items set status = 'active', live_stage = null where id = p_item_id;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- ── start_dutch (host): begin the descent ───────────────────────────────────
create or replace function basar.start_dutch(
  p_session_id uuid, p_host_secret text, p_item_id uuid
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare it record;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  select * into it from basar.auction_items
    where id = p_item_id and session_id = p_session_id for update;
  if it is null then return jsonb_build_object('ok', false, 'error', 'Ukjent objekt'); end if;
  if it.format <> 'hollandsk' then
    return jsonb_build_object('ok', false, 'error', 'Ikke en hollandsk auksjon'); end if;
  if it.status = 'sold' then
    return jsonb_build_object('ok', false, 'error', 'Objektet er allerede solgt'); end if;
  if it.dutch_start is null or it.dutch_floor is null or it.dutch_step is null
     or it.dutch_interval_seconds is null then
    return jsonb_build_object('ok', false, 'error', 'Mangler hollandsk pris-oppsett'); end if;
  update basar.auction_items
    set status = 'active', dutch_started_at = now(), current_amount = it.dutch_start
    where id = p_item_id;
  return jsonb_build_object('ok', true, 'start_price', it.dutch_start);
end; $$;

-- ── dutch_take (player): first tap at the current dropped price wins ─────────
create or replace function basar.dutch_take(
  p_player_id uuid, p_secret text, p_item_id uuid
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare it record; v_elapsed numeric; v_steps numeric; v_price numeric;
begin
  if not basar._verify(p_player_id, p_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ukjent deltaker'); end if;
  select * into it from basar.auction_items where id = p_item_id for update;
  if it is null then return jsonb_build_object('ok', false, 'error', 'Ukjent objekt'); end if;
  if not exists (select 1 from basar.players
                 where id = p_player_id and session_id = it.session_id) then
    return jsonb_build_object('ok', false, 'error', 'Ukjent deltaker'); end if;
  if (select phase from basar.sessions where id = it.session_id) <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'Auksjonen er avsluttet'); end if;
  if it.format <> 'hollandsk' then
    return jsonb_build_object('ok', false, 'error', 'Ikke en hollandsk auksjon'); end if;
  if it.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'Objektet tar ikke imot bud'); end if;
  if it.dutch_started_at is null then
    return jsonb_build_object('ok', false, 'error', 'Prisfallet har ikke startet'); end if;

  -- Current price = start − (whole intervals elapsed)·step, floored at dutch_floor.
  v_elapsed := extract(epoch from (now() - it.dutch_started_at));
  v_steps := floor(v_elapsed / it.dutch_interval_seconds);
  v_price := greatest(it.dutch_floor, it.dutch_start - v_steps * it.dutch_step);

  update basar.auction_items set status = 'sold', winner_player_id = p_player_id,
    winning_amount = v_price, current_amount = v_price, current_leader_player_id = p_player_id
    where id = p_item_id;
  insert into basar.auction_bids (item_id, player_id, amount, kind)
    values (p_item_id, p_player_id, v_price, 'dutch_take');
  insert into basar.auction_settlements (item_id, player_id, amount)
    values (p_item_id, p_player_id, v_price);
  return jsonb_build_object('ok', true, 'amount', v_price);
end; $$;

-- ── call_stage (host): live "Første/Andre gang" ─────────────────────────────
create or replace function basar.call_stage(
  p_session_id uuid, p_host_secret text, p_item_id uuid, p_stage text
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare it record;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if p_stage not in ('first','second','none') then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig stadium'); end if;
  select * into it from basar.auction_items
    where id = p_item_id and session_id = p_session_id for update;
  if it is null then return jsonb_build_object('ok', false, 'error', 'Ukjent objekt'); end if;
  if it.format <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'Ikke en live-auksjon'); end if;
  if it.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'Objektet er ikke aktivt'); end if;
  update basar.auction_items set live_stage = nullif(p_stage, 'none') where id = p_item_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ── get_auction_state: now surfaces dutch params + live_stage ───────────────
-- Still NEVER returns reserve_price (only has_reserve / reserve_met).
create or replace function basar.get_auction_state(p_session_id uuid)
returns jsonb language sql security definer
set search_path = basar, public, extensions as $$
  select jsonb_build_object(
    'ok', true,
    'goal_amount', (select goal_amount from basar.sessions where id = p_session_id),
    'raised_total', coalesce((select sum(winning_amount) from basar.auction_items
        where session_id = p_session_id and status = 'sold'), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'title', i.title,
        'description', i.description, 'image_url', i.image_url,
        'category', i.category, 'format', i.format, 'donor_name', i.donor_name,
        'start_price', i.start_price, 'min_increment', i.min_increment,
        'buy_now_price', i.buy_now_price, 'deadline', i.deadline,
        'status', i.status, 'current_amount', i.current_amount,
        'current_leader_player_id', i.current_leader_player_id,
        'leader_name', lp.name,
        'has_reserve', (i.reserve_price is not null),
        'reserve_met', (i.reserve_price is null
                        or (i.current_amount is not null and i.current_amount >= i.reserve_price)),
        'dutch_start', i.dutch_start, 'dutch_floor', i.dutch_floor,
        'dutch_step', i.dutch_step, 'dutch_interval_seconds', i.dutch_interval_seconds,
        'dutch_started_at', i.dutch_started_at, 'live_stage', i.live_stage,
        'winner_player_id', i.winner_player_id, 'winner_name', wp.name,
        'winning_amount', i.winning_amount)
        order by i.position)
      from basar.auction_items i
      left join basar.players lp on lp.id = i.current_leader_player_id
      left join basar.players wp on wp.id = i.winner_player_id
      where i.session_id = p_session_id), '[]'::jsonb));
$$;

-- ── privileges ──────────────────────────────────────────────────────────────
grant execute on function
  basar.create_auction_item(uuid, text, text, text, text, text, numeric, numeric, text, text, numeric, numeric, timestamptz, integer, numeric, numeric, numeric, integer),
  basar.start_dutch(uuid, text, uuid),
  basar.dutch_take(uuid, text, uuid),
  basar.call_stage(uuid, text, uuid, text)
  to anon, authenticated;
