'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
    AlertCircle, CheckCircle2, Coins, Gift, Info, Loader2, Map, Save,
    Settings, ShieldCheck, Sparkles, QrCode, ClipboardList
} from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

interface RoadtourSettingsViewProps {
    userProfile: any
}

interface SettingsRow {
    id: string
    org_id: string
    is_enabled: boolean
    default_points: number
    reward_mode: 'direct_scan' | 'survey_submit'
    survey_template_id: string | null
    qr_mode: 'persistent' | 'time_limited' | 'one_time'
    duplicate_rule_reward: string
    official_visit_rule: string
    require_login: boolean
    require_shop_context: boolean
    require_geolocation: boolean
    qr_expiry_hours: number | null
    point_value_rm_snapshot: number | null
    whatsapp_send_enabled: boolean
    claim_whatsapp_enabled: boolean
    claim_whatsapp_recipient_mode: 'manual' | 'hq_org'
    claim_whatsapp_manual_numbers: string[]
    claim_whatsapp_success_template: string | null
    claim_whatsapp_failure_template: string | null
}

export function RoadtourSettingsView({ userProfile }: RoadtourSettingsViewProps) {
    const supabase = createClient()
    const companyId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [settingsId, setSettingsId] = useState<string | null>(null)

    const [isEnabled, setIsEnabled] = useState(true)
    const [defaultPoints, setDefaultPoints] = useState(20)
    const [rewardMode, setRewardMode] = useState<'direct_scan' | 'survey_submit'>('survey_submit')
    const [surveyTemplateId, setSurveyTemplateId] = useState<string | null>(null)
    const [qrMode, setQrMode] = useState<'persistent' | 'time_limited' | 'one_time'>('persistent')
    const [duplicateRule, setDuplicateRule] = useState('one_per_user_per_campaign')
    const [officialVisitRule, setOfficialVisitRule] = useState('one_per_shop_per_am_per_day')
    const [requireLogin, setRequireLogin] = useState(true)
    const [requireShopContext, setRequireShopContext] = useState(true)
    const [requireGeolocation, setRequireGeolocation] = useState(false)
    const [qrExpiryHours, setQrExpiryHours] = useState<number | null>(null)
    const [pointValueRm, setPointValueRm] = useState(0.10)
    const [whatsappSendEnabled, setWhatsappSendEnabled] = useState(true)
    const [claimWhatsappEnabled, setClaimWhatsappEnabled] = useState(false)
    const [claimWhatsappRecipientMode, setClaimWhatsappRecipientMode] = useState<'manual' | 'hq_org'>('manual')
    const [claimWhatsappManualNumbers, setClaimWhatsappManualNumbers] = useState('')
    const [claimWhatsappSuccessTemplate, setClaimWhatsappSuccessTemplate] = useState('RoadTour claim success\nCampaign: {campaign_name}\nShop: {shop_name}\nReference: {reference_name}\nConsumer: {consumer_name}\nGeoLoc: {geo_label}\nPoints: {points_awarded}\nBalance: {balance_after}\nStatus: {status}')
    const [claimWhatsappFailureTemplate, setClaimWhatsappFailureTemplate] = useState('RoadTour claim {status}\nCampaign: {campaign_name}\nShop: {shop_name}\nReference: {reference_name}\nConsumer: {consumer_name}\nGeoLoc: {geo_label}\nReason: {message}')
    const [testSending, setTestSending] = useState<'success' | 'failed' | null>(null)

    const [surveyTemplates, setSurveyTemplates] = useState<{ id: string; name: string }[]>([])

    useEffect(() => {
        async function load() {
            try {
                setLoading(true)

                // Load org point value
                const { data: orgData } = await supabase
                    .from('organizations')
                    .select('settings')
                    .eq('id', companyId)
                    .single()

                const orgSettings = (orgData?.settings as any) || {}
                if (typeof orgSettings.point_value_rm === 'number') {
                    setPointValueRm(orgSettings.point_value_rm)
                }

                // Load survey templates
                const { data: templates } = await (supabase as any)
                    .from('roadtour_survey_templates')
                    .select('id, name')
                    .eq('org_id', companyId)
                    .eq('is_active', true)
                    .order('name')

                setSurveyTemplates(templates || [])

                // Load settings
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
                    setQrMode(s.qr_mode)
                    setDuplicateRule(s.duplicate_rule_reward)
                    setOfficialVisitRule(s.official_visit_rule)
                    setRequireLogin(s.require_login)
                    setRequireShopContext(s.require_shop_context)
                    setRequireGeolocation(s.require_geolocation)
                    setQrExpiryHours(s.qr_expiry_hours)
                    if (s.point_value_rm_snapshot != null) setPointValueRm(s.point_value_rm_snapshot)
                    setWhatsappSendEnabled(s.whatsapp_send_enabled)
                    setClaimWhatsappEnabled(Boolean(s.claim_whatsapp_enabled))
                    setClaimWhatsappRecipientMode(s.claim_whatsapp_recipient_mode || 'manual')
                    setClaimWhatsappManualNumbers((s.claim_whatsapp_manual_numbers || []).join('\n'))
                    if (s.claim_whatsapp_success_template) setClaimWhatsappSuccessTemplate(s.claim_whatsapp_success_template)
                    if (s.claim_whatsapp_failure_template) setClaimWhatsappFailureTemplate(s.claim_whatsapp_failure_template)
                }
            } catch (err: any) {
                console.error('Error loading RoadTour settings:', err)
                toast({ title: 'Error', description: 'Failed to load RoadTour settings. Make sure the SQL migration has been applied.', variant: 'destructive' })
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [companyId, supabase])

    const estimatedCost = useMemo(() => defaultPoints * pointValueRm, [defaultPoints, pointValueRm])

    const summary = useMemo(() => {
        const parts: string[] = []
        parts.push(`Each successful RoadTour reward grants ${defaultPoints} points.`)
        parts.push(`Estimated cost per successful reward: RM ${estimatedCost.toFixed(2)}.`)
        parts.push(`Official visits are limited to ${officialVisitRule === 'one_per_shop_per_am_per_day' ? 'one per shop per account manager per day' : 'one per shop per campaign'}.`)
        if (rewardMode === 'survey_submit') parts.push('Reward will only be granted after survey submission.')
        else parts.push('Reward will be granted directly after valid QR scan.')
        return parts
    }, [defaultPoints, estimatedCost, officialVisitRule, rewardMode])

    const handleSave = async () => {
        try {
            setSaving(true)
            if (defaultPoints < 1) {
                toast({ title: 'Validation Error', description: 'Default reward points must be at least 1.', variant: 'destructive' })
                return
            }

            const payload = {
                org_id: companyId,
                is_enabled: isEnabled,
                default_points: defaultPoints,
                reward_mode: rewardMode,
                survey_template_id: rewardMode === 'survey_submit' ? surveyTemplateId : null,
                qr_mode: qrMode,
                duplicate_rule_reward: duplicateRule,
                official_visit_rule: officialVisitRule,
                require_login: requireLogin,
                require_shop_context: requireShopContext,
                require_geolocation: requireGeolocation,
                qr_expiry_hours: qrExpiryHours,
                point_value_rm_snapshot: pointValueRm,
                whatsapp_send_enabled: whatsappSendEnabled,
                claim_whatsapp_enabled: claimWhatsappEnabled,
                claim_whatsapp_recipient_mode: claimWhatsappRecipientMode,
                claim_whatsapp_manual_numbers: claimWhatsappManualNumbers.split(/[\n,]/).map((value) => value.trim()).filter(Boolean),
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
                const { data, error } = await (supabase as any).from('roadtour_settings').insert({ ...payload, created_by: userProfile.id }).select('id').single()
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
            if (!response.ok) {
                throw new Error(result.error || 'Failed to send test alert.')
            }

            toast({ title: 'Test Sent', description: `RoadTour ${status} alert test has been sent.` })
        } catch (error: any) {
            toast({ title: 'Test Failed', description: error.message || 'Failed to send test alert.', variant: 'destructive' })
        } finally {
            setTestSending(null)
        }
    }

    if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold flex items-center gap-2">
                    <Settings className="h-5 w-5 text-primary" />
                    RoadTour Settings
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Configure RoadTour operational rules. Point-related reward settings are now managed under Point Catalog Management → Settings.</p>
            </div>

            {/* Enable Toggle */}
            <Card className={isEnabled ? 'border-emerald-200 bg-emerald-50/30' : 'border-muted'}>
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between gap-6">
                        <div className="space-y-1">
                            <Label className="text-base font-semibold">Enable RoadTour Program</Label>
                            <p className="text-sm text-muted-foreground">Turn on automated RoadTour campaign support for field visits and reward tracking.</p>
                        </div>
                        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
                    </div>
                    <Badge variant={isEnabled ? 'default' : 'secondary'} className="mt-3">{isEnabled ? 'Active' : 'Disabled'}</Badge>
                </CardContent>
            </Card>

            {/* QR & Duplicate Rules */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><QrCode className="h-5 w-5 text-indigo-500" />QR & Duplicate Rules</CardTitle>
                    <CardDescription>Control how QR codes are generated and how duplicates are handled.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>QR Mode</Label>
                            <Select value={qrMode} onValueChange={(v) => setQrMode(v as any)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="persistent">Persistent QR per Account Manager per Campaign</SelectItem>
                                    <SelectItem value="time_limited">Time-Limited QR</SelectItem>
                                    <SelectItem value="one_time">One-Time QR per Shop Visit</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {qrMode === 'time_limited' && (
                            <div className="space-y-2">
                                <Label>QR Expiry (Hours)</Label>
                                <Input type="number" min={1} value={qrExpiryHours ?? ''} onChange={(e) => setQrExpiryHours(e.target.value ? parseInt(e.target.value, 10) : null)} placeholder="e.g. 24" />
                            </div>
                        )}
                    </div>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Duplicate Reward Rule</Label>
                            <Select value={duplicateRule} onValueChange={setDuplicateRule}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="one_per_user_per_campaign">One reward per user per campaign</SelectItem>
                                    <SelectItem value="one_per_user_per_day">One reward per user per day</SelectItem>
                                    <SelectItem value="one_per_shop_per_am_per_day">One reward per shop per account manager per day</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Official Visit Rule</Label>
                            <Select value={officialVisitRule} onValueChange={setOfficialVisitRule}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="one_per_shop_per_am_per_day">One visit per shop per AM per day</SelectItem>
                                    <SelectItem value="one_per_shop_per_campaign">One visit per shop per campaign</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Validation & Delivery */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5 text-emerald-500" />Validation & Delivery</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div><Label className="font-medium">Require Logged-In User</Label><p className="text-xs text-muted-foreground mt-1">User must be authenticated to claim reward.</p></div>
                            <Switch checked={requireLogin} onCheckedChange={setRequireLogin} />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div><Label className="font-medium">Require Shop Context</Label><p className="text-xs text-muted-foreground mt-1">User must have a linked shop to claim reward.</p></div>
                            <Switch checked={requireShopContext} onCheckedChange={setRequireShopContext} />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div><Label className="font-medium">Capture Geolocation</Label><p className="text-xs text-muted-foreground mt-1">Record GPS internally and store a readable GeoLoc label for visits and alerts.</p></div>
                            <Switch checked={requireGeolocation} onCheckedChange={setRequireGeolocation} />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div><Label className="font-medium">WhatsApp QR Delivery</Label><p className="text-xs text-muted-foreground mt-1">Allow sending generated QR codes via WhatsApp.</p></div>
                            <Switch checked={whatsappSendEnabled} onCheckedChange={setWhatsappSendEnabled} />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-5 w-5 text-sky-600" />Claim WhatsApp Alerts</CardTitle>
                    <CardDescription>Send HQ or manual WhatsApp notifications whenever a RoadTour claim succeeds, duplicates, or fails.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div>
                            <Label className="font-medium">Enable Claim Alerts</Label>
                            <p className="text-xs text-muted-foreground mt-1">Uses the same WhatsApp gateway configuration as QR delivery.</p>
                        </div>
                        <Switch checked={claimWhatsappEnabled} onCheckedChange={setClaimWhatsappEnabled} />
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Recipient Mode</Label>
                            <Select value={claimWhatsappRecipientMode} onValueChange={(value) => setClaimWhatsappRecipientMode(value as 'manual' | 'hq_org')}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="manual">Manual numbers</SelectItem>
                                    <SelectItem value="hq_org">HQ org admins with phone numbers</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Test Send</Label>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" onClick={() => handleTestClaimAlert('success')} disabled={testSending !== null}>
                                    {testSending === 'success' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Test Success
                                </Button>
                                <Button type="button" variant="outline" onClick={() => handleTestClaimAlert('failed')} disabled={testSending !== null}>
                                    {testSending === 'failed' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Test Failure
                                </Button>
                            </div>
                        </div>
                    </div>

                    {claimWhatsappRecipientMode === 'manual' && (
                        <div className="space-y-2">
                            <Label>Manual Recipient Numbers</Label>
                            <Textarea
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
                            <Textarea value={claimWhatsappSuccessTemplate} onChange={(event) => setClaimWhatsappSuccessTemplate(event.target.value)} rows={8} />
                        </div>
                        <div className="space-y-2">
                            <Label>Failure Template</Label>
                            <Textarea value={claimWhatsappFailureTemplate} onChange={(event) => setClaimWhatsappFailureTemplate(event.target.value)} rows={8} />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Available variables: {'{campaign_name}'}, {'{shop_name}'}, {'{reference_name}'}, {'{consumer_name}'}, {'{geo_label}'}, {'{points_awarded}'}, {'{balance_after}'}, {'{status}'}, {'{message}'}, {'{short_link}'}.</p>
                </CardContent>
            </Card>

            {/* Summary */}
            <Card className="border-amber-200 bg-amber-50/40">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-5 w-5 text-amber-600" />Preview Summary</CardTitle></CardHeader>
                <CardContent>
                    <ul className="space-y-1">
                        {summary.map((s, i) => <li key={i} className="text-sm text-amber-900">• {s}</li>)}
                    </ul>
                </CardContent>
            </Card>

            <div className="flex items-center gap-3 pt-4 border-t">
                <Button onClick={handleSave} disabled={saving} className="gap-2" size="lg">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? 'Saving...' : 'Save RoadTour Settings'}
                </Button>
            </div>
        </div>
    )
}
