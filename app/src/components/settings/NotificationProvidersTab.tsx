'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Shield
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
    { value: 'messagebird', label: 'MessageBird', description: 'MessageBird Programmable Conversations' }
  ],
  sms: [
    { value: 'twilio', label: 'Twilio SMS', description: 'Twilio Programmable SMS' },
    { value: 'aws_sns', label: 'AWS SNS', description: 'Amazon Simple Notification Service' },
    { value: 'vonage', label: 'Vonage', description: 'Vonage SMS API (formerly Nexmo)' },
    { value: 'local_my', label: 'Local Malaysian Provider', description: 'Malaysian SMS gateway' }
  ],
  email: [
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

  // Form states for sensitive data (not stored in state)
  const [sensitiveData, setSensitiveData] = useState<Record<string, Record<string, string>>>({
    whatsapp: {},
    sms: {},
    email: {}
  })

  useEffect(() => {
    if (isReady) {
      loadProviderConfigs()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

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

      const { error } = await (supabase as any)
        .from('notification_provider_configs')
        .upsert(saveData, {
          onConflict: 'org_id,channel,provider_name'
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

      // In a real implementation, this would call an API endpoint to test the provider
      // For now, we'll just simulate a test
      alert(`Testing ${channel} provider: ${config.provider_name}...\n\nThis would normally send a test message to verify the configuration.\n\nIn production, implement:\n- API route: /api/notifications/test\n- Send test message using provider credentials\n- Return success/failure status`)

      // Update config with test result
      const updatedConfig = {
        ...config,
        last_test_status: 'pending',
        last_test_at: new Date().toISOString()
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

      // TODO: Implement actual API call to test provider
      // const response = await fetch('/api/notifications/test', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     channel,
      //     provider: config.provider_name,
      //     credentials: sensitiveData[channel],
      //     config: config.config_public
      //   })
      // })

    } catch (error: any) {
      console.error(`Error testing ${channel} provider:`, error)
      alert(`Test failed: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const renderWhatsAppConfig = () => (
    <div className="space-y-6">
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
                <div className={`p-4 rounded-lg border ${
                  whatsappConfig.last_test_status === 'success' 
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
                <Button 
                  variant="outline"
                  onClick={() => {/* Implement test function */}}
                  disabled={!whatsappConfig.is_active}
                >
                  <TestTube className="w-4 h-4 mr-2" />
                  Send Test Message
                </Button>
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
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">To configure WhatsApp with Twilio:</p>
          <ol className="list-decimal list-inside space-y-1 text-gray-700">
            <li>Sign up for a Twilio account at <a href="https://www.twilio.com" target="_blank" rel="noopener" className="text-blue-600 underline">twilio.com</a></li>
            <li>Enable WhatsApp in your Twilio console</li>
            <li>Request a WhatsApp-enabled phone number or use the sandbox</li>
            <li>Copy your Account SID and Auth Token from the dashboard</li>
            <li>Enter the credentials above and test the configuration</li>
          </ol>
        </CardContent>
      </Card>
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
