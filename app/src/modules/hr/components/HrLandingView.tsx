'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { hrNavGroups, type HrNavGroup } from '@/modules/hr/hrNav'
import HrHeroBanner from './HrHeroBanner'
import SetupReadinessBanner from '@/components/shared/SetupReadinessBanner'
import ModuleLandingCard from '@/components/layout/ModuleLandingCard'
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
        <div className="sera-module-landing">
            <HrHeroBanner userName={userName ?? null} bannerImageUrl={bannerImageUrl} />

            <SetupReadinessBanner
                auditEndpoint="/api/hr/config/audit"
                settingsHref="/dashboard?view=hr/settings/configuration"
                moduleName="HR"
                accentColor="blue"
            />

            <div className="sera-module-landing__grid">
                {hrNavGroups.map((group: HrNavGroup) => {
                    const Icon = group.icon
                    const description = cardDescriptions[group.id]
                    const accent = iconAccents[group.id] || defaultIconAccent

                    return (
                        <ModuleLandingCard
                            key={group.id}
                            icon={Icon}
                            accent={accent}
                            title={group.label}
                            description={description}
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
                                                <span className="flex-1 text-left">{child.label}</span>
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
