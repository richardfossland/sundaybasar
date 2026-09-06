/** The login surface itself — always reachable without a session. */
export const HOST_LOGIN_PATH = '/host/login'

/**
 * True for any `/host/<segment>...` path (create wizard, per-basar console,
 * projector, auction console) — these authenticate with the per-session
 * host_secret and must stay open to anonymous hosts. Only the bare `/host`
 * (or `/host/`) dashboard is the Sunday-gated surface. Pure so the routing
 * rule the middleware relies on is unit-tested.
 */
export function isCodeBasedHostRoute(path: string): boolean {
  if (path === HOST_LOGIN_PATH || path.startsWith(`${HOST_LOGIN_PATH}/`)) return false
  const rest = path.replace(/^\/host\/?/, '')
  return rest.length > 0
}

/** Paths the SSO middleware must never gate or even consult the issuer for. */
export function isOpenHostPath(path: string): boolean {
  return path.startsWith('/auth/') || isCodeBasedHostRoute(path)
}
