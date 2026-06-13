'use client'

import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { getStateFlagPath } from '@/lib/roadtour/visit-region'
import { cn } from '@/lib/utils'

interface StateFlagProps {
  stateName?: string | null
  className?: string
}

/**
 * Small circular state/negeri flag icon, reusing the shared flag assets
 * (`/images/state-flags/*`) and the canonical name normalization from
 * `getStateFlagPath` (handles Penang/Pulau Pinang, KL/Putrajaya/Labuan, etc.).
 * Falls back to a neutral pin when no flag is available.
 */
export default function StateFlag({ stateName, className }: StateFlagProps) {
  const [failed, setFailed] = useState(false)
  const name = typeof stateName === 'string' ? stateName.trim() : ''
  const flagPath = getStateFlagPath(name)

  if (flagPath && !failed) {
    return (
      <img
        src={flagPath}
        alt=""
        aria-label={name ? `${name} flag` : 'State flag'}
        title={name || undefined}
        onError={() => setFailed(true)}
        className={cn('h-4 w-4 rounded-full border border-slate-200 bg-white object-cover shrink-0', className)}
      />
    )
  }

  return (
    <span
      title={name || 'State'}
      className={cn('flex h-4 w-4 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400 shrink-0', className)}
    >
      <MapPin className="h-2.5 w-2.5" />
    </span>
  )
}
