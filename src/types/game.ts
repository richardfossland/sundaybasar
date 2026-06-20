export type Tildeling = 'kjop' | 'gratis'
export type Trekning = 'klassisk' | 'vinner_ut' | 'runder'
export type DrawState = 'idle' | 'spinning' | 'revealed'

export interface Session {
  id: string
  code: string
  host_id: string
  phase: 'open' | 'ended'
  tildeling: Tildeling
  trekning: Trekning
  vipps_number: string | null
  vipps_link: string | null
  price_per_lodd: number
  gratis_lodd: number
  current_round: number
  current_prize_id: string | null
  current_draw_id: string | null
  draw_state: DrawState
  player_count: number
  created_at: string
  /** 'basar' (default) or 'auksjon' — auction module (migration 0006). */
  kind?: 'basar' | 'auksjon'
  /** Auction fundraising goal for the thermometer (migration 0006). */
  goal_amount?: number | null
}

export interface Player {
  id: string
  session_id: string
  name: string
  is_offline: boolean
  is_online: boolean
  created_at: string
  /** Bid/paddle number for live auction (migration 0006). */
  paddle_number?: number | null
}

export interface Lot {
  id: string
  session_id: string
  round: number
  number: number
  player_id: string
  allocation_id: string
  removed: boolean
}

export interface Allocation {
  id: string
  session_id: string
  player_id: string
  round: number
  count: number
  from_number: number
  to_number: number
  kind: 'kjop' | 'gratis_auto' | 'ekstra'
  revoked: boolean
  created_at: string
}

export interface Prize {
  id: string
  session_id: string
  name: string
  description: string | null
  position: number
  /** Optional public Supabase Storage URL of a prize photo (migration 0002). */
  image_url?: string | null
}

export interface GameEvent {
  id: string
  session_id: string
  type: string
  payload: Record<string, unknown>
  created_at: string
}

/** Shape returned by get_revealed_draws / the draw_revealed event payload. */
export interface RevealedDraw {
  draw_id: string
  prize_id: string
  prize_name: string
  /** Optional prize photo URL (migration 0002); absent on older deployments. */
  prize_image_url?: string | null
  round: number
  lot_number: number
  player_id: string | null
  player_name: string
  voided?: boolean
  void_reason?: string | null
  revealed_at?: string
}

export interface DrawLogEntry extends RevealedDraw {
  revealed: boolean
  created_at: string
}

export const TREKNING_LABELS: Record<Trekning, string> = {
  klassisk: 'Klassisk',
  vinner_ut: 'Vinner tas ut',
  runder: 'Runde-basert',
}

export const TILDELING_LABELS: Record<Tildeling, string> = {
  kjop: 'Kjøp med Vipps',
  gratis: 'Gratis lodd',
}
