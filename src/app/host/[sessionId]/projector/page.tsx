'use client'

import { use, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useSession } from '@/lib/useSession'
import { Confetti, currentReveal, NumberRoller, WinnerCard } from '@/components/DrawDisplay'
import { VippsCard } from '@/components/VippsCard'

export default function Projector({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { session, lots, prizes, revealedDraws, loaded, missing } = useSession(sessionId)

  const roundLots = useMemo(
    () => (session ? lots.filter((l) => l.round === session.current_round) : []),
    [lots, session]
  )
  const poolNumbers = useMemo(
    () => roundLots.filter((l) => !l.removed).map((l) => l.number),
    [roundLots]
  )
  const reveal = currentReveal(session, revealedDraws)
  const winners = revealedDraws.filter((d) => !d.voided)
  const winnerByPrize = useMemo(() => {
    const m = new Map<string, (typeof winners)[number]>()
    for (const d of winners) m.set(d.prize_id, d)
    return m
  }, [winners])

  if (!loaded) return <Big>Laster…</Big>
  if (missing || !session) return <Big>Fant ikke basaren.</Big>

  const appHost = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://basar.sundaysuite.app').replace(
    /^https?:\/\//,
    ''
  )
  const joinUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://basar.sundaysuite.app'}/?kode=${session.code}`

  // Fullscreen takeovers during a draw
  if (session.draw_state === 'spinning') {
    return (
      <Big>
        <NumberRoller numbers={poolNumbers} big />
      </Big>
    )
  }
  if (session.draw_state === 'revealed' && reveal) {
    return (
      <Big>
        <Confetti />
        <WinnerCard draw={reveal} big />
      </Big>
    )
  }

  if (session.phase === 'ended') {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-8 px-10 py-12">
        <h1 className="text-6xl font-bold text-[#F0B243]">Takk for i kveld! 🎉</h1>
        <div className="w-full rounded-3xl border border-[#4D3023] bg-[#36211A] p-8">
          <h2 className="mb-4 text-2xl text-[#BA9F8D]">Vinnerne</h2>
          <ul className="flex flex-col gap-3 text-3xl">
            {winners.map((d) => (
              <li key={d.draw_id}>
                <span className="text-[#F0B243]">{d.prize_name}</span>{' '}
                <span className="text-[#F6EFE4]">
                  — {d.player_name} (åre {d.lot_number})
                </span>
              </li>
            ))}
            {winners.length === 0 && <li className="text-[#BA9F8D]">Ingen trekninger ble gjort.</li>}
          </ul>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-10 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-semibold text-[#F0B243]">
          🎟️ SundayBasar
          {session.trekning === 'runder' && (
            <span className="ml-4 text-2xl text-[#BA9F8D]">Runde {session.current_round}</span>
          )}
        </h1>
        <p className="text-3xl text-[#BA9F8D]">
          {poolNumbers.length}{' '}
          {session.tildeling === 'kjop' ? 'årer solgt' : 'lodd delt ut'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="flex flex-col items-center gap-5 rounded-3xl border border-[#4D3023] bg-[#36211A] p-8">
          <p className="text-2xl text-[#BA9F8D]">Bli med på</p>
          <p className="text-4xl font-semibold text-[#F6EFE4]">{appHost}</p>
          <div className="rounded-2xl bg-white p-4">
            <QRCodeSVG value={joinUrl} size={200} />
          </div>
          <p className="text-2xl text-[#BA9F8D]">
            Kode:{' '}
            <span className="text-6xl font-bold tracking-[0.3em] text-[#F0B243]">
              {session.code}
            </span>
          </p>
          {session.tildeling === 'kjop' && <VippsCard session={session} big />}
        </section>

        <section className="rounded-3xl border border-[#4D3023] bg-[#36211A] p-8">
          <h2 className="mb-4 text-2xl text-[#BA9F8D]">Premier</h2>
          <ol className="flex flex-col gap-3">
            {prizes.map((p, i) => {
              const w = winnerByPrize.get(p.id)
              return (
                <li key={p.id} className="flex items-baseline gap-3 text-2xl">
                  <span className="text-[#BA9F8D]">{i + 1}.</span>
                  <span className={w ? 'text-[#7d6a5d] line-through' : 'text-[#F6EFE4]'}>
                    {p.name}
                  </span>
                  {w && (
                    <span className="text-xl text-[#6B9460]">
                      → {w.player_name} (åre {w.lot_number})
                    </span>
                  )}
                </li>
              )
            })}
            {prizes.length === 0 && <li className="text-xl text-[#BA9F8D]">Premiene kommer…</li>}
          </ol>
        </section>
      </div>
    </main>
  )
}

function Big({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-10 text-3xl text-[#BA9F8D]">
      {children}
    </main>
  )
}
