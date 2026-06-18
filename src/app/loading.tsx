// Route-level loading UI — a calm branded spinner while a page resolves.
export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <div className="animate-pulse-gold text-5xl" aria-hidden>
        🎟️
      </div>
      <p className="text-sm text-muted" aria-live="polite">
        Laster basaren…
      </p>
    </main>
  )
}
