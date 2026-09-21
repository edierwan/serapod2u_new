'use client'

import { useEffect } from 'react'
import '@/lib/pwa/install'

/**
 * Site-wide PWA runtime.
 * - Production: register /sw.js and capture install prompt (same as legacy PwaBootstrap).
 * - Development: unregister SW + clear caches so Turbopack chunks are never served stale.
 */
export default function PwaRuntime() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const isDev = process.env.NODE_ENV === 'development'

    if (isDev) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister().catch(() => {}))
      })
      if ('caches' in window) {
        caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => {})
      }
      return
    }

    const origin = location.origin
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        regs.forEach((reg) => {
          const scope = reg.scope || ''
          if (scope !== `${origin}/` && scope !== origin) {
            reg.unregister().catch(() => {})
          }
        })
      })
      .finally(() => {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .then((registration) => registration.update())
          .catch(() => {})
      })
  }, [])

  return null
}
