'use client'

export interface SerappInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Window {
    __serappInstall?: {
      prompt: SerappInstallPromptEvent | null
    }
  }
}

const listeners = new Set<(prompt: SerappInstallPromptEvent | null) => void>()

function readPrompt(): SerappInstallPromptEvent | null {
  return window.__serappInstall?.prompt ?? null
}

function notify(): void {
  const prompt = readPrompt()
  listeners.forEach((listener) => listener(prompt))
}

/** Module-level listener — still late vs inline head script, but catches prompt before React mounts. */
if (typeof window !== 'undefined') {
  window.__serappInstall ??= { prompt: null }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    window.__serappInstall!.prompt = event as SerappInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    if (window.__serappInstall) window.__serappInstall.prompt = null
    notify()
  })

  window.addEventListener('serapp-install-ready', notify)
}

export function getSerappInstallPrompt(): SerappInstallPromptEvent | null {
  if (typeof window === 'undefined') return null
  return readPrompt()
}

export function subscribeSerappInstallPrompt(
  listener: (prompt: SerappInstallPromptEvent | null) => void,
): () => void {
  listeners.add(listener)
  listener(readPrompt())
  return () => listeners.delete(listener)
}
