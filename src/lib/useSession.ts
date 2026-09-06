'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createCoalescer } from '@/lib/coalesce'
import { syntheticPool } from '@/lib/drawReel'
import type { GameEvent, Lot, Player, Prize, RevealedDraw, Session } from '@/types/game'

/** Which lots a screen needs. 'all' = every lot in the session (host panel,
 * projector). { playerId } = only that player's lots plus a light pool summary
 * (count + highest number) for the reel decoys. 'none' = nothing yet (identity
 * not resolved on this device). */
export type LotsScope = 'all' | 'none' | { playerId: string }

export interface SessionScope {
  /** Fetch + follow the players list. Only the host panel renders it. */
  players?: boolean
  lots?: LotsScope
}

/** One fetch per burst of change notifications (see lib/coalesce.ts). */
const COALESCE_MS = 400

/** Event types after which the lots table has changed. `lots_allocated` is
 * ONE row per allocation (vs. N `lots` rows), which is the whole point. */
const LOT_EVENTS = new Set(['lots_allocated', 'allocation_revoked', 'round_started', 'draw_revealed'])
const DRAW_EVENTS = new Set(['draw_revealed', 'draw_voided', 'session_ended'])

/**
 * Shared live-session state for host panel, projector and player view.
 *
 * Realtime is a HINT layer here, and it is scoped and coalesced on purpose:
 *
 *   • The `lots` table is NOT subscribed to. Allocating five årer inserts five
 *     rows, so every phone in the room used to refetch the entire lots table
 *     five times per allocation — with 100 players that is ~10⁶ rows served per
 *     host tap, and a whole evening blows through the Supabase egress budget.
 *     Instead we follow the public `events` feed (one `lots_allocated` row per
 *     allocation) and refetch lots once per event, coalesced.
 *   • A player's phone fetches only ITS OWN lots, plus a count + highest number
 *     for the reel decoys — never everyone's årer.
 *   • The players list is fetched only where it is rendered (host panel).
 *   • Table refetches are coalesced (400 ms) so a burst becomes one query.
 *
 * Plus a full refetch on (re)subscribe and on tab re-focus, so a dropped
 * websocket can never leave a screen stuck on stale state mid-basar.
 */
export function useSession(sessionId: string, scope: SessionScope = {}) {
  const wantPlayers = scope.players ?? true
  const lotsScope: LotsScope = scope.lots ?? 'all'
  const lotsKey = typeof lotsScope === 'string' ? lotsScope : `player:${lotsScope.playerId}`

  const supabase = useMemo(() => createClient(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [lots, setLots] = useState<Lot[]>([])
  const [prizes, setPrizes] = useState<Prize[]>([])
  const [revealedDraws, setRevealedDraws] = useState<RevealedDraw[]>([])
  const [lastEvent, setLastEvent] = useState<GameEvent | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  // Player scope only: how many lots are in this round's pot and the highest
  // number handed out — enough to fake a plausible reel without the table.
  const [poolCount, setPoolCount] = useState(0)
  const [poolMax, setPoolMax] = useState(0)

  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const lotsScopeRef = useRef(lotsScope)
  lotsScopeRef.current = lotsScope
  const wantPlayersRef = useRef(wantPlayers)
  wantPlayersRef.current = wantPlayers

  const fetchPlayers = useCallback(async () => {
    if (!wantPlayersRef.current) return
    const { data } = await supabase
      .from('players')
      .select('*')
      .eq('session_id', sessionIdRef.current)
      .order('created_at')
    if (data) setPlayers(data as Player[])
  }, [supabase])

  const fetchPrizes = useCallback(async () => {
    const { data } = await supabase
      .from('prizes')
      .select('*')
      .eq('session_id', sessionIdRef.current)
      .order('position')
    if (data) setPrizes(data as Prize[])
  }, [supabase])

  const fetchDraws = useCallback(async () => {
    const { data } = await supabase.rpc('get_revealed_draws', { p_session_id: sessionIdRef.current })
    if (data) setRevealedDraws(data as RevealedDraw[])
  }, [supabase])

  const fetchLots = useCallback(async () => {
    const sid = sessionIdRef.current
    const sc = lotsScopeRef.current
    if (sc === 'none') return
    if (sc === 'all') {
      const { data } = await supabase.from('lots').select('*').eq('session_id', sid).order('number')
      if (data) setLots(data as Lot[])
      return
    }
    // Player scope: own lots + pool summary for the CURRENT round. The round is
    // read fresh (not from the session ref) because a `round_started` event can
    // arrive before the sessions UPDATE that carries the new round number.
    const { data: s } = await supabase.from('sessions').select('current_round').eq('id', sid).maybeSingle()
    const round = (s as { current_round: number } | null)?.current_round ?? null
    const [mine, cnt, mx] = await Promise.all([
      supabase.from('lots').select('*').eq('session_id', sid).eq('player_id', sc.playerId).order('number'),
      round == null
        ? null
        : supabase
            .from('lots')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', sid)
            .eq('round', round)
            .eq('removed', false),
      round == null
        ? null
        : supabase
            .from('lots')
            .select('number')
            .eq('session_id', sid)
            .eq('round', round)
            .order('number', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ])
    if (mine.data) setLots(mine.data as Lot[])
    if (cnt && cnt.count != null) setPoolCount(cnt.count)
    if (mx) setPoolMax((mx.data as { number: number } | null)?.number ?? 0)
  }, [supabase])

  const refresh = useCallback(async () => {
    const sid = sessionIdRef.current
    const s = await supabase.from('sessions').select('*').eq('id', sid).maybeSingle()
    if (!s.error) {
      if (!s.data) setMissing(true)
      else {
        setMissing(false)
        setSession(s.data as Session)
      }
    }
    await Promise.all([fetchPlayers(), fetchLots(), fetchPrizes(), fetchDraws()])
    setLoaded(true)
  }, [supabase, fetchPlayers, fetchLots, fetchPrizes, fetchDraws])

  useEffect(() => {
    refresh()
    const playersC = createCoalescer(() => void fetchPlayers(), COALESCE_MS)
    const prizesC = createCoalescer(() => void fetchPrizes(), COALESCE_MS)
    const lotsC = createCoalescer(() => void fetchLots(), COALESCE_MS)
    const drawsC = createCoalescer(() => void fetchDraws(), COALESCE_MS)

    let ch = supabase
      .channel(`basar-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'basar', table: 'sessions', filter: `id=eq.${sessionId}` },
        (p) => {
          // The host deleted the basar from the dashboard while this screen was
          // open: p.new is {} on DELETE — never render it as a session.
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
        { event: '*', schema: 'basar', table: 'prizes', filter: `session_id=eq.${sessionId}` },
        () => prizesC.trigger()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'basar', table: 'events', filter: `session_id=eq.${sessionId}` },
        (p) => {
          const ev = p.new as GameEvent
          setLastEvent(ev)
          if (LOT_EVENTS.has(ev.type)) lotsC.trigger()
          if (DRAW_EVENTS.has(ev.type)) drawsC.trigger()
        }
      )
    if (wantPlayers) {
      ch = ch.on(
        'postgres_changes',
        { event: '*', schema: 'basar', table: 'players', filter: `session_id=eq.${sessionId}` },
        () => playersC.trigger()
      )
    }
    ch.subscribe()

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      playersC.cancel()
      prizesC.cancel()
      lotsC.cancel()
      drawsC.cancel()
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // lotsKey stands in for the (object) lots scope so a resolved playerId
    // re-runs the effect exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, sessionId, wantPlayers, lotsKey, refresh])

  // Numbers the reel may show as decoys: the real pot when we hold every lot,
  // otherwise a synthetic pool seeded with the player's own numbers.
  const poolNumbers = useMemo(() => {
    if (!session) return []
    if (lotsScope === 'all')
      return lots.filter((l) => l.round === session.current_round && !l.removed).map((l) => l.number)
    if (lotsScope === 'none') return []
    const mine = lots.filter((l) => l.round === session.current_round && !l.removed).map((l) => l.number)
    return syntheticPool(poolCount, poolMax, mine)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, lots, lotsKey, poolCount, poolMax])

  return {
    supabase,
    session,
    players,
    lots,
    prizes,
    revealedDraws,
    lastEvent,
    loaded,
    missing,
    refresh,
    poolNumbers,
  }
}
