-- 0008 — auction module, part 3/5: bid history + hidden proxy maximums.
--
-- Two tables, mirroring basar's "public feed vs locked secret" split
-- (events/lots are public; draws/host_secrets are dark):
--
--   • auction_bids       — append-only PUBLIC activity feed (drives the heat
--                          meter and "recent bids"). Stores only the resulting
--                          public price + the acting player. NEVER a max.
--   • auction_proxy_maxes — each bidder's secret maximum (eBay-style proxy).
--                          NOT in the realtime publication and anon/authenticated
--                          have NO access at all — reachable only inside the
--                          SECURITY DEFINER place_bid RPC. Same discipline that
--                          keeps the basar winner from leaking pre-reveal.
--
-- Idempotent (safe to re-run).

-- ── PUBLIC bid feed ─────────────────────────────────────────────────────────
create table if not exists basar.auction_bids (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references basar.auction_items(id) on delete cascade,
  player_id uuid references basar.players(id) on delete set null,  -- the actor
  amount numeric not null,                 -- resulting PUBLIC price (never a max)
  kind text not null check (kind in ('manual','auto','buynow','dutch_take')),
  voided bool not null default false,
  created_at timestamptz default now()
);
create index if not exists idx_auction_bids_item on basar.auction_bids (item_id);

alter table basar.auction_bids enable row level security;
drop policy if exists "auction_bids r" on basar.auction_bids;
create policy "auction_bids r" on basar.auction_bids for select using (true);
revoke insert, update, delete on basar.auction_bids from anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='basar' and tablename='auction_bids') then
    execute 'alter publication supabase_realtime add table basar.auction_bids';
  end if;
end $$;

-- ── SECRET proxy maximums (one per player per item) ─────────────────────────
create table if not exists basar.auction_proxy_maxes (
  item_id uuid references basar.auction_items(id) on delete cascade,
  player_id uuid references basar.players(id) on delete cascade,
  max_amount numeric not null,
  updated_at timestamptz not null default now(),  -- tiebreak: earliest max wins
  primary key (item_id, player_id)
);

alter table basar.auction_proxy_maxes enable row level security;
-- No SELECT policy on purpose: even with the table-level grant revoked, RLS-deny
-- is belt-and-braces. Revoke ALL so it is unreachable outside SECURITY DEFINER.
revoke all on basar.auction_proxy_maxes from anon, authenticated;
-- Deliberately NOT added to the realtime publication (would leak every max).
