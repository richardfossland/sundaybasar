-- 0012 — stille auksjon: frist satt ved AKTIVERING.
--
-- «Stille (tidsbasert)» har hatt fristen (auction_items.deadline) og anti-snik
-- i databasen siden 0007/0010, men ingen måte å sette den på fra vertspanelet:
-- create_auction_item tar p_deadline som et absolutt tidspunkt, og objekter
-- lages gjerne dagen før de aktiveres. Fristen hører til aktiveringen, ikke
-- opprettelsen. activate_item får derfor et valgfritt p_duration_seconds:
--   • gitt (> 0) → deadline = now() + varighet. Gjelder også et allerede
--     aktivt objekt, så verten kan gi «+2 min» (forlenge) uten ny funksjon.
--   • utelatt/null → som før (deadline urørt).
-- Den gamle 3-args-signaturen droppes så navngitte PostgREST-kall og
-- posisjonelle 3-args-kall begge treffer én entydig funksjon (jf. 0002/0011).
-- Idempotent (drop if exists + create or replace). Ingen datamigrasjon.

drop function if exists basar.activate_item(uuid, text, uuid);

create or replace function basar.activate_item(
  p_session_id uuid, p_host_secret text, p_item_id uuid,
  p_duration_seconds int default null
) returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare it record; v_deadline timestamptz;
begin
  if not basar._verify_host(p_session_id, p_host_secret) then
    return jsonb_build_object('ok', false, 'error', 'Ikke vert'); end if;
  if p_duration_seconds is not null and p_duration_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Fristen må være positiv'); end if;
  select * into it from basar.auction_items
    where id = p_item_id and session_id = p_session_id for update;
  if it is null then return jsonb_build_object('ok', false, 'error', 'Ukjent objekt'); end if;
  if it.status = 'sold' then
    return jsonb_build_object('ok', false, 'error', 'Solgt objekt kan ikke aktiveres'); end if;

  v_deadline := case
    when p_duration_seconds is not null then now() + make_interval(secs => p_duration_seconds)
    else it.deadline end;

  update basar.auction_items
    set status = 'active',
        live_stage = case when it.status <> 'active' then null else live_stage end,
        deadline = v_deadline
    where id = p_item_id;
  return jsonb_build_object('ok', true, 'deadline', v_deadline);
end; $$;

grant execute on function basar.activate_item(uuid, text, uuid, integer) to anon, authenticated;
