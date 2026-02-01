'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Wifi,
    Bot,
    Loader2,
    RefreshCw,
    CheckCircle2,
    XCircle,
    Clock
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface ServiceHealth {
    up: boolean
    latencyMs: number
    error?: string
}

interface StatusData {
    whatsappGateway: ServiceHealth
    moltbot: ServiceHealth
    checkedAt: string
}

export default function ServicesStatusSection() {
    const [status, setStatus] = useState<StatusData | null>(null)
    const [loading, setLoading] = useState(true)
    const [lastChecked, setLastChecked] = useState<Date | null>(null)

    const fetchStatus = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/settings/notifications/providers/status')
            if (res.ok) {
                const data = await res.json()
                setStatus(data)
                setLastChecked(new Date(data.checkedAt))
            }
        } catch (err) {
            console.error('Failed to fetch services status:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchStatus()
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchStatus, 30000)
        return () => clearInterval(interval)
    }, [fetchStatus])

    const formatLatency = (ms: number) => {
        if (ms < 1000) return `${ms}ms`
        return `${(ms / 1000).toFixed(1)}s`
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-gray-600" />
                        Services Status
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        {lastChecked && (
                            <span className="text-xs text-gray-500">
                                {formatDistanceToNow(lastChecked, { addSuffix: true })}
                            </span>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={fetchStatus}
                            disabled={loading}
                            className="h-8 w-8 p-0"
                        >
                            {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <RefreshCw className="w-4 h-4" />
                            )}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* WhatsApp Gateway Card */}
                    <div className={`flex items-center justify-between p-4 rounded-lg border-2 transition-colors ${loading
                            ? 'bg-gray-50 border-gray-200'
                            : status?.whatsappGateway.up
                                ? 'bg-green-50 border-green-200'
                                : 'bg-red-50 border-red-200'
                        }`}>
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${loading
                                    ? 'bg-gray-200'
                                    : status?.whatsappGateway.up
                                        ? 'bg-green-100'
                                        : 'bg-red-100'
                                }`}>
                                <Wifi className={`w-5 h-5 ${loading
                                        ? 'text-gray-500'
                                        : status?.whatsappGateway.up
                                            ? 'text-green-600'
                                            : 'text-red-600'
                                    }`} />
                            </div>
                            <div>
                                <p className="font-medium text-sm">WhatsApp Gateway</p>
                                {status && !loading && (
                                    <p className="text-xs text-gray-500">
                                        {status.whatsappGateway.up
                                            ? `${formatLatency(status.whatsappGateway.latencyMs)} latency`
                                            : status.whatsappGateway.error === 'timeout'
                                                ? 'Request timed out'
                                                : 'Connection failed'}
                                    </p>
                                )}
                            </div>
                        </div>
                        <Badge
                            variant={loading ? 'secondary' : status?.whatsappGateway.up ? 'default' : 'destructive'}
                            className={
                                loading
                                    ? ''
                                    : status?.whatsappGateway.up
                                        ? 'bg-green-600 hover:bg-green-600'
                                        : ''
                            }
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    Checking
                                </>
                            ) : status?.whatsappGateway.up ? (
                                'Up'
                            ) : (
                                'Down'
                            )}
                        </Badge>
                    </div>

                    {/* AI Bot (Moltbot) Card */}
                    <div className={`flex items-center justify-between p-4 rounded-lg border-2 transition-colors ${loading
                            ? 'bg-gray-50 border-gray-200'
                            : status?.moltbot.up
                                ? 'bg-blue-50 border-blue-200'
                                : 'bg-red-50 border-red-200'
                        }`}>
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${loading
                                    ? 'bg-gray-200'
                                    : status?.moltbot.up
                                        ? 'bg-blue-100'
                                        : 'bg-red-100'
                                }`}>
                                <Bot className={`w-5 h-5 ${loading
                                        ? 'text-gray-500'
                                        : status?.moltbot.up
                                            ? 'text-blue-600'
                                            : 'text-red-600'
                                    }`} />
                            </div>
                            <div>
                                <p className="font-medium text-sm">AI Bot (Moltbot)</p>
                                {status && !loading && (
                                    <p className="text-xs text-gray-500">
                                        {status.moltbot.up
                                            ? `${formatLatency(status.moltbot.latencyMs)} latency`
                                            : status.moltbot.error === 'timeout'
                                                ? 'Request timed out'
                                                : 'Connection failed'}
                                    </p>
                                )}
                            </div>
                        </div>
                        <Badge
                            variant={loading ? 'secondary' : status?.moltbot.up ? 'default' : 'destructive'}
                            className={
                                loading
                                    ? ''
                                    : status?.moltbot.up
                                        ? 'bg-blue-600 hover:bg-blue-600'
                                        : ''
                            }
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    Checking
                                </>
                            ) : status?.moltbot.up ? (
                                'Up'
                            ) : (
                                'Down'
                            )}
                        </Badge>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
