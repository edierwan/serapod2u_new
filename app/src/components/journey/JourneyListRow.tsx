'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
    Loader2,
    Clock,
    Truck,
    MoreHorizontal
} from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
        legacy_order_no?: string  // Original order_no (e.g., ORD-HM-0126-19)
        order_type: string
        order_id: string
    }
}

interface QRStats {
    total_valid_links: number
    links_scanned: number
    lucky_draw_entries: number
    redemptions: number
    points_collected: number
    scratch_card_plays?: number
}

interface JourneyListRowProps {
    journey: JourneyConfig
    onEdit: () => void
    onDuplicate: () => void
    onDelete: () => void
}

export default function JourneyListRow({
    journey,
    onEdit,
    onDuplicate,
    onDelete
}: JourneyListRowProps) {
    const [stats, setStats] = useState<QRStats | null>(null)
    const [loadingStats, setLoadingStats] = useState(false)
    const [downloadingExcel, setDownloadingExcel] = useState(false)

    // Fetch stats when journey is active and has an order
    useEffect(() => {
        if (journey.is_active && journey.order_info?.order_id) {
            fetchStats()
        }
    }, [journey.is_active, journey.order_info?.order_id])

    const fetchStats = async () => {
        if (!journey.order_info?.order_id) return

        try {
            setLoadingStats(true)
            const response = await fetch(`/api/journey/qr-stats?order_id=${journey.order_info.order_id}`)
            const data = await response.json()

            if (data.success) {
                setStats(data.data)
            }
        } catch (error) {
            console.error('Error fetching QR stats:', error)
        } finally {
            setLoadingStats(false)
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

            // Create blob and download
            const blob = await response.blob()
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `Journey_QR_Codes_${journey.order_info.order_no}_${new Date().toISOString().slice(0, 10)}.xlsx`
            document.body.appendChild(a)
            a.click()
            window.URL.revokeObjectURL(url)
            document.body.removeChild(a)
        } catch (error) {
            console.error('Error downloading Excel:', error)
            alert('Failed to download Excel file')
        } finally {
            setDownloadingExcel(false)
        }
    }

    const getEnabledFeatures = () => {
        const features = []
        if (journey.points_enabled) features.push({ icon: Coins, label: 'Points', color: 'text-blue-600' })
        if (journey.lucky_draw_enabled) features.push({ icon: Star, label: 'Lucky Draw', color: 'text-purple-600' })
        if (journey.redemption_enabled) features.push({ icon: Gift, label: 'Redemption', color: 'text-green-600' })
        if (journey.enable_scratch_card_game) features.push({ icon: Gift, label: 'Scratch Card', color: 'text-pink-600' })
        return features
    }

    const features = getEnabledFeatures()

    return (
        <div className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors">
            {/* Journey Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    {/* Use display order_no (new format) in title when available */}
                    <h3 className="font-medium text-gray-900 truncate">
                        {journey.order_info?.order_no 
                            ? `Journey for ${journey.order_info.order_no}`
                            : journey.name}
                    </h3>
                    {/* Status Badge */}
                    {journey.activation_mode === 'auto' && journey.activation_status === 'pending_ship' ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-xs">
                            <Clock className="w-3 h-3 mr-1" />
                            Pending
                        </Badge>
                    ) : journey.is_active ? (
                        <Badge variant="default" className="bg-green-500 text-xs">
                            <Truck className="w-3 h-3 mr-1" />
                            Active
                        </Badge>
                    ) : (
                        <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">
                            Inactive
                        </Badge>
                    )}
                </div>
                {journey.order_info && (
                    <div>
                        <p className="text-sm text-gray-500 truncate">Order: {journey.order_info.order_no}</p>
                        {journey.order_info.legacy_order_no && journey.order_info.legacy_order_no !== journey.order_info.order_no && (
                            <p className="text-[10px] text-gray-400 truncate">Legacy: {journey.order_info.legacy_order_no}</p>
                        )}
                    </div>
                )}
            </div>

            {/* Features */}
            <div className="hidden md:flex items-center gap-1">
                {features.length > 0 ? (
                    features.map((feature, idx) => (
                        <div key={idx} className={`p-1.5 rounded-md bg-gray-100 ${feature.color}`} title={feature.label}>
                            <feature.icon className="w-3.5 h-3.5" />
                        </div>
                    ))
                ) : (
                    <span className="text-xs text-gray-400">No features</span>
                )}
            </div>

            {/* Stats (compact) */}
            {journey.is_active && journey.order_info && (
                <div className="hidden lg:flex items-center gap-4 text-sm">
                    {loadingStats ? (
                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    ) : stats ? (
                        <>
                            <div className="flex items-center gap-1 text-gray-600">
                                <QrCode className="w-4 h-4" />
                                <span>{stats.total_valid_links}</span>
                            </div>
                            <div className="flex items-center gap-1 text-green-600">
                                <Scan className="w-4 h-4" />
                                <span>{stats.links_scanned}</span>
                            </div>
                        </>
                    ) : null}
                </div>
            )}

            {/* Dates */}
            <div className="hidden xl:block text-xs text-gray-500 w-32">
                {journey.start_at && (
                    <p>Start: {new Date(journey.start_at).toLocaleDateString()}</p>
                )}
                {journey.end_at ? (
                    <p>End: {new Date(journey.end_at).toLocaleDateString()}</p>
                ) : (
                    <p>End: No end date</p>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
                {journey.is_active && journey.order_info && stats && stats.total_valid_links > 0 && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadExcel}
                        disabled={downloadingExcel}
                        className="hidden sm:flex h-8"
                    >
                        {downloadingExcel ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <>
                                <Download className="w-4 h-4 mr-1" />
                                Excel
                            </>
                        )}
                    </Button>
                )}

                <Button
                    variant="outline"
                    size="sm"
                    onClick={onEdit}
                    className="h-8"
                >
                    <Edit className="w-4 h-4" />
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8">
                            <MoreHorizontal className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={onEdit}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onDuplicate}>
                            <Copy className="w-4 h-4 mr-2" />
                            Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onDelete} className="text-red-600">
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}
