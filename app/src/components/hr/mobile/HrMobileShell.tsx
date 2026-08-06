'use client'

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
 * Site-wide service worker is registered from root layout (PwaBootstrap).
 */
export default function HrMobileShell({ userProfile, children }: Props) {
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
