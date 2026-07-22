'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface CatalogHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

export default function CatalogHeroBanner({ userName }: CatalogHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]

    return (
        <ModuleLightHeader
            eyebrow="Product Catalog"
            title={firstName ? `Welcome, ${firstName}` : 'Catalog hub'}
            description="Manage consumer-facing product catalog and variants."
        />
    )
}
