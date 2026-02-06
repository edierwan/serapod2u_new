'use client'

import { useState, useEffect } from 'react'
import { WifiOff } from 'lucide-react'

/**
 * Thin banner shown at the top of the mobile shell when the device is offline.
 */
export default function HrOfflineBanner() {
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    setIsOffline(!navigator.onLine)

    const goOnline = () => setIsOffline(false)
    const goOffline = () => setIsOffline(true)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center gap-2 text-sm font-medium shrink-0">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>No internet connection — some features are disabled.</span>
    </div>
  )
}
