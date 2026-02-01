'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import BotAdminSection from './BotAdminSection'
import ServicesStatusSection from './ServicesStatusSection'
import {
  Save,
  MessageCircle,
  MessageSquare,
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  TestTube,
  Settings,
  Shield,
  Wifi,
  WifiOff,
  QrCode,
  RefreshCw,
  LogOut,
  Smartphone,
  Send,
  Clock,
  AlertTriangle,
  Link2
} from 'lucide-react'

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

interface NotificationProvidersTabProps {
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
}

// Provider options for each channel
const PROVIDERS = {
  whatsapp: [
    { value: 'twilio', label: 'Twilio', description: 'Twilio WhatsApp Business API' },
    { value: 'whatsapp_business', label: 'WhatsApp Business API', description: 'Meta WhatsApp Business API (Direct)' },
    { value: 'messagebird', label: 'MessageBird', description: 'MessageBird Programmable Conversations' },
    { value: 'baileys', label: 'Baileys (Self-hosted)', description: 'Self-hosted WhatsApp Gateway' }
  ],
  sms: [
    { value: 'twilio', label: 'Twilio SMS', description: 'Twilio Programmable SMS' },
    { value: 'aws_sns', label: 'AWS SNS', description: 'Amazon Simple Notification Service' },
    { value: 'vonage', label: 'Vonage', description: 'Vonage SMS API (formerly Nexmo)' },
    { value: 'local_my', label: 'Local Malaysian Provider', description: 'Malaysian SMS gateway' }
  ],
  email: [
    { value: 'gmail', label: 'Gmail', description: 'Gmail with OAuth2 (Free: 500 emails/day)' },
    { value: 'sendgrid', label: 'SendGrid', description: 'SendGrid Email API (Twilio)' },
    { value: 'aws_ses', label: 'AWS SES', description: 'Amazon Simple Email Service' },
    { value: 'resend', label: 'Resend', description: 'Resend Email API' },
    { value: 'postmark', label: 'Postmark', description: 'Postmark Transactional Email' },
    { value: 'mailgun', label: 'Mailgun', description: 'Mailgun Email Service' }
  ]
}

export default function NotificationProvidersTab({ userProfile }: NotificationProvidersTabProps) {
  const { supabase, isReady } = useSupabaseAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})

  // Separate configs for each channel
  const [whatsappConfig, setWhatsappConfig] = useState<ProviderConfig | null>(null)
  const [smsConfig, setSmsConfig] = useState<ProviderConfig | null>(null)
  const [emailConfig, setEmailConfig] = useState<ProviderConfig | null>(null)

  // Gmail usage tracking
  const [emailUsageToday, setEmailUsageToday] = useState(0)
  const [emailUsageLoading, setEmailUsageLoading] = useState(false)

  // Form states for sensitive data (not stored in state)
  const [sensitiveData, setSensitiveData] = useState<Record<string, Record<string, string>>>({
    whatsapp: {},
    sms: {},
    email: {}
  })

  // WhatsApp Gateway Status State
  const [gatewayStatus, setGatewayStatus] = useState<{
    configured: boolean;
    connected: boolean;
    pairing_state: string;
    phone_number: string | null;
    push_name: string | null;
    last_connected_at: string | null;
    last_error: string | null;
  } | null>(null)
  const [gatewayLoading, setGatewayLoading] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrExpiry, setQrExpiry] = useState<number>(0)
  const [gatewayAction, setGatewayAction] = useState<string | null>(null)
  const [testNumber, setTestNumber] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  // Smart polling state
  const statusPollRef = useRef<NodeJS.Timeout | null>(null)
  const lastStatusRef = useRef<{ data: any, at: number } | null>(null)
  const [pollInterval, setPollInterval] = useState(5000)
  const [isGatewayUnreachable, setIsGatewayUnreachable] = useState(false)

  useEffect(() => {
    if (isReady) {
      loadProviderConfigs()
      loadEmailUsage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  // Helper to parse complex error objects from gateway
  const getFriendlyErrorMessage = (errorStr: string | null) => {
    if (!errorStr) return null;
    try {
      // Check if legacy simple string or JSON
      if (errorStr.startsWith('{')) {
        const errObj = JSON.parse(errorStr);
        if (errObj.code === 440) return "Connection dropped (temporary). Auto-reconnecting...";
        if (errObj.isLoggedOut) return "Logged out. Please reconnect (scan QR).";
        if (errObj.code === 401) return "Authentication failed. Check API Key.";
        if (errObj.reason) return errObj.reason;
      }
      return errorStr;
    } catch (e) {
      return errorStr;
    }
  }

  const loadEmailUsage = async () => {
    if (!isReady) return

    try {
      setEmailUsageLoading(true)

      const response = await fetch('/api/email/usage?provider=gmail')
      const data = await response.json()

      if (data.success) {
        setEmailUsageToday(data.today_count || 0)
      }
    } catch (error) {
      console.error('Error loading email usage:', error)
    } finally {
      setEmailUsageLoading(false)
    }
  }

  // ============================================
  // WhatsApp Gateway Control Functions
  // ============================================

  const fetchGatewayStatus = useCallback(async () => {
    if (!whatsappConfig?.provider_name || whatsappConfig.provider_name !== 'baileys') {
      return
    }

    // Don't show global loading on background polls unless it's the very first time
    if (!lastStatusRef.current) {
      setGatewayLoading(true)
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const response = await fetch('/api/settings/whatsapp/status', {
        signal: controller.signal
      })
      clearTimeout(timeoutId);

      // Network level success
      if (response.ok) {
        const data = await response.json()

        // Cache successful response
        lastStatusRef.current = { data, at: Date.now() }
        setGatewayStatus(data)
        setIsGatewayUnreachable(false)
        setPollInterval(5000) // Reset to fast polling on success

        // If waiting for QR, fetch QR code
        if (data.pairing_state === 'waiting_qr') {
          await fetchQRCode()
        } else {
          setQrCode(null)
        }

        // Update test number from config if available
        if (data.phone_number && !testNumber) {
          setTestNumber(whatsappConfig.config_public.test_number || '')
        }
      } else {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch (error) {
      console.error('Error fetching gateway status:', error)

      // Handle resilience: Only clear status if cache is stale (>30s)
      const cached = lastStatusRef.current;
      const isStale = !cached || (Date.now() - cached.at > 30000);

      if (isStale) {
        setIsGatewayUnreachable(true)
        setGatewayStatus(null) // Only clear if we really lost it
      } else {
        setIsGatewayUnreachable(true) // Just warn user, keep showing old data
      }

      // Backoff polling on error
      setPollInterval(prev => Math.min(prev * 1.5, 30000))
    } finally {
      setGatewayLoading(false)
    }
  }, [whatsappConfig?.provider_name, whatsappConfig?.config_public.test_number, testNumber])

  const fetchQRCode = async () => {
    try {
      const response = await fetch('/api/settings/whatsapp/qr')
      const data = await response.json()

      if (response.ok && data.qr) {
        // Gateway returns raw QR string - convert to data URL for display
        // Import qrcode dynamically to avoid SSR issues
        const QRCode = (await import('qrcode')).default
        const dataUrl = await QRCode.toDataURL(data.qr, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          margin: 2,
          width: 300,
        })
        setQrCode(dataUrl)
        setQrExpiry(data.expires_in_sec || 25)
      } else {
        setQrCode(null)
      }
    } catch (error) {
      console.error('Error fetching QR code:', error)
      setQrCode(null)
    }
  }

  const handleGatewayReset = async () => {
    if (!confirm('This will disconnect the current WhatsApp number and require re-scanning the QR code. Continue?')) {
      return
    }

    try {
      setGatewayAction('reset')
      const response = await fetch('/api/settings/whatsapp/reset', {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
        setGatewayStatus(prev => prev ? { ...prev, pairing_state: 'waiting_qr', connected: false, phone_number: null } : null)
        await fetchQRCode()
      } else {
        alert(`Failed to reset session: ${data.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setGatewayAction(null)
    }
  }

  const handleGatewayLogout = async () => {
    if (!confirm('This will disconnect from WhatsApp. Continue?')) {
      return
    }

    try {
      setGatewayAction('logout')
      const response = await fetch('/api/settings/whatsapp/logout', {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
        setGatewayStatus(prev => prev ? { ...prev, connected: false, pairing_state: 'disconnected' } : null)
        setQrCode(null)
      } else {
        alert(`Failed to logout: ${data.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setGatewayAction(null)
    }
  }

  const handleGatewayReconnect = async () => {
    try {
      setGatewayAction('reconnect')
      const response = await fetch('/api/settings/whatsapp/reconnect', {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
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

  const handleSendTestMessage = async () => {
    if (!testNumber) {
      alert('Please enter a recipient number')
      return
    }

    try {
      setSendingTest(true)
      const response = await fetch('/api/settings/whatsapp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testNumber,
          message: testMessage || undefined,
        }),
      })

      const data = await response.json()

      if (data.success) {
        alert(`✅ Test message sent successfully to ${data.sent_to}`)
      } else {
        alert(`❌ Failed to send: ${data.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setSendingTest(false)
    }
  }

  // Start/stop polling for gateway status with dynamic interval
  useEffect(() => {
    if (whatsappConfig?.provider_name === 'baileys') {
      // Initial fetch
      fetchGatewayStatus()

      // Set test number from config
      if (whatsappConfig.config_public.test_number) {
        setTestNumber(whatsappConfig.config_public.test_number)
      }

      // Dynamic polling
      const runPoll = () => {
        fetchGatewayStatus();
      }

      statusPollRef.current = setInterval(runPoll, pollInterval);

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

  const loadProviderConfigs = async () => {
    if (!isReady) return

    try {
      setLoading(true)

      const { data, error } = await supabase
        .from('notification_provider_configs')
        .select('*')
        .eq('org_id', userProfile.organizations.id)

      if (error) throw error

      // Separate by channel
      data?.forEach((config: any) => {
        let sensitive = {};
        try {
          // Try to parse sensitive data if it was stored as JSON string
          if (config.config_encrypted) { // Using config_encrypted as temp storage for now
            sensitive = JSON.parse(config.config_encrypted);
          }
        } catch (e) {
          console.error('Failed to parse sensitive data', e);
        }

        const providerConfig: ProviderConfig = {
          id: config.id,
          org_id: config.org_id,
          channel: config.channel,
          provider_name: config.provider_name,
          is_active: config.is_active,
          is_sandbox: config.is_sandbox,
          config_public: config.config_public || {},
          last_test_status: config.last_test_status,
          last_test_at: config.last_test_at,
          last_test_error: config.last_test_error
        }

        // Populate sensitive data state
        setSensitiveData(prev => ({
          ...prev,
          [config.channel]: sensitive
        }));

        switch (config.channel) {
          case 'whatsapp':
            setWhatsappConfig(providerConfig)
            break
          case 'sms':
            setSmsConfig(providerConfig)
            break
          case 'email':
            setEmailConfig(providerConfig)
            break
        }
      })
    } catch (error) {
      console.error('Error loading provider configs:', error)
      alert('Failed to load provider configurations')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveProvider = async (channel: 'whatsapp' | 'sms' | 'email') => {
    if (!isReady) return

    const config = channel === 'whatsapp' ? whatsappConfig :
      channel === 'sms' ? smsConfig : emailConfig

    if (!config) return

    try {
      setSaving(true)

      // Auto-sanitize Baileys URL if needed
      if (channel === 'whatsapp' && config.provider_name === 'baileys' && config.config_public.base_url) {
        let url = config.config_public.base_url.trim();
        // Enforce HTTPS
        if (url.startsWith('http://')) {
          url = 'https://' + url.substring(7);
        } else if (!url.startsWith('https://')) {
          url = 'https://' + url;
        }
        // Remove port 3001
        url = url.replace(/:3001\/?$/, '');
        // Remove trailing slash
        if (url.endsWith('/')) url = url.slice(0, -1);

        // Update in build object
        config.config_public.base_url = url;
      }

      // Prepare data for save
      const saveData = {
        id: config.id,
        org_id: userProfile.organizations.id,
        channel: config.channel,
        provider_name: config.provider_name,
        is_active: config.is_active,
        is_sandbox: config.is_sandbox,
        config_public: config.config_public,
        // For now, we'll store sensitive data in config_public (you should implement encryption)
        // In production, encrypt sensitive data before storing
        config_encrypted: JSON.stringify(sensitiveData[channel]),
        config_iv: 'placeholder-iv', // Implement proper encryption
        updated_at: new Date().toISOString(),
        created_by: userProfile.id
      }

      // Use ID for conflict resolution if it exists (update), otherwise try to match on unique keys (insert/upsert)
      const { error } = await (supabase as any)
        .from('notification_provider_configs')
        .upsert(saveData, {
          onConflict: saveData.id ? 'id' : 'org_id,channel,provider_name'
        })

      if (error) throw error

      alert(`${channel.toUpperCase()} provider configuration saved successfully!`)
      await loadProviderConfigs()
    } catch (error: any) {
      console.error(`Error saving ${channel} config:`, error)
      alert(`Failed to save configuration: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleTestProvider = async (channel: 'whatsapp' | 'sms' | 'email') => {
    const config = channel === 'whatsapp' ? whatsappConfig :
      channel === 'sms' ? smsConfig : emailConfig

    if (!config || !config.provider_name) {
      alert('Please select a provider and configure credentials first')
      return
    }

    try {
      setSaving(true)

      // Get test number if not in config
      let testNumber = config.config_public.test_number
      if (!testNumber) {
        testNumber = window.prompt("Enter a phone number to send the test message to:")
      }

      const response = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          provider: config.provider_name,
          credentials: sensitiveData[channel],
          config: config.config_public,
          to: testNumber
        })
      })

      const result = await response.json()

      if (!response.ok) throw new Error(result.error || 'Test failed')

      alert(`Test successful! Message sent.`)

      // Update config with test result
      const updatedConfig = {
        ...config,
        last_test_status: 'success',
        last_test_at: new Date().toISOString(),
        last_test_error: undefined
      }

      switch (channel) {
        case 'whatsapp':
          setWhatsappConfig(updatedConfig)
          break
        case 'sms':
          setSmsConfig(updatedConfig)
          break
        case 'email':
          setEmailConfig(updatedConfig)
          break
      }

    } catch (error: any) {
      console.error(`Error testing ${channel} provider:`, error)
      alert(`Test failed: ${error.message}`)

      const updatedConfig = {
        ...config,
        last_test_status: 'failed',
        last_test_at: new Date().toISOString(),
        last_test_error: error.message
      }

      switch (channel) {
        case 'whatsapp':
          setWhatsappConfig(updatedConfig)
          break
        case 'sms':
          setSmsConfig(updatedConfig)
          break
        case 'email':
          setEmailConfig(updatedConfig)
          break
      }
    } finally {
      setSaving(false)
    }
  }

  const renderWhatsAppConfig = () => (
    <div className="space-y-6">
      {/* Gateway Connection Status Card - Only for Baileys */}
      {whatsappConfig?.provider_name === 'baileys' && (
        <Card className={`border-2 ${gatewayStatus?.connected
          ? 'bg-green-50 border-green-300'
          : gatewayStatus?.pairing_state === 'waiting_qr'
            ? 'bg-yellow-50 border-yellow-300'
            : 'bg-red-50 border-red-300'
          }`}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {gatewayStatus?.connected ? (
                  <Wifi className="w-5 h-5 text-green-600" />
                ) : (
                  <WifiOff className="w-5 h-5 text-red-600" />
                )}
                <span>Gateway Connection Status</span>
              </div>
              <div className="flex items-center gap-2">
                {gatewayLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
                <Badge variant={gatewayStatus?.connected ? 'default' : 'destructive'} className={
                  gatewayStatus?.connected
                    ? 'bg-green-600'
                    : gatewayStatus?.pairing_state === 'waiting_qr'
                      ? 'bg-yellow-600'
                      : isGatewayUnreachable
                        ? 'bg-gray-500'
                        : ''
                }>
                  {isGatewayUnreachable ? 'Unreachable' :
                    gatewayStatus?.pairing_state === 'connected' ? 'Connected' :
                      gatewayStatus?.pairing_state === 'waiting_qr' ? 'Waiting for QR Scan' :
                        gatewayStatus?.pairing_state === 'connecting' ? 'Connecting...' :
                          gatewayStatus?.pairing_state === 'reconnecting' ? 'Reconnecting...' :
                            gatewayStatus?.pairing_state === 'gateway_unreachable' ? 'Gateway Unreachable' :
                              gatewayStatus?.pairing_state === 'not_configured' ? 'Not Configured' :
                                'Disconnected'}
                </Badge>
              </div>
            </CardTitle>
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
                      {gatewayStatus.push_name?.[0]?.toUpperCase() || 'W'}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">WhatsApp Name</p>
                    <p className="font-semibold">{gatewayStatus.push_name || 'Unknown'}</p>
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
                        <img
                          src={qrCode}
                          alt="WhatsApp QR Code"
                          className="w-64 h-64 mx-auto"
                        />
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
                      <li>Tap <strong>Menu</strong> or <strong>Settings</strong></li>
                      <li>Select <strong>Linked Devices</strong></li>
                      <li>Tap <strong>Link a Device</strong></li>
                      <li>Point your phone at this QR code</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {(gatewayStatus?.last_error || isGatewayUnreachable) && !gatewayStatus?.connected && (
              <div className={`flex items-start gap-3 p-4 rounded-lg border ${isGatewayUnreachable ? 'bg-orange-50 border-orange-200' : 'bg-red-100 border-red-200'}`}>
                <AlertTriangle className={`w-5 h-5 mt-0.5 ${isGatewayUnreachable ? 'text-orange-600' : 'text-red-600'}`} />
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
                  <Button
                    variant="outline"
                    onClick={handleGatewayReconnect}
                    disabled={!!gatewayAction}
                  >
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
      )}

      {/* Services Status - Gateway + Moltbot health */}
      {whatsappConfig?.provider_name === 'baileys' && (
        <ServicesStatusSection />
      )}

      {/* Send Test Message Card - Only when connected */}
      {whatsappConfig?.provider_name === 'baileys' && gatewayStatus?.connected && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="w-5 h-5 text-green-600" />
              Send Test Message
            </CardTitle>
            <CardDescription>
              Verify your WhatsApp connection by sending a test message
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Recipient Number</Label>
                <Input
                  placeholder="60192277233"
                  value={testNumber}
                  onChange={(e) => setTestNumber(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Enter number with country code (e.g., 60192277233 for Malaysia)
                </p>
              </div>
              <div className="space-y-2">
                <Label>Message (Optional)</Label>
                <Input
                  placeholder="Leave empty for default test message"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={handleSendTestMessage}
              disabled={sendingTest || !testNumber}
              className="bg-green-600 hover:bg-green-700"
            >
              {sendingTest ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Test Message
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Main Configuration Card */}
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
              onValueChange={(value) => setWhatsappConfig({
                ...whatsappConfig!,
                org_id: userProfile.organizations.id,
                channel: 'whatsapp',
                provider_name: value,
                is_active: whatsappConfig?.is_active || false,
                is_sandbox: whatsappConfig?.is_sandbox !== false,
                config_public: whatsappConfig?.config_public || {}
              })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select WhatsApp provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.whatsapp.map(provider => (
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
                    onCheckedChange={(checked) => setWhatsappConfig({
                      ...whatsappConfig,
                      is_active: checked
                    })}
                  />
                  <Label>Enable WhatsApp notifications</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={whatsappConfig.is_sandbox}
                    onCheckedChange={(checked) => setWhatsappConfig({
                      ...whatsappConfig,
                      is_sandbox: checked
                    })}
                  />
                  <Label>Use Sandbox Mode</Label>
                  <Badge variant="secondary" className="text-xs">Test</Badge>
                </div>
              </div>

              {/* Provider-specific fields */}
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
                      onChange={(e) => setWhatsappConfig({
                        ...whatsappConfig,
                        config_public: {
                          ...whatsappConfig.config_public,
                          base_url: e.target.value
                        }
                      })}
                    />
                    <p className="text-xs text-gray-500">
                      The secure URL of your gateway. Example: <strong>https://wa.serapod2u.com</strong>.
                      <br />
                      <span className="text-amber-600">Note: Port 3001 is closed. Do not include :3001 in the URL.</span>
                    </p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['baileys_api_key'] ? 'text' : 'password'}
                        placeholder="Your Baileys API Key"
                        value={sensitiveData.whatsapp.api_key || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          whatsapp: { ...sensitiveData.whatsapp, api_key: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          baileys_api_key: !showSecrets['baileys_api_key']
                        })}
                      >
                        {showSecrets['baileys_api_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Test Recipient Number</Label>
                    <Input
                      placeholder="60192277233"
                      value={whatsappConfig.config_public.test_number || ''}
                      onChange={(e) => setWhatsappConfig({
                        ...whatsappConfig,
                        config_public: {
                          ...whatsappConfig.config_public,
                          test_number: e.target.value
                        }
                      })}
                    />
                    <p className="text-xs text-gray-500">
                      Default number to receive test messages
                    </p>
                  </div>
                </div>
              )}

              {whatsappConfig.provider_name === 'twilio' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg border">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Account SID</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['whatsapp_sid'] ? 'text' : 'password'}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={sensitiveData.whatsapp.account_sid || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          whatsapp: { ...sensitiveData.whatsapp, account_sid: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          whatsapp_sid: !showSecrets['whatsapp_sid']
                        })}
                      >
                        {showSecrets['whatsapp_sid'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Auth Token</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['whatsapp_token'] ? 'text' : 'password'}
                        placeholder="Your Twilio Auth Token"
                        value={sensitiveData.whatsapp.auth_token || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          whatsapp: { ...sensitiveData.whatsapp, auth_token: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          whatsapp_token: !showSecrets['whatsapp_token']
                        })}
                      >
                        {showSecrets['whatsapp_token'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>WhatsApp From Number</Label>
                    <Input
                      placeholder="whatsapp:+14155238886"
                      value={whatsappConfig.config_public.from_number || ''}
                      onChange={(e) => setWhatsappConfig({
                        ...whatsappConfig,
                        config_public: {
                          ...whatsappConfig.config_public,
                          from_number: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Messaging Service SID (Optional)</Label>
                    <Input
                      placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={whatsappConfig.config_public.messaging_service_sid || ''}
                      onChange={(e) => setWhatsappConfig({
                        ...whatsappConfig,
                        config_public: {
                          ...whatsappConfig.config_public,
                          messaging_service_sid: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* Test Status */}
              {whatsappConfig.last_test_at && (
                <div className={`p-4 rounded-lg border ${whatsappConfig.last_test_status === 'success'
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
                  }`}>
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
                        <div className="text-sm text-red-600 mt-1">
                          {whatsappConfig.last_test_error}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end gap-3">
                {whatsappConfig.provider_name !== 'baileys' && (
                  <Button
                    variant="outline"
                    onClick={() => handleTestProvider('whatsapp')}
                    disabled={!whatsappConfig.is_active}
                  >
                    <TestTube className="w-4 h-4 mr-2" />
                    Send Test Message
                  </Button>
                )}
                <Button onClick={() => handleSaveProvider('whatsapp')} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Configuration
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Setup Guide */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-sm">Setup Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {whatsappConfig?.provider_name === 'baileys' ? (
            <>
              <p className="font-medium">To configure WhatsApp with Baileys (Self-hosted):</p>
              <ol className="list-decimal list-inside space-y-2 text-gray-700">
                <li>Deploy the Baileys Gateway on your VPS (PM2 recommended)</li>
                <li>Configure nginx reverse proxy with SSL (optional but recommended)</li>
                <li>Set the API key in the gateway environment</li>
                <li>Enter the Gateway Base URL and API Key above</li>
                <li>Save the configuration</li>
                <li>Click "Connect WhatsApp" and scan the QR code</li>
              </ol>
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-sm font-medium text-yellow-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Important Note
                </p>
                <p className="text-sm text-yellow-800 mt-1">
                  The WhatsApp number used will be the one you scan with. Make sure to use a dedicated business number.
                  You can change the connected number anytime by clicking "Change WhatsApp Number".
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="font-medium">To configure WhatsApp with Twilio:</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-700">
                <li>Sign up for a Twilio account at <a href="https://www.twilio.com" target="_blank" rel="noopener" className="text-blue-600 underline">twilio.com</a></li>
                <li>Enable WhatsApp in your Twilio console</li>
                <li>Request a WhatsApp-enabled phone number or use the sandbox</li>
                <li>Copy your Account SID and Auth Token from the dashboard</li>
                <li>Enter the credentials above and test the configuration</li>
              </ol>
            </>
          )}
        </CardContent>
      </Card>

      {/* WhatsApp Bot Admin Section - Only for Baileys */}
      {whatsappConfig?.provider_name === 'baileys' && (
        <BotAdminSection />
      )}
    </div>
  )

  const renderSMSConfig = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-purple-600" />
            SMS Configuration
          </CardTitle>
          <CardDescription>
            Configure your SMS provider for sending text message notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="sms-provider">SMS Provider</Label>
            <Select
              value={smsConfig?.provider_name || ''}
              onValueChange={(value) => setSmsConfig({
                ...smsConfig!,
                org_id: userProfile.organizations.id,
                channel: 'sms',
                provider_name: value,
                is_active: smsConfig?.is_active || false,
                is_sandbox: smsConfig?.is_sandbox !== false,
                config_public: smsConfig?.config_public || {}
              })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select SMS provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.sms.map(provider => (
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

          {smsConfig?.provider_name && (
            <>
              {/* Enable/Sandbox Switches */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={smsConfig.is_active}
                    onCheckedChange={(checked) => setSmsConfig({
                      ...smsConfig,
                      is_active: checked
                    })}
                  />
                  <Label>Enable SMS notifications</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={smsConfig.is_sandbox}
                    onCheckedChange={(checked) => setSmsConfig({
                      ...smsConfig,
                      is_sandbox: checked
                    })}
                  />
                  <Label>Use Sandbox Mode</Label>
                  <Badge variant="secondary" className="text-xs">Test</Badge>
                </div>
              </div>

              {/* Twilio SMS */}
              {smsConfig.provider_name === 'twilio' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Account SID</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['sms_sid'] ? 'text' : 'password'}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={sensitiveData.sms.account_sid || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          sms: { ...sensitiveData.sms, account_sid: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          sms_sid: !showSecrets['sms_sid']
                        })}
                      >
                        {showSecrets['sms_sid'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Auth Token</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['sms_token'] ? 'text' : 'password'}
                        placeholder="Your Twilio Auth Token"
                        value={sensitiveData.sms.auth_token || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          sms: { ...sensitiveData.sms, auth_token: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          sms_token: !showSecrets['sms_token']
                        })}
                      >
                        {showSecrets['sms_token'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>From Phone Number</Label>
                    <Input
                      placeholder="+14155551234"
                      value={smsConfig.config_public.from_number || ''}
                      onChange={(e) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          from_number: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Messaging Service SID (Optional)</Label>
                    <Input
                      placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={smsConfig.config_public.messaging_service_sid || ''}
                      onChange={(e) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          messaging_service_sid: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* AWS SNS */}
              {smsConfig.provider_name === 'aws_sns' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>AWS Access Key ID</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['sms_aws_key'] ? 'text' : 'password'}
                        placeholder="AKIAxxxxxxxxxxxxxxxxxx"
                        value={sensitiveData.sms.aws_access_key_id || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          sms: { ...sensitiveData.sms, aws_access_key_id: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          sms_aws_key: !showSecrets['sms_aws_key']
                        })}
                      >
                        {showSecrets['sms_aws_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>AWS Secret Access Key</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['sms_aws_secret'] ? 'text' : 'password'}
                        placeholder="Your AWS Secret Access Key"
                        value={sensitiveData.sms.aws_secret_access_key || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          sms: { ...sensitiveData.sms, aws_secret_access_key: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          sms_aws_secret: !showSecrets['sms_aws_secret']
                        })}
                      >
                        {showSecrets['sms_aws_secret'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>AWS Region</Label>
                    <Select
                      value={smsConfig.config_public.aws_region || 'ap-southeast-1'}
                      onValueChange={(value) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          aws_region: value
                        }
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                        <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
                        <SelectItem value="ap-southeast-1">Asia Pacific (Singapore)</SelectItem>
                        <SelectItem value="ap-southeast-2">Asia Pacific (Sydney)</SelectItem>
                        <SelectItem value="eu-west-1">Europe (Ireland)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Sender ID (Optional)</Label>
                    <Input
                      placeholder="YourBrand"
                      value={smsConfig.config_public.sender_id || ''}
                      onChange={(e) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          sender_id: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* Vonage (Nexmo) */}
              {smsConfig.provider_name === 'vonage' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['sms_vonage_key'] ? 'text' : 'password'}
                        placeholder="Your Vonage API Key"
                        value={sensitiveData.sms.api_key || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          sms: { ...sensitiveData.sms, api_key: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          sms_vonage_key: !showSecrets['sms_vonage_key']
                        })}
                      >
                        {showSecrets['sms_vonage_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>API Secret</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['sms_vonage_secret'] ? 'text' : 'password'}
                        placeholder="Your Vonage API Secret"
                        value={sensitiveData.sms.api_secret || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          sms: { ...sensitiveData.sms, api_secret: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          sms_vonage_secret: !showSecrets['sms_vonage_secret']
                        })}
                      >
                        {showSecrets['sms_vonage_secret'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>From Name/Number</Label>
                    <Input
                      placeholder="YourBrand or +60123456789"
                      value={smsConfig.config_public.from_number || ''}
                      onChange={(e) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          from_number: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Signature Secret (Optional)</Label>
                    <Input
                      type="password"
                      placeholder="For webhook verification"
                      value={smsConfig.config_public.signature_secret || ''}
                      onChange={(e) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          signature_secret: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* Local Malaysian Provider */}
              {smsConfig.provider_name === 'local_my' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>API Endpoint URL</Label>
                    <Input
                      placeholder="https://api.yoursmsgateway.com/send"
                      value={smsConfig.config_public.api_endpoint || ''}
                      onChange={(e) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          api_endpoint: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>API Username</Label>
                    <Input
                      placeholder="Your API username"
                      value={smsConfig.config_public.api_username || ''}
                      onChange={(e) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          api_username: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>API Password</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['sms_local_pwd'] ? 'text' : 'password'}
                        placeholder="Your API password"
                        value={sensitiveData.sms.api_password || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          sms: { ...sensitiveData.sms, api_password: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          sms_local_pwd: !showSecrets['sms_local_pwd']
                        })}
                      >
                        {showSecrets['sms_local_pwd'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Sender ID</Label>
                    <Input
                      placeholder="YourBrand"
                      value={smsConfig.config_public.sender_id || ''}
                      onChange={(e) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          sender_id: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>SMS Type</Label>
                    <Select
                      value={smsConfig.config_public.sms_type || 'transactional'}
                      onValueChange={(value) => setSmsConfig({
                        ...smsConfig,
                        config_public: {
                          ...smsConfig.config_public,
                          sms_type: value
                        }
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="transactional">Transactional</SelectItem>
                        <SelectItem value="promotional">Promotional</SelectItem>
                        <SelectItem value="otp">OTP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Test & Save Buttons */}
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleTestProvider('sms')}
                    disabled={saving}
                  >
                    <TestTube className="w-4 h-4 mr-2" />
                    Test Configuration
                  </Button>
                  {smsConfig.last_test_status && (
                    <div className="flex items-center gap-2">
                      {smsConfig.last_test_status === 'success' && (
                        <Badge className="bg-green-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Last test passed
                        </Badge>
                      )}
                      {smsConfig.last_test_status === 'failed' && (
                        <Badge variant="destructive" className="flex items-center gap-1">
                          <XCircle className="w-3 h-3" />
                          Last test failed
                        </Badge>
                      )}
                      {smsConfig.last_test_status === 'pending' && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Not configured
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <Button onClick={() => handleSaveProvider('sms')} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Provider Configuration
                    </>
                  )}
                </Button>
              </div>

              {/* Setup Guide */}
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader>
                  <CardTitle className="text-sm">SMS Provider Setup Guide</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  {smsConfig.provider_name === 'twilio' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Sign up at <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener" className="text-blue-600 underline">twilio.com/try-twilio</a></li>
                      <li>Get your Account SID and Auth Token from the Twilio Console</li>
                      <li>Buy a phone number or use trial credits</li>
                      <li>Enter credentials above and test</li>
                    </ol>
                  )}
                  {smsConfig.provider_name === 'aws_sns' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Log in to AWS Console → IAM → Create new user with SNS permissions</li>
                      <li>Copy Access Key ID and Secret Access Key</li>
                      <li>Select your preferred AWS region</li>
                      <li>For sender ID support, enable it in SNS settings (region-dependent)</li>
                    </ol>
                  )}
                  {smsConfig.provider_name === 'vonage' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Sign up at <a href="https://dashboard.nexmo.com/sign-up" target="_blank" rel="noopener" className="text-blue-600 underline">Vonage API Dashboard</a></li>
                      <li>Get your API Key and API Secret from Settings</li>
                      <li>Add credits to your account</li>
                      <li>Configure sender ID (alphanumeric sender names supported in most countries)</li>
                    </ol>
                  )}
                  {smsConfig.provider_name === 'local_my' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Contact your Malaysian SMS gateway provider</li>
                      <li>Get API endpoint URL, username, and password</li>
                      <li>Register your sender ID with MCMC (Malaysian Communications and Multimedia Commission)</li>
                      <li>Test with small volume before production</li>
                    </ol>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )

  const renderEmailConfig = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-orange-600" />
            Email Configuration
          </CardTitle>
          <CardDescription>
            Configure your email service provider for sending email notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="email-provider">Email Provider</Label>
            <Select
              value={emailConfig?.provider_name || ''}
              onValueChange={(value) => setEmailConfig({
                ...emailConfig!,
                org_id: userProfile.organizations.id,
                channel: 'email',
                provider_name: value,
                is_active: emailConfig?.is_active || false,
                is_sandbox: emailConfig?.is_sandbox !== false,
                config_public: emailConfig?.config_public || {}
              })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Email provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.email.map(provider => (
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

          {emailConfig?.provider_name && (
            <>
              {/* Enable/Sandbox Switches */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={emailConfig.is_active}
                    onCheckedChange={(checked) => setEmailConfig({
                      ...emailConfig,
                      is_active: checked
                    })}
                  />
                  <Label>Enable Email notifications</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={emailConfig.is_sandbox}
                    onCheckedChange={(checked) => setEmailConfig({
                      ...emailConfig,
                      is_sandbox: checked
                    })}
                  />
                  <Label>Use Sandbox Mode</Label>
                  <Badge variant="secondary" className="text-xs">Test</Badge>
                </div>
              </div>

              {/* Gmail */}
              {emailConfig.provider_name === 'gmail' && (
                <div className="space-y-6">
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-start gap-3">
                      <Mail className="w-5 h-5 text-blue-600 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="font-medium text-blue-900">Gmail OAuth2 Configuration</h4>
                        <p className="text-sm text-blue-700 mt-1">
                          Use your Gmail account to send up to <strong>500 emails per day</strong> for free.
                          Perfect for small to medium volume notifications.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Usage Warning */}
                  <div className={`p-4 rounded-lg border ${emailUsageToday >= 450 ? 'bg-red-50 border-red-200' :
                    emailUsageToday >= 350 ? 'bg-yellow-50 border-yellow-200' :
                      'bg-green-50 border-green-200'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertCircle className={`w-5 h-5 ${emailUsageToday >= 450 ? 'text-red-600' :
                          emailUsageToday >= 350 ? 'text-yellow-600' :
                            'text-green-600'
                          }`} />
                        <div>
                          <div className="font-medium text-sm">
                            Daily Email Usage: {emailUsageLoading ? '...' : emailUsageToday} / 500
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5">
                            {emailUsageToday >= 450 && 'Critical: Consider switching to a paid provider!'}
                            {emailUsageToday >= 350 && emailUsageToday < 450 && 'Warning: Approaching daily limit'}
                            {emailUsageToday < 350 && 'You have sufficient quota remaining'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold">
                          {((emailUsageToday / 500) * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-gray-500">Used</div>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${emailUsageToday >= 450 ? 'bg-red-600' :
                          emailUsageToday >= 350 ? 'bg-yellow-500' :
                            'bg-green-500'
                          }`}
                        style={{ width: `${Math.min((emailUsageToday / 500) * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* OAuth2 Configuration */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                    <div className="space-y-2 md:col-span-2">
                      <Label>Gmail Account Email</Label>
                      <Input
                        type="email"
                        placeholder="your-email@gmail.com"
                        value={emailConfig.config_public.gmail_email || ''}
                        onChange={(e) => setEmailConfig({
                          ...emailConfig,
                          config_public: {
                            ...emailConfig.config_public,
                            gmail_email: e.target.value
                          }
                        })}
                      />
                      <p className="text-xs text-gray-600">
                        The Gmail account you&apos;ll use to send emails
                      </p>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>OAuth2 Client ID</Label>
                      <Input
                        type="text"
                        placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                        value={emailConfig.config_public.oauth_client_id || ''}
                        onChange={(e) => setEmailConfig({
                          ...emailConfig,
                          config_public: {
                            ...emailConfig.config_public,
                            oauth_client_id: e.target.value
                          }
                        })}
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>OAuth2 Client Secret</Label>
                      <div className="relative">
                        <Input
                          type={showSecrets['email_gmail_secret'] ? 'text' : 'password'}
                          placeholder="GOCSPX-xxxxxxxxxxxxxxxxxxxx"
                          value={sensitiveData.email.oauth_client_secret || ''}
                          onChange={(e) => setSensitiveData({
                            ...sensitiveData,
                            email: { ...sensitiveData.email, oauth_client_secret: e.target.value }
                          })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0"
                          onClick={() => setShowSecrets({
                            ...showSecrets,
                            email_gmail_secret: !showSecrets['email_gmail_secret']
                          })}
                        >
                          {showSecrets['email_gmail_secret'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>OAuth2 Refresh Token</Label>
                      <div className="relative">
                        <Input
                          type={showSecrets['email_gmail_refresh'] ? 'text' : 'password'}
                          placeholder="1//xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          value={sensitiveData.email.oauth_refresh_token || ''}
                          onChange={(e) => setSensitiveData({
                            ...sensitiveData,
                            email: { ...sensitiveData.email, oauth_refresh_token: e.target.value }
                          })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0"
                          onClick={() => setShowSecrets({
                            ...showSecrets,
                            email_gmail_refresh: !showSecrets['email_gmail_refresh']
                          })}
                        >
                          {showSecrets['email_gmail_refresh'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-gray-600">
                        Generated after OAuth2 authorization flow
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>From Name</Label>
                      <Input
                        placeholder="Your Company Name"
                        value={emailConfig.config_public.from_name || ''}
                        onChange={(e) => setEmailConfig({
                          ...emailConfig,
                          config_public: {
                            ...emailConfig.config_public,
                            from_name: e.target.value
                          }
                        })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Reply-To Email (Optional)</Label>
                      <Input
                        type="email"
                        placeholder="support@yourdomain.com"
                        value={emailConfig.config_public.reply_to || ''}
                        onChange={(e) => setEmailConfig({
                          ...emailConfig,
                          config_public: {
                            ...emailConfig.config_public,
                            reply_to: e.target.value
                          }
                        })}
                      />
                    </div>
                  </div>

                  {/* OAuth2 Authorization Button */}
                  {!sensitiveData.email.oauth_refresh_token && (
                    <Card className="bg-yellow-50 border-yellow-200">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                          <div className="flex-1">
                            <h4 className="font-medium text-yellow-900">Authorization Required</h4>
                            <p className="text-sm text-yellow-700 mt-1">
                              You need to authorize this application to send emails on your behalf.
                            </p>
                            <Button
                              variant="outline"
                              className="mt-3 border-yellow-300 hover:bg-yellow-100"
                              onClick={() => {
                                alert('OAuth2 flow would open here. In production, this would redirect to Google OAuth consent screen.')
                                // TODO: Implement OAuth2 flow
                                // window.location.href = `/api/gmail/oauth/authorize?org_id=${userProfile.organizations.id}`
                              }}
                            >
                              <Shield className="w-4 h-4 mr-2" />
                              Authorize Gmail Access
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* SendGrid */}
              {emailConfig.provider_name === 'sendgrid' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['email_sendgrid_key'] ? 'text' : 'password'}
                        placeholder="SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={sensitiveData.email.api_key || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          email: { ...sensitiveData.email, api_key: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          email_sendgrid_key: !showSecrets['email_sendgrid_key']
                        })}
                      >
                        {showSecrets['email_sendgrid_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>From Email</Label>
                    <Input
                      type="email"
                      placeholder="noreply@yourdomain.com"
                      value={emailConfig.config_public.from_email || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_email: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>From Name</Label>
                    <Input
                      placeholder="Your Company Name"
                      value={emailConfig.config_public.from_name || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_name: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Reply-To Email (Optional)</Label>
                    <Input
                      type="email"
                      placeholder="support@yourdomain.com"
                      value={emailConfig.config_public.reply_to || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          reply_to: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* AWS SES */}
              {emailConfig.provider_name === 'aws_ses' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>AWS Access Key ID</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['email_aws_key'] ? 'text' : 'password'}
                        placeholder="AKIAxxxxxxxxxxxxxxxxxx"
                        value={sensitiveData.email.aws_access_key_id || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          email: { ...sensitiveData.email, aws_access_key_id: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          email_aws_key: !showSecrets['email_aws_key']
                        })}
                      >
                        {showSecrets['email_aws_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>AWS Secret Access Key</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['email_aws_secret'] ? 'text' : 'password'}
                        placeholder="Your AWS Secret Access Key"
                        value={sensitiveData.email.aws_secret_access_key || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          email: { ...sensitiveData.email, aws_secret_access_key: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          email_aws_secret: !showSecrets['email_aws_secret']
                        })}
                      >
                        {showSecrets['email_aws_secret'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>AWS Region</Label>
                    <Select
                      value={emailConfig.config_public.aws_region || 'us-east-1'}
                      onValueChange={(value) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          aws_region: value
                        }
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                        <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
                        <SelectItem value="ap-southeast-1">Asia Pacific (Singapore)</SelectItem>
                        <SelectItem value="ap-southeast-2">Asia Pacific (Sydney)</SelectItem>
                        <SelectItem value="eu-west-1">Europe (Ireland)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Configuration Set (Optional)</Label>
                    <Input
                      placeholder="default-config-set"
                      value={emailConfig.config_public.config_set || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          config_set: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>From Email</Label>
                    <Input
                      type="email"
                      placeholder="noreply@yourdomain.com"
                      value={emailConfig.config_public.from_email || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_email: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>From Name</Label>
                    <Input
                      placeholder="Your Company Name"
                      value={emailConfig.config_public.from_name || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_name: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* Resend */}
              {emailConfig.provider_name === 'resend' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['email_resend_key'] ? 'text' : 'password'}
                        placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxx"
                        value={sensitiveData.email.api_key || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          email: { ...sensitiveData.email, api_key: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          email_resend_key: !showSecrets['email_resend_key']
                        })}
                      >
                        {showSecrets['email_resend_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>From Email</Label>
                    <Input
                      type="email"
                      placeholder="noreply@yourdomain.com"
                      value={emailConfig.config_public.from_email || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_email: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>From Name</Label>
                    <Input
                      placeholder="Your Company Name"
                      value={emailConfig.config_public.from_name || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_name: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Reply-To Email (Optional)</Label>
                    <Input
                      type="email"
                      placeholder="support@yourdomain.com"
                      value={emailConfig.config_public.reply_to || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          reply_to: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* Postmark */}
              {emailConfig.provider_name === 'postmark' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Server API Token</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['email_postmark_token'] ? 'text' : 'password'}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        value={sensitiveData.email.api_token || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          email: { ...sensitiveData.email, api_token: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          email_postmark_token: !showSecrets['email_postmark_token']
                        })}
                      >
                        {showSecrets['email_postmark_token'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>From Email</Label>
                    <Input
                      type="email"
                      placeholder="noreply@yourdomain.com"
                      value={emailConfig.config_public.from_email || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_email: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>From Name</Label>
                    <Input
                      placeholder="Your Company Name"
                      value={emailConfig.config_public.from_name || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_name: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Message Stream (Optional)</Label>
                    <Input
                      placeholder="outbound"
                      value={emailConfig.config_public.message_stream || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          message_stream: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Reply-To Email (Optional)</Label>
                    <Input
                      type="email"
                      placeholder="support@yourdomain.com"
                      value={emailConfig.config_public.reply_to || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          reply_to: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* Mailgun */}
              {emailConfig.provider_name === 'mailgun' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <div className="space-y-2 md:col-span-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showSecrets['email_mailgun_key'] ? 'text' : 'password'}
                        placeholder="key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={sensitiveData.email.api_key || ''}
                        onChange={(e) => setSensitiveData({
                          ...sensitiveData,
                          email: { ...sensitiveData.email, api_key: e.target.value }
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0"
                        onClick={() => setShowSecrets({
                          ...showSecrets,
                          email_mailgun_key: !showSecrets['email_mailgun_key']
                        })}
                      >
                        {showSecrets['email_mailgun_key'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Domain</Label>
                    <Input
                      placeholder="mg.yourdomain.com"
                      value={emailConfig.config_public.domain || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          domain: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Region</Label>
                    <Select
                      value={emailConfig.config_public.region || 'us'}
                      onValueChange={(value) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          region: value
                        }
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="us">US (api.mailgun.net)</SelectItem>
                        <SelectItem value="eu">EU (api.eu.mailgun.net)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>From Email</Label>
                    <Input
                      type="email"
                      placeholder="noreply@yourdomain.com"
                      value={emailConfig.config_public.from_email || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_email: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>From Name</Label>
                    <Input
                      placeholder="Your Company Name"
                      value={emailConfig.config_public.from_name || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          from_name: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Reply-To Email (Optional)</Label>
                    <Input
                      type="email"
                      placeholder="support@yourdomain.com"
                      value={emailConfig.config_public.reply_to || ''}
                      onChange={(e) => setEmailConfig({
                        ...emailConfig,
                        config_public: {
                          ...emailConfig.config_public,
                          reply_to: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              )}

              {/* Test & Save Buttons */}
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleTestProvider('email')}
                    disabled={saving}
                  >
                    <TestTube className="w-4 h-4 mr-2" />
                    Test Configuration
                  </Button>
                  {emailConfig.last_test_status && (
                    <div className="flex items-center gap-2">
                      {emailConfig.last_test_status === 'success' && (
                        <Badge className="bg-green-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Last test passed
                        </Badge>
                      )}
                      {emailConfig.last_test_status === 'failed' && (
                        <Badge variant="destructive" className="flex items-center gap-1">
                          <XCircle className="w-3 h-3" />
                          Last test failed
                        </Badge>
                      )}
                      {emailConfig.last_test_status === 'pending' && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Not configured
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <Button onClick={() => handleSaveProvider('email')} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Provider Configuration
                    </>
                  )}
                </Button>
              </div>

              {/* Setup Guide */}
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader>
                  <CardTitle className="text-sm">Email Provider Setup Guide</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  {emailConfig.provider_name === 'gmail' && (
                    <div className="space-y-3">
                      <p className="font-medium text-gray-900">Setting up Gmail OAuth2:</p>
                      <ol className="list-decimal list-inside space-y-2 text-gray-700">
                        <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener" className="text-blue-600 underline">Google Cloud Console</a></li>
                        <li>Create a new project or select existing one</li>
                        <li>Enable Gmail API (APIs &amp; Services → Library → Gmail API → Enable)</li>
                        <li>Create OAuth 2.0 Credentials:
                          <ul className="list-disc list-inside ml-6 mt-1 space-y-1 text-sm">
                            <li>Go to APIs &amp; Services → Credentials</li>
                            <li>Click &quot;Create Credentials&quot; → &quot;OAuth client ID&quot;</li>
                            <li>Application type: &quot;Web application&quot;</li>
                            <li>Add authorized redirect URI: <code className="bg-gray-100 px-1">http://localhost:3000/api/gmail/oauth/callback</code></li>
                          </ul>
                        </li>
                        <li>Copy Client ID and Client Secret</li>
                        <li>Get refresh token:
                          <ul className="list-disc list-inside ml-6 mt-1 space-y-1 text-sm">
                            <li>Use OAuth 2.0 Playground or custom flow</li>
                            <li>Scopes needed: <code className="bg-gray-100 px-1">https://www.googleapis.com/auth/gmail.send</code></li>
                          </ul>
                        </li>
                        <li>Enter credentials above and save configuration</li>
                      </ol>
                      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                        <p className="text-sm font-medium text-yellow-900 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          Daily Limit: 500 emails/day (Gmail free tier)
                        </p>
                        <p className="text-xs text-yellow-700 mt-1">
                          This limit resets at midnight Pacific Time. Monitor usage above to avoid hitting the limit.
                          For higher volume, consider upgrading to Google Workspace or using SendGrid/AWS SES.
                        </p>
                      </div>
                    </div>
                  )}
                  {emailConfig.provider_name === 'sendgrid' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Sign up at <a href="https://signup.sendgrid.com/" target="_blank" rel="noopener" className="text-blue-600 underline">SendGrid</a></li>
                      <li>Create an API Key in Settings → API Keys</li>
                      <li>Verify your sender domain or email address</li>
                      <li>Enter API key and from email above</li>
                    </ol>
                  )}
                  {emailConfig.provider_name === 'aws_ses' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Log in to AWS Console → SES</li>
                      <li>Verify your domain or email address</li>
                      <li>Request production access (start in sandbox for testing)</li>
                      <li>Create IAM user with SES send permissions</li>
                      <li>Generate Access Key and Secret Key</li>
                    </ol>
                  )}
                  {emailConfig.provider_name === 'resend' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Sign up at <a href="https://resend.com/signup" target="_blank" rel="noopener" className="text-blue-600 underline">Resend</a></li>
                      <li>Verify your domain in Domains section</li>
                      <li>Create an API key in API Keys</li>
                      <li>Use any verified email address as sender</li>
                    </ol>
                  )}
                  {emailConfig.provider_name === 'postmark' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Sign up at <a href="https://account.postmarkapp.com/sign_up" target="_blank" rel="noopener" className="text-blue-600 underline">Postmark</a></li>
                      <li>Create a server and verify sender signature</li>
                      <li>Get Server API Token from API Tokens tab</li>
                      <li>Optionally configure message streams for different types</li>
                    </ol>
                  )}
                  {emailConfig.provider_name === 'mailgun' && (
                    <ol className="list-decimal list-inside space-y-1 text-gray-700">
                      <li>Sign up at <a href="https://signup.mailgun.com/new/signup" target="_blank" rel="noopener" className="text-blue-600 underline">Mailgun</a></li>
                      <li>Add and verify your sending domain</li>
                      <li>Get API key from Settings → API Keys</li>
                      <li>Choose region (US or EU) based on your domain setup</li>
                    </ol>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-600">Loading provider configurations...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white rounded-lg">
              <Shield className="w-6 h-6 text-purple-600" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-xl">Notification Provider Configuration</CardTitle>
              <CardDescription className="mt-2">
                Configure your notification service providers for WhatsApp, SMS, and Email delivery.
                All API credentials are securely encrypted and stored.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Provider Tabs */}
      <Tabs defaultValue="whatsapp" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="whatsapp" className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4" />
            WhatsApp
            {whatsappConfig?.is_active && <Badge className="ml-2 h-5 px-1.5 bg-green-600">Active</Badge>}
          </TabsTrigger>
          <TabsTrigger value="sms" className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            SMS
            {smsConfig?.is_active && <Badge className="ml-2 h-5 px-1.5 bg-green-600">Active</Badge>}
          </TabsTrigger>
          <TabsTrigger value="email" className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email
            {emailConfig?.is_active && <Badge className="ml-2 h-5 px-1.5 bg-green-600">Active</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp">
          {renderWhatsAppConfig()}
        </TabsContent>

        <TabsContent value="sms">
          {renderSMSConfig()}
        </TabsContent>

        <TabsContent value="email">
          {renderEmailConfig()}
        </TabsContent>
      </Tabs>
    </div>
  )
}
