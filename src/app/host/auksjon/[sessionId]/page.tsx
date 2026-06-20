'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuction } from '@/lib/useAuction'
import { getHostSecret } from '@/lib/identity'
import { ErrorText } from '@/components/ErrorText'
import { Thermometer } from '@/components/Thermometer'
import {
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  FORMAT_LABELS,
  kr,
} from '@/types/auction'
import type {
  AuctionCategory,
  AuctionFormat,
  AuctionItem,
  AuctionSettlement,
} from '@/types/auction'

const card = 'rounded-2xl border border-border bg-surface p-5'
const input =
  'rounded-xl border border-border bg-bg px-4 py-3 text-text placeholder:text-faint w-full'
const primaryBtn =
  'min-h-12 rounded-xl bg-gold px-4 py-3 font-semibold text-bg transition-opacity disabled:opacity-50'
const ghostBtn = 'min-h-11 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted'
const dangerBtn = 'min-h-11 rounded-xl border border-red px-3 py-2 text-sm font-medium text-red-soft'

type CallFn = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<({ ok: boolean } & Record<string, unknown>) | null>

type Tab = 'objekter' | 'oppgjor'

export default function AuctionHost({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { supabase, session, items, goalAmount, raisedTotal, loaded, missing, refresh, tick } =
    useAuction(sessionId)
  const [hostSecret, setHostSecret] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('objekter')
  const [error, setError] = useState('')
  const [settlements, setSettlements] = useState<AuctionSettlement[]>([])

  useEffect(() => {
    setHostSecret(getHostSecret(sessionId))
  }, [sessionId])

  const call = useCallback<CallFn>(
    async (fn, args = {}) => {
      setError('')
      const { data, error } = await supabase.rpc(fn, {
        p_session_id: sessionId,
        p_host_secret: hostSecret,
        ...args,
      })
      if (error) {
        setError(error.message)
        return null
      }
      if (data && data.ok === false) {
        setError(data.error ?? 'Noe gikk galt.')
        return null
      }
      refresh()
      return data
    },
    [supabase, sessionId, hostSecret, refresh]
  )

  const loadSettlements = useCallback(async () => {
    if (!hostSecret) return
    const { data } = await supabase.rpc('get_settlements', {
      p_session_id: sessionId,
      p_host_secret: hostSecret,
    })
    if (data?.ok) setSettlements(data.settlements as AuctionSettlement[])
  }, [supabase, sessionId, hostSecret])

  useEffect(() => {
    if (tab === 'oppgjor') loadSettlements()
  }, [tab, tick, loadSettlements])

  if (!loaded) return <Centered>Laster…</Centered>
  if (missing || !session) return <Centered>Fant ikke auksjonen.</Centered>
  if (!hostSecret)
    return (
      <Centered>Denne enheten har ikke vertsnøkkelen for auksjonen. Åpne lenken fra enheten du opprettet den på.</Centered>
    )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'objekter', label: 'Objekter' },
    { id: 'oppgjor', label: 'Oppgjør' },
  ]

  async function togglePaid(s: AuctionSettlement) {
    await call('set_settlement_paid', { p_settlement_id: s.settlement_id, p_paid: !s.paid })
    loadSettlements()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 px-5 py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gold">🔨 Auksjon</h1>
          <p className="text-sm text-muted">
            Kode <span className="font-bold tracking-widest text-text">{session.code}</span>
          </p>
        </div>
        <Link
          href={`/host/auksjon/${sessionId}/projector`}
          target="_blank"
          className={ghostBtn}
        >
          Storskjerm ↗
        </Link>
      </header>

      <Thermometer raised={raisedTotal} goal={goalAmount} />

      <nav className="flex gap-1 rounded-xl border border-border bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === t.id ? 'bg-gold text-bg' : 'text-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <ErrorText>{error}</ErrorText>}

      {tab === 'objekter' && <ObjekterTab items={items} call={call} />}
      {tab === 'oppgjor' && (
        <OppgjorTab settlements={settlements} session={session} onToggle={togglePaid} />
      )}

      {session.phase === 'open' ? (
        <button
          className={`${dangerBtn} mt-2`}
          onClick={() => {
            if (confirm('Avslutte auksjonen? Da kan ingen by mer.')) call('end_session')
          }}
        >
          Avslutt auksjon
        </button>
      ) : (
        <p className="text-center text-sm text-muted">Auksjonen er avsluttet.</p>
      )}
    </main>
  )
}

// ── Objekter ─────────────────────────────────────────────────────────────────
function ObjekterTab({ items, call }: { items: AuctionItem[]; call: CallFn }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<AuctionCategory>('gjenstand')
  const [format, setFormat] = useState<AuctionFormat>('stille')
  const [startPrice, setStartPrice] = useState('100')
  const [minInc, setMinInc] = useState('10')
  const [donor, setDonor] = useState('')
  const [reserve, setReserve] = useState('')
  const [buyNow, setBuyNow] = useState('')
  const [busy, setBusy] = useState(false)

  function reset() {
    setTitle('')
    setDescription('')
    setCategory('gjenstand')
    setFormat('stille')
    setStartPrice('100')
    setMinInc('10')
    setDonor('')
    setReserve('')
    setBuyNow('')
  }

  async function add() {
    setBusy(true)
    const r = await call('create_auction_item', {
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_category: category,
      p_format: format,
      p_start_price: Number(startPrice) || 0,
      p_min_increment: Number(minInc) || 10,
      p_donor_name: donor.trim() || null,
      p_reserve_price: reserve.trim() ? Number(reserve) : null,
      p_buy_now_price: buyNow.trim() ? Number(buyNow) : null,
    })
    setBusy(false)
    if (r?.ok) {
      reset()
      setOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!open ? (
        <button className={primaryBtn} onClick={() => setOpen(true)}>
          + Nytt objekt
        </button>
      ) : (
        <div className={`${card} flex flex-col gap-3`}>
          <input
            className={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tittel (f.eks. «Hjemmebakt bløtkake»)"
          />
          <input
            className={input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Beskrivelse (valgfritt)"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-muted">
              Kategori
              <select
                className={input}
                value={category}
                onChange={(e) => setCategory(e.target.value as AuctionCategory)}
              >
                {(Object.keys(CATEGORY_LABELS) as AuctionCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_EMOJI[c]} {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              Format
              <select
                className={input}
                value={format}
                onChange={(e) => setFormat(e.target.value as AuctionFormat)}
              >
                <option value="stille">Stille (tidsbasert)</option>
                <option value="live">Live (auksjonarius)</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-muted">
              Startpris (kr)
              <input
                className={input}
                inputMode="numeric"
                value={startPrice}
                onChange={(e) => setStartPrice(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              Min. budøkning (kr)
              <input
                className={input}
                inputMode="numeric"
                value={minInc}
                onChange={(e) => setMinInc(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
          </div>
          <input
            className={input}
            value={donor}
            onChange={(e) => setDonor(e.target.value)}
            placeholder="Donert av (valgfritt)"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-muted">
              Reservepris (skjult, valgfritt)
              <input
                className={input}
                inputMode="numeric"
                value={reserve}
                onChange={(e) => setReserve(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              Kjøp-nå-pris (valgfritt)
              <input
                className={input}
                inputMode="numeric"
                value={buyNow}
                onChange={(e) => setBuyNow(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button className={primaryBtn} onClick={add} disabled={busy || !title.trim()}>
              {busy ? 'Lagrer…' : 'Legg til'}
            </button>
            <button
              className={ghostBtn}
              onClick={() => {
                reset()
                setOpen(false)
              }}
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <p className="text-center text-sm text-muted">Ingen objekter ennå.</p>
      )}
      {items.map((it) => (
        <ItemCardHost key={it.id} item={it} call={call} />
      ))}
    </div>
  )
}

function ItemCardHost({ item, call }: { item: AuctionItem; call: CallFn }) {
  const price = item.current_amount != null ? Number(item.current_amount) : Number(item.start_price)
  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-text">
            {CATEGORY_EMOJI[item.category]} {item.title}
          </p>
          <p className="text-xs text-muted">
            {FORMAT_LABELS[item.format]}
            {item.donor_name && ` · donert av ${item.donor_name}`}
          </p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      {item.status === 'active' && (
        <div className="mt-2 text-sm text-muted">
          Ledende bud: <span className="font-semibold text-gold">{kr(price)}</span>
          {item.leader_name && <> · {item.leader_name}</>}
          {item.has_reserve && (
            <span className={item.reserve_met ? 'text-green' : 'text-red-soft'}>
              {' '}· {item.reserve_met ? 'reserve nådd' : 'reserve ikke nådd'}
            </span>
          )}
          {item.buy_now_price != null && <> · kjøp-nå {kr(item.buy_now_price)}</>}
        </div>
      )}
      {item.status === 'sold' && (
        <p className="mt-2 text-sm text-green-soft">
          Solgt for <span className="font-semibold">{kr(item.winning_amount)}</span>
          {item.winner_name && <> til {item.winner_name}</>}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.status === 'draft' && (
          <button className={primaryBtn} onClick={() => call('activate_item', { p_item_id: item.id })}>
            Aktiver
          </button>
        )}
        {item.status === 'active' && (
          <>
            <button className={primaryBtn} onClick={() => call('mark_sold', { p_item_id: item.id })}>
              Marker solgt
            </button>
            <button className={ghostBtn} onClick={() => call('pass_item', { p_item_id: item.id })}>
              Pass
            </button>
          </>
        )}
        {item.status !== 'sold' && (
          <button
            className={dangerBtn}
            onClick={() => {
              if (confirm('Slette objektet?')) call('delete_auction_item', { p_item_id: item.id })
            }}
          >
            Slett
          </button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: AuctionItem['status'] }) {
  const map: Record<AuctionItem['status'], { label: string; cls: string }> = {
    draft: { label: 'Utkast', cls: 'border-border text-muted' },
    active: { label: 'Aktiv', cls: 'border-gold text-gold' },
    sold: { label: 'Solgt', cls: 'border-green text-green-soft' },
    passed: { label: 'Passet', cls: 'border-border text-faint' },
  }
  const s = map[status]
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
  )
}

// ── Oppgjør ──────────────────────────────────────────────────────────────────
function OppgjorTab({
  settlements,
  session,
  onToggle,
}: {
  settlements: AuctionSettlement[]
  session: { vipps_number: string | null }
  onToggle: (s: AuctionSettlement) => void
}) {
  const outstanding = settlements.filter((s) => !s.paid).reduce((a, s) => a + Number(s.amount), 0)
  return (
    <div className="flex flex-col gap-3">
      {session.vipps_number ? (
        <p className="text-sm text-muted">
          Be vinnere vippse til <span className="font-semibold text-text">{session.vipps_number}</span> og
          merk betalingen med objektet. Huk av når pengene er kommet.
        </p>
      ) : (
        <p className="text-sm text-muted">Ingen Vipps-nummer satt — registrer oppgjør manuelt.</p>
      )}
      {settlements.length === 0 && (
        <p className="text-center text-sm text-muted">Ingen solgte objekter ennå.</p>
      )}
      {settlements.map((s) => (
        <div key={s.settlement_id} className={`${card} flex items-center justify-between gap-3`}>
          <div>
            <p className="font-medium text-text">{s.item_title}</p>
            <p className="text-xs text-muted">
              {s.player_name ?? '—'} · {kr(s.amount)}
            </p>
          </div>
          <button
            onClick={() => onToggle(s)}
            className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-medium ${
              s.paid ? 'border-green text-green-soft' : 'border-gold text-gold'
            }`}
          >
            {s.paid ? '✓ Betalt' : 'Marker betalt'}
          </button>
        </div>
      ))}
      {outstanding > 0 && (
        <p className="text-right text-sm text-muted">
          Utestående: <span className="font-semibold text-text">{kr(outstanding)}</span>
        </p>
      )}
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
