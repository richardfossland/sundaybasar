\set ON_ERROR_STOP on
set search_path = basar, public;

create or replace function pg_temp.assert_eq(actual int, expected int, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL [%]: expected %, got %', label, expected, actual; end if;
  raise notice 'PASS [%] = %', label, actual;
end $$;
create or replace function pg_temp.assert_true(cond bool, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL [%]: expected true', label; end if;
  raise notice 'PASS [%]', label;
end $$;
create or replace function pg_temp.assert_err(r jsonb, expected text, label text) returns void language plpgsql as $$
begin
  if (r->>'ok')::bool then raise exception 'FAIL [%]: expected error, got ok', label; end if;
  if r->>'error' <> expected then
    raise exception 'FAIL [%]: expected error "%", got "%"', label, expected, r->>'error'; end if;
  raise notice 'PASS [%] rejected: %', label, expected;
end $$;
create or replace function pg_temp.assert_ok(r jsonb, label text) returns void language plpgsql as $$
begin
  if not (r->>'ok')::bool then
    raise exception 'FAIL [%]: expected ok, got error "%"', label, r->>'error'; end if;
  raise notice 'PASS [%]', label;
end $$;

-- ============ 1. Privileges & publication ============
do $$
begin
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.draws','select'), '1: anon cannot read draws');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.host_secrets','select'), '1: anon cannot read host_secrets');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.player_secrets','select'), '1: anon cannot read player_secrets');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.lot_counters','select'), '1: anon cannot read lot_counters');
  perform pg_temp.assert_true(has_table_privilege('anon','basar.lots','select'), '1: anon can read lots');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.lots','insert'), '1: anon cannot insert lots');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.sessions','update'), '1: anon cannot update sessions');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.prizes','insert'), '1: anon cannot insert prizes');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.events','insert'), '1: anon cannot insert events');
  perform pg_temp.assert_eq(
    (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='basar')::int,
    5, '1: realtime publication has exactly 5 basar tables');
  perform pg_temp.assert_true(
    (select array_agg(tablename::text order by tablename) from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='basar')
    = array['events','lots','players','prizes','sessions'], '1: publication = the 5 public tables');
  perform pg_temp.assert_true(
    not has_function_privilege('anon','basar._allocate(uuid,uuid,integer,integer,text)','execute'),
    '1: anon cannot execute _allocate');
  perform pg_temp.assert_true(
    not has_function_privilege('anon','basar._verify_host(uuid,text)','execute'),
    '1: anon cannot execute _verify_host');
  perform pg_temp.assert_true(
    has_function_privilege('anon','basar.create_session(text,text,text,text,text,integer,integer)','execute'),
    '1: anon can execute create_session');
end $$;

-- ============ 2. create_session + host gating ============
do $$
declare r jsonb; sid uuid; hsec text;
begin
  r := basar.create_session('host-1','kjop','klassisk','123456',null,10,5);
  perform pg_temp.assert_ok(r, '2: create_session kjop/klassisk');
  perform pg_temp.assert_true((r->>'code') ~ '^[A-HJ-NP-Z]{4}$', '2: code is 4 letters, no I/O');
  perform pg_temp.assert_true(char_length(r->>'host_secret') = 64, '2: host_secret is 64 hex chars');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret';

  perform pg_temp.assert_err(basar.create_session('h','feil','klassisk','123456'),
    'Ugyldig tildelingsmodus', '2: bad tildeling');
  perform pg_temp.assert_err(basar.create_session('h','kjop','feil','123456'),
    'Ugyldig trekningsmodus', '2: bad trekning');
  perform pg_temp.assert_err(basar.create_session('h','kjop','klassisk',null),
    'Vippsnummer må fylles ut', '2: kjop requires vipps');
  perform pg_temp.assert_ok(basar.create_session('h','gratis','klassisk'),
    '2: gratis needs no vipps');

  perform pg_temp.assert_err(basar.add_prize(sid,'wrong-secret','Kaffekanne'),
    'Ikke vert', '2: wrong host_secret rejected');
  perform pg_temp.assert_ok(basar.add_prize(sid,hsec,'Kaffekanne'), '2: correct host_secret works');
end $$;

-- ============ 3. join_session ============
do $$
declare r jsonb; sid uuid; hsec text; code text; pid uuid;
begin
  r := basar.create_session('host-3','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';

  perform pg_temp.assert_err(basar.join_session('XXXX','Ola'), 'Ukjent kode', '3: unknown code');
  perform pg_temp.assert_err(basar.join_session(code,'  '), 'Skriv inn et navn', '3: empty name');

  r := basar.join_session(code,'Ola');
  perform pg_temp.assert_ok(r, '3: join ok');
  perform pg_temp.assert_true(char_length(r->>'secret') = 64, '3: player secret returned once');
  pid := (r->>'player_id')::uuid;
  perform pg_temp.assert_eq((select player_count from sessions where id=sid), 1, '3: player_count incremented');
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid)::int, 0,
    '3: kjop mode — no auto lots on join');

  perform pg_temp.assert_ok(basar.end_session(sid,hsec), '3: end_session');
  perform pg_temp.assert_err(basar.join_session(code,'Kari'), 'Basaren er avsluttet', '3: join after end');

  -- gratis: auto-allocation on join
  r := basar.create_session('host-3b','gratis','klassisk',null,null,10,7);
  sid := (r->>'session_id')::uuid; code := r->>'code';
  r := basar.join_session(code,'Kari');
  pid := (r->>'player_id')::uuid;
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid and player_id=pid)::int, 7,
    '3: gratis join auto-allocates gratis_lodd lots');
  perform pg_temp.assert_eq((select min(number) from lots where session_id=sid)::int, 1, '3: gratis lots start at 1');
  perform pg_temp.assert_eq((select max(number) from lots where session_id=sid)::int, 7, '3: gratis lots end at 7');
end $$;

-- ============ 3c: device dedup — re-join from a new tab must NOT mint extra lots ===
do $$
declare r jsonb; sid uuid; code text; pA uuid; pB uuid;
begin
  r := basar.create_session('host-3c','gratis','klassisk',null,null,10,7);
  sid := (r->>'session_id')::uuid; code := r->>'code';

  -- first join from device "dev-A": new player + 7 free lots
  r := basar.join_session(code,'Ola','dev-A');
  perform pg_temp.assert_ok(r, '3c: device join ok');
  pA := (r->>'player_id')::uuid;
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid)::int, 7, '3c: first device join -> 7 lots');

  -- SAME device joins again (new tab) -> resume same player, NO new lots
  r := basar.join_session(code,'Ola','dev-A');
  perform pg_temp.assert_true((r->>'resumed')::bool, '3c: same device -> resumed');
  perform pg_temp.assert_true((r->>'player_id')::uuid = pA, '3c: same device -> same player');
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid)::int, 7, '3c: re-join mints NO extra lots');
  perform pg_temp.assert_eq((select player_count from sessions where id=sid), 1, '3c: player_count not double-counted');

  -- a DIFFERENT device is a genuine new participant -> new player + its own 7 lots
  r := basar.join_session(code,'Kari','dev-B');
  pB := (r->>'player_id')::uuid;
  perform pg_temp.assert_true(pB <> pA, '3c: different device -> different player');
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid)::int, 14, '3c: second device -> +7 lots');
end $$;

-- ============ 4. Allocation numbering & guards ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; p2 uuid; stranger uuid;
begin
  r := basar.create_session('host-4','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  p2 := ((basar.join_session(code,'Kari'))->>'player_id')::uuid;

  r := basar.allocate_lots(sid,hsec,p1,5);
  perform pg_temp.assert_ok(r, '4: allocate 5');
  perform pg_temp.assert_eq((r->>'from_number')::int, 1, '4: first allocation starts at 1');
  perform pg_temp.assert_eq((r->>'to_number')::int, 5, '4: first allocation ends at 5');
  perform pg_temp.assert_ok(basar.allocate_lots(sid,hsec,p2,5), '4: allocate 5 more');
  r := basar.allocate_lots(sid,hsec,p1,3);
  perform pg_temp.assert_eq((r->>'from_number')::int, 11, '4: third allocation continues at 11');

  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid)::int, 13, '4: 13 lots total');
  perform pg_temp.assert_eq((select count(distinct number) from lots where session_id=sid)::int, 13,
    '4: all 13 numbers distinct');
  perform pg_temp.assert_eq((select max(number) from lots where session_id=sid)::int, 13,
    '4: no gaps — max is 13');
  perform pg_temp.assert_eq((select last_number from lot_counters where session_id=sid and round=1),
    13, '4: counter matches total');

  perform pg_temp.assert_err(basar.allocate_lots(sid,hsec,p1,0), 'Antall må være 1–200', '4: count 0 rejected');
  perform pg_temp.assert_err(basar.allocate_lots(sid,hsec,p1,201), 'Antall må være 1–200', '4: count 201 rejected');
  perform pg_temp.assert_err(basar.allocate_lots(sid,hsec,p1,5,'tull'), 'Ugyldig type', '4: bad kind rejected');
  stranger := ((basar.join_session((basar.create_session('x','gratis','klassisk'))->>'code','Frans'))->>'player_id')::uuid;
  perform pg_temp.assert_err(basar.allocate_lots(sid,hsec,stranger,5), 'Ukjent deltaker', '4: foreign player rejected');

  perform basar.end_session(sid,hsec);
  perform pg_temp.assert_err(basar.allocate_lots(sid,hsec,p1,5), 'Basaren er avsluttet', '4: allocate after end');
end $$;

-- ============ 5. revoke_allocation ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; a1 uuid; a2 uuid; przid uuid;
begin
  r := basar.create_session('host-5','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  a1 := ((basar.allocate_lots(sid,hsec,p1,5))->>'allocation_id')::uuid;
  a2 := ((basar.allocate_lots(sid,hsec,p1,5))->>'allocation_id')::uuid;

  perform pg_temp.assert_ok(basar.revoke_allocation(sid,hsec,a1), '5: revoke first allocation');
  perform pg_temp.assert_eq((select count(*) from lots where allocation_id=a1)::int, 0, '5: lots deleted');
  perform pg_temp.assert_true((select revoked from allocations where id=a1), '5: allocation flagged revoked');
  perform pg_temp.assert_err(basar.revoke_allocation(sid,hsec,a1), 'Allerede angret', '5: double revoke rejected');

  r := basar.allocate_lots(sid,hsec,p1,2);
  perform pg_temp.assert_eq((r->>'from_number')::int, 11, '5: numbers never reused after revoke');

  -- revoke blocked once a lot has a non-voided draw
  przid := ((basar.add_prize(sid,hsec,'Premie'))->>'prize_id')::uuid;
  perform pg_temp.assert_ok(basar.start_draw(sid,hsec,przid), '5: draw');
  perform pg_temp.assert_ok(basar.reveal_draw(sid,hsec), '5: reveal');
  perform pg_temp.assert_true(
    not ((basar.revoke_allocation(sid,hsec,
      (select allocation_id from lots l join draws d on d.lot_id=l.id where d.session_id=sid limit 1)
    ))->>'ok')::bool, '5: revoke blocked when lot has non-voided draw');
end $$;

-- ============ 6. Offline players ============
do $$
declare r jsonb; sid uuid; hsec text; pid uuid;
begin
  r := basar.create_session('host-6','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret';
  r := basar.add_offline_player(sid,hsec,'Bestemor');
  perform pg_temp.assert_ok(r, '6: add offline player');
  pid := (r->>'player_id')::uuid;
  perform pg_temp.assert_eq((select count(*) from player_secrets where player_id=pid)::int, 0,
    '6: offline player has no secret row');
  perform pg_temp.assert_true((select is_offline from players where id=pid), '6: flagged offline');
  perform pg_temp.assert_eq((select player_count from sessions where id=sid), 1, '6: counted in player_count');
  perform pg_temp.assert_ok(basar.allocate_lots(sid,hsec,pid,3), '6: offline player can get lots');

  -- gratis mode: offline player auto-receives lots too
  r := basar.create_session('host-6b','gratis','klassisk',null,null,10,4);
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret';
  pid := ((basar.add_offline_player(sid,hsec,'Bestefar'))->>'player_id')::uuid;
  perform pg_temp.assert_eq((select count(*) from lots where player_id=pid)::int, 4,
    '6: gratis offline player auto-allocated');
end $$;

-- ============ 7. Zero-lot draw blocked ============
do $$
declare r jsonb; sid uuid; hsec text; przid uuid;
begin
  r := basar.create_session('host-7','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret';
  przid := ((basar.add_prize(sid,hsec,'Premie'))->>'prize_id')::uuid;
  perform pg_temp.assert_err(basar.start_draw(sid,hsec,przid), 'Ingen årer i potten', '7: zero-lot draw blocked');
  perform pg_temp.assert_true((select draw_state from sessions where id=sid) = 'idle',
    '7: draw_state back to idle');
  perform pg_temp.assert_eq((select count(*) from draws where session_id=sid)::int, 0, '7: no draw row');
end $$;

-- ============ 8. Draw lifecycle + no pre-reveal leak ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; prz1 uuid; prz2 uuid; did uuid;
begin
  r := basar.create_session('host-8','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  perform basar.allocate_lots(sid,hsec,p1,5);
  prz1 := ((basar.add_prize(sid,hsec,'Kaffekanne'))->>'prize_id')::uuid;
  prz2 := ((basar.add_prize(sid,hsec,'Fruktkurv'))->>'prize_id')::uuid;

  perform pg_temp.assert_err(basar.reveal_draw(sid,hsec), 'Ingen trekning pågår', '8: reveal without draw');
  perform pg_temp.assert_err(basar.acknowledge_draw(sid,hsec), 'Ingen avslørt trekning', '8: ack without reveal');

  r := basar.start_draw(sid,hsec,prz1);
  perform pg_temp.assert_ok(r, '8: start_draw');
  did := (r->>'draw_id')::uuid;
  perform pg_temp.assert_true((select draw_state from sessions where id=sid) = 'spinning', '8: spinning');
  perform pg_temp.assert_true(not (select revealed from draws where id=did), '8: draw row unrevealed');
  perform pg_temp.assert_eq((select count(*) from events where session_id=sid and type='draw_revealed')::int, 0,
    '8: NO winner event before reveal');
  perform pg_temp.assert_true(
    not ((select payload from events where session_id=sid and type='draw_started') ? 'lot_number'),
    '8: draw_started event carries no winner data');
  perform pg_temp.assert_true(
    (basar.get_revealed_draws(sid))::text = '[]', '8: get_revealed_draws empty pre-reveal');

  perform pg_temp.assert_err(basar.start_draw(sid,hsec,prz2), 'En trekning pågår allerede',
    '8: concurrent start_draw rejected');

  r := basar.reveal_draw(sid,hsec);
  perform pg_temp.assert_ok(r, '8: reveal');
  perform pg_temp.assert_true((r->>'lot_number')::int between 1 and 5, '8: winner lot in range');
  perform pg_temp.assert_true(r->>'player_name' = 'Ola', '8: winner name');
  perform pg_temp.assert_eq((select count(*) from events where session_id=sid and type='draw_revealed')::int, 1,
    '8: draw_revealed event published');
  perform pg_temp.assert_err(basar.reveal_draw(sid,hsec), 'Ingen trekning pågår', '8: double reveal rejected');

  perform pg_temp.assert_ok(basar.acknowledge_draw(sid,hsec), '8: acknowledge');
  perform pg_temp.assert_true((select draw_state from sessions where id=sid) = 'idle', '8: back to idle');
  perform pg_temp.assert_err(basar.start_draw(sid,hsec,prz1), 'Premien er allerede trukket',
    '8: re-draw of won prize rejected');
  perform pg_temp.assert_err(basar.delete_prize(sid,hsec,prz1), 'Premien er allerede trukket',
    '8: delete of won prize rejected');
  perform pg_temp.assert_ok(basar.delete_prize(sid,hsec,prz2), '8: delete undrawn prize');
end $$;

-- ============ 9. Void + redraw exclusion; klassisk semantics ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; p2 uuid; prz uuid; prz2 uuid;
        did1 uuid; lot1 int; lot2 int;
begin
  -- 2 lots, two different players → void-exclusion is deterministic
  r := basar.create_session('host-9','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  p2 := ((basar.join_session(code,'Kari'))->>'player_id')::uuid;
  perform basar.allocate_lots(sid,hsec,p1,1);  -- nr 1
  perform basar.allocate_lots(sid,hsec,p2,1);  -- nr 2
  prz := ((basar.add_prize(sid,hsec,'Premie'))->>'prize_id')::uuid;

  r := basar.start_draw(sid,hsec,prz);
  did1 := (r->>'draw_id')::uuid;
  r := basar.reveal_draw(sid,hsec);
  lot1 := (r->>'lot_number')::int;
  perform pg_temp.assert_err(basar.void_draw(sid,hsec,gen_random_uuid(),'x'), 'Ukjent trekning',
    '9: void unknown draw');
  perform pg_temp.assert_ok(basar.void_draw(sid,hsec,did1,'Ikke til stede'), '9: void revealed draw');
  perform pg_temp.assert_true((select voided from draws where id=did1), '9: draw flagged voided');
  perform pg_temp.assert_true((select void_reason from draws where id=did1) = 'Ikke til stede',
    '9: void reason stored');
  perform pg_temp.assert_true((select draw_state from sessions where id=sid) = 'idle',
    '9: void released the slot');
  perform pg_temp.assert_err(basar.void_draw(sid,hsec,did1,'x'), 'Allerede annullert', '9: double void');

  -- redraw same prize: the voided lot is excluded → must pick the other
  perform pg_temp.assert_ok(basar.start_draw(sid,hsec,prz), '9: redraw after void');
  r := basar.reveal_draw(sid,hsec);
  lot2 := (r->>'lot_number')::int;
  perform pg_temp.assert_true(lot1 <> lot2, '9: voided lot excluded on redraw');
  perform basar.acknowledge_draw(sid,hsec);
  perform pg_temp.assert_true(not (select removed from lots where session_id=sid and number=lot2),
    '9: klassisk — winning lot stays in pot');

  -- klassisk: same lot can win a second, different prize (pool of 1)
  r := basar.create_session('host-9b','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  perform basar.allocate_lots(sid,hsec,p1,1);
  prz  := ((basar.add_prize(sid,hsec,'Premie 1'))->>'prize_id')::uuid;
  prz2 := ((basar.add_prize(sid,hsec,'Premie 2'))->>'prize_id')::uuid;
  perform basar.start_draw(sid,hsec,prz);  perform basar.reveal_draw(sid,hsec); perform basar.acknowledge_draw(sid,hsec);
  perform pg_temp.assert_ok(basar.start_draw(sid,hsec,prz2), '9: klassisk — same lot wins second prize');
  r := basar.reveal_draw(sid,hsec);
  perform pg_temp.assert_eq((r->>'lot_number')::int, 1, '9: klassisk — lot nr 1 won again');
end $$;

-- ============ 10. vinner_ut semantics ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; prz1 uuid; prz2 uuid; prz3 uuid; did uuid;
begin
  r := basar.create_session('host-10','kjop','vinner_ut','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  perform basar.allocate_lots(sid,hsec,p1,2);
  prz1 := ((basar.add_prize(sid,hsec,'P1'))->>'prize_id')::uuid;
  prz2 := ((basar.add_prize(sid,hsec,'P2'))->>'prize_id')::uuid;
  prz3 := ((basar.add_prize(sid,hsec,'P3'))->>'prize_id')::uuid;

  r := basar.start_draw(sid,hsec,prz1); did := (r->>'draw_id')::uuid;
  -- 0003 leak fix: the winning lot must NOT leave the pot during the spin —
  -- basar.lots is anon-SELECT + in the realtime publication, so an eager
  -- `removed=true` here leaks the winner before reveal_draw publishes it.
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid and removed)::int, 0,
    '10: vinner_ut — lot NOT removed during spin (no pre-reveal leak)');
  perform basar.reveal_draw(sid,hsec);
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid and removed)::int, 1,
    '10: vinner_ut — lot removed at reveal time');
  perform basar.acknowledge_draw(sid,hsec);
  perform basar.start_draw(sid,hsec,prz2); perform basar.reveal_draw(sid,hsec); perform basar.acknowledge_draw(sid,hsec);
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid and removed)::int, 2,
    '10: vinner_ut — both lots removed');
  perform pg_temp.assert_err(basar.start_draw(sid,hsec,prz3), 'Ingen årer i potten',
    '10: vinner_ut — pot exhausted');

  perform pg_temp.assert_ok(basar.void_draw(sid,hsec,did,'Ikke til stede'), '10: void after the fact');
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid and removed)::int, 2,
    '10: vinner_ut — voiding does NOT restore the lot');
end $$;

-- ============ 11. runder mode ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; p2 uuid; prz1 uuid; prz2 uuid;
begin
  r := basar.create_session('host-11','gratis','runder',null,null,10,3);
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  p2 := ((basar.join_session(code,'Kari'))->>'player_id')::uuid;
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid and round=1)::int, 6,
    '11: round 1 — 2 players × 3 lodd');
  prz1 := ((basar.add_prize(sid,hsec,'P1'))->>'prize_id')::uuid;
  prz2 := ((basar.add_prize(sid,hsec,'P2'))->>'prize_id')::uuid;

  perform basar.start_draw(sid,hsec,prz1); perform basar.reveal_draw(sid,hsec);
  r := basar.acknowledge_draw(sid,hsec);
  perform pg_temp.assert_eq((r->>'round')::int, 2, '11: acknowledge advances round');
  perform pg_temp.assert_eq((select current_round from sessions where id=sid), 2, '11: session round = 2');
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid and round=2)::int, 6,
    '11: round 2 — fresh gratis lots for everyone');
  perform pg_temp.assert_eq((select min(number) from lots where session_id=sid and round=2)::int, 1,
    '11: numbering restarts at 1 per round');
  perform pg_temp.assert_eq((select count(*) from events where session_id=sid and type='round_started')::int, 1,
    '11: round_started event');

  perform pg_temp.assert_ok(basar.start_draw(sid,hsec,prz2), '11: round 2 draw');
  perform pg_temp.assert_eq((select round from draws d join sessions s on s.id=d.session_id
    where d.id = (select current_draw_id from sessions where id=sid)), 2,
    '11: round 2 draw picks from round 2 pool');
end $$;

-- ============ 12. Draw uniformity smoke test ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; prz uuid; i int; mn int;
begin
  r := basar.create_session('host-12','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  perform basar.allocate_lots(sid,hsec,p1,3);
  create temp table tally (lot int) on commit drop;
  for i in 1..300 loop
    prz := ((basar.add_prize(sid,hsec,'P'||i))->>'prize_id')::uuid;
    perform basar.start_draw(sid,hsec,prz);
    r := basar.reveal_draw(sid,hsec);
    insert into tally values ((r->>'lot_number')::int);
    perform basar.acknowledge_draw(sid,hsec);
  end loop;
  select min(c) into mn from (select count(*) c from tally group by lot) t;
  perform pg_temp.assert_eq((select count(distinct lot) from tally)::int, 3, '12: all 3 lots drawn');
  perform pg_temp.assert_true(mn >= 60, '12: uniform-ish (each lot ≥60/300, expected 100)');
end $$;

-- ============ 13. Audit integrity ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; prz uuid; did uuid; log jsonb;
begin
  r := basar.create_session('host-13','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  perform basar.allocate_lots(sid,hsec,p1,2);
  prz := ((basar.add_prize(sid,hsec,'P'))->>'prize_id')::uuid;
  r := basar.start_draw(sid,hsec,prz); did := (r->>'draw_id')::uuid;
  perform basar.reveal_draw(sid,hsec);
  perform basar.void_draw(sid,hsec,did,'Ikke til stede');

  perform pg_temp.assert_err(basar.get_draw_log(sid,'feil'), 'Ikke vert', '13: draw log host-gated');
  log := (basar.get_draw_log(sid,hsec))->'draws';
  perform pg_temp.assert_eq(jsonb_array_length(log), 1, '13: log has the voided draw');
  perform pg_temp.assert_true(log->0->>'void_reason' = 'Ikke til stede', '13: reason in log');
  perform pg_temp.assert_true((log->0->>'lot_number')::int between 1 and 2, '13: lot_number retained');
  perform pg_temp.assert_true(log->0->>'player_name' = 'Ola', '13: player_name retained');

  r := basar.get_revealed_draws(sid);
  perform pg_temp.assert_eq(jsonb_array_length(r), 1, '13: public list includes voided (flagged)');
  perform pg_temp.assert_true((r->0->>'voided')::bool, '13: voided flag visible');
end $$;

-- ============ 14. Settings lock + phase guards ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid;
begin
  r := basar.create_session('host-14','kjop','klassisk','123456');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';

  -- before any lots: mode change allowed
  perform pg_temp.assert_ok(basar.update_settings(sid,hsec,null,null,null,null,'vinner_ut'),
    '14: trekning change allowed before lots');
  p1 := ((basar.join_session(code,'Ola'))->>'player_id')::uuid;
  perform basar.allocate_lots(sid,hsec,p1,1);
  perform pg_temp.assert_err(basar.update_settings(sid,hsec,null,null,null,null,'klassisk'),
    'Modus kan ikke endres etter at årer er delt ut', '14: trekning locked after lots');
  perform pg_temp.assert_ok(basar.update_settings(sid,hsec,'654321',null,20),
    '14: vipps/pris still editable');
  perform pg_temp.assert_true((select vipps_number from sessions where id=sid) = '654321',
    '14: vipps updated');
  perform pg_temp.assert_eq((select price_per_lodd from sessions where id=sid), 20, '14: price updated');

  perform pg_temp.assert_ok(basar.end_session(sid,hsec), '14: end');
  perform pg_temp.assert_err(basar.end_session(sid,hsec), 'Allerede avsluttet', '14: double end');
  perform pg_temp.assert_err(basar.start_draw(sid,hsec,gen_random_uuid()), 'En trekning pågår allerede',
    '14: draw after end blocked (phase guard)');
end $$;

-- ============ 15. Prize ordering ============
do $$
declare r jsonb; sid uuid; hsec text; pa uuid; pb uuid; pc uuid;
begin
  r := basar.create_session('host-15','gratis','klassisk');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret';
  pa := ((basar.add_prize(sid,hsec,'A'))->>'prize_id')::uuid;
  pb := ((basar.add_prize(sid,hsec,'B'))->>'prize_id')::uuid;
  pc := ((basar.add_prize(sid,hsec,'C'))->>'prize_id')::uuid;
  perform pg_temp.assert_ok(basar.move_prize(sid,hsec,pc,'up'), '15: move C up');
  perform pg_temp.assert_true(
    (select array_agg(name order by position) from prizes where session_id=sid)
    = array['A','C','B'], '15: order A,C,B after move');
  perform pg_temp.assert_ok(basar.move_prize(sid,hsec,pa,'up'), '15: move at edge is no-op');
  perform pg_temp.assert_ok(basar.update_prize(sid,hsec,pb,'B2','fin premie'), '15: update prize');
  perform pg_temp.assert_true((select description from prizes where id=pb) = 'fin premie',
    '15: description updated');
end $$;

-- ============ 16. Prize images (migration 0002, additive) ============
do $$
declare r jsonb; sid uuid; hsec text; pid uuid; pid2 uuid; lot record; rd jsonb;
  url constant text := 'https://example.com/cdn/cake.jpg';
begin
  -- 16a. additive column exists, nullable, no default → old prizes unaffected.
  perform pg_temp.assert_true(
    exists (select 1 from information_schema.columns
            where table_schema='basar' and table_name='prizes' and column_name='image_url'),
    '16a: prizes.image_url column exists');
  perform pg_temp.assert_true(
    (select is_nullable from information_schema.columns
       where table_schema='basar' and table_name='prizes' and column_name='image_url') = 'YES',
    '16a: image_url is nullable');

  -- 16b. add_prize with no image keeps it null (backward compatible call).
  r := basar.create_session('host-16','gratis','klassisk');
  sid := (r->>'session_id')::uuid; hsec := r->>'host_secret';
  pid := ((basar.add_prize(sid,hsec,'Premie uten bilde'))->>'prize_id')::uuid;
  perform pg_temp.assert_true((select image_url from prizes where id=pid) is null,
    '16b: prize without image has null image_url');

  -- 16c. add_prize WITH image stores it.
  pid2 := ((basar.add_prize(sid,hsec,'Kake',null,url))->>'prize_id')::uuid;
  perform pg_temp.assert_true((select image_url from prizes where id=pid2) = url,
    '16c: prize image_url stored');

  -- 16d. invalid (non-http) image URL is rejected by add_prize.
  perform pg_temp.assert_err(basar.add_prize(sid,hsec,'Ond','x',
    'javascript:alert(1)'), 'Ugyldig bilde-URL', '16d: add_prize rejects non-http url');

  -- 16e. update_prize: null image arg LEAVES image unchanged.
  perform pg_temp.assert_ok(basar.update_prize(sid,hsec,pid2,'Kake2','beskr'),
    '16e: update prize without touching image');
  perform pg_temp.assert_true((select image_url from prizes where id=pid2) = url,
    '16e: image_url unchanged when arg omitted');

  -- 16f. update_prize: empty string CLEARS the image.
  perform pg_temp.assert_ok(basar.update_prize(sid,hsec,pid2,'Kake3',null,''),
    '16f: clear image with empty string');
  perform pg_temp.assert_true((select image_url from prizes where id=pid2) is null,
    '16f: image_url cleared');

  -- 16g. update_prize rejects bad URL.
  perform pg_temp.assert_err(basar.update_prize(sid,hsec,pid2,'K','d','data:foo'),
    'Ugyldig bilde-URL', '16g: update_prize rejects non-http url');

  -- 16h. CHECK constraint guards direct (service_role) writes too.
  begin
    update basar.prizes set image_url = 'ftp://nope' where id = pid;
    perform pg_temp.assert_true(false, '16h: check constraint should have blocked ftp url');
  exception when check_violation then
    perform pg_temp.assert_true(true, '16h: check constraint blocks non-http url');
  end;

  -- 16i. get_revealed_draws surfaces prize_image_url for a real reveal.
  --      (gratis mode auto-allocates lots to the offline player → a pot exists.)
  perform basar.update_prize(sid,hsec,pid2,'Kake',null,url);
  perform basar.add_offline_player(sid,hsec,'Kari');
  perform pg_temp.assert_ok(basar.start_draw(sid,hsec,pid2), '16i: start draw');
  perform pg_temp.assert_ok(basar.reveal_draw(sid,hsec), '16i: reveal draw');
  rd := basar.get_revealed_draws(sid);
  perform pg_temp.assert_true((rd->0->>'prize_image_url') = url,
    '16i: get_revealed_draws includes prize_image_url');

  -- 16j. get_draw_log surfaces prize_image_url too.
  perform pg_temp.assert_true(
    ((basar.get_draw_log(sid,hsec)->'draws')->0->>'prize_image_url') = url,
    '16j: get_draw_log includes prize_image_url');

  -- 16k. exactly ONE add_prize / update_prize overload (no ambiguity).
  perform pg_temp.assert_eq(
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='basar' and p.proname='add_prize'), 1,
    '16k: single add_prize overload');
  perform pg_temp.assert_eq(
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='basar' and p.proname='update_prize'), 1,
    '16k: single update_prize overload');
end $$;

do $$ begin raise notice 'ALL GAME-LOGIC TESTS PASSED'; end $$;
