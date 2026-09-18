'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogOut, Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import { useCart } from '@/lib/storefront/cart-context'
import { createClient } from '@/lib/supabase/client'
import OutdoorBrandMark from '@/components/outdoor/OutdoorBrandMark'
import OutdoorNewsletter from '@/components/outdoor/OutdoorNewsletter'
import { outdoorAuthHref } from '@/lib/outdoor/auth-return'

const NAV = [
  { href: '/outdoor/shop', label: 'Shop' },
  { href: '/outdoor/about', label: 'About' },
  { href: '/outdoor/contact', label: 'Contact' },
]

const SOCIALS = [
  { label: 'Instagram', href: process.env.NEXT_PUBLIC_OUTDOOR_INSTAGRAM },
  { label: 'Facebook', href: process.env.NEXT_PUBLIC_OUTDOOR_FACEBOOK },
  { label: 'TikTok', href: process.env.NEXT_PUBLIC_OUTDOOR_TIKTOK },
].filter((s): s is { label: string; href: string } => Boolean(s.href))

export default function OutdoorChrome({ children }: { children: React.ReactNode }) {
  const { totalItems } = useCart()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [pageSearch, setPageSearch] = useState('')
  const loginHref = outdoorAuthHref('login', pathname, pageSearch)
  const signupHref = outdoorAuthHref('register', pathname, pageSearch)

  useEffect(() => {
    setPageSearch(window.location.search)
  }, [pathname])

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
  const isFlowPage =
    pathname.startsWith('/outdoor/fulfilment') ||
    pathname.startsWith('/outdoor/checkout') ||
    pathname.startsWith('/outdoor/cart') ||
    pathname.startsWith('/outdoor/track') ||
    pathname.startsWith('/outdoor/login') ||
    pathname.startsWith('/outdoor/register') ||
    pathname.startsWith('/outdoor/orders')
  const hideStoreMarketing = isFlowPage

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setAuthEmail(null)
    window.location.href = '/outdoor'
  }

  return (
    <div className="min-h-screen min-w-0 flex flex-col bg-[var(--out-cream)] overflow-x-hidden">
      <header className="sticky top-0 z-40 bg-[var(--out-bark)] text-[var(--out-cream)]">
        <div className="mx-auto max-w-6xl h-12 sm:h-16 px-3 sm:px-8 grid grid-cols-[1fr_auto_1fr] items-center md:flex md:gap-3">
          <div className="flex items-center gap-0.5 md:contents">
            <button
              type="button"
              className="md:hidden p-2 -ml-1"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/outdoor/shop" className="p-2 md:hidden" aria-label="Search products">
              <Search className="h-5 w-5" />
            </Link>
          </div>

          <Link href="/outdoor" className="flex min-w-0 items-center justify-center px-1" aria-label="SeraOutdoor">
            <OutdoorBrandMark variant="onDark" className="h-5 w-auto max-w-[9.5rem] object-contain sm:h-7 sm:max-w-[13rem]" priority />
          </Link>

          <nav className={`hidden items-center gap-1 ml-2 text-sm ${isFlowPage ? 'md:hidden' : 'md:flex'}`} aria-label="Primary">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative px-3 py-2 font-medium transition-colors ${
                    active ? 'text-[var(--out-cream)]' : 'text-[var(--out-cream)]/70 hover:text-[var(--out-cream)]'
                  }`}
                >
                  {item.label}
                  {active ? (
                    <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-[var(--out-moss)]" />
                  ) : null}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center justify-end gap-0.5 sm:gap-1 md:ml-auto">
            <Link href="/outdoor/shop" className="p-2 hidden md:inline-flex hover:text-white" aria-label="Search products">
              <Search className="h-5 w-5" />
            </Link>
            {authReady && signedIn ? (
              <>
                <Link href="/outdoor/account" className="p-2 hover:text-white" aria-label="My account">
                  <User className="h-5 w-5" />
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="hidden sm:inline-flex p-2 hover:text-white"
                  aria-label="Sign out"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </>
            ) : (
              <Link href={loginHref} className="p-2 hover:text-white" aria-label="Sign in">
                <User className="h-5 w-5" />
              </Link>
            )}
            <Link href="/outdoor/cart" className="relative p-2 hover:text-white" aria-label="Cart">
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
          <div className="absolute left-0 top-0 bottom-0 w-[78%] max-w-xs bg-[var(--out-cream)] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-8">
              <p className="font-display text-lg">Menu</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-4 text-base">
              <Link href="/outdoor" onClick={() => setOpen(false)} className="py-1">Home</Link>
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
                  <Link href={loginHref} onClick={() => setOpen(false)} className="py-1 font-semibold text-[var(--out-moss)]">
                    Sign in
                  </Link>
                  <Link href={signupHref} onClick={() => setOpen(false)} className="py-1">
                    Create account
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      ) : null}

      <main className="min-w-0 flex-1">{children}</main>

      {hideStoreMarketing ? null : (
      <section className="px-4 sm:px-8 pb-8">
        <div className="mx-auto max-w-xl rounded-[1.75rem] bg-[var(--out-bark)] px-6 py-8 text-center sm:px-10 sm:py-10">
          <h2 className="font-display text-3xl tracking-tight text-[var(--out-cream)] sm:text-4xl">Get Updates</h2>
          <p className="mt-2 text-sm text-[var(--out-cream)]/75">
            Leave your email for Outdoor product news
          </p>
          <div className="mt-5">
            <OutdoorNewsletter variant="onDark" />
          </div>
        </div>
      </section>
      )}

      <footer className="mt-auto bg-[var(--out-bark)] text-[var(--out-cream)]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <OutdoorBrandMark variant="onDark" className="h-8 w-auto" />
            <p className="mt-3 text-sm text-[var(--out-cream)]/70 leading-relaxed max-w-xs">
              Outdoor gear from SeraOutdoor.
            </p>
            {SOCIALS.length > 0 ? (
              <ul className="mt-5 flex flex-wrap gap-3 text-sm">
                {SOCIALS.map((s) => (
                  <li key={s.label}>
                    <a href={s.href} target="_blank" rel="noreferrer" className="hover:text-[var(--out-moss)]">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--out-cream)]/55 mb-4">Shop</p>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/outdoor/shop" className="hover:text-[var(--out-moss)]">All products</Link></li>
              <li><Link href="/outdoor/about" className="hover:text-[var(--out-moss)]">About</Link></li>
              <li><Link href="/outdoor/contact" className="hover:text-[var(--out-moss)]">Contact</Link></li>
              <li><Link href="/outdoor/faq" className="hover:text-[var(--out-moss)]">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--out-cream)]/55 mb-4">Help</p>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/outdoor/shipping-returns" className="hover:text-[var(--out-moss)]">Shipping & Returns</Link></li>
              <li><Link href="/outdoor/privacy" className="hover:text-[var(--out-moss)]">Privacy</Link></li>
              <li><Link href="/outdoor/refund" className="hover:text-[var(--out-moss)]">Refunds</Link></li>
              <li><Link href="/outdoor/terms" className="hover:text-[var(--out-moss)]">Terms</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--out-cream)]/55 mb-4">Account</p>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/outdoor/track" className="hover:text-[var(--out-moss)]">Track order</Link></li>
              {signedIn ? (
                <>
                  <li><Link href="/outdoor/account" className="hover:text-[var(--out-moss)]">My account</Link></li>
                  <li>
                    <button type="button" onClick={() => void signOut()} className="hover:text-[var(--out-moss)]">
                      Sign out{authEmail ? ` (${authEmail.split('@')[0]})` : ''}
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li><Link href={loginHref} className="hover:text-[var(--out-moss)]">Sign in</Link></li>
                  <li><Link href={signupHref} className="hover:text-[var(--out-moss)]">Create account</Link></li>
                </>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 px-5 sm:px-8 py-4 text-center text-[11px] text-[var(--out-cream)]/50">
          © {new Date().getFullYear()} SeraOutdoor
        </div>
      </footer>
    </div>
  )
}
