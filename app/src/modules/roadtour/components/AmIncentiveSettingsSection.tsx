'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { KpiAmIncentiveMode } from '@/lib/roadtour/kpi'
import { cn } from '@/lib/utils'
import type { KpiIncentiveRuleRow } from '@/modules/roadtour/types/kpi'
import { BarChart3, Pencil, Percent, Plus, Trash2, Wallet } from 'lucide-react'
import { KpiVolumeTierTable } from './KpiVolumeTierTable'
import { KpiSettingsSectionCard, kpiSubTabListClass, kpiSubTabTriggerClass } from './KpiSettingsUi'

interface Props {
    mode: KpiAmIncentiveMode
    amTiers: KpiIncentiveRuleRow[]
    onModeChange: (mode: KpiAmIncentiveMode) => void
    onAddTier: () => void
    onEditTier: (rule: KpiIncentiveRuleRow) => void
    onDeleteTier: (ruleId: string) => void
}

export function AmIncentiveSettingsSection({
    mode,
    amTiers,
    onModeChange,
    onAddTier,
    onEditTier,
    onDeleteTier,
}: Props) {
    const sortedTiers = [...amTiers].sort(
        (a, b) => Number(a.achievement_threshold_percent) - Number(b.achievement_threshold_percent),
    )

    return (
        <KpiSettingsSectionCard
            icon={Wallet}
            tone="blue"
            title="AM Incentive"
            description="Choose how each AM earns their monthly incentive payout."
        >
            <Tabs
                value={mode}
                onValueChange={(value) => onModeChange(value as KpiAmIncentiveMode)}
                className="w-full space-y-4"
            >
                <TabsList className={kpiSubTabListClass}>
                    <TabsTrigger
                        value="volume_tiers"
                        className={cn(kpiSubTabTriggerClass, 'h-auto px-3')}
                    >
                        <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                            <BarChart3 className="h-4 w-4 shrink-0 text-brand" />
                            <span className="text-left">
                                <span className="block text-sm font-medium">By scan volume</span>
                                <span className="block text-xs font-normal text-muted-foreground">Scans × RM/scan</span>
                            </span>
                        </div>
                    </TabsTrigger>
                    <TabsTrigger
                        value="achievement_tiers"
                        className={cn(kpiSubTabTriggerClass, 'h-auto px-3')}
                    >
                        <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                            <Percent className="h-4 w-4 shrink-0 text-violet-600" />
                            <span className="text-left">
                                <span className="block text-sm font-medium">By achievement %</span>
                                <span className="block text-xs font-normal text-muted-foreground">Fixed RM per tier</span>
                            </span>
                        </div>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="volume_tiers" className="mt-0 space-y-3">
                    <div className="rounded-xl border border-brand/25 bg-brand-muted/70 px-3.5 py-2.5 text-sm text-brand-charcoal dark:text-orange-100">
                        <span className="font-semibold">Formula:</span> monthly scans × RM/scan for the AM&apos;s bracket.
                    </div>
                    <KpiVolumeTierTable compact />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        Example: 15,000 scans → RM 0.10/scan → <span className="font-semibold text-foreground">RM 1,500</span>.
                        Max Incentive / AM can cap the final payout.
                    </p>
                </TabsContent>

                <TabsContent value="achievement_tiers" className="mt-0 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="rounded-xl border border-violet-200/70 bg-violet-50/60 px-3.5 py-2.5 text-sm text-violet-900">
                            <span className="font-semibold">Rule:</span> highest achievement % tier met wins (not stacked).
                        </div>
                        <Button size="sm" onClick={onAddTier}>
                            <Plus className="h-4 w-4 mr-1" />
                            Add tier
                        </Button>
                    </div>

                    {sortedTiers.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 px-4 py-10 text-center">
                            <p className="text-sm font-medium">No custom tiers yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                e.g. 100% of target = RM 200, 120% = RM 300
                            </p>
                            <Button size="sm" variant="outline" className="mt-4" onClick={onAddTier}>
                                <Plus className="h-4 w-4 mr-1" />
                                Add first tier
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {sortedTiers.map((rule) => (
                                <div
                                    key={rule.id}
                                    className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/10 px-3 py-2.5"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium">
                                            {Number(rule.achievement_threshold_percent)}% of target
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            Pays <span className="font-semibold text-foreground">RM {Number(rule.incentive_amount).toLocaleString()}</span>
                                        </p>
                                    </div>
                                    {rule.status === 'active' ? (
                                        <Badge className="shrink-0 border border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                            Active
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary" className="shrink-0">Inactive</Badge>
                                    )}
                                    <div className="flex shrink-0 gap-0.5">
                                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEditTier(rule)}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => onDeleteTier(rule.id)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </KpiSettingsSectionCard>
    )
}
