'use client'

import { useEffect } from 'react'

/** Holder skjermen våken mens tavlevisning er på (projektor/TV skal ikke
 * dimme). Låsen slippes av nettleseren når fanen skjules, så vi tar den på
 * nytt når den blir synlig igjen. Feiler stille der API-et mangler. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let stopped = false
    const take = async () => {
      try {
        const l = await navigator.wakeLock.request('screen')
        if (stopped) void l.release().catch(() => {})
        else lock = l
      } catch {
        // Nektet (lavt batteri, skjult fane) — ikke kritisk.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void take()
    }
    void take()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [enabled])
}
