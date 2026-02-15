'use client'

import ModuleBanner from '@/components/ui/ModuleBanner'

interface SupplyChainHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function SupplyChainHeroBanner({ userName, bannerImageUrl }: SupplyChainHeroBannerProps) {
    return (
        <ModuleBanner
            module="supply"
            userName={userName}
            bannerImageUrl={bannerImageUrl}
        />
    )
}
