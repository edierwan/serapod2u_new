'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Settings,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Coins,
  TrendingUp,
  Calendar,
  Info,
  Banknote,
  PlayCircle,
  Users,
} from 'lucide-react'
import { Database } from '@/types/database'
import { ReferralIncentiveSettings } from './ReferralIncentiveSettings'
import { RoadtourRewardSettings } from './RoadtourRewardSettings'
import { UserRegistrationBonusSettings } from './UserRegistrationBonusSettings'
import { normalizePointClaimSettings, type PointClaimMode } from '@/lib/engagement/point-claim-settings'
import { DEFAULT_REPORT_STATUS_SETTINGS, describeReportStatusRule, normalizeReportStatusSettings, type ReportStatusSettings, type ReportStatusTarget } from '@/lib/engagement/report-status-settings'
import { toast } from '@/components/ui/use-toast'

type PointsRuleRow = Database['public']['Tables']['points_rules']['Row']
type PointsRuleInsert = Database['public']['Tables']['points_rules']['Insert']
type PointsRuleUpdate = Database['public']['Tables']['points_rules']['Update']

interface PointsConfigurationSettingsProps {
  userProfile: any
}

export function PointsConfigurationSettings({ userProfile }: PointsConfigurationSettingsProps) {
  const supabase = createClient()
  const companyId = userProfile.organizations.id

  // State
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeRule, setActiveRule] = useState<PointsRuleRow | null>(null)
  const [allRules, setAllRules] = useState<PointsRuleRow[]>([])

  // Form state
  const [pointsPerScan, setPointsPerScan] = useState<number>(50)
  const [pointValueRM, setPointValueRM] = useState<number>(0.01)
  const [ruleName, setRuleName] = useState<string>('Default Point Collection Rule')
  const [expiresAfterDays, setExpiresAfterDays] = useState<number | null>(null)
  const [allowManualAdjustment, setAllowManualAdjustment] = useState<boolean>(true)
  const [migrationMultiplier, setMigrationMultiplier] = useState<number | null>(null)
  const [pointClaimMode, setPointClaimMode] = useState<PointClaimMode>('single_shop')
  const [consumerPointsPerScan, setConsumerPointsPerScan] = useState<number>(50)
  const [mediaDisplayDuration, setMediaDisplayDuration] = useState<number>(3)
  const [reportStatusSettings, setReportStatusSettings] = useState<ReportStatusSettings>(DEFAULT_REPORT_STATUS_SETTINGS)

  // Sub-tab state
  const [settingsTab, setSettingsTab] = useState<'points' | 'roadtour' | 'registration' | 'media' | 'referral' | 'status'>('points')

  // Alert state
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null)

  const showAlert = (type: 'success' | 'error' | 'info', message: string) => {
    setAlert({ type, message })
    setTimeout(() => setAlert(null), 5000)
  }

  // Fetch existing rules
  useEffect(() => {
    async function fetchRules() {
      try {
        setLoading(true)

        // Fetch all rules for this organization
        const { data: rules, error: rulesError } = await supabase
          .from('points_rules')
          .select('*')
          .eq('org_id', companyId)
          .order('created_at', { ascending: false })

        if (rulesError) throw rulesError

        setAllRules(rules || [])

        // Find the active rule
        const active = rules?.find(r => r.is_active) || null
        setActiveRule(active)

        // Populate form with active rule or defaults
        if (active) {
          setPointsPerScan(active.points_per_scan)
          setRuleName(active.name)
          setExpiresAfterDays(active.expires_after_days)
          setAllowManualAdjustment(active.allow_manual_adjustment)
          setConsumerPointsPerScan(active.points_per_scan)
        }

        // Fetch organization settings for point value
        const { data: orgData } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', companyId)
          .single()

        if (orgData?.settings && typeof orgData.settings === 'object') {
          const settings = orgData.settings as any
          const claimSettings = normalizePointClaimSettings(settings, active?.points_per_scan || 50)
          setPointValueRM(claimSettings.pointValueRM)
          setPointClaimMode(claimSettings.claimMode)
          setConsumerPointsPerScan(claimSettings.consumerPointsPerScan)
          setReportStatusSettings(normalizeReportStatusSettings(settings))
          if (settings.migration_multiplier !== undefined) {
            setMigrationMultiplier(settings.migration_multiplier)
          }
          if (settings.media_display_duration !== undefined) {
            setMediaDisplayDuration(settings.media_display_duration)
          }
        }
      } catch (error: any) {
        console.error('Error fetching rules:', error)
        showAlert('error', 'Failed to load point configuration')
      } finally {
        setLoading(false)
      }
    }

    fetchRules()
  }, [companyId, supabase])

  // Save/Update rule
  const handleSave = async () => {
    try {
      setSaving(true)

      // Validate
      if (!pointsPerScan || pointsPerScan < 1) {
        showAlert('error', 'Points per scan must be at least 1')
        return
      }

      if (pointsPerScan > 10000) {
        showAlert('error', 'Points per scan cannot exceed 10,000')
        return
      }

      if (pointClaimMode === 'dual' && consumerPointsPerScan < 1) {
        showAlert('error', 'Consumer points per scan must be at least 1 when dual claim is enabled')
        return
      }

      const invalidActivityRule = Object.values(reportStatusSettings).find((rule) => rule.mode === 'activity' && rule.inactiveAfterDays < 1)
      if (invalidActivityRule) {
        showAlert('error', 'Inactive days must be at least 1 for activity-based rules')
        return
      }

      // Save point value to organization settings
      const { data: orgData } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', companyId)
        .single()

      const currentSettings = (orgData?.settings as any) || {}
      const newSettings = {
        ...currentSettings,
        point_value_rm: pointValueRM,
        migration_multiplier: migrationMultiplier,
        media_display_duration: mediaDisplayDuration,
        point_claim_mode: pointClaimMode,
        consumer_points_per_scan: consumerPointsPerScan,
        report_status_settings: reportStatusSettings,
      }

      const { error: settingsError } = await supabase
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', companyId)

      if (settingsError) throw settingsError

      await (supabase as any)
        .from('roadtour_settings')
        .update({
          point_value_rm_snapshot: pointValueRM,
          updated_by: userProfile.id,
          updated_at: new Date().toISOString(),
        })
        .eq('org_id', companyId)

      if (activeRule) {
        // Update existing rule
        const updates: PointsRuleUpdate = {
          points_per_scan: pointsPerScan,
          name: ruleName,
          expires_after_days: expiresAfterDays,
          allow_manual_adjustment: allowManualAdjustment,
        }

        const { error: updateError } = await supabase
          .from('points_rules')
          .update(updates)
          .eq('id', activeRule.id)

        if (updateError) throw updateError

        showAlert('success', 'Point configuration updated successfully!')
        toast({ title: 'Settings Saved', description: 'Point collection and report status settings updated successfully.' })

        // Refresh the rule
        const { data: updated } = await supabase
          .from('points_rules')
          .select('*')
          .eq('id', activeRule.id)
          .single()

        if (updated) setActiveRule(updated)
      } else {
        // Create new rule (deactivate any existing active rules first)
        if (allRules.some(r => r.is_active)) {
          await supabase
            .from('points_rules')
            .update({ is_active: false })
            .eq('org_id', companyId)
            .eq('is_active', true)
        }

        const newRule: PointsRuleInsert = {
          org_id: companyId,
          name: ruleName,
          points_per_scan: pointsPerScan,
          expires_after_days: expiresAfterDays,
          allow_manual_adjustment: allowManualAdjustment,
          is_active: true,
          created_by: userProfile.id,
        }

        const { data: created, error: createError } = await supabase
          .from('points_rules')
          .insert(newRule)
          .select()
          .single()

        if (createError) throw createError

        showAlert('success', 'Point configuration created successfully!')
        toast({ title: 'Settings Saved', description: 'Initial point collection settings created successfully.' })
        setActiveRule(created)
        setAllRules([created, ...allRules])
      }
    } catch (error: any) {
      console.error('Error saving rule:', error)
      showAlert('error', `Failed to save: ${error.message}`)
      toast({ title: 'Save Failed', description: error.message || 'Failed to save settings.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleClaimModeChange = (mode: PointClaimMode) => {
    if (mode === pointClaimMode) return
    setPointClaimMode(mode)
    const description = mode === 'single_shop'
      ? 'Shop Staff Only selected. QR point claim stays on the previous shop staff flow after you save.'
      : 'Dual Claim selected. Shop staff and consumer lanes will both be enabled after you save.'
    showAlert('info', description)
    toast({ title: 'Claim Mode Changed', description })
  }

  const updateReportStatusRule = (target: ReportStatusTarget, patch: Partial<ReportStatusSettings[ReportStatusTarget]>) => {
    setReportStatusSettings((current) => ({
      ...current,
      [target]: {
        ...current[target],
        ...patch,
      },
    }))
  }

  // Activate a different rule
  const handleActivateRule = async (ruleId: string) => {
    try {
      setSaving(true)

      // Deactivate all rules
      await supabase
        .from('points_rules')
        .update({ is_active: false })
        .eq('org_id', companyId)

      // Activate selected rule
      const { data: activated, error } = await supabase
        .from('points_rules')
        .update({ is_active: true })
        .eq('id', ruleId)
        .select()
        .single()

      if (error) throw error

      setActiveRule(activated)
      showAlert('success', 'Point configuration activated!')

      // Refresh all rules
      const { data: refreshed } = await supabase
        .from('points_rules')
        .select('*')
        .eq('org_id', companyId)
        .order('created_at', { ascending: false })

      if (refreshed) setAllRules(refreshed)
    } catch (error: any) {
      console.error('Error activating rule:', error)
      showAlert('error', `Failed to activate: ${error.message}`)
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
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" />
          Settings
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure point collection, RoadTour reward points, registration bonus, and media display settings for your organization.
        </p>
      </div>

      {/* Alert */}
      {alert && (
        <Alert className={alert.type === 'error' ? 'border-red-200 bg-red-50' : alert.type === 'success' ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'}>
          {alert.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
          {alert.type === 'error' && <AlertCircle className="h-4 w-4 text-red-600" />}
          {alert.type === 'info' && <Info className="h-4 w-4 text-blue-600" />}
          <AlertDescription className={alert.type === 'error' ? 'text-red-900' : alert.type === 'success' ? 'text-green-900' : 'text-blue-900'}>
            {alert.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Sub-tabs */}
      <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as 'points' | 'roadtour' | 'registration' | 'media' | 'referral' | 'status')}>
        <TabsList className="grid w-full max-w-6xl grid-cols-6">
          <TabsTrigger value="points" className="gap-2">
            <Coins className="h-4 w-4" />
            Point Collection
          </TabsTrigger>
          <TabsTrigger value="roadtour" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            RoadTour Rewards
          </TabsTrigger>
          <TabsTrigger value="registration" className="gap-2">
            <Calendar className="h-4 w-4" />
            User Registration
          </TabsTrigger>
          <TabsTrigger value="media" className="gap-2">
            <PlayCircle className="h-4 w-4" />
            Media Display
          </TabsTrigger>
          <TabsTrigger value="referral" className="gap-2">
            <Banknote className="h-4 w-4" />
            Referral Incentives
          </TabsTrigger>
          <TabsTrigger value="status" className="gap-2">
            <Users className="h-4 w-4" />
            Report Status
          </TabsTrigger>
        </TabsList>

        {/* Point Collection Settings Tab */}
        <TabsContent value="points" className="space-y-6 mt-6">

          {/* Main Configuration Card */}
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-amber-500" />
                Active Point Configuration
                {activeRule && (
                  <Badge variant="default" className="ml-2">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Active
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Configure whether QR point claim stays with shop staff only or runs in dual-claim mode with a separate consumer point value.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-semibold">Claim Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      Shop Staff Only keeps the previous single-claim behavior. Dual Claim allows both shop staff and consumer to collect on separate lanes.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={pointClaimMode === 'single_shop' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleClaimModeChange('single_shop')}
                    >
                      Shop Staff Only
                    </Button>
                    <Button
                      type="button"
                      variant={pointClaimMode === 'dual' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleClaimModeChange('dual')}
                    >
                      Dual Claim
                    </Button>
                  </div>
                </div>
              </div>

              {/* Points Per Scan Input */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="pointsPerScan" className="text-base font-semibold">
                    Shop Staff Points Per QR Scan <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-4">
                    <div className="relative flex-1 max-w-xs">
                      <Coins className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="pointsPerScan"
                        type="number"
                        min="1"
                        max="10000"
                        value={pointsPerScan}
                        onChange={(e) => setPointsPerScan(parseInt(e.target.value) || 0)}
                        className="pl-10 text-lg font-semibold"
                        placeholder="50"
                      />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      points per scan
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Recommended: 10-100 points.
                  </p>
                  {pointsPerScan > 0 && pointValueRM > 0 && (
                    <div className="text-sm font-medium text-blue-600 bg-blue-50 p-2 rounded border border-blue-100 inline-block">
                      Shop Staff Cost: RM {(pointsPerScan * pointValueRM).toFixed(2)} per scan
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="consumerPointsPerScan" className="text-base font-semibold">
                    Consumer Points Per QR Scan
                  </Label>
                  <div className="flex items-center gap-4">
                    <div className="relative flex-1 max-w-xs">
                      <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="consumerPointsPerScan"
                        type="number"
                        min="0"
                        max="10000"
                        value={consumerPointsPerScan}
                        onChange={(e) => setConsumerPointsPerScan(parseInt(e.target.value) || 0)}
                        className="pl-10 text-lg font-semibold"
                        placeholder="50"
                      />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      points per scan
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Used when claim mode is Dual Claim.
                  </p>
                  {consumerPointsPerScan > 0 && pointValueRM > 0 && (
                    <div className="text-sm font-medium text-emerald-700 bg-emerald-50 p-2 rounded border border-emerald-100 inline-block">
                      Consumer Cost: RM {(consumerPointsPerScan * pointValueRM).toFixed(2)} per scan
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pointValueRM" className="text-base font-semibold">
                    Point Value (RM)
                  </Label>
                  <div className="flex items-center gap-4">
                    <div className="relative flex-1 max-w-xs">
                      <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="pointValueRM"
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={pointValueRM}
                        onChange={(e) => setPointValueRM(parseFloat(e.target.value) || 0)}
                        className="pl-10 text-lg font-semibold"
                        placeholder="0.01"
                      />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      RM per point
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Internal reference value for budget estimation.
                  </p>
                </div>
              </div>

              {/* Migration Point Multiplier - New Section */}
              <div className="space-y-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <Label htmlFor="migrationMultiplier" className="text-base font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-amber-600" />
                  Migration Point Multiplier (Optional)
                </Label>
                <div className="flex items-center gap-4">
                  <div className="relative flex-1 max-w-xs">
                    <Input
                      id="migrationMultiplier"
                      type="number"
                      min="1"
                      max="100"
                      value={migrationMultiplier || ''}
                      onChange={(e) => setMigrationMultiplier(e.target.value ? parseInt(e.target.value) : null)}
                      className="text-lg font-semibold"
                      placeholder="None (no multiplier)"
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    times multiplier
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  When set, imported points during migration will be multiplied by this value.
                </p>
                {migrationMultiplier && migrationMultiplier > 1 && (
                  <div className="text-sm font-medium text-amber-700 bg-amber-100 p-2 rounded border border-amber-200 mt-2">
                    <strong>Example:</strong> If user has 100 points in file, they will receive {100 * migrationMultiplier} points after migration.
                  </div>
                )}
              </div>

              {/* Rule Name */}
              <div className="space-y-2">
                <Label htmlFor="ruleName">
                  Rule Name
                </Label>
                <Input
                  id="ruleName"
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g., Default Point Collection Rule"
                />
                <p className="text-xs text-muted-foreground">
                  Internal name for this configuration (for your reference)
                </p>
              </div>

              {/* Points Expiry */}
              <div className="space-y-2">
                <Label htmlFor="expiresAfterDays" className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Points Expiry (Optional)
                </Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="expiresAfterDays"
                    type="number"
                    min="0"
                    value={expiresAfterDays || ''}
                    onChange={(e) => setExpiresAfterDays(e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="Leave empty for no expiry"
                    className="max-w-xs"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  If set, points will expire after this many days. Leave empty for points that never expire.
                </p>
              </div>

              {/* Manual Adjustment Toggle */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label className="text-base font-medium">
                    Allow Manual Point Adjustments
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Enable admins to manually adjust shop point balances
                  </p>
                </div>
                <Button
                  variant={allowManualAdjustment ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAllowManualAdjustment(!allowManualAdjustment)}
                >
                  {allowManualAdjustment ? 'Enabled' : 'Disabled'}
                </Button>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3 pt-4 border-t">
                <Button
                  onClick={handleSave}
                  disabled={saving || pointsPerScan < 1}
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
                      {activeRule ? 'Update Configuration' : 'Create Configuration'}
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Changes will apply immediately to all new point collections
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Previous Configurations */}
          {allRules.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Configuration History
                </CardTitle>
                <CardDescription>
                  Previous point collection configurations for this organization
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {allRules.map((rule) => (
                    <div
                      key={rule.id}
                      className={`flex items-center justify-between p-3 border rounded-lg ${rule.is_active ? 'bg-primary/5 border-primary/30' : 'bg-muted/30'
                        }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{rule.name}</p>
                          {rule.is_active && (
                            <Badge variant="default" className="text-xs">
                              Active
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Coins className="h-3 w-3" />
                            {rule.points_per_scan} points/scan
                          </span>
                          {rule.expires_after_days && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Expires in {rule.expires_after_days} days
                            </span>
                          )}
                          <span>
                            Created {new Date(rule.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      {!rule.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleActivateRule(rule.id)}
                          disabled={saving}
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Info Card */}
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-blue-100 p-2">
                  <Info className="h-5 w-5 text-blue-600" />
                </div>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-blue-900">How Point Collection Works</p>
                  <ul className="space-y-1 text-blue-800/80">
                    <li>• Shop staff scans use the shop lane and follow the shop staff point amount above</li>
                    <li>• Single claim mode preserves the previous flow where only shop staff can claim QR points</li>
                    <li>• Dual claim mode enables an additional consumer lane with its own point amount</li>
                    <li>• Each lane is tracked separately in reporting so staging tests can surface split behavior clearly</li>
                    <li>• Shop and consumer balances will now follow the selected claim mode instead of one shared fallback</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roadtour" className="space-y-6 mt-6">
          <RoadtourRewardSettings userProfile={userProfile} />
        </TabsContent>

        <TabsContent value="registration" className="space-y-6 mt-6">
          <UserRegistrationBonusSettings userProfile={userProfile} />
        </TabsContent>

        {/* Media Display Settings Tab */}
        <TabsContent value="media" className="space-y-6 mt-6">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlayCircle className="h-5 w-5 text-primary" />
                Media Display Duration
              </CardTitle>
              <CardDescription>
                Configure how long each image is displayed in reward carousels before automatically advancing to the next
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="mediaDisplayDuration" className="text-base font-semibold">
                  Display Duration (Seconds) <span className="text-red-500">*</span>
                </Label>
                <div className="flex items-center gap-4">
                  <div className="relative flex-1 max-w-xs">
                    <PlayCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="mediaDisplayDuration"
                      type="number"
                      min="1"
                      max="30"
                      value={mediaDisplayDuration}
                      onChange={(e) => setMediaDisplayDuration(parseInt(e.target.value) || 3)}
                      className="pl-10 text-lg font-semibold"
                      placeholder="3"
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    seconds per image
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recommended: 3-5 seconds. This applies to all reward image carousels.
                </p>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3 pt-4 border-t">
                <Button
                  onClick={handleSave}
                  disabled={saving || mediaDisplayDuration < 1}
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
                      Save Media Settings
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Changes will apply to all reward displays
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-blue-100 p-2">
                  <Info className="h-5 w-5 text-blue-600" />
                </div>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-blue-900">How Media Display Works</p>
                  <ul className="space-y-1 text-blue-800/80">
                    <li>• Rewards can have a video animation and multiple images</li>
                    <li>• When viewing a reward, the video plays first (if present)</li>
                    <li>• After the video, images cycle automatically at the set duration</li>
                    <li>• Users can also swipe manually to navigate images</li>
                    <li>• This setting applies globally to all rewards</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Referral Incentives Settings Tab */}
        <TabsContent value="referral" className="space-y-6 mt-6">
          <ReferralIncentiveSettings userProfile={userProfile} />
        </TabsContent>

        <TabsContent value="status" className="space-y-6 mt-6">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Report Status Rules
              </CardTitle>
              <CardDescription>
                Control how Active and Inactive tabs classify rows for Shop Performance, Shop Staff Performance, and Consumer Performance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {([
                ['shopPerformance', 'Shop Performance'],
                ['shopStaffPerformance', 'Shop Staff Performance'],
                ['consumerPerformance', 'Consumer Performance'],
              ] as Array<[ReportStatusTarget, string]>).map(([target, label]) => {
                const rule = reportStatusSettings[target]
                return (
                  <div key={target} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div className="space-y-1 min-w-0">
                        <Label className="text-base font-semibold">{label}</Label>
                        <p className="text-xs text-muted-foreground">{describeReportStatusRule(rule)}</p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-[220px_180px]">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Inactive rule</Label>
                          <Select
                            value={rule.mode}
                            onValueChange={(value) => updateReportStatusRule(target, { mode: value as 'balance' | 'activity' })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="balance">Balance is 0</SelectItem>
                              <SelectItem value="activity">No activity for X days</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Inactive after days</Label>
                          <Input
                            type="number"
                            min="1"
                            value={rule.inactiveAfterDays}
                            onChange={(e) => updateReportStatusRule(target, { inactiveAfterDays: parseInt(e.target.value) || 1 })}
                            disabled={rule.mode !== 'activity'}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}

              <div className="flex items-center gap-3 pt-4 border-t">
                <Button onClick={handleSave} disabled={saving} className="gap-2" size="lg">
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Report Status Rules
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">These rules drive the Active and Inactive filters across all three performance reports.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}
