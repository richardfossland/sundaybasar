import Link from 'next/link'

// 404 — a friendly off-ramp back to the basar landing.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10 text-center">
      <div className="animate-fade-in flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8">
        <div className="text-5xl" aria-hidden>
          🎟️
        </div>
        <p className="font-display text-5xl font-bold text-gold">404</p>
        <h1 className="text-xl font-semibold text-text">Fant ikke siden</h1>
        <p className="text-sm text-muted">
          Lenken kan være utløpt, eller basaren er avsluttet.
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex min-h-12 items-center rounded-xl bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90"
        >
          Til forsiden
        </Link>
      </div>
    </main>
  )
}
