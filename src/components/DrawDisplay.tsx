'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RevealedDraw, Session } from '@/types/game'

/** Rolls through candidate lot numbers for suspense. Pure animation — the
 *  actual winner was already chosen server-side when the draw started. */
export function NumberRoller({ numbers, big }: { numbers: number[]; big?: boolean }) {
  const [current, setCurrent] = useState<number | null>(null)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    if (mq.matches || numbers.length === 0) return
    const tick = () => setCurrent(numbers[Math.floor(Math.random() * numbers.length)])
    tick()
    const iv = setInterval(tick, 90)
    return () => clearInterval(iv)
  }, [numbers])

  return (
    <div className="flex flex-col items-center gap-3">
      <p className={`${big ? 'text-2xl' : 'text-base'} animate-pulse-gold text-[#BA9F8D]`}>
        Trekker…
      </p>
      <div
        className={`${
          big ? 'h-44 w-44 text-7xl' : 'h-28 w-28 text-5xl'
        } flex items-center justify-center rounded-full border-4 border-[#F0B243] bg-[#36211A] font-bold text-[#F0B243] tabular-nums`}
        aria-live="polite"
        aria-label="Trekning pågår"
      >
        {reduced || current === null ? '?' : current}
      </div>
    </div>
  )
}

const CONFETTI_COLORS = ['#F0B243', '#C0503F', '#6B9460', '#F6EFE4']

export function Confetti({ count = 40 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 37 + 11) % 100}%`,
        delay: `${((i * 13) % 20) / 10}s`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rot: (i * 53) % 360,
      })),
    [count]
  )
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="animate-confetti absolute top-0 block h-3 w-2"
          style={{
            left: p.left,
            animationDelay: p.delay,
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
      {isMe && <p className={`font-bold text-[#F0B243] ${big ? 'text-4xl' : 'text-2xl'}`}>DU VANT! 🎉</p>}
      <p className={`text-[#BA9F8D] ${big ? 'text-2xl' : 'text-sm'}`}>{draw.prize_name}</p>
      <p className={`font-bold text-[#F6EFE4] ${big ? 'text-6xl' : 'text-3xl'}`}>{draw.player_name}</p>
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
