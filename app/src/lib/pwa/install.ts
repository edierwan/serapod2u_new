'use client'

export interface PwaInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Window {
    __pwaInstall?: {
      prompt: PwaInstallPromptEvent | null
    }
    /** @deprecated use __pwaInstall */
    __serappInstall?: {
      prompt: PwaInstallPromptEvent | null
    }
  }
}

const listeners = new Set<(prompt: PwaInstallPromptEvent | null) => void>()

function readPrompt(): PwaInstallPromptEvent | null {
  return window.__pwaInstall?.prompt ?? window.__serappInstall?.prompt ?? null
}

function notify(): void {
  const prompt = readPrompt()
  listeners.forEach((listener) => listener(prompt))
}

if (typeof window !== 'undefined') {
  window.__pwaInstall ??= { prompt: null }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    window.__pwaInstall!.prompt = event as PwaInstallPromptEvent
    window.__serappInstall = window.__pwaInstall
    notify()
  })

  window.addEventListener('appinstalled', () => {
    if (window.__pwaInstall) window.__pwaInstall.prompt = null
    if (window.__serappInstall) window.__serappInstall.prompt = null
    notify()
  })

  window.addEventListener('pwa-install-ready', notify)
  window.addEventListener('serapp-install-ready', notify)
}

export function getPwaInstallPrompt(): PwaInstallPromptEvent | null {
  if (typeof window === 'undefined') return null
  return readPrompt()
}

export function subscribePwaInstallPrompt(
  listener: (prompt: PwaInstallPromptEvent | null) => void,
): () => void {
  listeners.add(listener)
  listener(readPrompt())
  return () => listeners.delete(listener)
}

/** @deprecated use getPwaInstallPrompt */
export const getSerappInstallPrompt = getPwaInstallPrompt

/** @deprecated use subscribePwaInstallPrompt */
export const subscribeSerappInstallPrompt = subscribePwaInstallPrompt
