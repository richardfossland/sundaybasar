'use client'

import { useEffect } from 'react'
import { useHideCursor } from './useHideCursor'
import { usePresentasjon, settPresentasjon } from './usePresentasjon'
import { useWakeLock } from './useWakeLock'
import { tekst } from './tekst'
import './storskjerm.css'

function toggleFullskjerm() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  else void document.documentElement.requestFullscreen?.().catch(() => {})
}

/** Ramme rundt storskjerm-ruta (projektor). Utenfor `?visning=tavle` slipper
 * den bare barna gjennom. I tavlevisning: rot-klasse `presentasjon`, skjult
 * peker, skjerm våken, F = fullskjerm og en nesten usynlig «Avslutt»-knapp. */
export function TavleRamme({ children }: { children: React.ReactNode }) {
  const pres = usePresentasjon()
  useHideCursor(pres)
  useWakeLock(pres)

  useEffect(() => {
    if (!pres) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      toggleFullskjerm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pres])

  const avslutt = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    settPresentasjon(false)
  }

  return (
    <div className={pres ? 'presentasjon' : undefined}>
      {pres && (
        <button type="button" className="presentasjon-avslutt" onClick={avslutt}>
          {tekst.tavle.avslutt}
        </button>
      )}
      {children}
    </div>
  )
}
