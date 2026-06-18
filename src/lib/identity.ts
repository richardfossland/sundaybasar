// Per-device identity, held in localStorage. Two secrets exist:
//  • player secret — returned ONCE by join_session, required by player RPCs
//  • host secret  — returned ONCE by create_session, required by EVERY host
//    RPC (allocation, draws, settings). Stored per-session so one device can
//    host several basarer over time.

const K = {
  playerId: 'basar_player_id',
  sessionId: 'basar_session_id',
  secret: 'basar_secret',
  hostId: 'basar_host_id',
  hostSession: 'basar_host_session',
  deviceId: 'basar_device_id',
}

const hostSecretKey = (sessionId: string) => `basar_host_secret_${sessionId}`

export interface Identity {
  playerId: string | null
  sessionId: string | null
  secret: string | null
}

export function getIdentity(): Identity {
  if (typeof window === 'undefined') return { playerId: null, sessionId: null, secret: null }
  return {
    playerId: localStorage.getItem(K.playerId),
    sessionId: localStorage.getItem(K.sessionId),
    secret: localStorage.getItem(K.secret),
  }
}

export function setIdentity(playerId: string, sessionId: string, secret: string) {
  localStorage.setItem(K.playerId, playerId)
  localStorage.setItem(K.sessionId, sessionId)
  localStorage.setItem(K.secret, secret)
}

export function clearIdentity() {
  localStorage.removeItem(K.playerId)
  localStorage.removeItem(K.sessionId)
  localStorage.removeItem(K.secret)
}

/** Create-or-reuse a stable host id for this device (display/hand-off only). */
export function ensureHostId(): string {
  let id = localStorage.getItem(K.hostId)
  if (!id) {
    id = 'host_' + crypto.randomUUID()
    localStorage.setItem(K.hostId, id)
  }
  return id
}

/**
 * Stable per-device token sent to join_session. Lets the server dedup re-joins
 * (same device → resume the same player) so opening a new tab can't mint extra
 * free årer. Survives across tabs because localStorage is shared per origin.
 */
export function ensureDeviceId(): string {
  let id = localStorage.getItem(K.deviceId)
  if (!id) {
    id = 'dev_' + crypto.randomUUID()
    localStorage.setItem(K.deviceId, id)
  }
  return id
}

export function setHostSecret(sessionId: string, secret: string) {
  localStorage.setItem(hostSecretKey(sessionId), secret)
  localStorage.setItem(K.hostSession, sessionId)
}

export function getHostSecret(sessionId: string): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(hostSecretKey(sessionId))
}

/** The most recent session this device hosted (for "fortsett som vert"). */
export function getLastHostSession(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(K.hostSession)
}
