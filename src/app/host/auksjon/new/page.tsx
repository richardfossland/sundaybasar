'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ensureHostId, setHostSecret } from '@/lib/identity'
import { ErrorText } from '@/components/ErrorText'

const card = 'rounded-2xl border border-border bg-surface p-5'
const input =
  'rounded-xl border border-border bg-bg px-4 py-3 text-text placeholder:text-faint w-full'
const primaryBtn =
  'min-h-12 rounded-xl bg-gold px-4 py-3 font-semibold text-bg transition-opacity disabled:opacity-50'

export default function NewAuksjon() {
  const router = useRouter()
  const [goal, setGoal] = useState('')
  const [vippsNumber, setVippsNumber] = useState('')
  const [vippsLink, setVippsLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setBusy(true)
    setError('')
    const supabase = createClient()
    const { data, error } = await supabase.rpc('create_auction_session', {
      p_host_id: ensureHostId(),
      p_goal_amount: goal.trim() ? Number(goal) : null,
      p_vipps_number: vippsNumber.trim() || null,
      p_vipps_link: vippsLink.trim() || null,
    })
    if (error || !data?.ok) {
      setBusy(false)
      return setError(error?.message ?? data?.error ?? 'Kunne ikke lage auksjon.')
    }
    setHostSecret(data.session_id, data.host_secret)
    // Stamp ownership for the Sunday Account dashboard (best-effort, like basar).
    void fetch('/api/host/basars/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: data.session_id }),
    }).catch(() => {})
    router.push(`/host/auksjon/${data.session_id}`)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-5 py-8">
      <header>
        <Link href="/host/new" className="text-sm text-muted">
          ← Lag basar i stedet
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gold">🔨 Ny auksjon</h1>
        <p className="text-sm text-muted">
          Opprett auksjonen nå — objektene legger du til etterpå i vertspanelet.
        </p>
      </header>

      <div className={`${card} flex flex-col gap-4`}>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Innsamlingsmål (kr) — valgfritt</span>
          <input
            className={input}
            inputMode="numeric"
            value={goal}
            onChange={(e) => setGoal(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="f.eks. 10000"
          />
          <span className="text-xs text-faint">Viser et termometer mot målet på storskjerm.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Vipps-nummer — valgfritt</span>
          <input
            className={input}
            inputMode="numeric"
            value={vippsNumber}
            onChange={(e) => setVippsNumber(e.target.value)}
            placeholder="12345"
          />
          <span className="text-xs text-faint">Vinnere får beskjed om å vippse beløpet hit.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Vipps-lenke (for QR) — valgfritt</span>
          <input
            className={input}
            value={vippsLink}
            onChange={(e) => setVippsLink(e.target.value)}
            placeholder="https://qr.vipps.no/…"
          />
        </label>

        {error && <ErrorText>{error}</ErrorText>}
        <button className={primaryBtn} onClick={create} disabled={busy}>
          {busy ? 'Lager…' : 'Lag auksjon'}
        </button>
      </div>
    </main>
  )
}
