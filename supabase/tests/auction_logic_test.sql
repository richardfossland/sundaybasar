\set ON_ERROR_STOP on
set search_path = basar, public;

-- Assert helpers (pg_temp is per-connection; this file runs in its own psql
-- session, so they are redefined here independently of basar_logic_test.sql).
create or replace function pg_temp.assert_eq(actual int, expected int, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL [%]: expected %, got %', label, expected, actual; end if;
  raise notice 'PASS [%] = %', label, actual;
end $$;
create or replace function pg_temp.assert_num(actual numeric, expected numeric, label text) returns void language plpgsql as $$
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

-- ============ A1. Privileges & publication (auction tables) ============
do $$
begin
  perform pg_temp.assert_true(has_table_privilege('anon','basar.auction_items','select'), 'A1: anon reads auction_items');
  perform pg_temp.assert_true(has_table_privilege('anon','basar.auction_bids','select'), 'A1: anon reads auction_bids');
  perform pg_temp.assert_true(has_table_privilege('anon','basar.auction_settlements','select'), 'A1: anon reads settlements');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.auction_proxy_maxes','select'),
    'A1: anon CANNOT read proxy_maxes (hidden bid maximums)');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.auction_items','insert'), 'A1: anon cannot insert items');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.auction_bids','insert'), 'A1: anon cannot insert bids');
  perform pg_temp.assert_true(not has_table_privilege('anon','basar.auction_proxy_maxes','insert'), 'A1: anon cannot insert maxes');
  perform pg_temp.assert_true(
    has_function_privilege('anon','basar.place_bid(uuid,text,uuid,numeric)','execute'), 'A1: anon can execute place_bid');
  perform pg_temp.assert_true(
    has_function_privilege('anon','basar.create_auction_session(text,numeric,text,text)','execute'),
    'A1: anon can execute create_auction_session');
  perform pg_temp.assert_true(
    has_function_privilege('anon','basar.get_auction_state(uuid)','execute'), 'A1: anon can execute get_auction_state');
  -- proxy_maxes must NOT be in the realtime publication.
  perform pg_temp.assert_eq(
    (select count(*)::int from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='basar' and tablename='auction_proxy_maxes'),
    0, 'A1: proxy_maxes NOT in realtime publication');
end $$;

-- ============ A2. create_auction_session ============
do $$
declare r jsonb; sid uuid;
begin
  r := basar.create_auction_session('host-a', 10000, '123456', null);
  perform pg_temp.assert_ok(r, 'A2: create_auction_session');
  perform pg_temp.assert_true((r->>'code') ~ '^[A-HJ-NP-Z]{4}$', 'A2: 4-letter code');
  perform pg_temp.assert_true(char_length(r->>'host_secret') = 64, 'A2: host_secret 64 hex');
  sid := (r->>'session_id')::uuid;
  perform pg_temp.assert_true((select kind from sessions where id=sid) = 'auksjon', 'A2: kind=auksjon');
  perform pg_temp.assert_true((select tildeling from sessions where id=sid) = 'kjop',
    'A2: tildeling=kjop (join allocates NO free lots)');
  perform pg_temp.assert_num((select goal_amount from sessions where id=sid), 10000, 'A2: goal stored');
  perform pg_temp.assert_err(basar.create_auction_session('', null), 'Mangler vert-id', 'A2: empty host rejected');
end $$;

-- ============ A3. join an auction → NO auto lots ============
do $$
declare r jsonb; sid uuid; code text; pid uuid;
begin
  r := basar.create_auction_session('host-a3'); sid := (r->>'session_id')::uuid; code := r->>'code';
  r := basar.join_session(code, 'Ola');
  perform pg_temp.assert_ok(r, 'A3: join auction');
  pid := (r->>'player_id')::uuid;
  perform pg_temp.assert_eq((select count(*) from lots where session_id=sid)::int, 0,
    'A3: auction join mints NO lots (kjop mode)');
  perform pg_temp.assert_eq((select player_count from sessions where id=sid), 1, 'A3: player counted');
end $$;

-- ============ A4. create_auction_item validation ============
do $$
declare r jsonb; sid uuid; hsec text; i1 uuid;
begin
  r := basar.create_auction_session('host-a4'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret';
  perform pg_temp.assert_err(basar.create_auction_item(sid,'wrong','T','d','gjenstand','stille',100,10),
    'Ikke vert', 'A4: wrong host_secret');
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'  ','d','gjenstand','stille',100,10),
    'Objektet må ha en tittel', 'A4: empty title');
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'T','d','feil','stille',100,10),
    'Ugyldig kategori', 'A4: bad category');
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'T','d','gjenstand','feil',100,10),
    'Ugyldig format', 'A4: bad format');
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'T','d','gjenstand','stille',100,0),
    'Budøkning må være positiv', 'A4: zero increment');
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'T','d','gjenstand','stille',100,10,'javascript:alert(1)'),
    'Ugyldig bilde-URL', 'A4: bad image url');
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'T','d','gjenstand','stille',100,10,null,null,50),
    'Reservepris må være minst startpris', 'A4: reserve below start');
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'T','d','gjenstand','stille',100,10,null,null,null,50),
    'Kjøp-nå-pris må være minst startpris', 'A4: buy-now below start');

  r := basar.create_auction_item(sid,hsec,'Strikkegenser','Håndlaget','gjenstand','stille',100,10,
    'https://example.com/g.jpg','Bestemor');
  perform pg_temp.assert_ok(r, 'A4: valid item created');
  i1 := (r->>'item_id')::uuid;
  perform pg_temp.assert_eq((select position from auction_items where id=i1), 1, 'A4: first item position 1');
  perform pg_temp.assert_true((select donor_name from auction_items where id=i1) = 'Bestemor', 'A4: donor stored');
  perform pg_temp.assert_eq(
    (((basar.create_auction_item(sid,hsec,'Kake','','gjenstand','live',50,5))->>'item_id') is not null)::int, 1,
    'A4: second item ok');
  perform pg_temp.assert_eq((select position from auction_items where session_id=sid order by position desc limit 1),
    2, 'A4: positions increment');
end $$;

-- ============ A5. Bidding basics + status gate ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; itid uuid;
begin
  r := basar.create_auction_session('host-a5'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';
  itid := ((basar.create_auction_item(sid,hsec,'Kanne','','gjenstand','stille',100,10))->>'item_id')::uuid;

  perform pg_temp.assert_err(basar.place_bid(p1,s1,itid,150), 'Objektet tar ikke imot bud', 'A5: bid on draft rejected');
  perform pg_temp.assert_ok(basar.activate_item(sid,hsec,itid), 'A5: activate');
  perform pg_temp.assert_err(basar.place_bid(p1,'wrong',itid,150), 'Ukjent deltaker', 'A5: bad secret');
  perform pg_temp.assert_err(basar.place_bid(p1,s1,itid,50), 'Budet er under startpris', 'A5: below start');

  r := basar.place_bid(p1,s1,itid,100);
  perform pg_temp.assert_ok(r, 'A5: first bid at start');
  perform pg_temp.assert_true((r->>'leading')::bool, 'A5: first bidder leads');
  perform pg_temp.assert_num((r->>'current_amount')::numeric, 100, 'A5: sole bidder sits at start price');
  perform pg_temp.assert_true((select current_leader_player_id from auction_items where id=itid) = p1, 'A5: leader=p1');
  perform pg_temp.assert_err(basar.place_bid(p1,s1,itid,100), 'Budet må være høyere enn ditt forrige',
    'A5: cannot re-bid same/lower');
end $$;

-- ============ A6. Proxy / auto-bid resolution (the subtle bit) ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; p2 uuid; s2 text; itid uuid;
begin
  r := basar.create_auction_session('host-a6'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';
  r := basar.join_session(code,'Kari'); p2 := (r->>'player_id')::uuid; s2 := r->>'secret';
  itid := ((basar.create_auction_item(sid,hsec,'Bilde','','gjenstand','stille',100,10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);

  perform basar.place_bid(p1,s1,itid,100);                         -- p1 max=100, current=100
  perform pg_temp.assert_err(basar.place_bid(p2,s2,itid,105), 'For lavt bud', 'A6: must clear current+increment');

  r := basar.place_bid(p2,s2,itid,150);                           -- p2 max=150 takes lead
  perform pg_temp.assert_num((r->>'current_amount')::numeric, 110, 'A6: p2 leads at p1max+inc=110');
  perform pg_temp.assert_true((r->>'leading')::bool, 'A6: p2 leading');

  r := basar.place_bid(p1,s1,itid,200);                           -- p1 max=200 retakes lead
  perform pg_temp.assert_num((r->>'current_amount')::numeric, 160, 'A6: p1 leads at p2max+inc=160');
  perform pg_temp.assert_true((r->>'leading')::bool, 'A6: p1 leading again');

  r := basar.place_bid(p2,s2,itid,170);                           -- accepted but auto-outbid
  perform pg_temp.assert_num((r->>'current_amount')::numeric, 180, 'A6: auto-defend to p2max+inc=180');
  perform pg_temp.assert_true(not (r->>'leading')::bool, 'A6: p2 bid accepted but does NOT lead (proxy)');
  perform pg_temp.assert_true((select current_leader_player_id from auction_items where id=itid) = p1,
    'A6: p1 still leads via hidden max');
  -- the hidden maxes really are hidden: nothing in the public feed equals a max
  perform pg_temp.assert_eq((select count(*) from auction_bids where item_id=itid and amount in (150,170,200))::int, 0,
    'A6: no raw max ever written to the public bid feed');
end $$;

-- ============ A7. Anti-snipe + deadline ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; itid uuid; dl_before timestamptz; dl_after timestamptz;
begin
  r := basar.create_auction_session('host-a7'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';

  -- deadline 3s away, antisnipe 10s → a bid extends it.
  itid := ((basar.create_auction_item(sid,hsec,'Snik','','gjenstand','stille',100,10,null,null,null,null,
            now()+interval '3 seconds', 10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);
  dl_before := (select deadline from auction_items where id=itid);
  perform basar.place_bid(p1,s1,itid,100);
  dl_after := (select deadline from auction_items where id=itid);
  perform pg_temp.assert_true(dl_after > dl_before, 'A7: anti-snipe pushed the deadline out');

  -- a past deadline rejects bids.
  itid := ((basar.create_auction_item(sid,hsec,'Ute','','gjenstand','stille',100,10,null,null,null,null,
            now()-interval '1 second', 10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);
  perform pg_temp.assert_err(basar.place_bid(p1,s1,itid,100), 'Fristen er ute', 'A7: bid after deadline rejected');
end $$;

-- ============ A8. Buy now ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; itid uuid; noid uuid;
begin
  r := basar.create_auction_session('host-a8'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';
  itid := ((basar.create_auction_item(sid,hsec,'Straks','','gjenstand','stille',100,10,null,null,null,200))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);

  r := basar.buy_now(p1,s1,itid);
  perform pg_temp.assert_ok(r, 'A8: buy now');
  perform pg_temp.assert_num((r->>'amount')::numeric, 200, 'A8: buy-now price');
  perform pg_temp.assert_true((select status from auction_items where id=itid) = 'sold', 'A8: item sold');
  perform pg_temp.assert_true((select winner_player_id from auction_items where id=itid) = p1, 'A8: winner set');
  perform pg_temp.assert_eq((select count(*) from auction_settlements where item_id=itid)::int, 1, 'A8: settlement created');
  perform pg_temp.assert_err(basar.buy_now(p1,s1,itid), 'Objektet tar ikke imot bud', 'A8: cannot buy a sold item');

  noid := ((basar.create_auction_item(sid,hsec,'Uten','','gjenstand','stille',100,10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,noid);
  perform pg_temp.assert_err(basar.buy_now(p1,s1,noid), 'Objektet har ikke kjøp-nå', 'A8: no buy-now configured');
end $$;

-- ============ A9. mark_sold, reserve, pass ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; p2 uuid; s2 text; itid uuid; empty uuid;
begin
  r := basar.create_auction_session('host-a9'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';
  r := basar.join_session(code,'Kari'); p2 := (r->>'player_id')::uuid; s2 := r->>'secret';
  -- reserve 500, start 100
  itid := ((basar.create_auction_item(sid,hsec,'Maleri','','opplevelse','stille',100,10,null,null,500))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);

  perform basar.place_bid(p1,s1,itid,500);   -- sole bidder → current stays at start 100
  perform pg_temp.assert_err(basar.mark_sold(sid,hsec,itid), 'Reservepris ikke nådd', 'A9: reserve not met blocks sale');

  r := basar.place_bid(p2,s2,itid,600);      -- competition pushes current to 510 (≥ reserve)
  perform pg_temp.assert_num((r->>'current_amount')::numeric, 510, 'A9: current at p1max+inc=510');
  r := basar.mark_sold(sid,hsec,itid);
  perform pg_temp.assert_ok(r, 'A9: sold once reserve met');
  perform pg_temp.assert_true((r->>'winner_player_id')::uuid = p2, 'A9: winner=p2');
  perform pg_temp.assert_num((r->>'winning_amount')::numeric, 510, 'A9: winning amount=510');
  perform pg_temp.assert_err(basar.mark_sold(sid,hsec,itid), 'Objektet er ikke aktivt', 'A9: cannot resell');
  perform pg_temp.assert_err(basar.place_bid(p1,s1,itid,1000), 'Objektet tar ikke imot bud', 'A9: cannot bid on sold');

  -- mark_sold with no bids is blocked
  empty := ((basar.create_auction_item(sid,hsec,'Ingen','','gjenstand','stille',100,10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,empty);
  perform pg_temp.assert_err(basar.mark_sold(sid,hsec,empty), 'Ingen bud å selge til', 'A9: no bids → no sale');
  perform pg_temp.assert_ok(basar.pass_item(sid,hsec,empty,'Ingen interesse'), 'A9: pass empty item');
  perform pg_temp.assert_true((select status from auction_items where id=empty) = 'passed', 'A9: status passed');
  perform pg_temp.assert_err(basar.pass_item(sid,hsec,itid), 'Solgt objekt kan ikke passes', 'A9: cannot pass sold');
end $$;

-- ============ A10. Settlements + thermometer (get_auction_state) ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; p2 uuid; s2 text; itid uuid; setid uuid; st jsonb; item0 jsonb;
begin
  r := basar.create_auction_session('host-a10', 5000, '123456'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';
  r := basar.join_session(code,'Kari'); p2 := (r->>'player_id')::uuid; s2 := r->>'secret';
  itid := ((basar.create_auction_item(sid,hsec,'Kvelden','','opplevelse','stille',100,10,null,null,300))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);
  perform basar.place_bid(p1,s1,itid,1000);
  perform basar.place_bid(p2,s2,itid,2000);  -- current → 1010
  perform basar.mark_sold(sid,hsec,itid);

  -- host-only settlements list
  perform pg_temp.assert_err(basar.get_settlements(sid,'feil'), 'Ikke vert', 'A10: settlements host-gated');
  r := (basar.get_settlements(sid,hsec));
  perform pg_temp.assert_eq(jsonb_array_length(r->'settlements'), 1, 'A10: one settlement');
  perform pg_temp.assert_true((r->'settlements'->0->>'paid')::bool = false, 'A10: unpaid initially');
  setid := (r->'settlements'->0->>'settlement_id')::uuid;
  perform pg_temp.assert_ok(basar.set_settlement_paid(sid,hsec,setid,true), 'A10: mark paid');
  perform pg_temp.assert_true(
    ((basar.get_settlements(sid,hsec))->'settlements'->0->>'paid')::bool, 'A10: now paid');
  perform pg_temp.assert_err(basar.set_settlement_paid(sid,hsec,gen_random_uuid(),true), 'Ukjent oppgjør', 'A10: unknown settlement');

  -- public state: thermometer + reserve hidden
  st := basar.get_auction_state(sid);
  perform pg_temp.assert_num((st->>'goal_amount')::numeric, 5000, 'A10: goal exposed');
  perform pg_temp.assert_num((st->>'raised_total')::numeric, 1010, 'A10: raised_total = winning amount');
  item0 := st->'items'->0;
  perform pg_temp.assert_true(not (item0 ? 'reserve_price'), 'A10: reserve_price NEVER exposed');
  perform pg_temp.assert_true((item0->>'has_reserve')::bool, 'A10: has_reserve flag present');
  perform pg_temp.assert_true((item0->>'reserve_met')::bool, 'A10: reserve_met true');
  perform pg_temp.assert_true(item0->>'winner_name' = 'Ola' or item0->>'winner_name' = 'Kari', 'A10: winner name surfaced');
end $$;

-- ============ A11. Cross-session isolation + delete ============
do $$
declare r jsonb; sidA uuid; hsecA text; codeA text; itid uuid;
        sidB uuid; hsecB text; codeB text; stranger uuid; sStranger text;
begin
  r := basar.create_auction_session('host-a11a'); sidA := (r->>'session_id')::uuid; hsecA := r->>'host_secret'; codeA := r->>'code';
  itid := ((basar.create_auction_item(sidA,hsecA,'Vår','','gjenstand','stille',100,10))->>'item_id')::uuid;
  perform basar.activate_item(sidA,hsecA,itid);

  r := basar.create_auction_session('host-a11b'); sidB := (r->>'session_id')::uuid; hsecB := r->>'host_secret'; codeB := r->>'code';
  r := basar.join_session(codeB,'Frans'); stranger := (r->>'player_id')::uuid; sStranger := r->>'secret';
  -- a real player from ANOTHER auction cannot bid here
  perform pg_temp.assert_err(basar.place_bid(stranger,sStranger,itid,150), 'Ukjent deltaker', 'A11: foreign player rejected');
  -- the correct host of B still cannot drive A's item (cross-session item isolation)
  perform pg_temp.assert_err(basar.mark_sold(sidB,hsecB,itid), 'Ukjent objekt', 'A11: item not in other session');

  -- delete: allowed while not sold, cascades to maxes/bids
  r := basar.create_auction_session('host-a11c'); sidA := (r->>'session_id')::uuid; hsecA := r->>'host_secret'; codeA := r->>'code';
  r := basar.join_session(codeA,'Ola');
  itid := ((basar.create_auction_item(sidA,hsecA,'Slett','','gjenstand','stille',100,10))->>'item_id')::uuid;
  perform basar.activate_item(sidA,hsecA,itid);
  perform basar.place_bid((r->>'player_id')::uuid,(r->>'secret'),itid,100);
  perform pg_temp.assert_eq((select count(*) from auction_proxy_maxes where item_id=itid)::int, 1, 'A11: a max exists');
  perform pg_temp.assert_ok(basar.delete_auction_item(sidA,hsecA,itid), 'A11: delete unsold item');
  perform pg_temp.assert_eq((select count(*) from auction_items where id=itid)::int, 0, 'A11: item gone');
  perform pg_temp.assert_eq((select count(*) from auction_proxy_maxes where item_id=itid)::int, 0, 'A11: maxes cascade-deleted');
  perform pg_temp.assert_eq((select count(*) from auction_bids where item_id=itid)::int, 0, 'A11: bids cascade-deleted');
end $$;

-- ============ A12. Session end blocks bidding ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; itid uuid;
begin
  r := basar.create_auction_session('host-a12'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';
  itid := ((basar.create_auction_item(sid,hsec,'Sen','','gjenstand','stille',100,10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);
  perform pg_temp.assert_ok(basar.end_session(sid,hsec), 'A12: end auction');
  perform pg_temp.assert_err(basar.place_bid(p1,s1,itid,100), 'Auksjonen er avsluttet', 'A12: no bids after end');
end $$;

-- ============ A13. Dutch format is rejected by place_bid (future PR) ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; itid uuid;
begin
  r := basar.create_auction_session('host-a13'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';
  itid := ((basar.create_auction_item(sid,hsec,'Hollandsk','','gjenstand','hollandsk',0,10,
            null,null,null,null,null,10, 1000,200,100,10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);
  perform pg_temp.assert_err(basar.place_bid(p1,s1,itid,100), 'Bruk «Kjøp nå» på hollandsk auksjon',
    'A13: ascending bid rejected on dutch item');
end $$;

-- ============ A14. Hollandsk (descending price) lifecycle ============
do $$
declare r jsonb; sid uuid; hsec text; code text; p1 uuid; s1 text; p2 uuid; s2 text; itid uuid;
begin
  r := basar.create_auction_session('host-a14'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret'; code := r->>'code';
  r := basar.join_session(code,'Ola'); p1 := (r->>'player_id')::uuid; s1 := r->>'secret';
  r := basar.join_session(code,'Kari'); p2 := (r->>'player_id')::uuid; s2 := r->>'secret';

  -- create requires a valid descending curve
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'X','','gjenstand','hollandsk',0,10),
    'Hollandsk auksjon krever start/gulv/fall/intervall', 'A14: hollandsk requires dutch params');
  perform pg_temp.assert_err(basar.create_auction_item(sid,hsec,'X','','gjenstand','hollandsk',0,10,
    null,null,null,null,null,10, 200,500,100,10), 'Startpris må være større enn gulvpris', 'A14: start must exceed floor');

  -- start 1000, floor 200, step 100, interval 10s
  itid := ((basar.create_auction_item(sid,hsec,'Sykkel','','gjenstand','hollandsk',0,10,
            null,null,null,null,null,10, 1000,200,100,10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,itid);  -- active, but the descent hasn't been started
  perform pg_temp.assert_err(basar.dutch_take(p1,s1,itid), 'Prisfallet har ikke startet', 'A14: take before start (active, no descent)');

  r := basar.start_dutch(sid,hsec,itid);
  perform pg_temp.assert_ok(r, 'A14: start_dutch');
  perform pg_temp.assert_num((r->>'start_price')::numeric, 1000, 'A14: start price 1000');
  perform pg_temp.assert_true((select status from auction_items where id=itid) = 'active', 'A14: active after start');

  -- simulate 25s elapsed -> floor(25/10)=2 steps -> 1000 - 200 = 800
  update basar.auction_items set dutch_started_at = now() - interval '25 seconds' where id = itid;
  perform pg_temp.assert_err(basar.place_bid(p1,s1,itid,900), 'Bruk «Kjøp nå» på hollandsk auksjon', 'A14: ascending bid still rejected');
  r := basar.dutch_take(p1,s1,itid);
  perform pg_temp.assert_ok(r, 'A14: dutch_take');
  perform pg_temp.assert_num((r->>'amount')::numeric, 800, 'A14: dropped price 800 (2 steps)');
  perform pg_temp.assert_true((select status from auction_items where id=itid) = 'sold', 'A14: sold');
  perform pg_temp.assert_true((select winner_player_id from auction_items where id=itid) = p1, 'A14: winner p1');
  perform pg_temp.assert_eq((select count(*) from auction_settlements where item_id=itid)::int, 1, 'A14: settlement created');
  perform pg_temp.assert_err(basar.dutch_take(p2,s2,itid), 'Objektet tar ikke imot bud', 'A14: second taker rejected (first-click-wins)');

  -- price never drops below the floor
  itid := ((basar.create_auction_item(sid,hsec,'Gulv','','gjenstand','hollandsk',0,10,
            null,null,null,null,null,10, 1000,200,100,10))->>'item_id')::uuid;
  perform basar.start_dutch(sid,hsec,itid);
  update basar.auction_items set dutch_started_at = now() - interval '1000 seconds' where id = itid;
  perform pg_temp.assert_num(((basar.dutch_take(p2,s2,itid))->>'amount')::numeric, 200, 'A14: floored at dutch_floor 200');
end $$;

-- ============ A15. Live call_stage (Første/Andre gang) ============
do $$
declare r jsonb; sid uuid; hsec text; live uuid; stille uuid; st jsonb;
begin
  r := basar.create_auction_session('host-a15'); sid := (r->>'session_id')::uuid; hsec := r->>'host_secret';
  live := ((basar.create_auction_item(sid,hsec,'Maleri','','opplevelse','live',100,10))->>'item_id')::uuid;
  perform pg_temp.assert_err(basar.call_stage(sid,hsec,live,'first'), 'Objektet er ikke aktivt', 'A15: stage before active');
  perform basar.activate_item(sid,hsec,live);
  perform pg_temp.assert_err(basar.call_stage(sid,hsec,live,'tull'), 'Ugyldig stadium', 'A15: bad stage');
  perform pg_temp.assert_ok(basar.call_stage(sid,hsec,live,'first'), 'A15: call first');
  perform pg_temp.assert_true((select live_stage from auction_items where id=live) = 'first', 'A15: live_stage=first');
  perform pg_temp.assert_ok(basar.call_stage(sid,hsec,live,'second'), 'A15: call second');
  st := basar.get_auction_state(sid);
  perform pg_temp.assert_true((st->'items'->0->>'live_stage') = 'second', 'A15: live_stage surfaced in state');
  perform pg_temp.assert_ok(basar.call_stage(sid,hsec,live,'none'), 'A15: clear stage');
  perform pg_temp.assert_true((select live_stage from auction_items where id=live) is null, 'A15: stage cleared');

  stille := ((basar.create_auction_item(sid,hsec,'Stille','','gjenstand','stille',100,10))->>'item_id')::uuid;
  perform basar.activate_item(sid,hsec,stille);
  perform pg_temp.assert_err(basar.call_stage(sid,hsec,stille,'first'), 'Ikke en live-auksjon', 'A15: stage on non-live rejected');
end $$;

do $$ begin raise notice 'ALL AUCTION TESTS PASSED'; end $$;
