import { kr } from '@/types/auction'

/**
 * Fundraising thermometer for the auction — total raised, optionally against a
 * goal. Shared by the host console, projector and bidder view.
 */
export function Thermometer({
  raised,
  goal,
  big = false,
}: {
  raised: number
  goal: number | null | undefined
  big?: boolean
}) {
  const hasGoal = !!goal && goal > 0
  const pct = hasGoal ? Math.min(100, Math.round((raised / (goal as number)) * 100)) : 0
  return (
    <div className={`rounded-2xl border border-border bg-surface ${big ? 'p-6' : 'p-4'}`}>
      <div className={`flex items-baseline justify-between ${big ? 'text-2xl' : 'text-sm'}`}>
        <span className="text-muted">Samlet inn</span>
        <span className="font-semibold text-gold">
          {kr(raised)}
          {hasGoal && <span className="text-muted"> / {kr(goal)}</span>}
        </span>
      </div>
      {hasGoal && (
        <div className={`mt-2 overflow-hidden rounded-full bg-bg ${big ? 'h-5' : 'h-3'}`}>
          <div
            className="h-full rounded-full bg-gold transition-all duration-500"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </div>
  )
}
