-- ============================================================================
-- SundayBasar — 0002: optional prize images  (idempotent + additive)
--
-- Adds an OPTIONAL image_url to prizes so the projector / winner card can show
-- a photo of the prize. Purely cosmetic and fully backward-compatible:
--   • the column is nullable with no default — existing prizes are unaffected;
--   • add_prize / update_prize gain a trailing optional p_image_url argument
--     (defaulting to null / "leave as-is"), so existing call sites that omit it
--     keep working unchanged;
--   • get_revealed_draws / get_draw_log now surface prize image_url.
--
-- The URL is expected to be a public Supabase Storage object URL (host uploads
-- the photo client-side with the anon key into a public bucket; nothing secret
-- and no fairness/audit data lives here). Validated to be http(s) so a prize
-- image can never smuggle a javascript:/data: URL into the projector DOM.
--
-- Safe to re-run. Requires `basar` in Exposed schemas (see 0001).
-- ============================================================================

alter table basar.prizes add column if not exists image_url text;

-- Reject anything that is not a plain http(s) URL (defense in depth — the UI
-- only ever sends Storage URLs, but the column is public-readable).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prizes_image_url_http'
  ) then
    alter table basar.prizes
      add constraint prizes_image_url_http
      check (image_url is null or image_url ~ '^https?://');
  end if;
end $$;

-- Adding a new trailing default arg makes a DIFFERENT function signature, so
-- `create or replace` would leave the old 4-arg overload in place and calls
-- with the original arity would become ambiguous ("function is not unique").
-- Drop the previous signatures first so exactly one overload remains.
drop function if exists basar.add_prize(uuid, text, text, text);
drop function if exists basar.update_prize(uuid, text, uuid, text, text);

-- ── add_prize: gains trailing optional p_image_url (default null) ────────────
create or replace function basar.add_prize(
  p_session_id uuid, p_host_secret text, p_name text,
  p_description text default null, p_image_url text default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare v_pos int; v_id uuid; v_img text;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Premien må ha et navn'); end if;
  v_img := nullif(trim(coalesce(p_image_url,'')), '');
  if v_img is not null and v_img !~ '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig bilde-URL'); end if;
  select coalesce(max(position) + 1, 1) into v_pos
    from basar.prizes where session_id = p_session_id;
  insert into basar.prizes (session_id, name, description, position, image_url)
    values (p_session_id, trim(p_name), nullif(trim(coalesce(p_description,'')), ''),
            v_pos, v_img)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'prize_id', v_id);
end; $$;

-- ── update_prize: gains trailing optional p_image_url ────────────────────────
-- p_image_url semantics: null = leave image as-is; '' (empty) = clear the
-- image; any http(s) URL = set it. Mirrors the existing vipps_link pattern.
create or replace function basar.update_prize(
  p_session_id uuid, p_host_secret text, p_prize_id uuid,
  p_name text, p_description text default null, p_image_url text default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare v_img text;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Premien må ha et navn'); end if;
  if p_image_url is not null and trim(p_image_url) <> ''
     and trim(p_image_url) !~ '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'Ugyldig bilde-URL'); end if;
  v_img := case when p_image_url is null then null
                else nullif(trim(p_image_url), '') end;
  update basar.prizes set name = trim(p_name),
    description = nullif(trim(coalesce(p_description,'')), ''),
    image_url = case when p_image_url is null then image_url else v_img end
    where id = p_prize_id and session_id = p_session_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Ukjent premie'); end if;
  return jsonb_build_object('ok', true);
end; $$;

-- ── get_revealed_draws: surface prize image_url (additive field) ─────────────
create or replace function basar.get_revealed_draws(p_session_id uuid)
returns jsonb language sql security definer
set search_path = basar, public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_id', d.id, 'prize_id', d.prize_id, 'prize_name', p.name,
    'prize_image_url', p.image_url,
    'round', d.round, 'lot_number', d.lot_number,
    'player_id', d.player_id, 'player_name', d.player_name,
    'voided', d.voided, 'void_reason', d.void_reason,
    'revealed_at', d.revealed_at) order by d.revealed_at), '[]')
  from basar.draws d join basar.prizes p on p.id = d.prize_id
  where d.session_id = p_session_id and d.revealed = true;
$$;

-- ── get_draw_log: surface prize image_url too (host audit view) ──────────────
create or replace function basar.get_draw_log(p_session_id uuid, p_host_secret text)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  return jsonb_build_object('ok', true, 'draws', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'draw_id', d.id, 'prize_id', d.prize_id, 'prize_name', p.name,
      'prize_image_url', p.image_url,
      'round', d.round, 'lot_number', d.lot_number,
      'player_id', d.player_id, 'player_name', d.player_name,
      'revealed', d.revealed, 'voided', d.voided, 'void_reason', d.void_reason,
      'created_at', d.created_at, 'revealed_at', d.revealed_at)
      order by d.created_at), '[]')
    from basar.draws d join basar.prizes p on p.id = d.prize_id
    where d.session_id = p_session_id));
end; $$;

-- Re-grant execute (signatures changed → new function objects in some PG paths).
grant execute on function
  basar.add_prize(uuid, text, text, text, text),
  basar.update_prize(uuid, text, uuid, text, text, text),
  basar.get_revealed_draws(uuid),
  basar.get_draw_log(uuid, text)
  to anon, authenticated;
