'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { KpiTeamRow } from '@/modules/roadtour/types/kpi'
import { Plus, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const TONE_ICON: Record<string, string> = {
    blue: 'from-[#FF5722] to-orange-600 shadow-orange-500/25',
    brand: 'from-[#FF5722] to-orange-600 shadow-orange-500/25',
    amber: 'from-amber-500 to-orange-500 shadow-amber-500/20',
    violet: 'from-violet-500 to-purple-600 shadow-violet-500/20',
    emerald: 'from-emerald-500 to-teal-600 shadow-emerald-500/20',
    slate: 'from-slate-500 to-slate-700 shadow-slate-500/20',
}

export function KpiSettingsSectionCard({
    icon: Icon,
    tone = 'blue',
    title,
    description,
    headerAction,
    children,
    className,
    contentClassName,
}: {
    icon: LucideIcon
    tone?: keyof typeof TONE_ICON
    title: string
    description?: string
    headerAction?: React.ReactNode
    children: React.ReactNode
    className?: string
    contentClassName?: string
}) {
    return (
        <Card className={cn('overflow-hidden rounded-2xl border-border/70 shadow-sm', className)}>
            <CardHeader className="border-b border-border/50 bg-muted/15 pb-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                        <div
                            className={cn(
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md',
                                TONE_ICON[tone],
                            )}
                        >
                            <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <CardTitle className="text-base leading-tight">{title}</CardTitle>
                            {description && (
                                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                            )}
                        </div>
                    </div>
                    {headerAction && <div className="shrink-0">{headerAction}</div>}
                </div>
            </CardHeader>
            <CardContent className={cn('pt-5', contentClassName)}>{children}</CardContent>
        </Card>
    )
}

export const kpiTabListClass =
    'grid h-auto w-full grid-cols-2 gap-0 rounded-none border-b border-border bg-muted/30 p-0 sm:grid-cols-4'

export const kpiTabTriggerClass =
    'relative flex items-center justify-center gap-1.5 rounded-none border-b-2 border-transparent px-4 py-3.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted/40 hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-none'

export function KpiSettingsTabsPanel({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('w-full border-t border-border/60 bg-card p-4 sm:p-5', className)}>
            {children}
        </div>
    )
}

export const kpiSubTabListClass =
    'grid h-auto w-full grid-cols-2 gap-0 rounded-lg border border-border/70 bg-muted/25 p-0'

export const kpiSubTabTriggerClass =
    'rounded-none border-b-2 border-transparent py-2.5 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm'

export function KpiFieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <label className={cn('mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)}>
            {children}
        </label>
    )
}

export function KpiHintBanner({
    tone = 'blue',
    children,
    className,
}: {
    tone?: 'blue' | 'sky' | 'amber' | 'indigo' | 'violet'
    children: React.ReactNode
    className?: string
}) {
    const styles = {
        blue: 'border-orange-200/80 bg-brand-muted/80 text-brand-charcoal dark:text-orange-100',
        brand: 'border-orange-200/80 bg-brand-muted/80 text-brand-charcoal dark:text-orange-100',
        sky: 'border-sky-200/80 bg-sky-50/70 text-sky-900',
        amber: 'border-amber-200/80 bg-amber-50/70 text-amber-900',
        indigo: 'border-indigo-200/80 bg-indigo-50/70 text-indigo-900',
        violet: 'border-violet-200/80 bg-violet-50/70 text-violet-900',
    }
    return (
        <div className={cn('rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed', styles[tone], className)}>
            {children}
        </div>
    )
}

export function KpiTableShell({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('overflow-hidden rounded-xl border border-border/70 bg-card', className)}>
            {children}
        </div>
    )
}

export function KpiTeamSidebar({
    teams,
    selectedTeamId,
    amById,
    isFrozen,
    onSelectTeam,
    onAddTeam,
    onDeleteTeam,
}: {
    teams: KpiTeamRow[]
    selectedTeamId: string | null
    amById: Map<string, { full_name?: string }>
    isFrozen: boolean
    onSelectTeam: (team: KpiTeamRow) => void
    onAddTeam: () => void
    onDeleteTeam: (teamId: string) => void
}) {
    return (
        <div className="flex h-full flex-col rounded-2xl border border-border/70 bg-muted/10">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-3">
                <p className="text-sm font-semibold">Teams</p>
                <Button size="sm" variant="outline" className="h-8" onClick={onAddTeam} disabled={isFrozen}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                </Button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {teams.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/80 px-3 py-8 text-center">
                        <p className="text-sm font-medium">No teams yet</p>
                        <p className="mt-1 text-xs text-muted-foreground">Add your first team to set targets and members.</p>
                    </div>
                ) : (
                    teams.map((team) => {
                        const autoPerAm = team.members.length > 0
                            ? Math.floor(team.monthly_team_target / team.members.length)
                            : 0
                        const selected = selectedTeamId === team.id
                        return (
                            <div
                                key={team.id}
                                className={cn(
                                    'group rounded-xl border p-3 transition-all',
                                    selected
                                        ? 'border-primary/40 bg-primary/5 shadow-sm ring-1 ring-primary/20'
                                        : 'border-border/60 bg-card hover:border-border hover:bg-muted/30',
                                )}
                            >
                                <button
                                    type="button"
                                    className="w-full text-left"
                                    onClick={() => onSelectTeam(team)}
                                >
                                    <p className="font-medium leading-tight">{team.team_name}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {team.members.length} AMs · {team.monthly_team_target.toLocaleString()} scans
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        Leader: {team.leader_user_id ? (amById.get(team.leader_user_id)?.full_name || '—') : '—'}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        ~{autoPerAm.toLocaleString()} scans / AM
                                    </p>
                                </button>
                                <div className="mt-2 flex justify-end opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-rose-600"
                                        disabled={isFrozen}
                                        onClick={() => onDeleteTeam(team.id)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

export function KpiTierRow({
    title,
    subtitle,
    badge,
    actions,
}: {
    title: string
    subtitle?: string
    badge?: React.ReactNode
    actions: React.ReactNode
}) {
    return (
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/10 px-3 py-2.5">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{title}</p>
                {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {badge}
            <div className="flex shrink-0 gap-0.5">{actions}</div>
        </div>
    )
}
