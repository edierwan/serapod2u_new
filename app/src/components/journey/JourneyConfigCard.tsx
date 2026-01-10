'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Edit, Copy, Trash2, CheckCircle2, Gift, Trophy, Coins, Download, QrCode, Scan, BarChart3, Loader2, RefreshCw } from 'lucide-react'

interface JourneyConfig {
  id: string
  name: string
  is_active: boolean
  is_default: boolean
  points_enabled: boolean
  lucky_draw_enabled: boolean
  redemption_enabled: boolean
  created_at: string
}

interface QRStats {
  total_valid_links: number
  links_scanned: number
  lucky_draw_entries: number
  redemptions: number
  points_collected: number
}

// Animated number component for smooth transitions
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

interface JourneyConfigCardProps {
  journey: JourneyConfig
  isSelected: boolean
  orderId: string | null
  onSelect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export default function JourneyConfigCard({
  journey,
  isSelected,
  orderId,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete
}: JourneyConfigCardProps) {
  const totalPages = 5 // This would come from actual pages data
  // Initialize with default stats so we never show loading state
  const [stats, setStats] = useState<QRStats>({
    total_valid_links: 0,
    links_scanned: 0,
    lucky_draw_entries: 0,
    redemptions: 0,
    points_collected: 0
  })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [downloadingExcel, setDownloadingExcel] = useState(false)

  // Fetch stats when journey is active and has an order
  useEffect(() => {
    if (journey.is_active && orderId) {
      fetchStats()
      
      // Auto-refresh stats every 30 seconds
      const interval = setInterval(() => {
        fetchStats(true) // Silent refresh
      }, 30000)
      
      return () => clearInterval(interval)
    }
  }, [journey.is_active, orderId])

  const fetchStats = async (silent = false) => {
    if (!orderId) return
    
    try {
      if (!silent) {
        setIsRefreshing(true)
      }
      const response = await fetch(`/api/journey/qr-stats?order_id=${orderId}`)
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
    if (!orderId) return

    try {
      setDownloadingExcel(true)
      const response = await fetch(`/api/journey/download-qr-excel?order_id=${orderId}`)
      
      if (!response.ok) {
        throw new Error('Failed to download Excel')
      }

      // Create blob and download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Journey_QR_Codes_${orderId.substring(0, 8)}.xlsx`
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
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        isSelected ? 'ring-2 ring-blue-600 shadow-md' : ''
      } ${journey.is_active ? '' : 'opacity-60'}`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900">{journey.name}</h3>
              {journey.is_default && (
                <Badge variant="outline" className="text-xs">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Default
                </Badge>
              )}
            </div>
            <p className="text-xs text-gray-500">{totalPages} pages</p>
          </div>
          <Badge className={journey.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
            {journey.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        {/* Feature Toggles */}
        <div className="flex gap-2 mb-3">
          {journey.points_enabled && (
            <div className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
              <Coins className="w-3 h-3" />
              <span>Points</span>
            </div>
          )}
          {journey.lucky_draw_enabled && (
            <div className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded">
              <Trophy className="w-3 h-3" />
              <span>Lucky Draw</span>
            </div>
          )}
          {journey.redemption_enabled && (
            <div className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
              <Gift className="w-3 h-3" />
              <span>Redeem</span>
            </div>
          )}
        </div>

        {/* QR Statistics - Only show for active journeys with order */}
        {journey.is_active && orderId && (
          <div className="mb-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-600" />
                <h4 className="text-xs font-semibold text-blue-900">QR Code Statistics</h4>
              </div>
              <button
                onClick={() => fetchStats()}
                disabled={isRefreshing}
                className="p-1 hover:bg-blue-100 rounded transition-colors"
                title="Refresh statistics"
              >
                <RefreshCw className={`w-3 h-3 text-blue-600 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
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
                    <Trophy className="w-3 h-3 text-gray-600" />
                    <p className="text-[10px] text-gray-600">Lucky Draw</p>
                  </div>
                  <AnimatedNumber value={stats.lucky_draw_entries} className="text-lg font-bold text-purple-900" />
                </div>
              )}
            </div>

            {/* Download Excel Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadExcel}
              disabled={downloadingExcel || stats.total_valid_links === 0}
              className="w-full mt-3 h-8 text-xs bg-white hover:bg-blue-50 border-blue-300"
            >
              {downloadingExcel ? (
                <>
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="w-3 h-3 mr-2" />
                  Download QR Excel ({stats?.total_valid_links || 0} codes)
                </>
              )}
            </Button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="flex-1 h-8"
          >
            <Edit className="w-3 h-3 mr-1" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            className="h-8"
          >
            <Copy className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
