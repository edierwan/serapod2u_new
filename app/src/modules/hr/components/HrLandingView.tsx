'use client'

import { useRouter } from 'next/navigation'
import {
    ArrowRight,
} from 'lucide-react'
import { hrNavGroups, type HrNavGroup } from '@/modules/hr/hrNav'
import HrHeroBanner from './HrHeroBanner'

// ── Props ────────────────────────────────────────────────────────

interface HrLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
}

/**
 * HR Landing / Overview page.
 * Shows hero banner + grouped quick-link cards generated from hrNav config.
 */
export default function HrLandingView({ userName, bannerImageUrl }: HrLandingViewProps) {
    const router = useRouter()

    return (
        <div className="w-full space-y-6">
            {/* Hero Banner */}
            <HrHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            {/* Section subtitle */}
            <div>
                <p className="text-sm text-muted-foreground">
                    Manage your workforce — people, attendance, leave, payroll, performance, and settings.
                </p>
            </div>

            {/* Quick link grid — responsive, uses full available width */}
            <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {hrNavGroups.map((group: HrNavGroup) => {
                    const Icon = group.icon
                    return (
                        <div
                            key={group.id}
                            className="bg-card border border-border rounded-xl p-5 space-y-3 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all duration-200 group/card"
                        >
                            <div className="flex items-center gap-2.5">
                                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 group-hover/card:bg-blue-100 dark:group-hover/card:bg-blue-900/50 transition-colors">
                                    <Icon className="h-4.5 w-4.5" />
                                </div>
                                <h2 className="font-semibold text-base text-foreground">{group.label}</h2>
                            </div>

                            <ul className="space-y-0.5">
                                {group.children.map((child) => {
                                    const ChildIcon = child.icon
                                    return (
                                        <li key={child.id}>
                                            <button
                                                onClick={() => router.push(child.href)}
                                                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors group"
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
