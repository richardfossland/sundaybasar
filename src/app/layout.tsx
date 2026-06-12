import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

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
    <html lang="no" className={inter.variable}>
      <body className="bg-[#251310] text-[#F6EFE4] min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
