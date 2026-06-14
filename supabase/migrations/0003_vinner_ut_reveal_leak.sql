-- 0003 — fix vinner_ut pre-reveal winner leak (night security audit 2026-06-13).
--
-- In `vinner_ut` mode, start_draw set the winning lot `removed = true` WHILE the
-- draw_state was still 'spinning' (before reveal_draw). `basar.lots` is anon-
-- SELECTable and in the realtime publication, so a spectator subscribed to lots
-- saw exactly one lot flip `removed` the instant the host tapped "Trekk" —
-- learning the winner seconds before the room, during the suspense spin. For a
-- fundraiser with real money/prizes that's a fairness break.
--
-- Fix: defer the `removed = true` write from start_draw into reveal_draw, after
-- the draw is published. This is semantically identical: void_draw requires the
-- draw to be `revealed` (so a lot is never removed-then-restored), and an
-- abandoned spin now correctly leaves the lot in the pot instead of silently
-- dropping it. Only the leak window is closed.
--
-- Both functions are re-created verbatim from 0001 except for the moved block.

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

  -- NOTE: vinner_ut removal is deferred to reveal_draw (was here) so the winner
  -- does not leak via basar.lots during the spin.

  insert into basar.events (session_id, type, payload)
    values (p_session_id, 'draw_started', jsonb_build_object(
      'prize_id', p_prize_id,
      'prize_name', (select name from basar.prizes where id = p_prize_id)));
  return jsonb_build_object('ok', true, 'draw_id', v_draw_id);
end; $$;

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

  -- vinner_ut: the winning lot leaves the pot now that the win is public (moved
  -- here from start_draw to close the pre-reveal leak). voiding does NOT restore
  -- it (void_draw requires revealed, so the lot is already out by then).
  if s.trekning = 'vinner_ut' then
    update basar.lots set removed = true where id = d.lot_id;
  end if;

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
