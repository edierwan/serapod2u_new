'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  Save, 
  Bell, 
  ShoppingCart, 
  FileText, 
  Package, 
  QrCode, 
  UserCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react'

interface NotificationType {
  id: string
  category: string
  event_code: string
  event_name: string
  event_description: string
  default_enabled: boolean
  available_channels: string[]
  is_system: boolean
}

interface NotificationSetting {
  id?: string
  org_id: string
  event_code: string
  enabled: boolean
  channels_enabled: string[]
  priority: 'low' | 'normal' | 'high' | 'critical'
}

interface NotificationTypesTabProps {
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

export default function NotificationTypesTab({ userProfile }: NotificationTypesTabProps) {
  const { supabase, isReady } = useSupabaseAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notificationTypes, setNotificationTypes] = useState<NotificationType[]>([])
  const [settings, setSettings] = useState<Map<string, NotificationSetting>>(new Map())
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    if (isReady) {
      loadNotificationTypes()
    }
  }, [isReady])

  const loadNotificationTypes = async () => {
    if (!isReady) return

    try {
      setLoading(true)

      // Load all notification types
      const { data: types, error: typesError } = await supabase
        .from('notification_types')
        .select('*')
        .order('category, event_name')

      if (typesError) throw typesError

      setNotificationTypes(types || [])

      // Load existing settings for this org
      const { data: existingSettings, error: settingsError } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('org_id', userProfile.organizations.id)

      if (settingsError) throw settingsError

      // Create settings map
      const settingsMap = new Map<string, NotificationSetting>()
      
      // Initialize with defaults from types
      types?.forEach((type: NotificationType) => {
        settingsMap.set(type.event_code, {
          org_id: userProfile.organizations.id,
          event_code: type.event_code,
          enabled: type.default_enabled,
          channels_enabled: type.default_enabled ? type.available_channels : [],
          priority: 'normal'
        })
      })

      // Override with existing settings
      existingSettings?.forEach((setting: any) => {
        settingsMap.set(setting.event_code, {
          id: setting.id,
          org_id: setting.org_id,
          event_code: setting.event_code,
          enabled: setting.enabled,
          channels_enabled: setting.channels_enabled || [],
          priority: setting.priority || 'normal'
        })
      })

      setSettings(settingsMap)
    } catch (error) {
      console.error('Error loading notification types:', error)
      alert('Failed to load notification settings')
    } finally {
      setLoading(false)
    }
  }

  const toggleNotification = (eventCode: string, enabled: boolean) => {
    const newSettings = new Map(settings)
    const setting = newSettings.get(eventCode)
    if (setting) {
      setting.enabled = enabled
      // If disabling, clear channels
      if (!enabled) {
        setting.channels_enabled = []
      } else {
        // If enabling, use default channels from type
        const type = notificationTypes.find(t => t.event_code === eventCode)
        if (type) {
          setting.channels_enabled = type.available_channels
        }
      }
      newSettings.set(eventCode, setting)
      setSettings(newSettings)
    }
  }

  const toggleChannel = (eventCode: string, channel: string, enabled: boolean) => {
    const newSettings = new Map(settings)
    const setting = newSettings.get(eventCode)
    if (setting) {
      if (enabled) {
        setting.channels_enabled = [...setting.channels_enabled, channel]
      } else {
        setting.channels_enabled = setting.channels_enabled.filter(c => c !== channel)
      }
      // Auto-enable notification if at least one channel is selected
      if (setting.channels_enabled.length > 0) {
        setting.enabled = true
      }
      newSettings.set(eventCode, setting)
      setSettings(newSettings)
    }
  }

  const handleSaveSettings = async () => {
    if (!isReady) return

    try {
      setSaving(true)
      setSaveStatus('idle')

      // Prepare settings for upsert
      const settingsArray = Array.from(settings.values()).map(setting => {
        const record: any = {
          org_id: setting.org_id,
          event_code: setting.event_code,
          enabled: setting.enabled,
          channels_enabled: setting.channels_enabled,
          priority: setting.priority,
          recipient_roles: null,
          recipient_users: null,
          recipient_custom: null,
          template_code: null,
          retry_enabled: true,
          max_retries: 3
        }
        
        // Only include id if it exists (for updates)
        if (setting.id) {
          record.id = setting.id
        }
        
        return record
      })

      // Upsert all settings
      const { error } = await (supabase as any)
        .from('notification_settings')
        .upsert(settingsArray, {
          onConflict: 'org_id,event_code'
        })

      if (error) throw error

      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 3000)
      
      // Reload settings to get the new IDs
      await loadNotificationTypes()
    } catch (error: any) {
      console.error('Error saving notification settings:', error)
      setSaveStatus('error')
      alert(`Failed to save settings: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'order': return <ShoppingCart className="w-5 h-5 text-blue-600" />
      case 'document': return <FileText className="w-5 h-5 text-purple-600" />
      case 'inventory': return <Package className="w-5 h-5 text-orange-600" />
      case 'qr': return <QrCode className="w-5 h-5 text-green-600" />
      case 'user': return <UserCheck className="w-5 h-5 text-indigo-600" />
      default: return <Bell className="w-5 h-5 text-gray-600" />
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'order': return 'bg-blue-50 border-blue-200'
      case 'document': return 'bg-purple-50 border-purple-200'
      case 'inventory': return 'bg-orange-50 border-orange-200'
      case 'qr': return 'bg-green-50 border-green-200'
      case 'user': return 'bg-indigo-50 border-indigo-200'
      default: return 'bg-gray-50 border-gray-200'
    }
  }

  // Group notifications by category
  const groupedNotifications = notificationTypes.reduce((acc, type) => {
    if (!acc[type.category]) {
      acc[type.category] = []
    }
    acc[type.category].push(type)
    return acc
  }, {} as Record<string, NotificationType[]>)

  const categoryLabels: Record<string, string> = {
    order: 'Order Status Changes',
    document: 'Document Workflow',
    inventory: 'Inventory & Stock Alerts',
    qr: 'QR Code & Consumer Activities',
    user: 'User Account Activities'
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-600">Loading notification settings...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notification Types Configuration
              </CardTitle>
              <CardDescription className="mt-2">
                Choose which events should trigger notifications and select the delivery channels for each type
              </CardDescription>
            </div>
            <Button 
              onClick={handleSaveSettings} 
              disabled={saving}
              className="flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save All Settings
                </>
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Save Status */}
      {saveStatus === 'success' && (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium">Settings saved successfully!</span>
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          <XCircle className="w-5 h-5" />
          <span className="font-medium">Failed to save settings. Please try again.</span>
        </div>
      )}

      {/* Notification Type Groups */}
      {Object.entries(groupedNotifications).map(([category, types]) => (
        <Card key={category} className={`border-l-4 ${getCategoryColor(category)}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-lg">
              {getCategoryIcon(category)}
              {categoryLabels[category] || category.toUpperCase()}
            </CardTitle>
            <CardDescription>
              Configure which {category} events trigger notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {types.map((type) => {
              const setting = settings.get(type.event_code)
              if (!setting) return null

              return (
                <div 
                  key={type.event_code}
                  className="flex items-start gap-4 p-4 rounded-lg border bg-white hover:bg-gray-50 transition-colors"
                >
                  {/* Enable/Disable Switch */}
                  <div className="flex items-center pt-1">
                    <Switch
                      checked={setting.enabled}
                      onCheckedChange={(checked) => toggleNotification(type.event_code, checked)}
                      disabled={type.is_system}
                    />
                  </div>

                  {/* Notification Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Label className="text-base font-medium text-gray-900">
                        {type.event_name}
                      </Label>
                      {type.is_system && (
                        <Badge variant="secondary" className="text-xs">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          System
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-3">
                      {type.event_description}
                    </p>

                    {/* Channel Selection */}
                    {setting.enabled && (
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-sm font-medium text-gray-700">Channels:</span>
                        {type.available_channels.map((channel) => (
                          <label 
                            key={channel}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <Checkbox
                              checked={setting.channels_enabled.includes(channel)}
                              onCheckedChange={(checked) => 
                                toggleChannel(type.event_code, channel, checked as boolean)
                              }
                            />
                            <span className="text-sm capitalize">{channel}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Status Indicator */}
                  <div className="flex-shrink-0">
                    {setting.enabled ? (
                      <Badge className="bg-green-100 text-green-800 border-green-200">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-gray-600">
                        Disabled
                      </Badge>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}

      {/* Summary Card */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-lg">Configuration Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-white rounded-lg border">
              <div className="text-2xl font-bold text-blue-600">
                {Array.from(settings.values()).filter(s => s.enabled).length}
              </div>
              <div className="text-sm text-gray-600">Enabled Events</div>
            </div>
            <div className="text-center p-3 bg-white rounded-lg border">
              <div className="text-2xl font-bold text-green-600">
                {Array.from(settings.values()).filter(s => 
                  s.channels_enabled.includes('whatsapp')
                ).length}
              </div>
              <div className="text-sm text-gray-600">WhatsApp</div>
            </div>
            <div className="text-center p-3 bg-white rounded-lg border">
              <div className="text-2xl font-bold text-purple-600">
                {Array.from(settings.values()).filter(s => 
                  s.channels_enabled.includes('sms')
                ).length}
              </div>
              <div className="text-sm text-gray-600">SMS</div>
            </div>
            <div className="text-center p-3 bg-white rounded-lg border">
              <div className="text-2xl font-bold text-orange-600">
                {Array.from(settings.values()).filter(s => 
                  s.channels_enabled.includes('email')
                ).length}
              </div>
              <div className="text-sm text-gray-600">Email</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
