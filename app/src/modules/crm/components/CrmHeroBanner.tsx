'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface CrmHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function CrmHeroBanner({ userName }: CrmHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]

    return (
        <ModuleLightHeader
            eyebrow="CRM"
            title={firstName ? `Welcome, ${firstName}` : 'Customer relationships'}
            description="Customer activity, support conversations, and engagement insights."
        />
    )
}
