"use client"

import { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import type { UserProfileWithRelations } from '@/lib/server/get-user-profile'

interface EngagementShellProps {
  userProfile: UserProfileWithRelations
  activeView?: string
  children: ReactNode
}

export function EngagementShell({ userProfile, activeView = 'point-catalog', children }: EngagementShellProps) {
  const router = useRouter()
  const pathname = usePathname()

  const handleNavigate = (view: string) => {
    if (view === 'point-catalog') {
      if (pathname !== '/engagement/catalog') {
        router.push('/engagement/catalog')
      }
      return
    }

    if (view === 'point-catalog-admin' || view === 'point-catalog-admin-list') {
      if (pathname !== '/engagement/catalog/admin') {
        router.push('/engagement/catalog/admin')
      }
      return
    }

    if (view === 'point-catalog-admin-new') {
      router.push('/engagement/catalog/admin/new')
      return
    }

    // Default fallback: return to dashboard and let dashboard content pick up stored view
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('dashboardView', view)
    }
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar userProfile={userProfile} currentView={activeView} onViewChange={handleNavigate} />
      <div className="flex-1 overflow-hidden">
        <main className="p-6 h-full overflow-y-auto bg-muted/10">
          {children}
        </main>
      </div>
    </div>
  )
}
