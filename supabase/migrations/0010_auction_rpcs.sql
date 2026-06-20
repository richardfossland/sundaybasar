-- 0010 — auction module, part 5/5: the SECURITY DEFINER RPCs.
--
-- Same trust model as basar: public tables are SELECT-only, every write goes
-- through one of these. Host RPCs take (p_session_id, p_host_secret); player
-- RPCs take (p_player_id, p_secret) and are verified with the existing
-- basar._verify / basar._verify_host helpers.
--
-- Bidding covers BOTH 'live' and 'stille' formats — they share one ascending,
-- eBay-style proxy engine; the only difference is UI/host staging. 'hollandsk'
-- (descending price / dutch_take) and the live "call_stage" theatrics are a
-- later PR and are explicitly rejected here for now.
--
-- Idempotent (create or replace / nothing destructive).

-- ── 0. Create an auction session ────────────────────────────────────────────
-- Reuses basar.sessions. tildeling='kjop' so join_session allocates NO free
-- lots; trekning='klassisk' is an ignored placeholder. kind='auksjon' is the
-- discriminator the UI branches on.
create or replace function basar.create_auction_session(
  p_host_id text, p_goal_amount numeric default null,
  p_vipps_number text default null, p_vipps_link text default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare v_code text; v_sid uuid; v_secret text; i int;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if char_length(trim(coalesce(p_host_id,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Mangler vert-id'); end if;
  if p_goal_amount is not null and p_goal_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig mål'); end if;

  for i in 1..20 loop
    v_code := '';
    for _ in 1..4 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * 24)::int, 1);
    end loop;
    begin
      insert into basar.sessions (code, host_id, tildeling, trekning,
        vipps_number, vipps_link, kind, goal_amount)
      values (v_code, p_host_id, 'kjop', 'klassisk',
        nullif(trim(coalesce(p_vipps_number,'')), ''),
        nullif(trim(coalesce(p_vipps_link,'')), ''), 'auksjon', p_goal_amount)
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

-- ── 1. Create an auction item (host) ────────────────────────────────────────
create or replace function basar.create_auction_item(
  p_session_id uuid, p_host_secret text,
  p_title text, p_description text, p_category text, p_format text,
  p_start_price numeric default 0, p_min_increment numeric default 10,
  p_image_url text default null, p_donor_name text default null,
  p_reserve_price numeric default null, p_buy_now_price numeric default null,
  p_deadline timestamptz default null, p_antisnipe_seconds int default 10
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

  select coalesce(max(position) + 1, 1) into v_pos
    from basar.auction_items where session_id = p_session_id;
  insert into basar.auction_items (session_id, position, title, description,
    image_url, category, format, donor_name, start_price, min_increment,
    reserve_price, buy_now_price, deadline, antisnipe_seconds)
  values (p_session_id, v_pos, trim(p_title),
    nullif(trim(coalesce(p_description,'')), ''),
    nullif(trim(coalesce(p_image_url,'')), ''), p_category, p_format,
    nullif(trim(coalesce(p_donor_name,'')), ''), v_start, v_inc,
    p_reserve_price, p_buy_now_price, p_deadline, coalesce(p_antisnipe_seconds, 10))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'item_id', v_id);
end; $$;

-- ── 2. Delete an item (host) — blocked once sold ────────────────────────────
create or replace function basar.delete_auction_item(
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
    return jsonb_build_object('ok', false, 'error', 'Solgt objekt kan ikke slettes'); end if;
  delete from basar.auction_items where id = p_item_id;  -- cascades bids/maxes
  return jsonb_build_object('ok', true);
end; $$;

-- ── 3. Activate an item so it accepts bids (host) ───────────────────────────
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
    update basar.auction_items set status = 'active' where id = p_item_id;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- ── 4. Place a bid (player) — eBay-style proxy, ascending (live + stille) ────
-- p_amount is the bidder's MAXIMUM. The displayed price auto-resolves: a rival's
-- hidden higher max bids back automatically, so a bid can be accepted yet not
-- lead. The item row is locked (for update) so concurrent bids serialize — the
-- same technique basar uses on lot_counters.
create or replace function basar.place_bid(
  p_player_id uuid, p_secret text, p_item_id uuid, p_amount numeric
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare it record; v_existing numeric;
  v_m1_player uuid; v_m1_max numeric; v_m2_player uuid; v_m2_max numeric;
  v_current numeric; v_leader uuid;
begin
  if not basar._verify(p_player_id, p_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ukjent deltaker'); end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig beløp'); end if;

  select * into it from basar.auction_items where id = p_item_id for update;
  if it is null then return jsonb_build_object('ok', false, 'error', 'Ukjent objekt'); end if;
  if not exists (select 1 from basar.players
                 where id = p_player_id and session_id = it.session_id) then
    return jsonb_build_object('ok', false, 'error', 'Ukjent deltaker'); end if;
  if (select phase from basar.sessions where id = it.session_id) <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'Auksjonen er avsluttet'); end if;
  if it.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'Objektet tar ikke imot bud'); end if;
  if it.format = 'hollandsk' then
    return jsonb_build_object('ok', false, 'error', 'Bruk «Kjøp nå» på hollandsk auksjon'); end if;
  if it.deadline is not null and now() > it.deadline then
    return jsonb_build_object('ok', false, 'error', 'Fristen er ute'); end if;

  select max_amount into v_existing from basar.auction_proxy_maxes
    where item_id = p_item_id and player_id = p_player_id;
  if v_existing is not null and p_amount <= v_existing then
    return jsonb_build_object('ok', false, 'error', 'Budet må være høyere enn ditt forrige'); end if;

  -- Minimum acceptable: a challenger must clear current + increment; the first
  -- bid only needs to reach the start price; the leader may freely raise (only
  -- the "> own previous" rule above applies).
  if it.current_leader_player_id is distinct from p_player_id then
    if it.current_amount is null then
      if p_amount < it.start_price then
        return jsonb_build_object('ok', false, 'error', 'Budet er under startpris'); end if;
    else
      if p_amount < it.current_amount + it.min_increment then
        return jsonb_build_object('ok', false, 'error', 'For lavt bud'); end if;
    end if;
  end if;

  insert into basar.auction_proxy_maxes (item_id, player_id, max_amount, updated_at)
    values (p_item_id, p_player_id, p_amount, now())
  on conflict (item_id, player_id)
    do update set max_amount = excluded.max_amount, updated_at = excluded.updated_at;

  -- Resolve price + leader from the top two hidden maxes (earliest wins ties).
  select player_id, max_amount into v_m1_player, v_m1_max
    from basar.auction_proxy_maxes where item_id = p_item_id
    order by max_amount desc, updated_at asc limit 1;
  select player_id, max_amount into v_m2_player, v_m2_max
    from basar.auction_proxy_maxes where item_id = p_item_id
    order by max_amount desc, updated_at asc offset 1 limit 1;

  v_leader := v_m1_player;
  if v_m2_player is null then
    v_current := it.start_price;                       -- sole bidder sits at start price
  else
    v_current := least(v_m1_max, v_m2_max + it.min_increment);
  end if;

  -- Anti-snipe: a bid in the final seconds pushes the deadline out.
  if it.deadline is not null
     and it.deadline - now() < make_interval(secs => it.antisnipe_seconds) then
    update basar.auction_items
      set deadline = now() + make_interval(secs => it.antisnipe_seconds)
      where id = p_item_id;
  end if;

  update basar.auction_items
    set current_amount = v_current, current_leader_player_id = v_leader
    where id = p_item_id;
  insert into basar.auction_bids (item_id, player_id, amount, kind)
    values (p_item_id, p_player_id, v_current, 'manual');

  return jsonb_build_object('ok', true, 'current_amount', v_current,
    'leading', (v_leader = p_player_id));
end; $$;

-- ── 5. Buy now (player) — instant sale at the fixed price ────────────────────
create or replace function basar.buy_now(
  p_player_id uuid, p_secret text, p_item_id uuid
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare it record;
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
  if it.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'Objektet tar ikke imot bud'); end if;
  if it.buy_now_price is null then
    return jsonb_build_object('ok', false, 'error', 'Objektet har ikke kjøp-nå'); end if;

  update basar.auction_items set status = 'sold', winner_player_id = p_player_id,
    winning_amount = it.buy_now_price, current_amount = it.buy_now_price,
    current_leader_player_id = p_player_id
    where id = p_item_id;
  insert into basar.auction_bids (item_id, player_id, amount, kind)
    values (p_item_id, p_player_id, it.buy_now_price, 'buynow');
  insert into basar.auction_settlements (item_id, player_id, amount)
    values (p_item_id, p_player_id, it.buy_now_price);
  return jsonb_build_object('ok', true, 'amount', it.buy_now_price);
end; $$;

-- ── 6. Mark sold (host) — finalize at the current price ─────────────────────
create or replace function basar.mark_sold(
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
  if it.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'Objektet er ikke aktivt'); end if;
  if it.current_leader_player_id is null then
    return jsonb_build_object('ok', false, 'error', 'Ingen bud å selge til'); end if;
  if it.reserve_price is not null and it.current_amount < it.reserve_price then
    return jsonb_build_object('ok', false, 'error', 'Reservepris ikke nådd'); end if;

  update basar.auction_items set status = 'sold',
    winner_player_id = it.current_leader_player_id, winning_amount = it.current_amount
    where id = p_item_id;
  insert into basar.auction_settlements (item_id, player_id, amount)
    values (p_item_id, it.current_leader_player_id, it.current_amount);
  return jsonb_build_object('ok', true, 'winner_player_id', it.current_leader_player_id,
    'winning_amount', it.current_amount);
end; $$;

-- ── 7. Pass an item (host) — unsold / reserve not met ───────────────────────
create or replace function basar.pass_item(
  p_session_id uuid, p_host_secret text, p_item_id uuid, p_reason text default null
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
    return jsonb_build_object('ok', false, 'error', 'Solgt objekt kan ikke passes'); end if;
  update basar.auction_items set status = 'passed' where id = p_item_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ── 8. Toggle a settlement's paid flag (host) ───────────────────────────────
create or replace function basar.set_settlement_paid(
  p_session_id uuid, p_host_secret text, p_settlement_id uuid, p_paid bool
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  update basar.auction_settlements s
    set paid = coalesce(p_paid, false),
        paid_at = case when coalesce(p_paid, false) then now() else null end
    where s.id = p_settlement_id
      and s.item_id in (select id from basar.auction_items where session_id = p_session_id);
  if not found then return jsonb_build_object('ok', false, 'error', 'Ukjent oppgjør'); end if;
  return jsonb_build_object('ok', true);
end; $$;

-- ── 9. Settlements for the host oppgjør tab (host) ──────────────────────────
create or replace function basar.get_settlements(p_session_id uuid, p_host_secret text)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  return jsonb_build_object('ok', true, 'settlements', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'settlement_id', s.id, 'item_id', s.item_id, 'item_title', i.title,
      'player_id', s.player_id, 'player_name', pl.name,
      'amount', s.amount, 'method', s.method, 'paid', s.paid,
      'paid_at', s.paid_at, 'created_at', s.created_at) order by s.created_at), '[]')
    from basar.auction_settlements s
    join basar.auction_items i on i.id = s.item_id
    left join basar.players pl on pl.id = s.player_id
    where i.session_id = p_session_id));
end; $$;

-- ── 10. Public auction state (anon) — items + thermometer, NO secrets ───────
-- Never returns reserve_price or any proxy max — only a reserve_met boolean.
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
        'winner_player_id', i.winner_player_id, 'winner_name', wp.name,
        'winning_amount', i.winning_amount)
        order by i.position)
      from basar.auction_items i
      left join basar.players lp on lp.id = i.current_leader_player_id
      left join basar.players wp on wp.id = i.winner_player_id
      where i.session_id = p_session_id), '[]'::jsonb));
$$;

-- ── PRIVILEGES ──────────────────────────────────────────────────────────────
-- Explicit signatures (matches 0001's style; unambiguous on re-apply).
grant execute on function
  basar.create_auction_session(text, numeric, text, text),
  basar.create_auction_item(uuid, text, text, text, text, text, numeric, numeric, text, text, numeric, numeric, timestamptz, integer),
  basar.delete_auction_item(uuid, text, uuid),
  basar.activate_item(uuid, text, uuid),
  basar.place_bid(uuid, text, uuid, numeric),
  basar.buy_now(uuid, text, uuid),
  basar.mark_sold(uuid, text, uuid),
  basar.pass_item(uuid, text, uuid, text),
  basar.set_settlement_paid(uuid, text, uuid, boolean),
  basar.get_settlements(uuid, text),
  basar.get_auction_state(uuid)
  to anon, authenticated;
