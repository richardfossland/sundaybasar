import { describe, expect, it } from 'vitest'
import { deadlineState, fmtCountdown, minNextBid } from '@/types/auction'
import type { AuctionItem } from '@/types/auction'

const at = (iso: string) => new Date(iso).getTime()

describe('deadlineState', () => {
  it('no deadline → nothing, never expired', () => {
    expect(deadlineState({ deadline: null }, at('2026-09-06T10:00:00Z'))).toEqual({ msLeft: null, expired: false })
  })
  it('clock not started (0) → unknown, not expired (no pre-hydration flash)', () => {
    expect(deadlineState({ deadline: '2020-01-01T00:00:00Z' }, 0)).toEqual({ msLeft: null, expired: false })
  })
  it('counts down and flips to expired at the deadline', () => {
    const dl = '2026-09-06T10:05:00Z'
    expect(deadlineState({ deadline: dl }, at('2026-09-06T10:03:30Z'))).toEqual({ msLeft: 90_000, expired: false })
    expect(deadlineState({ deadline: dl }, at('2026-09-06T10:05:00Z'))).toEqual({ msLeft: 0, expired: true })
    expect(deadlineState({ deadline: dl }, at('2026-09-06T10:06:00Z'))).toEqual({ msLeft: 0, expired: true })
  })
})

describe('fmtCountdown', () => {
  it('rounds up so the last second still reads 0:01', () => {
    expect(fmtCountdown(90_000)).toBe('1:30')
    expect(fmtCountdown(500)).toBe('0:01')
    expect(fmtCountdown(0)).toBe('0:00')
    expect(fmtCountdown(605_000)).toBe('10:05')
  })
})

describe('minNextBid', () => {
  const base = { start_price: 100, min_increment: 10, current_amount: null } as AuctionItem
  it('first bid = start price; then current + increment', () => {
    expect(minNextBid(base)).toBe(100)
    expect(minNextBid({ ...base, current_amount: 160 })).toBe(170)
  })
})
