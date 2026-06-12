'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getIdentity, setIdentity } from '@/lib/identity'

function LandingInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [existingSession, setExistingSession] = useState<string | null>(null)

  useEffect(() => {
    const k = params.get('kode')
    if (k) setCode(k.toUpperCase().slice(0, 4))
    const id = getIdentity()
    if (id.playerId && id.sessionId) setExistingSession(id.sessionId)
  }, [params])

  async function join() {
    setError('')
    if (!code.trim() || !name.trim()) return setError('Fyll inn kode og navn.')
    setBusy(true)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('join_session', {
      p_code: code.trim().toUpperCase(),
      p_name: name.trim(),
    })
    setBusy(false)
    if (error) return setError(error.message)
    if (!data?.ok) return setError(data?.error ?? 'Kunne ikke bli med.')
    setIdentity(data.player_id, data.session_id, data.secret)
    router.push(`/game/${data.session_id}`)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-10">
      <div className="animate-fade-in w-full">
        <div className="mb-8 text-center">
          <div className="mb-2 inline-block animate-wiggle text-5xl" aria-hidden>🎟️</div>
          <h1 className="text-4xl font-semibold tracking-tight text-[#F0B243]">SundayBasar</h1>
          <p className="mt-2 text-sm text-[#BA9F8D]">
            Kjøp årer, vinn premier — basar slik du husker den.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-[#4D3023] bg-[#36211A] p-5">
          <h2 className="text-sm font-medium text-[#BA9F8D]">Bli med på basaren</h2>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="Kode (4 bokstaver)"
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            className="rounded-xl border border-[#4D3023] bg-[#251310] px-4 py-3 text-center text-2xl font-semibold tracking-[0.4em] text-[#F6EFE4] placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-[#7d6a5d]"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Navnet ditt"
            maxLength={40}
            className="rounded-xl border border-[#4D3023] bg-[#251310] px-4 py-3 text-[#F6EFE4] placeholder:text-[#7d6a5d]"
          />
          <button
            onClick={join}
            disabled={busy}
            className="min-h-12 rounded-xl bg-[#F0B243] px-4 py-3 font-semibold text-[#251310] transition-opacity disabled:opacity-50"
          >
            {busy ? 'Blir med…' : 'Bli med'}
          </button>
          {error && <p className="text-sm text-[#C0503F]">{error}</p>}
          {existingSession && (
            <Link href={`/game/${existingSession}`} className="text-center text-sm text-[#BA9F8D] underline">
              Fortsett der du var
            </Link>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/host/new"
            className="text-sm text-[#BA9F8D] underline underline-offset-4 hover:text-[#F0B243]"
          >
            Skal du styre basaren? Start en ny her
          </Link>
        </div>
      </div>
    </main>
  )
}

export default function Landing() {
  return (
    <Suspense>
      <LandingInner />
    </Suspense>
  )
}
