'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    DEFAULT_KPI_VOLUME_TIERS,
    formatVolumeTierRange,
    type KpiVolumeTier,
} from '@/lib/roadtour/kpi'

interface Props {
    tiers?: KpiVolumeTier[]
    /** Show RM / scan column label variant */
    rateLabel?: string
    className?: string
    /** Denser list layout for settings panels */
    compact?: boolean
}

export function KpiVolumeTierTable({
    tiers = DEFAULT_KPI_VOLUME_TIERS,
    rateLabel = 'RM / scan',
    className,
    compact = false,
}: Props) {
    if (compact) {
        return (
            <div className={className}>
                <div className="rounded-lg border divide-y text-sm">
                    {tiers.map((tier) => (
                        <div
                            key={`${tier.min}-${tier.max ?? 'open'}`}
                            className="flex items-center justify-between gap-4 px-3 py-2"
                        >
                            <span className="text-muted-foreground">{formatVolumeTierRange(tier)}</span>
                            <span className="font-medium tabular-nums">
                                {tier.ratePerScan === 0 ? 'RM 0' : `RM ${tier.ratePerScan.toFixed(2)}`}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className={className}>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Monthly Scans</TableHead>
                        <TableHead className="text-right">{rateLabel}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {tiers.map((tier) => (
                        <TableRow key={`${tier.min}-${tier.max ?? 'open'}`}>
                            <TableCell className="font-medium">{formatVolumeTierRange(tier)}</TableCell>
                            <TableCell className="text-right">
                                {tier.ratePerScan === 0 ? '0' : `RM ${tier.ratePerScan.toFixed(2)}`}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
