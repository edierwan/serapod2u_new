'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { SerappUserProfile } from '@/lib/serapp/types'

export interface SerappMessageToast {
  id: string
  title: string
  preview: string
  conversationId: string
}

interface SerappContextValue {
  userProfile: SerappUserProfile
  isDistributor: boolean
  isHqSupport: boolean
  totalUnread: number
  setTotalUnread: (value: number) => void
  messageToast: SerappMessageToast | null
  showMessageToast: (toast: Omit<SerappMessageToast, 'id'> & { id?: string }) => void
  dismissMessageToast: () => void
}

const SerappContext = createContext<SerappContextValue | null>(null)

export function SerappProvider({
  userProfile,
  isDistributor,
  isHqSupport,
  children,
}: {
  userProfile: SerappUserProfile
  isDistributor: boolean
  isHqSupport: boolean
  children: React.ReactNode
}) {
  const [totalUnread, setTotalUnread] = useState(0)
  const [messageToast, setMessageToast] = useState<SerappMessageToast | null>(null)

  const dismissMessageToast = useCallback(() => setMessageToast(null), [])

  const showMessageToast = useCallback(
    (toast: Omit<SerappMessageToast, 'id'> & { id?: string }) => {
      setMessageToast({
        id: toast.id || `${Date.now()}`,
        title: toast.title,
        preview: toast.preview,
        conversationId: toast.conversationId,
      })
    },
    [],
  )

  const value = useMemo(
    () => ({
      userProfile,
      isDistributor,
      isHqSupport,
      totalUnread,
      setTotalUnread,
      messageToast,
      showMessageToast,
      dismissMessageToast,
    }),
    [
      userProfile,
      isDistributor,
      isHqSupport,
      totalUnread,
      messageToast,
      showMessageToast,
      dismissMessageToast,
    ],
  )

  return <SerappContext.Provider value={value}>{children}</SerappContext.Provider>
}

export function useSerapp() {
  const ctx = useContext(SerappContext)
  if (!ctx) throw new Error('useSerapp must be used inside SerappProvider')
  return ctx
}
