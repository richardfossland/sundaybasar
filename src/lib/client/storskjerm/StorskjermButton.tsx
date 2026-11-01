'use client'

import { useState } from 'react'
import { StorskjermPanel } from './StorskjermPanel'
import { tekst } from './tekst'
import './storskjerm.css'

/** «Vis på storskjerm» — liten knapp i vertskonsollen som åpner veiviseren.
 * `tavleHref` er sti til projektor-ruta for denne økta. */
export function StorskjermButton({ tavleHref }: { tavleHref: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="storskjerm-knapp"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">▶︎</span> {tekst.knapp}
      </button>
      {open && <StorskjermPanel tavleHref={tavleHref} onClose={() => setOpen(false)} />}
    </>
  )
}
