'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { AlertCircle, CheckCircle2, Coins, Gift, Info, Loader2, Save, ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

interface UserRegistrationBonusSettingsProps {
    userProfile: any
}

interface BonusSettingsRow {
    id: string
    org_id: string
    enabled: boolean
    bonus_mode: 'instant' | 'conditional'
    bonus_points: number
    min_valid_scans_per_month: number
    required_consecutive_months: number
    only_unique_qr_scans: boolean
    allow_grace_month: boolean
    bonus_expiry_days: number | null
    max_bonus_claims_per_user: number
    updated_at: string | null
}

export function UserRegistrationBonusSettings({ userProfile }: UserRegistrationBonusSettingsProps) {
    const supabase = createClient()
    const companyId = userProfile.organizations.id

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
    const [settingsId, setSettingsId] = useState<string | null>(null)

    const [enabled, setEnabled] = useState(false)
    const [bonusMode, setBonusMode] = useState<'instant' | 'conditional'>('conditional')
    const [bonusPoints, setBonusPoints] = useState(50)
    const [pointValueRm, setPointValueRm] = useState(0.1)
    const [minValidScansPerMonth, setMinValidScansPerMonth] = useState(1)
    const [requiredConsecutiveMonths, setRequiredConsecutiveMonths] = useState(3)
    const [onlyUniqueQrScans, setOnlyUniqueQrScans] = useState(true)
    const [allowGraceMonth, setAllowGraceMonth] = useState(false)
    const [bonusExpiryDays, setBonusExpiryDays] = useState<number | null>(null)
    const [maxBonusClaimsPerUser, setMaxBonusClaimsPerUser] = useState(1)

    const showAlert = (type: 'success' | 'error' | 'info', message: string) => {
        setAlert({ type, message })
        setTimeout(() => setAlert(null), 5000)
    }

    useEffect(() => {
        async function loadSettings() {
            try {
                setLoading(true)

                const { data: orgData } = await (supabase as any)
                    .from('organizations')
                    .select('settings')
                    .eq('id', companyId)
                    .single()

                const orgSettings = (orgData?.settings as any) || {}
                if (typeof orgSettings.point_value_rm === 'number') {
                    setPointValueRm(orgSettings.point_value_rm)
                }

                const { data, error } = await (supabase as any)
                    .from('user_registration_bonus_settings')
                    .select('*')
                    .eq('org_id', companyId)
                    .maybeSingle()

                if (error && error.code !== 'PGRST116') {
                    throw error
                }

                if (data) {
                    const row = data as BonusSettingsRow
                    setSettingsId(row.id)
                    setEnabled(row.enabled)
                    setBonusMode(row.bonus_mode)
                    setBonusPoints(row.bonus_points)
                    setMinValidScansPerMonth(row.min_valid_scans_per_month)
                    setRequiredConsecutiveMonths(row.required_consecutive_months)
                    setOnlyUniqueQrScans(row.only_unique_qr_scans)
                    setAllowGraceMonth(row.allow_grace_month)
                    setBonusExpiryDays(row.bonus_expiry_days)
                    setMaxBonusClaimsPerUser(row.max_bonus_claims_per_user)
                }
            } catch (error: any) {
                console.error('Error loading user registration bonus settings:', error)
                showAlert('error', 'Failed to load user registration settings. Please run the latest SQL script if this is a new environment.')
            } finally {
                setLoading(false)
            }
        }

        loadSettings()
    }, [companyId, supabase])

    const estimatedCost = useMemo(() => bonusPoints * pointValueRm, [bonusPoints, pointValueRm])

    const summary = useMemo(() => {
        if (!enabled) {
            return 'Welcome bonus is currently disabled for new user registrations.'
        }

        if (bonusMode === 'instant') {
            return `New users will receive ${bonusPoints} points immediately after completing registration. Estimated cost per qualified user: RM ${estimatedCost.toFixed(2)}.`
        }

        return `New users will receive ${bonusPoints} points after completing at least ${minValidScansPerMonth} valid ${onlyUniqueQrScans ? 'unique ' : ''}QR scan${minValidScansPerMonth > 1 ? 's' : ''} per month for ${requiredConsecutiveMonths} consecutive month${requiredConsecutiveMonths > 1 ? 's' : ''}${allowGraceMonth ? ', with one grace month allowed' : ''}. Estimated cost per qualified user: RM ${estimatedCost.toFixed(2)}.`
    }, [allowGraceMonth, bonusMode, bonusPoints, enabled, estimatedCost, minValidScansPerMonth, onlyUniqueQrScans, requiredConsecutiveMonths])

    const handleSave = async () => {
        try {
            setSaving(true)

            if (bonusPoints < 1) {
                showAlert('error', 'Bonus points must be at least 1.')
                return
            }
            if (bonusMode === 'conditional') {
                if (minValidScansPerMonth < 1) {
                    showAlert('error', 'Minimum valid QR scans per month must be at least 1.')
                    return
                }
                if (requiredConsecutiveMonths < 1) {
                    showAlert('error', 'Required consecutive months must be at least 1.')
                    return
                }
            }

            const payload = {
                org_id: companyId,
                enabled,
                bonus_mode: bonusMode,
                bonus_points: bonusPoints,
                min_valid_scans_per_month: minValidScansPerMonth,
                required_consecutive_months: requiredConsecutiveMonths,
                only_unique_qr_scans: onlyUniqueQrScans,
                allow_grace_month: allowGraceMonth,
                bonus_expiry_days: bonusExpiryDays,
                max_bonus_claims_per_user: maxBonusClaimsPerUser,
                updated_by: userProfile.id,
                updated_at: new Date().toISOString(),
            }

            if (settingsId) {
                const { error } = await (supabase as any)
                    .from('user_registration_bonus_settings')
                    .update(payload)
                    .eq('id', settingsId)
                if (error) throw error
            } else {
                const { data, error } = await (supabase as any)
                    .from('user_registration_bonus_settings')
                    .insert(payload)
                    .select('id')
                    .single()
                if (error) throw error
                setSettingsId(data.id)
            }

            showAlert('success', 'User registration bonus settings saved successfully.')
            toast({ title: 'Settings Saved', description: 'User registration bonus settings saved successfully.' })
        } catch (error: any) {
            console.error('Error saving user registration bonus settings:', error)
            showAlert('error', error.message || 'Failed to save user registration settings.')
            toast({ title: 'Save Failed', description: error.message || 'Failed to save settings.', variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold flex items-center gap-2">
                    <Gift className="h-5 w-5 text-primary" />
                    User Registration Bonus
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                    Configure how welcome bonus points are awarded to newly registered users.
                </p>
            </div>

            {alert && (
                <Alert className={
                    alert.type === 'error' ? 'border-red-200 bg-red-50' :
                        alert.type === 'success' ? 'border-green-200 bg-green-50' :
                            'border-blue-200 bg-blue-50'
                }>
                    {alert.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    {alert.type === 'error' && <AlertCircle className="h-4 w-4 text-red-600" />}
                    {alert.type === 'info' && <Info className="h-4 w-4 text-blue-600" />}
                    <AlertDescription>{alert.message}</AlertDescription>
                </Alert>
            )}

            <Card className={enabled ? 'border-emerald-200 bg-emerald-50/30' : 'border-muted'}>
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between gap-6">
                        <div className="space-y-1">
                            <Label className="text-base font-semibold">Enable Welcome Bonus</Label>
                            <p className="text-sm text-muted-foreground">
                                Turn on automated welcome bonus handling for users who register through the consumer journey.
                            </p>
                        </div>
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                    </div>
                    <Badge variant={enabled ? 'default' : 'secondary'} className="mt-3">
                        {enabled ? 'Active' : 'Disabled'}
                    </Badge>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Sparkles className="h-5 w-5 text-amber-500" />
                        Bonus Definition
                    </CardTitle>
                    <CardDescription>
                        Choose how the welcome bonus is granted and how much it is worth.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Bonus Mode</Label>
                            <Select value={bonusMode} onValueChange={(value) => setBonusMode(value as 'instant' | 'conditional')}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="instant">Instant Bonus</SelectItem>
                                    <SelectItem value="conditional">Conditional Bonus</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Bonus Points</Label>
                            <Input
                                type="number"
                                min={1}
                                value={bonusPoints}
                                onChange={(e) => setBonusPoints(parseInt(e.target.value || '0', 10) || 0)}
                            />
                            <p className="text-xs text-muted-foreground">Suggested default: 50 points.</p>
                        </div>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Point Value (RM)</Label>
                            <Input value={pointValueRm.toFixed(2)} readOnly disabled />
                            <p className="text-xs text-muted-foreground">This follows the organization point value configured under Point Collection.</p>
                        </div>
                        <div className="space-y-2">
                            <Label>Estimated Cost Per Qualified User</Label>
                            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                                RM {estimatedCost.toFixed(2)}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {bonusMode === 'conditional' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ShieldCheck className="h-5 w-5 text-indigo-500" />
                            Conditional Rules
                        </CardTitle>
                        <CardDescription>
                            Define the engagement requirements before the welcome bonus is released.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Minimum Valid QR Scans Per Month</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={minValidScansPerMonth}
                                    onChange={(e) => setMinValidScansPerMonth(parseInt(e.target.value || '0', 10) || 0)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Required Consecutive Months</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={requiredConsecutiveMonths}
                                    onChange={(e) => setRequiredConsecutiveMonths(parseInt(e.target.value || '0', 10) || 0)}
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="flex items-center justify-between rounded-lg border p-4">
                                <div>
                                    <Label className="font-medium">Only Count Unique / New QR Scans</Label>
                                    <p className="text-xs text-muted-foreground mt-1">Recommended to reduce abuse from repeat scans.</p>
                                </div>
                                <Switch checked={onlyUniqueQrScans} onCheckedChange={setOnlyUniqueQrScans} />
                            </div>
                            <div className="flex items-center justify-between rounded-lg border p-4">
                                <div>
                                    <Label className="font-medium">Grace Rule For Missed Month</Label>
                                    <p className="text-xs text-muted-foreground mt-1">Allow one non-qualifying month before the streak resets.</p>
                                </div>
                                <Switch checked={allowGraceMonth} onCheckedChange={setAllowGraceMonth} />
                            </div>
                        </div>

                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Bonus Expiry After Unlock (Optional)</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={bonusExpiryDays ?? ''}
                                    onChange={(e) => setBonusExpiryDays(e.target.value ? parseInt(e.target.value, 10) : null)}
                                    placeholder="Leave blank for no expiry"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Max Bonus Claims Per User</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={maxBonusClaimsPerUser}
                                    onChange={(e) => setMaxBonusClaimsPerUser(parseInt(e.target.value || '1', 10) || 1)}
                                />
                                <p className="text-xs text-muted-foreground">Recommended to keep at 1 for a one-time registration incentive.</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card className="border-amber-200 bg-amber-50/40">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Coins className="h-5 w-5 text-amber-600" />
                        Preview Summary
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-amber-900">{summary}</p>
                </CardContent>
            </Card>

            <div className="flex items-center gap-3 pt-4 border-t">
                <Button onClick={handleSave} disabled={saving} className="gap-2" size="lg">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? 'Saving...' : 'Save User Registration Settings'}
                </Button>
            </div>
        </div>
    )
}
