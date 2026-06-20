'use client'

import { useEffect, useState } from 'react'

/**
 * Ticking clock for the descending dutch price / countdowns. Starts at 0 (so SSR
 * and first client render agree → no hydration mismatch), then updates every
 * `intervalMs`. The dutch price helper treats nowMs=0 as "not elapsed yet".
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
