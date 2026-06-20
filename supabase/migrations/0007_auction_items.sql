-- 0007 — auction module, part 2/5: the auction objects (lots being auctioned).
--
-- One row per thing on the block. `format` is PER OBJECT, so a single auction
-- can mix a live "på scenen nå" item, silent table items, and a dutch item.
-- Mirrors basar's trust model: public SELECT-only, every write via a SECURITY
-- DEFINER RPC (migration 0010). `reserve_price` is NEVER exposed to clients
-- (get_auction_state returns only a reserve_met boolean).
--
-- Idempotent (safe to re-run).

create table if not exists basar.auction_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references basar.sessions(id) on delete cascade,
  position int not null,
  title text not null,
  description text,
  image_url text,
  -- tjeneste = donated service/talent (the church/dugnad twist); gjenstand =
  -- physical item/baking; opplevelse = experience/event; mystery = hidden box.
  category text not null check (category in ('tjeneste','gjenstand','opplevelse','mystery')),
  -- live = auctioneer-driven (shares the ascending-bid engine with stille);
  -- stille = timed silent auction w/ proxy bids; hollandsk = descending price.
  format text not null check (format in ('live','stille','hollandsk')),
  donor_name text,                       -- "Donert av" — surfaced for tjeneste-auksjon
  start_price numeric not null default 0 check (start_price >= 0),
  min_increment numeric not null default 10 check (min_increment > 0),
  reserve_price numeric check (reserve_price is null or reserve_price >= 0),  -- HIDDEN
  buy_now_price numeric check (buy_now_price is null or buy_now_price >= 0),
  deadline timestamptz,                   -- stille: when bidding closes
  antisnipe_seconds int not null default 10 check (antisnipe_seconds >= 0),
  dutch_start numeric,                    -- hollandsk params (engine is a later PR)
  dutch_floor numeric,
  dutch_step numeric,
  dutch_interval_seconds int,
  dutch_started_at timestamptz,
  status text not null default 'draft' check (status in ('draft','active','sold','passed')),
  current_amount numeric,                 -- denormalized effective leading bid (display)
  current_leader_player_id uuid references basar.players(id) on delete set null,
  winner_player_id uuid references basar.players(id) on delete set null,
  winning_amount numeric,
  created_at timestamptz default now(),
  -- image_url, when present, must be a real http(s) URL (mirrors prizes.image_url).
  constraint auction_items_img_chk check (image_url is null or image_url ~ '^https?://')
);
create index if not exists idx_auction_items_session on basar.auction_items (session_id);

alter table basar.auction_items enable row level security;
drop policy if exists "auction_items r" on basar.auction_items;
create policy "auction_items r" on basar.auction_items for select using (true);

-- 0001 set default privileges that auto-grant CRUD to anon/authenticated on new
-- basar tables; strip writes here so the only write path is the RPCs.
revoke insert, update, delete on basar.auction_items from anon, authenticated;

-- Realtime: clients watch auction_items for live price/leader/status changes.
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='basar' and tablename='auction_items') then
    execute 'alter publication supabase_realtime add table basar.auction_items';
  end if;
end $$;
