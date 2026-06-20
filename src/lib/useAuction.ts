'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Session } from '@/types/game'
import type { AuctionItem, AuctionState } from '@/types/auction'

/**
 * Live auction state for the host console, projector and bidder view — the
 * auction analogue of useSession. Realtime postgres_changes on the published
 * auction tables + a full refetch on (re)subscribe and tab re-focus, so a
 * dropped websocket never leaves a screen stuck mid-auction.
 *
 * The aggregate read is get_auction_state (NEVER exposes reserve_price or the
 * hidden proxy maxima — auction_proxy_maxes is not even in the publication).
 * `tick` increments on every realtime change so host-only views (settlements)
 * can re-fetch their own data.
 */
export function useAuction(sessionId: string) {
  const supabase = useMemo(() => createClient(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [items, setItems] = useState<AuctionItem[]>([])
  const [goalAmount, setGoalAmount] = useState<number | null>(null)
  const [raisedTotal, setRaisedTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  const [tick, setTick] = useState(0)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const refresh = useCallback(async () => {
    const sid = sessionIdRef.current
    const [s, st] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sid).maybeSingle(),
      supabase.rpc('get_auction_state', { p_session_id: sid }),
    ])
    if (!s.error) {
      if (!s.data) setMissing(true)
      else setSession(s.data as Session)
    }
    if (st.data && (st.data as AuctionState).ok) {
      const state = st.data as AuctionState
      setItems(state.items ?? [])
      setGoalAmount(state.goal_amount)
      setRaisedTotal(Number(state.raised_total ?? 0))
    }
    setLoaded(true)
  }, [supabase])

  useEffect(() => {
    refresh()
    // auction_bids / auction_settlements have no session_id column, so we
    // subscribe broadly and let the per-session refetch (get_auction_state) do
    // the scoping. auction_proxy_maxes is intentionally never subscribed.
    const bump = () => {
      refresh()
      setTick((t) => t + 1)
    }
    const ch = supabase
      .channel(`basar-auction-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'basar', table: 'sessions', filter: `id=eq.${sessionId}` },
        (p) => setSession(p.new as Session)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'basar', table: 'auction_items', filter: `session_id=eq.${sessionId}` },
        bump
      )
      .on('postgres_changes', { event: '*', schema: 'basar', table: 'auction_bids' }, bump)
      .on('postgres_changes', { event: '*', schema: 'basar', table: 'auction_settlements' }, bump)
      .subscribe()

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [supabase, sessionId, refresh])

  return { supabase, session, items, goalAmount, raisedTotal, loaded, missing, refresh, tick }
}
