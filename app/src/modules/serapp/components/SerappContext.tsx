'use client'

import { createContext, useContext } from 'react'
import type { SerappUserProfile } from '@/lib/serapp/types'

interface SerappContextValue {
  userProfile: SerappUserProfile
  isDistributor: boolean
  isHqSupport: boolean
}

const SerappContext = createContext<SerappContextValue | null>(null)

export function SerappProvider({
  userProfile,
  isDistributor,
  isHqSupport,
  children,
}: SerappContextValue & { children: React.ReactNode }) {
  return (
    <SerappContext.Provider value={{ userProfile, isDistributor, isHqSupport }}>
      {children}
    </SerappContext.Provider>
  )
}

export function useSerapp() {
  const ctx = useContext(SerappContext)
  if (!ctx) throw new Error('useSerapp must be used inside SerappProvider')
  return ctx
}
