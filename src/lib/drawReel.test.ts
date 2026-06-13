import { describe, expect, it } from 'vitest'
import {
  buildReelStrip,
  clamp01,
  easeOutCubic,
  REEL_LAND_MS,
  REEL_STRIP_LENGTH,
  reelIndexAt,
} from './drawReel'

describe('clamp01', () => {
  it('clamps to [0,1] and handles NaN', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(NaN)).toBe(0)
  })
})

describe('easeOutCubic', () => {
  it('starts at 0, ends at 1, monotonic, decelerating', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 3)
    // decelerates: first half covers more ground than second half
    const firstHalf = easeOutCubic(0.5) - easeOutCubic(0)
    const secondHalf = easeOutCubic(1) - easeOutCubic(0.5)
    expect(firstHalf).toBeGreaterThan(secondHalf)
  })
  it('clamps out-of-range input', () => {
    expect(easeOutCubic(-5)).toBe(0)
    expect(easeOutCubic(5)).toBe(1)
  })
})

describe('buildReelStrip — the trust-critical guarantee', () => {
  const pool = [1, 2, 3, 4, 5, 6, 7, 8]

  it('ALWAYS ends on the server-decided winner', () => {
    for (const winner of pool) {
      const strip = buildReelStrip(winner, pool, REEL_STRIP_LENGTH)
      expect(strip[strip.length - 1]).toBe(winner)
    }
  })

  it('has the requested length (at least 1)', () => {
    expect(buildReelStrip(3, pool, 28)).toHaveLength(28)
    expect(buildReelStrip(3, pool, 1)).toHaveLength(1)
    expect(buildReelStrip(3, pool, 0)).toHaveLength(1)
    expect(buildReelStrip(3, pool, -5)).toHaveLength(1)
  })

  it('uses pool numbers (minus winner) as decoys, never invents numbers', () => {
    const winner = 4
    const strip = buildReelStrip(winner, pool, 50)
    const allowed = new Set(pool) // pool already contains winner
    for (const cell of strip) expect(allowed.has(cell)).toBe(true)
  })

  it('decoys exclude the winner except at the landing cell when distinct decoys exist', () => {
    const winner = 4
    const strip = buildReelStrip(winner, pool, 40)
    const winnerCells = strip.filter((c) => c === winner)
    // Only the final landing cell should be the winner.
    expect(winnerCells).toHaveLength(1)
    expect(strip[strip.length - 1]).toBe(winner)
  })

  it('falls back to winner-only filler when pool has no distinct decoys', () => {
    const strip = buildReelStrip(7, [7], 5)
    expect(strip).toHaveLength(5)
    expect(strip.every((c) => c === 7)).toBe(true)
  })

  it('handles an empty pool by landing on the winner anyway', () => {
    const strip = buildReelStrip(99, [], 4)
    expect(strip[strip.length - 1]).toBe(99)
    expect(strip.every((c) => c === 99)).toBe(true)
  })

  it('is deterministic given a seeded rand', () => {
    let seed = 0.123
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
    const a = buildReelStrip(5, pool, 30, rand)
    seed = 0.123
    const b = buildReelStrip(5, pool, 30, rand)
    expect(a).toEqual(b)
  })
})

describe('reelIndexAt — lands on the winner cell, never overshoots', () => {
  const len = REEL_STRIP_LENGTH

  it('starts at 0 and ends on the last (winner) index', () => {
    expect(reelIndexAt(0, REEL_LAND_MS, len)).toBe(0)
    expect(reelIndexAt(REEL_LAND_MS, REEL_LAND_MS, len)).toBe(len - 1)
  })

  it('clamps past the end to the winner index (no overshoot)', () => {
    expect(reelIndexAt(REEL_LAND_MS * 5, REEL_LAND_MS, len)).toBe(len - 1)
  })

  it('is monotonic non-decreasing over time', () => {
    let prev = -1
    for (let t = 0; t <= REEL_LAND_MS; t += 50) {
      const idx = reelIndexAt(t, REEL_LAND_MS, len)
      expect(idx).toBeGreaterThanOrEqual(prev)
      prev = idx
    }
  })

  it('decelerates: covers more cells early than late', () => {
    const quarter = reelIndexAt(REEL_LAND_MS * 0.25, REEL_LAND_MS, len)
    const half = reelIndexAt(REEL_LAND_MS * 0.5, REEL_LAND_MS, len)
    const earlyGain = quarter - 0
    const lateGain = (len - 1) - half
    expect(earlyGain).toBeGreaterThan(lateGain)
  })

  it('degenerate cases stay in-bounds', () => {
    expect(reelIndexAt(100, REEL_LAND_MS, 1)).toBe(0)
    expect(reelIndexAt(100, 0, len)).toBe(len - 1)
    expect(reelIndexAt(-100, REEL_LAND_MS, len)).toBe(0)
  })
})
