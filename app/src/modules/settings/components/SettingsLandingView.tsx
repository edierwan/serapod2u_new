'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { settingsNavGroups, type SettingsNavGroup } from '@/modules/settings/settingsNav'
import SettingsHeroBanner from './SettingsHeroBanner'
import { cn } from '@/lib/utils'

/** Soft icon accents — color on icons only, cards stay paper-white */
const iconAccents: Record<string, { chip: string; icon: string }> = {
    'settings-profile': { chip: 'bg-sky-50', icon: 'text-sky-600' },
    'settings-organization': { chip: 'bg-violet-50', icon: 'text-violet-600' },
    'settings-notifications': { chip: 'bg-rose-50', icon: 'text-rose-600' },
    'settings-preferences': { chip: 'bg-teal-50', icon: 'text-teal-600' },
    'settings-authorization': { chip: 'bg-indigo-50', icon: 'text-indigo-600' },
    'settings-ai': { chip: 'bg-amber-50', icon: 'text-amber-600' },
    'settings-danger-zone': { chip: 'bg-red-50', icon: 'text-red-600' },
}

const defaultIconAccent = { chip: 'bg-[var(--sera-orange)]/10', icon: 'text-[var(--sera-orange)]' }

interface SettingsLandingViewProps {
    userName?: string | null
    /** User role level — used to filter Authorization and Danger Zone */
    roleLevel?: number
    /** Custom banner image URL */
    bannerImageUrl?: string | null
}

/**
 * Settings Landing / Overview page.
 * Light Serapod paper chrome + grouped quick-link cards from settingsNav config.
 */
export default function SettingsLandingView({ userName, roleLevel, bannerImageUrl }: SettingsLandingViewProps) {
    const router = useRouter()

    const visibleGroups = settingsNavGroups.filter((group) => {
        if (group.id === 'settings-authorization' || group.id === 'settings-danger-zone') {
            return roleLevel != null && roleLevel === 1
        }
        return true
    })

    return (
        <div className="w-full space-y-8">
            <SettingsHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {visibleGroups.map((group: SettingsNavGroup) => {
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
                                <div className="min-w-0 flex-1">
                                    <h2 className="font-semibold text-base text-[var(--sera-ink)]">{group.label}</h2>
                                    {group.description ? (
                                        <p className="text-xs text-[var(--sera-muted)] mt-0.5 line-clamp-1">{group.description}</p>
                                    ) : null}
                                </div>
                            </div>

                            <ul className="space-y-0.5 pt-1">
                                {group.children.map((child) => {
                                    const ChildIcon = child.icon
                                    return (
                                        <li key={child.id}>
                                            <button
                                                type="button"
                                                onClick={() => router.push(child.href)}
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
