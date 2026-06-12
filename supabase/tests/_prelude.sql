-- Recreate the Supabase-provided objects the migration depends on, so we can
-- apply the real migration unmodified against a vanilla Postgres.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create publication supabase_realtime;
