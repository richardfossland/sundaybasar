import 'server-only'

// Owner-scoped basar queries for the Sunday Account host dashboard ("Mine
// basarer"). The owner is `basar.sessions.host_user_id` — a NULLABLE uuid
// (migration 0004), so anonymous (code-only) basars keep working with it left
// null. Only basars created while a host was signed in get stamped (best-effort
// from the create flow → the claim route).
//
// Everything here runs through the service-role client (SERVER ONLY); the owner
// uuid is ALWAYS the verified server-side session user id (never from a request
// body), so a host can only ever see / delete / claim their own basars.

import { createServiceClient } from '@/lib/supabase/service'

type Db = ReturnType<typeof createServiceClient>
function db(): Db {
  return createServiceClient()
}

export interface OwnedBasarSummary {
  id: string
  code: string
  phase: 'open' | 'ended'
  tildeling: string
  trekning: string
  playerCount: number
  createdAt: string
}

export function toOwnedSummary(row: {
  id: string
  code: string
  phase: 'open' | 'ended'
  tildeling: string
  trekning: string
  player_count: number
  created_at: string
}): OwnedBasarSummary {
  return {
    id: row.id,
    code: row.code,
    phase: row.phase,
    tildeling: row.tildeling,
    trekning: row.trekning,
    playerCount: row.player_count,
    createdAt: row.created_at,
  }
}

/** All basars owned by this Sunday user, newest first. */
export async function listBasarsForOwner(
  userId: string,
): Promise<OwnedBasarSummary[]> {
  const { data, error } = await db()
    .from('sessions')
    .select('id,code,phase,tildeling,trekning,player_count,created_at')
    .eq('host_user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data as Parameters<typeof toOwnedSummary>[0][]) ?? []).map(
    toOwnedSummary,
  )
}

/** The owner of a single basar (for the DELETE authz check). Returns the
 * host_user_id, null (anonymous basar — owned by nobody), or undefined (the
 * basar does not exist). */
export async function getBasarOwner(
  sessionId: string,
): Promise<string | null | undefined> {
  const { data } = await db()
    .from('sessions')
    .select('host_user_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (!data) return undefined
  return (data as { host_user_id: string | null }).host_user_id
}

export type DeleteResult = 'deleted' | 'not_found' | 'forbidden'

/** Delete a basar the given user owns. Children (host_secrets, players,
 * player_secrets, lot_counters, allocations, lots, prizes, draws, events) all
 * cascade via `on delete cascade` on `basar.sessions(id)`. The owner predicate
 * is enforced HERE so a host can never delete a basar they don't own, even with
 * a valid id:
 *   'not_found'  → no such basar
 *   'forbidden'  → exists but owned by someone else / anonymous (host_user_id ≠ me)
 *   'deleted'    → row + all children removed. */
export async function deleteBasarForOwner(
  sessionId: string,
  userId: string,
): Promise<DeleteResult> {
  const owner = await getBasarOwner(sessionId)
  if (owner === undefined) return 'not_found'
  if (owner !== userId) return 'forbidden' // incl. anonymous basars (owner null)

  const { error } = await db()
    .from('sessions')
    .delete()
    .eq('id', sessionId)
    .eq('host_user_id', userId)
  if (error) throw new Error(error.message)
  return 'deleted'
}

/** Best-effort stamp of the owner on a freshly created basar. Only stamps when
 * the row is still unowned (host_user_id is null) so it can never steal another
 * host's basar. A failure here must NOT break anonymous create — callers
 * ignore it. */
export async function stampBasarOwner(
  sessionId: string,
  userId: string,
): Promise<void> {
  const { error } = await db()
    .from('sessions')
    .update({ host_user_id: userId })
    .eq('id', sessionId)
    .is('host_user_id', null)
  if (error) throw new Error(error.message)
}
