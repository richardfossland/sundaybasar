// ── SundayBasar — synthesized draw sound effects (Web Audio, no assets) ──────
//
// All SFX are generated on the fly with the Web Audio API so the bundle ships
// no audio files. Everything is best-effort and SSR-safe: if there is no
// AudioContext, or the browser blocks audio until a user gesture, the calls
// degrade to silence and never throw. The projector arms the context on the
// host's first interaction (the "Lyd på" toggle), satisfying autoplay rules.

let ctx: AudioContext | null = null
let muted = false

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext }

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (muted) return null
  if (ctx) return ctx
  const Ctor =
    window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext ?? null
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/** Call from a user gesture (e.g. the host's "Lyd på" click) to unlock audio. */
export function armAudio(): void {
  muted = false
  const c = getCtx()
  if (c && c.state === 'suspended') void c.resume().catch(() => {})
}

export function setMuted(value: boolean): void {
  muted = value
  if (value && ctx) void ctx.suspend().catch(() => {})
  if (!value) armAudio()
}

export function isMuted(): boolean {
  return muted
}

/** One short blip — used per reel tick while spinning. */
export function playTick(): void {
  const c = getCtx()
  if (!c) return
  try {
    const t = c.currentTime
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(880, t)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.07)
  } catch {
    /* best effort */
  }
}

/** Rising sweep while the reel decelerates toward the winner. */
export function playLanding(durationMs: number): void {
  const c = getCtx()
  if (!c) return
  try {
    const t = c.currentTime
    const dur = Math.max(0.3, durationMs / 1000)
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(220, t)
    osc.frequency.exponentialRampToValueAtTime(660, t + dur)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.07, t + 0.05)
    gain.gain.setValueAtTime(0.07, t + dur - 0.1)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  } catch {
    /* best effort */
  }
}

/** Triumphant little arpeggio when the winner card pops. */
export function playFanfare(): void {
  const c = getCtx()
  if (!c) return
  try {
    const base = c.currentTime
    // C5 E5 G5 C6 — a bright major arpeggio.
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, i) => {
      const t = base + i * 0.12
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(freq, t)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
      osc.connect(gain).connect(c.destination)
      osc.start(t)
      osc.stop(t + 0.5)
    })
  } catch {
    /* best effort */
  }
}
