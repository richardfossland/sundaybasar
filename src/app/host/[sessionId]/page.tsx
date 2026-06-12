'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/useSession'
import { getHostSecret } from '@/lib/identity'
import { currentReveal, NumberRoller, WinnerCard } from '@/components/DrawDisplay'
import type { Allocation, DrawLogEntry, Prize } from '@/types/game'

const card = 'rounded-2xl border border-[#4D3023] bg-[#36211A] p-4'
const input =
  'rounded-xl border border-[#4D3023] bg-[#251310] px-3 py-2.5 text-[#F6EFE4] placeholder:text-[#7d6a5d] w-full'
const primaryBtn =
  'min-h-12 rounded-xl bg-[#F0B243] px-4 font-semibold text-[#251310] disabled:opacity-40'
const ghostBtn = 'min-h-12 rounded-xl border border-[#4D3023] px-4 font-medium text-[#BA9F8D]'
const dangerBtn = 'min-h-12 rounded-xl border border-[#C0503F] px-4 font-medium text-[#C0503F]'

type Tab = 'deltakere' | 'premier' | 'trekning' | 'innstillinger'

export default function HostPanel({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const { supabase, session, players, lots, prizes, revealedDraws, loaded, missing, refresh } =
    useSession(sessionId)
  const [tab, setTab] = useState<Tab>('deltakere')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const hostSecret = typeof window !== 'undefined' ? getHostSecret(sessionId) : null

  // Every host RPC goes through here: uniform error surfacing + refresh.
  const call = useCallback(
    async (fn: string, args: Record<string, unknown> = {}) => {
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

  const roundLots = useMemo(
    () => (session ? lots.filter((l) => l.round === session.current_round) : []),
    [lots, session]
  )
  const soldKr = useMemo(() => {
    if (!session || session.tildeling !== 'kjop') return 0
    return roundLots.length * session.price_per_lodd
  }, [roundLots, session])

  if (!loaded) return <Centered>Laster…</Centered>
  if (missing || !session) return <Centered>Fant ikke basaren.</Centered>
  if (!hostSecret)
    return (
      <Centered>
        Denne enheten har ikke vertsnøkkelen til basaren. Åpne panelet på enheten som
        opprettet den.
      </Centered>
    )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'deltakere', label: 'Deltakere' },
    { id: 'premier', label: 'Premier' },
    { id: 'trekning', label: 'Trekning' },
    { id: 'innstillinger', label: 'Innstillinger' },
  ]

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#F0B243]">SundayBasar · vert</h1>
          <p className="text-sm text-[#BA9F8D]">
            Kode <span className="font-bold tracking-widest text-[#F6EFE4]">{session.code}</span>
            {' · '}
            {session.trekning === 'runder' && <>runde {session.current_round} · </>}
            {roundLots.length} årer
            {session.tildeling === 'kjop' && <> · {soldKr} kr</>}
          </p>
        </div>
        <Link
          href={`/host/${sessionId}/projector`}
          target="_blank"
          className="rounded-xl border border-[#4D3023] px-3 py-2 text-sm text-[#BA9F8D]"
        >
          Storskjerm ↗
        </Link>
      </header>

      {session.phase === 'ended' && (
        <p className={`${card} mb-4 text-center text-[#BA9F8D]`}>Basaren er avsluttet.</p>
      )}

      <nav className="mb-4 flex rounded-xl border border-[#4D3023] bg-[#36211A] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 flex-1 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-[#F0B243] text-[#251310]' : 'text-[#BA9F8D]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="mb-3 rounded-xl border border-[#C0503F] bg-[#3a1d18] px-4 py-2.5 text-sm text-[#f0a99f]">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-3 rounded-xl border border-[#6B9460] bg-[#1e2a1a] px-4 py-2.5 text-sm text-[#a9c9a0]">
          {notice}
        </p>
      )}

      {tab === 'deltakere' && (
        <ParticipantsTab
          {...{ call, session, players, lots, setNotice }}
          allocationsLoader={async () => {
            const { data } = await supabase
              .from('allocations')
              .select('*')
              .eq('session_id', sessionId)
              .order('created_at', { ascending: false })
            return (data ?? []) as Allocation[]
          }}
        />
      )}
      {tab === 'premier' && <PrizesTab {...{ call, prizes, revealedDraws }} />}
      {tab === 'trekning' && (
        <DrawTab {...{ call, session, prizes, revealedDraws, roundLots, setNotice }} />
      )}
      {tab === 'innstillinger' && <SettingsTab {...{ call, session, sessionId, setNotice }} />}
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-8 text-center text-[#BA9F8D]">
      <p>{children}</p>
    </main>
  )
}

// ── Deltakere ────────────────────────────────────────────────────────────────

function ParticipantsTab({
  call,
  session,
  players,
  lots,
  setNotice,
  allocationsLoader,
}: {
  call: (fn: string, args?: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  session: NonNullable<ReturnType<typeof useSession>['session']>
  players: ReturnType<typeof useSession>['players']
  lots: ReturnType<typeof useSession>['lots']
  setNotice: (s: string) => void
  allocationsLoader: () => Promise<Allocation[]>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [count, setCount] = useState(5)
  const [busy, setBusy] = useState(false)
  const [offlineName, setOfflineName] = useState('')
  const [allocations, setAllocations] = useState<Allocation[] | null>(null)
  const kjop = session.tildeling === 'kjop'

  const lotsByPlayer = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lots) {
      if (l.round !== session.current_round) continue
      m.set(l.player_id, (m.get(l.player_id) ?? 0) + 1)
    }
    return m
  }, [lots, session.current_round])

  async function allocate(playerId: string, playerName: string) {
    setBusy(true)
    const r = await call('allocate_lots', {
      p_player_id: playerId,
      p_count: count,
      p_kind: kjop ? 'kjop' : 'ekstra',
    })
    setBusy(false)
    if (r) {
      setNotice(
        `${playerName} fikk ${count} ${kjop ? 'årer' : 'lodd'} — nr. ${r.from_number}–${r.to_number}.`
      )
      setExpanded(null)
      setAllocations(null)
    }
  }

  async function addOffline() {
    const n = offlineName.trim()
    if (!n) return
    const r = await call('add_offline_player', { p_name: n })
    if (r) {
      setOfflineName('')
      setNotice(`${n} er lagt til uten telefon.`)
    }
  }

  async function toggleHistory() {
    if (allocations) return setAllocations(null)
    setAllocations(await allocationsLoader())
  }

  async function revoke(a: Allocation) {
    const r = await call('revoke_allocation', { p_allocation_id: a.id })
    if (r) {
      setNotice('Tildelingen er angret.')
      setAllocations(await allocationsLoader())
    }
  }

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?'

  return (
    <div className="flex flex-col gap-3">
      <div className={`${card} flex gap-2`}>
        <input
          value={offlineName}
          onChange={(e) => setOfflineName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addOffline()}
          placeholder="Deltaker uten telefon"
          maxLength={40}
          className={input}
        />
        <button onClick={addOffline} className={`${ghostBtn} shrink-0`}>
          Legg til
        </button>
      </div>

      {players.length === 0 && (
        <p className={`${card} text-center text-sm text-[#BA9F8D]`}>
          Ingen deltakere ennå. Be folk gå til basar.sundaysuite.app og bruke koden{' '}
          <span className="font-bold tracking-widest text-[#F6EFE4]">{session.code}</span>.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {players.map((p) => (
          <li key={p.id} className={card}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-[#F6EFE4]">
                  {p.name}
                  {p.is_offline && <span className="ml-2 text-xs text-[#BA9F8D]">uten telefon</span>}
                </p>
                <p className="text-sm text-[#BA9F8D]">
                  {lotsByPlayer.get(p.id) ?? 0} {kjop ? 'årer' : 'lodd'}
                </p>
              </div>
              <button
                onClick={() => {
                  setExpanded(expanded === p.id ? null : p.id)
                  setCount(5)
                }}
                disabled={session.phase === 'ended'}
                className={`${primaryBtn} shrink-0 py-2`}
              >
                {kjop ? 'Tildel årer' : 'Gi ekstra'}
              </button>
            </div>
            {expanded === p.id && (
              <div className="mt-3 flex flex-col gap-3 border-t border-[#4D3023] pt-3">
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={() => setCount(Math.max(1, count - 1))}
                    aria-label="Færre"
                    className="h-12 w-12 rounded-xl border border-[#4D3023] text-2xl text-[#F6EFE4]"
                  >
                    −
                  </button>
                  <span className="w-14 text-center text-3xl font-bold tabular-nums text-[#F6EFE4]">
                    {count}
                  </span>
                  <button
                    onClick={() => setCount(Math.min(200, count + 1))}
                    aria-label="Flere"
                    className="h-12 w-12 rounded-xl border border-[#4D3023] text-2xl text-[#F6EFE4]"
                  >
                    +
                  </button>
                </div>
                <button onClick={() => allocate(p.id, p.name)} disabled={busy} className={primaryBtn}>
                  {busy
                    ? 'Tildeler…'
                    : kjop
                      ? `Gi ${count} årer (${count * session.price_per_lodd} kr)`
                      : `Gi ${count} lodd`}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <button onClick={toggleHistory} className={`${ghostBtn} text-sm`}>
        {allocations ? 'Skjul tildelinger' : 'Vis tildelinger (angre)'}
      </button>
      {allocations && (
        <ul className="flex flex-col gap-2">
          {allocations.map((a) => (
            <li
              key={a.id}
              className={`flex items-center justify-between rounded-xl border border-[#4D3023] bg-[#251310] px-4 py-2.5 text-sm ${
                a.revoked ? 'opacity-50' : ''
              }`}
            >
              <span className="text-[#F6EFE4]">
                {nameOf(a.player_id)}: {a.count} stk (nr. {a.from_number}–{a.to_number})
                {a.revoked && ' — angret'}
                {session.trekning === 'runder' && ` · runde ${a.round}`}
              </span>
              {!a.revoked && (
                <button onClick={() => revoke(a)} className="px-2 py-1 text-[#C0503F]">
                  Angre
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Premier ──────────────────────────────────────────────────────────────────

function PrizesTab({
  call,
  prizes,
  revealedDraws,
}: {
  call: (fn: string, args?: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  prizes: Prize[]
  revealedDraws: ReturnType<typeof useSession>['revealedDraws']
}) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const winnerOf = (prizeId: string) =>
    revealedDraws.findLast?.((d) => d.prize_id === prizeId && !d.voided) ??
    [...revealedDraws].reverse().find((d) => d.prize_id === prizeId && !d.voided)

  async function add() {
    const n = name.trim()
    if (!n) return
    if (await call('add_prize', { p_name: n })) setName('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={`${card} flex gap-2`}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Ny premie"
          maxLength={80}
          className={input}
        />
        <button onClick={add} className={`${ghostBtn} shrink-0`}>
          Legg til
        </button>
      </div>
      <ol className="flex flex-col gap-2">
        {prizes.map((p, i) => {
          const w = winnerOf(p.id)
          return (
            <li key={p.id} className={card}>
              {editing === p.id ? (
                <div className="flex gap-2">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={80}
                    className={input}
                  />
                  <button
                    onClick={async () => {
                      if (await call('update_prize', { p_prize_id: p.id, p_name: editName.trim() }))
                        setEditing(null)
                    }}
                    className={`${primaryBtn} shrink-0 py-2`}
                  >
                    Lagre
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#F6EFE4]">
                      <span className="mr-2 text-[#BA9F8D]">{i + 1}.</span>
                      {p.name}
                    </p>
                    {w ? (
                      <p className="text-sm text-[#6B9460]">
                        Vunnet av {w.player_name} (åre {w.lot_number})
                      </p>
                    ) : (
                      p.description && <p className="text-sm text-[#BA9F8D]">{p.description}</p>
                    )}
                  </div>
                  {!w && (
                    <div className="flex shrink-0 gap-1">
                      <IconBtn label="Flytt opp" onClick={() => call('move_prize', { p_prize_id: p.id, p_direction: 'up' })}>↑</IconBtn>
                      <IconBtn label="Flytt ned" onClick={() => call('move_prize', { p_prize_id: p.id, p_direction: 'down' })}>↓</IconBtn>
                      <IconBtn label="Endre navn" onClick={() => { setEditing(p.id); setEditName(p.name) }}>✎</IconBtn>
                      <IconBtn label="Slett" danger onClick={() => call('delete_prize', { p_prize_id: p.id })}>✕</IconBtn>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {prizes.length === 0 && (
        <p className="text-center text-sm text-[#BA9F8D]">Ingen premier ennå.</p>
      )}
    </div>
  )
}

function IconBtn({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`h-11 w-11 rounded-lg border text-base ${
        danger ? 'border-[#C0503F] text-[#C0503F]' : 'border-[#4D3023] text-[#BA9F8D]'
      }`}
    >
      {children}
    </button>
  )
}

// ── Trekning ─────────────────────────────────────────────────────────────────

function DrawTab({
  call,
  session,
  prizes,
  revealedDraws,
  roundLots,
  setNotice,
}: {
  call: (fn: string, args?: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  session: NonNullable<ReturnType<typeof useSession>['session']>
  prizes: Prize[]
  revealedDraws: ReturnType<typeof useSession>['revealedDraws']
  roundLots: ReturnType<typeof useSession>['lots']
  setNotice: (s: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<DrawLogEntry[] | null>(null)
  const reveal = currentReveal(session, revealedDraws)

  const wonPrizeIds = useMemo(
    () => new Set(revealedDraws.filter((d) => !d.voided).map((d) => d.prize_id)),
    [revealedDraws]
  )
  const nextPrize = prizes.find((p) => !wonPrizeIds.has(p.id))
  const poolNumbers = useMemo(
    () => roundLots.filter((l) => !l.removed).map((l) => l.number),
    [roundLots]
  )

  async function run(fn: string, args: Record<string, unknown> = {}) {
    setBusy(true)
    const r = await call(fn, args)
    setBusy(false)
    return r
  }

  async function voidAndRedraw() {
    if (!reveal) return
    const v = await run('void_draw', { p_draw_id: reveal.draw_id, p_reason: 'Ikke til stede' })
    if (!v) return
    const r = await run('start_draw', { p_prize_id: reveal.prize_id })
    if (r) setNotice('Trekker på nytt — forrige trekning er loggført som annullert.')
  }

  async function toggleLog() {
    if (log) return setLog(null)
    const r = await call('get_draw_log')
    if (r) setLog((r.draws ?? []) as DrawLogEntry[])
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Live state panel */}
      {session.draw_state === 'spinning' && (
        <div className={`${card} flex flex-col items-center gap-4 py-6`}>
          <NumberRoller numbers={poolNumbers} />
          <button onClick={() => run('reveal_draw')} disabled={busy} className={`${primaryBtn} w-full`}>
            Avslør vinneren
          </button>
        </div>
      )}
      {session.draw_state === 'revealed' && reveal && (
        <div className={`${card} flex flex-col items-center gap-4 py-6`}>
          <WinnerCard draw={reveal} />
          <div className="flex w-full gap-2">
            <button onClick={() => run('acknowledge_draw')} disabled={busy} className={`${primaryBtn} flex-1`}>
              {session.trekning === 'runder' ? 'Neste runde' : 'Neste'}
            </button>
            <button onClick={voidAndRedraw} disabled={busy} className={`${dangerBtn} flex-1 text-sm`}>
              Ikke til stede — trekk på nytt
            </button>
          </div>
        </div>
      )}

      {session.draw_state === 'idle' && session.phase === 'open' && (
        <div className={`${card} flex flex-col gap-3`}>
          {nextPrize ? (
            <>
              <p className="text-sm text-[#BA9F8D]">Neste premie:</p>
              <p className="text-xl font-semibold text-[#F6EFE4]">{nextPrize.name}</p>
              <p className="text-sm text-[#BA9F8D]">
                {poolNumbers.length} {session.tildeling === 'kjop' ? 'årer' : 'lodd'} i potten
                {session.trekning === 'runder' && ` (runde ${session.current_round})`}
              </p>
              <button
                onClick={() => run('start_draw', { p_prize_id: nextPrize.id })}
                disabled={busy || poolNumbers.length === 0}
                className={primaryBtn}
              >
                Trekk «{nextPrize.name}»
              </button>
              {poolNumbers.length === 0 && (
                <p className="text-sm text-[#C0503F]">Ingen årer i potten ennå.</p>
              )}
            </>
          ) : (
            <p className="text-center text-sm text-[#BA9F8D]">
              {prizes.length === 0
                ? 'Legg til premier under «Premier»-fanen først.'
                : 'Alle premier er trukket! 🎉'}
            </p>
          )}
        </div>
      )}

      {/* Results so far */}
      {revealedDraws.length > 0 && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-medium text-[#BA9F8D]">Vinnere så langt</h3>
          <ul className="flex flex-col gap-1.5">
            {[...revealedDraws].reverse().map((d) => (
              <li key={d.draw_id} className={`text-sm ${d.voided ? 'line-through opacity-50' : ''}`}>
                <span className="text-[#F0B243]">{d.prize_name}</span>{' '}
                <span className="text-[#F6EFE4]">
                  → {d.player_name} (åre {d.lot_number})
                </span>
                {d.voided && <span className="text-[#BA9F8D]"> · annullert</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button onClick={toggleLog} className={`${ghostBtn} text-sm`}>
        {log ? 'Skjul full logg' : 'Vis full logg (kontroll)'}
      </button>
      {log && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-[#4D3023] bg-[#251310] p-4 text-xs text-[#BA9F8D]">
          {log.map((d) => (
            <li key={d.draw_id}>
              {new Date(d.created_at).toLocaleTimeString('no')} — {d.prize_name}: åre {d.lot_number}{' '}
              ({d.player_name}){d.voided && ` · ANNULLERT${d.void_reason ? `: ${d.void_reason}` : ''}`}
              {!d.revealed && ' · ikke avslørt'}
            </li>
          ))}
          {log.length === 0 && <li>Ingen trekninger ennå.</li>}
        </ul>
      )}
    </div>
  )
}

// ── Innstillinger ────────────────────────────────────────────────────────────

function SettingsTab({
  call,
  session,
  sessionId,
  setNotice,
}: {
  call: (fn: string, args?: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  session: NonNullable<ReturnType<typeof useSession>['session']>
  sessionId: string
  setNotice: (s: string) => void
}) {
  const [vipps, setVipps] = useState(session.vipps_number ?? '')
  const [link, setLink] = useState(session.vipps_link ?? '')
  const [price, setPrice] = useState(session.price_per_lodd)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  async function save() {
    const r = await call('update_settings', {
      p_vipps_number: vipps.trim() || null,
      p_vipps_link: link.trim() || null,
      p_price: price,
    })
    if (r) setNotice('Innstillingene er lagret.')
  }

  return (
    <div className="flex flex-col gap-3">
      {session.tildeling === 'kjop' && (
        <div className={`${card} flex flex-col gap-3`}>
          <h3 className="text-sm font-medium text-[#BA9F8D]">Vipps</h3>
          <label className="text-sm text-[#BA9F8D]">
            Vippsnummer
            <input value={vipps} onChange={(e) => setVipps(e.target.value)} className={`${input} mt-1`} />
          </label>
          <label className="text-sm text-[#BA9F8D]">
            Vipps-lenke (QR på storskjerm)
            <input value={link} onChange={(e) => setLink(e.target.value)} className={`${input} mt-1`} />
          </label>
          <label className="text-sm text-[#BA9F8D]">
            Pris per åre (kr)
            <input
              type="number"
              min={0}
              max={10000}
              value={price}
              onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
              className={`${input} mt-1`}
            />
          </label>
          <button onClick={save} className={primaryBtn}>
            Lagre
          </button>
        </div>
      )}

      <div className={`${card} flex flex-col gap-2 text-sm text-[#BA9F8D]`}>
        <h3 className="font-medium">Lenker</h3>
        <p>
          Deltakere: <span className="text-[#F6EFE4]">{appUrl || 'basar.sundaysuite.app'}</span> — kode{' '}
          <span className="font-bold tracking-widest text-[#F6EFE4]">{session.code}</span>
        </p>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(`${appUrl}/host/${sessionId}/projector`)
            setNotice('Storskjerm-lenken er kopiert.')
          }}
          className={`${ghostBtn} text-sm`}
        >
          Kopier storskjerm-lenke
        </button>
      </div>

      <div className={`${card} flex flex-col gap-2`}>
        <h3 className="text-sm font-medium text-[#BA9F8D]">Avslutt</h3>
        {session.phase === 'ended' ? (
          <p className="text-sm text-[#BA9F8D]">Basaren er avsluttet.</p>
        ) : confirmEnd ? (
          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (await call('end_session')) setNotice('Basaren er avsluttet.')
                setConfirmEnd(false)
              }}
              className={`${dangerBtn} flex-1`}
            >
              Ja, avslutt basaren
            </button>
            <button onClick={() => setConfirmEnd(false)} className={`${ghostBtn} flex-1`}>
              Avbryt
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmEnd(true)} className={dangerBtn}>
            Avslutt basaren
          </button>
        )}
      </div>
    </div>
  )
}
