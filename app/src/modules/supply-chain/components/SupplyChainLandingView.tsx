'use client'

import { ArrowRight } from 'lucide-react'
import { filterSupplyChainNavForUser, type SupplyChainNavGroup } from '@/modules/supply-chain/supplyChainNav'
import SupplyChainHeroBanner from './SupplyChainHeroBanner'
import ModuleLandingCard from '@/components/layout/ModuleLandingCard'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SupplyChainLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
    onViewChange: (view: string) => void
    orgTypeCode?: string
    roleLevel?: number
}

const iconAccents: Record<string, { chip: string; icon: string }> = {
    'sc-products': { chip: 'bg-[var(--sera-orange)]/10', icon: 'text-[var(--sera-orange)]' },
    'sc-orders': { chip: 'bg-[var(--sera-ink)]/5', icon: 'text-[var(--sera-ink)]' },
    'sc-qr': { chip: 'bg-[var(--sera-orange)]/10', icon: 'text-[var(--sera-orange-deep)]' },
    'sc-inventory': { chip: 'bg-[var(--sera-ink)]/5', icon: 'text-[var(--sera-ink-soft)]' },
    'sc-quality': { chip: 'bg-emerald-50', icon: 'text-emerald-700' },
    'sc-organizations': { chip: 'bg-[var(--sera-ink)]/5', icon: 'text-[var(--sera-ink)]' },
}

const defaultIconAccent = { chip: 'bg-[var(--sera-orange)]/10', icon: 'text-[var(--sera-orange)]' }

export default function SupplyChainLandingView({ userName, bannerImageUrl, onViewChange, orgTypeCode, roleLevel }: SupplyChainLandingViewProps) {
    const filteredGroups = filterSupplyChainNavForUser(orgTypeCode, roleLevel)

    return (
        <div className="sera-module-landing">
            <SupplyChainHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            <div className="sera-module-landing__grid">
                {filteredGroups.map((group: SupplyChainNavGroup) => {
                    const Icon = group.icon
                    const accent = iconAccents[group.id] || defaultIconAccent

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
                                                {child.legacy && (
                                                    <Badge variant="outline" className="text-[var(--sera-orange-deep)] border-[var(--sera-orange)]/30 text-[10px] px-1.5 py-0 mr-1">
                                                        Legacy
                                                    </Badge>
                                                )}
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
