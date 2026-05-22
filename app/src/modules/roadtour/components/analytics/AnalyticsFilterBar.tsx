'use client'

import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { ImpactDataset, ImpactStatus, ImpactWindow } from '@/modules/roadtour/types/analytics'
import type { ImpactFilters } from '@/modules/roadtour/lib/analytics/useImpactDataset'
import { defaultDateRange } from '@/modules/roadtour/lib/analytics/useImpactDataset'

interface BaseProps {
    filters: ImpactFilters
    setFilters: (f: ImpactFilters | ((prev: ImpactFilters) => ImpactFilters)) => void
    dataset: ImpactDataset | null
    extra?: React.ReactNode
    showStatus?: boolean
    statusValue?: ImpactStatus | 'all'
    onStatusChange?: (v: ImpactStatus | 'all') => void
    shopSearchValue?: string
    onShopSearchChange?: (v: string) => void
    showShopSearch?: boolean
}

export function AnalyticsFilterBar({
    filters, setFilters, dataset, extra,
    showStatus, statusValue, onStatusChange,
    showShopSearch, shopSearchValue, onShopSearchChange,
}: BaseProps) {
    const setWindow = (w: ImpactWindow) => {
        const dr = defaultDateRange(w)
        setFilters((prev) => ({ ...prev, windowDays: w, dateFrom: dr.dateFrom, dateTo: dr.dateTo }))
    }
    return (
        <Card className="p-3 sm:p-4 mb-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                <div>
                    <label className="text-xs font-medium text-muted-foreground">Campaign</label>
                    <Select value={filters.campaignId ?? 'all'} onValueChange={(v) => setFilters((p) => ({ ...p, campaignId: v === 'all' ? null : v }))}>
                        <SelectTrigger><SelectValue placeholder="All Campaigns" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Campaigns</SelectItem>
                            {dataset?.campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <label className="text-xs font-medium text-muted-foreground">Account Manager</label>
                    <Select value={filters.accountManagerUserId ?? 'all'} onValueChange={(v) => setFilters((p) => ({ ...p, accountManagerUserId: v === 'all' ? null : v }))}>
                        <SelectTrigger><SelectValue placeholder="All Account Managers" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Account Managers</SelectItem>
                            {dataset?.accountManagers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <label className="text-xs font-medium text-muted-foreground">Region</label>
                    <Select value={filters.regionStateId ?? 'all'} onValueChange={(v) => setFilters((p) => ({ ...p, regionStateId: v === 'all' ? null : v }))}>
                        <SelectTrigger><SelectValue placeholder="All Regions" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Regions</SelectItem>
                            {dataset?.regions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                {showStatus && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Impact Status</label>
                        <Select value={statusValue ?? 'all'} onValueChange={(v) => onStatusChange?.(v as any)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Statuses</SelectItem>
                                <SelectItem value="improved">Improved</SelectItem>
                                <SelectItem value="maintained">Maintained</SelectItem>
                                <SelectItem value="dropped">Dropped</SelectItem>
                                <SelectItem value="newly_activated">Newly Activated</SelectItem>
                                <SelectItem value="no_response">No Response</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}
                {showShopSearch && (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Shop Search</label>
                        <Input placeholder="Search shop name or code" value={shopSearchValue ?? ''} onChange={(e) => onShopSearchChange?.(e.target.value)} />
                    </div>
                )}
                <div className="md:col-span-2 lg:col-span-2 xl:col-span-2 flex flex-col">
                    <label className="text-xs font-medium text-muted-foreground">Date Range</label>
                    <div className="flex gap-2 items-center">
                        <Input type="date" value={filters.dateFrom ?? ''} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value || null }))} />
                        <span className="text-muted-foreground text-xs">to</span>
                        <Input type="date" value={filters.dateTo ?? ''} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value || null }))} />
                    </div>
                </div>
                <div className="flex flex-col">
                    <label className="text-xs font-medium text-muted-foreground">Window</label>
                    <div className="flex gap-1">
                        {[3, 7, 30].map((w) => (
                            <Button
                                key={w}
                                type="button"
                                variant={filters.windowDays === w ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setWindow(w as ImpactWindow)}
                                className="flex-1"
                            >{w}D</Button>
                        ))}
                    </div>
                </div>
                {extra}
            </div>
        </Card>
    )
}
