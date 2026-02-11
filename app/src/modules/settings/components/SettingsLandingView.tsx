'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { settingsNavGroups, type SettingsNavGroup } from '@/modules/settings/settingsNav'
import SettingsHeroBanner from './SettingsHeroBanner'

// ── Accent colors per group (index-based) ────────────────────────

const groupAccents: Record<string, { bg: string; text: string; hoverBorder: string }> = {
    'settings-profile': { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-300', hoverBorder: 'hover:border-blue-200 dark:hover:border-blue-800' },
    'settings-organization': { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-300', hoverBorder: 'hover:border-violet-200 dark:hover:border-violet-800' },
    'settings-notifications': { bg: 'bg-rose-50 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-300', hoverBorder: 'hover:border-rose-200 dark:hover:border-rose-800' },
    'settings-preferences': { bg: 'bg-teal-50 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-300', hoverBorder: 'hover:border-teal-200 dark:hover:border-teal-800' },
    'settings-authorization': { bg: 'bg-indigo-50 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-300', hoverBorder: 'hover:border-indigo-200 dark:hover:border-indigo-800' },
    'settings-ai': { bg: 'bg-purple-50 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-300', hoverBorder: 'hover:border-purple-200 dark:hover:border-purple-800' },
    'settings-danger-zone': { bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-300', hoverBorder: 'hover:border-red-200 dark:hover:border-red-800' },
}

const defaultAccent = { bg: 'bg-gray-50 dark:bg-gray-900/30', text: 'text-gray-600 dark:text-gray-300', hoverBorder: 'hover:border-gray-200 dark:hover:border-gray-800' }

// ── Props ────────────────────────────────────────────────────────

interface SettingsLandingViewProps {
    userName?: string | null
    /** User role level — used to filter Authorization and Danger Zone */
    roleLevel?: number
}

/**
 * Settings Landing / Overview page.
 * Shows hero banner + grouped quick-link cards generated from settingsNav config.
 */
export default function SettingsLandingView({ userName, roleLevel }: SettingsLandingViewProps) {
    const router = useRouter()

    // Filter groups based on role level
    const visibleGroups = settingsNavGroups.filter((group) => {
        // Authorization and Danger Zone: Super Admin only (role_level === 1)
        if (group.id === 'settings-authorization' || group.id === 'settings-danger-zone') {
            return roleLevel != null && roleLevel === 1
        }
        return true
    })

    return (
        <div className="w-full space-y-6">
            {/* Hero Banner */}
            <SettingsHeroBanner userName={userName ?? null} />

            {/* Section subtitle */}
            <div>
                <p className="text-sm text-muted-foreground">
                    Manage your account, organization, notifications, preferences, and system configuration.
                </p>
            </div>

            {/* Quick link grid — responsive, uses full available width */}
            <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {visibleGroups.map((group: SettingsNavGroup) => {
                    const Icon = group.icon
                    const accent = groupAccents[group.id] || defaultAccent

                    return (
                        <div
                            key={group.id}
                            className={`bg-card border border-border rounded-xl p-5 space-y-3 hover:shadow-md ${accent.hoverBorder} transition-all duration-200 group/card`}
                        >
                            <div className="flex items-center gap-2.5">
                                <div className={`flex items-center justify-center h-9 w-9 rounded-lg ${accent.bg} ${accent.text} transition-colors`}>
                                    <Icon className="h-4.5 w-4.5" />
                                </div>
                                <div>
                                    <h2 className="font-semibold text-base text-foreground">{group.label}</h2>
                                    {group.description && (
                                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{group.description}</p>
                                    )}
                                </div>
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
