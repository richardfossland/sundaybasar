-- ============================================================================
-- SundayBasar — 0005: Sunday Account host ownership  (idempotent + additive)
--
-- Ties a basar to the Sunday Account (arrangør) that created it, so a signed-in
-- host can list + delete their own basars from the "Mine basarer" dashboard.
--
-- The owner column is `basar.sessions.host_user_id` — the host's Sunday Account
-- auth user id (`auth.users.id` from the ISSUER / identity Supabase project,
-- a DIFFERENT project than this data project). So there is NO foreign key here:
-- those auth.users live in another database; it is just an opaque uuid we stamp
-- from the verified server-side session.
--
-- ANONYMOUS PLAY / HOSTING UNCHANGED:
--   • host_user_id is NULLABLE and defaults to null. Anonymous create
--     (create_session, no login) keeps inserting a session with
--     host_user_id = null and works exactly as before — the per-session
--     host_secret is still the only thing that gates host control.
--   • No identity is added to players / lots / draws. Only the session row gains
--     an optional owner link; the audience surface is untouched.
--   • The owner is stamped best-effort AFTER create, via the service-role host
--     API (claim route) — never through the anon RPC path. The dashboard
--     list/delete are owner-gated server-side (host_user_id = me).
--
-- DELETE CASCADE: every basar child table (host_secrets, players,
-- player_secrets, lot_counters, allocations, lots, prizes, draws, events)
-- references basar.sessions(id) ON DELETE CASCADE (migration 0001). Deleting a
-- session row removes all its children in one statement — the owner-gated
-- DELETE route relies on exactly this.
--
-- Safe to re-run. Requires `basar` in Exposed schemas (see 0001).
-- ============================================================================

-- Ensure the owner column exists (no-op if already present).
alter table basar.sessions
  add column if not exists host_user_id uuid;

-- The dashboard query is `where host_user_id = $me order by created_at desc`.
create index if not exists sessions_host_user_idx
  on basar.sessions (host_user_id, created_at desc)
  where host_user_id is not null;

comment on column basar.sessions.host_user_id is
  'Sunday Account (issuer project) auth user id of the arrangør who created '
  'this basar while signed in. NULL for anonymous / code-only basars. No '
  'cross-project FK — integrity is enforced in the app layer.';

-- Grant discipline (mirrors 0001): the host_user_id is written ONLY by the
-- service-role client (the host API). anon/authenticated keep SELECT-only on
-- basar.sessions and must NOT be able to write the owner column. Re-assert so a
-- fresh apply is self-contained.
revoke insert, update, delete on basar.sessions from anon, authenticated;
grant select, insert, update, delete on basar.sessions to service_role;
