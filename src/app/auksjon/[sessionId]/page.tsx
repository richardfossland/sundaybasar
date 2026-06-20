'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuction } from '@/lib/useAuction'
import { getIdentity } from '@/lib/identity'
import { Thermometer } from '@/components/Thermometer'
import { ErrorText } from '@/components/ErrorText'
import { CATEGORY_EMOJI, FORMAT_LABELS, STAGE_LABEL, currentDutchPrice, kr, minNextBid } from '@/types/auction'
import { useNow } from '@/lib/useNow'
import type { AuctionItem } from '@/types/auction'

type Supa = ReturnType<typeof useAuction>['supabase']

const card = 'rounded-2xl border border-border bg-surface p-5'
const input =
  'rounded-xl border border-border bg-bg px-4 py-3 text-text placeholder:text-faint w-full'
const primaryBtn =
  'min-h-12 rounded-xl bg-gold px-4 py-3 font-semibold text-bg transition-opacity disabled:opacity-50'
const ghostBtn = 'min-h-12 rounded-xl border border-border px-4 py-3 font-medium text-muted'

const STATUS_ORDER: Record<AuctionItem['status'], number> = {
  active: 0,
  sold: 1,
  passed: 2,
  draft: 3,
}

export default function BidderView({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { supabase, session, items, goalAmount, raisedTotal, loaded, missing, refresh } =
    useAuction(sessionId)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [identityChecked, setIdentityChecked] = useState(false)

  useEffect(() => {
    const id = getIdentity()
    if (id.sessionId === sessionId && id.playerId && id.secret) {
      setPlayerId(id.playerId)
      setSecret(id.secret)
    }
    setIdentityChecked(true)
  }, [sessionId])

  const visible = useMemo(
    () =>
      items
        .filter((it) => it.status !== 'draft')
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.position - b.position),
    [items]
  )
  const myWins = useMemo(
    () => (playerId ? items.filter((it) => it.status === 'sold' && it.winner_player_id === playerId) : []),
    [items, playerId]
  )

  if (!loaded || !identityChecked) return <Centered>Laster…</Centered>
  if (missing || !session) return <Centered>Fant ikke auksjonen.</Centered>
  if (!playerId || !secret)
    return (
      <Centered>
        <span>
          Du er ikke med på auksjonen ennå.{' '}
          <Link href={`/?kode=${session.code}`} className="text-gold underline">
            Bli med her
          </Link>
        </span>
      </Centered>
    )

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-5 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-gold">🔨 Auksjon</h1>
        {session.phase === 'ended' && <p className="mt-1 text-sm text-muted">Auksjonen er avsluttet.</p>}
      </header>

      <Thermometer raised={raisedTotal} goal={goalAmount} />

      {myWins.length > 0 && (
        <div className="rounded-2xl border-2 border-green bg-[#1e2a1a] p-4">
          <p className="font-semibold text-green-soft">Du vant! 🎉</p>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-text">
            {myWins.map((w) => (
              <li key={w.id}>
                <span className="font-medium">{w.title}</span> — {kr(w.winning_amount)}
                {session.vipps_number && (
                  <span className="text-muted">
                    {' '}
                    · Vipps {kr(w.winning_amount)} til {session.vipps_number} (merk: {w.title})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {visible.length === 0 && <p className="text-center text-sm text-muted">Ingen objekter ennå.</p>}

      <div className="flex flex-col gap-3">
        {visible.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            playerId={playerId}
            secret={secret}
            supabase={supabase}
            open={session.phase === 'open'}
            onDone={refresh}
          />
        ))}
      </div>
    </main>
  )
}

function ItemCard({
  item,
  playerId,
  secret,
  supabase,
  open,
  onDone,
}: {
  item: AuctionItem
  playerId: string
  secret: string
  supabase: Supa
  open: boolean
  onDone: () => void
}) {
  const now = useNow()
  const leading = item.current_leader_player_id === playerId
  const price = item.current_amount != null ? Number(item.current_amount) : Number(item.start_price)

  return (
    <div className={`${card} ${leading ? 'border-gold' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-text">
            {CATEGORY_EMOJI[item.category]} {item.title}
          </p>
          {item.description && <p className="mt-0.5 text-sm text-muted">{item.description}</p>}
          {item.donor_name && <p className="text-xs text-faint">Donert av {item.donor_name}</p>}
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
          {FORMAT_LABELS[item.format]}
        </span>
      </div>

      {item.status === 'sold' ? (
        <p className="mt-3 text-sm text-green-soft">
          Solgt for {kr(item.winning_amount)}
          {item.winner_player_id === playerId ? ' — til deg! 🎉' : item.winner_name ? ` til ${item.winner_name}` : ''}
        </p>
      ) : item.status === 'passed' ? (
        <p className="mt-3 text-sm text-faint">Ikke solgt.</p>
      ) : item.format === 'hollandsk' ? (
        <DutchPanel item={item} playerId={playerId} secret={secret} supabase={supabase} open={open} onDone={onDone} now={now} />
      ) : (
        <>
          {item.live_stage && (
            <p className="mt-2 text-center text-lg font-semibold text-gold">{STAGE_LABEL[item.live_stage]}</p>
          )}
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-gold">{kr(price)}</span>
            {leading ? (
              <span className="text-sm font-semibold text-green-soft">Du leder! 🎉</span>
            ) : item.leader_name ? (
              <span className="text-sm text-muted">Ledes av {item.leader_name}</span>
            ) : (
              <span className="text-sm text-muted">Ingen bud ennå</span>
            )}
          </div>
          {open && (
            <BidPanel item={item} playerId={playerId} secret={secret} supabase={supabase} onDone={onDone} />
          )}
        </>
      )}
    </div>
  )
}

function BidPanel({
  item,
  playerId,
  secret,
  supabase,
  onDone,
}: {
  item: AuctionItem
  playerId: string
  secret: string
  supabase: Supa
  onDone: () => void
}) {
  const min = minNextBid(item)
  const [amount, setAmount] = useState(String(min))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function bid() {
    const value = Number(amount)
    if (!value || value < min) return setErr(`Minst ${kr(min)}.`)
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.rpc('place_bid', {
      p_player_id: playerId,
      p_secret: secret,
      p_item_id: item.id,
      p_amount: value,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data?.ok) return setErr(data.error ?? 'Kunne ikke by.')
    onDone()
  }

  async function buyNow() {
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.rpc('buy_now', {
      p_player_id: playerId,
      p_secret: secret,
      p_item_id: item.id,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data?.ok) return setErr(data.error ?? 'Kunne ikke kjøpe.')
    onDone()
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className={input}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          aria-label="Maksbud i kroner"
        />
        <button className={primaryBtn} onClick={bid} disabled={busy}>
          By
        </button>
      </div>
      <p className="text-xs text-faint">
        Beløpet er maksbudet ditt — vi byr automatisk for deg opp til dette. Minst {kr(min)}.
      </p>
      {item.buy_now_price != null && (
        <button className={ghostBtn} onClick={buyNow} disabled={busy}>
          Kjøp nå for {kr(item.buy_now_price)}
        </button>
      )}
      {err && <ErrorText>{err}</ErrorText>}
    </div>
  )
}

function DutchPanel({
  item,
  playerId,
  secret,
  supabase,
  open,
  onDone,
  now,
}: {
  item: AuctionItem
  playerId: string
  secret: string
  supabase: Supa
  open: boolean
  onDone: () => void
  now: number
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const started = !!item.dutch_started_at
  const price = currentDutchPrice(item, now)
  const atFloor = item.dutch_floor != null && price <= Number(item.dutch_floor)

  async function take() {
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.rpc('dutch_take', {
      p_player_id: playerId,
      p_secret: secret,
      p_item_id: item.id,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data?.ok) return setErr(data.error ?? 'Kunne ikke kjøpe.')
    onDone()
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-bold tabular-nums text-gold">{kr(price)}</span>
        <span className="text-xs text-faint">{atFloor ? 'gulvpris' : started ? 'synker…' : ''}</span>
      </div>
      {open && started ? (
        <button className={primaryBtn} onClick={take} disabled={busy}>
          KJØP NÅ for {kr(price)}
        </button>
      ) : (
        <p className="text-sm text-muted">{started ? 'Auksjonen er avsluttet.' : 'Prisfallet starter snart…'}</p>
      )}
      {err && <ErrorText>{err}</ErrorText>}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-8 text-center text-muted">
      {children}
    </main>
  )
}
