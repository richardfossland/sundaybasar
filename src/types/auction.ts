// Auction module types — mirrors the jsonb returned by get_auction_state /
// get_settlements (migration 0010). reserve_price and proxy maxima are NEVER
// sent to the client; only the booleans has_reserve / reserve_met are exposed.

export type AuctionCategory = 'tjeneste' | 'gjenstand' | 'opplevelse' | 'mystery'
export type AuctionFormat = 'live' | 'stille' | 'hollandsk'
export type AuctionItemStatus = 'draft' | 'active' | 'sold' | 'passed'

export interface AuctionItem {
  id: string
  position: number
  title: string
  description: string | null
  image_url: string | null
  category: AuctionCategory
  format: AuctionFormat
  donor_name: string | null
  start_price: number
  min_increment: number
  buy_now_price: number | null
  deadline: string | null
  status: AuctionItemStatus
  current_amount: number | null
  current_leader_player_id: string | null
  leader_name: string | null
  has_reserve: boolean
  reserve_met: boolean
  winner_player_id: string | null
  winner_name: string | null
  winning_amount: number | null
}

/** Shape returned by get_auction_state(p_session_id). */
export interface AuctionState {
  ok: boolean
  goal_amount: number | null
  raised_total: number
  items: AuctionItem[]
}

/** Shape returned by get_settlements(p_session_id, p_host_secret).settlements[]. */
export interface AuctionSettlement {
  settlement_id: string
  item_id: string
  item_title: string
  player_id: string | null
  player_name: string | null
  amount: number
  method: string
  paid: boolean
  paid_at: string | null
  created_at: string
}

export const CATEGORY_LABELS: Record<AuctionCategory, string> = {
  tjeneste: 'Tjeneste',
  gjenstand: 'Gjenstand',
  opplevelse: 'Opplevelse',
  mystery: 'Mystery',
}

export const CATEGORY_EMOJI: Record<AuctionCategory, string> = {
  tjeneste: '🙌',
  gjenstand: '🎁',
  opplevelse: '🎟️',
  mystery: '❓',
}

export const FORMAT_LABELS: Record<AuctionFormat, string> = {
  live: 'Live',
  stille: 'Stille',
  hollandsk: 'Hollandsk',
}

/** Norwegian kroner formatting, integer-rounded. */
export const kr = (n: number | null | undefined) => `${Math.round(Number(n ?? 0))} kr`

/** The minimum acceptable next bid for an item (matches place_bid's rule). */
export function minNextBid(item: AuctionItem): number {
  return item.current_amount != null
    ? Number(item.current_amount) + Number(item.min_increment)
    : Number(item.start_price)
}
