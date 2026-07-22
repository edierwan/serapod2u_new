'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    AlertCircle, CheckCircle2, Info, Loader2, Lock, MessageCircle, Save,
    Settings, ShieldCheck, MapPin, Send, ClipboardList
} from 'lucide-react'
import { SeraLoadingState } from '@/components/ui/SeraLoader'
import { toast } from '@/components/ui/use-toast'

interface RoadtourSettingsViewProps {
    userProfile: any
}

// Locked operational defaults — system-managed and not user-editable for first
// production rollout. Mirrors values enforced server-side on save and in the
// claim/scan validation pipeline.
export const ROADTOUR_LOCKED_DEFAULTS = {
    qr_mode: 'persistent' as const,
    duplicate_rule_reward: 'one_per_user_per_campaign' as const,
    official_visit_rule: 'one_per_shop_per_am_per_day' as const,
    require_login: true,
    require_shop_context: true,
    require_geolocation: true,
    whatsapp_send_enabled: true,
}

interface SettingsRow {
    id: string
    org_id: string
    is_enabled: boolean
    default_points: number
    reward_mode: 'direct_scan' | 'survey_submit'
    survey_template_id: string | null
    qr_expiry_hours: number | null
    point_value_rm_snapshot: number | null
    claim_whatsapp_enabled: boolean | null
    claim_whatsapp_recipient_mode: 'manual' | 'hq_org' | null
    claim_whatsapp_manual_numbers: string[] | null
    claim_whatsapp_success_template: string | null
    claim_whatsapp_failure_template: string | null
}

type WhatsappStatus = 'ready' | 'not_configured' | 'session_issue' | 'unknown'
type SettingsTab = 'system' | 'claim-alerts'

function parseSettingsTab(value?: string | null): SettingsTab {
    return value === 'claim-alerts' ? 'claim-alerts' : 'system'
}

export function RoadtourSettingsView({ userProfile }: RoadtourSettingsViewProps) {
    const supabase = createClient()
    const companyId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [settingsId, setSettingsId] = useState<string | null>(null)

    const [isEnabled, setIsEnabled] = useState(true)
    const [pointValueRm, setPointValueRm] = useState(0.10)

    // Operator-editable: claim WhatsApp alerts
    const [claimWhatsappEnabled, setClaimWhatsappEnabled] = useState(false)
    const [claimWhatsappRecipientMode, setClaimWhatsappRecipientMode] = useState<'manual' | 'hq_org'>('manual')
    const [claimWhatsappManualNumbers, setClaimWhatsappManualNumbers] = useState('')
    const [claimWhatsappSuccessTemplate, setClaimWhatsappSuccessTemplate] = useState(
        'RoadTour claim success\nCampaign: {campaign_name}\nShop: {shop_name}\nReference: {reference_name}\nConsumer: {consumer_name}\nGeoLoc: {geo_label}\nPoints: {points_awarded}\nBalance: {balance_after}\nStatus: {status}'
    )
    const [claimWhatsappFailureTemplate, setClaimWhatsappFailureTemplate] = useState(
        'RoadTour claim {status}\nCampaign: {campaign_name}\nShop: {shop_name}\nReference: {reference_name}\nConsumer: {consumer_name}\nGeoLoc: {geo_label}\nReason: {message}'
    )
    const [testSending, setTestSending] = useState<'success' | 'failed' | null>(null)
    const [activeTab, setActiveTab] = useState<SettingsTab>('system')

    // Read-only WhatsApp gateway readiness
    const [whatsappStatus, setWhatsappStatus] = useState<WhatsappStatus>('unknown')

    // Survey templates needed for default linking
    const [defaultPoints, setDefaultPoints] = useState(20)
    const [rewardMode, setRewardMode] = useState<'direct_scan' | 'survey_submit'>('survey_submit')
    const [surveyTemplateId, setSurveyTemplateId] = useState<string | null>(null)
    const [qrExpiryHours, setQrExpiryHours] = useState<number | null>(null)

    useEffect(() => {
        if (typeof window === 'undefined') return

        const currentTab = parseSettingsTab(new URLSearchParams(window.location.search).get('tab'))
        setActiveTab(currentTab)
    }, [])

    useEffect(() => {
        async function load() {
            try {
                setLoading(true)

                const { data: orgData } = await supabase
                    .from('organizations')
                    .select('settings')
                    .eq('id', companyId)
                    .single()
                const orgSettings = (orgData?.settings as any) || {}
                if (typeof orgSettings.point_value_rm === 'number') {
                    setPointValueRm(orgSettings.point_value_rm)
                }

                const { data, error } = await (supabase as any)
                    .from('roadtour_settings')
                    .select('*')
                    .eq('org_id', companyId)
                    .maybeSingle()

                if (error && error.code !== 'PGRST116') throw error

                if (data) {
                    const s = data as SettingsRow
                    setSettingsId(s.id)
                    setIsEnabled(s.is_enabled)
                    setDefaultPoints(s.default_points)
                    setRewardMode(s.reward_mode)
                    setSurveyTemplateId(s.survey_template_id)
                    setQrExpiryHours(s.qr_expiry_hours)
                    if (s.point_value_rm_snapshot != null) setPointValueRm(s.point_value_rm_snapshot)
                    setClaimWhatsappEnabled(Boolean(s.claim_whatsapp_enabled))
                    setClaimWhatsappRecipientMode(s.claim_whatsapp_recipient_mode || 'manual')
                    setClaimWhatsappManualNumbers((s.claim_whatsapp_manual_numbers || []).join('\n'))
                    if (s.claim_whatsapp_success_template) setClaimWhatsappSuccessTemplate(s.claim_whatsapp_success_template)
                    if (s.claim_whatsapp_failure_template) setClaimWhatsappFailureTemplate(s.claim_whatsapp_failure_template)
                }
            } catch (err: any) {
                console.error('Error loading RoadTour settings:', err)
                toast({ title: 'Error', description: 'Failed to load RoadTour settings.', variant: 'destructive' })
            } finally {
                setLoading(false)
            }
        }

        async function loadStatus() {
            try {
                const res = await fetch('/api/roadtour/settings-status', { cache: 'no-store' })
                if (!res.ok) {
                    setWhatsappStatus('unknown')
                    return
                }
                const json = await res.json()
                setWhatsappStatus(json?.whatsapp?.status || 'unknown')
            } catch {
                setWhatsappStatus('unknown')
            }
        }

        load()
        loadStatus()
    }, [companyId, supabase])

    const whatsappLabel = useMemo(() => {
        switch (whatsappStatus) {
            case 'ready': return { label: 'Ready', tone: 'emerald' }
            case 'not_configured': return { label: 'Not configured', tone: 'amber' }
            case 'session_issue': return { label: 'Session issue', tone: 'red' }
            default: return { label: 'Checking…', tone: 'slate' }
        }
    }, [whatsappStatus])

    const handleSave = async () => {
        try {
            setSaving(true)

            // Always enforce locked operational defaults regardless of what the
            // hidden UI may carry from earlier states or stale rows.
            const payload = {
                org_id: companyId,
                is_enabled: isEnabled,
                default_points: defaultPoints,
                reward_mode: rewardMode,
                survey_template_id: rewardMode === 'survey_submit' ? surveyTemplateId : null,
                qr_mode: ROADTOUR_LOCKED_DEFAULTS.qr_mode,
                duplicate_rule_reward: ROADTOUR_LOCKED_DEFAULTS.duplicate_rule_reward,
                official_visit_rule: ROADTOUR_LOCKED_DEFAULTS.official_visit_rule,
                require_login: ROADTOUR_LOCKED_DEFAULTS.require_login,
                require_shop_context: ROADTOUR_LOCKED_DEFAULTS.require_shop_context,
                require_geolocation: ROADTOUR_LOCKED_DEFAULTS.require_geolocation,
                qr_expiry_hours: qrExpiryHours,
                point_value_rm_snapshot: pointValueRm,
                whatsapp_send_enabled: ROADTOUR_LOCKED_DEFAULTS.whatsapp_send_enabled,
                claim_whatsapp_enabled: claimWhatsappEnabled,
                claim_whatsapp_recipient_mode: claimWhatsappRecipientMode,
                claim_whatsapp_manual_numbers: claimWhatsappManualNumbers
                    .split(/[\n,]/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                claim_whatsapp_success_template: claimWhatsappSuccessTemplate,
                claim_whatsapp_failure_template: claimWhatsappFailureTemplate,
                is_active: true,
                updated_by: userProfile.id,
                updated_at: new Date().toISOString(),
            }

            if (settingsId) {
                const { error } = await (supabase as any).from('roadtour_settings').update(payload).eq('id', settingsId)
                if (error) throw error
            } else {
                const { data, error } = await (supabase as any)
                    .from('roadtour_settings')
                    .insert({ ...payload, created_by: userProfile.id })
                    .select('id')
                    .single()
                if (error) throw error
                setSettingsId(data.id)
            }

            toast({ title: 'Settings Saved', description: 'RoadTour settings saved successfully.' })
        } catch (err: any) {
            console.error('Error saving RoadTour settings:', err)
            toast({ title: 'Save Failed', description: err.message || 'Failed to save settings.', variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    const handleTestClaimAlert = async (status: 'success' | 'failed') => {
        try {
            setTestSending(status)
            const response = await fetch('/api/roadtour/test-claim-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(result.error || 'Failed to send test alert.')
            toast({ title: 'Test Sent', description: `RoadTour ${status} alert test has been sent.` })
        } catch (error: any) {
            toast({ title: 'Test Failed', description: error.message || 'Failed to send test alert.', variant: 'destructive' })
        } finally {
            setTestSending(null)
        }
    }

    const handleTabChange = (value: string) => {
        const nextTab = parseSettingsTab(value)
        setActiveTab(nextTab)

        if (typeof window === 'undefined') return

        const url = new URL(window.location.href)
        url.searchParams.set('tab', nextTab)
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }

    if (loading) return <SeraLoadingState variant="page" />

    const toneClass = (tone: string) => {
        switch (tone) {
            case 'emerald': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
            case 'amber': return 'bg-amber-100 text-amber-700 border-amber-200'
            case 'red': return 'bg-red-100 text-red-700 border-red-200'
            default: return 'bg-slate-100 text-slate-700 border-slate-200'
        }
    }

    const renderSaveButton = () => (
        <div className="flex items-center gap-3 pt-4 border-t">
            <Button onClick={handleSave} disabled={saving} className="gap-2" size="lg">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving...' : 'Save RoadTour Settings'}
            </Button>
        </div>
    )

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold flex items-center gap-2">
                    <Settings className="h-5 w-5 text-primary" />
                    RoadTour Settings
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                    RoadTour operational rules are managed by system defaults to keep campaigns and reporting consistent.
                </p>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-lg border bg-white p-1">
                    <TabsTrigger value="system" className="shrink-0 rounded-md px-4 py-2 text-sm">
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        System Status
                    </TabsTrigger>
                    <TabsTrigger value="claim-alerts" className="shrink-0 rounded-md px-4 py-2 text-sm">
                        <ClipboardList className="mr-2 h-4 w-4" />
                        Claim WhatsApp Alerts
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="system" className="mt-0 space-y-6">
                    <Card className={isEnabled ? 'border-emerald-200 bg-emerald-50/30' : 'border-muted'}>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between gap-6">
                                <div className="space-y-1">
                                    <Label className="text-base font-semibold">Enable RoadTour Program</Label>
                                    <p className="text-sm text-muted-foreground">Turn on automated RoadTour campaign support for field visits and reward tracking.</p>
                                </div>
                                <Switch checked={isEnabled} onCheckedChange={setIsEnabled} aria-label="Enable RoadTour Program" />
                            </div>
                            <Badge variant={isEnabled ? 'default' : 'secondary'} className="mt-3">{isEnabled ? 'Active' : 'Disabled'}</Badge>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                                System Status
                            </CardTitle>
                            <CardDescription>
                                Operational rules below are locked to safe defaults to keep RoadTour reporting consistent.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3 md:grid-cols-2">
                            <StatusRow
                                icon={<Settings className="h-4 w-4 text-emerald-600" />}
                                label="RoadTour Program"
                                value={isEnabled ? 'Active' : 'Inactive'}
                                toneClass={toneClass(isEnabled ? 'emerald' : 'amber')}
                            />
                            <StatusRow
                                icon={<Lock className="h-4 w-4 text-slate-600" />}
                                label="System Defaults"
                                value="Enabled"
                                toneClass={toneClass('emerald')}
                            />
                            <StatusRow
                                icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}
                                label="WhatsApp Delivery"
                                value={whatsappLabel.label}
                                toneClass={toneClass(whatsappLabel.tone)}
                            />
                            <StatusRow
                                icon={<MapPin className="h-4 w-4 text-blue-600" />}
                                label="Geolocation Capture"
                                value="Enabled"
                                toneClass={toneClass('emerald')}
                            />
                            <StatusRow
                                icon={<ShieldCheck className="h-4 w-4 text-indigo-600" />}
                                label="Secure Claim Mode"
                                value="Login + Shop Context Required"
                                toneClass={toneClass('emerald')}
                                wide
                            />
                        </CardContent>
                    </Card>

                    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 flex items-start gap-3">
                        <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                        <div className="text-sm text-blue-900">
                            QR mode, duplicate reward rules, and official visit rules are now system-locked for the first production rollout.
                            Reach out to the platform team if your campaign needs a different policy.
                        </div>
                    </div>

                    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-4 flex items-start gap-3">
                        <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                        <div className="text-sm text-emerald-900">
                            <strong>Duplicate Protection now lives on the RoadTour Event.</strong> Use participant-level protection for staff reward campaigns so different workers from the same shop can claim once each. Use shop-level protection only when the reward is intended once per shop.
                        </div>
                    </div>

                    {renderSaveButton()}
                </TabsContent>

                <TabsContent value="claim-alerts" className="mt-0 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <ClipboardList className="h-5 w-5 text-sky-600" />
                                Claim WhatsApp Alerts
                            </CardTitle>
                            <CardDescription>
                                Send HQ or manual WhatsApp notifications whenever a RoadTour claim succeeds, duplicates, or fails.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between rounded-lg border p-4">
                                <div>
                                    <Label className="font-medium">Enable Claim Alerts</Label>
                                    <p className="text-xs text-muted-foreground mt-1">Uses the same WhatsApp gateway configuration as QR delivery.</p>
                                </div>
                                <Switch checked={claimWhatsappEnabled} onCheckedChange={setClaimWhatsappEnabled} aria-label="Enable Claim Alerts" />
                            </div>

                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Recipient Mode</Label>
                                    <Select value={claimWhatsappRecipientMode} onValueChange={(value) => setClaimWhatsappRecipientMode(value as 'manual' | 'hq_org')}>
                                        <SelectTrigger aria-label="Recipient Mode"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="manual">Manual numbers</SelectItem>
                                            <SelectItem value="hq_org">HQ org admins with phone numbers</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Test Send</Label>
                                    <div className="flex flex-wrap gap-2">
                                        <Button type="button" variant="outline" onClick={() => handleTestClaimAlert('success')} disabled={testSending !== null}>
                                            {testSending === 'success' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                                            Test Success
                                        </Button>
                                        <Button type="button" variant="outline" onClick={() => handleTestClaimAlert('failed')} disabled={testSending !== null}>
                                            {testSending === 'failed' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                                            Test Failure
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {claimWhatsappRecipientMode === 'manual' && (
                                <div className="space-y-2">
                                    <Label>Manual Recipient Numbers</Label>
                                    <Textarea
                                        aria-label="Manual Recipient Numbers"
                                        value={claimWhatsappManualNumbers}
                                        onChange={(event) => setClaimWhatsappManualNumbers(event.target.value)}
                                        rows={4}
                                        placeholder={"0123456789\n60123456789"}
                                    />
                                    <p className="text-xs text-muted-foreground">Use one number per line or separate them with commas.</p>
                                </div>
                            )}

                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Success Template</Label>
                                    <Textarea aria-label="Success Template" value={claimWhatsappSuccessTemplate} onChange={(event) => setClaimWhatsappSuccessTemplate(event.target.value)} rows={8} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Failure Template</Label>
                                    <Textarea aria-label="Failure Template" value={claimWhatsappFailureTemplate} onChange={(event) => setClaimWhatsappFailureTemplate(event.target.value)} rows={8} />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Available variables: {'{campaign_name}'}, {'{shop_name}'}, {'{reference_name}'}, {'{consumer_name}'}, {'{geo_label}'}, {'{points_awarded}'}, {'{balance_after}'}, {'{status}'}, {'{message}'}, {'{short_link}'}.
                            </p>
                        </CardContent>
                    </Card>

                    {renderSaveButton()}
                </TabsContent>
            </Tabs>
        </div>
    )
}

function StatusRow({ icon, label, value, toneClass, wide }: { icon: React.ReactNode; label: string; value: string; toneClass: string; wide?: boolean }) {
    return (
        <div className={`flex items-center justify-between rounded-lg border p-3 ${wide ? 'md:col-span-2' : ''}`}>
            <div className="flex items-center gap-2">
                {icon}
                <span className="text-sm font-medium text-foreground">{label}</span>
            </div>
            <Badge variant="outline" className={`text-xs ${toneClass}`}>{value}</Badge>
        </div>
    )
}
