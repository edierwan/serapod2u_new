'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  getSerappInstallPrompt,
  subscribeSerappInstallPrompt,
  type SerappInstallPromptEvent,
} from '@/lib/serapp/pwa-install'

/**
 * Hook to manage the PWA install prompt experience.
 * Relies on early capture in serapp/layout inline script + module fallback.
 */
export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<SerappInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIos, setIsIos] = useState(false)
  const [isAndroid, setIsAndroid] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setIsStandalone(standalone)
    setIsInstalled(standalone)

    const ua = navigator.userAgent
    const ios =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    setIsIos(ios)
    setIsAndroid(/Android/i.test(ua))

    setDeferredPrompt(getSerappInstallPrompt())
    return subscribeSerappInstallPrompt(setDeferredPrompt)
  }, [])

  const promptInstall = useCallback(async () => {
    const prompt = deferredPrompt ?? getSerappInstallPrompt()
    if (!prompt) return false
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (window.__serappInstall) window.__serappInstall.prompt = null
    setDeferredPrompt(null)
    return outcome === 'accepted'
  }, [deferredPrompt])

  const notInstalled = !isInstalled && !isStandalone

  return {
    canInstall: !!deferredPrompt && notInstalled,
    isIos: isIos && notInstalled,
    isAndroid: isAndroid && notInstalled,
    isInstalled,
    isStandalone,
    promptInstall,
  }
}
