'use client'

import ModuleLightHeader from '@/components/layout/ModuleLightHeader'

interface HrHeroBannerProps {
    userName: string | null
    bannerImageUrl?: string | null
}

function getGreeting(): string {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
}

export default function HrHeroBanner({ userName }: HrHeroBannerProps) {
    const firstName = userName?.trim().split(/\s+/)[0]
    const title = firstName ? `${getGreeting()}, ${firstName}` : 'Human Resources'

    return (
        <ModuleLightHeader
            eyebrow="HR"
            title={title}
            description="Manage your workforce — people, attendance, leave, payroll, performance, and settings."
        />
    )
}
