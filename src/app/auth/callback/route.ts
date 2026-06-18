import { NextResponse } from 'next/server'

import { createAuthClient } from '@/lib/supabase/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// OAuth / magic-link landing for the Sunday Account host login. Exchanges the
// code for a session cookie, then sends the host to the dashboard. Whitelisted
// in middleware (no session cookie exists yet at this point).
//
// Hardened: only ever redirect within this origin (`next` is path-only) so the
// callback can't be turned into an open redirect.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  // Only same-origin path redirects allowed.
  const rawNext = searchParams.get('next') ?? '/host'
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/host'

  if (error) {
    return NextResponse.redirect(`${origin}/host/login?error=auth`)
  }

  if (code) {
    const supabase = await createAuthClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      return NextResponse.redirect(`${origin}/host/login?error=auth`)
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
