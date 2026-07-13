import type { Metadata, Viewport } from 'next'
import { Source_Serif_4, Libre_Franklin, IBM_Plex_Mono, Fraunces } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import SupportGate from './SupportGate'

const sourceSerif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif', display: 'swap' })
const libreFranklin = Libre_Franklin({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const ibmPlexMono = IBM_Plex_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-mono', display: 'swap' })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-display', style: ['normal', 'italic'], axes: ['SOFT', 'WONK', 'opsz'], display: 'swap' })

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || 'cartridge.cafe'

export const metadata: Metadata = {
  title: {
    default: `${BRAND} — little worlds, served as single files`,
    template: `%s · ${BRAND}`,
  },
  description: 'Living worlds brewed by people and their AIs. Visit any table, remix any recipe, leave yours on the shelf.',
}

export const viewport: Viewport = {
  themeColor: '#0c0a09',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sourceSerif.variable} ${libreFranklin.variable} ${ibmPlexMono.variable} ${fraunces.variable}`}>
      <body className="antialiased">
        <Providers><SupportGate>{children}</SupportGate></Providers>
      </body>
    </html>
  )
}
