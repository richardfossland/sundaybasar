// Trailing-edge coalescer — PURE (no React), unit-tested.
//
// Realtime `postgres_changes` fires ONE callback PER ROW. Allocating five årer
// inserts five `lots` rows, so every subscribed client used to refetch the
// whole lots table five times in ~50 ms — for every allocation, on every
// phone in the room. Wrapping the refetch in a coalescer turns a burst of N
// change notifications into a single fetch `waitMs` after the last one.
export interface Coalescer {
  /** Schedule `fn`; repeated calls inside the window collapse into one. */
  trigger: () => void
  /** Drop a pending call (on unmount). */
  cancel: () => void
  /** Run now if pending (e.g. before a full refresh) — otherwise a no-op. */
  flush: () => void
}

export function createCoalescer(fn: () => void, waitMs: number): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = () => {
    timer = null
    fn()
  }
  return {
    trigger() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(run, waitMs)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        run()
      }
    },
  }
}
