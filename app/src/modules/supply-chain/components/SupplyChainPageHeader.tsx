'use client'

import type { ReactNode } from 'react'

interface SupplyChainPageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}

/**
 * Shared light Serapod header for Supply Chain child pages.
 * Keeps list/form screens consistent without touching business logic.
 */
export default function SupplyChainPageHeader({
  eyebrow = 'Supply Chain',
  title,
  description,
  actions,
}: SupplyChainPageHeaderProps) {
  return (
    <header className="sera-module-landing__header sera-module-landing__header--compact flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div className="min-w-0">
        <div className="h-1 w-12 rounded-sm bg-[var(--sera-orange)] mb-5 sera-sc-header__bar" />
        <p className="text-[11px] font-medium tracking-[0.16em] uppercase text-[var(--sera-muted)] mb-2">
          {eyebrow}
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--sera-ink)] leading-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 text-sm text-[var(--sera-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
    </header>
  )
}
