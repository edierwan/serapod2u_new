'use client'

import { useEffect, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import type { SerappUserProfile } from '@/lib/serapp/types'
import { signOut } from '@/app/actions/auth'
import { SerappProvider } from './SerappContext'
import SerappBottomNav from './SerappBottomNav'
import SerappInstallPrompt from './SerappInstallPrompt'
import { cn } from '@/lib/utils'

interface Props {
  userProfile: SerappUserProfile
  isDistributor: boolean
  isHqSupport: boolean
  children: React.ReactNode
}

/**
 * Serapp mobile shell — Serapod store brand assets (real wordmark + platform icons).
 */
export default function SerappShell({
  userProfile,
  isDistributor,
  isHqSupport,
  children,
}: Props) {
  const [signingOut, startSignOut] = useTransition()
  const pathname = usePathname()
  const isChat =
    pathname === '/serapp/conversation' || pathname?.startsWith('/serapp/conversation/')

  useEffect(() => {
    // Prefer Serapp manifest over the root dashboard manifest on this tree.
    const existing = document.querySelectorAll('link[rel="manifest"]')
    existing.forEach((node) => node.parentElement?.removeChild(node))
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/serapp-manifest.json'
    document.head.appendChild(link)

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/serapp-sw.js', { scope: '/serapp' })
        .then((reg) => {
          void reg.update()
        })
        .catch((err) => console.warn('[Serapp SW] registration failed:', err))
    }
  }, [])

  const displayName = userProfile.full_name || userProfile.email
  const orgLabel = userProfile.organizations.org_name

  return (
    <SerappProvider
      userProfile={userProfile}
      isDistributor={isDistributor}
      isHqSupport={isHqSupport}
    >
      <div className="sera-serapp flex h-[100dvh] flex-col text-[var(--sera-ink)]">
        <header className="sticky top-0 z-40 border-b border-[var(--sera-line)] bg-[var(--sera-paper)]/92 backdrop-blur-md">
          <div
            className="h-[2px] w-full bg-gradient-to-r from-[var(--sera-orange)] via-[var(--sera-orange-deep)] to-transparent"
            aria-hidden
          />
          <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/serapod-wordmark.png"
                  alt="Serapod"
                  className="h-7 w-auto"
                  decoding="async"
                />
                <span className="rounded-md bg-[var(--sera-orange)]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--sera-orange)]">
                  Serapp
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-[var(--sera-muted)]">
                {displayName}
                {' · '}
                {orgLabel}
                {isHqSupport ? ' · HQ Support' : ''}
              </p>
            </div>
            <button
              type="button"
              disabled={signingOut}
              onClick={() => startSignOut(() => { void signOut() })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--sera-line)] bg-[var(--sera-surface)] text-[var(--sera-ink-soft)] hover:border-[var(--sera-orange)]/40 hover:text-[var(--sera-orange)] disabled:opacity-60"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main
          className={cn(
            'mx-auto w-full max-w-lg flex-1 overscroll-y-contain pb-20',
            isChat ? 'overflow-hidden pt-0' : 'overflow-y-auto',
          )}
        >
          {!isChat && (
            <div className="px-0 pt-3">
              <SerappInstallPrompt />
            </div>
          )}
          {children}
        </main>

        <SerappBottomNav />
      </div>
    </SerappProvider>
  )
}
