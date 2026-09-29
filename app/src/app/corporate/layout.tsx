import type { Metadata } from 'next'
import { Manrope, Syne } from 'next/font/google'
import './corporate.css'

const display = Syne({
  subsets: ['latin'],
  variable: '--font-corp-display',
  display: 'swap',
})

const body = Manrope({
  subsets: ['latin'],
  variable: '--font-corp-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Serapod',
    template: '%s | Serapod',
  },
  description: 'Serapod — brand family and businesses.',
}

export default function CorporateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sera-corporate ${display.variable} ${body.variable} min-h-screen`}>
      {children}
    </div>
  )
}
