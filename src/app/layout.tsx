import type { Metadata, Viewport } from 'next'
import { Playfair_Display, Hanken_Grotesk } from 'next/font/google'
import './globals.css'

// Suite brand fonts — Playfair Display for the wordmark/display, Hanken Grotesk
// for body. Mirrors the rest of the Sunday Suite.
const display = Playfair_Display({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['700', '800'],
})
const body = Hanken_Grotesk({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'SundayBasar',
  description: 'Digital basar for menigheten — kjøp årer, vinn premier.',
}

export const viewport: Viewport = {
  themeColor: '#251310',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no" className={`${display.variable} ${body.variable}`}>
      <body className="bg-bg text-text min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
