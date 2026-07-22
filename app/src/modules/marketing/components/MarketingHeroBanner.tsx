'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface MarketingHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function MarketingHeroBanner({ userName }: MarketingHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]

    return (
        <ModuleLightHeader
            eyebrow="Marketing"
            title={firstName ? `Welcome, ${firstName}` : 'Campaigns hub'}
            description="Campaigns, journeys, and outbound messaging."
        />
    )
}
