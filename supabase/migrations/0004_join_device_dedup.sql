-- 0004 — stop free-lot farming via re-join (e.g. opening a new tab).
--
-- join_session previously inserted a NEW player and (in gratis mode) auto-allocated
-- gratis_lodd free lots on EVERY call, with no dedup — so a participant could open
-- a new tab, re-join, and mint more free årer. This pins a join to a stable per-device
-- token: the same (session, device) RESUMES the existing player instead of creating a
-- duplicate, so the free allocation happens at most once per device per basar.
-- Anonymous/code play is otherwise unchanged. Idempotent (safe to re-run).

alter table basar.players add column if not exists device_id text;

-- One player per (session, device). Partial: legacy rows (device_id null) and the
-- host manual-allocation flow are unaffected.
create unique index if not exists uq_basar_players_session_device
  on basar.players (session_id, device_id) where device_id is not null;

-- Replace join_session with a device-aware, idempotent version. The old 2-arg
-- signature is dropped; positional 2-arg calls and PostgREST {p_code,p_name} still
-- resolve via the new optional p_device default.
drop function if exists basar.join_session(text, text);

create or replace function basar.join_session(p_code text, p_name text, p_device text default null)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare s record; pid uuid; sec text; v_dev text; ex_id uuid; ex_sec text;
begin
  select * into s from basar.sessions where code = upper(trim(p_code));
  if s is null then return jsonb_build_object('ok', false, 'error', 'Ukjent kode'); end if;
  if s.phase <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'Basaren er avsluttet'); end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Skriv inn et navn'); end if;

  v_dev := nullif(trim(coalesce(p_device,'')), '');

  -- Same device already in this basar → resume that player (no new free lots).
  if v_dev is not null then
    select pl.id, ps.secret into ex_id, ex_sec
      from basar.players pl
      join basar.player_secrets ps on ps.player_id = pl.id
      where pl.session_id = s.id and pl.device_id = v_dev
      limit 1;
    if ex_id is not null then
      return jsonb_build_object('ok', true, 'player_id', ex_id,
        'session_id', s.id, 'secret', ex_sec, 'resumed', true);
    end if;
  end if;

  begin
    insert into basar.players (session_id, name, device_id)
      values (s.id, trim(p_name), v_dev) returning id into pid;
  exception when unique_violation then
    -- Concurrent join from the same device (e.g. double tap) — resume.
    select pl.id, ps.secret into ex_id, ex_sec
      from basar.players pl
      join basar.player_secrets ps on ps.player_id = pl.id
      where pl.session_id = s.id and pl.device_id = v_dev
      limit 1;
    return jsonb_build_object('ok', true, 'player_id', ex_id,
      'session_id', s.id, 'secret', ex_sec, 'resumed', true);
  end;

  insert into basar.player_secrets (player_id) values (pid) returning secret into sec;
  update basar.sessions set player_count = player_count + 1 where id = s.id;

  if s.tildeling = 'gratis' then
    perform basar._allocate(s.id, pid, s.current_round, s.gratis_lodd, 'gratis_auto');
  end if;

  return jsonb_build_object('ok', true, 'player_id', pid, 'session_id', s.id, 'secret', sec);
end; $$;

grant execute on function basar.join_session(text, text, text) to anon, authenticated, service_role;
