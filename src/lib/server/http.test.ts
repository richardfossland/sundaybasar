import { afterEach, describe, expect, it, vi } from 'vitest'

import { __bucketCount, __resetRateLimiter, clientIp, rateLimit } from '@/lib/server/http'

afterEach(() => {
  __resetRateLimiter()
  vi.useRealTimers()
})

describe('rateLimit', () => {
  it('allows up to the limit then blocks', () => {
    expect(rateLimit('k', 3, 60_000)).toBe(true)
    expect(rateLimit('k', 3, 60_000)).toBe(true)
    expect(rateLimit('k', 3, 60_000)).toBe(true)
    expect(rateLimit('k', 3, 60_000)).toBe(false)
  })

  it('resets after the window elapses', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    expect(rateLimit('k', 1, 1000)).toBe(true)
    expect(rateLimit('k', 1, 1000)).toBe(false)
    vi.setSystemTime(2000)
    expect(rateLimit('k', 1, 1000)).toBe(true)
  })

  it('tracks separate keys independently', () => {
    expect(rateLimit('a', 1, 60_000)).toBe(true)
    expect(rateLimit('b', 1, 60_000)).toBe(true)
    expect(rateLimit('a', 1, 60_000)).toBe(false)
    expect(rateLimit('b', 1, 60_000)).toBe(false)
  })

  it("self-bounds: a busy isolate's bucket map can't grow unbounded (sweeps expired)", () => {
    // Regression for Error 1102: high-cardinality keys (per-IP) would
    // otherwise accumulate forever. Seed > MAX_BUCKETS expiring keys, advance
    // past their window, then one more call must sweep them so the map stays
    // bounded.
    vi.useFakeTimers()
    vi.setSystemTime(0)
    for (let i = 0; i < 10_050; i++) rateLimit('leak:' + i, 1, 1000)
    expect(__bucketCount()).toBeGreaterThan(10_000)
    vi.setSystemTime(60_000) // everything has expired
    rateLimit('trigger', 1, 1000) // size > cap → sweep runs
    expect(__bucketCount()).toBeLessThanOrEqual(10_000)
  })
})

describe('clientIp', () => {
  it('prefers cf-connecting-ip when present', () => {
    const req = new Request('http://x', {
      headers: { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2, 3.3.3.3' },
    })
    expect(clientIp(req)).toBe('1.1.1.1')
  })

  it('falls back to the first hop of x-forwarded-for', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '2.2.2.2, 3.3.3.3' },
    })
    expect(clientIp(req)).toBe('2.2.2.2')
  })

  it('trims whitespace around the first forwarded-for hop', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '  2.2.2.2  , 3.3.3.3' },
    })
    expect(clientIp(req)).toBe('2.2.2.2')
  })

  it("falls back to 'local' with neither header", () => {
    const req = new Request('http://x')
    expect(clientIp(req)).toBe('local')
  })
})
