'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { createAuthBrowserClient } from '@/lib/supabase/auth-browser'
import { host } from '@/lib/locale/host'

const t = host.login

const card = 'rounded-2xl border border-[#4D3023] bg-[#36211A] p-5'
const input =
  'rounded-xl border border-[#4D3023] bg-[#251310] px-4 py-3 text-[#F6EFE4] placeholder:text-[#7d6a5d] w-full'
const primaryBtn =
  'min-h-12 w-full rounded-xl bg-[#F0B243] px-4 py-3 font-semibold text-[#251310] transition-opacity disabled:opacity-50'
const ghostBtn =
  'min-h-12 w-full rounded-xl border border-[#4D3023] px-4 py-3 font-medium text-[#BA9F8D]'

function HostLoginInner() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const params = useSearchParams()
  const authError = params.get('error') === 'auth'

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const supabase = createAuthBrowserClient()
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
      setSent(true)
    } catch {
      setError(t.error)
    } finally {
      setBusy(false)
    }
  }

  async function signInWithGoogle() {
    const supabase = createAuthBrowserClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="animate-fade-in w-full">
        <div className="mb-8 text-center">
          <div className="mb-2 inline-block text-5xl" aria-hidden>
            🎟️
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-[#F0B243]">
            SundayBasar
          </h1>
          <h2 className="mt-3 text-lg font-medium text-[#F6EFE4]">{t.title}</h2>
          <p className="mt-1 text-sm text-[#BA9F8D]">{t.lede}</p>
        </div>

        {(error || authError) && (
          <p className="mb-4 text-center text-sm text-[#C0503F]">
            {error ?? t.authError}
          </p>
        )}

        <div className={`${card} flex flex-col gap-3`}>
          {sent ? (
            <div>
              <p className="font-medium text-[#F6EFE4]">{t.sentTitle}</p>
              <p className="mt-1 text-sm text-[#BA9F8D]">{t.sentBody(email)}</p>
            </div>
          ) : (
            <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
              <label className="text-sm text-[#BA9F8D]">
                {t.emailLabel}
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  autoComplete="email"
                  className={`${input} mt-1`}
                />
              </label>
              <button className={primaryBtn} disabled={busy}>
                {busy ? t.sending : t.sendMagicLink}
              </button>
            </form>
          )}
        </div>

        <div className="my-4 text-center text-xs uppercase tracking-wide text-[#7d6a5d]">
          {t.or}
        </div>

        <button onClick={signInWithGoogle} className={ghostBtn}>
          {t.google}
        </button>

        <p className="mt-6 text-center text-xs text-[#7d6a5d]">{t.note}</p>

        <div className="mt-4 text-center">
          <Link href="/" className="text-sm text-[#BA9F8D] underline">
            {t.backToStart}
          </Link>
        </div>
      </div>
    </main>
  )
}

export default function HostLoginPage() {
  return (
    <Suspense fallback={null}>
      <HostLoginInner />
    </Suspense>
  )
}
