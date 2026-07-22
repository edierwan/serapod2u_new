'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface FinanceHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

function getGreeting(): string {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
}

export default function FinanceHeroBanner({ userName }: FinanceHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]
    const title = firstName ? `${getGreeting()}, ${firstName}` : 'Finance & Accounting'

    return (
        <ModuleLightHeader
            eyebrow="Finance"
            title={title}
            description="Manage your finances — general ledger, receivables, payables, cash & banking, reports, and settings."
        />
    )
}
