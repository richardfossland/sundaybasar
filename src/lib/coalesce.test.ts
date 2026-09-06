import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoalescer } from '@/lib/coalesce'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createCoalescer', () => {
  it('collapses a burst of triggers into one call after the window', () => {
    const fn = vi.fn()
    const c = createCoalescer(fn, 400)
    for (let i = 0; i < 5; i++) {
      c.trigger()
      vi.advanceTimersByTime(20)
    }
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(399)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a trigger after the window runs again (trailing edge, not throttle)', () => {
    const fn = vi.fn()
    const c = createCoalescer(fn, 100)
    c.trigger()
    vi.advanceTimersByTime(100)
    c.trigger()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel drops the pending call', () => {
    const fn = vi.fn()
    const c = createCoalescer(fn, 100)
    c.trigger()
    c.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('flush runs a pending call immediately and only once', () => {
    const fn = vi.fn()
    const c = createCoalescer(fn, 100)
    c.trigger()
    c.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    c.flush() // nothing pending → no-op
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
