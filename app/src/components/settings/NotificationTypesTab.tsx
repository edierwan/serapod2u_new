'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import NotificationFlowDrawer from './NotificationFlowDrawer'
import { DEFAULT_NOTIFICATION_ADMIN_ROLE } from '@/lib/notifications/recipientRoleCodes'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Package,
  QrCode,
  Save,
  Settings,
  ShoppingCart,
  UserCheck,
  XCircle,
} from 'lucide-react'

type Channel = 'whatsapp' | 'email' | 'sms'
type RoutingPreset = 'whatsapp_only' | 'email_only' | 'sms_only' | 'whatsapp_email_fallback'
type RoutingSource = 'default' | 'category' | 'event'

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

interface RoutingMetadata {
  preset?: RoutingPreset
  source?: RoutingSource
  default_preset?: RoutingPreset
  category_preset?: RoutingPreset | null
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
    manual_whatsapp_numbers?: string[]
    dynamic_target?: string
    include_consumer?: boolean
    recipient_targets?: {
      roles?: boolean
      dynamic_org?: boolean
      users?: boolean
      consumer?: boolean
    }
    routing?: RoutingMetadata
  }
}

interface NotificationTypesTabProps {
  userProfile: {
    id: string
    organization_id: string
    organizations: { id: string; org_type_code: string }
    roles: { role_level: number }
  }
}

const DEFAULT_PRESET: RoutingPreset = 'whatsapp_email_fallback'
const DEFAULT_RECIPIENT_TARGETS = { roles: true, dynamic_org: false, users: false, consumer: false }

const PRESETS: Array<{
  id: RoutingPreset
  title: string
  description: string
  required: Channel[]
}> = [
  { id: 'whatsapp_only', title: 'WhatsApp Only', description: 'Send all notifications via WhatsApp.', required: ['whatsapp'] },
  { id: 'email_only', title: 'Email Only', description: 'Send all notifications via Email.', required: ['email'] },
  { id: 'sms_only', title: 'SMS Only', description: 'Send all notifications via SMS.', required: ['sms'] },
  { id: 'whatsapp_email_fallback', title: 'WhatsApp → Email', description: 'Try WhatsApp first, then Email only if it fails.', required: ['whatsapp', 'email'] },
]

const CATEGORY_LABELS: Record<string, string> = {
  order: 'Order Status',
  document: 'Order Document',
  inventory: 'Inventory & Stock',
  qr: 'QR & Consumer',
  user: 'User Account',
}
const CATEGORY_ORDER = ['order', 'document', 'inventory', 'qr', 'user']

function normalizeRecipientConfig(
  recipientConfig: NotificationSetting['recipient_config'] | null | undefined,
  fallbackRoles: string[] = [DEFAULT_NOTIFICATION_ADMIN_ROLE]
): NonNullable<NotificationSetting['recipient_config']> {
  const raw = recipientConfig && typeof recipientConfig === 'object' ? recipientConfig : {}
  const roles = Array.isArray(raw.roles) && raw.roles.length ? raw.roles : fallbackRoles
  const hasSources = Boolean(
    raw.recipient_targets || raw.manual_whatsapp_numbers?.length || raw.recipient_users?.length ||
    String(raw.custom_emails || '').trim() || String(raw.custom_phones || '').trim() || raw.dynamic_target
  )
  return {
    type: raw.type || 'roles',
    include_consumer: raw.include_consumer ?? true,
    ...raw,
    roles,
    recipient_targets: raw.recipient_targets || (hasSources
      ? { roles: false, dynamic_org: false, users: false, consumer: false }
      : DEFAULT_RECIPIENT_TARGETS),
  }
}

function presetFromChannels(channels: string[]): RoutingPreset {
  if (channels.includes('whatsapp') && channels.includes('email')) return 'whatsapp_email_fallback'
  if (channels.includes('email')) return 'email_only'
  if (channels.includes('sms')) return 'sms_only'
  return 'whatsapp_only'
}

function channelsForPreset(preset: RoutingPreset): string[] {
  // Fallback queues WhatsApp only. The worker queues Email only after a failed WhatsApp attempt.
  if (preset === 'email_only') return ['email']
  if (preset === 'sms_only') return ['sms']
  return ['whatsapp']
}

function PresetIcon({ preset, className = 'h-7 w-7' }: { preset: RoutingPreset; className?: string }) {
  if (preset === 'email_only') return <Mail className={`${className} text-violet-600`} />
  if (preset === 'sms_only') return <MessageSquare className={`${className} text-orange-500`} />
  if (preset === 'whatsapp_email_fallback') {
    return <div className="flex items-center gap-2"><MessageCircle className={`${className} text-emerald-600`} /><ArrowRight className="h-5 w-5 text-violet-600" /><Mail className={`${className} text-violet-600`} /></div>
  }
  return <MessageCircle className={`${className} text-emerald-600`} />
}

function CategoryIcon({ category }: { category: string }) {
  const classes = 'h-5 w-5'
  if (category === 'order') return <ShoppingCart className={`${classes} text-blue-600`} />
  if (category === 'document') return <FileText className={`${classes} text-violet-600`} />
  if (category === 'inventory') return <Package className={`${classes} text-orange-500`} />
  if (category === 'qr') return <QrCode className={`${classes} text-emerald-600`} />
  return <UserCheck className={`${classes} text-indigo-600`} />
}

export default function NotificationTypesTab({ userProfile }: NotificationTypesTabProps) {
  const { supabase, isReady } = useSupabaseAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notificationTypes, setNotificationTypes] = useState<NotificationType[]>([])
  const [settings, setSettings] = useState<Map<string, NotificationSetting>>(new Map())
  const [providerStatus, setProviderStatus] = useState<Record<Channel, boolean>>({ whatsapp: false, email: false, sms: false })
  const [defaultPreset, setDefaultPreset] = useState<RoutingPreset>(DEFAULT_PRESET)
  const [categoryPresets, setCategoryPresets] = useState<Record<string, RoutingPreset | null>>({})
  const [eventPresets, setEventPresets] = useState<Record<string, RoutingPreset | null>>({})
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({ order: true })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [editingSetting, setEditingSetting] = useState<string | null>(null)

  useEffect(() => {
    if (isReady) void loadNotificationTypes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  const loadNotificationTypes = async () => {
    if (!isReady) return
    try {
      setLoading(true)
      const [{ data: types, error: typesError }, { data: existingSettings, error: settingsError }, { data: providers, error: providerError }] = await Promise.all([
        supabase.from('notification_types').select('*').order('category').order('sort_order', { ascending: true, nullsFirst: false }).order('event_name'),
        supabase.from('notification_settings').select('*').eq('org_id', userProfile.organizations.id),
        supabase.from('notification_provider_configs').select('channel,is_active').eq('org_id', userProfile.organizations.id),
      ])
      if (typesError) throw typesError
      if (settingsError) throw settingsError
      if (providerError) throw providerError

      const loadedTypes = (types || []) as NotificationType[]
      const settingsMap = new Map<string, NotificationSetting>()
      loadedTypes.forEach((type) => settingsMap.set(type.event_code, {
        org_id: userProfile.organizations.id,
        event_code: type.event_code,
        enabled: type.default_enabled,
        channels_enabled: type.default_enabled ? channelsForPreset(DEFAULT_PRESET) : [],
        priority: 'normal',
        templates: {},
        recipient_config: normalizeRecipientConfig(undefined),
      }))

      let loadedDefault = DEFAULT_PRESET
      const loadedCategories: Record<string, RoutingPreset | null> = {}
      const loadedEvents: Record<string, RoutingPreset | null> = {}
      ;(existingSettings || []).forEach((row: any) => {
        const matchingType = loadedTypes.find((type) => type.event_code === row.event_code)
        if (!matchingType) return
        const recipientConfig = normalizeRecipientConfig(row.recipient_config, row.recipient_roles?.length ? row.recipient_roles : undefined)
        const routing = recipientConfig.routing
        const legacyPreset = presetFromChannels(row.channels_enabled || [])
        if (routing?.default_preset) loadedDefault = routing.default_preset
        if (routing?.category_preset !== undefined && loadedCategories[matchingType.category] === undefined) {
          loadedCategories[matchingType.category] = routing.category_preset
        }
        loadedEvents[row.event_code] = routing?.source === 'event' ? (routing.preset || legacyPreset) : routing ? null : legacyPreset
        settingsMap.set(row.event_code, {
          id: row.id,
          org_id: row.org_id,
          event_code: row.event_code,
          enabled: Boolean(row.enabled),
          channels_enabled: row.channels_enabled || [],
          priority: row.priority || 'normal',
          templates: row.templates || {},
          recipient_config: recipientConfig,
        })
      })

      setNotificationTypes(loadedTypes)
      setSettings(settingsMap)
      setDefaultPreset(loadedDefault)
      setCategoryPresets(loadedCategories)
      setEventPresets(loadedEvents)
      setProviderStatus({
        whatsapp: Boolean(providers?.some((p: any) => p.channel === 'whatsapp' && p.is_active)),
        email: Boolean(providers?.some((p: any) => p.channel === 'email' && p.is_active)),
        sms: Boolean(providers?.some((p: any) => p.channel === 'sms' && p.is_active)),
      })
    } catch (error) {
      console.error('Error loading notification routing:', error)
      setSaveStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const grouped = useMemo(() => notificationTypes.reduce<Record<string, NotificationType[]>>((acc, type) => {
    ;(acc[type.category] ||= []).push(type)
    return acc
  }, {}), [notificationTypes])

  const effectivePreset = (type: NotificationType) => eventPresets[type.event_code] || categoryPresets[type.category] || defaultPreset
  const presetAvailable = (preset: RoutingPreset) => PRESETS.find((item) => item.id === preset)!.required.every((channel) => providerStatus[channel])

  const toggleNotification = (eventCode: string, enabled: boolean) => {
    const next = new Map(settings)
    const setting = next.get(eventCode)
    const type = notificationTypes.find((item) => item.event_code === eventCode)
    if (!setting || !type) return
    next.set(eventCode, { ...setting, enabled, channels_enabled: enabled ? channelsForPreset(effectivePreset(type)) : [] })
    setSettings(next)
  }

  const buildSettingRecord = (setting: NotificationSetting) => {
    const type = notificationTypes.find((item) => item.event_code === setting.event_code)!
    const eventPreset = eventPresets[setting.event_code]
    const categoryPreset = categoryPresets[type.category] || null
    const preset = eventPreset || categoryPreset || defaultPreset
    const source: RoutingSource = eventPreset ? 'event' : categoryPreset ? 'category' : 'default'
    const recipientConfig = normalizeRecipientConfig(setting.recipient_config)
    return {
      id: setting.id || crypto.randomUUID(),
      org_id: setting.org_id,
      event_code: setting.event_code,
      enabled: setting.enabled,
      channels_enabled: setting.enabled ? channelsForPreset(preset) : [],
      priority: setting.priority,
      recipient_roles: recipientConfig.roles || null,
      recipient_users: null,
      recipient_custom: recipientConfig.custom_emails ? [recipientConfig.custom_emails] : null,
      template_code: null,
      templates: setting.templates,
      recipient_config: {
        ...recipientConfig,
        routing: { preset, source, default_preset: defaultPreset, category_preset: categoryPreset },
      },
      retry_enabled: true,
      max_retries: 3,
    }
  }

  const handleSaveSettings = async () => {
    if (!isReady) return
    try {
      setSaving(true)
      setSaveStatus('idle')
      const records = Array.from(settings.values()).map(buildSettingRecord)
      const { data, error } = await (supabase as any).from('notification_settings').upsert(records, { onConflict: 'org_id,event_code' }).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Settings were not saved — check HQ Admin permissions')
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 3000)
      await loadNotificationTypes()
    } catch (error: any) {
      console.error('Error saving notification routing:', error)
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const saveSingleSetting = async (updated: NotificationSetting) => {
    const next = new Map(settings)
    next.set(updated.event_code, updated)
    setSettings(next)
    const { error } = await (supabase as any).from('notification_settings').upsert(buildSettingRecord(updated), { onConflict: 'org_id,event_code' })
    if (error) throw new Error(error.message)
    await loadNotificationTypes()
  }

  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center rounded-2xl border bg-white"><Loader2 className="h-7 w-7 animate-spin text-violet-600" /><span className="ml-3 text-slate-600">Loading notification routing…</span></div>
  }

  const selectedPreset = PRESETS.find((preset) => preset.id === defaultPreset)!

  return (
    <div className="space-y-5 pb-10">
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-violet-100 p-3"><Bell className="h-6 w-6 text-violet-600" /></div>
          <div><h1 className="text-2xl font-bold text-slate-950">Notification Types</h1><p className="mt-1 text-sm text-slate-500">Choose how each event should be delivered.</p></div>
        </div>
        <Button onClick={handleSaveSettings} disabled={saving} className="gap-2 bg-slate-950 hover:bg-slate-800">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Saving…' : 'Save Routing Settings'}
        </Button>
      </section>

      {saveStatus !== 'idle' && <div className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-medium ${saveStatus === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
        {saveStatus === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}{saveStatus === 'success' ? 'Routing settings saved.' : 'Unable to load or save routing settings.'}
      </div>}

      <section className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3">
        {(['whatsapp', 'email', 'sms'] as Channel[]).map((channel, index) => (
          <div key={channel} className={`flex items-center gap-3 px-5 py-4 ${index ? 'border-t sm:border-l sm:border-t-0' : ''}`}>
            {channel === 'whatsapp' ? <MessageCircle className="h-7 w-7 text-emerald-600" /> : channel === 'email' ? <Mail className="h-7 w-7 text-violet-600" /> : <MessageSquare className="h-7 w-7 text-orange-500" />}
            <span className="font-semibold capitalize text-slate-900">{channel === 'sms' ? 'SMS' : channel}</span>
            <Badge className={`ml-auto border-0 ${providerStatus[channel] ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50' : 'bg-slate-100 text-slate-500 hover:bg-slate-100'}`}>● {providerStatus[channel] ? 'Active' : 'Not configured'}</Badge>
          </div>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <main className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Default Delivery Method</h2>
            <p className="mt-1 text-sm text-slate-500">Used for every category and event unless it is overridden.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              {PRESETS.map((preset) => {
                const available = presetAvailable(preset.id)
                const selected = defaultPreset === preset.id
                return <button key={preset.id} type="button" disabled={!available && !selected} onClick={() => setDefaultPreset(preset.id)} className={`relative flex min-h-52 flex-col items-center justify-center rounded-xl border-2 p-4 text-center transition ${selected ? 'border-violet-500 bg-violet-50/70 shadow-sm' : 'border-slate-200 hover:border-violet-200'} ${!available && !selected ? 'cursor-not-allowed opacity-50' : ''}`}>
                  <PresetIcon preset={preset.id} />
                  <span className="mt-4 font-bold text-slate-950">{preset.title}</span>
                  <span className="mt-2 text-sm leading-5 text-slate-500">{preset.description}</span>
                  {preset.id === DEFAULT_PRESET && <Badge className="mt-3 border-0 bg-violet-100 text-violet-700 hover:bg-violet-100">Recommended</Badge>}
                  {!available && <span className="mt-2 text-xs font-medium text-amber-700">Provider not configured</span>}
                  <span className={`mt-auto h-5 w-5 rounded-full border-2 ${selected ? 'border-violet-600 bg-violet-600 ring-4 ring-violet-100' : 'border-slate-300'}`} />
                </button>
              })}
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-violet-50 px-4 py-3 text-sm text-slate-700">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
              <span>{selectedPreset.description}</span>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-950">Event Categories</h2>
            <p className="mt-1 text-sm text-slate-500">Use the default route or override a category and its individual events.</p>
            <div className="mt-3 space-y-2">
              {CATEGORY_ORDER.filter((category) => grouped[category]?.length).map((category) => {
                const types = grouped[category]
                const expanded = Boolean(expandedCategories[category])
                const categoryPreset = categoryPresets[category] || null
                return <div key={category} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setExpandedCategories((current) => ({ ...current, [category]: !expanded }))}>
                      <span className="rounded-lg bg-slate-50 p-2"><CategoryIcon category={category} /></span>
                      <span className="min-w-0"><span className="block font-semibold text-slate-900">{CATEGORY_LABELS[category] || category}</span><span className="block text-xs text-slate-500">{categoryPreset ? `Override: ${PRESETS.find((p) => p.id === categoryPreset)?.title}` : 'Uses default delivery method'} · {types.filter((type) => settings.get(type.event_code)?.enabled).length}/{types.length} enabled</span></span>
                    </button>
                    <select aria-label={`${CATEGORY_LABELS[category] || category} routing`} value={categoryPreset || 'default'} onChange={(event) => setCategoryPresets((current) => ({ ...current, [category]: event.target.value === 'default' ? null : event.target.value as RoutingPreset }))} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-violet-500">
                      <option value="default">Use default</option>{PRESETS.map((preset) => <option key={preset.id} value={preset.id} disabled={!presetAvailable(preset.id)}>{preset.title}{!presetAvailable(preset.id) ? ' (unavailable)' : ''}</option>)}
                    </select>
                    <button type="button" aria-label={expanded ? 'Collapse category' : 'Expand category'} onClick={() => setExpandedCategories((current) => ({ ...current, [category]: !expanded }))} className="hidden rounded-lg p-2 hover:bg-slate-50 sm:block">{expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}</button>
                  </div>
                  {expanded && <div className="border-t bg-slate-50/70 px-3 py-2">
                    {types.map((type) => {
                      const setting = settings.get(type.event_code)
                      if (!setting) return null
                      const eventPreset = eventPresets[type.event_code] || null
                      return <div key={type.event_code} className="my-2 grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-[auto_minmax(0,1fr)_210px_auto] sm:items-center">
                        <Switch checked={setting.enabled} onCheckedChange={(checked) => toggleNotification(type.event_code, checked)} aria-label={`Enable ${type.event_name}`} />
                        <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-medium text-slate-900">{type.event_name}</span>{type.is_system && <Badge variant="secondary" className="text-[10px]">System</Badge>}</div><p className="mt-0.5 truncate text-xs text-slate-500">{type.event_description}</p></div>
                        <select aria-label={`${type.event_name} routing`} disabled={!setting.enabled} value={eventPreset || 'inherit'} onChange={(event) => setEventPresets((current) => ({ ...current, [type.event_code]: event.target.value === 'inherit' ? null : event.target.value as RoutingPreset }))} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 disabled:bg-slate-100 disabled:text-slate-400">
                          <option value="inherit">Use {categoryPreset ? 'category' : 'default'}</option>{PRESETS.map((preset) => <option key={preset.id} value={preset.id} disabled={!presetAvailable(preset.id)}>{preset.title}</option>)}
                        </select>
                        <Button variant="ghost" size="sm" disabled={!setting.enabled} onClick={() => setEditingSetting(type.event_code)} className="gap-1 text-violet-700"><Settings className="h-4 w-4" /> Details</Button>
                      </div>
                    })}
                  </div>}
                </div>
              })}
            </div>
          </section>
        </main>

        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-4">
          <div className="flex items-center gap-2"><Info className="h-5 w-5 text-violet-600" /><h2 className="font-bold text-slate-950">Delivery Summary</h2></div>
          <div className="mt-6 space-y-5">
            <div className="flex gap-3"><PresetIcon preset={selectedPreset.id} className="h-6 w-6" /><div><p className="font-semibold text-slate-900">{selectedPreset.id === 'whatsapp_email_fallback' ? 'Primary: WhatsApp' : selectedPreset.title}</p><p className="text-xs text-slate-500">{selectedPreset.id === 'whatsapp_email_fallback' ? 'First attempt for default-routed events' : 'Default route for events'}</p></div></div>
            {defaultPreset === 'whatsapp_email_fallback' && <div className="flex gap-3"><Mail className="h-6 w-6 text-violet-600" /><div><p className="font-semibold text-slate-900">Fallback: Email</p><p className="text-xs text-slate-500">Only used when WhatsApp fails</p></div></div>}
            {(['whatsapp', 'email', 'sms'] as Channel[]).filter((channel) => !providerStatus[channel]).map((channel) => <div key={channel} className="flex gap-3"><AlertTriangle className="h-6 w-6 text-amber-500" /><div><p className="font-semibold capitalize text-slate-900">{channel === 'sms' ? 'SMS' : channel} unavailable</p><p className="text-xs text-slate-500">Configure a provider to enable</p></div></div>)}
          </div>
          <div className="mt-6 border-t pt-5 text-xs leading-5 text-slate-500">Category routes inherit this default. Event routes inherit their category unless explicitly overridden.</div>
        </aside>
      </div>

      {editingSetting && (() => {
        const setting = settings.get(editingSetting)
        const type = notificationTypes.find((item) => item.event_code === editingSetting)
        if (!setting || !type) return null
        return <NotificationFlowDrawer open onOpenChange={(open) => !open && setEditingSetting(null)} setting={{ ...setting, channels_enabled: channelsForPreset(effectivePreset(type)) }} type={type} onSave={saveSingleSetting} />
      })()}
    </div>
  )
}
