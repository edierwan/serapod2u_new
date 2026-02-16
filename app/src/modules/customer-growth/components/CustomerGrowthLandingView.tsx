'use client'

import { ArrowRight } from 'lucide-react'
import { customerGrowthNavGroups, type CustomerGrowthNavGroup } from '@/modules/customer-growth/customerGrowthNav'
import CustomerGrowthHeroBanner from './CustomerGrowthHeroBanner'

// ── Props ────────────────────────────────────────────────────────

interface CustomerGrowthLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
    onViewChange: (view: string) => void
}

// ── Accent colours per card ──────────────────────────────────────

const cardAccents: Record<string, { bg: string; text: string; hoverBorder: string }> = {
    'cg-crm': { bg: 'bg-teal-50 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-300', hoverBorder: 'hover:border-teal-200 dark:hover:border-teal-800' },
    'cg-marketing': { bg: 'bg-rose-50 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-300', hoverBorder: 'hover:border-rose-200 dark:hover:border-rose-800' },
    'cg-loyalty': { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-300', hoverBorder: 'hover:border-amber-200 dark:hover:border-amber-800' },
    'cg-catalog': { bg: 'bg-indigo-50 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-300', hoverBorder: 'hover:border-indigo-200 dark:hover:border-indigo-800' },    'cg-ecommerce': { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-300', hoverBorder: 'hover:border-violet-200 dark:hover:border-violet-800' },}

const defaultAccent = { bg: 'bg-teal-50 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-300', hoverBorder: 'hover:border-teal-200 dark:hover:border-teal-800' }

/**
 * Customer & Growth Landing / Overview page.
 * Shows hero banner + grouped quick-link cards with clickable sub-feature links.
 * Matches the same layout and styling as SupplyChainLandingView.
 */
export default function CustomerGrowthLandingView({ userName, bannerImageUrl, onViewChange }: CustomerGrowthLandingViewProps) {
    return (
        <div className="w-full space-y-6">
            {/* Hero Banner */}
            <CustomerGrowthHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            {/* Section subtitle */}
            <div>
                <p className="text-sm text-muted-foreground">
                    Manage customer engagement, marketing campaigns, loyalty programs, and product catalog.
                </p>
            </div>

            {/* Quick link grid — responsive, uses full available width */}
            <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {customerGrowthNavGroups.map((group: CustomerGrowthNavGroup) => {
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
