'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/useSession'
import { getIdentity } from '@/lib/identity'
import { Confetti, currentReveal, DrawReel, WinnerCard } from '@/components/DrawDisplay'
import { VippsCard } from '@/components/VippsCard'

export default function PlayerView({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { supabase, session, lots, prizes, revealedDraws, loaded, missing } = useSession(sessionId)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [identityChecked, setIdentityChecked] = useState(false)
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    if (session?.draw_state !== 'revealed') setLanded(false)
  }, [session?.draw_state])

  useEffect(() => {
    const id = getIdentity()
    if (id.sessionId === sessionId && id.playerId) {
      setPlayerId(id.playerId)
      // Best-effort presence ping.
      if (id.secret) {
        supabase.rpc('set_online', { p_player_id: id.playerId, p_secret: id.secret, p_online: true })
      }
    }
    setIdentityChecked(true)
  }, [sessionId, supabase])

  const myLots = useMemo(
    () => (playerId && session ? lots.filter((l) => l.player_id === playerId) : []),
    [lots, playerId, session]
  )
  const myRoundLots = useMemo(
    () => (session ? myLots.filter((l) => l.round === session.current_round) : []),
    [myLots, session]
  )
  const poolNumbers = useMemo(
    () =>
      session
        ? lots.filter((l) => l.round === session.current_round && !l.removed).map((l) => l.number)
        : [],
    [lots, session]
  )
  const reveal = currentReveal(session, revealedDraws)
  const winners = revealedDraws.filter((d) => !d.voided)
  const myWins = playerId ? winners.filter((d) => d.player_id === playerId) : []

  if (!loaded || !identityChecked) return <Centered>Laster…</Centered>
  if (missing || !session) return <Centered>Fant ikke basaren.</Centered>
  if (!playerId)
    return (
      <Centered>
        <span>
          Du er ikke med på denne basaren ennå.{' '}
          <Link href="/" className="text-[#F0B243] underline">
            Bli med her
          </Link>
        </span>
      </Centered>
    )

  // Fullscreen draw overlay — the reel rolls blind while spinning, then lands
  // on the server-published winner before the winner card appears.
  const drawing = session.draw_state === 'spinning' || session.draw_state === 'revealed'
  if (drawing) {
    const isMe = !!reveal && reveal.player_id === playerId
    const showWinner = session.draw_state === 'revealed' && reveal && landed
    return (
      <Centered>
        {showWinner ? (
          <>
            {isMe && <Confetti />}
            <WinnerCard draw={reveal!} big={isMe} isMe={isMe} />
          </>
        ) : (
          <DrawReel
            poolNumbers={poolNumbers}
            reveal={reveal}
            big
            onLanded={() => setLanded(true)}
          />
        )}
      </Centered>
    )
  }

  const lotWord = session.tildeling === 'kjop' ? 'årer' : 'lodd'

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-5 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-[#F0B243]">🎟️ SundayBasar</h1>
        {session.trekning === 'runder' && (
          <p className="text-sm text-[#BA9F8D]">Runde {session.current_round}</p>
        )}
        {session.phase === 'ended' && <p className="mt-1 text-sm text-[#BA9F8D]">Basaren er avsluttet.</p>}
      </header>

      {myWins.length > 0 && (
        <div className="rounded-2xl border-2 border-[#6B9460] bg-[#1e2a1a] p-4 text-center">
          <p className="font-semibold text-[#a9c9a0]">Du har vunnet! 🎉</p>
          <ul className="mt-1 text-sm text-[#F6EFE4]">
            {myWins.map((d) => (
              <li key={d.draw_id}>
                {d.prize_name} (åre {d.lot_number})
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="rounded-2xl border border-[#4D3023] bg-[#36211A] p-5">
        <h2 className="mb-3 text-sm font-medium text-[#BA9F8D]">
          Dine {lotWord}
          {session.trekning === 'runder' && ` denne runden`} ({myRoundLots.length})
        </h2>
        {myRoundLots.length === 0 ? (
          <p className="text-sm text-[#BA9F8D]">
            {session.tildeling === 'kjop'
              ? 'Ingen årer ennå — vipps og si ifra til den som styrer basaren!'
              : 'Ingen lodd ennå.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {myRoundLots.map((l) => (
              <span
                key={l.id}
                className={`flex h-12 min-w-12 items-center justify-center rounded-xl border-2 px-2 text-lg font-bold tabular-nums ${
                  l.removed
                    ? 'border-[#4D3023] text-[#7d6a5d] line-through'
                    : 'border-[#F0B243] text-[#F0B243]'
                }`}
              >
                {l.number}
              </span>
            ))}
          </div>
        )}
      </section>

      {session.phase === 'open' && <VippsCard session={session} />}

      <section className="rounded-2xl border border-[#4D3023] bg-[#36211A] p-5">
        <h2 className="mb-3 text-sm font-medium text-[#BA9F8D]">Premier</h2>
        <ol className="flex flex-col gap-2">
          {prizes.map((p, i) => {
            const w = winners.find((d) => d.prize_id === p.id)
            return (
              <li key={p.id} className="text-sm">
                <span className="mr-1 text-[#BA9F8D]">{i + 1}.</span>
                <span className={w ? 'text-[#7d6a5d] line-through' : 'text-[#F6EFE4]'}>{p.name}</span>
                {w && (
                  <span className="ml-1 text-[#6B9460]">
                    → {w.player_name}
                    {w.player_id === playerId && ' (deg!)'}
                  </span>
                )}
              </li>
            )
          })}
          {prizes.length === 0 && <li className="text-sm text-[#BA9F8D]">Premiene kommer…</li>}
        </ol>
      </section>
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-8 text-center text-[#BA9F8D]">
      {children}
    </main>
  )
}
