'use client'

import { useEffect } from 'react'
import { HrMobileProvider, type HrUserProfile } from './HrMobileContext'
import BottomNav from './BottomNav'
import HrHelpDrawer from './HrHelpDrawer'
import HrOfflineBanner from './HrOfflineBanner'

interface Props {
  userProfile: HrUserProfile
  children: React.ReactNode
}

/**
 * Client shell for all /hr/mobile/* pages.
 *
 * Provides:
 * - HrMobileContext (userProfile, isManager, isAdmin, orgId)
 * - Bottom navigation bar
 * - Floating "Need help?" drawer
 * - Offline connection banner
 * - Service worker registration (scoped to /hr)
 */
export default function HrMobileShell({ userProfile, children }: Props) {
  // Register the HR-scoped service worker once
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/hr-sw.js', { scope: '/hr' })
        .catch((err) => console.warn('[HR SW] registration failed:', err))
    }
  }, [])

  return (
    <HrMobileProvider userProfile={userProfile}>
      <div className="h-[100dvh] flex flex-col bg-background">
        <HrOfflineBanner />
        <main className="flex-1 overflow-y-auto overscroll-y-contain pb-20">
          {children}
        </main>
        <BottomNav />
        <HrHelpDrawer />
      </div>
    </HrMobileProvider>
  )
}
