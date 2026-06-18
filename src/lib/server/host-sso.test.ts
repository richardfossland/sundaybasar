import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Sunday Account host SSO: the ONE authz predicate (isAdminEmail), the
// owner-scoped basar queries, and the DELETE route's 401/403/404/400/200
// contract. The DATA service client + the issuer auth client are mocked so this
// runs in the plain-Node test env (no Docker, no network).
//
// This proves anonymous play is never touched here: anonymous basars carry
// host_user_id = null and are excluded from list / refused on delete.
// ---------------------------------------------------------------------------

import { adminEmailSet, isAdminEmail } from '@/lib/server/host-auth'

describe('isAdminEmail (the ONE authz predicate)', () => {
  it('matches case-insensitively and trims', () => {
    expect(isAdminEmail('Host@Example.com', 'host@example.com')).toBe(true)
    expect(isAdminEmail('  host@example.com ', 'host@example.com')).toBe(true)
  })
  it('rejects non-listed emails', () => {
    expect(isAdminEmail('nope@example.com', 'host@example.com')).toBe(false)
  })
  it('fails closed on an empty allow-list (nobody is a host)', () => {
    expect(isAdminEmail('host@example.com', '')).toBe(false)
    expect(isAdminEmail('host@example.com', '   ')).toBe(false)
  })
  it('falls back to BASAR_ADMIN_EMAILS env when the arg is omitted', () => {
    const prev = process.env.BASAR_ADMIN_EMAILS
    process.env.BASAR_ADMIN_EMAILS = 'host@example.com'
    expect(isAdminEmail('host@example.com')).toBe(true)
    expect(isAdminEmail('nope@example.com')).toBe(false)
    process.env.BASAR_ADMIN_EMAILS = prev
  })
  it('rejects null/empty email', () => {
    expect(isAdminEmail(null, 'host@example.com')).toBe(false)
    expect(isAdminEmail(undefined, 'host@example.com')).toBe(false)
  })
  it('parses comma / space / semicolon separated lists', () => {
    const set = adminEmailSet('a@x.com, b@x.com;c@x.com  d@x.com')
    expect(set).toEqual(new Set(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']))
    expect(isAdminEmail('c@x.com', 'a@x.com, b@x.com;c@x.com')).toBe(true)
  })
})

// ---- Mock the service-role DATA client so we can test the store + route ------

type BasarRow = {
  id: string
  host_user_id: string | null
  code: string
  phase: 'open' | 'ended'
  tildeling: string
  trekning: string
  player_count: number
  created_at: string
}

const state: { sessions: BasarRow[] } = { sessions: [] }

vi.mock('@/lib/supabase/service', () => {
  function from() {
    return makeQuery()
  }
  function makeQuery() {
    const eqFilters: { col: string; val: unknown }[] = []
    const isNull: string[] = []
    let op: 'select' | 'delete' | 'update' = 'select'
    let selectCols = ''
    let updateVals: Record<string, unknown> = {}
    const q = {
      select(cols: string) {
        op = 'select'
        selectCols = cols
        return q
      },
      delete() {
        op = 'delete'
        return q
      },
      update(vals: Record<string, unknown>) {
        op = 'update'
        updateVals = vals
        return q
      },
      eq(col: string, val: unknown) {
        eqFilters.push({ col, val })
        return q
      },
      is(col: string, val: null) {
        if (val === null) isNull.push(col)
        return q
      },
      order() {
        return q
      },
      match(rows: BasarRow[]) {
        return rows.filter(
          (r) =>
            eqFilters.every(
              (f) => (r as Record<string, unknown>)[f.col] === f.val,
            ) && isNull.every((c) => (r as Record<string, unknown>)[c] === null),
        )
      },
      async maybeSingle() {
        const hit = q.match(state.sessions)[0]
        return { data: hit ?? null, error: null }
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        if (op === 'delete') {
          const ids = new Set(q.match(state.sessions).map((r) => r.id))
          state.sessions = state.sessions.filter((r) => !ids.has(r.id))
          return resolve({ data: null, error: null })
        }
        if (op === 'update') {
          for (const r of q.match(state.sessions)) Object.assign(r, updateVals)
          return resolve({ data: null, error: null })
        }
        const rows = q.match(state.sessions).map((r) => {
          if (!selectCols || selectCols === '*') return r
          const out: Record<string, unknown> = {}
          for (const c of selectCols.split(','))
            out[c.trim()] = (r as Record<string, unknown>)[c.trim()]
          return out
        })
        return resolve({ data: rows, error: null })
      },
    }
    return q
  }
  return { createServiceClient: () => ({ from }) }
})

// requireHost → drive the resolved/empty/forbidden user via this mock.
const authState: { user: { id: string; email: string } | null } = { user: null }
vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authState.user } }) },
  }),
}))

import {
  deleteBasarForOwner,
  listBasarsForOwner,
  stampBasarOwner,
} from '@/lib/server/host-basars'
import { DELETE } from '@/app/api/host/basars/route'

const ME = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

function row(id: string, owner: string | null, code: string): BasarRow {
  return {
    id,
    host_user_id: owner,
    code,
    phase: 'open',
    tildeling: 'gratis',
    trekning: 'klassisk',
    player_count: 0,
    created_at: '2026-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  process.env.BASAR_ADMIN_EMAILS = 'host@example.com'
  state.sessions = [
    row('b-mine-1', ME, 'AAAA'),
    row('b-mine-2', ME, 'BBBB'),
    row('b-other', OTHER, 'CCCC'),
    row('b-anon', null, 'DDDD'),
  ]
  authState.user = null
})
afterEach(() => vi.clearAllMocks())

describe('listBasarsForOwner', () => {
  it("returns only the caller's own basars (anonymous + others excluded)", async () => {
    const mine = await listBasarsForOwner(ME)
    expect(mine.map((b) => b.id).sort()).toEqual(['b-mine-1', 'b-mine-2'])
  })
  it('returns nothing for a user with no basars', async () => {
    expect(await listBasarsForOwner(OTHER + 'x')).toEqual([])
  })
})

describe('stampBasarOwner (best-effort claim)', () => {
  it('stamps an anonymous basar with the owner', async () => {
    await stampBasarOwner('b-anon', ME)
    expect(state.sessions.find((b) => b.id === 'b-anon')?.host_user_id).toBe(ME)
  })
  it("never overwrites an already-owned basar (is null guard)", async () => {
    await stampBasarOwner('b-other', ME)
    expect(state.sessions.find((b) => b.id === 'b-other')?.host_user_id).toBe(
      OTHER,
    )
  })
})

describe('deleteBasarForOwner (owner gate)', () => {
  it('deletes a basar the user owns', async () => {
    expect(await deleteBasarForOwner('b-mine-1', ME)).toBe('deleted')
    expect(state.sessions.find((b) => b.id === 'b-mine-1')).toBeUndefined()
  })
  it("refuses to delete another host's basar", async () => {
    expect(await deleteBasarForOwner('b-other', ME)).toBe('forbidden')
    expect(state.sessions.find((b) => b.id === 'b-other')).toBeDefined()
  })
  it('refuses to delete an anonymous basar', async () => {
    expect(await deleteBasarForOwner('b-anon', ME)).toBe('forbidden')
    expect(state.sessions.find((b) => b.id === 'b-anon')).toBeDefined()
  })
  it('returns not_found for a missing basar', async () => {
    expect(await deleteBasarForOwner('nope', ME)).toBe('not_found')
  })
})

function delReq(sessionId: string | undefined): Promise<Response> {
  return DELETE(
    new Request('http://x/api/host/basars', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sessionId === undefined ? {} : { sessionId }),
    }),
  )
}

describe('DELETE /api/host/basars — auth contract', () => {
  it('401 when not signed in', async () => {
    authState.user = null
    const res = await delReq('b-mine-1')
    expect(res.status).toBe(401)
    expect(state.sessions.find((b) => b.id === 'b-mine-1')).toBeDefined()
  })

  it('403 when signed in but email not in the allow-list', async () => {
    authState.user = { id: ME, email: 'stranger@example.com' }
    const res = await delReq('b-mine-1')
    expect(res.status).toBe(403)
    expect(state.sessions.find((b) => b.id === 'b-mine-1')).toBeDefined()
  })

  it('400 when sessionId is missing', async () => {
    authState.user = { id: ME, email: 'host@example.com' }
    const res = await delReq(undefined)
    expect(res.status).toBe(400)
  })

  it("403 when host tries to delete a basar they don't own", async () => {
    authState.user = { id: ME, email: 'host@example.com' }
    const res = await delReq('b-other')
    expect(res.status).toBe(403)
    expect(state.sessions.find((b) => b.id === 'b-other')).toBeDefined()
  })

  it("403 when host tries to delete an anonymous basar", async () => {
    authState.user = { id: ME, email: 'host@example.com' }
    const res = await delReq('b-anon')
    expect(res.status).toBe(403)
    expect(state.sessions.find((b) => b.id === 'b-anon')).toBeDefined()
  })

  it("404 when the basar doesn't exist", async () => {
    authState.user = { id: ME, email: 'host@example.com' }
    const res = await delReq('does-not-exist')
    expect(res.status).toBe(404)
  })

  it('200 + row gone when the owner deletes their own basar', async () => {
    authState.user = { id: ME, email: 'host@example.com' }
    const res = await delReq('b-mine-1')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, deleted: true })
    expect(state.sessions.find((b) => b.id === 'b-mine-1')).toBeUndefined()
  })
})
