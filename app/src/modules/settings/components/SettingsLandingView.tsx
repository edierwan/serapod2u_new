'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { settingsNavGroups, type SettingsNavGroup } from '@/modules/settings/settingsNav'
import SettingsHeroBanner from './SettingsHeroBanner'
import ModuleLandingCard from '@/components/layout/ModuleLandingCard'
import { cn } from '@/lib/utils'

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
    roleLevel?: number
    bannerImageUrl?: string | null
}

export default function SettingsLandingView({ userName, roleLevel, bannerImageUrl }: SettingsLandingViewProps) {
    const router = useRouter()

    const visibleGroups = settingsNavGroups.filter((group) => {
        if (group.id === 'settings-authorization' || group.id === 'settings-danger-zone') {
            return roleLevel != null && roleLevel === 1
        }
        return true
    })

    return (
        <div className="sera-module-landing">
            <SettingsHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            <div className="sera-module-landing__grid">
                {visibleGroups.map((group: SettingsNavGroup) => {
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
                                                onClick={() => router.push(child.href)}
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
