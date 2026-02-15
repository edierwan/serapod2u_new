'use client'

import ModuleBanner from '@/components/ui/ModuleBanner'

interface HrHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function HrHeroBanner({ userName, bannerImageUrl }: HrHeroBannerProps) {
    return (
        <ModuleBanner
            module="hr"
            userName={userName}
            bannerImageUrl={bannerImageUrl}
        />
    )
}
