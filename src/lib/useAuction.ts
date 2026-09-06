'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createCoalescer } from '@/lib/coalesce'
import type { Session } from '@/types/game'
import type { AuctionItem, AuctionState } from '@/types/auction'

/** One fetch per burst of change notifications (see lib/coalesce.ts). */
const COALESCE_MS = 400

/**
 * Live auction state for the host console, projector and bidder view — the
 * auction analogue of useSession. Realtime postgres_changes on the session row
 * and on THIS session's auction_items, coalesced into one get_auction_state
 * refetch per burst, plus a full refetch on (re)subscribe and tab re-focus.
 *
 * auction_bids / auction_settlements are deliberately NOT subscribed to: they
 * carry no session_id, so the only possible subscription was an unfiltered one
 * that fired for every bid in every auction anywhere — and every bid already
 * updates auction_items (price/leader) and every sale updates its status, so
 * the filtered items subscription sees everything a screen needs. The host's
 * oppgjør tab reloads settlements on its own actions and on `tick`.
 *
 * get_auction_state NEVER exposes reserve_price or the hidden proxy maxima
 * (auction_proxy_maxes is not even in the publication).
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
      else {
        setMissing(false)
        setSession(s.data as Session)
      }
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
    const bump = createCoalescer(() => {
      void refresh()
      setTick((t) => t + 1)
    }, COALESCE_MS)
    const ch = supabase
      .channel(`basar-auction-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'basar', table: 'sessions', filter: `id=eq.${sessionId}` },
        (p) => {
          if (p.eventType === 'DELETE') {
            setSession(null)
            setMissing(true)
            return
          }
          setSession(p.new as Session)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'basar', table: 'auction_items', filter: `session_id=eq.${sessionId}` },
        () => bump.trigger()
      )
      .subscribe()

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      bump.cancel()
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [supabase, sessionId, refresh])

  return { supabase, session, items, goalAmount, raisedTotal, loaded, missing, refresh, tick }
}
