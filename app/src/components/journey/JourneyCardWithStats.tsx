'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    BarChart3,
    Loader2,
    Clock,
    Truck,
    RefreshCw
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

// Animated number component for smooth transitions
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
    const [displayValue, setDisplayValue] = useState(value)
    const [isAnimating, setIsAnimating] = useState(false)
    const prevValueRef = useRef(value)

    useEffect(() => {
        if (prevValueRef.current !== value) {
            setIsAnimating(true)
            // Quick animation
            const duration = 300
            const startValue = prevValueRef.current
            const endValue = value
            const startTime = Date.now()

            const animate = () => {
                const elapsed = Date.now() - startTime
                const progress = Math.min(elapsed / duration, 1)
                // Ease out
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

interface JourneyCardWithStatsProps {
    journey: JourneyConfig
    onEdit: () => void
    onDuplicate: () => void
    onDelete: () => void
}

export default function JourneyCardWithStats({
    journey,
    onEdit,
    onDuplicate,
    onDelete
}: JourneyCardWithStatsProps) {
    // Initialize with default stats so we never show loading state
    const [stats, setStats] = useState<QRStats>({
        total_valid_links: 0,
        links_scanned: 0,
        lucky_draw_entries: 0,
        redemptions: 0,
        points_collected: 0,
        scratch_card_plays: 0
    })
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [downloadingExcel, setDownloadingExcel] = useState(false)
    const hasInitialLoadRef = useRef(false)

    // Fetch stats when journey is active and has an order
    useEffect(() => {
        if (journey.is_active && journey.order_info?.order_id) {
            fetchStats()
            
            // Auto-refresh stats every 30 seconds
            const interval = setInterval(() => {
                fetchStats(true) // Silent refresh
            }, 30000)
            
            return () => clearInterval(interval)
        }
    }, [journey.is_active, journey.order_info?.order_id])

    const fetchStats = async (silent = false) => {
        if (!journey.order_info?.order_id) return
        
        try {
            if (!silent) {
                setIsRefreshing(true)
            }
            const response = await fetch(`/api/journey/qr-stats?order_id=${journey.order_info.order_id}`)
            const data = await response.json()
            
            if (data.success && data.data) {
                setStats(data.data)
                hasInitialLoadRef.current = true
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

    return (
        <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <CardTitle className="text-lg">{journey.name}</CardTitle>
                        {journey.order_info && (
                            <CardDescription className="mt-1">
                                Order: {journey.order_info.order_no}
                            </CardDescription>
                        )}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                        {/* Show activation status */}
                        {journey.activation_mode === 'auto' && journey.activation_status === 'pending_ship' ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                                <Clock className="w-3 h-3 mr-1" />
                                Pending Shipment
                            </Badge>
                        ) : journey.is_active ? (
                            <Badge variant="default" className="bg-green-500">
                                <Truck className="w-3 h-3 mr-1" />
                                Active
                            </Badge>
                        ) : (
                            <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                                Inactive
                            </Badge>
                        )}
                        {journey.is_default && (
                            <Badge variant="secondary">Default</Badge>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Features */}
                <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">Features:</p>
                    <div className="flex flex-wrap gap-2">
                        {journey.points_enabled && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                <Coins className="w-3 h-3 mr-1" />
                                Points
                            </Badge>
                        )}
                        {journey.lucky_draw_enabled && (
                            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                <Star className="w-3 h-3 mr-1" />
                                Lucky Draw
                            </Badge>
                        )}
                        {journey.redemption_enabled && (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                <Gift className="w-3 h-3 mr-1" />
                                Redemption
                            </Badge>
                        )}
                        {journey.enable_scratch_card_game && (
                            <Badge variant="outline" className="bg-pink-50 text-pink-700 border-pink-200">
                                <Gift className="w-3 h-3 mr-1" />
                                Scratch Card
                            </Badge>
                        )}
                        {!journey.points_enabled && !journey.lucky_draw_enabled && !journey.redemption_enabled && !journey.enable_scratch_card_game && (
                            <span className="text-sm text-gray-500">No features enabled</span>
                        )}
                    </div>
                </div>

                {/* QR Statistics - Only show for active journeys with order */}
                {journey.is_active && journey.order_info && (
                    <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                        <div className="flex items-center gap-2 mb-2">
                            <BarChart3 className="w-4 h-4 text-blue-600" />
                            <h4 className="text-xs font-semibold text-blue-900">QR Code Statistics</h4>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-white rounded p-2 border border-blue-100">
                                <div className="flex items-center gap-1 mb-1">
                                    <QrCode className="w-3 h-3 text-gray-600" />
                                    <p className="text-[10px] text-gray-600">Valid Links</p>
                                </div>
                                <AnimatedNumber value={stats.total_valid_links} className="text-lg font-bold text-blue-900" />
                            </div>
                            
                            <div className="bg-white rounded p-2 border border-green-100">
                                <div className="flex items-center gap-1 mb-1">
                                    <Scan className="w-3 h-3 text-gray-600" />
                                    <p className="text-[10px] text-gray-600">Scanned</p>
                                </div>
                                <AnimatedNumber value={stats.links_scanned} className="text-lg font-bold text-green-900" />
                            </div>
                            
                            {journey.redemption_enabled && (
                                <div className="bg-white rounded p-2 border border-emerald-100">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Gift className="w-3 h-3 text-gray-600" />
                                        <p className="text-[10px] text-gray-600">Redemptions</p>
                                    </div>
                                    <AnimatedNumber value={stats.redemptions} className="text-lg font-bold text-emerald-900" />
                                </div>
                            )}
                            
                            {journey.lucky_draw_enabled && (
                                <div className="bg-white rounded p-2 border border-purple-100">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Star className="w-3 h-3 text-gray-600" />
                                        <p className="text-[10px] text-gray-600">Lucky Draw</p>
                                    </div>
                                    <AnimatedNumber value={stats.lucky_draw_entries} className="text-lg font-bold text-purple-900" />
                                </div>
                            )}

                            {journey.enable_scratch_card_game && (
                                <div className="bg-white rounded p-2 border border-pink-100">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Gift className="w-3 h-3 text-gray-600" />
                                        <p className="text-[10px] text-gray-600">Scratch Card</p>
                                    </div>
                                    <AnimatedNumber value={stats.scratch_card_plays || 0} className="text-lg font-bold text-pink-900" />
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2 mt-3">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    fetchStats()
                                }}
                                disabled={isRefreshing}
                                className="h-8 text-xs bg-white hover:bg-blue-50 border-blue-300"
                            >
                                <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDownloadExcel}
                                disabled={downloadingExcel || stats.total_valid_links === 0}
                                className="flex-1 h-8 text-xs bg-white hover:bg-blue-50 border-blue-300"
                            >
                                {downloadingExcel ? (
                                    <>
                                        <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                                        Downloading...
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-3 h-3 mr-2" />
                                        Download QR Excel ({stats.total_valid_links} codes)
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Dates */}
                {(journey.start_at || journey.end_at) && (
                    <div className="text-sm text-gray-600">
                        {journey.start_at && (
                            <p>Starts: {new Date(journey.start_at).toLocaleDateString()}</p>
                        )}
                        {journey.end_at && (
                            <p>Ends: {new Date(journey.end_at).toLocaleDateString()}</p>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onEdit}
                        className="flex-1"
                    >
                        <Edit className="w-4 h-4 mr-1" />
                        Edit
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onDuplicate}
                    >
                        <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onDelete}
                        className="text-red-600 hover:bg-red-50"
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
