'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
  Banknote
} from 'lucide-react'
import { Database } from '@/types/database'

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
        }

        // Fetch organization settings for point value
        const { data: orgData } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', companyId)
          .single()

        if (orgData?.settings && typeof orgData.settings === 'object') {
          const settings = orgData.settings as any
          if (settings.point_value_rm !== undefined) {
            setPointValueRM(settings.point_value_rm)
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

      // Save point value to organization settings
      const { data: orgData } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', companyId)
        .single()

      const currentSettings = (orgData?.settings as any) || {}
      const newSettings = {
        ...currentSettings,
        point_value_rm: pointValueRM
      }

      const { error: settingsError } = await supabase
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', companyId)

      if (settingsError) throw settingsError

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
        setActiveRule(created)
        setAllRules([created, ...allRules])
      }
    } catch (error: any) {
      console.error('Error saving rule:', error)
      showAlert('error', `Failed to save: ${error.message}`)
    } finally {
      setSaving(false)
    }
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
          Point Collection Settings
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how many points shops collect per QR scan. Changes apply immediately to all new point collections.
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
            Set the number of points awarded to shops for each consumer QR scan
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Points Per Scan Input */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="pointsPerScan" className="text-base font-semibold">
                Points Per QR Scan <span className="text-red-500">*</span>
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
                  Estimated Cost: RM {(pointsPerScan * pointValueRM).toFixed(2)} per scan
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
                  className={`flex items-center justify-between p-3 border rounded-lg ${
                    rule.is_active ? 'bg-primary/5 border-primary/30' : 'bg-muted/30'
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
                <li>• Shops scan consumer QR codes through the mobile app</li>
                <li>• They authenticate with their Shop ID and password</li>
                <li>• Points are awarded automatically based on this configuration</li>
                <li>• Shops can redeem points for rewards in the catalog</li>
                <li>• All point collections are tracked in the "Shop Points Monitor" tab</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
