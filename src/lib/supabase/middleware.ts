import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { sharedCookieOptions } from './cookies'
import { SUNDAY_AUTH_ANON_KEY, SUNDAY_AUTH_URL } from './auth-env'

// SSO host middleware. Two jobs, scoped to the host/auth surface ONLY:
//  1. refresh the Sunday Account session cookie so it doesn't expire mid-use;
//  2. gate the SIGNED-IN host dashboard (the bare `/host`) behind a login.
//
// CRITICAL — anonymous play is untouched. The matcher (see middleware.ts) only
// runs this for `/host/*` and `/auth/*`. Within that, EVERYTHING except the bare
// `/host` dashboard is left open:
//   • `/host/new`               → create wizard (anonymous create_session RPC)
//   • `/host/<sessionId>`       → per-basar console (code-based host_secret)
//   • `/host/<sessionId>/projector` → big screen (code-based)
// Only `/host` (the new "Mine basarer" dashboard) requires a Sunday login. Join
// / game / display surfaces are never matched here at all.

/** The login surface itself — always reachable without a session. */
const LOGIN_PATH = '/host/login'

/** True for any `/host/<segment>...` path (create wizard, per-basar console,
 * projector) — these use the code-based host auth and must stay anonymous.
 * Only the bare `/host` (or `/host/`) dashboard is the Sunday-gated surface. */
function isCodeBasedHostRoute(path: string): boolean {
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`)) return false
  const rest = path.replace(/^\/host\/?/, '')
  return rest.length > 0
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUNDAY_AUTH_URL, SUNDAY_AUTH_ANON_KEY, {
    cookieOptions: sharedCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options)
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // /auth/* (callback) must run before any session exists — let it through.
  if (path.startsWith('/auth/')) return response

  // The code-based host surfaces (wizard / console / projector) stay open —
  // they authenticate themselves via the per-session host_secret.
  if (isCodeBasedHostRoute(path)) return response

  // The login page itself is always reachable.
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`)) {
    // If already signed in, skip the form and go to the dashboard.
    if (user) {
      const url = request.nextUrl.clone()
      url.pathname = '/host'
      return NextResponse.redirect(url)
    }
    return response
  }

  // The bare `/host` dashboard requires a signed-in user.
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = LOGIN_PATH
    return NextResponse.redirect(url)
  }

  return response
}
