'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { createAuthBrowserClient } from '@/lib/supabase/auth-browser'
import type { OwnedBasarSummary } from '@/lib/server/host-basars'
import { host } from '@/lib/locale/host'

const t = host.dashboard

const card = 'rounded-2xl border border-[#4D3023] bg-[#36211A] p-4'
const primaryBtn =
  'min-h-12 inline-flex items-center justify-center rounded-xl bg-[#F0B243] px-4 font-semibold text-[#251310] transition-opacity disabled:opacity-50'
const ghostBtn =
  'min-h-11 inline-flex items-center justify-center rounded-xl border border-[#4D3023] px-4 font-medium text-[#BA9F8D]'
const dangerBtn =
  'min-h-11 inline-flex items-center justify-center rounded-xl border border-[#C0503F] px-4 font-medium text-[#C0503F] disabled:opacity-40'

export function HostDashboard({
  email,
  basars,
}: {
  email: string
  basars: OwnedBasarSummary[]
}) {
  const router = useRouter()
  const [rows, setRows] = useState(basars)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onDelete(basar: OwnedBasarSummary) {
    if (!window.confirm(t.confirmDelete(basar.code))) return
    setDeletingId(basar.id)
    setError(null)
    try {
      const res = await fetch('/api/host/basars', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: basar.id }),
      })
      if (!res.ok) throw new Error('delete_failed')
      setRows((prev) => prev.filter((b) => b.id !== basar.id))
    } catch {
      setError(t.deleteFailed)
    } finally {
      setDeletingId(null)
    }
  }

  async function signOut() {
    try {
      const supabase = createAuthBrowserClient()
      await supabase.auth.signOut()
    } finally {
      router.replace('/host/login')
      router.refresh()
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-8">
      <div className="animate-fade-in w-full">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold text-[#F0B243]">
            SundayBasar
          </Link>
          <button onClick={signOut} className="text-sm text-[#BA9F8D] underline">
            {t.signOut}
          </button>
        </div>

        <h1 className="text-2xl font-semibold text-[#F6EFE4]">{t.title}</h1>
        <p className="mt-1 text-sm text-[#BA9F8D]">{t.lede}</p>
        <p className="mt-1 text-xs text-[#7d6a5d]">{t.signedInAs(email)}</p>

        <Link href="/host/new" className={`${primaryBtn} mt-5 w-full py-3`}>
          {t.createNew}
        </Link>

        {error && <p className="mt-4 text-sm text-[#C0503F]">{error}</p>}

        {rows.length === 0 ? (
          <div className={`${card} mt-5`}>
            <p className="text-sm text-[#BA9F8D]">{t.empty}</p>
          </div>
        ) : (
          <ul className="mt-5 flex flex-col gap-3">
            {rows.map((basar) => (
              <li
                key={basar.id}
                className={`${card} flex items-center justify-between gap-3`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold tracking-[0.2em] text-[#F6EFE4]">
                      {basar.code}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        basar.phase === 'open'
                          ? 'bg-[#3f2417] text-[#F0B243]'
                          : 'bg-[#251310] text-[#BA9F8D]'
                      }`}
                    >
                      {basar.phase === 'open' ? t.statusOpen : t.statusEnded}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#BA9F8D]">
                    {t.players(basar.playerCount)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link href={`/host/${basar.id}`} className={ghostBtn}>
                    {t.open}
                  </Link>
                  <button
                    onClick={() => onDelete(basar)}
                    disabled={deletingId === basar.id}
                    className={dangerBtn}
                    aria-label={`${t.delete} ${basar.code}`}
                  >
                    {deletingId === basar.id ? t.deleting : t.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
