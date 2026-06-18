import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never be
 * imported into client code (the `server-only` guard enforces this at build
 * time). Used ONLY by the signed-in host surface (the "Mine basarer" dashboard:
 * owner-scoped list + delete + best-effort owner stamp). Anonymous join/play and
 * the code-based host console never touch it — they go through the anon client +
 * SECURITY DEFINER RPCs exactly as before.
 *
 * It targets the app's DATA project (the shared SundayChess project) and the
 * dedicated `basar` schema. Needs SUPABASE_SERVICE_ROLE_KEY (a Worker secret).
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    )
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'basar' },
  })
}
