/**
 * Sunday Account (ISSUER) project env. This is a SEPARATE Supabase project from
 * the app's DATA project (`NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY`, which
 * lives in the shared SundayChess project and owns the `basar` schema — it
 * stays UNCHANGED). The issuer project is the shared identity provider that
 * owns the `sb-*` session cookie on `.sundaysuite.app`.
 *
 * Values come from SundayInfo's `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY`
 * (the SundayPlans / identity project). Set in the build env:
 *   NEXT_PUBLIC_SUNDAY_AUTH_URL
 *   NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY
 */
export const SUNDAY_AUTH_URL = process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL!
export const SUNDAY_AUTH_ANON_KEY = process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY!
