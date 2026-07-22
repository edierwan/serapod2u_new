'use client'

interface ModuleLightHeaderProps {
  eyebrow: string
  title: string
  description?: string
}

/** Light Serapod header for module landing pages */
export default function ModuleLightHeader({ eyebrow, title, description }: ModuleLightHeaderProps) {
  return (
    <header className="pt-1">
      <div className="h-1 w-12 rounded-sm bg-[var(--sera-orange)] mb-5" />
      <p className="text-xs font-medium tracking-[0.16em] uppercase text-[var(--sera-muted)] mb-2">
        {eyebrow}
      </p>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--sera-ink)] leading-tight">
        {title}
      </h1>
      {description ? (
        <p className="mt-2 text-sm sm:text-base text-[var(--sera-muted)] max-w-2xl">
          {description}
        </p>
      ) : null}
    </header>
  )
}
