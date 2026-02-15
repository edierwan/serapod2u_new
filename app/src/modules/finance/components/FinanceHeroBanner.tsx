'use client'

import ModuleBanner from '@/components/ui/ModuleBanner'

interface FinanceHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function FinanceHeroBanner({ userName, bannerImageUrl }: FinanceHeroBannerProps) {
    return (
        <ModuleBanner
            module="finance"
            userName={userName}
            bannerImageUrl={bannerImageUrl}
        />
    )
}
