'use client'

import { ArrowRight } from 'lucide-react'
import { catalogNavGroups, type CatalogNavGroup } from '@/modules/catalog/catalogNav'
import CatalogHeroBanner from './CatalogHeroBanner'

interface CatalogLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
    onViewChange: (view: string) => void
    /** When true, suppress the hero banner (used when rendered inside domain shell) */
    hideHeroBanner?: boolean
}

const cardAccents: Record<string, { bg: string; text: string; hoverBorder: string }> = {
    'cat-products': { bg: 'bg-indigo-50 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-300', hoverBorder: 'hover:border-indigo-200 dark:hover:border-indigo-800' },
}

const defaultAccent = { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-300', hoverBorder: 'hover:border-blue-200 dark:hover:border-blue-800' }

export default function CatalogLandingView({ userName, bannerImageUrl, onViewChange, hideHeroBanner }: CatalogLandingViewProps) {
    return (
        <div className="w-full space-y-6">
            {!hideHeroBanner && <CatalogHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />}

            <div>
                <p className="text-sm text-muted-foreground">
                    Manage consumer-facing product catalog and variants.
                </p>
            </div>

            <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {catalogNavGroups.map((group: CatalogNavGroup) => {
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
