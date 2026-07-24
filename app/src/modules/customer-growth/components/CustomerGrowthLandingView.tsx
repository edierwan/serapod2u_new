'use client'

import { ArrowRight } from 'lucide-react'
import { customerGrowthNavGroups, type CustomerGrowthNavGroup } from '@/modules/customer-growth/customerGrowthNav'
import CustomerGrowthHeroBanner from './CustomerGrowthHeroBanner'
import ModuleLandingCard from '@/components/layout/ModuleLandingCard'
import { customerGrowthLandingAccents, landingAccents, pickLandingAccent } from '@/lib/landing-accents'
import { cn } from '@/lib/utils'

interface CustomerGrowthLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
    onViewChange: (view: string) => void
}

const defaultIconAccent = landingAccents.orange

export default function CustomerGrowthLandingView({ userName, bannerImageUrl, onViewChange }: CustomerGrowthLandingViewProps) {
    return (
        <div className="sera-module-landing">
            <CustomerGrowthHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            <div className="sera-module-landing__grid">
                {customerGrowthNavGroups.map((group: CustomerGrowthNavGroup) => {
                    const Icon = group.icon
                    const accent = pickLandingAccent(customerGrowthLandingAccents, group.id, defaultIconAccent)

                    return (
                        <ModuleLandingCard
                            key={group.id}
                            icon={Icon}
                            accent={accent}
                            title={group.label}
                            description={group.description}
                        >
                            <ul className="m-0 p-0 list-none">
                                {group.children.map((child) => {
                                    const ChildIcon = child.icon
                                    return (
                                        <li key={child.id}>
                                            <button
                                                type="button"
                                                onClick={() => onViewChange(child.id)}
                                                className="sera-module-landing__link group"
                                            >
                                                <ChildIcon className={cn('h-4 w-4 shrink-0', accent.icon)} strokeWidth={1.75} />
                                                <span className="flex-1">{child.label}</span>
                                                <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--sera-orange)]" />
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                        </ModuleLandingCard>
                    )
                })}
            </div>
        </div>
    )
}
