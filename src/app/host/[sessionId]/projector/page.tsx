'use client'

import { use, useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useSession } from '@/lib/useSession'
import {
  AudioToggle,
  Confetti,
  currentReveal,
  DrawReel,
  WinnerCard,
} from '@/components/DrawDisplay'
import { armAudio, setMuted } from '@/lib/drawSound'
import { VippsCard } from '@/components/VippsCard'

export default function Projector({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { session, lots, prizes, revealedDraws, loaded, missing } = useSession(sessionId)

  // Synthesized SFX. Off until the host arms it from a click (browser autoplay
  // policy) — the projector is opened by the host on the big screen.
  const [sound, setSound] = useState(false)
  // Keep the reel mounted through spinning→revealed so it can animate the
  // landing; reveal the winner card only once the reel has settled.
  const [landed, setLanded] = useState(false)
  const drawState = session?.draw_state
  useEffect(() => {
    if (drawState !== 'revealed') setLanded(false)
  }, [drawState])

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

  // Fullscreen takeovers during a draw. The reel stays mounted across
  // spinning→revealed: it rolls blind while spinning, then decelerates and
  // lands on the server-published winner; only after it settles do we swap in
  // the big winner card + confetti.
  // `revealed` can arrive a beat before useSession's get_revealed_draws
  // refetch lands `reveal`; keep the reel spinning blind in that gap rather
  // than flashing back to the lobby.
  const drawing = session.draw_state === 'spinning' || session.draw_state === 'revealed'
  if (drawing) {
    const showWinner = session.draw_state === 'revealed' && reveal && landed
    return (
      <Big>
        <div className="absolute right-6 top-6">
          <AudioToggle
            on={sound}
            onToggle={(next) => {
              setSound(next)
              setMuted(!next)
              if (next) armAudio()
            }}
          />
        </div>
        {showWinner ? (
          <>
            <Confetti />
            <WinnerCard draw={reveal!} big />
          </>
        ) : (
          <DrawReel
            poolNumbers={poolNumbers}
            reveal={reveal}
            big
            sound={sound}
            onLanded={() => setLanded(true)}
          />
        )}
      </Big>
    )
  }

  if (session.phase === 'ended') {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-8 px-10 py-12">
        <h1 className="text-6xl font-bold text-gold">Takk for i kveld! 🎉</h1>
        <div className="w-full rounded-3xl border border-border bg-surface p-8">
          <h2 className="mb-4 text-2xl text-muted">Vinnerne</h2>
          <ul className="flex flex-col gap-3 text-3xl">
            {winners.map((d) => (
              <li key={d.draw_id}>
                <span className="text-gold">{d.prize_name}</span>{' '}
                <span className="text-text">
                  — {d.player_name} (åre {d.lot_number})
                </span>
              </li>
            ))}
            {winners.length === 0 && <li className="text-muted">Ingen trekninger ble gjort.</li>}
          </ul>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-10 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-semibold text-gold">
          🎟️ SundayBasar
          {session.trekning === 'runder' && (
            <span className="ml-4 text-2xl text-muted">Runde {session.current_round}</span>
          )}
        </h1>
        <p className="text-3xl text-muted">
          {poolNumbers.length}{' '}
          {session.tildeling === 'kjop' ? 'årer solgt' : 'lodd delt ut'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-surface p-8">
          <p className="text-2xl text-muted">Bli med på</p>
          <p className="text-4xl font-semibold text-text">{appHost}</p>
          <div className="rounded-2xl bg-white p-4">
            <QRCodeSVG value={joinUrl} size={200} />
          </div>
          <p className="text-2xl text-muted">
            Kode:{' '}
            <span className="text-6xl font-bold tracking-[0.3em] text-gold">
              {session.code}
            </span>
          </p>
          {session.tildeling === 'kjop' && <VippsCard session={session} big />}
        </section>

        <section className="rounded-3xl border border-border bg-surface p-8">
          <h2 className="mb-4 text-2xl text-muted">Premier</h2>
          <ol className="flex flex-col gap-3">
            {prizes.map((p, i) => {
              const w = winnerByPrize.get(p.id)
              return (
                <li key={p.id} className="flex items-center gap-3 text-2xl">
                  <span className="text-muted">{i + 1}.</span>
                  {p.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image_url}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <span className={w ? 'text-faint line-through' : 'text-text'}>
                    {p.name}
                  </span>
                  {w && (
                    <span className="text-xl text-green">
                      → {w.player_name} (åre {w.lot_number})
                    </span>
                  )}
                </li>
              )
            })}
            {prizes.length === 0 && <li className="text-xl text-muted">Premiene kommer…</li>}
          </ol>
        </section>
      </div>
    </main>
  )
}

function Big({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-10 text-3xl text-muted">
      {children}
    </main>
  )
}
