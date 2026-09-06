import 'server-only'

/** Tiny JSON response helpers for the host API routes (uniform shapes). */

export function ok(body: Record<string, unknown> = {}): Response {
  return Response.json({ ok: true, ...body })
}

export function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status })
}

/** Parse a JSON request body, returning null on any error (never throws). */
export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

// ---------- naive in-memory rate limiter ----------
// Per-process, best-effort — good enough to cap an unauthenticated route
// (`/api/health?db=1`) at a sane request rate; not a substitute for real
// abuse defenses.
//
// SELF-BOUNDING (critical on Cloudflare Workers): a busy isolate lives for a
// long time and background timers never run between requests, so without
// eviction this Map would grow forever → memory pressure → Error 1102.
// Eviction happens ON ACCESS instead: once the map gets large we sweep
// expired entries (and, as a last resort, drop the soonest-expiring) so it
// can never approach the cap.
const buckets = new Map<string, { count: number; resetAt: number }>()
const MAX_BUCKETS = 10_000

function sweep(now: number): void {
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k)
  if (buckets.size > MAX_BUCKETS) {
    const live = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    const drop = buckets.size - MAX_BUCKETS
    for (let i = 0; i < drop; i++) buckets.delete(live[i][0])
  }
}

/** true if `key` is still under `limit` calls per `windowMs`; false once over. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  if (buckets.size > MAX_BUCKETS) sweep(now)
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= limit) return false
  b.count++
  return true
}

/** Test-only: reset limiter state between tests. */
export function __resetRateLimiter(): void {
  buckets.clear()
}

/** Test-only: current number of tracked buckets. */
export function __bucketCount(): number {
  return buckets.size
}

/**
 * Best-effort client IP for rate-limit keys. Prefers Cloudflare's
 * `cf-connecting-ip` (set by the edge, not spoofable by the client on a
 * request that actually reaches the Worker); falls back to the first hop of
 * `x-forwarded-for` for local dev / non-Cloudflare front doors.
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const fwd = req.headers.get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || 'local'
}
