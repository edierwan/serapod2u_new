'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ModuleLandingCardProps {
  icon: LucideIcon
  accent: { chip: string; icon: string }
  title: string
  description?: string
  titleExtra?: ReactNode
  children?: ReactNode
  className?: string
}

/** Unified landing card — same structure and left alignment on every module hub */
export default function ModuleLandingCard({
  icon: Icon,
  accent,
  title,
  description,
  titleExtra,
  children,
  className,
}: ModuleLandingCardProps) {
  return (
    <div className={cn('sera-module-landing__card', className)}>
      <div className="sera-module-landing__card-head">
        <div className={cn('sera-module-landing__card-icon', accent.chip, accent.icon)}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <h2 className="sera-module-landing__card-title flex-1 min-w-0">{title}</h2>
        {titleExtra}
      </div>

      {description ? (
        <p className="sera-module-landing__card-desc">{description}</p>
      ) : null}

      {children ? (
        <div className="sera-module-landing__card-actions">{children}</div>
      ) : null}
    </div>
  )
}
