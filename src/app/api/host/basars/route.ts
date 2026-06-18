import { ok, fail, readJson } from '@/lib/server/http'
import { requireHost, authFail } from '@/lib/server/host-auth'
import { listBasarsForOwner, deleteBasarForOwner } from '@/lib/server/host-basars'

// The host dashboard surface talks to the issuer cookie + service role, so it
// must run on the Node runtime (the service-role key is a server secret) and
// never be cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/host/basars — list the signed-in host's basars ("Mine basarer").
//   401 if not signed in, 403 if not an arrangør (allow-list).
export async function GET() {
  try {
    const host = await requireHost()
    const basars = await listBasarsForOwner(host.id)
    return ok({ basars })
  } catch (err) {
    return authFail(err) ?? fail(500, 'kunne_ikke_laste')
  }
}

// DELETE /api/host/basars — delete a basar the host owns.
//   body: { sessionId }
//   401 not signed in · 403 not an arrangør / not yours · 404 missing · 200 ok.
//
// Owner-gating is enforced in deleteBasarForOwner (WHERE host_user_id = host.id),
// so a host can never delete a basar they don't own — even with a valid id.
// Children cascade via the FK `on delete cascade` on basar.sessions(id).
export async function DELETE(req: Request) {
  try {
    const host = await requireHost()
    const body = await readJson<{ sessionId?: string }>(req)
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) return fail(400, 'mangler_basar')

    const result = await deleteBasarForOwner(sessionId, host.id)
    if (result === 'not_found') return fail(404, 'finnes_ikke')
    if (result === 'forbidden') return fail(403, 'ikke_din')
    return ok({ deleted: true })
  } catch (err) {
    return authFail(err) ?? fail(500, 'kunne_ikke_slette')
  }
}
