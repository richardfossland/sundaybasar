'use client'

import { use, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuction } from '@/lib/useAuction'
import { Confetti } from '@/components/DrawDisplay'
import { Thermometer } from '@/components/Thermometer'
import { CATEGORY_EMOJI, kr } from '@/types/auction'

export default function AuctionProjector({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { session, items, goalAmount, raisedTotal, loaded, missing } = useAuction(sessionId)

  const [origin, setOrigin] = useState('')
  useEffect(() => {
    const env = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    setOrigin(env || window.location.origin)
  }, [])

  // Confetti burst whenever the number of sold items goes up.
  const soldCount = useMemo(() => items.filter((i) => i.status === 'sold').length, [items])
  const prevSold = useRef(soldCount)
  const [celebrate, setCelebrate] = useState(false)
  useEffect(() => {
    if (soldCount > prevSold.current) {
      setCelebrate(true)
      const t = setTimeout(() => setCelebrate(false), 5000)
      prevSold.current = soldCount
      return () => clearTimeout(t)
    }
    prevSold.current = soldCount
  }, [soldCount])

  if (!loaded) return <Big>Laster…</Big>
  if (missing || !session) return <Big>Fant ikke auksjonen.</Big>

  const active = items.filter((i) => i.status === 'active')
  const sold = items.filter((i) => i.status === 'sold')
  const joinUrl = origin ? `${origin}/?kode=${session.code}` : ''

  return (
    <main className="min-h-screen bg-bg px-10 py-8 text-text">
      {celebrate && <Confetti count={120} />}

      <div className="grid grid-cols-[1fr_auto] gap-8">
        <div>
          <h1 className="font-display text-6xl font-bold text-gold">🔨 Auksjon</h1>
          <p className="mt-2 text-2xl text-muted">
            Bli med: by fra mobilen — kode{' '}
            <span className="font-bold tracking-widest text-text">{session.code}</span>
          </p>
          <div className="mt-6 max-w-md">
            <Thermometer raised={raisedTotal} goal={goalAmount} big />
          </div>
        </div>
        {joinUrl && (
          <div className="rounded-3xl bg-white p-5">
            <QRCodeSVG value={joinUrl} size={200} />
          </div>
        )}
      </div>

      <section className="mt-10">
        {active.length === 0 ? (
          <p className="text-2xl text-muted">Venter på at objekter åpnes…</p>
        ) : (
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
            {active.map((it) => {
              const price = it.current_amount != null ? Number(it.current_amount) : Number(it.start_price)
              return (
                <div key={it.id} className="rounded-3xl border-2 border-gold bg-surface p-6">
                  <p className="text-3xl font-semibold text-text">
                    {CATEGORY_EMOJI[it.category]} {it.title}
                  </p>
                  <p className="mt-3 text-5xl font-bold tabular-nums text-gold">{kr(price)}</p>
                  <p className="mt-2 text-xl text-muted">
                    {it.leader_name ? `Ledes av ${it.leader_name}` : 'Ingen bud ennå'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {sold.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-medium text-muted">Solgt</h2>
          <div className="mt-2 flex flex-wrap gap-3">
            {sold.map((it) => (
              <span
                key={it.id}
                className="rounded-2xl border border-green bg-[#1e2a1a] px-4 py-2 text-lg text-green-soft"
              >
                {it.title} — {kr(it.winning_amount)}
                {it.winner_name && ` · ${it.winner_name}`}
              </span>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

function Big({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-8 text-center text-3xl text-muted">
      {children}
    </main>
  )
}
