'use client'

import { ArrowRight } from 'lucide-react'
import { loyaltyNavGroups, type LoyaltyNavGroup } from '@/modules/loyalty/loyaltyNav'
import LoyaltyHeroBanner from './LoyaltyHeroBanner'
import { cn } from '@/lib/utils'

interface LoyaltyLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
    onViewChange: (view: string) => void
    hideHeroBanner?: boolean
}

const iconAccents: Record<string, { chip: string; icon: string }> = {
    'ly-rewards': { chip: 'bg-amber-50', icon: 'text-amber-600' },
}

const defaultIconAccent = { chip: 'bg-violet-50', icon: 'text-violet-600' }

export default function LoyaltyLandingView({ userName, bannerImageUrl, onViewChange, hideHeroBanner }: LoyaltyLandingViewProps) {
    return (
        <div className="w-full space-y-8">
            {!hideHeroBanner && <LoyaltyHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />}

            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {loyaltyNavGroups.map((group: LoyaltyNavGroup) => {
                    const Icon = group.icon
                    const accent = iconAccents[group.id] || defaultIconAccent

                    return (
                        <div
                            key={group.id}
                            className="rounded-xl border border-[var(--sera-line)] bg-white p-5 space-y-3 transition-colors hover:border-[var(--sera-orange)]/35"
                        >
                            <div className="flex items-center gap-2.5">
                                <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', accent.chip, accent.icon)}>
                                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                                </div>
                                <h2 className="font-semibold text-base text-[var(--sera-ink)] flex-1">{group.label}</h2>
                            </div>

                            <p className="text-xs text-[var(--sera-muted)] leading-relaxed">{group.description}</p>

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
