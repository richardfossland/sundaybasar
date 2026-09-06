import { createServiceClient } from '@/lib/supabase/service'
import { clientIp, fail, ok, rateLimit } from '@/lib/server/http'

// GET /api/health — liveness probe for the uptime monitor.
//
// `?db=1` additionally proves the Supabase round-trip works (the failure mode
// that actually takes the app down: a rotated/missing service-role key, or
// PostgREST being unreachable). The bare probe stays dependency-free so a DB
// outage is distinguishable from the Worker being dead.
//
// Contract: this endpoint MUST NOT throw. Anything unexpected becomes a 503
// with a JSON body, so the monitor sees a status code rather than a Worker
// exception page.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = 'sundaybasar'

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const ts = new Date().toISOString()

  if (url.searchParams.get('db') !== '1') {
    return ok({ app: APP, ts })
  }

  // Only the DB branch is throttled: it costs a real PostgREST round-trip, and
  // the endpoint is unauthenticated. 60/min per IP is 60× what the monitor
  // needs (one probe a minute) while capping abuse.
  if (!rateLimit(`health:${clientIp(req)}`, 60, 60_000)) {
    return fail(429, 'rate_limited')
  }

  const started = Date.now()
  try {
    // Lightest possible read: one indexed column, one row, no filter.
    const { error } = await createServiceClient()
      .from('sessions')
      .select('id')
      .limit(1)
    if (error) throw error
    return ok({ app: APP, ts, db: 'ok', ms: Date.now() - started })
  } catch (err) {
    console.error('[health]', err)
    return Response.json(
      { ok: false, app: APP, ts, db: 'error', ms: Date.now() - started },
      { status: 503 },
    )
  }
}

// Explicit HEAD: identical status and headers to GET, body dropped. Uptime
// monitors commonly probe with HEAD, and an explicit export means the
// behaviour is pinned by a test rather than by whatever the framework
// synthesises.
export async function HEAD(req: Request): Promise<Response> {
  const res = await GET(req)
  return new Response(null, { status: res.status, headers: res.headers })
}
