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
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="h-1 w-10 rounded-sm bg-[var(--sera-orange)] mb-3 sera-sc-header__bar" />
        <p className="text-[11px] font-medium tracking-[0.14em] uppercase text-[var(--sera-muted)] mb-1.5">
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
