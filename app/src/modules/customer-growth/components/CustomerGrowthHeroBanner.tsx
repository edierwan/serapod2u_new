'use client'

import ModuleBanner from '@/components/ui/ModuleBanner'

interface CustomerGrowthHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function CustomerGrowthHeroBanner({ userName, bannerImageUrl }: CustomerGrowthHeroBannerProps) {
    return (
        <ModuleBanner
            module="customer"
            userName={userName}
            bannerImageUrl={bannerImageUrl}
        />
    )
}
