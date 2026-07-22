'use client'

interface CustomerGrowthHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

/**
 * Light Serapod header for Customer & Growth landing (replaces heavy ModuleBanner).
 * bannerImageUrl kept for API compatibility — not used in the light chrome.
 */
export default function CustomerGrowthHeroBanner({ userName }: CustomerGrowthHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]

    return (
        <header className="pt-1">
            <div className="h-1 w-12 rounded-sm bg-[var(--sera-orange)] mb-5" />
            <p className="text-xs font-medium tracking-[0.16em] uppercase text-[var(--sera-muted)] mb-2">
                Customer & Growth
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--sera-ink)] leading-tight">
                {firstName ? `Welcome, ${firstName}` : 'Growth hub'}
            </h1>
            <p className="mt-2 text-sm sm:text-base text-[var(--sera-muted)] max-w-2xl">
                Manage customer engagement, marketing campaigns, loyalty programs, and product catalog.
            </p>
        </header>
    )
}
