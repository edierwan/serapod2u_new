'use client'

import ModuleBanner from '@/components/ui/ModuleBanner'

interface SettingsHeroBannerProps {
    userName: string | null
}

export default function SettingsHeroBanner({ userName }: SettingsHeroBannerProps) {
    return (
        <ModuleBanner
            module="settings"
            userName={userName}
        />
    )
}
