import { describe, expect, it } from 'vitest'
import { isCodeBasedHostRoute, isOpenHostPath } from '@/lib/hostRoutes'

// The middleware's routing rule: everything under /host/<x> is code-based
// (anonymous hosting must never depend on the Sunday Account issuer); only the
// bare dashboard and the login page involve SSO.
describe('isCodeBasedHostRoute', () => {
  it.each([
    '/host/new',
    '/host/auksjon/new',
    '/host/11111111-1111-1111-1111-111111111111',
    '/host/11111111-1111-1111-1111-111111111111/projector',
    '/host/auksjon/11111111-1111-1111-1111-111111111111',
    '/host/auksjon/11111111-1111-1111-1111-111111111111/projector',
  ])('%s is code-based (open)', (p) => {
    expect(isCodeBasedHostRoute(p)).toBe(true)
  })

  it.each(['/host', '/host/', '/host/login', '/host/login/'])('%s is SSO territory', (p) => {
    expect(isCodeBasedHostRoute(p)).toBe(false)
  })
})

describe('isOpenHostPath', () => {
  it('the auth callback is always open', () => {
    expect(isOpenHostPath('/auth/callback')).toBe(true)
  })
  it('the dashboard and login are not "open" (the middleware handles them)', () => {
    expect(isOpenHostPath('/host')).toBe(false)
    expect(isOpenHostPath('/host/login')).toBe(false)
  })
})
