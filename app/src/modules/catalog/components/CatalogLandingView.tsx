'use client'

import { ArrowRight } from 'lucide-react'
import { catalogNavGroups, type CatalogNavGroup } from '@/modules/catalog/catalogNav'
import CatalogHeroBanner from './CatalogHeroBanner'
import { cn } from '@/lib/utils'

interface CatalogLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
    onViewChange: (view: string) => void
    hideHeroBanner?: boolean
}

const iconAccents: Record<string, { chip: string; icon: string }> = {
    'cat-products': { chip: 'bg-indigo-50', icon: 'text-indigo-600' },
}

const defaultIconAccent = { chip: 'bg-sky-50', icon: 'text-sky-600' }

export default function CatalogLandingView({ userName, bannerImageUrl, onViewChange, hideHeroBanner }: CatalogLandingViewProps) {
    return (
        <div className="sera-module-landing">
            {!hideHeroBanner && <CatalogHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />}

            <div className="sera-module-landing__grid">
                {catalogNavGroups.map((group: CatalogNavGroup) => {
                    const Icon = group.icon
                    const accent = iconAccents[group.id] || defaultIconAccent

                    return (
                        <div key={group.id} className="sera-module-landing__card">
                            <div className="sera-module-landing__card-head">
                                <div className={cn('sera-module-landing__card-icon', accent.chip, accent.icon)}>
                                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                                </div>
                                <h2 className="sera-module-landing__card-title flex-1">{group.label}</h2>
                            </div>

                            <p className="sera-module-landing__card-desc">{group.description}</p>

                            <ul className="sera-module-landing__card-actions m-0 p-0 list-none">
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
                                                <span className="flex-1 text-left">{child.label}</span>
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
