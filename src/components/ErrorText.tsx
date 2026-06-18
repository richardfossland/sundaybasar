/**
 * Small, consistent inline error message. Use instead of a bare
 * <p className="text-sm text-red"> so every form error in the app looks
 * the same: a soft-red bordered pill on a dark wash, AA-readable on walnut.
 */
export function ErrorText({
  children,
  className = '',
  role = 'alert',
}: {
  children: React.ReactNode
  className?: string
  role?: 'alert' | 'status'
}) {
  if (!children) return null
  return (
    <p
      role={role}
      className={`rounded-xl border border-red bg-[#3a1d18] px-4 py-2.5 text-sm text-red-soft ${className}`.trim()}
    >
      {children}
    </p>
  )
}
