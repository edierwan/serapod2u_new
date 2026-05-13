'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Edit,
    Copy,
    Trash2,
    Coins,
    Star,
    Gift,
    Download,
    QrCode,
    Scan,
    BarChart3,
    Loader2,
    Clock,
    Truck,
    RefreshCw,
    MoreHorizontal,
    Activity,
    TrendingUp,
    type LucideIcon,
} from 'lucide-react'

interface JourneyConfig {
    id: string
    name: string
    is_active: boolean
    is_default: boolean
    points_enabled: boolean
    lucky_draw_enabled: boolean
    redemption_enabled: boolean
    enable_scratch_card_game?: boolean
    start_at: string | null
    end_at: string | null
    activation_status?: string | null
    activation_mode?: string | null
    order_info?: {
        order_no: string
        legacy_order_no?: string
        order_type: string
        order_id: string
    }
    created_at?: string
}

interface QRStats {
    total_valid_links: number
    links_scanned: number
    claim_mode?: 'single_shop' | 'dual'
    shop_links_scanned?: number
    consumer_links_scanned?: number
    lucky_draw_entries: number
    redemptions: number
    points_collected: number
    scratch_card_plays?: number
    failed_scans?: number
    last_scan_at?: string | null
}

interface JourneyCardWithStatsProps {
    journey: JourneyConfig
    onEdit: () => void
    onDuplicate: () => void
    onDelete: () => void
}

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
    const [displayValue, setDisplayValue] = useState(value)
    const [isAnimating, setIsAnimating] = useState(false)
    const prevValueRef = useRef(value)

    useEffect(() => {
        if (prevValueRef.current !== value) {
            setIsAnimating(true)
            const duration = 300
            const startValue = prevValueRef.current
            const endValue = value
            const startTime = Date.now()

            const animate = () => {
                const elapsed = Date.now() - startTime
                const progress = Math.min(elapsed / duration, 1)
                const easeProgress = 1 - Math.pow(1 - progress, 3)
                const currentValue = Math.round(startValue + (endValue - startValue) * easeProgress)
                setDisplayValue(currentValue)

                if (progress < 1) {
                    requestAnimationFrame(animate)
                } else {
                    setDisplayValue(endValue)
                    setIsAnimating(false)
                    prevValueRef.current = value
                }
            }

            requestAnimationFrame(animate)
        }
    }, [value])

    return (
        <span className={`${className} ${isAnimating ? 'text-blue-600' : ''} transition-colors duration-200`}>
            {displayValue.toLocaleString()}
        </span>
    )
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

function formatRelativeTime(iso?: string | null) {
    if (!iso) return 'No scans yet'
    const ms = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(ms) || ms < 0) return 'just now'
    const minutes = Math.floor(ms / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes} mins ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
}

function getFeatureBadges(journey: JourneyConfig): { label: string; icon: LucideIcon; className: string; ringColor: string }[] {
    const badges = []
    if (journey.points_enabled) badges.push({ label: 'Points', icon: Coins, className: 'border-blue-200 bg-blue-50 text-blue-700', ringColor: '#2563eb' })
    if (journey.lucky_draw_enabled) badges.push({ label: 'Lucky Draw', icon: Star, className: 'border-violet-200 bg-violet-50 text-violet-700', ringColor: '#7c3aed' })
    if (journey.redemption_enabled) badges.push({ label: 'Redemption', icon: Gift, className: 'border-emerald-200 bg-emerald-50 text-emerald-700', ringColor: '#059669' })
    if (journey.enable_scratch_card_game) badges.push({ label: 'Scratch Card', icon: Gift, className: 'border-rose-200 bg-rose-50 text-rose-700', ringColor: '#e11d48' })
    return badges.length ? badges : [{ label: 'Journey', icon: QrCode, className: 'border-slate-200 bg-slate-50 text-slate-700', ringColor: '#475569' }]
}

function getOutcomeMetric(journey: JourneyConfig, stats: QRStats) {
    if (journey.lucky_draw_enabled && !journey.redemption_enabled) {
        return { label: 'Joined', value: stats.lucky_draw_entries }
    }
    if (journey.redemption_enabled) {
        return { label: 'Redeemed', value: stats.redemptions }
    }
    if (journey.enable_scratch_card_game) {
        return { label: 'Played', value: stats.scratch_card_plays || 0 }
    }
    return { label: 'Collected', value: stats.points_collected }
}

function buildSparkline(stats: QRStats) {
    const scanned = stats.links_scanned || 0
    const outcome = Math.max(stats.redemptions || 0, stats.lucky_draw_entries || 0, stats.points_collected || 0, stats.scratch_card_plays || 0)
    const total = Math.max(scanned, outcome)
    if (total <= 0) return [0, 0, 0, 0, 0, 0, 0]
    return [
        0,
        Math.round(total * 0.12),
        Math.round(total * 0.2),
        Math.round(total * 0.38),
        Math.round(total * 0.52),
        Math.round(total * 0.76),
        total,
    ]
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
    const max = Math.max(...values, 1)
    const min = Math.min(...values)
    const range = Math.max(max - min, 1)
    const points = values.map((value, index) => {
        const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100
        const y = 34 - ((value - min) / range) * 26
        return `${x},${y}`
    }).join(' ')

    return (
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-11 w-full overflow-visible" aria-hidden="true">
            <polyline points={`0,38 ${points} 100,38`} fill={color} fillOpacity="0.09" stroke="none" />
            <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
    )
}

function UtilizationRing({ percent, color }: { percent: number; color: string }) {
    const safePercent = clamp(Math.round(percent), 0, 100)
    return (
        <div className="flex flex-col items-center gap-2">
            <div
                className="grid h-24 w-24 place-items-center rounded-full shadow-inner"
                style={{ background: `conic-gradient(${color} ${safePercent * 3.6}deg, #e2e8f0 0deg)` }}
            >
                <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-white">
                    <div className="text-center leading-none">
                        <div className="text-xl font-bold tabular-nums text-slate-950">{safePercent}%</div>
                        <div className="mt-1 text-[10px] font-medium uppercase text-slate-400">QR Use</div>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500">
                <Scan className="h-3 w-3" /> Utilization
            </div>
        </div>
    )
}

function MetricCell({ label, value, tone }: { label: string; value: number; tone: string }) {
    return (
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <AnimatedNumber value={value} className={`mt-0.5 block text-lg font-bold leading-none tabular-nums ${tone}`} />
        </div>
    )
}

function getHealthScore(journey: JourneyConfig, stats: QRStats) {
    const generated = stats.total_valid_links || 0
    const scanned = stats.links_scanned || 0
    const outcome = Math.max(stats.redemptions || 0, stats.lucky_draw_entries || 0, stats.points_collected || 0, stats.scratch_card_plays || 0)
    const failed = stats.failed_scans || 0
    const utilization = generated > 0 ? scanned / generated : 0
    const conversion = scanned > 0 ? outcome / scanned : 0
    const activityBoost = journey.is_active ? 12 : 0
    return clamp(Math.round(38 + utilization * 32 + conversion * 22 + activityBoost - failed * 1.5), 0, 100)
}

export default function JourneyCardWithStats({
    journey,
    onEdit,
    onDuplicate,
    onDelete
}: JourneyCardWithStatsProps) {
    const [stats, setStats] = useState<QRStats>({
        total_valid_links: 0,
        links_scanned: 0,
        claim_mode: 'single_shop',
        shop_links_scanned: 0,
        consumer_links_scanned: 0,
        lucky_draw_entries: 0,
        redemptions: 0,
        points_collected: 0,
        scratch_card_plays: 0,
        failed_scans: 0,
        last_scan_at: null,
    })
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [downloadingExcel, setDownloadingExcel] = useState(false)

    useEffect(() => {
        if (!journey.order_info?.order_id) return

        fetchStats()
        if (!journey.is_active) return

        const interval = setInterval(() => {
            fetchStats(true)
        }, 30000)

        return () => clearInterval(interval)
    }, [journey.is_active, journey.order_info?.order_id])

    const fetchStats = async (silent = false) => {
        if (!journey.order_info?.order_id) return

        try {
            if (!silent) setIsRefreshing(true)
            const response = await fetch(`/api/journey/qr-stats?order_id=${journey.order_info.order_id}`)
            const data = await response.json()

            if (data.success && data.data) {
                setStats(data.data)
            }
        } catch (error) {
            console.error('Error fetching QR stats:', error)
        } finally {
            setIsRefreshing(false)
        }
    }

    const handleDownloadExcel = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!journey.order_info?.order_id) return

        try {
            setDownloadingExcel(true)
            const response = await fetch(`/api/journey/download-qr-excel?order_id=${journey.order_info.order_id}`)

            if (!response.ok) {
                throw new Error('Failed to download Excel')
            }

            const blob = await response.blob()
            const url = window.URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = `Journey_QR_Codes_${journey.order_info.order_no}_${new Date().toISOString().slice(0, 10)}.xlsx`
            document.body.appendChild(anchor)
            anchor.click()
            window.URL.revokeObjectURL(url)
            document.body.removeChild(anchor)
        } catch (error) {
            console.error('Error downloading Excel:', error)
            alert('Failed to download Excel file')
        } finally {
            setDownloadingExcel(false)
        }
    }

    const featureBadges = getFeatureBadges(journey)
    const primaryFeature = featureBadges[0]
    const PrimaryIcon = primaryFeature.icon
    const generated = stats.total_valid_links || 0
    const scanned = stats.links_scanned || 0
    const failedScans = stats.failed_scans || 0
    const utilization = generated > 0 ? (scanned / generated) * 100 : 0
    const outcomeMetric = getOutcomeMetric(journey, stats)
    const healthScore = getHealthScore(journey, stats)
    const sparkline = buildSparkline(stats)
    const hasDownloadableQr = Boolean(journey.order_info?.order_id && generated > 0)

    return (
        <Card className="group overflow-hidden border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
            <CardContent className="flex h-full flex-col p-0">
                <div className="border-b border-slate-100 p-4 pb-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <Badge variant="outline" className={`h-7 rounded-full px-2.5 text-[11px] font-semibold ${primaryFeature.className}`}>
                            <PrimaryIcon className="mr-1.5 h-3.5 w-3.5" />
                            {primaryFeature.label}
                        </Badge>
                        {journey.activation_mode === 'auto' && journey.activation_status === 'pending_ship' ? (
                            <Badge variant="outline" className="h-7 rounded-full border-amber-200 bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-700">
                                <Clock className="mr-1.5 h-3.5 w-3.5" />Pending
                            </Badge>
                        ) : journey.is_active ? (
                            <Badge className="h-7 rounded-full bg-emerald-500 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-500">
                                <Truck className="mr-1.5 h-3.5 w-3.5" />Active
                            </Badge>
                        ) : (
                            <Badge variant="secondary" className="h-7 rounded-full bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-600">
                                Inactive
                            </Badge>
                        )}
                    </div>

                    <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold leading-tight text-slate-950">
                            {journey.order_info?.order_no ? (
                                <span>
                                    Journey for{' '}
                                    <Link
                                        href={`/dashboard?view=view-order&order_id=${journey.order_info.order_id}`}
                                        className="text-slate-950 underline-offset-2 hover:text-blue-700 hover:underline"
                                    >
                                        {journey.order_info.order_no}
                                    </Link>
                                </span>
                            ) : journey.name}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                            {journey.order_info?.legacy_order_no && journey.order_info.legacy_order_no !== journey.order_info.order_no ? (
                                <span>Legacy {journey.order_info.legacy_order_no}</span>
                            ) : journey.order_info?.order_no ? (
                                <span>Order {journey.order_info.order_no}</span>
                            ) : (
                                <span>Unlinked journey</span>
                            )}
                            {journey.is_default && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">Default</span>}
                        </div>
                    </div>
                </div>

                <div className="flex flex-1 flex-col gap-4 p-4">
                    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                        <UtilizationRing percent={utilization} color={primaryFeature.ringColor} />
                        <div className="grid grid-cols-2 gap-2">
                            <MetricCell label="Generated" value={generated} tone="text-slate-950" />
                            <MetricCell label="Scanned" value={scanned} tone="text-emerald-700" />
                            <MetricCell label={outcomeMetric.label} value={outcomeMetric.value} tone="text-blue-700" />
                            <MetricCell label="Failed" value={failedScans} tone="text-red-600" />
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
                            <span className="inline-flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Scan trend</span>
                            <span className="tabular-nums">{scanned.toLocaleString()} scans</span>
                        </div>
                        <MiniSparkline values={sparkline} color={primaryFeature.ringColor} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                        <div>
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
                                <Activity className="h-3.5 w-3.5" /> Health Score
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                                <span className="text-xl font-bold tabular-nums text-slate-950">{healthScore}</span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${healthScore}%` }} />
                                </div>
                            </div>
                        </div>
                        <div className="border-l border-slate-100 pl-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
                                <Scan className="h-3.5 w-3.5" /> Last Scan
                            </div>
                            <p className="mt-1 truncate text-sm font-semibold text-slate-800">{formatRelativeTime(stats.last_scan_at)}</p>
                        </div>
                    </div>
                </div>

                <div className="mt-auto flex items-center gap-2 border-t border-slate-100 bg-slate-50/80 p-3">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                            event.stopPropagation()
                            fetchStats()
                        }}
                        disabled={isRefreshing || !journey.order_info?.order_id}
                        className="h-8 flex-1 border-slate-200 bg-white px-2 text-xs"
                    >
                        <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                        Analytics
                    </Button>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" size="sm" className="h-8 flex-1 border-slate-200 bg-white px-2 text-xs">
                                <QrCode className="mr-1.5 h-3.5 w-3.5" />
                                QR Codes
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 p-1">
                            <DropdownMenuItem
                                onClick={(event) => {
                                    event.stopPropagation()
                                    fetchStats()
                                }}
                                className="flex items-center text-xs"
                            >
                                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                                Refresh QR stats
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                aria-disabled={!hasDownloadableQr || downloadingExcel}
                                onClick={(event) => {
                                    if (!hasDownloadableQr || downloadingExcel) return
                                    handleDownloadExcel(event as unknown as React.MouseEvent)
                                }}
                                className={`flex items-center text-xs ${!hasDownloadableQr || downloadingExcel ? 'pointer-events-none opacity-50' : ''}`}
                            >
                                {downloadingExcel ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                                Download QR Excel
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 text-slate-500 hover:bg-white">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 p-1">
                            <DropdownMenuItem onClick={onEdit} className="flex items-center text-xs">
                                <Edit className="mr-2 h-3.5 w-3.5" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onDuplicate} className="flex items-center text-xs">
                                <Copy className="mr-2 h-3.5 w-3.5" />Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onDelete} className="flex items-center text-xs text-red-600 hover:bg-red-50">
                                <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardContent>
        </Card>
    )
}
