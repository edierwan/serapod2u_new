'use client'

import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'
import { usePwaInstall } from '@/hooks/usePwaInstall'

/**
 * Always-visible install help on mobile until installed / dismissed.
 * Android Chromium: native Install when beforeinstallprompt is available;
 * otherwise show Chrome menu instructions so the banner is never blank.
 */
export default function SerappInstallPrompt() {
  const { canInstall, isIos, isAndroid, isInstalled, promptInstall } = usePwaInstall()
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('serapp-install-dismissed') === 'true'
    }
    return false
  })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Avoid SSR flash of wrong platform banner
    setReady(true)
  }, [])

  if (!ready || dismissed || isInstalled) return null

  const showAndroidHelp = isAndroid || canInstall
  const showIosHelp = isIos && !canInstall

  if (!showAndroidHelp && !showIosHelp) return null

  const dismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('serapp-install-dismissed', 'true')
  }

  if (canInstall) {
    return (
      <div className="serapp-rise mx-4 mb-2 flex items-center gap-3 rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-3 shadow-sm">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--sera-ink)]">Install Serapp</p>
          <p className="mt-0.5 text-xs text-[var(--sera-muted)]">
            Add to home screen for quick distributor ordering
          </p>
        </div>
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--sera-orange)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--sera-orange-deep)]"
        >
          <Download className="h-3.5 w-3.5" />
          Install
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="p-1 text-[var(--sera-muted)] hover:text-[var(--sera-ink)]"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  if (showIosHelp) {
    return (
      <div className="serapp-rise mx-4 mb-2 rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-3 shadow-sm">
        <div className="flex items-start gap-3">
          <Share className="mt-0.5 h-5 w-5 shrink-0 text-[var(--sera-orange)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--sera-ink)]">Install Serapp</p>
            <p className="mt-1 text-xs leading-5 text-[var(--sera-muted)]">
              Open in <strong>Safari</strong>, tap <strong>Share</strong>, then{' '}
              <strong>Add to Home Screen</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="p-1 text-[var(--sera-muted)] hover:text-[var(--sera-ink)]"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  // Android / Chromium without beforeinstallprompt yet (or WebView)
  return (
    <div className="serapp-rise mx-4 mb-2 rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-[var(--sera-orange)]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--sera-ink)]">Install Serapp</p>
          <p className="mt-1 text-xs leading-5 text-[var(--sera-muted)]">
            In <strong>Chrome</strong>, tap the menu <strong>⋮</strong> →{' '}
            <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            Use Chrome (not in-app browsers like WhatsApp).
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="p-1 text-[var(--sera-muted)] hover:text-[var(--sera-ink)]"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
