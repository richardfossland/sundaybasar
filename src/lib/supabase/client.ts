import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser Supabase client (anon key), scoped to the dedicated `basar` schema
 * so SundayBasar can coexist with the other SundaySuite apps in the same
 * shared Supabase project (free-tier 2-project limit) without table clashes.
 *
 * STRICT trust model (money is involved): public tables are SELECT-only for
 * anon — every write goes through a SECURITY DEFINER RPC gated on either the
 * per-session host secret or the per-player secret (see supabase/migrations).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'basar' },
    }
  )
}
