'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side Sunday Account (host SSO) client. Points at the ISSUER project
 * (`NEXT_PUBLIC_SUNDAY_AUTH_*`) and is used ONLY on the host login page +
 * dashboard sign-out to kick off / end magic-link / Google sign-in. It writes
 * the `sb-*` session cookie scoped to `.sundaysuite.app` (via
 * `NEXT_PUBLIC_COOKIE_DOMAIN`) so the login is shared across the suite.
 *
 * This is separate from the app's DATA/anon client (`lib/supabase/client.ts`),
 * which is session-less and only reads public tables + calls RPCs.
 */
export function createAuthBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL!,
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY!,
    {
      cookieOptions: cookieDomain(),
    },
  )
}

function cookieDomain() {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim()
  if (!domain) return undefined
  return { domain, path: '/', sameSite: 'lax' as const, secure: true }
}
