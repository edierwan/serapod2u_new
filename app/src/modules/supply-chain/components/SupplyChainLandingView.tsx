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

// ── Accent colours per card ──────────────────────────────────────

const cardAccents: Record<string, { bg: string; text: string; hoverBorder: string }> = {
    'sc-products': { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-300', hoverBorder: 'hover:border-blue-200 dark:hover:border-blue-800' },
    'sc-orders': { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-300', hoverBorder: 'hover:border-emerald-200 dark:hover:border-emerald-800' },
    'sc-qr': { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-300', hoverBorder: 'hover:border-violet-200 dark:hover:border-violet-800' },
    'sc-inventory': { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-300', hoverBorder: 'hover:border-amber-200 dark:hover:border-amber-800' },
    'sc-quality': { bg: 'bg-rose-50 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-300', hoverBorder: 'hover:border-rose-200 dark:hover:border-rose-800' },
    'sc-organizations': { bg: 'bg-indigo-50 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-300', hoverBorder: 'hover:border-indigo-200 dark:hover:border-indigo-800' },
}

const defaultAccent = { bg: 'bg-orange-50 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-300', hoverBorder: 'hover:border-orange-200 dark:hover:border-orange-800' }

/**
 * Supply Chain Landing / Overview page.
 * Shows hero banner + grouped quick-link cards generated from supplyChainNav config.
 * Matches the same layout and styling as FinanceLandingView.
 */
export default function SupplyChainLandingView({ userName, bannerImageUrl, onViewChange, orgTypeCode, roleLevel }: SupplyChainLandingViewProps) {
    const filteredGroups = filterSupplyChainNavForUser(orgTypeCode, roleLevel)

    return (
        <div className="w-full space-y-6">
            {/* Hero Banner */}
            <SupplyChainHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            {/* Section subtitle */}
            <div>
                <p className="text-sm text-muted-foreground">
                    Manage products, orders, QR traceability, and inventory movements.
                </p>
            </div>

            {/* Quick link grid — responsive, uses full available width */}
            <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {filteredGroups.map((group: SupplyChainNavGroup) => {
                    const Icon = group.icon
                    const accent = cardAccents[group.id] || defaultAccent

                    return (
                        <div
                            key={group.id}
                            className={`bg-card border border-border rounded-xl p-5 space-y-3 hover:shadow-md ${accent.hoverBorder} transition-all duration-200 group/card`}
                        >
                            <div className="flex items-center gap-2.5">
                                <div className={`flex items-center justify-center h-9 w-9 rounded-lg ${accent.bg} ${accent.text} transition-colors`}>
                                    <Icon className="h-4.5 w-4.5" />
                                </div>
                                <h2 className="font-semibold text-base text-foreground flex-1">{group.label}</h2>
                            </div>

                            <p className="text-xs text-muted-foreground leading-relaxed">
                                {group.description}
                            </p>

                            <ul className="space-y-0.5">
                                {group.children.map((child) => {
                                    const ChildIcon = child.icon

                                    return (
                                        <li key={child.id}>
                                            <button
                                                onClick={() => onViewChange(child.id)}
                                                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors group text-muted-foreground hover:text-foreground hover:bg-accent"
                                            >
                                                <ChildIcon className="h-4 w-4 shrink-0" />
                                                <span className="flex-1 text-left">{child.label}</span>
                                                {child.legacy && (
                                                    <Badge variant="outline" className="text-amber-600 border-amber-200 text-[10px] px-1.5 py-0 mr-1">
                                                        Legacy
                                                    </Badge>
                                                )}
                                                <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
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
