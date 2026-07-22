'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { hrNavGroups, type HrNavGroup } from '@/modules/hr/hrNav'
import HrHeroBanner from './HrHeroBanner'
import SetupReadinessBanner from '@/components/shared/SetupReadinessBanner'
import { cn } from '@/lib/utils'

interface HrLandingViewProps {
    userName?: string | null
    bannerImageUrl?: string | null
}

const cardDescriptions: Record<string, string> = {
    'hr-people': 'Manage employees, organizational chart, departments, and job positions.',
    'hr-attendance': 'Track clock-in/out events and review employee timesheets.',
    'hr-leave': 'Configure leave types, manage requests, and set up approval flows.',
    'hr-payroll': 'Define salary structures, allowances & deductions, and generate payslips.',
    'hr-performance': 'Set KPIs, conduct appraisals, and manage performance reviews.',
    'hr-settings': 'Configure departments, positions, approval rules, permissions, and accounting.',
}

const iconAccents: Record<string, { chip: string; icon: string }> = {
    'hr-people': { chip: 'bg-sky-50', icon: 'text-sky-600' },
    'hr-attendance': { chip: 'bg-teal-50', icon: 'text-teal-600' },
    'hr-leave': { chip: 'bg-violet-50', icon: 'text-violet-600' },
    'hr-payroll': { chip: 'bg-amber-50', icon: 'text-amber-600' },
    'hr-performance': { chip: 'bg-rose-50', icon: 'text-rose-600' },
    'hr-settings': { chip: 'bg-slate-100', icon: 'text-slate-600' },
}

const defaultIconAccent = { chip: 'bg-[var(--sera-orange)]/10', icon: 'text-[var(--sera-orange)]' }

export default function HrLandingView({ userName, bannerImageUrl }: HrLandingViewProps) {
    const router = useRouter()

    return (
        <div className="w-full space-y-8">
            <HrHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            <SetupReadinessBanner
                auditEndpoint="/api/hr/config/audit"
                settingsHref="/dashboard?view=hr/settings/configuration"
                moduleName="HR"
                accentColor="blue"
            />

            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {hrNavGroups.map((group: HrNavGroup) => {
                    const Icon = group.icon
                    const description = cardDescriptions[group.id]
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

                            {description && (
                                <p className="text-xs text-[var(--sera-muted)] leading-relaxed">{description}</p>
                            )}

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
