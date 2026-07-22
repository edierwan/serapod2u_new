'use client'

import type { ReactNode } from 'react'

interface ModuleLightHeaderProps {
  eyebrow: string
  title: string
  description?: string
  /** Optional second line below description (same width / alignment) */
  lead?: string
  actions?: ReactNode
}

/** Light Serapod header for module landing pages */
export default function ModuleLightHeader({ eyebrow, title, description, lead, actions }: ModuleLightHeaderProps) {
  return (
    <header className="sera-module-landing__header">
      <div className="min-w-0 flex-1">
        <div className="h-1 w-12 rounded-sm bg-[var(--sera-orange)] mb-5 sera-sc-header__bar" />
        <p className="text-xs font-medium tracking-[0.16em] uppercase text-[var(--sera-muted)] mb-2">
          {eyebrow}
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--sera-ink)] leading-tight">
          {title}
        </h1>
        {(description || lead) ? (
          <div className="mt-2 max-w-2xl space-y-2 text-sm sm:text-base text-[var(--sera-muted)] leading-relaxed">
            {description ? <p className="m-0">{description}</p> : null}
            {lead ? <p className="m-0">{lead}</p> : null}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-end gap-2">{actions}</div> : null}
    </header>
  )
}
