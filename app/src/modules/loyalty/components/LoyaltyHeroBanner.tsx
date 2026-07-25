'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface LoyaltyHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function LoyaltyHeroBanner({ userName }: LoyaltyHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]

    return (
        <ModuleLightHeader
            eyebrow="Loyalty"
            title={firstName ? `Welcome, ${firstName}` : 'Rewards hub'}
            description="Points, rewards, redemptions, and gamification."
        />
    )
}
