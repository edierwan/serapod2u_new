'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { hrNavGroups, type HrNavGroup } from '@/modules/hr/hrNav'
import HrHeroBanner from './HrHeroBanner'
import SetupReadinessBanner from '@/components/shared/SetupReadinessBanner'

// ── Props ────────────────────────────────────────────────────────

interface HrLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
}

// ── Card metadata (extra descriptions for landing page) ──────────

const cardDescriptions: Record<string, string> = {
    'hr-people': 'Manage employees, organizational chart, departments, and job positions.',
    'hr-attendance': 'Track clock-in/out events and review employee timesheets.',
    'hr-leave': 'Configure leave types, manage requests, and set up approval flows.',
    'hr-payroll': 'Define salary structures, allowances & deductions, and generate payslips.',
    'hr-performance': 'Set KPIs, conduct appraisals, and manage performance reviews.',
    'hr-settings': 'Configure departments, positions, approval rules, permissions, and accounting.',
}

// ── Accent colours per card ──────────────────────────────────────

const cardAccents: Record<string, { bg: string; text: string; hoverBorder: string }> = {
    'hr-people': { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-300', hoverBorder: 'hover:border-blue-200 dark:hover:border-blue-800' },
    'hr-attendance': { bg: 'bg-teal-50 dark:bg-teal-900/30', text: 'text-teal-600 dark:text-teal-300', hoverBorder: 'hover:border-teal-200 dark:hover:border-teal-800' },
    'hr-leave': { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-300', hoverBorder: 'hover:border-violet-200 dark:hover:border-violet-800' },
    'hr-payroll': { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-300', hoverBorder: 'hover:border-amber-200 dark:hover:border-amber-800' },
    'hr-performance': { bg: 'bg-rose-50 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-300', hoverBorder: 'hover:border-rose-200 dark:hover:border-rose-800' },
    'hr-settings': { bg: 'bg-slate-50 dark:bg-slate-900/30', text: 'text-slate-600 dark:text-slate-300', hoverBorder: 'hover:border-slate-200 dark:hover:border-slate-800' },
}

const defaultAccent = { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-300', hoverBorder: 'hover:border-blue-200 dark:hover:border-blue-800' }

/**
 * HR Landing / Overview page.
 * Shows hero banner + grouped quick-link cards generated from hrNav config.
 * Matches the same layout and styling as FinanceLandingView.
 */
export default function HrLandingView({ userName, bannerImageUrl }: HrLandingViewProps) {
    const router = useRouter()

    return (
        <div className="w-full space-y-6">
            {/* Hero Banner */}
            <HrHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            {/* Setup Readiness */}
            <SetupReadinessBanner
                auditEndpoint="/api/hr/config/audit"
                settingsHref="/dashboard?view=hr/settings/configuration"
                moduleName="HR"
                accentColor="blue"
            />

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
                    const description = cardDescriptions[group.id]
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

                            {description && (
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    {description}
                                </p>
                            )}

                            <ul className="space-y-0.5">
                                {group.children.map((child) => {
                                    const ChildIcon = child.icon
                                    return (
                                        <li key={child.id}>
                                            <button
                                                onClick={() => router.push(child.href)}
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
