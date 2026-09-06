import { describe, expect, it } from 'vitest'

import {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  POST,
  PUT,
} from '@/app/api/[...missing]/route'

// Blanket JSON 404 for any unmatched /api/* path, for every verb — a scanner
// or stale client hitting a typo'd endpoint must get { ok:false, error } JSON,
// never the App Router's rendered not-found page.
describe('catch-all /api/[...missing]', () => {
  it.each([
    ['GET', GET],
    ['POST', POST],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
    ['HEAD', HEAD],
    ['OPTIONS', OPTIONS],
  ])('%s answers 404 JSON not_found', async (_verb, handler) => {
    const res = await handler()
    expect(res.status).toBe(404)
    // The handler always builds a real JSON body — a live server strips it
    // for an actual HEAD response, but that's the HTTP layer's job, not
    // ours; asserting it here proves every verb is wired the same way.
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})
