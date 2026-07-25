'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface SettingsHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function SettingsHeroBanner({ userName }: SettingsHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]

    return (
        <ModuleLightHeader
            eyebrow="Settings"
            title={firstName ? `Account settings, ${firstName}` : 'Account settings'}
            description="Manage your account, organization, notifications, preferences, and system configuration."
        />
    )
}
