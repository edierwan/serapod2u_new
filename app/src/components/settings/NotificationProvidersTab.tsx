'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import WhatsAppSubTabs from './WhatsAppSubTabs'
import {
  Save,
  MessageSquare,
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  TestTube,
  Shield,
  AlertTriangle,
  Send,
  HelpCircle,
  Check,
  Info
} from 'lucide-react'

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
    { value: 'baileys', label: 'Baileys (Self-hosted) - Hostinger', description: 'Self-hosted WhatsApp Gateway (Hostinger VPS)' },
    { value: 'baileys_home', label: 'Baileys (Self-hosted) - Home', description: 'Self-hosted WhatsApp Gateway (Home VPS)' }
  ],
  sms: [
    { value: 'twilio', label: 'Twilio SMS', description: 'Twilio Programmable SMS' },
    { value: 'aws_sns', label: 'AWS SNS', description: 'Amazon Simple Notification Service' },
    { value: 'vonage', label: 'Vonage', description: 'Vonage SMS API (formerly Nexmo)' },
    { value: 'local_my', label: 'Local Malaysian Provider', description: 'Malaysian SMS gateway' }
  ],
  email: [
    { value: 'smtp', label: 'Use My Domain (SMTP)', description: 'Use your own domain with SMTP', icon: '/images/serapod_notification_icons/provider-own-domain-smtp.svg' },
    { value: 'gmail', label: 'Gmail OAuth2', description: 'Secure OAuth2 authentication', icon: '/images/serapod_notification_icons/provider-gmail-oauth2.svg' },
    { value: 'sendgrid', label: 'SendGrid', description: 'Reliable email delivery', icon: '/images/serapod_notification_icons/provider-sendgrid.svg' },
    { value: 'aws_ses', label: 'AWS SES', description: 'Scalable email service', icon: '/images/serapod_notification_icons/provider-aws-ses.svg' },
    { value: 'resend', label: 'Resend', description: 'Modern email API', icon: '/images/serapod_notification_icons/provider-resend.svg' },
    { value: 'postmark', label: 'Postmark', description: 'Transactional email service', icon: '/images/serapod_notification_icons/provider-postmark.svg' },
    { value: 'mailgun', label: 'Mailgun', description: 'Developer-friendly API', icon: '/images/serapod_notification_icons/provider-mailgun.svg' }
  ]
}

const NOTIFICATION_ICON_BASE = '/images/serapod_notification_icons'

const STATUS_ICONS: Record<string, string> = {
  Valid: `${NOTIFICATION_ICON_BASE}/status-valid.svg`,
  Pending: `${NOTIFICATION_ICON_BASE}/status-pending.svg`,
  Missing: `${NOTIFICATION_ICON_BASE}/status-missing.svg`
}

const SMTP_DEFAULTS = {
  domain: 'serapod2u.com',
  from_name: 'Serapod2U',
  from_email: 'no-reply@serapod2u.com',
  reply_to: 'admin@serapod2u.com',
  smtp_host: 'mail.getouch.co',
  port: 587,
  security: 'starttls',
  username: 'no-reply@serapod2u.com'
}

type NotificationChannel = 'whatsapp' | 'sms' | 'email'

const WHATSAPP_PROVIDER_FROM_URL: Record<string, string> = {
  meta: 'whatsapp_business',
  'baileys-hostinger': 'baileys',
  'baileys-home': 'baileys_home',
  twilio: 'twilio',
  messagebird: 'messagebird'
}

const WHATSAPP_PROVIDER_TO_URL: Record<string, string> = {
  whatsapp_business: 'meta',
  baileys: 'baileys-hostinger',
  baileys_home: 'baileys-home',
  twilio: 'twilio',
  messagebird: 'messagebird'
}

const WHATSAPP_PROVIDER_LABELS: Record<string, string> = {
  whatsapp_business: 'Meta Official API',
  baileys: 'Baileys — Hostinger',
  baileys_home: 'Baileys — Home',
  twilio: 'Twilio',
  messagebird: 'MessageBird'
}

const normalizeSmtpConfig = (config: Record<string, any> = {}) => {
  const savedConfig = { ...config }
  delete savedConfig.mail_host
  const normalized = { ...SMTP_DEFAULTS, ...savedConfig }

  if (!normalized.smtp_host || (
    normalized.domain === SMTP_DEFAULTS.domain &&
    normalized.smtp_host === 'mail.serapod2u.com'
  )) {
    normalized.smtp_host = SMTP_DEFAULTS.smtp_host
  }

  return normalized
}

export default function NotificationProvidersTab({ userProfile }: NotificationProvidersTabProps) {
  const { supabase, isReady } = useSupabaseAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedChannel = searchParams.get('channel')
  const [selectedChannel, setSelectedChannel] = useState<NotificationChannel>(() => {
    if (requestedChannel === 'whatsapp' || requestedChannel === 'sms' || requestedChannel === 'email') return requestedChannel
    return 'whatsapp'
  })
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
  const [testEmail, setTestEmail] = useState('')
  const [emailAction, setEmailAction] = useState<'connection' | 'test-email' | null>(null)

  // Form states for sensitive data (not stored in state)
  const [sensitiveData, setSensitiveData] = useState<Record<string, Record<string, string>>>({
    whatsapp: {},
    sms: {},
    email: {}
  })

  useEffect(() => {
    if (isReady) {
      loadProviderConfigs()
      loadEmailUsage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (requestedChannel === 'whatsapp' || requestedChannel === 'sms' || requestedChannel === 'email') {
      setSelectedChannel(requestedChannel)
      window.localStorage.setItem('notification-provider-channel', requestedChannel)
    } else {
      const remembered = window.localStorage.getItem('notification-provider-channel')
      if (remembered === 'whatsapp' || remembered === 'sms' || remembered === 'email') setSelectedChannel(remembered)
    }
  }, [requestedChannel])

  const handleChannelChange = (channel: string) => {
    const nextChannel = channel as NotificationChannel
    setSelectedChannel(nextChannel)
    window.localStorage.setItem('notification-provider-channel', nextChannel)

    const params = new URLSearchParams(searchParams.toString())
    params.set('channel', nextChannel)
    if (nextChannel === 'whatsapp') {
      const provider = whatsappConfig?.provider_name || 'whatsapp_business'
      params.set('provider', WHATSAPP_PROVIDER_TO_URL[provider] || 'meta')
      params.set('tab', provider === 'baileys' || provider === 'baileys_home' ? 'status' : 'configuration')
    } else {
      params.delete('provider')
      params.delete('tab')
    }
    router.push(`?${params.toString()}`, { scroll: false })
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

  const loadProviderConfigs = async () => {
    if (!isReady) return

    try {
      setLoading(true)

      const { data, error } = await supabase
        .from('notification_provider_configs')
        .select('*')
        .eq('org_id', userProfile.organizations.id)

      if (error) throw error

      let hasEmailConfig = false
      const parseSensitiveConfig = (config: any) => {
        if (!config?.config_encrypted) return {}
        try {
          return typeof config.config_encrypted === 'string'
            ? JSON.parse(config.config_encrypted)
            : config.config_encrypted
        } catch (parseError) {
          console.error('Failed to parse sensitive data', parseError)
          return {}
        }
      }

      const whatsappRecords = data?.filter((config: any) => config.channel === 'whatsapp') || []
      const requestedProvider = WHATSAPP_PROVIDER_FROM_URL[searchParams.get('provider') || '']
      const rememberedProvider = typeof window !== 'undefined'
        ? window.localStorage.getItem('notification-provider-whatsapp')
        : null
      const selectedWhatsapp = requestedProvider
        ? whatsappRecords.find((config: any) => config.provider_name === requestedProvider)
        : whatsappRecords.find((config: any) => config.provider_name === rememberedProvider) ||
          whatsappRecords.find((config: any) => config.is_default) ||
          whatsappRecords.find((config: any) => config.provider_name === 'whatsapp_business')

      if (selectedWhatsapp) {
        setWhatsappConfig({
          id: selectedWhatsapp.id,
          org_id: selectedWhatsapp.org_id,
          channel: 'whatsapp',
          provider_name: selectedWhatsapp.provider_name,
          is_active: !!selectedWhatsapp.is_active,
          is_default: !!selectedWhatsapp.is_default,
          is_sandbox: selectedWhatsapp.is_sandbox !== false,
          config_public: (selectedWhatsapp.config_public || {}) as Record<string, any>,
          last_test_status: selectedWhatsapp.last_test_status || undefined,
          last_test_at: selectedWhatsapp.last_test_at || undefined,
          last_test_error: selectedWhatsapp.last_test_error || undefined
        })
        setSensitiveData(prev => ({ ...prev, whatsapp: parseSensitiveConfig(selectedWhatsapp) }))
      } else {
        setWhatsappConfig({
          org_id: userProfile.organizations.id,
          channel: 'whatsapp',
          provider_name: requestedProvider || 'whatsapp_business',
          is_active: false,
          is_sandbox: true,
          config_public: {}
        })
        setSensitiveData(prev => ({ ...prev, whatsapp: {} }))
      }

      // Separate by channel
      data?.forEach((config: any) => {
        if (config.channel === 'whatsapp') return
        const sensitive = parseSensitiveConfig(config)

        const providerConfig: ProviderConfig = {
          id: config.id,
          org_id: config.org_id,
          channel: config.channel,
          provider_name: config.provider_name,
          is_active: config.is_active,
          is_sandbox: config.is_sandbox,
          config_public: config.channel === 'email' && config.provider_name === 'smtp'
            ? normalizeSmtpConfig(config.config_public)
            : (config.config_public || {}),
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
          case 'sms':
            setSmsConfig(providerConfig)
            break
          case 'email':
            hasEmailConfig = true
            setEmailConfig(providerConfig)
            break
        }
      })

      if (!hasEmailConfig) {
        setEmailConfig({
          org_id: userProfile.organizations.id,
          channel: 'email',
          provider_name: 'smtp',
          is_active: false,
          is_sandbox: true,
          config_public: normalizeSmtpConfig()
        })
      }
    } catch (error) {
      console.error('Error loading provider configs:', error)
      alert('Failed to load provider configurations')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveProvider = async (channel: 'whatsapp' | 'sms' | 'email', configOverride?: ProviderConfig) => {
    if (!isReady) return

    const config = configOverride || (channel === 'whatsapp' ? whatsappConfig :
      channel === 'sms' ? smsConfig : emailConfig
    )

    if (!config) return

    try {
      setSaving(true)

      // Auto-sanitize Baileys URL if needed
      if (channel === 'whatsapp' && (config.provider_name === 'baileys' || config.provider_name === 'baileys_home') && config.config_public.base_url) {
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

  const selectEmailProvider = (providerName: string) => {
    setEmailConfig({
      ...emailConfig,
      org_id: userProfile.organizations.id,
      channel: 'email',
      provider_name: providerName,
      is_active: emailConfig?.is_active || false,
      is_sandbox: emailConfig?.is_sandbox !== false,
      config_public: providerName === 'smtp'
        ? normalizeSmtpConfig(emailConfig?.provider_name === 'smtp' ? emailConfig.config_public : {})
        : (emailConfig?.provider_name === providerName ? emailConfig.config_public : {})
    })
  }

  const handleEmailAction = async (action: 'connection' | 'test-email') => {
    if (!emailConfig) return

    if (emailConfig.provider_name !== 'smtp') {
      alert('Connection and test-email support for this provider is not implemented yet. You can still save its existing configuration.')
      return
    }

    if (action === 'test-email' && !testEmail.trim()) {
      alert('Enter an email address for the test message.')
      return
    }

    try {
      setEmailAction(action)
      const response = await fetch('/api/settings/notifications/providers/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          to: action === 'test-email' ? testEmail.trim() : undefined,
          config: emailConfig.config_public,
          credentials: { password: sensitiveData.email.password || '' }
        })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Email provider test failed')

      setEmailConfig({
        ...emailConfig,
        last_test_status: 'success',
        last_test_at: new Date().toISOString(),
        last_test_error: undefined
      })
      alert(action === 'connection' ? 'SMTP connection verified successfully.' : 'Test email sent successfully.')
    } catch (error: any) {
      setEmailConfig({
        ...emailConfig,
        last_test_status: 'failed',
        last_test_at: new Date().toISOString(),
        last_test_error: error.message
      })
      alert(`Email test failed: ${error.message}`)
    } finally {
      setEmailAction(null)
    }
  }

  const handleActivateEmailProvider = async () => {
    if (!emailConfig) return

    // Save the updated active state directly to avoid waiting for React state propagation.
    const activeConfig = { ...emailConfig, is_active: true }
    const originalConfig = emailConfig
    setEmailConfig(activeConfig)
    try {
      setSaving(true)
      const saveData = {
        id: activeConfig.id,
        org_id: userProfile.organizations.id,
        channel: activeConfig.channel,
        provider_name: activeConfig.provider_name,
        is_active: true,
        is_sandbox: activeConfig.is_sandbox,
        config_public: activeConfig.config_public,
        config_encrypted: JSON.stringify(sensitiveData.email),
        config_iv: 'placeholder-iv',
        updated_at: new Date().toISOString(),
        created_by: userProfile.id
      }
      const { error } = await (supabase as any)
        .from('notification_provider_configs')
        .upsert(saveData, { onConflict: saveData.id ? 'id' : 'org_id,channel,provider_name' })
      if (error) throw error
      alert('Email provider saved and set as active.')
      await loadProviderConfigs()
    } catch (error: any) {
      setEmailConfig(originalConfig)
      alert(`Failed to activate provider: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Handler for WhatsApp save from sub-tabs
  const handleWhatsAppSave = async (configOverride?: ProviderConfig) => {
    await handleSaveProvider('whatsapp', configOverride)
  }

  const renderWhatsAppConfig = () => (
    <WhatsAppSubTabs
      userProfile={userProfile}
      whatsappConfig={whatsappConfig}
      setWhatsappConfig={setWhatsappConfig}
      sensitiveData={sensitiveData.whatsapp}
      setSensitiveData={(data) => setSensitiveData(prev => ({ ...prev, whatsapp: data }))}
      showSecrets={showSecrets}
      setShowSecrets={setShowSecrets}
      onSave={handleWhatsAppSave}
      saving={saving}
    />
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
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-orange-600" />
            Email Delivery Setup
          </CardTitle>
          <CardDescription>
            Configure how Serapod2U sends emails to your users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Provider Selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-xs text-white">1</span>
              Choose Email Provider
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
              {PROVIDERS.email.map((provider) => {
                const selected = emailConfig?.provider_name === provider.value
                return (
                  <button
                    key={provider.value}
                    type="button"
                    onClick={() => selectEmailProvider(provider.value)}
                    className={`relative min-h-40 rounded-xl border bg-white px-3 py-4 text-center transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-sm ${selected ? 'border-violet-500 ring-2 ring-violet-100' : 'border-slate-200'}`}
                  >
                    <span className={`absolute left-3 top-3 h-4 w-4 rounded-full border ${selected ? 'border-violet-600 bg-violet-600 shadow-[inset_0_0_0_3px_white]' : 'border-slate-300'}`} />
                    {provider.value === 'smtp' && (
                      <span className="absolute right-2 top-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Recommended</span>
                    )}
                    <span className={`mx-auto mt-4 flex h-11 w-11 items-center justify-center rounded-lg ${selected ? 'bg-violet-50' : 'bg-slate-50'}`}>
                      <img src={provider.icon} alt={`${provider.label} icon`} className="h-9 w-9 object-contain" />
                    </span>
                    <span className="mt-3 block text-sm font-semibold leading-5 text-slate-900">{provider.label}</span>
                    <span className="mt-1 block text-xs leading-4 text-slate-500">{provider.description}</span>
                  </button>
                )
              })}
            </div>
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

              {/* SMTP */}
              {emailConfig.provider_name === 'smtp' && (
                <div className="space-y-4 border-t border-slate-100 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-xs text-white">2</span>
                      Configure Your Domain (SMTP)
                    </div>
                    <span className="text-xs text-slate-500">Credentials stay masked and are only sent to the server when saved or tested.</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>Domain</Label>
                      <Input value={emailConfig.config_public.domain || ''} onChange={(e) => setEmailConfig({ ...emailConfig, config_public: { ...emailConfig.config_public, domain: e.target.value } })} />
                      <p className="text-xs text-slate-500">Domain used for sending email.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP server hostname</Label>
                      <Input value={emailConfig.config_public.smtp_host || ''} onChange={(e) => setEmailConfig({ ...emailConfig, config_public: { ...emailConfig.config_public, smtp_host: e.target.value } })} />
                      <p className="text-xs text-slate-500">Use the main Mailcow hostname with a valid TLS certificate. Sender email can still use your selected domain.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>From name</Label>
                      <Input value={emailConfig.config_public.from_name || ''} onChange={(e) => setEmailConfig({ ...emailConfig, config_public: { ...emailConfig.config_public, from_name: e.target.value } })} />
                      <p className="text-xs text-slate-500">Name recipients will see.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>From email</Label>
                      <Input type="email" value={emailConfig.config_public.from_email || ''} onChange={(e) => setEmailConfig({ ...emailConfig, config_public: { ...emailConfig.config_public, from_email: e.target.value } })} />
                    </div>
                    <div className="space-y-1.5 md:col-span-1 xl:col-span-2">
                      <Label>Reply-to email</Label>
                      <Input type="email" value={emailConfig.config_public.reply_to || ''} onChange={(e) => setEmailConfig({ ...emailConfig, config_public: { ...emailConfig.config_public, reply_to: e.target.value } })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Port</Label>
                      <Input type="number" value={emailConfig.config_public.port || 587} onChange={(e) => setEmailConfig({ ...emailConfig, config_public: { ...emailConfig.config_public, port: Number(e.target.value) } })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Security</Label>
                      <Select value={emailConfig.config_public.security || 'starttls'} onValueChange={(value) => setEmailConfig({ ...emailConfig, config_public: { ...emailConfig.config_public, security: value } })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="starttls">STARTTLS</SelectItem>
                          <SelectItem value="ssl">SSL / TLS</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 md:col-span-1 xl:col-span-2">
                      <Label>Username</Label>
                      <Input value={emailConfig.config_public.username || ''} onChange={(e) => setEmailConfig({ ...emailConfig, config_public: { ...emailConfig.config_public, username: e.target.value } })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Password</Label>
                      <div className="relative">
                        <Input
                          className="pr-10"
                          type={showSecrets.email_smtp_password ? 'text' : 'password'}
                          autoComplete="new-password"
                          placeholder={sensitiveData.email.password ? '••••••••••••' : 'Enter SMTP password'}
                          value={sensitiveData.email.password || ''}
                          onChange={(e) => setSensitiveData({ ...sensitiveData, email: { ...sensitiveData.email, password: e.target.value } })}
                        />
                        <button type="button" aria-label="Toggle password visibility" className="absolute right-3 top-2.5 text-slate-400" onClick={() => setShowSecrets({ ...showSecrets, email_smtp_password: !showSecrets.email_smtp_password })}>
                          {showSecrets.email_smtp_password ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

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
              <div className="grid gap-3 border-t pt-5 sm:grid-cols-3">
                <Button type="button" variant="outline" onClick={() => handleEmailAction('connection')} disabled={saving || emailAction !== null}>
                  {emailAction === 'connection' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
                  Test Connection
                </Button>
                <Button type="button" variant="outline" onClick={() => handleSaveProvider('email')} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Configuration
                </Button>
                <Button type="button" className="bg-violet-600 hover:bg-violet-700" onClick={handleActivateEmailProvider} disabled={saving}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Set as Active Provider
                </Button>
                {emailConfig.last_test_status && (
                  <div className="sm:col-span-3">
                    <Badge className={emailConfig.last_test_status === 'success' ? 'bg-emerald-600' : 'bg-red-600'}>
                      {emailConfig.last_test_status === 'success' ? 'Last connection test passed' : `Last test failed${emailConfig.last_test_error ? `: ${emailConfig.last_test_error}` : ''}`}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Setup Guide */}
              {emailConfig.provider_name !== 'smtp' && <Card className="bg-blue-50 border-blue-200">
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
              </Card>}
            </>
          )}
        </CardContent>
      </Card>
      <aside className="space-y-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><img src={`${NOTIFICATION_ICON_BASE}/domain-dns-status.svg`} alt="Domain and DNS status icon" className="h-6 w-6 object-contain" />Domain &amp; DNS Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ['MX Record', 'Valid'],
              ['SPF Record', 'Valid'],
              ['DKIM Record', 'Valid'],
              ['DMARC Record', 'Pending'],
              ['PTR / Reverse DNS', 'Valid']
            ].map(([label, status]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-1.5 font-medium text-slate-700">{label}<HelpCircle className="h-3.5 w-3.5 text-slate-400" /></span>
                <Badge variant="outline" className={status === 'Valid' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>
                  <img src={STATUS_ICONS[status]} alt={`${status} status`} className="mr-1 h-3.5 w-3.5 object-contain" />
                  {status}
                </Badge>
              </div>
            ))}
            <p className="rounded-lg bg-emerald-50 p-2 text-xs leading-4 text-emerald-800">PTR and the main SMTP host point to <span className="font-semibold">mail.getouch.co</span>. Sender addresses may use <span className="font-semibold">serapod2u.com</span> because Mailcow supports multiple domains.</p>
            <p className="rounded-lg bg-slate-50 p-2 text-xs leading-4 text-slate-500">Status values are placeholders until DNS verification is connected.</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><img src={`${NOTIFICATION_ICON_BASE}/test-email.svg`} alt="Test email icon" className="h-6 w-6 object-contain" />Test Email</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email-test-recipient">Send test to</Label>
              <Input id="email-test-recipient" type="email" placeholder="name@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
            </div>
            <Button type="button" variant="outline" className="w-full border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => handleEmailAction('test-email')} disabled={emailAction !== null}>
              {emailAction === 'test-email' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Test Email
            </Button>
            <p className="text-xs leading-5 text-slate-500">Use this to verify inbox delivery before enabling for OTP and notifications.</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><img src={`${NOTIFICATION_ICON_BASE}/email-usage.svg`} alt="Email usage icon" className="h-6 w-6 object-contain" />Email Usage</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {['OTP / Registration', 'Password Reset', 'System Notifications', 'WhatsApp Fallback'].map((usage) => (
              <div key={usage} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-600"><Check className="h-3 w-3 text-white" /></span>
                {usage}
              </div>
            ))}
          </CardContent>
        </Card>
      </aside>
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

  const whatsappProviderLabel = WHATSAPP_PROVIDER_LABELS[whatsappConfig?.provider_name || ''] || 'Meta Official API'
  const isMetaSetupIncomplete = whatsappConfig?.provider_name === 'whatsapp_business' && !(
    whatsappConfig.config_public?.phone_number_id &&
    whatsappConfig.config_public?.waba_id &&
    sensitiveData.whatsapp.access_token
  )
  const whatsappStatus = whatsappConfig?.last_test_status === 'failed'
    ? 'Error'
    : whatsappConfig?.is_active
      ? 'Active'
      : isMetaSetupIncomplete ? 'Setup incomplete' : 'Configured'
  const emailStatus = emailConfig?.last_test_status === 'failed'
    ? 'Error'
    : emailConfig?.is_active ? 'Active' : 'Setup incomplete'

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

      <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3 text-sm text-slate-700">
        <Info className="h-4 w-4 shrink-0 text-violet-600" />
        Official WhatsApp API uses Meta Cloud API configuration. Baileys providers keep their linked-device QR flow.
      </div>

      {/* Provider Tabs */}
      <Tabs value={selectedChannel} onValueChange={handleChannelChange} className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-3 bg-transparent p-0 md:grid-cols-3">
          <TabsTrigger value="whatsapp" className="flex min-h-20 items-center justify-start gap-3 rounded-xl border border-slate-200 bg-white px-5 text-left shadow-sm data-[state=active]:border-violet-500 data-[state=active]:ring-2 data-[state=active]:ring-violet-100">
            <img src={`${NOTIFICATION_ICON_BASE}/channel-whatsapp.svg`} alt="WhatsApp channel icon" className="h-9 w-9 object-contain" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">WhatsApp</span>
              <span className="block truncate text-xs font-normal text-slate-500">Provider: {whatsappProviderLabel}</span>
              <span className="mt-1 block text-[11px] font-semibold text-violet-600">{isMetaSetupIncomplete ? 'Continue Setup' : 'Manage'}</span>
            </span>
            <Badge className={`ml-2 h-5 shrink-0 px-1.5 ${whatsappStatus === 'Active' ? 'bg-green-600' : whatsappStatus === 'Error' ? 'bg-red-600' : 'bg-amber-500'}`}>{whatsappStatus}</Badge>
          </TabsTrigger>
          <TabsTrigger value="sms" className="flex min-h-20 items-center justify-start gap-3 rounded-xl border border-slate-200 bg-white px-5 text-left shadow-sm data-[state=active]:border-violet-500 data-[state=active]:ring-2 data-[state=active]:ring-violet-100">
            <img src={`${NOTIFICATION_ICON_BASE}/channel-sms.svg`} alt="SMS channel icon" className="h-9 w-9 object-contain" />
            <span className="min-w-0 flex-1"><span className="block font-semibold">SMS</span><span className="block text-xs font-normal text-slate-500">Provider: {smsConfig?.provider_name || 'Not configured'}</span><span className="mt-1 block text-[11px] font-semibold text-violet-600">Manage</span></span>
            {smsConfig?.is_active && <Badge className="ml-2 h-5 px-1.5 bg-green-600">Active</Badge>}
          </TabsTrigger>
          <TabsTrigger value="email" className="flex min-h-20 items-center justify-start gap-3 rounded-xl border border-slate-200 bg-white px-5 text-left shadow-sm data-[state=active]:border-violet-500 data-[state=active]:ring-2 data-[state=active]:ring-violet-100">
            <img src={`${NOTIFICATION_ICON_BASE}/channel-email.svg`} alt="Email channel icon" className="h-9 w-9 object-contain" />
            <span className="min-w-0 flex-1"><span className="block font-semibold">Email</span><span className="block text-xs font-normal text-slate-500">Provider: {emailConfig?.provider_name?.toUpperCase() || 'Not configured'}</span><span className="mt-1 block text-[11px] font-semibold text-violet-600">Manage</span></span>
            <Badge className={`ml-2 h-5 shrink-0 px-1.5 ${emailStatus === 'Active' ? 'bg-green-600' : emailStatus === 'Error' ? 'bg-red-600' : 'bg-amber-500'}`}>{emailStatus}</Badge>
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
