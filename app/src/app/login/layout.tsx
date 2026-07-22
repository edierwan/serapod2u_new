import { Manrope, Syne } from 'next/font/google'
import './login.css'

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-sera-display',
  display: 'swap',
})

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sera-body',
  display: 'swap',
})

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${syne.variable} ${manrope.variable} login-ux`}>
      {children}
    </div>
  )
}
