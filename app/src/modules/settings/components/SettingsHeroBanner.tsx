'use client'

import ModuleBanner from '@/components/ui/ModuleBanner'

interface SettingsHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function SettingsHeroBanner({ userName, bannerImageUrl }: SettingsHeroBannerProps) {
    return (
        <ModuleBanner
            module="settings"
            userName={userName}
            bannerImageUrl={bannerImageUrl}
        />
    )
}
