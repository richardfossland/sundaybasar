import { ok, fail, readJson } from '@/lib/server/http'
import { requireHost, authFail } from '@/lib/server/host-auth'
import { stampBasarOwner } from '@/lib/server/host-basars'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/host/basars/claim — best-effort: stamp the signed-in host as the
//   owner of a basar they just created (so it shows up in "Mine basarer").
//   body: { sessionId }
//
// The create flow (anonymous create_session RPC) ALWAYS succeeds without this;
// the wizard calls claim only when a host happens to be signed in. The stamp
// only ever sets host_user_id when it is still null, so it can never steal an
// already-owned basar. Anonymous create is completely unaffected.
export async function POST(req: Request) {
  try {
    const host = await requireHost()
    const body = await readJson<{ sessionId?: string }>(req)
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) return fail(400, 'mangler_basar')

    await stampBasarOwner(sessionId, host.id)
    return ok({ claimed: true })
  } catch (err) {
    return authFail(err) ?? fail(500, 'kunne_ikke_knytte')
  }
}
