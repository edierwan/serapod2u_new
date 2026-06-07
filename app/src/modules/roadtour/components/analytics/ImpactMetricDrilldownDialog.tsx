'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { VisitImpactRow } from '@/modules/roadtour/types/analytics'
import { EmptyBlock, StatusPill, formatLiftPercent } from './shared'

export type ImpactDrilldownMetric = 'visited_shops' | 'improved_shops' | 'newly_activated' | 'no_response'

const METRIC_TITLES: Record<ImpactDrilldownMetric, string> = {
    visited_shops: 'Visited Shops',
    improved_shops: 'Improved Shops',
    newly_activated: 'Newly Activated Shops',
    no_response: 'No Response Shops',
}

const METRIC_EXPORT_NAMES: Record<ImpactDrilldownMetric, string> = {
    visited_shops: 'visited-shops',
    improved_shops: 'improved-shops',
    newly_activated: 'newly-activated-shops',
    no_response: 'no-response-shops',
}

interface ImpactMetricDrilldownDialogProps {
    open: boolean
    metric: ImpactDrilldownMetric | null
    rows: VisitImpactRow[]
    windowDays: number
    onOpenChange: (open: boolean) => void
}

function formatDateTime(value: string | null): string {
    return value ? new Date(value).toLocaleString() : '—'
}

export function ImpactMetricDrilldownDialog({
    open,
    metric,
    rows,
    windowDays,
    onOpenChange,
}: ImpactMetricDrilldownDialogProps) {
    const [search, setSearch] = useState('')

    useEffect(() => {
        if (open) setSearch('')
    }, [open, metric])

    const title = metric ? METRIC_TITLES[metric] : 'Shop Records'

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (!query) return rows

        return rows.filter((row) => (
            `${row.shop_name} ${row.shop_code ?? ''} ${row.shop_region ?? ''} ${row.account_manager_name} ${row.notes ?? ''}`
                .toLowerCase()
                .includes(query)
        ))
    }, [rows, search])

    const handleExport = () => {
        if (!metric || filteredRows.length === 0) return

        const headers = [
            'No.',
            'Shop Name',
            'Shop Code',
            'Region',
            'Account Manager',
            'Visit Date',
            `Before ${windowDays}D`,
            `After ${windowDays}D`,
            'Lift %',
            'Impact Status',
            'First Scan After Visit',
            'Last Scan After Visit',
            'Days Since Visit',
        ]

        const csvRows = filteredRows.map((row, index) => [
            index + 1,
            row.shop_name,
            row.shop_code ?? '',
            row.shop_region ?? '',
            row.account_manager_name,
            row.visit_date,
            row.before_scans,
            row.after_scans,
            row.status === 'newly_activated' ? 'NEW' : formatLiftPercent(row.scan_lift_percent),
            row.status,
            formatDateTime(row.first_scan_after_at),
            formatDateTime(row.last_scan_after_at),
            row.days_since_visit,
        ])

        const csv = [headers, ...csvRows]
            .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n')

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `roadtour-${METRIC_EXPORT_NAMES[metric]}-${windowDays}d.csv`
        link.click()
        URL.revokeObjectURL(url)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[calc(100dvh-24px)] overflow-hidden p-0 sm:max-w-6xl">
                <div className="flex h-full max-h-[calc(100dvh-24px)] flex-col overflow-hidden">
                    <DialogHeader className="border-b px-4 py-4 sm:px-6">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <DialogTitle>{title}</DialogTitle>
                                <DialogDescription>
                                    {filteredRows.length} record{filteredRows.length === 1 ? '' : 's'} matching the current filters and {windowDays}D window.
                                </DialogDescription>
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        placeholder="Search shop, code, region, or AM"
                                        className="pl-9 sm:w-72"
                                    />
                                </div>
                                <Button variant="outline" size="sm" onClick={handleExport} disabled={filteredRows.length === 0}>
                                    <Download className="mr-1.5 h-4 w-4" />
                                    Export
                                </Button>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="min-h-0 flex-1 overflow-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-4 sm:px-6">
                        {filteredRows.length === 0 ? (
                            <EmptyBlock title="No records found for the selected filters." />
                        ) : (
                            <div className="overflow-x-auto rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>No.</TableHead>
                                            <TableHead>Shop Name</TableHead>
                                            <TableHead>Shop Code</TableHead>
                                            <TableHead>Region</TableHead>
                                            <TableHead>Account Manager</TableHead>
                                            <TableHead>Visit Date</TableHead>
                                            <TableHead className="text-right">Before {windowDays}D</TableHead>
                                            <TableHead className="text-right">After {windowDays}D</TableHead>
                                            <TableHead className="text-right">Lift %</TableHead>
                                            <TableHead>Impact Status</TableHead>
                                            <TableHead>First Scan After</TableHead>
                                            <TableHead>Last Scan After</TableHead>
                                            <TableHead className="text-right">Days Since Visit</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredRows.map((row, index) => (
                                            <TableRow key={row.visit_id}>
                                                <TableCell>{index + 1}</TableCell>
                                                <TableCell className="font-medium">{row.shop_name}</TableCell>
                                                <TableCell>{row.shop_code ?? '—'}</TableCell>
                                                <TableCell>{row.shop_region ?? '—'}</TableCell>
                                                <TableCell>{row.account_manager_name}</TableCell>
                                                <TableCell>{row.visit_date}</TableCell>
                                                <TableCell className="text-right">{row.before_scans}</TableCell>
                                                <TableCell className="text-right">{row.after_scans}</TableCell>
                                                <TableCell className="text-right font-semibold">
                                                    {row.status === 'newly_activated' ? 'NEW' : formatLiftPercent(row.scan_lift_percent)}
                                                </TableCell>
                                                <TableCell><StatusPill status={row.status} /></TableCell>
                                                <TableCell>{formatDateTime(row.first_scan_after_at)}</TableCell>
                                                <TableCell>{formatDateTime(row.last_scan_after_at)}</TableCell>
                                                <TableCell className="text-right">{row.days_since_visit}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}