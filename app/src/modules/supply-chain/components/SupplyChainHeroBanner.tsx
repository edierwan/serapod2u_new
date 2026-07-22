'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface SupplyChainHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function SupplyChainHeroBanner({ userName }: SupplyChainHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]

    return (
        <ModuleLightHeader
            eyebrow="Supply Chain"
            title={firstName ? `Welcome, ${firstName}` : 'Operations hub'}
            description="Manage products, orders, QR traceability, and inventory movements."
        />
    )
}
