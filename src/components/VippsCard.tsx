'use client'

import { QRCodeSVG } from 'qrcode.react'
import type { Session } from '@/types/game'

/** Vipps convenience shortcut — the app NEVER touches money. Shown only in
 *  kjøp mode. QR requires an explicit vipps_link (a bare Vipps number has no
 *  official QR scheme). */
export function VippsCard({ session, big }: { session: Session; big?: boolean }) {
  if (session.tildeling !== 'kjop' || !session.vipps_number) return null
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-2xl border border-[#4D3023] bg-[#36211A] ${
        big ? 'p-6' : 'p-4'
      }`}
    >
      <p className={`text-[#BA9F8D] ${big ? 'text-xl' : 'text-sm'}`}>
        Vipps til <span className="font-semibold text-[#F6EFE4]">{session.vipps_number}</span>
        {session.price_per_lodd > 0 && (
          <>
            {' '}— <span className="font-semibold text-[#F0B243]">{session.price_per_lodd} kr</span> per åre
          </>
        )}
      </p>
      {session.vipps_link && (
        <div className="rounded-xl bg-white p-3">
          <QRCodeSVG value={session.vipps_link} size={big ? 180 : 110} />
        </div>
      )}
      <p className={`text-center text-[#7d6a5d] ${big ? 'text-base' : 'text-xs'}`}>
        Den som styrer basaren deler ut årene når betalingen er mottatt.
      </p>
    </div>
  )
}
