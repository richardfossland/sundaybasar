import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { sharedCookieOptions } from './cookies'
import { SUNDAY_AUTH_ANON_KEY, SUNDAY_AUTH_URL } from './auth-env'
import { HOST_LOGIN_PATH as LOGIN_PATH, isOpenHostPath } from '@/lib/hostRoutes'

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

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const path = request.nextUrl.pathname

  // Decide by PATH before touching the issuer. The code-based host surfaces
  // (wizard / console / projector / auction console) and the auth callback are
  // always open, so they must not pay a network round-trip to the Sunday
  // Account project on every navigation — and, more importantly, a projector
  // on the big screen must keep working even if the issuer is unreachable.
  if (isOpenHostPath(path)) return response

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
