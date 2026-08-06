'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  getPwaInstallPrompt,
  subscribePwaInstallPrompt,
  type PwaInstallPromptEvent,
} from '@/lib/pwa/install'

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<PwaInstallPromptEvent | null>(null)
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
    setIsIos(
      /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    )
    setIsAndroid(/Android/i.test(ua))

    setDeferredPrompt(getPwaInstallPrompt())
    return subscribePwaInstallPrompt(setDeferredPrompt)
  }, [])

  const promptInstall = useCallback(async () => {
    const prompt = deferredPrompt ?? getPwaInstallPrompt()
    if (!prompt) return false
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (window.__pwaInstall) window.__pwaInstall.prompt = null
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
