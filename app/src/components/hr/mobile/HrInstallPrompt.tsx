'use client'

import { useState } from 'react'
import { Download, X, Share } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from '@/hooks/usePwaInstall'

/**
 * PWA install call-to-action.
 *
 * - Android / Chromium: shows an "Install" button that triggers the native prompt.
 * - iOS Safari: shows a dismissible banner with Share → Add to Home Screen instructions.
 * - Already installed or dismissed: renders nothing.
 */
export default function HrInstallPrompt() {
  const { canInstall, isIos, isInstalled, promptInstall } = usePwaInstall()

  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('hr-install-dismissed') === 'true'
    }
    return false
  })

  if (dismissed || isInstalled || (!canInstall && !isIos)) return null

  const handleDismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('hr-install-dismissed', 'true')
  }

  /* ── Android / Chrome prompt ─────────────────────────────────── */
  if (canInstall) {
    return (
      <div className="mx-4 mb-3 p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            Install Serapod HR
          </p>
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
            Add to home screen for quick access
          </p>
        </div>
        <Button size="sm" onClick={promptInstall} className="gap-1.5 shrink-0">
          <Download className="h-3.5 w-3.5" />
          Install
        </Button>
        <button
          onClick={handleDismiss}
          className="text-blue-400 hover:text-blue-600 p-1"
          aria-label="Dismiss install banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  /* ── iOS Safari instructions ─────────────────────────────────── */
  if (isIos) {
    return (
      <div className="mx-4 mb-3 p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800">
        <div className="flex items-start gap-3">
          <Share className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
              Install Serapod HR
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              Tap{' '}
              <strong className="inline-flex items-center gap-0.5">
                Share <Share className="inline h-3 w-3" />
              </strong>{' '}
              then <strong>&quot;Add to Home Screen&quot;</strong>
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-blue-400 hover:text-blue-600 p-1"
            aria-label="Dismiss install banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  return null
}
