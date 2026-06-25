'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getWhatsAppProviderReadiness } from '@/lib/notifications/whatsapp-provider-readiness'
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
import { formatPhoneDisplay } from '@/utils/phone'
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
    { value: 'baileys', label: 'Baileys (Self-hosted) - Hostinger', description: 'Self-hosted WhatsApp Gateway (Hostinger VPS)' },
    { value: 'baileys_home', label: 'Baileys (Self-hosted) - Home', description: 'Self-hosted WhatsApp Gateway (Home VPS)' }
]

const PROVIDER_TO_URL: Record<string, string> = {
    whatsapp_business: 'meta',
    baileys: 'baileys-hostinger',
    baileys_home: 'baileys-home',
    twilio: 'twilio',
    messagebird: 'messagebird'
}

const VALID_TABS = new Set(['status', 'configuration', 'testing', 'bot-control'])

const normalizeQrImage = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null
    const payload = value.trim()
    if (payload.startsWith('data:image/')) return payload
    if (payload.startsWith('iVBOR')) return `data:image/png;base64,${payload}`
    if (payload.startsWith('/9j/')) return `data:image/jpeg;base64,${payload}`
    if (payload.startsWith('UklGR')) return `data:image/webp;base64,${payload}`
    return null
}

const resolveQrDataUrl = async (preRendered: unknown, rawPayload: unknown): Promise<string | null> => {
    const image = normalizeQrImage(preRendered) || normalizeQrImage(rawPayload)
    if (image) return image
    if (typeof rawPayload !== 'string' || !rawPayload.trim()) return null

    const rawQr = rawPayload.trim()
    if (rawQr.length > 4096) {
        throw new Error('Gateway returned an unsupported oversized QR payload')
    }

    const QRCode = (await import('qrcode')).default
    return QRCode.toDataURL(rawQr, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        margin: 2,
        width: 300
    })
}

/** Check if a provider name is a Baileys variant */
const isBaileysProvider = (name: string | undefined | null): boolean =>
    name === 'baileys' || name === 'baileys_home'

interface ProviderConfig {
    id?: string
    org_id: string
    channel: 'whatsapp' | 'sms' | 'email'
    provider_name: string
    is_active: boolean
    is_default?: boolean
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
    onSave: (configOverride?: ProviderConfig) => Promise<void>
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

    /** Build API URL with provider query param */
    const waApi = (path: string) => {
        const p = whatsappConfig?.provider_name
        return p ? `${path}?provider=${encodeURIComponent(p)}` : path
    }

    const readJsonResponse = async (response: Response, fallbackLabel: string) => {
        const contentType = response.headers.get('content-type') || ''
        if (!contentType.toLowerCase().includes('application/json')) {
            const text = await response.text().catch(() => '')
            const preview = text.trim().replace(/\s+/g, ' ').slice(0, 120)
            throw new Error(`${fallbackLabel} returned HTTP ${response.status} ${response.statusText || ''} with ${contentType || 'unknown content type'}${preview ? `: ${preview}` : ''}`)
        }
        return response.json()
    }

    const urlTab = searchParams.get('tab') || searchParams.get('whatsapp_tab')
    const urlProvider = searchParams.get('provider')
    const [activeTab, setActiveTab] = useState(VALID_TABS.has(urlTab || '') ? urlTab! : 'configuration')

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
    const [metaAction, setMetaAction] = useState<'connection' | 'test-message' | null>(null)
    const [metaConnection, setMetaConnection] = useState<{
        success: boolean
        message: string
        phoneNumber?: string
    } | null>(null)
    const [metaTestRecipient, setMetaTestRecipient] = useState('')
    // Delivery state for the most recent Meta test message. Status advances as the
    // Meta status webhook arrives (accepted → sent → delivered → read / failed); we
    // never show "delivered" off the back of a 200 alone.
    const [metaTestResult, setMetaTestResult] = useState<{
        recipient: string
        wamid: string
        status: string
        accepted_at: string | null
        sent_at?: string | null
        delivered_at?: string | null
        read_at?: string | null
        failed_at?: string | null
        error?: { code: number | null; message: string | null } | null
    } | null>(null)
    const [metaStatusRefreshing, setMetaStatusRefreshing] = useState(false)

    // Saved test numbers state
    const [savedTestNumbers, setSavedTestNumbers] = useState<string[]>([])
    const [newTestNumber, setNewTestNumber] = useState('')
    const [savingTestNumbers, setSavingTestNumbers] = useState(false)

    // Smart polling state
    const statusPollRef = useRef<NodeJS.Timeout | null>(null)
    const lastStatusRef = useRef<{ data: any; at: number } | null>(null)
    const providerLoadRef = useRef(0)
    const [pollInterval, setPollInterval] = useState(5000)

    // Update URL when tab changes
    const handleTabChange = (value: string) => {
        setActiveTab(value)
        const params = new URLSearchParams(searchParams.toString())
        params.set('channel', 'whatsapp')
        params.set('tab', value)
        params.delete('whatsapp_tab')
        router.push(`?${params.toString()}`, { scroll: false })
    }

    const handleProviderChange = async (providerName: string) => {
        if (providerName === whatsappConfig?.provider_name) return
        const requestId = ++providerLoadRef.current

        const defaultTab = isBaileysProvider(providerName) ? 'status' : 'configuration'
        const params = new URLSearchParams(searchParams.toString())
        params.set('channel', 'whatsapp')
        params.set('provider', PROVIDER_TO_URL[providerName] || providerName)
        params.set('tab', defaultTab)
        params.delete('whatsapp_tab')
        window.localStorage.setItem('notification-provider-channel', 'whatsapp')
        window.localStorage.setItem('notification-provider-whatsapp', providerName)
        setActiveTab(defaultTab)
        router.push(`?${params.toString()}`, { scroll: false })

        const fallbackProvider: ProviderConfig = {
            org_id: userProfile.organizations.id,
            channel: 'whatsapp',
            provider_name: providerName,
            is_active: false,
            is_sandbox: true,
            config_public: {}
        }
        setSensitiveData({})
        setMetaConnection(null)
        setWhatsappConfig(fallbackProvider)

        const { data: savedProvider } = await (supabase as any)
            .from('notification_provider_configs')
            .select('*')
            .eq('org_id', userProfile.organizations.id)
            .eq('channel', 'whatsapp')
            .eq('provider_name', providerName)
            .maybeSingle()

        if (requestId !== providerLoadRef.current) return

        let savedSensitiveData: Record<string, string> = {}
        if (savedProvider?.config_encrypted) {
            try {
                savedSensitiveData = typeof savedProvider.config_encrypted === 'string'
                    ? JSON.parse(savedProvider.config_encrypted)
                    : savedProvider.config_encrypted
            } catch (error) {
                console.error('Failed to parse saved WhatsApp credentials', error)
            }
        }

        setSensitiveData(savedSensitiveData)
        setWhatsappConfig(savedProvider ? {
            id: savedProvider.id,
            org_id: savedProvider.org_id,
            channel: 'whatsapp',
            provider_name: savedProvider.provider_name,
            is_active: savedProvider.is_active,
            is_default: savedProvider.is_default,
            is_sandbox: savedProvider.is_sandbox,
            config_public: savedProvider.config_public || {},
            last_test_status: savedProvider.last_test_status,
            last_test_at: savedProvider.last_test_at,
            last_test_error: savedProvider.last_test_error
        } : fallbackProvider)
    }

    useEffect(() => {
        if (whatsappConfig?.provider_name === 'whatsapp_business') {
            setActiveTab('configuration')
            setQrCode(null)
            setGatewayStatus(null)
            if (urlProvider !== 'meta' || urlTab !== 'configuration') {
                const params = new URLSearchParams(searchParams.toString())
                params.set('channel', 'whatsapp')
                params.set('provider', 'meta')
                params.set('tab', 'configuration')
                params.delete('whatsapp_tab')
                router.replace(`?${params.toString()}`, { scroll: false })
            }
        } else if (whatsappConfig?.provider_name && !isBaileysProvider(whatsappConfig.provider_name)) {
            setActiveTab('configuration')
            const expectedProvider = PROVIDER_TO_URL[whatsappConfig.provider_name] || whatsappConfig.provider_name
            if (urlProvider !== expectedProvider || urlTab !== 'configuration') {
                const params = new URLSearchParams(searchParams.toString())
                params.set('channel', 'whatsapp')
                params.set('provider', expectedProvider)
                params.set('tab', 'configuration')
                params.delete('whatsapp_tab')
                router.replace(`?${params.toString()}`, { scroll: false })
            }
        } else if (isBaileysProvider(whatsappConfig?.provider_name)) {
            const urlMatchesProvider = urlProvider === PROVIDER_TO_URL[whatsappConfig!.provider_name]
            const nextTab = urlMatchesProvider && VALID_TABS.has(urlTab || '') ? urlTab! : 'status'
            setActiveTab(nextTab)
            if (!urlMatchesProvider || !VALID_TABS.has(urlTab || '')) {
                const params = new URLSearchParams(searchParams.toString())
                params.set('channel', 'whatsapp')
                params.set('provider', PROVIDER_TO_URL[whatsappConfig!.provider_name])
                params.set('tab', nextTab)
                params.delete('whatsapp_tab')
                router.replace(`?${params.toString()}`, { scroll: false })
            }
        }
    }, [whatsappConfig?.provider_name, urlProvider, urlTab, router, searchParams])

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
            if (errorStr.toLowerCase().includes('qr') && (errorStr.toLowerCase().includes('expired') || errorStr.toLowerCase().includes('refs'))) {
                return 'QR code expired. Click "Connect WhatsApp" or "Retry Connection" to generate a new QR code.'
            }
            if (errorStr.includes('restartRequired') || errorStr.includes('515')) {
                return 'QR code expired. Click "Connect WhatsApp" or "Retry Connection" to generate a new QR code.'
            }
            return errorStr
        } catch (e) {
            return errorStr
        }
    }

    // Fetch gateway status
    const fetchGatewayStatus = useCallback(async () => {
        if (!userProfile) return
        if (!whatsappConfig?.provider_name || !isBaileysProvider(whatsappConfig.provider_name)) {
            return
        }

        if (!lastStatusRef.current) {
            setGatewayLoading(true)
        }

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 8000)

            const response = await fetch(waApi('/api/settings/whatsapp/status'), {
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
            const response = await fetch(waApi('/api/settings/whatsapp/qr'))
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

            const dataUrl = await resolveQrDataUrl(data.qr_png_base64, data.qr)
            setQrCode(dataUrl)
            if (dataUrl) setQrExpiry(data.expires_in_sec || 25)
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
            try {
                const logoutRes = await fetch(waApi('/api/settings/whatsapp/logout'), { method: 'POST' })
                if (!logoutRes.ok) {
                    const logoutData = await logoutRes.json()
                    console.warn('Logout warning:', logoutData.error || 'Logout returned non-OK')
                    // Continue anyway - socket may already be disconnected
                }
            } catch (logoutErr: any) {
                console.warn('Logout error (continuing):', logoutErr.message)
            }

            // Wait for logout to fully propagate on the gateway
            await new Promise(resolve => setTimeout(resolve, 2000))

            // Step 2: Clear auth state
            try {
                const clearRes = await fetch(waApi('/api/settings/whatsapp/clear'), { method: 'POST' })
                if (!clearRes.ok) {
                    const clearData = await clearRes.json()
                    console.warn('Clear warning:', clearData.error || 'Clear returned non-OK')
                }
            } catch (clearErr: any) {
                console.warn('Clear error (continuing):', clearErr.message)
            }

            // Wait for clear to finish on the gateway
            await new Promise(resolve => setTimeout(resolve, 1000))

            // Step 3: Start new session
            const startRes = await fetch(waApi('/api/settings/whatsapp/start'), { method: 'POST' })
            if (!startRes.ok) {
                const startData = await startRes.json()
                throw new Error(startData.error || 'Start session failed')
            }

            // Update UI state to show QR panel
            setGatewayStatus(prev =>
                prev ? { ...prev, pairing_state: 'waiting_qr', connected: false, phone_number: null, push_name: null, last_error: null } : null
            )

            // Step 4: Poll for QR code (up to 20 seconds with longer intervals)
            let qrFound = false
            for (let i = 0; i < 20; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000))
                try {
                    const qrRes = await fetch(waApi('/api/settings/whatsapp/qr'))
                    const qrData = await qrRes.json()

                    if (qrRes.ok && (qrData.qr_png_base64 || qrData.qr)) {
                        const dataUrl = await resolveQrDataUrl(qrData.qr_png_base64, qrData.qr)
                        if (!dataUrl) continue
                        setQrCode(dataUrl)
                        setQrExpiry(qrData.expires_in_sec || 25)
                        qrFound = true
                        break
                    }

                    // If status shows connected already (unlikely but possible), break
                    if (qrData.connected) {
                        qrFound = true
                        break
                    }
                } catch {
                    // Continue polling
                }
            }

            if (!qrFound) {
                // Still show waiting_qr state - the normal polling will pick it up
                console.warn('QR not available yet after 20s polling, normal poll will continue')
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
            try {
                const logoutRes = await fetch(waApi('/api/settings/whatsapp/logout'), { method: 'POST' })
                if (!logoutRes.ok) {
                    const logoutData = await logoutRes.json()
                    console.warn('Logout warning:', logoutData.error)
                }
            } catch (logoutErr: any) {
                console.warn('Logout error (continuing):', logoutErr.message)
            }

            // Wait for logout to propagate
            await new Promise(resolve => setTimeout(resolve, 1500))

            // Step 2: Clear auth so next connect shows fresh QR
            try {
                const clearRes = await fetch(waApi('/api/settings/whatsapp/clear'), { method: 'POST' })
                if (!clearRes.ok) {
                    console.warn('Clear failed after logout, continuing anyway')
                }
            } catch {
                console.warn('Clear error after logout, continuing anyway')
            }

            setGatewayStatus(prev => (prev ? {
                ...prev,
                connected: false,
                pairing_state: 'disconnected',
                phone_number: null,
                push_name: null,
                last_error: null,
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

            // Clear error state in UI immediately for better UX
            setGatewayStatus(prev =>
                prev ? { ...prev, last_error: null, pairing_state: 'connecting' as any } : null
            )
            setQrCode(null)

            // Use start endpoint to initiate fresh connection
            const response = await fetch(waApi('/api/settings/whatsapp/start'), { method: 'POST' })
            const data = await response.json()

            if (response.ok) {
                // Wait for QR generation then refresh status
                await new Promise(resolve => setTimeout(resolve, 3000))
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
        if (whatsappConfig && isBaileysProvider(whatsappConfig.provider_name)) {
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

    const updateMetaPublicConfig = (key: string, value: string | boolean) => {
        if (!whatsappConfig) return
        setWhatsappConfig({
            ...whatsappConfig,
            config_public: { ...whatsappConfig.config_public, [key]: value }
        })
    }

    const handleMetaAction = async (action: 'connection' | 'test-message') => {
        if (!whatsappConfig) return
        if (action === 'test-message' && !metaTestRecipient.trim()) {
            alert('Enter a recipient phone number with country code.')
            return
        }

        try {
            setMetaAction(action)
            const credentials = whatsappConfig.id ? undefined : {
                access_token: sensitiveData.access_token || '',
                app_secret: sensitiveData.app_secret || '',
                webhook_verify_token: sensitiveData.webhook_verify_token || ''
            }
            const response = await fetch('/api/settings/notifications/providers/whatsapp/meta/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    to: action === 'test-message' ? metaTestRecipient.trim() : undefined,
                    provider_name: whatsappConfig.provider_name,
                    config: whatsappConfig.config_public,
                    credentials
                })
            })
            const result = await readJsonResponse(response, 'WhatsApp provider test')
            if (!response.ok) {
                // Surface safe diagnostics (Meta error code, masked Phone Number ID, hint)
                // so credential/config mismatches are obvious without exposing secrets.
                const metaCode = result?.meta_error?.code ? `(#${result.meta_error.code}) ` : ''
                const detail = [
                    `${metaCode}${result.error || 'Meta Cloud API request failed'}`,
                    result?.hint,
                    result?.diagnostic
                        ? `Phone Number ID ${result.diagnostic.phone_number_id_masked} · config: ${result.diagnostic.credential_source}${
                              result.diagnostic.normalized_recipient ? ` · recipient: ${result.diagnostic.normalized_recipient}` : ''
                          }`
                        : undefined
                ].filter(Boolean).join('\n')
                throw new Error(detail)
            }

            // For a test message, report only what Meta actually confirmed: it was
            // ACCEPTED (a WAMID was issued), not necessarily delivered. Show recipient,
            // WAMID and timestamp; never claim "delivered" without a delivery webhook.
            const successMessage = action === 'connection'
                ? 'Meta Cloud API connection verified.'
                : [
                    'Message accepted by Meta (not yet confirmed delivered).',
                    `Recipient: ${result.recipient_display || result.recipient || ''}`,
                    `WAMID: ${result.message_id || 'n/a'}`,
                    `Accepted at: ${result.accepted_at ? new Date(result.accepted_at).toLocaleString() : new Date().toLocaleString()}`,
                    result.delivery_note || ''
                ].filter(Boolean).join('\n')

            setMetaConnection({
                success: true,
                message: successMessage,
                phoneNumber: result.phone_number
            })
            // Track the delivery state so the UI can show accepted → delivered/read/failed
            // as status webhooks arrive (polled via the status endpoint).
            if (action === 'test-message' && result.message_id) {
                setMetaTestResult({
                    recipient: result.recipient_display || result.recipient || '',
                    wamid: result.message_id,
                    status: result.delivery_status || 'accepted',
                    accepted_at: result.accepted_at || new Date().toISOString(),
                })
            }
            // Reflect the verified state in the saved config so the status survives reloads.
            setWhatsappConfig({ ...whatsappConfig, last_test_status: 'success', last_test_error: undefined })
            alert(successMessage)
        } catch (error: any) {
            setMetaConnection({ success: false, message: error.message })
            alert(`WhatsApp test failed: ${error.message}`)
        } finally {
            setMetaAction(null)
        }
    }

    // Poll the delivery-log for the latest webhook-confirmed status of the last test
    // message. On localhost the Meta webhook cannot reach us, so this stays "accepted"
    // until verified on a public (staging) URL — that is expected.
    const refreshMetaDeliveryStatus = async () => {
        if (!metaTestResult?.wamid) return
        try {
            setMetaStatusRefreshing(true)
            const response = await fetch(`/api/settings/notifications/providers/whatsapp/meta/status?wamid=${encodeURIComponent(metaTestResult.wamid)}`)
            const data = await response.json()
            if (response.ok && data.found) {
                setMetaTestResult(prev => prev && prev.wamid === data.wamid ? {
                    ...prev,
                    status: data.status || prev.status,
                    accepted_at: data.accepted_at ?? prev.accepted_at,
                    sent_at: data.sent_at,
                    delivered_at: data.delivered_at,
                    read_at: data.read_at,
                    failed_at: data.failed_at,
                    error: data.error,
                } : prev)
            }
        } catch (error) {
            console.error('Failed to refresh delivery status', error)
        } finally {
            setMetaStatusRefreshing(false)
        }
    }

    const renderMetaSecretInput = (
        label: string,
        key: 'access_token' | 'app_secret' | 'webhook_verify_token',
        placeholder: string
    ) => {
        const visibilityKey = `meta_${key}`
        return (
            <div className="space-y-1.5">
                <Label>{label}</Label>
                <div className="relative">
                    <Input
                        type={showSecrets[visibilityKey] ? 'text' : 'password'}
                        value={sensitiveData[key] || ''}
                        placeholder={placeholder}
                        autoComplete="new-password"
                        onChange={event => setSensitiveData({ ...sensitiveData, [key]: event.target.value })}
                        className="pr-10"
                    />
                    <button
                        type="button"
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                        aria-label={`Toggle ${label} visibility`}
                        onClick={() => setShowSecrets({ ...showSecrets, [visibilityKey]: !showSecrets[visibilityKey] })}
                    >
                        {showSecrets[visibilityKey] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </div>
        )
    }

    const renderMetaConfigurationTab = () => {
        if (!whatsappConfig) return null

        const publicConfig = whatsappConfig.config_public
        const hasAccessToken = Boolean(sensitiveData.access_token)
        const hasPhoneNumber = Boolean(publicConfig.phone_number_id && publicConfig.display_phone_number)
        const hasWebhook = Boolean(publicConfig.webhook_callback_url && sensitiveData.webhook_verify_token)

        return (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-5">
                    <Card className="overflow-hidden border-slate-200 shadow-sm">
                        <CardHeader className="border-b border-slate-100 bg-white">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <MessageCircle className="h-5 w-5 text-emerald-600" />
                                WhatsApp Business API Configuration
                            </CardTitle>
                            <CardDescription>Connect your WhatsApp Business Account through the official Meta Cloud API.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label>Display Phone Number</Label>
                                        <Input value={publicConfig.display_phone_number || ''} placeholder="e.g. +60 12 345 6789" onChange={event => updateMetaPublicConfig('display_phone_number', event.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Phone Number ID</Label>
                                        <Input value={publicConfig.phone_number_id || ''} placeholder="e.g. 123456789012345" onChange={event => updateMetaPublicConfig('phone_number_id', event.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>WhatsApp Business Account ID (WABA ID)</Label>
                                        <Input value={publicConfig.waba_id || ''} placeholder="e.g. 123456789012345" onChange={event => updateMetaPublicConfig('waba_id', event.target.value)} />
                                    </div>
                                    {renderMetaSecretInput('Permanent Access Token', 'access_token', 'Meta system-user access token')}
                                    {renderMetaSecretInput('App Secret', 'app_secret', 'Meta app secret')}
                                    {renderMetaSecretInput('Webhook Verify Token', 'webhook_verify_token', 'A private token you choose')}
                                    <div className="space-y-1.5">
                                        <Label>Webhook Callback URL</Label>
                                        <Input value={publicConfig.webhook_callback_url || ''} placeholder="https://your-domain.com/api/webhooks/whatsapp/meta" onChange={event => updateMetaPublicConfig('webhook_callback_url', event.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Default Template Language</Label>
                                        <Select value={publicConfig.default_template_language || 'en_US'} onValueChange={value => updateMetaPublicConfig('default_template_language', value)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="en_US">English (en_US)</SelectItem>
                                                <SelectItem value="en_GB">English (en_GB)</SelectItem>
                                                <SelectItem value="ms">Bahasa Melayu (ms)</SelectItem>
                                                <SelectItem value="zh_CN">Chinese Simplified (zh_CN)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5 md:col-span-2">
                                        <Label>Default OTP / Authentication Template</Label>
                                        <Input value={publicConfig.default_otp_template || ''} placeholder="otp_authentication" onChange={event => updateMetaPublicConfig('default_otp_template', event.target.value)} />
                                        <p className="text-xs text-slate-500">Use the exact approved template name from WhatsApp Manager.</p>
                                    </div>
                                    <div className="space-y-1.5 md:col-span-2">
                                        <Label>Test Template Name</Label>
                                        <Input value={publicConfig.test_template_name || ''} placeholder="hello_world" onChange={event => updateMetaPublicConfig('test_template_name', event.target.value)} />
                                        <p className="text-xs text-slate-500">An approved, parameter-free template used by "Send Test WhatsApp". The pre-approved <code>hello_world</code> template works for most WABAs. Sent in the Default Template Language above.</p>
                                    </div>
                            </div>

                            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-3">
                                <div className="flex items-start gap-3">
                                    <Switch checked={whatsappConfig.is_active} onCheckedChange={checked => setWhatsappConfig({ ...whatsappConfig, is_active: checked })} />
                                    <div><Label>Enable WhatsApp notifications</Label><p className="text-xs text-slate-500">Allow notification delivery through Meta.</p></div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <Switch checked={whatsappConfig.is_sandbox} onCheckedChange={checked => setWhatsappConfig({ ...whatsappConfig, is_sandbox: checked })} />
                                    <div><Label>Enable sandbox / test mode</Label><p className="text-xs text-slate-500">Restrict sending while testing.</p></div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <Switch checked={publicConfig.inbox_reply_via_whatsapp ?? false} onCheckedChange={checked => updateMetaPublicConfig('inbox_reply_via_whatsapp', checked)} />
                                    <div><Label>Enable WhatsApp reply in support inbox</Label><p className="text-xs text-slate-500">Allow agents to reply via WhatsApp.</p></div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <Button type="button" variant="outline" className="border-violet-300 text-violet-700" onClick={() => handleMetaAction('connection')} disabled={metaAction !== null}>
                            {metaAction === 'connection' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}Test Connection
                        </Button>
                        <Button type="button" variant="outline" className="border-violet-300 text-violet-700" onClick={() => onSave()} disabled={saving}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Configuration
                        </Button>
                        <Button type="button" className="bg-violet-600 hover:bg-violet-700" disabled={saving} onClick={async () => {
                            const activeConfig = { ...whatsappConfig, is_active: true }
                            setWhatsappConfig(activeConfig)
                            await onSave(activeConfig)
                        }}>
                            <CheckCircle2 className="mr-2 h-4 w-4" />Set as Active Provider
                        </Button>
                    </div>
                </div>

                <aside className="space-y-4">
                    <Card className="border-slate-200 shadow-sm">
                        <CardHeader className="pb-3"><CardTitle className="text-base">Connection Status</CardTitle></CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            {[
                                ['API Connection', (metaConnection?.success || (!metaConnection && whatsappConfig.last_test_status === 'success')) ? 'Connected / Verified' : 'Not tested'],
                                ['Access Token', hasAccessToken ? 'Configured' : 'Missing'],
                                ['Webhook', hasWebhook ? 'Configured' : 'Missing'],
                                ['Phone Number', hasPhoneNumber ? publicConfig.display_phone_number : 'Missing']
                            ].map(([label, value]) => (
                                <div key={label} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                                    <span className="text-slate-600">{label}</span><span className="text-right font-medium text-slate-900">{value}</span>
                                </div>
                            ))}
                            {metaConnection && <p className={`whitespace-pre-line rounded-lg p-2 text-xs ${metaConnection.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{metaConnection.message}</p>}
                        </CardContent>
                    </Card>

                    <Card className="border-slate-200 shadow-sm">
                        <CardHeader className="pb-3"><CardTitle className="text-base">Test Message</CardTitle><CardDescription>Send a live message through Meta Cloud API.</CardDescription></CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-1.5">
                                <Label>Recipient Phone Number</Label>
                                <Input value={metaTestRecipient} placeholder="0192277233 or +60192277233" onChange={event => setMetaTestRecipient(event.target.value)} />
                                {metaTestRecipient.trim() && (
                                    formatPhoneDisplay(metaTestRecipient)
                                        ? <p className="text-xs text-slate-500">Sending to: <span className="font-medium text-slate-700">{formatPhoneDisplay(metaTestRecipient)}</span></p>
                                        : <p className="text-xs text-amber-600">Enter a valid Malaysian number, e.g. 0192277233</p>
                                )}
                            </div>
                            <Button type="button" className="w-full bg-violet-600 hover:bg-violet-700" onClick={() => handleMetaAction('test-message')} disabled={metaAction !== null}>
                                {metaAction === 'test-message' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send Test WhatsApp
                            </Button>

                            {metaTestResult && (() => {
                                const status = metaTestResult.status
                                const tone = status === 'delivered' || status === 'read'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                    : status === 'failed'
                                        ? 'border-red-200 bg-red-50 text-red-800'
                                        : 'border-amber-200 bg-amber-50 text-amber-800'
                                const fmt = (v?: string | null) => v ? new Date(v).toLocaleString() : '—'
                                return (
                                    <div className={`space-y-1 rounded-lg border p-3 text-xs ${tone}`}>
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold uppercase tracking-wide">Delivery: {status}</span>
                                            <button type="button" onClick={refreshMetaDeliveryStatus} disabled={metaStatusRefreshing} className="underline disabled:opacity-50">
                                                {metaStatusRefreshing ? 'Checking…' : 'Refresh'}
                                            </button>
                                        </div>
                                        <p>Recipient: <span className="font-medium">{metaTestResult.recipient || '—'}</span></p>
                                        <p className="break-all">WAMID: <span className="font-mono">{metaTestResult.wamid}</span></p>
                                        <p>Accepted: {fmt(metaTestResult.accepted_at)}</p>
                                        {metaTestResult.sent_at && <p>Sent: {fmt(metaTestResult.sent_at)}</p>}
                                        {metaTestResult.delivered_at && <p>Delivered: {fmt(metaTestResult.delivered_at)}</p>}
                                        {metaTestResult.read_at && <p>Read: {fmt(metaTestResult.read_at)}</p>}
                                        {metaTestResult.failed_at && <p>Failed: {fmt(metaTestResult.failed_at)}</p>}
                                        {metaTestResult.error && (
                                            <p>Error {metaTestResult.error.code ?? ''}: {metaTestResult.error.message || 'unknown'}</p>
                                        )}
                                        {status === 'accepted' && (
                                            <p className="mt-1 opacity-80">Accepted by Meta — delivery is confirmed only when a status webhook arrives. On localhost the webhook cannot reach this app, so verify on a public/staging URL.</p>
                                        )}
                                    </div>
                                )
                            })()}
                        </CardContent>
                    </Card>

                    <Card className="border-violet-200 bg-violet-50/60 shadow-sm">
                        <CardContent className="flex items-start gap-3 pt-5"><Bot className="mt-0.5 h-5 w-5 text-violet-600" /><div><p className="font-semibold text-slate-900">Support inbox replies</p><p className="mt-1 text-xs leading-5 text-slate-600">Bot and agent controls remain available in the Support Inbox after this provider is activated.</p></div></CardContent>
                    </Card>
                </aside>
            </div>
        )
    }

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
                            {isBaileysProvider(whatsappConfig.provider_name) && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg border">
                                    <div className="space-y-2 md:col-span-2">
                                        <Label className="flex items-center gap-2">
                                            <Link2 className="w-4 h-4" />
                                            Gateway Base URL
                                        </Label>
                                        <Input
                                            placeholder="https://wa.getouch.co"
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
                                            The secure URL of your WhatsApp gateway. Default: <strong>https://wa.getouch.co</strong>.
                                            <br />
                                            <span className="text-gray-400">
                                                Get your API key from <a href="https://getouch.co" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 underline">getouch.co</a> to connect instantly.
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
                                <Button onClick={() => onSave()} disabled={saving}>
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
                    {!gatewayStatus?.connected && isBaileysProvider(whatsappConfig?.provider_name) ? (
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
    const isBaileys = isBaileysProvider(whatsappConfig?.provider_name)
    const selectedProviderLabel = WHATSAPP_PROVIDERS.find(provider => provider.value === whatsappConfig?.provider_name)?.label || whatsappConfig?.provider_name || 'provider'
    const defaultReadiness = getWhatsAppProviderReadiness({
        id: whatsappConfig?.id,
        providerName: whatsappConfig?.provider_name,
        isActive: whatsappConfig?.is_active,
        lastTestStatus: whatsappConfig?.last_test_status,
        publicConfig: whatsappConfig?.config_public,
        sensitiveConfig: sensitiveData,
        baileysConnected: isBaileys ? gatewayStatus?.connected ?? false : null,
    })

    const setAsDefault = async () => {
        if (!defaultReadiness.eligible) return alert(defaultReadiness.reason)
        if (!window.confirm(`Use ${selectedProviderLabel} as the default WhatsApp provider?`)) return

        const response = await fetch('/api/settings/notifications/providers/whatsapp/default', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerName: whatsappConfig.provider_name }),
        })
        const payload = await response.json()
        if (!response.ok) return alert(payload.error || 'Failed to change the default WhatsApp provider.')
        setWhatsappConfig({ ...whatsappConfig, is_default: true })
        alert(`${selectedProviderLabel} is now the default WhatsApp provider.`)
    }

    return (
        <div className="space-y-6">
            <Card className="border-violet-200 bg-violet-50/40 shadow-sm">
                <CardContent className="flex flex-col gap-3 pt-5 md:flex-row md:items-center md:justify-between">
                    <div>
                        <Label htmlFor="whatsapp-provider-switcher" className="text-sm font-semibold text-slate-900">WhatsApp provider</Label>
                        <p className="mt-1 text-xs text-slate-500">Choose which provider to view or configure. This does not change the system default.</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
                        {whatsappConfig?.is_default ? <Badge className="w-fit bg-emerald-600">Default</Badge> : null}
                        <Select value={whatsappConfig?.provider_name || 'whatsapp_business'} onValueChange={handleProviderChange}>
                            <SelectTrigger id="whatsapp-provider-switcher" className="w-full bg-white md:w-[360px]">
                                <SelectValue placeholder="Select WhatsApp provider" />
                            </SelectTrigger>
                            <SelectContent>
                                {WHATSAPP_PROVIDERS.map(provider => (
                                    <SelectItem key={provider.value} value={provider.value}>
                                        <div><div className="font-medium">{provider.label}</div><div className="text-xs text-gray-500">{provider.description}</div></div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {!whatsappConfig?.is_default ? (
                            <div className="flex flex-col items-start gap-1 md:items-end">
                                <Button type="button" variant="outline" disabled={!defaultReadiness.eligible} onClick={setAsDefault}>Set as Default</Button>
                                {!defaultReadiness.eligible && defaultReadiness.reason ? (
                                    <p className="max-w-[360px] text-xs text-amber-700" role="status">{defaultReadiness.reason}</p>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </CardContent>
            </Card>
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

                <TabsContent value="configuration">
                    {whatsappConfig?.provider_name === 'whatsapp_business'
                        ? renderMetaConfigurationTab()
                        : renderConfigurationTab()}
                </TabsContent>

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
