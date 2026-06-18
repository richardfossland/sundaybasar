import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { sharedCookieOptions } from './cookies'
import { SUNDAY_AUTH_ANON_KEY, SUNDAY_AUTH_URL } from './auth-env'

/**
 * Server-side Sunday Account (host SSO) client, bound to the request cookies.
 *
 * It points at the ISSUER Supabase project (`NEXT_PUBLIC_SUNDAY_AUTH_*`) — the
 * shared Sunday Account auth project — NOT the app's own DATA project. It is
 * used only to resolve the signed-in host (`auth.getUser()`); authorization
 * then happens in `lib/server/host-auth.ts` against `BASAR_ADMIN_EMAILS`.
 */
export async function createAuthClient() {
  if (!SUNDAY_AUTH_URL || !SUNDAY_AUTH_ANON_KEY) {
    throw new Error(
      'Sunday Account auth env missing: set NEXT_PUBLIC_SUNDAY_AUTH_URL and NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY',
    )
  }
  // `cookies()` is async in Next 15+.
  const cookieStore = await cookies()
  return createServerClient(SUNDAY_AUTH_URL, SUNDAY_AUTH_ANON_KEY, {
    cookieOptions: sharedCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        // In Server Components cookie writes throw; the middleware refreshes the
        // session cookie, so swallowing here is safe.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // no-op in RSC render context
        }
      },
    },
  })
}
