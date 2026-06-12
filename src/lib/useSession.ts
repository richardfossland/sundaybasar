'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { GameEvent, Lot, Player, Prize, RevealedDraw, Session } from '@/types/game'

/**
 * Shared live-session state for host panel, projector and player view.
 * Realtime postgres_changes on the five public tables + a full refetch on
 * (re)subscribe and tab re-focus, so a dropped websocket can never leave a
 * screen stuck on stale state mid-basar.
 */
export function useSession(sessionId: string) {
  const supabase = useMemo(() => createClient(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [lots, setLots] = useState<Lot[]>([])
  const [prizes, setPrizes] = useState<Prize[]>([])
  const [revealedDraws, setRevealedDraws] = useState<RevealedDraw[]>([])
  const [lastEvent, setLastEvent] = useState<GameEvent | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const refresh = useCallback(async () => {
    const sid = sessionIdRef.current
    const [s, p, l, pr, rd] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sid).maybeSingle(),
      supabase.from('players').select('*').eq('session_id', sid).order('created_at'),
      supabase.from('lots').select('*').eq('session_id', sid).order('number'),
      supabase.from('prizes').select('*').eq('session_id', sid).order('position'),
      supabase.rpc('get_revealed_draws', { p_session_id: sid }),
    ])
    if (!s.error) {
      if (!s.data) setMissing(true)
      else setSession(s.data as Session)
    }
    if (p.data) setPlayers(p.data as Player[])
    if (l.data) setLots(l.data as Lot[])
    if (pr.data) setPrizes(pr.data as Prize[])
    if (rd.data) setRevealedDraws(rd.data as RevealedDraw[])
    setLoaded(true)
  }, [supabase])

  useEffect(() => {
    refresh()
    const opts = (table: string, extra?: object) => ({
      event: '*' as const,
      schema: 'basar',
      table,
      filter: `session_id=eq.${sessionId}`,
      ...extra,
    })
    const ch = supabase
      .channel(`basar-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'basar', table: 'sessions', filter: `id=eq.${sessionId}` },
        (p) => setSession(p.new as Session)
      )
      .on('postgres_changes', opts('players'), () => {
        supabase.from('players').select('*').eq('session_id', sessionId).order('created_at')
          .then(({ data }) => data && setPlayers(data as Player[]))
      })
      .on('postgres_changes', opts('lots'), () => {
        supabase.from('lots').select('*').eq('session_id', sessionId).order('number')
          .then(({ data }) => data && setLots(data as Lot[]))
      })
      .on('postgres_changes', opts('prizes'), () => {
        supabase.from('prizes').select('*').eq('session_id', sessionId).order('position')
          .then(({ data }) => data && setPrizes(data as Prize[]))
      })
      .on('postgres_changes', { ...opts('events'), event: 'INSERT' }, (p) => {
        const ev = p.new as GameEvent
        setLastEvent(ev)
        if (ev.type === 'draw_revealed' || ev.type === 'draw_voided' || ev.type === 'session_ended') {
          supabase.rpc('get_revealed_draws', { p_session_id: sessionId })
            .then(({ data }) => data && setRevealedDraws(data as RevealedDraw[]))
        }
      })
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

  return { supabase, session, players, lots, prizes, revealedDraws, lastEvent, loaded, missing, refresh }
}
