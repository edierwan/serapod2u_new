'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LogOut, Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import { useCart } from '@/lib/storefront/cart-context'
import { createClient } from '@/lib/supabase/client'
import StoreBrandMark from '@/components/storefront/StoreBrandMark'

const NAV = [
  { href: '/outdoor', label: 'Home' },
  { href: '/outdoor/shop', label: 'Shop' },
  { href: '/outdoor/about', label: 'About' },
  { href: '/outdoor/contact', label: 'Contact' },
]

const SOCIALS = [
  { label: 'Instagram', href: process.env.NEXT_PUBLIC_OUTDOOR_INSTAGRAM },
  { label: 'Facebook', href: process.env.NEXT_PUBLIC_OUTDOOR_FACEBOOK },
  { label: 'TikTok', href: process.env.NEXT_PUBLIC_OUTDOOR_TIKTOK },
].filter((s): s is { label: string; href: string } => Boolean(s.href))

const LOGIN_HREF = `/outdoor/login?next=${encodeURIComponent('/outdoor/account')}`
const SIGNUP_HREF = `/outdoor/register?next=${encodeURIComponent('/outdoor/account')}`

export default function OutdoorChrome({ children }: { children: React.ReactNode }) {
  const { totalItems } = useCart()
  const [open, setOpen] = useState(false)
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    const sync = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      setAuthEmail(user?.email ?? null)
      setAuthReady(true)
    }

    void sync()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthEmail(session?.user?.email ?? null)
      setAuthReady(true)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const signedIn = Boolean(authEmail)

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setAuthEmail(null)
    window.location.href = '/outdoor'
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--out-line)]/70 bg-[var(--out-surface)]/92 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            className="md:hidden p-2 -ml-2 text-[var(--out-ink)]"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link href="/outdoor" className="flex items-center shrink-0" aria-label="Serapod Outdoor">
            <StoreBrandMark className="h-7 sm:h-8 w-auto" priority />
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm text-[var(--out-ink-soft)]">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-[var(--out-moss)] transition-colors">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <Link href="/outdoor/shop" className="p-2 text-[var(--out-ink-soft)] hover:text-[var(--out-moss)]" aria-label="Search products">
              <Search className="h-5 w-5" />
            </Link>
            {authReady && signedIn ? (
              <>
                <Link href="/outdoor/account" className="p-2 text-[var(--out-ink-soft)] hover:text-[var(--out-moss)]" aria-label="My account">
                  <User className="h-5 w-5" />
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="hidden sm:inline-flex p-2 text-[var(--out-ink-soft)] hover:text-[var(--out-moss)]"
                  aria-label="Sign out"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </>
            ) : (
              <Link href={LOGIN_HREF} className="p-2 text-[var(--out-ink-soft)] hover:text-[var(--out-moss)]" aria-label="Sign in">
                <User className="h-5 w-5" />
              </Link>
            )}
            <Link href="/outdoor/cart" className="relative p-2 text-[var(--out-ink-soft)] hover:text-[var(--out-moss)]" aria-label="Cart">
              <ShoppingBag className="h-5 w-5" />
              {totalItems > 0 ? (
                <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] rounded-full bg-[var(--out-ember)] text-white text-[10px] font-semibold flex items-center justify-center px-1">
                  {totalItems}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[78%] max-w-xs bg-[var(--out-surface)] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-8">
              <p className="font-display text-lg">Menu</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-4 text-base">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="py-1">
                  {item.label}
                </Link>
              ))}
              {signedIn ? (
                <>
                  <Link href="/outdoor/account" onClick={() => setOpen(false)} className="py-1 font-semibold text-[var(--out-moss)]">
                    My account
                  </Link>
                  <button
                    type="button"
                    className="py-1 text-left"
                    onClick={() => {
                      setOpen(false)
                      void signOut()
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link href={LOGIN_HREF} onClick={() => setOpen(false)} className="py-1 font-semibold text-[var(--out-moss)]">
                    Sign in
                  </Link>
                  <Link href={SIGNUP_HREF} onClick={() => setOpen(false)} className="py-1">
                    Create account
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      ) : null}

      <main className="flex-1">{children}</main>

      <footer className="mt-auto border-t border-[var(--out-line)] bg-[var(--out-ink)] text-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <StoreBrandMark variant="light" className="h-8 w-auto" />
            <p className="mt-3 text-sm text-white/65 leading-relaxed max-w-xs">
              Outdoor gear and everyday pieces from Serapod.
            </p>
            {SOCIALS.length > 0 ? (
              <ul className="mt-5 flex flex-wrap gap-3 text-sm text-white/75">
                {SOCIALS.map((s) => (
                  <li key={s.label}>
                    <a href={s.href} target="_blank" rel="noreferrer" className="hover:text-white">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/45 mb-4">Shop</p>
            <ul className="space-y-2.5 text-sm text-white/75">
              <li><Link href="/outdoor/shop" className="hover:text-white">All products</Link></li>
              <li><Link href="/outdoor/about" className="hover:text-white">About</Link></li>
              <li><Link href="/outdoor/contact" className="hover:text-white">Contact</Link></li>
              <li><Link href="/outdoor/faq" className="hover:text-white">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/45 mb-4">Help</p>
            <ul className="space-y-2.5 text-sm text-white/75">
              <li><Link href="/outdoor/shipping-returns" className="hover:text-white">Shipping & Returns</Link></li>
              <li><Link href="/outdoor/privacy" className="hover:text-white">Privacy</Link></li>
              <li><Link href="/outdoor/refund" className="hover:text-white">Refunds</Link></li>
              <li><Link href="/outdoor/terms" className="hover:text-white">Terms</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/45 mb-4">Account</p>
            <ul className="space-y-2.5 text-sm text-white/75">
              <li><Link href="/outdoor/track" className="hover:text-white">Track order</Link></li>
              {signedIn ? (
                <>
                  <li><Link href="/outdoor/account" className="hover:text-white">My account</Link></li>
                  <li>
                    <button type="button" onClick={() => void signOut()} className="hover:text-white">
                      Sign out{authEmail ? ` (${authEmail.split('@')[0]})` : ''}
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li><Link href={LOGIN_HREF} className="hover:text-white">Sign in</Link></li>
                  <li><Link href={SIGNUP_HREF} className="hover:text-white">Create account</Link></li>
                </>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 px-5 sm:px-8 py-4 text-center text-[11px] text-white/40">
          © {new Date().getFullYear()} Serapod Outdoor
        </div>
      </footer>
    </div>
  )
}
