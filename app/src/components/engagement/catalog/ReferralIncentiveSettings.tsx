'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Settings, Save, Loader2, CheckCircle2, AlertCircle, Info,
  Banknote, TrendingUp, Shield, UserCheck, Clock, RefreshCw
} from 'lucide-react'

interface ReferralIncentiveSettingsProps {
  userProfile: any
}

interface ReferralSettings {
  id: string
  org_id: string
  enabled: boolean
  conversion_points: number
  conversion_rm: number
  include_migration_points: boolean
  min_claim_threshold_rm: number
  first_time_auto_approve: boolean
  subsequent_change_mode: 'auto' | 'approval'
  cooldown_days: number
  updated_by: string | null
  updated_at: string
}

export function ReferralIncentiveSettings({ userProfile }: ReferralIncentiveSettingsProps) {
  const supabase = createClient()
  const companyId = userProfile.organizations.id
  const isSuperAdmin = userProfile.email === 'super@dev.com'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<ReferralSettings | null>(null)
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)

  // Form state
  const [enabled, setEnabled] = useState(false)
  const [conversionPoints, setConversionPoints] = useState(1000)
  const [conversionRm, setConversionRm] = useState(1.0)
  const [includeMigrationPoints, setIncludeMigrationPoints] = useState(false)
  const [minClaimThreshold, setMinClaimThreshold] = useState(10.0)
  const [firstTimeAutoApprove, setFirstTimeAutoApprove] = useState(true)
  const [subsequentChangeMode, setSubsequentChangeMode] = useState<'auto' | 'approval'>('auto')
  const [cooldownDays, setCooldownDays] = useState(0)

  const showAlert = (type: 'success' | 'error' | 'info', message: string) => {
    setAlert({ type, message })
    setTimeout(() => setAlert(null), 5000)
  }

  useEffect(() => {
    async function fetchSettings() {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('referral_incentive_settings')
          .select('*')
          .eq('org_id', companyId)
          .single()

        if (error && error.code !== 'PGRST116') throw error

        if (data) {
          setSettings(data as ReferralSettings)
          setEnabled(data.enabled)
          setConversionPoints(data.conversion_points)
          setConversionRm(Number(data.conversion_rm))
          setIncludeMigrationPoints(data.include_migration_points)
          setMinClaimThreshold(Number(data.min_claim_threshold_rm))
          setFirstTimeAutoApprove(data.first_time_auto_approve)
          setSubsequentChangeMode(data.subsequent_change_mode as 'auto' | 'approval')
          setCooldownDays(data.cooldown_days)
        }
      } catch (error: any) {
        console.error('Error fetching referral settings:', error)
        showAlert('error', 'Failed to load referral incentive settings')
      } finally {
        setLoading(false)
      }
    }
    fetchSettings()
  }, [companyId, supabase])

  const handleSave = async () => {
    if (!isSuperAdmin) {
      showAlert('error', 'Only super admin (super@dev.com) can modify these settings.')
      return
    }

    try {
      setSaving(true)

      if (conversionPoints < 1) {
        showAlert('error', 'Conversion points must be at least 1')
        return
      }
      if (conversionRm <= 0) {
        showAlert('error', 'Conversion RM must be greater than 0')
        return
      }

      const payload = {
        org_id: companyId,
        enabled,
        conversion_points: conversionPoints,
        conversion_rm: conversionRm,
        include_migration_points: includeMigrationPoints,
        min_claim_threshold_rm: minClaimThreshold,
        first_time_auto_approve: firstTimeAutoApprove,
        subsequent_change_mode: subsequentChangeMode,
        cooldown_days: cooldownDays,
        updated_by: userProfile.id,
        updated_at: new Date().toISOString(),
      }

      if (settings) {
        const { error } = await supabase
          .from('referral_incentive_settings')
          .update(payload)
          .eq('id', settings.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('referral_incentive_settings')
          .insert(payload)
        if (error) throw error
      }

      showAlert('success', 'Referral incentive settings saved successfully!')

      // Refresh
      const { data: refreshed } = await supabase
        .from('referral_incentive_settings')
        .select('*')
        .eq('org_id', companyId)
        .single()
      if (refreshed) setSettings(refreshed as ReferralSettings)

    } catch (error: any) {
      console.error('Error saving referral settings:', error)
      showAlert('error', `Failed to save: ${error.message}`)
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
      {/* Header */}
      <div>
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Referral Incentive Settings
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how referral/reference marketing persons earn incentives from shop activity.
        </p>
      </div>

      {!isSuperAdmin && (
        <Alert className="border-amber-200 bg-amber-50">
          <Shield className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-900">
            Only super admin (super@dev.com) can modify referral incentive settings. Contact your administrator.
          </AlertDescription>
        </Alert>
      )}

      {alert && (
        <Alert className={
          alert.type === 'error' ? 'border-red-200 bg-red-50' :
          alert.type === 'success' ? 'border-green-200 bg-green-50' :
          'border-blue-200 bg-blue-50'
        }>
          {alert.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
          {alert.type === 'error' && <AlertCircle className="h-4 w-4 text-red-600" />}
          {alert.type === 'info' && <Info className="h-4 w-4 text-blue-600" />}
          <AlertDescription className={
            alert.type === 'error' ? 'text-red-900' :
            alert.type === 'success' ? 'text-green-900' :
            'text-blue-900'
          }>
            {alert.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Master Toggle */}
      <Card className={enabled ? 'border-green-200 bg-green-50/30' : 'border-muted'}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base font-semibold">Enable Referral Incentives</Label>
              <p className="text-sm text-muted-foreground">
                When enabled, marketing persons (references) earn incentives based on eligible shop scan/points activity.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!isSuperAdmin}
            />
          </div>
          <Badge variant={enabled ? 'default' : 'secondary'} className="mt-3">
            {enabled ? 'Active' : 'Disabled'}
          </Badge>
        </CardContent>
      </Card>

      {/* Conversion Rate */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="h-5 w-5 text-green-600" />
            Points to RM Conversion
          </CardTitle>
          <CardDescription>
            Define the conversion rate between points and Ringgit Malaysia (RM)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="conversionPoints" className="font-medium">
                Points <span className="text-red-500">*</span>
              </Label>
              <Input
                id="conversionPoints"
                type="number"
                min={1}
                value={conversionPoints}
                onChange={e => setConversionPoints(parseInt(e.target.value) || 1)}
                disabled={!isSuperAdmin}
                className="text-lg font-semibold"
              />
              <p className="text-xs text-muted-foreground">Number of points</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="conversionRm" className="font-medium">
                = RM <span className="text-red-500">*</span>
              </Label>
              <Input
                id="conversionRm"
                type="number"
                min={0.01}
                step={0.01}
                value={conversionRm}
                onChange={e => setConversionRm(parseFloat(e.target.value) || 0.01)}
                disabled={!isSuperAdmin}
                className="text-lg font-semibold"
              />
              <p className="text-xs text-muted-foreground">Equivalent in RM</p>
            </div>
          </div>
          <div className="text-sm font-medium text-blue-600 bg-blue-50 p-2 rounded border border-blue-100 inline-block">
            Example: {conversionPoints.toLocaleString()} points = RM {conversionRm.toFixed(2)} | 1 point = RM {(conversionRm / conversionPoints).toFixed(6)}
          </div>
        </CardContent>
      </Card>

      {/* Migration Points */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-purple-500" />
                Include Migration Points
              </Label>
              <p className="text-sm text-muted-foreground">
                When ON, imported/migrated points (from Kit/Batch migration) will also generate referral incentive accrual.
                When OFF, only QR scan points count.
              </p>
            </div>
            <Switch
              checked={includeMigrationPoints}
              onCheckedChange={setIncludeMigrationPoints}
              disabled={!isSuperAdmin}
            />
          </div>
          <Badge variant={includeMigrationPoints ? 'default' : 'outline'} className="mt-3">
            {includeMigrationPoints ? 'Migration Points Included' : 'Migration Points Excluded'}
          </Badge>
        </CardContent>
      </Card>

      {/* Minimum Claim Threshold */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label htmlFor="minClaimThreshold" className="text-base font-semibold flex items-center gap-2">
            <Banknote className="h-4 w-4 text-amber-500" />
            Minimum Claim Threshold (RM)
          </Label>
          <div className="flex items-center gap-4">
            <Input
              id="minClaimThreshold"
              type="number"
              min={0}
              step={1}
              value={minClaimThreshold}
              onChange={e => setMinClaimThreshold(parseFloat(e.target.value) || 0)}
              disabled={!isSuperAdmin}
              className="max-w-xs text-lg font-semibold"
            />
            <span className="text-sm text-muted-foreground">RM</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Marketing persons must have at least this RM amount to submit a claim. Set to 0 to disable.
          </p>
        </CardContent>
      </Card>

      {/* Reference Change Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCheck className="h-5 w-5 text-indigo-500" />
            Reference Change Policy
          </CardTitle>
          <CardDescription>
            Control how reference (marketing person) assignments are set and changed from mobile app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* First-time set */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <Label className="font-medium">First-time Reference Set</Label>
              <p className="text-xs text-muted-foreground">
                When a shop sets their reference for the first time, auto-approve immediately (no HQ review needed).
              </p>
            </div>
            <Switch
              checked={firstTimeAutoApprove}
              onCheckedChange={setFirstTimeAutoApprove}
              disabled={!isSuperAdmin}
            />
          </div>

          {/* Subsequent changes */}
          <div className="space-y-2 p-4 border rounded-lg">
            <Label className="font-medium">Subsequent Reference Changes</Label>
            <p className="text-xs text-muted-foreground mb-3">
              When a shop changes their existing reference to a different marketing person.
            </p>
            <Select
              value={subsequentChangeMode}
              onValueChange={(v) => setSubsequentChangeMode(v as 'auto' | 'approval')}
              disabled={!isSuperAdmin}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-3 w-3" />
                    Auto-change (monitor only)
                  </div>
                </SelectItem>
                <SelectItem value="approval">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3 w-3" />
                    Require HQ Approval
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            {subsequentChangeMode === 'auto' && (
              <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded mt-1">
                Changes take effect immediately. All changes are logged for audit.
              </p>
            )}
            {subsequentChangeMode === 'approval' && (
              <p className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded mt-1">
                Changes require HQ admin approval before taking effect. Shop will see "Pending" status.
              </p>
            )}
          </div>

          {/* Cooldown */}
          <div className="space-y-2 p-4 border rounded-lg">
            <Label htmlFor="cooldownDays" className="font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Cooldown Period Between Changes
            </Label>
            <div className="flex items-center gap-4">
              <Input
                id="cooldownDays"
                type="number"
                min={0}
                max={365}
                value={cooldownDays}
                onChange={e => setCooldownDays(parseInt(e.target.value) || 0)}
                disabled={!isSuperAdmin}
                className="max-w-[120px]"
              />
              <span className="text-sm text-muted-foreground">days (0 = no cooldown)</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Minimum number of days a shop must wait between reference changes.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center gap-3 pt-4 border-t">
        <Button
          onClick={handleSave}
          disabled={saving || !isSuperAdmin}
          className="gap-2"
          size="lg"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Referral Settings
            </>
          )}
        </Button>
        {settings?.updated_at && (
          <p className="text-xs text-muted-foreground">
            Last updated: {new Date(settings.updated_at).toLocaleString('en-MY')}
          </p>
        )}
      </div>

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-100 p-2">
              <Info className="h-5 w-5 text-blue-600" />
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-medium text-blue-900">How Referral Incentives Work</p>
              <ul className="space-y-1 text-blue-800/80">
                <li>• Each shop/consumer can be assigned a Reference (marketing person)</li>
                <li>• When a shop scans QR and earns points, the assigned Reference earns incentive accrual</li>
                <li>• Accrual is converted to RM based on the conversion rate set above</li>
                <li>• References can submit claims; HQ/Manager must approve before payout</li>
                <li>• All reference changes are logged with full audit trail</li>
                <li>• Incentive accrual only applies from the assignment effective date (no retroactive)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
