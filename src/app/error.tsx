'use client'

// Route-level error boundary — a transient render/runtime error shows a
// friendly recovery screen instead of a blank, unrecoverable page.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10 text-center">
      <div className="animate-fade-in flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8">
        <div className="text-5xl" aria-hidden>
          🎟️
        </div>
        <h1 className="font-display text-2xl font-bold text-gold">Noe gikk galt</h1>
        <p className="text-sm text-muted">
          Prøv på nytt — basaren er trygt lagret på serveren.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => reset()}
            className="min-h-12 rounded-xl bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Prøv igjen
          </button>
          <a
            href="/"
            className="min-h-12 rounded-xl border border-border px-5 py-3 font-medium text-muted transition-colors hover:text-gold"
          >
            Til forsiden
          </a>
        </div>
      </div>
    </main>
  )
}
