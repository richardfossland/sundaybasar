'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ensureHostId, setHostSecret } from '@/lib/identity'
import type { Tildeling, Trekning } from '@/types/game'
import { ErrorText } from '@/components/ErrorText'

interface PrizeDraft {
  name: string
  description: string
}

const card = 'rounded-2xl border border-border bg-surface p-5'
const input =
  'rounded-xl border border-border bg-bg px-4 py-3 text-text placeholder:text-faint w-full'
const primaryBtn =
  'min-h-12 rounded-xl bg-gold px-4 py-3 font-semibold text-bg transition-opacity disabled:opacity-50'
const ghostBtn =
  'min-h-12 rounded-xl border border-border px-4 py-3 font-medium text-muted'

function Choice({
  selected,
  onSelect,
  title,
  badge,
  children,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        selected ? 'border-gold bg-[#3f2417]' : 'border-border bg-bg'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-text">{title}</span>
        {badge && (
          <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-bg">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </button>
  )
}

export default function NewBasar() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [tildeling, setTildeling] = useState<Tildeling>('kjop')
  const [trekning, setTrekning] = useState<Trekning>('klassisk')
  const [vippsNumber, setVippsNumber] = useState('')
  const [vippsLink, setVippsLink] = useState('')
  const [price, setPrice] = useState(10)
  const [gratisLodd, setGratisLodd] = useState(5)
  const [prizes, setPrizes] = useState<PrizeDraft[]>([])
  const [prizeName, setPrizeName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function addPrizeDraft() {
    const n = prizeName.trim()
    if (!n) return
    setPrizes((p) => [...p, { name: n, description: '' }])
    setPrizeName('')
  }

  async function create() {
    setError('')
    if (tildeling === 'kjop' && !vippsNumber.trim()) {
      setStep(1)
      return setError('Fyll inn Vippsnummeret menigheten bruker.')
    }
    setBusy(true)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('create_session', {
      p_host_id: ensureHostId(),
      p_tildeling: tildeling,
      p_trekning: trekning,
      p_vipps_number: vippsNumber.trim() || null,
      p_vipps_link: vippsLink.trim() || null,
      p_price: price,
      p_gratis_lodd: gratisLodd,
    })
    if (error || !data?.ok) {
      setBusy(false)
      return setError(error?.message ?? data?.error ?? 'Kunne ikke opprette basaren.')
    }
    setHostSecret(data.session_id, data.host_secret)
    // Add wizard prizes (best effort — they can also be added from the panel).
    for (const p of prizes) {
      await supabase.rpc('add_prize', {
        p_session_id: data.session_id,
        p_host_secret: data.host_secret,
        p_name: p.name,
        p_description: p.description || null,
      })
    }
    router.push(`/host/${data.session_id}`)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <div className="animate-fade-in">
        <Link href="/" className="text-sm text-muted underline">
          ← Tilbake
        </Link>
        <h1 className="mt-3 font-display text-3xl font-bold text-gold">Ny basar</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Steg {step} av 3</p>

        {step === 1 && (
          <div className={`${card} flex flex-col gap-3`}>
            <h2 className="font-medium text-text">Hvordan får folk årer?</h2>
            <Choice
              selected={tildeling === 'kjop'}
              onSelect={() => setTildeling('kjop')}
              title="Kjøp med Vipps"
              badge="Vanligst"
            >
              Folk vippser til menigheten — du ser betalingen på din telefon og deler ut
              årer med ett trykk. Appen rører aldri pengene.
            </Choice>
            <Choice
              selected={tildeling === 'gratis'}
              onSelect={() => setTildeling('gratis')}
              title="Gratis lodd"
            >
              Alle som blir med får automatisk like mange lodd. Ren premietrekning uten
              penger.
            </Choice>

            {tildeling === 'kjop' ? (
              <div className="mt-2 flex flex-col gap-3">
                <label className="text-sm text-muted">
                  Vippsnummer (menighetens)
                  <input
                    value={vippsNumber}
                    onChange={(e) => setVippsNumber(e.target.value)}
                    placeholder="f.eks. 123456"
                    inputMode="numeric"
                    className={`${input} mt-1`}
                  />
                </label>
                <label className="text-sm text-muted">
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
                <label className="text-sm text-muted">
                  Vipps-lenke (valgfri — gir QR-kode på storskjermen)
                  <input
                    value={vippsLink}
                    onChange={(e) => setVippsLink(e.target.value)}
                    placeholder="https://qr.vipps.no/…"
                    className={`${input} mt-1`}
                  />
                </label>
              </div>
            ) : (
              <label className="mt-2 text-sm text-muted">
                Lodd per deltaker
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={gratisLodd}
                  onChange={(e) =>
                    setGratisLodd(Math.min(100, Math.max(1, Number(e.target.value) || 1)))
                  }
                  className={`${input} mt-1`}
                />
              </label>
            )}
          </div>
        )}

        {step === 2 && (
          <div className={`${card} flex flex-col gap-3`}>
            <h2 className="font-medium text-text">Hvordan trekkes vinnerne?</h2>
            <Choice
              selected={trekning === 'klassisk'}
              onSelect={() => setTrekning('klassisk')}
              title="Klassisk"
              badge="Anbefalt"
            >
              Årene gjelder hele kvelden. Hver premie trekkes blant alle solgte årer —
              samme åre kan vinne flere ganger. Slik basaren på bedehuset alltid var.
            </Choice>
            <Choice
              selected={trekning === 'vinner_ut'}
              onSelect={() => setTrekning('vinner_ut')}
              title="Vinner tas ut"
            >
              Som klassisk, men en åre som vinner tas ut av potten — ingen vinner to
              ganger på samme åre.
            </Choice>
            <Choice
              selected={trekning === 'runder'}
              onSelect={() => setTrekning('runder')}
              title="Runde-basert"
            >
              Hver premie er sin egen runde med eget åresalg. Årene nullstilles mellom
              rundene.
            </Choice>
          </div>
        )}

        {step === 3 && (
          <div className={`${card} flex flex-col gap-3`}>
            <h2 className="font-medium text-text">Premier</h2>
            <p className="text-sm text-muted">
              Legg inn premiene nå, eller hopp over og legg dem til underveis.
            </p>
            <div className="flex gap-2">
              <input
                value={prizeName}
                onChange={(e) => setPrizeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPrizeDraft()}
                placeholder="f.eks. Hjemmebakt kake"
                maxLength={80}
                className={input}
              />
              <button onClick={addPrizeDraft} className={`${ghostBtn} shrink-0`}>
                Legg til
              </button>
            </div>
            {prizes.length > 0 && (
              <ol className="flex flex-col gap-2">
                {prizes.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-xl border border-border bg-bg px-4 py-2.5"
                  >
                    <span>
                      <span className="mr-2 text-muted">{i + 1}.</span>
                      {p.name}
                    </span>
                    <button
                      onClick={() => setPrizes((cur) => cur.filter((_, j) => j !== i))}
                      aria-label={`Fjern ${p.name}`}
                      className="px-2 py-1 text-red"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <ErrorText className="mt-3">{error}</ErrorText>

        <div className="mt-6 flex gap-3">
          {step > 1 && (
            <button onClick={() => setStep(step - 1)} className={`${ghostBtn} flex-1`}>
              Tilbake
            </button>
          )}
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)} className={`${primaryBtn} flex-1`}>
              Neste
            </button>
          ) : (
            <button onClick={create} disabled={busy} className={`${primaryBtn} flex-1`}>
              {busy ? 'Oppretter…' : 'Start basaren'}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
