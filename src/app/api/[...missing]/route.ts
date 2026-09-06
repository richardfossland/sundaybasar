import { fail } from '@/lib/server/http'

// Blanket JSON 404 for any /api/* path that no real route matches.
//
// WHY THIS EXISTS (two separate problems, one fix):
//
// 1. CPU. Without it, an unknown `/api/...` fell through to the App Router's
//    not-found page — a full React SSR render of `app/not-found.tsx`. Scanners
//    and stale clients hit these paths constantly; this handler answers with
//    zero rendering.
//
// 2. Client error classification. Client code that reads the failure code
//    from the JSON body (`{ ok: false, error }`) would otherwise get an HTML
//    body — `res.json()` throws, the caller falls back to a generic error, and
//    a typo'd endpoint looks exactly like a real API failure. A JSON 404 keeps
//    the contract intact.
//
// Static and dynamic segments always win over a catch-all, so every existing
// `/api/*` route (e.g. `/api/host/basars`, `/api/host/basars/claim`) still
// resolves; only genuinely unmatched paths land here. (`/api` itself has no
// segment to catch and is not matched — no client ever calls it.)
function notFound(): Response {
  return fail(404, 'not_found')
}

export const GET = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound
export const HEAD = notFound
export const OPTIONS = notFound
