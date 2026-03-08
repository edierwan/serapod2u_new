'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Settings, DollarSign, Target, Users, Calculator, Zap,
  Plus, Edit, Trash2, Save, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, Layers, Shield, RefreshCw,
  Hash, TrendingUp, Flame, PieChart, Info
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

// ── Types ───────────────────────────────────────────────────────
interface Campaign {
  id: string
  name: string
  status: string
  type?: string
}

interface RewardRule {
  id: string
  campaign_id: string
  reward_type: string
  reward_value: number
  reward_formula: string
  min_reward: number | null
  max_reward: number | null
  tier_config: any[]
}

interface QualificationRule {
  id: string
  campaign_id: string
  target_metric: string
  target_value: number
  calculation_period: string
  calculation_basis: string
  campaign_logic: string
  secondary_metric: string | null
  secondary_value: number | null
}

interface EligibilityRule {
  id: string
  campaign_id: string
  scope: string
  tier_filter: string[]
  org_ids: string[]
  region_filter: string[]
  brand_filter: string[]
  exclude_org_ids: string[]
}

interface BudgetConfig {
  id: string
  campaign_id: string
  budget_cap: number
  total_spend: number
  currency: string
  auto_pause_on_cap: boolean
}

// ── Constants ───────────────────────────────────────────────────
const REWARD_TYPES = [
  { value: 'cash', label: 'Cash (Flat)', icon: DollarSign, desc: 'Fixed amount per qualifying distributor' },
  { value: 'cash_tiered', label: 'Cash (Tiered)', icon: Layers, desc: 'Amount varies by performance tier' },
  { value: 'rebate_percent', label: 'Rebate %', icon: Calculator, desc: 'Percentage rebate on qualifying orders' },
  { value: 'credit_note', label: 'Credit Note', icon: Hash, desc: 'Credit note applied to next invoice' },
  { value: 'gift', label: 'Gift / Prize', icon: Zap, desc: 'Physical gift or branded merchandise' },
  { value: 'points', label: 'Points', icon: Target, desc: 'Loyalty points for reward catalogue' },
]

const METRICS = [
  { value: 'revenue', label: 'Revenue (RM)', icon: DollarSign },
  { value: 'order_count', label: 'Order Count', icon: Hash },
  { value: 'cases_sold', label: 'Cases Sold', icon: Target },
  { value: 'growth_percent', label: 'Growth %', icon: TrendingUp },
  { value: 'order_streak', label: 'Order Streak', icon: Flame },
  { value: 'sku_diversity', label: 'SKU Diversity', icon: PieChart },
]

const CALC_PERIODS = [
  { value: 'campaign_duration', label: 'Full Campaign Duration' },
  { value: 'monthly', label: 'Monthly Reset' },
  { value: 'quarterly', label: 'Quarterly' },
]

const CALC_BASIS = [
  { value: 'approved_only', label: 'Approved Orders Only' },
  { value: 'approved_and_paid', label: 'Approved + Paid Orders' },
  { value: 'exclude_cancelled', label: 'Exclude Cancelled' },
  { value: 'exclude_returns', label: 'Exclude Returns' },
]

const CAMPAIGN_LOGIC = [
  { value: 'cumulative', label: 'Cumulative During Campaign' },
  { value: 'monthly_reset', label: 'Monthly Reset' },
  { value: 'tier_stacking', label: 'Tier Stacking' },
  { value: 'highest_tier_only', label: 'Highest Tier Only' },
]

const ELIGIBILITY_SCOPES = [
  { value: 'all_distributors', label: 'All Distributors', desc: 'Every active distributor is eligible' },
  { value: 'by_tier', label: 'By Distributor Tier', desc: 'Filter by Gold, Silver, Platinum, Bronze' },
  { value: 'selected', label: 'Selected Distributors', desc: 'Hand-pick specific distributors' },
  { value: 'by_region', label: 'By Region / Territory', desc: 'Filter by geographic area' },
  { value: 'by_brand', label: 'By Brand / Category', desc: 'Filter by product brand or category' },
]

// ── Section Component ───────────────────────────────────────────
function RuleSection({
  title, description, icon: Icon, iconColor, children, defaultOpen = false
}: {
  title: string; description: string; icon: any; iconColor: string
  children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
      <button
        className="w-full flex items-center gap-4 p-5 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="p-2.5 rounded-xl" style={{ backgroundColor: `${iconColor}15` }}>
          <Icon className="w-5 h-5" style={{ color: iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {open ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-0">
          <Separator className="mb-5" />
          {children}
        </div>
      )}
    </Card>
  )
}

// ── Main Component ──────────────────────────────────────────────
interface IncentiveRulesTabProps {
  campaigns: Campaign[]
  loading: boolean
}

export default function IncentiveRulesTab({ campaigns, loading }: IncentiveRulesTabProps) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // ── Rule States ─────────────────────────────────────────────
  const [rewardRule, setRewardRule] = useState<Partial<RewardRule>>({
    reward_type: 'cash',
    reward_value: 0,
    reward_formula: 'flat',
    min_reward: null,
    max_reward: null,
    tier_config: [],
  })

  const [qualRule, setQualRule] = useState<Partial<QualificationRule>>({
    target_metric: 'revenue',
    target_value: 0,
    calculation_period: 'campaign_duration',
    calculation_basis: 'approved_only',
    campaign_logic: 'cumulative',
    secondary_metric: null,
    secondary_value: null,
  })

  const [eligibility, setEligibility] = useState<Partial<EligibilityRule>>({
    scope: 'all_distributors',
    tier_filter: [],
    org_ids: [],
    region_filter: [],
    brand_filter: [],
    exclude_org_ids: [],
  })

  const [budget, setBudget] = useState<Partial<BudgetConfig>>({
    budget_cap: 0,
    total_spend: 0,
    currency: 'MYR',
    auto_pause_on_cap: true,
  })

  const [tierRows, setTierRows] = useState<{ min: number; max: number; value: number }[]>([
    { min: 0, max: 100, value: 500 },
    { min: 101, max: 500, value: 1000 },
    { min: 501, max: 999999, value: 2000 },
  ])

  const supabase = createClient()

  // ── Load existing rules when campaign selected ──────────────
  const loadRules = useCallback(async (campaignId: string) => {
    if (!campaignId) return

    const sb = supabase as any
    const [{ data: reward }, { data: qual }, { data: elig }, { data: budgetData }] = await Promise.all([
      sb.from('incentive_reward_rules').select('*').eq('campaign_id', campaignId).maybeSingle(),
      sb.from('incentive_qualification_rules').select('*').eq('campaign_id', campaignId).maybeSingle(),
      sb.from('incentive_eligibility').select('*').eq('campaign_id', campaignId).maybeSingle(),
      sb.from('incentive_budgets').select('*').eq('campaign_id', campaignId).maybeSingle(),
    ])

    if (reward) {
      setRewardRule(reward)
      if (reward.tier_config?.length) setTierRows(reward.tier_config)
    }
    if (qual) setQualRule(qual)
    if (elig) setEligibility(elig)
    if (budgetData) setBudget(budgetData)
  }, [supabase])

  useEffect(() => {
    if (selectedCampaignId) loadRules(selectedCampaignId)
  }, [selectedCampaignId, loadRules])

  // ── Save Rules ──────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedCampaignId) return
    setSaving(true)
    setSaveSuccess(false)

    try {
      const cid = selectedCampaignId
      const sb = supabase as any

      // Upsert reward rule
      const rewardPayload = {
        campaign_id: cid,
        reward_type: rewardRule.reward_type,
        reward_value: rewardRule.reward_value || 0,
        reward_formula: rewardRule.reward_formula || 'flat',
        min_reward: rewardRule.min_reward,
        max_reward: rewardRule.max_reward,
        tier_config: rewardRule.reward_type === 'cash_tiered' ? tierRows : [],
      }
      if (rewardRule.id) {
        await sb.from('incentive_reward_rules').update(rewardPayload).eq('id', rewardRule.id)
      } else {
        await sb.from('incentive_reward_rules').insert(rewardPayload)
      }

      // Upsert qualification rule
      const qualPayload = {
        campaign_id: cid,
        target_metric: qualRule.target_metric,
        target_value: qualRule.target_value || 0,
        calculation_period: qualRule.calculation_period || 'campaign_duration',
        calculation_basis: qualRule.calculation_basis || 'approved_only',
        campaign_logic: qualRule.campaign_logic || 'cumulative',
        secondary_metric: qualRule.secondary_metric || null,
        secondary_value: qualRule.secondary_value || null,
      }
      if (qualRule.id) {
        await sb.from('incentive_qualification_rules').update(qualPayload).eq('id', qualRule.id)
      } else {
        await sb.from('incentive_qualification_rules').insert(qualPayload)
      }

      // Upsert eligibility
      const eligPayload = {
        campaign_id: cid,
        scope: eligibility.scope || 'all_distributors',
        tier_filter: eligibility.tier_filter || [],
        org_ids: eligibility.org_ids || [],
        region_filter: eligibility.region_filter || [],
        brand_filter: eligibility.brand_filter || [],
        exclude_org_ids: eligibility.exclude_org_ids || [],
      }
      if (eligibility.id) {
        await sb.from('incentive_eligibility').update(eligPayload).eq('id', eligibility.id)
      } else {
        await sb.from('incentive_eligibility').insert(eligPayload)
      }

      // Upsert budget
      const budgetPayload = {
        campaign_id: cid,
        budget_cap: budget.budget_cap || 0,
        currency: budget.currency || 'MYR',
        auto_pause_on_cap: budget.auto_pause_on_cap ?? true,
      }
      if (budget.id) {
        await sb.from('incentive_budgets').update(budgetPayload).eq('id', budget.id)
      } else {
        await sb.from('incentive_budgets').insert(budgetPayload)
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      console.error('Save rules error:', err)
    } finally {
      setSaving(false)
    }
  }, [selectedCampaignId, rewardRule, qualRule, eligibility, budget, tierRows, supabase])

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-500" /> Rules & Setup
          </h2>
          <p className="text-sm text-muted-foreground">Configure incentive calculation logic for each campaign</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select a campaign to configure..." />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    {c.name}
                    <Badge variant="outline" className="text-[10px] ml-1">{c.status}</Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedCampaignId && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg"
            >
              {saving ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              {saving ? 'Saving...' : 'Save Rules'}
            </Button>
          )}
        </div>
      </div>

      {/* Save Success Banner */}
      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4" /> Rules saved successfully for {selectedCampaign?.name}
        </div>
      )}

      {!selectedCampaignId ? (
        <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
          <CardContent className="p-12 text-center">
            <div className="p-4 bg-indigo-50 dark:bg-indigo-950/20 rounded-2xl w-fit mx-auto mb-4">
              <Settings className="w-10 h-10 text-indigo-500" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Select a Campaign</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Choose a campaign from the dropdown above to configure its incentive calculation rules,
              qualification criteria, eligibility scope, and budget settings.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Campaign Info Banner */}
          <div className="flex items-center gap-3 p-4 bg-indigo-50 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
            <Info className="w-5 h-5 text-indigo-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Configuring: {selectedCampaign?.name}</p>
              <p className="text-xs text-muted-foreground">Type: {selectedCampaign?.type} · Status: {selectedCampaign?.status}</p>
            </div>
          </div>

          {/* Section 1: Reward Configuration */}
          <RuleSection
            title="Reward Configuration"
            description="Define the type and amount of incentive reward for qualifying distributors"
            icon={DollarSign}
            iconColor="#22c55e"
            defaultOpen={true}
          >
            <div className="space-y-6">
              {/* Reward Type Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {REWARD_TYPES.map(rt => (
                  <button
                    key={rt.value}
                    onClick={() => setRewardRule(prev => ({ ...prev, reward_type: rt.value }))}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      rewardRule.reward_type === rt.value
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20 shadow-md'
                        : 'border-border hover:border-indigo-300 dark:hover:border-indigo-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <rt.icon className={`w-4 h-4 ${rewardRule.reward_type === rt.value ? 'text-indigo-600' : 'text-muted-foreground'}`} />
                      <span className={`text-sm font-medium ${rewardRule.reward_type === rt.value ? 'text-indigo-700 dark:text-indigo-400' : 'text-foreground'}`}>
                        {rt.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{rt.desc}</p>
                  </button>
                ))}
              </div>

              {/* Reward Value */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Reward Value</Label>
                  <Input
                    type="number"
                    min={0}
                    value={rewardRule.reward_value || 0}
                    onChange={e => setRewardRule(prev => ({ ...prev, reward_value: Number(e.target.value) }))}
                    placeholder="e.g. 2000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Formula</Label>
                  <Select value={rewardRule.reward_formula || 'flat'} onValueChange={v => setRewardRule(prev => ({ ...prev, reward_formula: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat">Flat Amount</SelectItem>
                      <SelectItem value="per_unit">Per Unit</SelectItem>
                      <SelectItem value="percentage">Percentage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Max Reward Cap</Label>
                  <Input
                    type="number"
                    min={0}
                    value={rewardRule.max_reward || ''}
                    onChange={e => setRewardRule(prev => ({ ...prev, max_reward: e.target.value ? Number(e.target.value) : null }))}
                    placeholder="No cap"
                  />
                </div>
              </div>

              {/* Tier Config for cash_tiered */}
              {rewardRule.reward_type === 'cash_tiered' && (
                <div className="space-y-3">
                  <Label className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-500" /> Tier Configuration
                  </Label>
                  <div className="space-y-2">
                    {tierRows.map((tier, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                        <span className="text-xs font-medium text-muted-foreground w-16">Tier {idx + 1}</span>
                        <Input
                          type="number"
                          className="w-28"
                          placeholder="Min"
                          value={tier.min}
                          onChange={e => {
                            const rows = [...tierRows]
                            rows[idx].min = Number(e.target.value)
                            setTierRows(rows)
                          }}
                        />
                        <span className="text-muted-foreground">–</span>
                        <Input
                          type="number"
                          className="w-28"
                          placeholder="Max"
                          value={tier.max}
                          onChange={e => {
                            const rows = [...tierRows]
                            rows[idx].max = Number(e.target.value)
                            setTierRows(rows)
                          }}
                        />
                        <span className="text-muted-foreground">→ RM</span>
                        <Input
                          type="number"
                          className="w-28"
                          placeholder="Reward"
                          value={tier.value}
                          onChange={e => {
                            const rows = [...tierRows]
                            rows[idx].value = Number(e.target.value)
                            setTierRows(rows)
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500"
                          onClick={() => setTierRows(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTierRows(prev => [...prev, { min: 0, max: 0, value: 0 }])}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Tier
                  </Button>
                </div>
              )}
            </div>
          </RuleSection>

          {/* Section 2: Qualification Rules */}
          <RuleSection
            title="Qualification Rules"
            description="Define the criteria distributors must meet to qualify for the incentive"
            icon={Target}
            iconColor="#f59e0b"
            defaultOpen={true}
          >
            <div className="space-y-6">
              {/* Primary Metric */}
              <div>
                <Label className="mb-3 block">Primary Target Metric</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  {METRICS.map(m => (
                    <button
                      key={m.value}
                      onClick={() => setQualRule(prev => ({ ...prev, target_metric: m.value }))}
                      className={`p-3 rounded-lg border-2 text-center transition-all ${
                        qualRule.target_metric === m.value
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
                          : 'border-border hover:border-amber-300 dark:hover:border-amber-700'
                      }`}
                    >
                      <m.icon className={`w-5 h-5 mx-auto mb-1 ${qualRule.target_metric === m.value ? 'text-amber-600' : 'text-muted-foreground'}`} />
                      <span className="text-xs font-medium">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Target Value & Period */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Target Value</Label>
                  <Input
                    type="number"
                    min={0}
                    value={qualRule.target_value || 0}
                    onChange={e => setQualRule(prev => ({ ...prev, target_value: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Calculation Period</Label>
                  <Select value={qualRule.calculation_period || 'campaign_duration'} onValueChange={v => setQualRule(prev => ({ ...prev, calculation_period: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CALC_PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Campaign Logic</Label>
                  <Select value={qualRule.campaign_logic || 'cumulative'} onValueChange={v => setQualRule(prev => ({ ...prev, campaign_logic: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAMPAIGN_LOGIC.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Calculation Basis */}
              <div className="space-y-2">
                <Label>Calculation Basis</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {CALC_BASIS.map(cb => (
                    <button
                      key={cb.value}
                      onClick={() => setQualRule(prev => ({ ...prev, calculation_basis: cb.value }))}
                      className={`p-3 rounded-lg border-2 text-center text-xs font-medium transition-all ${
                        qualRule.calculation_basis === cb.value
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400'
                          : 'border-border text-muted-foreground hover:border-amber-300'
                      }`}
                    >
                      {cb.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </RuleSection>

          {/* Section 3: Eligibility Scope */}
          <RuleSection
            title="Eligibility Scope"
            description="Define which distributors are eligible to participate in this campaign"
            icon={Users}
            iconColor="#6366f1"
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {ELIGIBILITY_SCOPES.map(es => (
                  <button
                    key={es.value}
                    onClick={() => setEligibility(prev => ({ ...prev, scope: es.value }))}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      eligibility.scope === es.value
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20 shadow-md'
                        : 'border-border hover:border-indigo-300 dark:hover:border-indigo-700'
                    }`}
                  >
                    <span className={`text-sm font-medium ${eligibility.scope === es.value ? 'text-indigo-700 dark:text-indigo-400' : 'text-foreground'}`}>
                      {es.label}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">{es.desc}</p>
                  </button>
                ))}
              </div>

              {eligibility.scope === 'by_tier' && (
                <div className="space-y-2">
                  <Label>Select Tiers</Label>
                  <div className="flex gap-2">
                    {['platinum', 'gold', 'silver', 'bronze'].map(t => (
                      <button
                        key={t}
                        onClick={() => {
                          const current = eligibility.tier_filter || []
                          setEligibility(prev => ({
                            ...prev,
                            tier_filter: current.includes(t) ? current.filter(x => x !== t) : [...current, t]
                          }))
                        }}
                        className={`px-4 py-2 rounded-lg border-2 text-sm font-medium capitalize transition-all ${
                          (eligibility.tier_filter || []).includes(t)
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700'
                            : 'border-border text-muted-foreground'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RuleSection>

          {/* Section 4: Budget Settings */}
          <RuleSection
            title="Budget & Limits"
            description="Set budget caps and auto-pause rules for this campaign"
            icon={Shield}
            iconColor="#ef4444"
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Budget Cap (RM)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={budget.budget_cap || 0}
                    onChange={e => setBudget(prev => ({ ...prev, budget_cap: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={budget.currency || 'MYR'} onValueChange={v => setBudget(prev => ({ ...prev, currency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MYR">MYR (Malaysian Ringgit)</SelectItem>
                      <SelectItem value="USD">USD (US Dollar)</SelectItem>
                      <SelectItem value="SGD">SGD (Singapore Dollar)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Auto-Pause on Budget Cap</Label>
                  <div className="flex items-center gap-3 pt-2">
                    <Switch
                      checked={budget.auto_pause_on_cap ?? true}
                      onCheckedChange={v => setBudget(prev => ({ ...prev, auto_pause_on_cap: v }))}
                    />
                    <span className="text-sm text-muted-foreground">
                      {budget.auto_pause_on_cap ? 'Campaign pauses when budget is fully used' : 'Campaign continues even after cap exceeded'}
                    </span>
                  </div>
                </div>
              </div>

              {(budget.budget_cap || 0) > 0 && (
                <div className="p-4 bg-muted/40 rounded-xl">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Budget Utilisation</span>
                    <span className="font-semibold">
                      RM{(budget.total_spend || 0).toLocaleString()} / RM{(budget.budget_cap || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        ((budget.total_spend || 0) / (budget.budget_cap || 1)) > 0.8 ? 'bg-red-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(((budget.total_spend || 0) / (budget.budget_cap || 1)) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </RuleSection>

          {/* Summary Card */}
          <Card className="border-2 border-indigo-200 dark:border-indigo-800 shadow-lg bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20">
            <CardContent className="p-5">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-indigo-500" /> Rule Summary
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div className="p-3 bg-white/60 dark:bg-white/5 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Reward</p>
                  <p className="font-medium text-foreground capitalize">
                    {REWARD_TYPES.find(r => r.value === rewardRule.reward_type)?.label || rewardRule.reward_type}
                  </p>
                  <p className="text-xs text-muted-foreground">RM{(rewardRule.reward_value || 0).toLocaleString()} ({rewardRule.reward_formula})</p>
                </div>
                <div className="p-3 bg-white/60 dark:bg-white/5 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Qualification</p>
                  <p className="font-medium text-foreground capitalize">
                    {METRICS.find(m => m.value === qualRule.target_metric)?.label || qualRule.target_metric}
                  </p>
                  <p className="text-xs text-muted-foreground">Target: {(qualRule.target_value || 0).toLocaleString()}</p>
                </div>
                <div className="p-3 bg-white/60 dark:bg-white/5 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Eligibility</p>
                  <p className="font-medium text-foreground capitalize">
                    {ELIGIBILITY_SCOPES.find(e => e.value === eligibility.scope)?.label || eligibility.scope}
                  </p>
                </div>
                <div className="p-3 bg-white/60 dark:bg-white/5 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Budget</p>
                  <p className="font-medium text-foreground">RM{(budget.budget_cap || 0).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{budget.auto_pause_on_cap ? 'Auto-pause enabled' : 'No auto-pause'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
