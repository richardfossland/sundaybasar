import type { CookieOptions } from '@supabase/ssr'

/**
 * Shared cookie options for the Sunday Account (host SSO) Supabase client —
 * browser, server and middleware all write the `sb-*` session cookie
 * identically so the login carries across requests.
 *
 * Cross-subdomain SSO: when `NEXT_PUBLIC_COOKIE_DOMAIN` is set
 * (`.sundaysuite.app` in production) the cookie is scoped to the parent domain
 * so every Sunday web app shares one login. Left unset in local dev so cookies
 * keep working on `localhost`.
 *
 * NOTE: this is ONLY for the host auth client (the issuer project). The app's
 * own DATA/anon client (`lib/supabase/client.ts`) is deliberately session-less
 * (persistSession: false), so the two never fight over cookies.
 */
export function sharedCookieOptions(): CookieOptions {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim()
  if (!domain) return {}
  return {
    domain,
    path: '/',
    sameSite: 'lax',
    secure: true,
  }
}
