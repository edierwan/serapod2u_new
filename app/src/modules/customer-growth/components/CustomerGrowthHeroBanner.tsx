'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface CustomerGrowthHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function CustomerGrowthHeroBanner({ userName }: CustomerGrowthHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]

    return (
        <ModuleLightHeader
            eyebrow="Customer & Growth"
            title={firstName ? `Welcome, ${firstName}` : 'Growth hub'}
            description="Manage customer engagement, marketing campaigns, loyalty programs, and product catalog."
        />
    )
}
