'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs as TabsComponent, TabsList as TabsList2, TabsTrigger as TabsTrigger2, TabsContent as TabsContent2 } from '@/components/ui/tabs'
import NotificationFlowDrawer from './NotificationFlowDrawer'
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
  AlertCircle,
  Settings,
  Users,
  MessageSquare,
  Info
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
  templates?: Record<string, string>
  recipient_config?: {
    type?: string
    roles?: string[]
    recipient_users?: string[]
    custom_emails?: string
    custom_phones?: string
    dynamic_target?: string // e.g. 'manufacturer', 'distributor'
    include_consumer?: boolean
    recipient_targets?: {
      roles?: boolean
      dynamic_org?: boolean
      users?: boolean
      consumer?: boolean
    }
  }
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
  const [activeCategory, setActiveCategory] = useState('configuration')
  const [editingSetting, setEditingSetting] = useState<string | null>(null)

  useEffect(() => {
    if (isReady) {
      loadNotificationTypes()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
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
          priority: 'normal',
          templates: {},
          recipient_config: {
            type: 'roles',
            roles: ['super_admin'],
            include_consumer: true
          }
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
          priority: setting.priority || 'normal',
          templates: setting.templates || {},
          recipient_config: setting.recipient_config || {
            type: 'roles',
            roles: setting.recipient_roles || [], // Fallback for migration
            include_consumer: true
          }
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

  const toggleAllInCategory = (category: string, enabled: boolean) => {
    const newSettings = new Map(settings)
    const categoryTypes = notificationTypes.filter(t => t.category === category)
    
    categoryTypes.forEach(type => {
      const setting = newSettings.get(type.event_code)
      if (setting) {
        setting.enabled = enabled
        if (enabled) {
          // Enable all available channels
          setting.channels_enabled = type.available_channels
        } else {
          // Clear all channels
          setting.channels_enabled = []
        }
        newSettings.set(type.event_code, setting)
      }
    })
    
    setSettings(newSettings)
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
          recipient_roles: setting.recipient_config?.roles || null,
          recipient_users: null,
          recipient_custom: setting.recipient_config?.custom_emails ? [setting.recipient_config.custom_emails] : null,
          template_code: null, // We use templates jsonb now
          templates: setting.templates,
          recipient_config: setting.recipient_config,
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

  // Helper function to render category content
  const renderCategoryContent = (category: string) => {
    const types = notificationTypes.filter(t => t.category === category)
    const categorySettings = types.map(t => settings.get(t.event_code)).filter(Boolean)
    const allEnabled = categorySettings.every(s => s?.enabled)
    
    return (
      <Card className={`border-l-4 ${getCategoryColor(category)}`}>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 sm:items-center">
              {getCategoryIcon(category)}
              <div>
                <CardTitle className="text-lg">
                  {categoryLabels[category] || category.toUpperCase()}
                </CardTitle>
                <CardDescription className="mt-1">
                  Configure which {category} events trigger notifications
                </CardDescription>
              </div>
            </div>
            
            {/* Bulk Action Buttons */}
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-nowrap sm:items-center">
              <Button
                type="button"
                variant={allEnabled ? "secondary" : "outline"}
                size="sm"
                onClick={() => toggleAllInCategory(category, true)}
                className="flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Enable All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => toggleAllInCategory(category, false)}
                className="flex items-center justify-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                Disable All
              </Button>
            </div>
          </div>
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

                {/* Actions and Status */}
                <div className="flex flex-col items-end gap-2">
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

                  {setting.enabled && (
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 h-8"
                        onClick={() => setEditingSetting(type.event_code)}
                    >
                        <Settings className="w-3 h-3 mr-1.5" />
                        Configure
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    )
  }

  // Configuration Dialog
  const renderConfigDialog = () => {
    if (!editingSetting) return null
    
    // Create a local copy of settings to edit
    const currentCode = editingSetting
    const currentSetting = settings.get(currentCode)
    const currentType = notificationTypes.find(t => t.event_code === currentCode)

    if (!currentSetting || !currentType) return null

    return (
        <NotificationFlowDrawer
            open={!!editingSetting}
            onOpenChange={(open) => !open && setEditingSetting(null)}
            setting={currentSetting}
            type={currentType}
            onSave={(updatedSetting) => {
                const newSettings = new Map(settings)
                newSettings.set(currentCode, updatedSetting)
                setSettings(newSettings)
            }}
        />
    )
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
              className="flex w-full items-center justify-center gap-2 sm:w-auto"
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

      {/* Category Tabs */}
      <TabsComponent value={activeCategory} onValueChange={setActiveCategory} className="w-full">
        <TabsList2 className="grid w-full grid-cols-2 lg:grid-cols-5">
          <TabsTrigger2 value="configuration">Configuration</TabsTrigger2>
          <TabsTrigger2 value="order">Order Status Changes</TabsTrigger2>
          <TabsTrigger2 value="inventory">Inventory & Stock Alerts</TabsTrigger2>
          <TabsTrigger2 value="qr">QR Code & Consumer</TabsTrigger2>
          <TabsTrigger2 value="user">User Account Activities</TabsTrigger2>
        </TabsList2>

        {/* Configuration Tab - Summary View */}
        <TabsContent2 value="configuration" className="mt-6 space-y-6">
          {/* Summary Card */}
          <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <CardHeader>
              <CardTitle className="text-lg">Configuration Summary</CardTitle>
              <CardDescription>Overview of all notification event configurations</CardDescription>
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

          {/* All Categories Overview */}
          <div className="grid gap-4">
            {Object.entries({
              order: 'Order Status Changes',
              inventory: 'Inventory & Stock Alerts',
              qr: 'QR Code & Consumer Activities',
              user: 'User Account Activities'
            }).map(([categoryKey, categoryName]) => {
              const types = notificationTypes.filter(t => t.category === categoryKey)
              const categorySettings = types.map(t => settings.get(t.event_code)).filter(Boolean)
              const enabledCount = categorySettings.filter(s => s?.enabled).length
              
              return (
                <Card key={categoryKey} className={`border-l-4 ${getCategoryColor(categoryKey)}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getCategoryIcon(categoryKey)}
                        <div>
                          <CardTitle className="text-base">{categoryName}</CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {enabledCount} of {types.length} events enabled
                          </CardDescription>
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-gray-400">{enabledCount}/{types.length}</div>
                    </div>
                  </CardHeader>
                </Card>
              )
            })}
          </div>
        </TabsContent2>

        {/* Order Status Changes Tab */}
        <TabsContent2 value="order" className="mt-6">
          {renderCategoryContent('order')}
        </TabsContent2>

        {/* Inventory & Stock Alerts Tab */}
        <TabsContent2 value="inventory" className="mt-6">
          {renderCategoryContent('inventory')}
        </TabsContent2>

        {/* QR Code & Consumer Activities Tab */}
        <TabsContent2 value="qr" className="mt-6">
          {renderCategoryContent('qr')}
        </TabsContent2>

        {/* User Account Activities Tab */}
        <TabsContent2 value="user" className="mt-6">
          {renderCategoryContent('user')}
        </TabsContent2>
      </TabsComponent>
      
      {renderConfigDialog()}
    </div>
  )




}