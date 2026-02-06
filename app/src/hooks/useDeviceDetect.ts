'use client'

import { useState, useEffect } from 'react'

/**
 * SSR-safe device detection hook.
 * Uses matchMedia on the client to detect mobile vs desktop.
 * Returns `null` during SSR / first paint so caller can show a loading state.
 */
export function useDeviceDetect() {
  const [isMobile, setIsMobile] = useState<boolean | null>(null)

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)')
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return {
    /** null while SSR / hydrating, then true/false */
    isMobile,
    isDesktop: isMobile === false,
    /** true until first client paint resolves */
    isLoading: isMobile === null,
  }
}
