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
