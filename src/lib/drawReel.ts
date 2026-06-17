// ── SundayBasar — draw-reel math (pure, framework-free, unit-tested) ─────────
//
// CRITICAL TRUST BOUNDARY: none of this code decides a winner. The winning
// lot_number is chosen SERVER-SIDE inside basar.start_draw (order by
// gen_random_uuid()) and stays locked in the append-only `draws` table until
// reveal_draw publishes it. This module only *theatricalizes* an
// already-decided number: it lays out a strip of decoy numbers that ends on
// the real winner and computes an eased deceleration so the reel visibly
// "lands" on that winner. Feeding it a different winner cannot change who the
// server recorded — it only changes a pixel animation.

/** Easing for the landing decel: ease-out cubic (fast → slow → stop). */
export function easeOutCubic(t: number): number {
  const c = clamp01(t)
  return 1 - Math.pow(1 - c, 3)
}

export function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0
  if (t < 0) return 0
  if (t > 1) return 1
  return t
}

/**
 * Build the strip of numbers the reel scrolls through while landing, ending
 * EXACTLY on `winner` (the server-decided lot number). `pool` is the visible
 * candidate set (this round's un-removed lots); it is used only as decoy
 * filler so the strip looks like real lot numbers. `length` is the total
 * cell count (>= 1). The winner is always the last cell — the reel lands
 * there — so the outcome is structurally pinned to the server's choice.
 *
 * Deterministic given `rand` (defaults to Math.random) so it is unit-testable
 * and so a reduced-motion / SSR render is stable.
 */
export function buildReelStrip(
  winner: number,
  pool: number[],
  length: number,
  rand: () => number = Math.random
): number[] {
  const n = Math.max(1, Math.floor(length))
  // Decoy source: the pool minus the winner (so the winner only appears at the
  // intended landing cell when possible). Fall back to the winner itself if
  // the pool is empty/degenerate.
  const decoys = pool.filter((x) => x !== winner)
  const strip: number[] = []
  for (let i = 0; i < n - 1; i++) {
    if (decoys.length > 0) {
      strip.push(decoys[Math.floor(clamp01(rand()) * decoys.length) % decoys.length])
    } else {
      // No distinct decoys — show the winner as filler too (visually fine).
      strip.push(winner)
    }
  }
  strip.push(winner)
  return strip
}

/**
 * Given elapsed ms into the landing animation and its total duration, return
 * the index into the reel strip the viewport should currently show. Eased so
 * it sweeps quickly then crawls to a stop on the final cell (the winner).
 * Always returns a valid index in [0, stripLength-1]; at/after `durationMs`
 * it returns the last index (the winner) so the reel never overshoots.
 */
export function reelIndexAt(
  elapsedMs: number,
  durationMs: number,
  stripLength: number
): number {
  const len = Math.max(1, Math.floor(stripLength))
  if (len === 1) return 0
  if (durationMs <= 0) return len - 1
  const progress = easeOutCubic(elapsedMs / durationMs)
  const idx = Math.round(progress * (len - 1))
  return Math.min(len - 1, Math.max(0, idx))
}

/** How long the landing decel runs, in ms. Kept here so UI + tests agree. */
export const REEL_LAND_MS = 2600
/** Cells in the landing strip. More cells = longer visual roll-down. */
export const REEL_STRIP_LENGTH = 28
/** Blind-spin tick interval (ms) while the server draw is in `spinning`. */
export const REEL_SPIN_TICK_MS = 80
