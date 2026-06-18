import { type NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // ONLY the host/arrangør surface + the auth callback are matched. Anonymous
  // join (`/`), the player game (`/game/*`) and every public read are NOT
  // matched here, so anonymous play is completely untouched. Within /host/*,
  // updateSession leaves the code-based wizard/console/projector open and gates
  // only the bare `/host` dashboard.
  matcher: ['/host/:path*', '/auth/:path*'],
}
