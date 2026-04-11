'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertCircle, CheckCircle2, Coins, Info, Loader2, Map, Save, Sparkles } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

interface RoadtourRewardSettingsProps {
  userProfile: any
}

interface RoadtourSettingsRow {
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
}

export function RoadtourRewardSettings({ userProfile }: RoadtourRewardSettingsProps) {
  const supabase = createClient()
  const companyId = userProfile.organizations.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [defaultPoints, setDefaultPoints] = useState(20)
  const [rewardMode, setRewardMode] = useState<'direct_scan' | 'survey_submit'>('survey_submit')
  const [surveyTemplateId, setSurveyTemplateId] = useState<string | null>(null)
  const [pointValueRm, setPointValueRm] = useState(0.1)
  const [surveyTemplates, setSurveyTemplates] = useState<{ id: string; name: string }[]>([])
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)

  const showAlert = (type: 'success' | 'error' | 'info', message: string) => {
    setAlert({ type, message })
    setTimeout(() => setAlert(null), 5000)
  }

  useEffect(() => {
    async function loadSettings() {
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

        const { data: templates } = await (supabase as any)
          .from('roadtour_survey_templates')
          .select('id, name')
          .eq('org_id', companyId)
          .eq('is_active', true)
          .order('name')

        setSurveyTemplates(templates || [])

        const { data, error } = await (supabase as any)
          .from('roadtour_settings')
          .select('*')
          .eq('org_id', companyId)
          .maybeSingle()

        if (error && error.code !== 'PGRST116') throw error

        if (data) {
          const row = data as RoadtourSettingsRow
          setSettingsId(row.id)
          setDefaultPoints(row.default_points)
          setRewardMode(row.reward_mode)
          setSurveyTemplateId(row.survey_template_id)
          if (row.point_value_rm_snapshot != null) setPointValueRm(row.point_value_rm_snapshot)
        }
      } catch (error: any) {
        console.error('Error loading RoadTour reward settings:', error)
        showAlert('error', 'Failed to load RoadTour reward settings.')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [companyId, supabase])

  const estimatedCost = useMemo(() => defaultPoints * pointValueRm, [defaultPoints, pointValueRm])

  const summary = useMemo(() => {
    const parts = [`Each successful RoadTour reward grants ${defaultPoints} points.`]
    parts.push(`Estimated cost per reward: RM ${estimatedCost.toFixed(2)}.`)
    parts.push(rewardMode === 'survey_submit'
      ? 'Reward will be released after survey submission.'
      : 'Reward will be released immediately after a valid scan.')
    return parts
  }, [defaultPoints, estimatedCost, rewardMode])

  const handleSave = async () => {
    try {
      setSaving(true)

      if (defaultPoints < 1) {
        showAlert('error', 'Default reward points must be at least 1.')
        return
      }

      const payload = {
        org_id: companyId,
        default_points: defaultPoints,
        reward_mode: rewardMode,
        survey_template_id: rewardMode === 'survey_submit' ? surveyTemplateId : null,
        point_value_rm_snapshot: pointValueRm,
        updated_by: userProfile.id,
        updated_at: new Date().toISOString(),
      }

      if (settingsId) {
        const { error } = await (supabase as any)
          .from('roadtour_settings')
          .update(payload)
          .eq('id', settingsId)
        if (error) throw error
      } else {
        const insertPayload = {
          ...payload,
          is_enabled: true,
          qr_mode: 'persistent',
          duplicate_rule_reward: 'one_per_user_per_campaign',
          official_visit_rule: 'one_per_shop_per_am_per_day',
          require_login: true,
          require_shop_context: true,
          require_geolocation: false,
          qr_expiry_hours: null,
          whatsapp_send_enabled: true,
          is_active: true,
          created_by: userProfile.id,
        }

        const { data, error } = await (supabase as any)
          .from('roadtour_settings')
          .insert(insertPayload)
          .select('id')
          .single()
        if (error) throw error
        setSettingsId(data.id)
      }

      showAlert('success', 'RoadTour reward settings saved successfully.')
      toast({ title: 'Settings Saved', description: 'RoadTour reward settings saved successfully.' })
    } catch (error: any) {
      console.error('Error saving RoadTour reward settings:', error)
      showAlert('error', error.message || 'Failed to save RoadTour reward settings.')
      toast({ title: 'Save Failed', description: error.message || 'Failed to save settings.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  }

  return (
    <div className="space-y-6">
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

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Map className="h-5 w-5 text-primary" />RoadTour Reward Points</CardTitle>
          <CardDescription>Manage RoadTour reward points from the same point settings workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Default Reward Points</Label>
              <Input type="number" min={1} value={defaultPoints} onChange={(e) => setDefaultPoints(parseInt(e.target.value || '0', 10) || 0)} />
              <p className="text-xs text-muted-foreground">Suggested: 20 points per successful RoadTour reward.</p>
            </div>
            <div className="space-y-2">
              <Label>Point Value (RM)</Label>
              <Input value={pointValueRm.toFixed(2)} readOnly disabled />
              <p className="text-xs text-muted-foreground">This follows the organization point value configured under Point Collection.</p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Estimated Cost Per Reward</Label>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">RM {estimatedCost.toFixed(2)}</div>
            </div>
            <div className="space-y-2">
              <Label>Reward Mode</Label>
              <Select value={rewardMode} onValueChange={(value) => setRewardMode(value as 'direct_scan' | 'survey_submit')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_scan">Direct Reward After Valid Scan</SelectItem>
                  <SelectItem value="survey_submit">Reward After Survey Submission</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {rewardMode === 'survey_submit' && (
            <div className="space-y-2">
              <Label>Survey Template</Label>
              <Select value={surveyTemplateId || ''} onValueChange={(value) => setSurveyTemplateId(value || null)}>
                <SelectTrigger><SelectValue placeholder="Select survey template..." /></SelectTrigger>
                <SelectContent>
                  {surveyTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                  {surveyTemplates.length === 0 && <SelectItem value="" disabled>No templates available</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-3 pt-4 border-t">
            <Button onClick={handleSave} disabled={saving} className="gap-2" size="lg">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : 'Save RoadTour Reward Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-5 w-5 text-amber-600" />Preview Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1">
            {summary.map((item, index) => <li key={index} className="text-sm text-amber-900">• {item}</li>)}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-100 p-2">
              <Coins className="h-5 w-5 text-blue-600" />
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-medium text-blue-900">Why RoadTour rewards live here now</p>
              <ul className="space-y-1 text-blue-800/80">
                <li>• Point value, reward points, and registration bonus are managed in one place</li>
                <li>• Budget estimation stays aligned with your main point configuration</li>
                <li>• RoadTour operational controls remain under the RoadTour module</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}