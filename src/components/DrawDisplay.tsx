'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RevealedDraw, Session } from '@/types/game'
import {
  buildReelStrip,
  REEL_LAND_MS,
  REEL_SPIN_TICK_MS,
  REEL_STRIP_LENGTH,
  reelIndexAt,
} from '@/lib/drawReel'
import { isMuted, playFanfare, playLanding, playTick } from '@/lib/drawSound'

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * The spectacle. Two phases, both driven entirely by SERVER state:
 *   • `spinning` — the server has already chosen the winner (locked in the
 *     `draws` table) but has NOT revealed it. The reel rolls through blind
 *     decoy numbers; the client genuinely does not know the winner yet.
 *   • `revealed` — `reveal.lot_number` (the server's choice, published by
 *     reveal_draw) arrives. The reel decelerates and LANDS exactly on that
 *     number, then the winner card pops. The animation only theatricalizes an
 *     already-decided outcome; it can never change who won.
 *
 * `sound` enables synthesized Web Audio SFX (the projector arms the context on
 * a host gesture). Honors prefers-reduced-motion (no roll; jumps to result).
 */
export function DrawReel({
  poolNumbers,
  reveal,
  big,
  sound,
  onLanded,
}: {
  poolNumbers: number[]
  reveal: RevealedDraw | null
  big?: boolean
  sound?: boolean
  onLanded?: () => void
}) {
  const reduced = usePrefersReducedMotion()
  const winner = reveal?.lot_number ?? null
  const [display, setDisplay] = useState<number | null>(null)
  const [landed, setLanded] = useState(false)

  // ── Phase 1: blind spin (no winner published yet) ──────────────────────────
  useEffect(() => {
    if (winner !== null) return // landing phase takes over
    setLanded(false)
    if (reduced || poolNumbers.length === 0) {
      setDisplay(null)
      return
    }
    const tick = () => {
      setDisplay(poolNumbers[Math.floor(Math.random() * poolNumbers.length)])
      if (sound && !isMuted()) playTick()
    }
    tick()
    const iv = setInterval(tick, REEL_SPIN_TICK_MS)
    return () => clearInterval(iv)
  }, [winner, poolNumbers, reduced, sound])

  // ── Phase 2: landing — decelerate onto the server-decided winner ────────────
  useEffect(() => {
    if (winner === null) return
    setLanded(false)

    if (reduced) {
      // Reduced motion: skip the roll, show the result immediately.
      setDisplay(winner)
      setLanded(true)
      onLanded?.()
      return
    }

    const strip = buildReelStrip(winner, poolNumbers, REEL_STRIP_LENGTH)
    if (sound && !isMuted()) playLanding(REEL_LAND_MS)
    const start = performance.now()
    let raf = 0
    let lastIdx = -1
    const step = (now: number) => {
      const elapsed = now - start
      const idx = reelIndexAt(elapsed, REEL_LAND_MS, strip.length)
      if (idx !== lastIdx) {
        setDisplay(strip[idx])
        if (sound && !isMuted() && idx < strip.length - 1) playTick()
        lastIdx = idx
      }
      if (elapsed >= REEL_LAND_MS) {
        setDisplay(winner)
        setLanded(true)
        if (sound && !isMuted()) playFanfare()
        onLanded?.()
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // onLanded intentionally excluded — it should fire once per landing, not on
    // every parent re-render that supplies a new callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner, poolNumbers, reduced, sound])

  const label = winner === null ? 'Trekker…' : landed ? 'Vinner!' : 'Lander…'

  return (
    <div className="flex flex-col items-center gap-3">
      <p
        className={`${big ? 'text-2xl' : 'text-base'} ${
          landed ? 'text-[#6B9460]' : 'animate-pulse-gold text-[#BA9F8D]'
        } font-medium`}
      >
        {label}
      </p>
      <div
        className={`${
          big ? 'h-52 w-52 text-8xl' : 'h-28 w-28 text-5xl'
        } relative flex items-center justify-center overflow-hidden rounded-full border-4 ${
          landed ? 'border-[#6B9460] bg-[#1e2a1a]' : 'border-[#F0B243] bg-[#36211A]'
        } font-bold tabular-nums ${landed ? 'animate-winner-pop text-[#F6EFE4]' : 'text-[#F0B243]'}`}
        aria-live="polite"
        aria-label={winner === null ? 'Trekning pågår' : `Vinnernummer ${winner}`}
      >
        {display === null ? '?' : display}
        {!landed && winner === null && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full ring-4 ring-inset ring-[#F0B243]/30"
          />
        )}
      </div>
    </div>
  )
}

/**
 * Backward-compatible thin wrapper kept for the host panel's small inline
 * spinner (it only ever shows the blind spin while `draw_state==='spinning'`).
 */
export function NumberRoller({ numbers, big }: { numbers: number[]; big?: boolean }) {
  return <DrawReel poolNumbers={numbers} reveal={null} big={big} />
}

const CONFETTI_COLORS = ['#F0B243', '#C0503F', '#6B9460', '#F6EFE4']

export function Confetti({ count = 80 }: { count?: number }) {
  const reduced = usePrefersReducedMotion()
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 37 + 11) % 100}%`,
        delay: `${((i * 13) % 24) / 10}s`,
        duration: `${2.6 + ((i * 7) % 18) / 10}s`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rot: (i * 53) % 360,
        size: i % 3 === 0 ? 'h-3 w-2' : i % 3 === 1 ? 'h-2 w-2' : 'h-4 w-1.5',
      })),
    [count]
  )
  if (reduced) return null
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`animate-confetti absolute top-0 block ${p.size}`}
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.duration,
            backgroundColor: p.color,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  )
}

export function WinnerCard({
  draw,
  big,
  isMe,
}: {
  draw: RevealedDraw
  big?: boolean
  isMe?: boolean
}) {
  return (
    <div
      className={`animate-winner-pop flex flex-col items-center gap-2 rounded-3xl border-2 border-[#F0B243] bg-[#36211A] text-center ${
        big ? 'px-14 py-10' : 'px-8 py-6'
      }`}
    >
      {isMe && (
        <p className={`font-bold text-[#F0B243] ${big ? 'text-4xl' : 'text-2xl'}`}>DU VANT! 🎉</p>
      )}
      {draw.prize_image_url && (
        // Public Supabase Storage URL; the column is http(s)-validated server-side.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={draw.prize_image_url}
          alt={draw.prize_name}
          className={`mb-1 rounded-2xl object-cover ${big ? 'h-48 w-48' : 'h-24 w-24'}`}
        />
      )}
      <p className={`text-[#BA9F8D] ${big ? 'text-2xl' : 'text-sm'}`}>{draw.prize_name}</p>
      <p className={`font-bold text-[#F6EFE4] ${big ? 'text-6xl' : 'text-3xl'}`}>
        {draw.player_name}
      </p>
      <p className={`text-[#F0B243] ${big ? 'text-3xl' : 'text-lg'} font-semibold tabular-nums`}>
        Åre nr. {draw.lot_number}
      </p>
    </div>
  )
}

/**
 * Resolve what the live draw overlay should show right now.
 * Winner data comes from get_revealed_draws (refetched by useSession on the
 * draw_revealed event) — the last revealed entry IS the current one.
 */
export function currentReveal(
  session: Session | null,
  revealedDraws: RevealedDraw[]
): RevealedDraw | null {
  if (!session || session.draw_state !== 'revealed') return null
  return revealedDraws.length > 0 ? revealedDraws[revealedDraws.length - 1] : null
}

/** Small host-side toggle to arm/mute the projector's synthesized SFX. */
export function AudioToggle({
  on,
  onToggle,
}: {
  on: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      aria-pressed={on}
      className="rounded-xl border border-[#4D3023] px-3 py-2 text-sm text-[#BA9F8D]"
    >
      {on ? '🔊 Lyd på' : '🔇 Lyd av'}
    </button>
  )
}
