'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Augmented Event type for the Chrome "beforeinstallprompt" event.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Hook to manage the PWA install prompt experience.
 *
 * - On Android/Chromium: captures the `beforeinstallprompt` event so
 *   you can call `promptInstall()` from a custom button.
 * - On iOS Safari: detects the platform so you can show a
 *   "Share → Add to Home Screen" tip.
 * - Tracks whether the app is already running as installed standalone.
 */
export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIos, setIsIos] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Already running installed?
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    setIsStandalone(standalone)
    setIsInstalled(standalone)

    // Detect iOS
    const ua = navigator.userAgent
    setIsIos(
      /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    )

    // Chrome / Edge "beforeinstallprompt"
    const handleBIP = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handleBIP)

    // Track successful installs
    const handleInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBIP)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    return outcome === 'accepted'
  }, [deferredPrompt])

  return {
    /** True when Chrome/Edge has a deferred prompt we can trigger */
    canInstall: !!deferredPrompt && !isInstalled,
    /** True when on iOS Safari and NOT already installed */
    isIos: isIos && !isInstalled && !isStandalone,
    /** True when the PWA is already installed */
    isInstalled,
    /** True when running in standalone (home-screen) mode */
    isStandalone,
    /** Trigger the native install prompt (Android/Chromium only) */
    promptInstall,
  }
}
