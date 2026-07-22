'use client'

import {
    ArrowRight,
} from 'lucide-react'
import { filterSupplyChainNavForUser, type SupplyChainNavGroup } from '@/modules/supply-chain/supplyChainNav'
import SupplyChainHeroBanner from './SupplyChainHeroBanner'
import { Badge } from '@/components/ui/badge'

// ── Props ────────────────────────────────────────────────────────

interface SupplyChainLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
    onViewChange: (view: string) => void
    /** Organisation type code – used to filter nav items */
    orgTypeCode?: string
    /** Role level – used to filter nav items */
    roleLevel?: number
}

/**
 * Supply Chain Landing / Overview page.
 * Light Serapod paper chrome + grouped quick-link cards from supplyChainNav.
 */
export default function SupplyChainLandingView({ userName, bannerImageUrl, onViewChange, orgTypeCode, roleLevel }: SupplyChainLandingViewProps) {
    const filteredGroups = filterSupplyChainNavForUser(orgTypeCode, roleLevel)

    return (
        <div className="w-full space-y-8">
            <SupplyChainHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {filteredGroups.map((group: SupplyChainNavGroup) => {
                    const Icon = group.icon

                    return (
                        <div
                            key={group.id}
                            className="rounded-xl border border-[var(--sera-line)] bg-white p-5 space-y-3 transition-colors hover:border-[var(--sera-orange)]/35"
                        >
                            <div className="flex items-center gap-2.5">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--sera-ink)]/5 text-[var(--sera-ink)]">
                                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                                </div>
                                <h2 className="font-semibold text-base text-[var(--sera-ink)] flex-1">
                                    {group.label}
                                </h2>
                            </div>

                            <p className="text-xs text-[var(--sera-muted)] leading-relaxed">
                                {group.description}
                            </p>

                            <ul className="space-y-0.5 pt-1">
                                {group.children.map((child) => {
                                    const ChildIcon = child.icon

                                    return (
                                        <li key={child.id}>
                                            <button
                                                type="button"
                                                onClick={() => onViewChange(child.id)}
                                                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors group text-[var(--sera-muted)] hover:text-[var(--sera-ink)] hover:bg-[var(--sera-mist)]"
                                            >
                                                <ChildIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                                                <span className="flex-1 text-left">{child.label}</span>
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
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
