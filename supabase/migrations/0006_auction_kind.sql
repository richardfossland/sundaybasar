-- 0006 — auction module, part 1/5: session discriminator + fundraising goal.
--
-- Auction is a MODULE inside basar: it reuses sessions, join_session (device
-- dedup), the Sunday Account SSO, realtime, the projector and the Vipps card.
-- An auction is just a session with kind='auksjon'. The basar-specific columns
-- (tildeling/trekning) are NOT NULL with no default, so an auction session sets
-- them to harmless valid values (kjop/klassisk) and ignores them — this keeps
-- ZERO changes to the basar constraints/logic. Crucially tildeling='kjop' means
-- join_session does NOT auto-allocate free lots (auction has no lots at all).
--
-- Idempotent (safe to re-run).

-- Discriminator. Existing rows + every basar.create_session() insert default to
-- 'basar'; only basar.create_auction_session() (migration 0010) writes 'auksjon'.
alter table basar.sessions add column if not exists kind text not null default 'basar';
alter table basar.sessions drop constraint if exists sessions_kind_chk;
alter table basar.sessions add constraint sessions_kind_chk check (kind in ('basar','auksjon'));

-- Fundraising goal for the live thermometer. Null = no goal shown. basar itself
-- deliberately has no money total; for an auction the raised sum is trivially
-- derivable (sum of sold items), so the thermometer lives naturally here.
alter table basar.sessions add column if not exists goal_amount numeric
  check (goal_amount is null or goal_amount >= 0);

-- Paddle/bid number for the on-screen "din byr"-pop in live mode. Nullable;
-- assignment is wired by the live-mode flow (a later PR). Harmless for basar.
alter table basar.players add column if not exists paddle_number int;
