'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import BotAdminSection from './BotAdminSection'
import ServicesStatusSection from './ServicesStatusSection'
import {
    Save,
    MessageCircle,
    Loader2,
    CheckCircle2,
    XCircle,
    Eye,
    EyeOff,
    TestTube,
    Wifi,
    WifiOff,
    QrCode,
    RefreshCw,
    LogOut,
    Smartphone,
    Send,
    Clock,
    AlertTriangle,
    Link2,
    Settings,
    Activity,
    Bot,
    Info
} from 'lucide-react'

// Provider options for WhatsApp
const WHATSAPP_PROVIDERS = [
    { value: 'twilio', label: 'Twilio', description: 'Twilio WhatsApp Business API' },
    { value: 'whatsapp_business', label: 'WhatsApp Business API', description: 'Meta WhatsApp Business API (Direct)' },
    { value: 'messagebird', label: 'MessageBird', description: 'MessageBird Programmable Conversations' },
    { value: 'baileys', label: 'Baileys (Self-hosted)', description: 'Self-hosted WhatsApp Gateway' }
]

interface ProviderConfig {
    id?: string
    org_id: string
    channel: 'whatsapp' | 'sms' | 'email'
    provider_name: string
    is_active: boolean
    is_sandbox: boolean
    config_public: Record<string, any>
    last_test_status?: string
    last_test_at?: string
    last_test_error?: string
}

interface WhatsAppSubTabsProps {
    userProfile: {
        id: string
        organization_id: string
        organizations: {
            id: string
            org_type_code: string
        }
        roles: {
            role_level: number
        }
    }
    whatsappConfig: ProviderConfig | null
    setWhatsappConfig: (config: ProviderConfig) => void
    sensitiveData: Record<string, string>
    setSensitiveData: (data: Record<string, string>) => void
    showSecrets: Record<string, boolean>
    setShowSecrets: (secrets: Record<string, boolean>) => void
    onSave: () => Promise<void>
    saving: boolean
}

export default function WhatsAppSubTabs({
    userProfile,
    whatsappConfig,
    setWhatsappConfig,
    sensitiveData,
    setSensitiveData,
    showSecrets,
    setShowSecrets,
    onSave,
    saving
}: WhatsAppSubTabsProps) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const supabase = createClient()

    // Get initial tab from URL or default to 'status'
    const urlTab = searchParams.get('whatsapp_tab')
    const [activeTab, setActiveTab] = useState(urlTab || 'status')

    // Global AI Auto Mode State
    const [globalAiEnabled, setGlobalAiEnabled] = useState(true)
    const [aiModeLoading, setAiModeLoading] = useState(false)

    // Gateway status state
    const [gatewayStatus, setGatewayStatus] = useState<{
        configured: boolean
        connected: boolean
        pairing_state: string
        phone_number: string | null
        push_name: string | null
        last_connected_at: string | null
        last_error: string | null
    } | null>(null)
    const [gatewayLoading, setGatewayLoading] = useState(false)
    const [qrCode, setQrCode] = useState<string | null>(null)
    const [qrExpiry, setQrExpiry] = useState<number>(0)
    const [gatewayAction, setGatewayAction] = useState<string | null>(null)
    const [isGatewayUnreachable, setIsGatewayUnreachable] = useState(false)

    // Testing state
    const [testNumber, setTestNumber] = useState('')
    const [testMessage, setTestMessage] = useState('')
    const [sendingTest, setSendingTest] = useState(false)
    const [lastTestResult, setLastTestResult] = useState<{
        success: boolean
        message: string
        timestamp: Date
    } | null>(null)

    // Saved test numbers state
    const [savedTestNumbers, setSavedTestNumbers] = useState<string[]>([])
    const [newTestNumber, setNewTestNumber] = useState('')
    const [savingTestNumbers, setSavingTestNumbers] = useState(false)

    // Smart polling state
    const statusPollRef = useRef<NodeJS.Timeout | null>(null)
    const lastStatusRef = useRef<{ data: any; at: number } | null>(null)
    const [pollInterval, setPollInterval] = useState(5000)

    // Update URL when tab changes
    const handleTabChange = (value: string) => {
        setActiveTab(value)
        const params = new URLSearchParams(searchParams.toString())
        params.set('whatsapp_tab', value)
        router.push(`?${params.toString()}`, { scroll: false })
    }

    // Fetch global AI mode status
    const fetchGlobalAiMode = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/whatsapp/ai-mode')
            const data = await res.json()
            if (data.ok) {
                setGlobalAiEnabled(data.mode === 'auto')
            }
        } catch (err: any) {
            console.error('Failed to fetch AI mode:', err)
        }
    }, [])

    // Toggle global AI mode
    const handleToggleGlobalAi = async (enabled: boolean) => {
        setAiModeLoading(true)
        try {
            const res = await fetch('/api/admin/whatsapp/ai-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: enabled ? 'auto' : 'takeover' })
            })
            const data = await res.json()
            if (data.ok) {
                setGlobalAiEnabled(enabled)
            }
        } catch (err: any) {
            console.error('Failed to toggle AI mode:', err)
        } finally {
            setAiModeLoading(false)
        }
    }

    // Load saved test numbers from config
    useEffect(() => {
        if (whatsappConfig?.config_public?.test_numbers) {
            setSavedTestNumbers(whatsappConfig.config_public.test_numbers)
        } else if (whatsappConfig?.config_public?.test_number) {
            // Migrate single test number to array
            setSavedTestNumbers([whatsappConfig.config_public.test_number])
        }
    }, [whatsappConfig?.config_public?.test_numbers, whatsappConfig?.config_public?.test_number])

    // Add new test number
    const handleAddTestNumber = () => {
        const number = newTestNumber.replace(/[^\d+]/g, '').trim()
        if (!number || number.length < 8) {
            alert('Please enter a valid phone number')
            return
        }
        if (savedTestNumbers.includes(number)) {
            alert('This number is already in the list')
            return
        }
        const updated = [...savedTestNumbers, number]
        setSavedTestNumbers(updated)
        setNewTestNumber('')
        // Auto-save to config
        saveTestNumbersToConfig(updated)
    }

    // Remove test number
    const handleRemoveTestNumber = (numberToRemove: string) => {
        const updated = savedTestNumbers.filter(n => n !== numberToRemove)
        setSavedTestNumbers(updated)
        saveTestNumbersToConfig(updated)
    }

    // Save test numbers to config - direct API call to ensure persistence
    const saveTestNumbersToConfig = async (numbers: string[]) => {
        if (!whatsappConfig) return
        setSavingTestNumbers(true)
        try {
            // Update local state
            const updatedConfig = {
                ...whatsappConfig,
                config_public: {
                    ...whatsappConfig.config_public,
                    test_numbers: numbers,
                    test_number: numbers[0] || '' // Keep primary for backward compatibility
                }
            }
            setWhatsappConfig(updatedConfig)

            // Direct database update to ensure persistence
            const { error } = await (supabase as any)
                .from('notification_provider_configs')
                .update({
                    config_public: updatedConfig.config_public,
                    updated_at: new Date().toISOString()
                })
                .eq('id', whatsappConfig.id)

            if (error) throw error

            console.log('Test numbers saved:', numbers)
        } catch (err: any) {
            console.error('Failed to save test numbers:', err)
            alert('Failed to save test numbers: ' + err.message)
        } finally {
            setSavingTestNumbers(false)
        }
    }

    // Helper to parse complex error objects from gateway
    const getFriendlyErrorMessage = (errorStr: string | null) => {
        if (!errorStr) return null
        try {
            if (errorStr.startsWith('{')) {
                const errObj = JSON.parse(errorStr)
                if (errObj.code === 440) return 'Connection dropped (temporary). Auto-reconnecting...'
                if (errObj.isLoggedOut) return 'Logged out. Please reconnect (scan QR).'
                if (errObj.code === 401) return 'Authentication failed. Check API Key.'
                if (errObj.reason) return errObj.reason
            }
            // Simple string errors from the new gateway format
            if (errorStr.includes('Connection closed')) return 'Connection dropped (temporary). Auto-reconnecting...'
            if (errorStr.toLowerCase().includes('logged out')) return 'Logged out. Please reconnect (scan QR).'
            if (errorStr.includes('401')) return 'Authentication failed. Check API Key.'
            return errorStr
        } catch (e) {
            return errorStr
        }
    }

    // Fetch gateway status
    const fetchGatewayStatus = useCallback(async () => {
        if (!userProfile) return
        if (!whatsappConfig?.provider_name || whatsappConfig.provider_name !== 'baileys') {
            return
        }

        if (!lastStatusRef.current) {
            setGatewayLoading(true)
        }

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 8000)

            const response = await fetch('/api/settings/whatsapp/status', {
                signal: controller.signal
            })
            clearTimeout(timeoutId)

            if (response.status === 401) {
                setGatewayStatus(prev =>
                    prev ? { ...prev, pairing_state: 'unknown', last_error: 'Session expired, please re-login' } : null
                )
                setIsGatewayUnreachable(true)
                return
            }

            if (response.status === 403) {
                // User doesn't have admin access to WhatsApp settings - silently handle
                setGatewayStatus(null)
                setIsGatewayUnreachable(false)
                return
            }

            const contentType = response.headers.get('content-type')
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Invalid response format')
            }

            if (response.ok) {
                const data = await response.json()
                lastStatusRef.current = { data, at: Date.now() }
                setGatewayStatus(data)
                setIsGatewayUnreachable(false)
                setPollInterval(5000)

                if (data.pairing_state === 'waiting_qr') {
                    await fetchQRCode()
                } else {
                    setQrCode(null)
                }

                if (data.phone_number && !testNumber) {
                    setTestNumber(whatsappConfig.config_public.test_number || '')
                }
            } else {
                throw new Error(`HTTP ${response.status}`)
            }
        } catch (error: any) {
            if (error?.name === 'AbortError') return

            console.error('Error fetching gateway status:', error)
            const cached = lastStatusRef.current
            const isStale = !cached || Date.now() - cached.at > 30000

            if (isStale) {
                setIsGatewayUnreachable(true)
                setGatewayStatus(null)
            } else {
                setIsGatewayUnreachable(true)
            }

            setPollInterval(prev => Math.min(prev * 1.5, 30000))
        } finally {
            setGatewayLoading(false)
        }
    }, [whatsappConfig?.provider_name, whatsappConfig?.config_public.test_number, testNumber, userProfile])

    // Fetch QR code (uses enriched gateway response with PNG base64)
    const fetchQRCode = async () => {
        try {
            const response = await fetch('/api/settings/whatsapp/qr')
            const data = await response.json()

            if (!response.ok) {
                console.error('QR fetch error:', data.error || response.statusText)
                setQrCode(null)
                return
            }

            // If connected, no QR needed
            if (data.connected) {
                setQrCode(null)
                return
            }

            if (data.qr_png_base64) {
                // Use pre-rendered PNG from gateway (preferred)
                setQrCode(data.qr_png_base64)
                setQrExpiry(data.expires_in_sec || 25)
            } else if (data.qr) {
                // Fallback: render raw QR string client-side
                try {
                    const QRCode = (await import('qrcode')).default
                    const dataUrl = await QRCode.toDataURL(data.qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        margin: 2,
                        width: 300
                    })
                    setQrCode(dataUrl)
                    setQrExpiry(data.expires_in_sec || 25)
                } catch (qrRenderErr) {
                    console.error('Failed to render QR client-side:', qrRenderErr)
                    setQrCode(null)
                }
            } else {
                setQrCode(null)
            }
        } catch (error) {
            console.error('Error fetching QR code:', error)
            setQrCode(null)
        }
    }

    // Change WhatsApp Number: logout → clear → start → poll for QR
    const handleGatewayReset = async () => {
        if (!confirm('This will disconnect the current WhatsApp number and require re-scanning the QR code. Continue?')) {
            return
        }

        try {
            setGatewayAction('reset')
            setQrCode(null)

            // Step 1: Logout (safe, prevents auto-reconnect)
            const logoutRes = await fetch('/api/settings/whatsapp/logout', { method: 'POST' })
            if (!logoutRes.ok) {
                const logoutData = await logoutRes.json()
                throw new Error(logoutData.error || 'Logout failed')
            }

            // Step 2: Clear auth state
            const clearRes = await fetch('/api/settings/whatsapp/clear', { method: 'POST' })
            if (!clearRes.ok) {
                const clearData = await clearRes.json()
                throw new Error(clearData.error || 'Clear session failed')
            }

            // Step 3: Start new session
            const startRes = await fetch('/api/settings/whatsapp/start', { method: 'POST' })
            if (!startRes.ok) {
                const startData = await startRes.json()
                throw new Error(startData.error || 'Start session failed')
            }

            // Update UI state to show QR panel
            setGatewayStatus(prev =>
                prev ? { ...prev, pairing_state: 'waiting_qr', connected: false, phone_number: null, push_name: null } : null
            )

            // Step 4: Poll for QR code (up to 15 seconds)
            let qrFound = false
            for (let i = 0; i < 15; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000))
                try {
                    const qrRes = await fetch('/api/settings/whatsapp/qr')
                    const qrData = await qrRes.json()

                    if (qrRes.ok && (qrData.qr_png_base64 || qrData.qr)) {
                        if (qrData.qr_png_base64) {
                            setQrCode(qrData.qr_png_base64)
                        } else if (qrData.qr) {
                            const QRCode = (await import('qrcode')).default
                            const dataUrl = await QRCode.toDataURL(qrData.qr, {
                                errorCorrectionLevel: 'M',
                                type: 'image/png',
                                margin: 2,
                                width: 300
                            })
                            setQrCode(dataUrl)
                        }
                        setQrExpiry(qrData.expires_in_sec || 25)
                        qrFound = true
                        break
                    }
                } catch {
                    // Continue polling
                }
            }

            if (!qrFound) {
                // Still show waiting_qr state - the normal polling will pick it up
                console.warn('QR not available yet after 15s polling, normal poll will continue')
            }

        } catch (error: any) {
            alert(`Error: ${error.message}`)
        } finally {
            setGatewayAction(null)
        }
    }

    const handleGatewayLogout = async () => {
        if (!confirm('This will disconnect from WhatsApp completely. You will need to scan QR again to reconnect. Continue?')) {
            return
        }

        try {
            setGatewayAction('logout')

            // Step 1: Logout
            const logoutRes = await fetch('/api/settings/whatsapp/logout', { method: 'POST' })
            if (!logoutRes.ok) {
                const logoutData = await logoutRes.json()
                throw new Error(logoutData.error || 'Logout failed')
            }

            // Step 2: Clear auth so next connect shows fresh QR
            const clearRes = await fetch('/api/settings/whatsapp/clear', { method: 'POST' })
            if (!clearRes.ok) {
                console.warn('Clear failed after logout, continuing anyway')
            }

            setGatewayStatus(prev => (prev ? {
                ...prev,
                connected: false,
                pairing_state: 'disconnected',
                phone_number: null,
                push_name: null,
            } : null))
            setQrCode(null)
        } catch (error: any) {
            alert(`Error: ${error.message}`)
        } finally {
            setGatewayAction(null)
        }
    }

    const handleGatewayReconnect = async () => {
        try {
            setGatewayAction('reconnect')

            // Use start endpoint to initiate fresh connection
            const response = await fetch('/api/settings/whatsapp/start', { method: 'POST' })
            const data = await response.json()

            if (response.ok) {
                // Wait a moment then refresh status
                await new Promise(resolve => setTimeout(resolve, 2000))
                await fetchGatewayStatus()
            } else {
                alert(`Failed to reconnect: ${data.error}`)
            }
        } catch (error: any) {
            alert(`Error: ${error.message}`)
        } finally {
            setGatewayAction(null)
        }
    }

    // Send test message
    const handleSendTestMessage = async () => {
        if (savedTestNumbers.length === 0) {
            alert('Please add at least one test recipient number')
            return
        }

        try {
            setSendingTest(true)

            // Send to all saved test numbers
            const results: { number: string; success: boolean; error?: string }[] = []

            for (const number of savedTestNumbers) {
                try {
                    const response = await fetch('/api/settings/whatsapp/test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            to: number,
                            message: testMessage || undefined
                        })
                    })
                    const data = await response.json()
                    results.push({
                        number,
                        success: data.success,
                        error: data.error
                    })
                } catch (err: any) {
                    results.push({ number, success: false, error: err.message })
                }
            }

            const successCount = results.filter(r => r.success).length
            const failedCount = results.filter(r => !r.success).length

            if (failedCount === 0) {
                setLastTestResult({
                    success: true,
                    message: `Message sent successfully to ${successCount} recipient${successCount > 1 ? 's' : ''}: ${savedTestNumbers.join(', ')}`,
                    timestamp: new Date()
                })
            } else if (successCount === 0) {
                setLastTestResult({
                    success: false,
                    message: `Failed to send to all ${failedCount} recipient${failedCount > 1 ? 's' : ''}. ${results[0]?.error || 'Unknown error'}`,
                    timestamp: new Date()
                })
            } else {
                setLastTestResult({
                    success: true,
                    message: `Sent to ${successCount}/${savedTestNumbers.length} recipients. ${failedCount} failed.`,
                    timestamp: new Date()
                })
            }
        } catch (error: any) {
            setLastTestResult({
                success: false,
                message: error.message,
                timestamp: new Date()
            })
        } finally {
            setSendingTest(false)
        }
    }

    // Fetch AI mode on mount
    useEffect(() => {
        fetchGlobalAiMode()
    }, [fetchGlobalAiMode])

    // Start/stop polling for gateway status
    useEffect(() => {
        if (whatsappConfig?.provider_name === 'baileys') {
            fetchGatewayStatus()

            if (whatsappConfig.config_public.test_number) {
                setTestNumber(whatsappConfig.config_public.test_number)
            }

            statusPollRef.current = setInterval(() => {
                fetchGatewayStatus()
            }, pollInterval)

            return () => {
                if (statusPollRef.current) {
                    clearInterval(statusPollRef.current)
                }
            }
        }
    }, [whatsappConfig?.provider_name, whatsappConfig?.config_public.base_url, fetchGatewayStatus, pollInterval])

    // Auto-refresh QR code when it expires
    useEffect(() => {
        if (gatewayStatus?.pairing_state === 'waiting_qr' && qrExpiry > 0) {
            const timer = setTimeout(() => {
                fetchQRCode()
            }, qrExpiry * 1000)

            return () => clearTimeout(timer)
        }
    }, [gatewayStatus?.pairing_state, qrExpiry])

    // Check if any service is down for warning badge
    const hasServiceWarning =
        gatewayStatus && (!gatewayStatus.connected || isGatewayUnreachable)

    // ========================================
    // TAB 1: STATUS (Read-only health view)
    // ========================================
    const renderStatusTab = () => (
        <div className="space-y-6">
            {/* WhatsApp Account Connection */}
            <Card
                className={`border-2 ${gatewayStatus?.connected
                    ? 'bg-green-50 border-green-300'
                    : gatewayStatus?.pairing_state === 'waiting_qr'
                        ? 'bg-yellow-50 border-yellow-300'
                        : 'bg-gray-50 border-gray-200'
                    }`}
            >
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {gatewayStatus?.connected ? (
                                <Wifi className="w-5 h-5 text-green-600" />
                            ) : (
                                <WifiOff className="w-5 h-5 text-gray-500" />
                            )}
                            <span>WhatsApp Account Connection</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {gatewayLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
                            <Badge
                                variant={gatewayStatus?.connected ? 'default' : 'secondary'}
                                className={
                                    gatewayStatus?.connected
                                        ? 'bg-green-600'
                                        : gatewayStatus?.pairing_state === 'waiting_qr'
                                            ? 'bg-yellow-600'
                                            : isGatewayUnreachable
                                                ? 'bg-gray-500'
                                                : ''
                                }
                            >
                                {isGatewayUnreachable
                                    ? 'Unreachable'
                                    : gatewayStatus?.pairing_state === 'connected'
                                        ? 'Connected'
                                        : gatewayStatus?.pairing_state === 'waiting_qr'
                                            ? 'Waiting for QR Scan'
                                            : gatewayStatus?.pairing_state === 'connecting'
                                                ? 'Connecting...'
                                                : gatewayStatus?.pairing_state === 'reconnecting'
                                                    ? 'Reconnecting...'
                                                    : gatewayStatus?.pairing_state === 'not_configured'
                                                        ? 'Not Configured'
                                                        : 'Disconnected'}
                            </Badge>
                        </div>
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500 mt-1">
                        Shows the currently authenticated WhatsApp account.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Connected State Info */}
                    {gatewayStatus?.connected && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-white/80 rounded-lg">
                            <div className="flex items-center gap-3">
                                <Smartphone className="w-8 h-8 text-green-600" />
                                <div>
                                    <p className="text-sm text-gray-500">Connected Number</p>
                                    <p className="font-semibold text-lg">+{gatewayStatus.phone_number}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                                    <span className="text-green-700 font-bold text-sm">
                                        {gatewayStatus.push_name?.[0]?.toUpperCase() || gatewayStatus.phone_number?.[0] || 'W'}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">WhatsApp Name</p>
                                    <p className="font-semibold">{gatewayStatus.push_name || (gatewayStatus.phone_number ? `+${gatewayStatus.phone_number}` : 'Not set')}</p>
                                </div>
                            </div>
                            {gatewayStatus.last_connected_at && (
                                <div className="md:col-span-2 flex items-center gap-2 text-sm text-gray-600">
                                    <Clock className="w-4 h-4" />
                                    Connected since: {new Date(gatewayStatus.last_connected_at).toLocaleString()}
                                </div>
                            )}
                        </div>
                    )}

                    {/* QR Code Pairing Panel */}
                    {gatewayStatus?.pairing_state === 'waiting_qr' && !isGatewayUnreachable && (
                        <div className="p-6 bg-white rounded-lg border-2 border-dashed border-yellow-400">
                            <div className="text-center space-y-4">
                                <QrCode className="w-12 h-12 mx-auto text-yellow-600" />
                                <h3 className="font-semibold text-lg">Scan QR Code to Connect WhatsApp</h3>

                                {qrCode ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="p-4 bg-white rounded-lg shadow-lg border">
                                            <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64 mx-auto" />
                                        </div>
                                        <p className="text-sm text-gray-500">
                                            QR code refreshes automatically in {qrExpiry} seconds
                                        </p>
                                    </div>
                                ) : (
                                    <div className="py-8">
                                        <Loader2 className="w-8 h-8 mx-auto animate-spin text-yellow-600" />
                                        <p className="mt-2 text-sm text-gray-500">Loading QR code...</p>
                                    </div>
                                )}

                                <div className="bg-blue-50 rounded-lg p-4 text-left">
                                    <p className="font-medium text-blue-900 mb-2">How to scan:</p>
                                    <ol className="list-decimal list-inside text-sm text-blue-800 space-y-1">
                                        <li>Open WhatsApp on your phone</li>
                                        <li>
                                            Tap <strong>Menu</strong> or <strong>Settings</strong>
                                        </li>
                                        <li>
                                            Select <strong>Linked Devices</strong>
                                        </li>
                                        <li>
                                            Tap <strong>Link a Device</strong>
                                        </li>
                                        <li>Point your phone at this QR code</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error Display */}
                    {(gatewayStatus?.last_error || isGatewayUnreachable) && !gatewayStatus?.connected && (
                        <div
                            className={`flex items-start gap-3 p-4 rounded-lg border ${isGatewayUnreachable ? 'bg-orange-50 border-orange-200' : 'bg-red-100 border-red-200'
                                }`}
                        >
                            <AlertTriangle
                                className={`w-5 h-5 mt-0.5 ${isGatewayUnreachable ? 'text-orange-600' : 'text-red-600'}`}
                            />
                            <div>
                                <p className={`font-medium ${isGatewayUnreachable ? 'text-orange-900' : 'text-red-900'}`}>
                                    {isGatewayUnreachable ? 'Connection Warning' : 'Connection Error'}
                                </p>
                                <p className={`text-sm ${isGatewayUnreachable ? 'text-orange-700' : 'text-red-700'}`}>
                                    {isGatewayUnreachable
                                        ? 'Gateway is currently unreachable. Retrying automatically...'
                                        : getFriendlyErrorMessage(gatewayStatus?.last_error || '')}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Control Buttons */}
                    <div className="flex flex-wrap gap-3 pt-2">
                        {gatewayStatus?.connected ? (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={handleGatewayReset}
                                    disabled={!!gatewayAction}
                                    className="border-yellow-500 text-yellow-700 hover:bg-yellow-50"
                                >
                                    {gatewayAction === 'reset' ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                    )}
                                    Change WhatsApp Number
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={handleGatewayLogout}
                                    disabled={!!gatewayAction}
                                    className="border-red-500 text-red-700 hover:bg-red-50"
                                >
                                    {gatewayAction === 'logout' ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <LogOut className="w-4 h-4 mr-2" />
                                    )}
                                    Logout
                                </Button>
                            </>
                        ) : (
                            <>
                                {gatewayStatus?.pairing_state !== 'waiting_qr' && (
                                    <Button
                                        onClick={handleGatewayReset}
                                        disabled={!!gatewayAction}
                                        className="bg-green-600 hover:bg-green-700"
                                    >
                                        {gatewayAction === 'reset' ? (
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        ) : (
                                            <QrCode className="w-4 h-4 mr-2" />
                                        )}
                                        Connect WhatsApp
                                    </Button>
                                )}
                                <Button variant="outline" onClick={handleGatewayReconnect} disabled={!!gatewayAction}>
                                    {gatewayAction === 'reconnect' ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                    )}
                                    Retry Connection
                                </Button>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Services Status */}
            <ServicesStatusSection />
        </div>
    )

    // ========================================
    // TAB 2: CONFIGURATION (Settings)
    // ========================================
    const renderConfigurationTab = () => (
        <div className="space-y-6">
            {/* AI Auto-Reply Control - PROMINENT */}
            <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${globalAiEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                                {globalAiEnabled ? (
                                    <Bot className="w-6 h-6 text-green-600" />
                                ) : (
                                    <Bot className="w-6 h-6 text-gray-500" />
                                )}
                            </div>
                            <div>
                                <CardTitle className="text-lg">AI Auto-Reply</CardTitle>
                                <CardDescription>
                                    {globalAiEnabled
                                        ? 'AI bot is actively responding to customer messages'
                                        : 'AI is disabled. Human agents handle all conversations.'}
                                </CardDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Badge
                                variant="outline"
                                className={`text-sm px-3 py-1 ${globalAiEnabled
                                    ? 'bg-green-100 text-green-700 border-green-300'
                                    : 'bg-gray-100 text-gray-600 border-gray-300'}`}
                            >
                                {globalAiEnabled ? 'AUTO' : 'MANUAL'}
                            </Badge>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="global-ai-toggle-config"
                                    checked={globalAiEnabled}
                                    onCheckedChange={handleToggleGlobalAi}
                                    disabled={aiModeLoading}
                                    className="data-[state=checked]:bg-green-600"
                                />
                                <Label
                                    htmlFor="global-ai-toggle-config"
                                    className={`text-sm font-medium cursor-pointer ${globalAiEnabled ? 'text-green-700' : 'text-gray-500'}`}
                                >
                                    {aiModeLoading ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : globalAiEnabled ? (
                                        'ON'
                                    ) : (
                                        'OFF'
                                    )}
                                </Label>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className={`p-3 rounded-lg text-sm ${globalAiEnabled ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                        {globalAiEnabled ? (
                            <p className="text-green-700 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4" />
                                <span><strong>AI is ON</strong> — The bot will automatically reply to WhatsApp messages. AI controls visible in Support Inbox.</span>
                            </p>
                        ) : (
                            <p className="text-amber-700 flex items-center gap-2">
                                <Info className="w-4 h-4" />
                                <span><strong>AI is OFF</strong> — All AI features hidden in Support Inbox. Human agents handle conversations manually.</span>
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MessageCircle className="w-5 h-5 text-green-600" />
                        WhatsApp Configuration
                    </CardTitle>
                    <CardDescription>
                        Configure your WhatsApp Business API provider for sending notifications
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Provider Selection */}
                    <div className="space-y-2">
                        <Label htmlFor="whatsapp-provider">WhatsApp Provider</Label>
                        <Select
                            value={whatsappConfig?.provider_name || ''}
                            onValueChange={value =>
                                setWhatsappConfig({
                                    ...whatsappConfig!,
                                    org_id: userProfile.organizations.id,
                                    channel: 'whatsapp',
                                    provider_name: value,
                                    is_active: whatsappConfig?.is_active || false,
                                    is_sandbox: whatsappConfig?.is_sandbox !== false,
                                    config_public: whatsappConfig?.config_public || {}
                                })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select WhatsApp provider" />
                            </SelectTrigger>
                            <SelectContent>
                                {WHATSAPP_PROVIDERS.map(provider => (
                                    <SelectItem key={provider.value} value={provider.value}>
                                        <div>
                                            <div className="font-medium">{provider.label}</div>
                                            <div className="text-xs text-gray-500">{provider.description}</div>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {whatsappConfig?.provider_name && (
                        <>
                            {/* Enable/Sandbox Switches */}
                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={whatsappConfig.is_active}
                                        onCheckedChange={checked =>
                                            setWhatsappConfig({
                                                ...whatsappConfig,
                                                is_active: checked
                                            })
                                        }
                                    />
                                    <Label>Enable WhatsApp notifications</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={whatsappConfig.is_sandbox}
                                        onCheckedChange={checked =>
                                            setWhatsappConfig({
                                                ...whatsappConfig,
                                                is_sandbox: checked
                                            })
                                        }
                                    />
                                    <Label>Use Sandbox Mode</Label>
                                    <Badge variant="secondary" className="text-xs">
                                        Test
                                    </Badge>
                                </div>
                            </div>

                            {/* Inbox Controls - New Setting */}
                            <div className="flex items-center gap-2 pt-2 border-t border-gray-100 pb-2">
                                <Switch
                                    id="inbox_whatsapp_reply"
                                    checked={whatsappConfig.config_public?.inbox_reply_via_whatsapp ?? false}
                                    onCheckedChange={checked =>
                                        setWhatsappConfig({
                                            ...whatsappConfig,
                                            config_public: {
                                                ...whatsappConfig.config_public,
                                                inbox_reply_via_whatsapp: checked
                                            }
                                        })
                                    }
                                />
                                <div>
                                    <Label htmlFor="inbox_whatsapp_reply" className="cursor-pointer font-medium">Enable WhatsApp Reply in Support Inbox</Label>
                                    <p className="text-xs text-gray-500">Allow agents to switch between WhatsApp and App Chat when replying.</p>
                                </div>
                            </div>

                            {/* Baileys-specific fields */}
                            {whatsappConfig.provider_name === 'baileys' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg border">
                                    <div className="space-y-2 md:col-span-2">
                                        <Label className="flex items-center gap-2">
                                            <Link2 className="w-4 h-4" />
                                            Gateway Base URL
                                        </Label>
                                        <Input
                                            placeholder="https://wa.serapod2u.com"
                                            value={whatsappConfig.config_public.base_url || ''}
                                            onChange={e =>
                                                setWhatsappConfig({
                                                    ...whatsappConfig,
                                                    config_public: {
                                                        ...whatsappConfig.config_public,
                                                        base_url: e.target.value
                                                    }
                                                })
                                            }
                                        />
                                        <p className="text-xs text-gray-500">
                                            The secure URL of your gateway. Example: <strong>https://wa.serapod2u.com</strong>.
                                            <br />
                                            <span className="text-amber-600">
                                                Note: Port 3001 is closed. Do not include :3001 in the URL.
                                            </span>
                                        </p>
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>API Key</Label>
                                        <div className="relative">
                                            <Input
                                                type={showSecrets['baileys_api_key'] ? 'text' : 'password'}
                                                placeholder="Your Baileys API Key"
                                                value={sensitiveData.api_key || ''}
                                                onChange={e =>
                                                    setSensitiveData({
                                                        ...sensitiveData,
                                                        api_key: e.target.value
                                                    })
                                                }
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="absolute right-0 top-0"
                                                onClick={() =>
                                                    setShowSecrets({
                                                        ...showSecrets,
                                                        baileys_api_key: !showSecrets['baileys_api_key']
                                                    })
                                                }
                                            >
                                                {showSecrets['baileys_api_key'] ? (
                                                    <EyeOff className="w-4 h-4" />
                                                ) : (
                                                    <Eye className="w-4 h-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>Test Recipient Number</Label>
                                        <Input
                                            placeholder="60192277233"
                                            value={whatsappConfig.config_public.test_number || ''}
                                            onChange={e =>
                                                setWhatsappConfig({
                                                    ...whatsappConfig,
                                                    config_public: {
                                                        ...whatsappConfig.config_public,
                                                        test_number: e.target.value
                                                    }
                                                })
                                            }
                                        />
                                        <p className="text-xs text-gray-500">Default number to receive test messages</p>
                                    </div>
                                </div>
                            )}

                            {/* Twilio-specific fields */}
                            {whatsappConfig.provider_name === 'twilio' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg border">
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>Account SID</Label>
                                        <div className="relative">
                                            <Input
                                                type={showSecrets['whatsapp_sid'] ? 'text' : 'password'}
                                                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                                value={sensitiveData.account_sid || ''}
                                                onChange={e =>
                                                    setSensitiveData({
                                                        ...sensitiveData,
                                                        account_sid: e.target.value
                                                    })
                                                }
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="absolute right-0 top-0"
                                                onClick={() =>
                                                    setShowSecrets({
                                                        ...showSecrets,
                                                        whatsapp_sid: !showSecrets['whatsapp_sid']
                                                    })
                                                }
                                            >
                                                {showSecrets['whatsapp_sid'] ? (
                                                    <EyeOff className="w-4 h-4" />
                                                ) : (
                                                    <Eye className="w-4 h-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>Auth Token</Label>
                                        <div className="relative">
                                            <Input
                                                type={showSecrets['whatsapp_token'] ? 'text' : 'password'}
                                                placeholder="Your Twilio Auth Token"
                                                value={sensitiveData.auth_token || ''}
                                                onChange={e =>
                                                    setSensitiveData({
                                                        ...sensitiveData,
                                                        auth_token: e.target.value
                                                    })
                                                }
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="absolute right-0 top-0"
                                                onClick={() =>
                                                    setShowSecrets({
                                                        ...showSecrets,
                                                        whatsapp_token: !showSecrets['whatsapp_token']
                                                    })
                                                }
                                            >
                                                {showSecrets['whatsapp_token'] ? (
                                                    <EyeOff className="w-4 h-4" />
                                                ) : (
                                                    <Eye className="w-4 h-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>WhatsApp From Number</Label>
                                        <Input
                                            placeholder="whatsapp:+14155238886"
                                            value={whatsappConfig.config_public.from_number || ''}
                                            onChange={e =>
                                                setWhatsappConfig({
                                                    ...whatsappConfig,
                                                    config_public: {
                                                        ...whatsappConfig.config_public,
                                                        from_number: e.target.value
                                                    }
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Messaging Service SID (Optional)</Label>
                                        <Input
                                            placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                            value={whatsappConfig.config_public.messaging_service_sid || ''}
                                            onChange={e =>
                                                setWhatsappConfig({
                                                    ...whatsappConfig,
                                                    config_public: {
                                                        ...whatsappConfig.config_public,
                                                        messaging_service_sid: e.target.value
                                                    }
                                                })
                                            }
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Save Button */}
                            <div className="flex justify-end">
                                <Button onClick={onSave} disabled={saving}>
                                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                                    Save Configuration
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )

    // ========================================
    // TAB 3: TESTING
    // ========================================
    const renderTestingTab = () => (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Send className="w-5 h-5 text-green-600" />
                        WhatsApp Test Message
                    </CardTitle>
                    <CardDescription>
                        Send test messages to verify your WhatsApp connection. Messages will be sent to all recipients in the list below.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {!gatewayStatus?.connected && whatsappConfig?.provider_name === 'baileys' ? (
                        <div className="text-center py-8 text-gray-500">
                            <WifiOff className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p className="font-medium">WhatsApp not connected</p>
                            <p className="text-sm">Please connect your WhatsApp account in the Status tab first.</p>
                            <Button variant="outline" className="mt-4" onClick={() => handleTabChange('status')}>
                                Go to Status
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* Test Recipients Section */}
                            <div className="space-y-4 p-4 bg-gray-50 rounded-lg border">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Smartphone className="w-5 h-5 text-blue-600" />
                                        <Label className="text-sm font-semibold">Test Recipients</Label>
                                    </div>
                                    <Badge variant="outline" className="text-xs">
                                        {savedTestNumbers.length} number{savedTestNumbers.length !== 1 ? 's' : ''}
                                    </Badge>
                                </div>

                                {/* Add new number */}
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="Enter phone number with country code (e.g., 60192277233)"
                                        value={newTestNumber}
                                        onChange={e => setNewTestNumber(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddTestNumber()}
                                        className="flex-1 bg-white"
                                    />
                                    <Button
                                        onClick={handleAddTestNumber}
                                        disabled={savingTestNumbers || !newTestNumber.trim()}
                                        size="sm"
                                    >
                                        {savingTestNumbers ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
                                    </Button>
                                </div>

                                {/* Saved numbers list */}
                                {savedTestNumbers.length > 0 ? (
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        {savedTestNumbers.map((number) => (
                                            <Badge
                                                key={number}
                                                variant="secondary"
                                                className="px-3 py-2 text-sm flex items-center gap-2 bg-white text-gray-700 border border-gray-200 shadow-sm"
                                            >
                                                <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                                                <span className="font-mono">{number}</span>
                                                <button
                                                    onClick={() => handleRemoveTestNumber(number)}
                                                    className="ml-1 text-gray-400 hover:text-red-600 transition-colors"
                                                    title="Remove number"
                                                >
                                                    <XCircle className="w-4 h-4" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-4 text-gray-400">
                                        <p className="text-sm">No test numbers added yet</p>
                                        <p className="text-xs">Add phone numbers above to receive test messages</p>
                                    </div>
                                )}
                            </div>

                            {/* Message Input */}
                            <div className="space-y-2">
                                <Label>Message (Optional)</Label>
                                <Input
                                    placeholder="Leave empty for default test message"
                                    value={testMessage}
                                    onChange={e => setTestMessage(e.target.value)}
                                />
                                <p className="text-xs text-gray-500">
                                    Default message: "This is a test message from Serapod2U WhatsApp Gateway"
                                </p>
                            </div>

                            {/* Send Button */}
                            <Button
                                onClick={handleSendTestMessage}
                                disabled={sendingTest || savedTestNumbers.length === 0}
                                className="w-full bg-green-600 hover:bg-green-700 h-12 text-base"
                            >
                                {sendingTest ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        Sending to {savedTestNumbers.length} recipient{savedTestNumbers.length > 1 ? 's' : ''}...
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-5 h-5 mr-2" />
                                        Send Test Message to {savedTestNumbers.length} Recipient{savedTestNumbers.length !== 1 ? 's' : ''}
                                    </>
                                )}
                            </Button>

                            {savedTestNumbers.length === 0 && (
                                <p className="text-center text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
                                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                                    Add at least one test recipient number above to send test messages
                                </p>
                            )}

                            {/* Last Test Result */}
                            {lastTestResult && (
                                <div
                                    className={`p-4 rounded-lg border ${lastTestResult.success
                                        ? 'bg-green-50 border-green-200'
                                        : 'bg-red-50 border-red-200'
                                        }`}
                                >
                                    <div className="flex items-start gap-2">
                                        {lastTestResult.success ? (
                                            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                                        ) : (
                                            <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                                        )}
                                        <div className="flex-1">
                                            <div className="font-medium">
                                                {lastTestResult.success ? 'Test Successful' : 'Test Failed'}
                                            </div>
                                            <div className="text-sm text-gray-600">{lastTestResult.message}</div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {lastTestResult.timestamp.toLocaleString()}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Previous Test Status from Config */}
                            {whatsappConfig?.last_test_at && !lastTestResult && (
                                <div
                                    className={`p-4 rounded-lg border ${whatsappConfig.last_test_status === 'success'
                                        ? 'bg-green-50 border-green-200'
                                        : 'bg-red-50 border-red-200'
                                        }`}
                                >
                                    <div className="flex items-start gap-2">
                                        {whatsappConfig.last_test_status === 'success' ? (
                                            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                                        ) : (
                                            <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                                        )}
                                        <div className="flex-1">
                                            <div className="font-medium">
                                                Last Test: {whatsappConfig.last_test_status === 'success' ? 'Successful' : 'Failed'}
                                            </div>
                                            <div className="text-sm text-gray-600">
                                                {new Date(whatsappConfig.last_test_at).toLocaleString()}
                                            </div>
                                            {whatsappConfig.last_test_error && (
                                                <div className="text-sm text-red-600 mt-1">{whatsappConfig.last_test_error}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )

    // ========================================
    // TAB 4: BOT CONTROL
    // ========================================
    const renderBotControlTab = () => <BotAdminSection />

    // Only show Baileys-specific tabs when using Baileys provider
    const isBaileys = whatsappConfig?.provider_name === 'baileys'

    return (
        <div className="space-y-6">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                <TabsList className={`grid w-full ${isBaileys ? 'grid-cols-4' : 'grid-cols-1'}`}>
                    {isBaileys && (
                        <TabsTrigger value="status" className="flex items-center gap-2">
                            <Activity className="w-4 h-4" />
                            Status
                            {hasServiceWarning && (
                                <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center">
                                    !
                                </Badge>
                            )}
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="configuration" className="flex items-center gap-2">
                        <Settings className="w-4 h-4" />
                        Configuration
                    </TabsTrigger>
                    {isBaileys && (
                        <>
                            <TabsTrigger value="testing" className="flex items-center gap-2">
                                <TestTube className="w-4 h-4" />
                                Testing
                            </TabsTrigger>
                            <TabsTrigger value="bot-control" className="flex items-center gap-2">
                                <Bot className="w-4 h-4" />
                                Bot Control
                            </TabsTrigger>
                        </>
                    )}
                </TabsList>

                {isBaileys && <TabsContent value="status">{renderStatusTab()}</TabsContent>}

                <TabsContent value="configuration">{renderConfigurationTab()}</TabsContent>

                {isBaileys && (
                    <>
                        <TabsContent value="testing">{renderTestingTab()}</TabsContent>
                        <TabsContent value="bot-control">{renderBotControlTab()}</TabsContent>
                    </>
                )}
            </Tabs>
        </div>
    )
}
