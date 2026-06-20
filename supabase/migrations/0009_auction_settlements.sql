-- 0009 — auction module, part 4/5: settlements (who owes what, paid yes/no).
--
-- Created when an item is sold (mark_sold / buy_now). The chosen payment model
-- is basar's existing one: show a prefilled Vipps link, the host ticks "betalt"
-- manually — NO Vipps API/webhooks/secrets. `paid` drives the host oppgjør tab;
-- the thermometer total is derived from sold items (see get_auction_state).
-- Public-readable so a winner sees their own amount; written only via RPC.
--
-- Idempotent (safe to re-run).

create table if not exists basar.auction_settlements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references basar.auction_items(id) on delete cascade,
  player_id uuid references basar.players(id) on delete set null,
  amount numeric not null,
  method text not null default 'vipps' check (method in ('vipps','manual')),
  paid bool not null default false,
  paid_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_auction_settlements_item on basar.auction_settlements (item_id);

alter table basar.auction_settlements enable row level security;
drop policy if exists "auction_settlements r" on basar.auction_settlements;
create policy "auction_settlements r" on basar.auction_settlements for select using (true);
revoke insert, update, delete on basar.auction_settlements from anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='basar' and tablename='auction_settlements') then
    execute 'alter publication supabase_realtime add table basar.auction_settlements';
  end if;
end $$;
