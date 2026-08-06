'use client'

import { Download } from 'lucide-react'
import { usePwaInstall } from '@/hooks/usePwaInstall'

/** Native install affordance only — no instructional banners. */
export default function SerappInstallButton() {
  const { canInstall, promptInstall } = usePwaInstall()

  if (!canInstall) return null

  return (
    <button
      type="button"
      onClick={() => void promptInstall()}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--sera-orange)]/30 bg-[var(--sera-orange)]/10 text-[var(--sera-orange)] hover:bg-[var(--sera-orange)]/15"
      aria-label="Install app"
      title="Install"
    >
      <Download className="h-4 w-4" />
    </button>
  )
}
