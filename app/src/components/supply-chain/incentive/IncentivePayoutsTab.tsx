'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import {
  DollarSign, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronRight, Eye, ThumbsUp, ThumbsDown, CreditCard,
  RefreshCw, Download, Filter, Search, FileText, Building2,
  ArrowRight, Banknote, Receipt, Wallet, Send
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'

// ── Types ─────────────────────────────────────────────────────
interface Payout {
  id: string
  campaign_id: string
  campaign_name: string
  org_id: string
  org_name: string
  org_code: string
  qualified_metric: string
  qualified_value: number
  target_value: number
  reward_amount: number
  reward_type: string
  currency: string
  status: string
  qualification_date: string
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
  adjusted_amount: number | null
  payment_method: string | null
  paid_at: string | null
  payment_reference: string | null
  payment_notes: string | null
  created_at: string
}

interface PayoutStats {
  qualified: number
  pendingApproval: number
  approved: number
  completed: number
  rejected: number
  totalQualifiedAmount: number
  totalPaidAmount: number
}

// ── Constants ─────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: any }> = {
  qualified: { label: 'Qualified', color: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-100 dark:bg-blue-900/30', icon: CheckCircle2 },
  pending_approval: { label: 'Pending Approval', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-900/30', icon: Clock },
  approved: { label: 'Approved', color: 'text-green-700 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-900/30', icon: ThumbsUp },
  rejected: { label: 'Rejected', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-100 dark:bg-red-900/30', icon: ThumbsDown },
  processing: { label: 'Processing', color: 'text-purple-700 dark:text-purple-400', bgColor: 'bg-purple-100 dark:bg-purple-900/30', icon: RefreshCw },
  completed: { label: 'Completed', color: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-100 dark:bg-emerald-900/30', icon: DollarSign },
  failed: { label: 'Failed', color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-100 dark:bg-red-900/30', icon: XCircle },
}

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Banknote },
  { value: 'credit_note', label: 'Credit Note', icon: Receipt },
  { value: 'rebate_invoice', label: 'Rebate to Invoice', icon: FileText },
  { value: 'internal_wallet', label: 'Internal Wallet / Credit', icon: Wallet },
]

// ── Static data for demo (will be replaced by DB queries) ─────
function getStaticPayouts(): Payout[] {
  return [
    {
      id: 'pay-001', campaign_id: 'camp-001', campaign_name: 'Q1 Volume Blitz',
      org_id: 'org-1', org_name: 'Mega Distribution Sdn Bhd', org_code: 'DIST-001',
      qualified_metric: 'Cases Sold', qualified_value: 580, target_value: 500,
      reward_amount: 2000, reward_type: 'cash', currency: 'MYR',
      status: 'completed', qualification_date: '2025-03-15T00:00:00Z',
      approved_by: 'admin-1', approved_at: '2025-03-20T10:00:00Z',
      rejection_reason: null, adjusted_amount: null,
      payment_method: 'bank_transfer', paid_at: '2025-03-25T14:00:00Z',
      payment_reference: 'PAY-2025-001', payment_notes: null,
      created_at: '2025-03-15T00:00:00Z'
    },
    {
      id: 'pay-002', campaign_id: 'camp-001', campaign_name: 'Q1 Volume Blitz',
      org_id: 'org-2', org_name: 'Southern Star Trading', org_code: 'DIST-002',
      qualified_metric: 'Cases Sold', qualified_value: 520, target_value: 500,
      reward_amount: 2000, reward_type: 'cash', currency: 'MYR',
      status: 'approved', qualification_date: '2025-03-18T00:00:00Z',
      approved_by: 'admin-1', approved_at: '2025-03-22T09:00:00Z',
      rejection_reason: null, adjusted_amount: null,
      payment_method: null, paid_at: null, payment_reference: null, payment_notes: null,
      created_at: '2025-03-18T00:00:00Z'
    },
    {
      id: 'pay-003', campaign_id: 'camp-002', campaign_name: 'Monthly Growth Sprint',
      org_id: 'org-3', org_name: 'East Coast Supplies', org_code: 'DIST-003',
      qualified_metric: 'MoM Growth %', qualified_value: 22, target_value: 15,
      reward_amount: 500, reward_type: 'credit', currency: 'MYR',
      status: 'pending_approval', qualification_date: '2025-03-01T00:00:00Z',
      approved_by: null, approved_at: null,
      rejection_reason: null, adjusted_amount: null,
      payment_method: null, paid_at: null, payment_reference: null, payment_notes: null,
      created_at: '2025-03-01T00:00:00Z'
    },
    {
      id: 'pay-004', campaign_id: 'camp-002', campaign_name: 'Monthly Growth Sprint',
      org_id: 'org-4', org_name: 'Northern Express Dist', org_code: 'DIST-004',
      qualified_metric: 'MoM Growth %', qualified_value: 18, target_value: 15,
      reward_amount: 500, reward_type: 'credit', currency: 'MYR',
      status: 'pending_approval', qualification_date: '2025-03-01T00:00:00Z',
      approved_by: null, approved_at: null,
      rejection_reason: null, adjusted_amount: null,
      payment_method: null, paid_at: null, payment_reference: null, payment_notes: null,
      created_at: '2025-03-01T00:00:00Z'
    },
    {
      id: 'pay-005', campaign_id: 'camp-001', campaign_name: 'Q1 Volume Blitz',
      org_id: 'org-5', org_name: 'Central Valley Corp', org_code: 'DIST-005',
      qualified_metric: 'Cases Sold', qualified_value: 510, target_value: 500,
      reward_amount: 2000, reward_type: 'cash', currency: 'MYR',
      status: 'qualified', qualification_date: '2025-03-25T00:00:00Z',
      approved_by: null, approved_at: null,
      rejection_reason: null, adjusted_amount: null,
      payment_method: null, paid_at: null, payment_reference: null, payment_notes: null,
      created_at: '2025-03-25T00:00:00Z'
    },
    {
      id: 'pay-006', campaign_id: 'camp-002', campaign_name: 'Monthly Growth Sprint',
      org_id: 'org-6', org_name: 'Coastal Trading LLC', org_code: 'DIST-006',
      qualified_metric: 'MoM Growth %', qualified_value: 25, target_value: 15,
      reward_amount: 500, reward_type: 'credit', currency: 'MYR',
      status: 'rejected', qualification_date: '2025-02-28T00:00:00Z',
      approved_by: 'admin-1', approved_at: '2025-03-05T11:00:00Z',
      rejection_reason: 'Data discrepancy flagged — pending verification', adjusted_amount: null,
      payment_method: null, paid_at: null, payment_reference: null, payment_notes: null,
      created_at: '2025-02-28T00:00:00Z'
    },
    {
      id: 'pay-007', campaign_id: 'camp-001', campaign_name: 'Q1 Volume Blitz',
      org_id: 'org-7', org_name: 'Prime Wholesale Partners', org_code: 'DIST-007',
      qualified_metric: 'Cases Sold', qualified_value: 650, target_value: 500,
      reward_amount: 2000, reward_type: 'cash', currency: 'MYR',
      status: 'completed', qualification_date: '2025-03-10T00:00:00Z',
      approved_by: 'admin-1', approved_at: '2025-03-15T10:00:00Z',
      rejection_reason: null, adjusted_amount: null,
      payment_method: 'bank_transfer', paid_at: '2025-03-20T14:00:00Z',
      payment_reference: 'PAY-2025-002', payment_notes: null,
      created_at: '2025-03-10T00:00:00Z'
    },
  ]
}

// ── Payout Row Component ──────────────────────────────────────
function PayoutRow({ payout, onAction }: { payout: Payout; onAction: (p: Payout, action: string) => void }) {
  const cfg = STATUS_CONFIG[payout.status] || STATUS_CONFIG.qualified
  const StatusIcon = cfg.icon
  const achieved = payout.target_value > 0 ? Math.round((payout.qualified_value / payout.target_value) * 100) : 0

  return (
    <TableRow className="hover:bg-muted/30 transition-colors">
      <TableCell>
        <div>
          <p className="font-medium text-foreground text-sm">{payout.org_name}</p>
          <p className="text-xs text-muted-foreground">{payout.org_code}</p>
        </div>
      </TableCell>
      <TableCell>
        <p className="text-sm text-foreground">{payout.campaign_name}</p>
      </TableCell>
      <TableCell>
        <div>
          <p className="text-sm text-foreground">{payout.qualified_value.toLocaleString()} / {payout.target_value.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">{payout.qualified_metric} · {achieved}%</p>
        </div>
      </TableCell>
      <TableCell>
        <p className="text-sm font-semibold text-foreground">RM{payout.reward_amount.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground capitalize">{payout.reward_type}</p>
      </TableCell>
      <TableCell>
        <Badge className={`${cfg.bgColor} ${cfg.color} gap-1`}>
          <StatusIcon className="w-3 h-3" />
          {cfg.label}
        </Badge>
      </TableCell>
      <TableCell>
        <p className="text-xs text-muted-foreground">
          {format(new Date(payout.qualification_date), 'dd MMM yyyy')}
        </p>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {payout.status === 'qualified' && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAction(payout, 'submit')}>
              <Send className="w-3 h-3 mr-1" /> Submit
            </Button>
          )}
          {payout.status === 'pending_approval' && (
            <>
              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => onAction(payout, 'approve')}>
                <ThumbsUp className="w-3 h-3 mr-1" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200" onClick={() => onAction(payout, 'reject')}>
                <ThumbsDown className="w-3 h-3 mr-1" /> Reject
              </Button>
            </>
          )}
          {payout.status === 'approved' && (
            <Button size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => onAction(payout, 'pay')}>
              <CreditCard className="w-3 h-3 mr-1" /> Pay
            </Button>
          )}
          {payout.status === 'completed' && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAction(payout, 'view')}>
              <Eye className="w-3 h-3 mr-1" /> View
            </Button>
          )}
          {payout.status === 'rejected' && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAction(payout, 'view')}>
              <Eye className="w-3 h-3 mr-1" /> Details
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

// ── Main Component ──────────────────────────────────────────────
interface IncentivePayoutsTabProps {
  campaigns: { id: string; name: string; status: string }[]
  loading: boolean
}

export default function IncentivePayoutsTab({ campaigns, loading }: IncentivePayoutsTabProps) {
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [payoutSubTab, setPayoutSubTab] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [actionDialog, setActionDialog] = useState<{ open: boolean; payout: Payout | null; action: string }>({ open: false, payout: null, action: '' })
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [paymentRef, setPaymentRef] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [adjustedAmount, setAdjustedAmount] = useState<number | null>(null)

  const supabase = createClient()

  useEffect(() => {
    // Load from DB, fallback to static
    loadPayouts()
  }, [])

  const loadPayouts = useCallback(async () => {
    const sb = supabase as any
    const { data } = await sb
      .from('incentive_payouts')
      .select(`
        *,
        campaign:incentive_campaigns(name),
        organization:organizations(org_name, org_code)
      `)
      .order('created_at', { ascending: false })

    if (data && data.length > 0) {
      setPayouts(data.map((p: any) => ({
        id: p.id,
        campaign_id: p.campaign_id,
        campaign_name: p.campaign?.name || '',
        org_id: p.org_id,
        org_name: p.organization?.org_name || '',
        org_code: p.organization?.org_code || '',
        qualified_metric: p.qualified_metric,
        qualified_value: Number(p.qualified_value),
        target_value: Number(p.target_value),
        reward_amount: Number(p.adjusted_amount || p.reward_amount),
        reward_type: p.reward_type,
        currency: p.currency,
        status: p.status,
        qualification_date: p.qualification_date,
        approved_by: p.approved_by,
        approved_at: p.approved_at,
        rejection_reason: p.rejection_reason,
        adjusted_amount: p.adjusted_amount ? Number(p.adjusted_amount) : null,
        payment_method: p.payment_method,
        paid_at: p.paid_at,
        payment_reference: p.payment_reference,
        payment_notes: p.payment_notes,
        created_at: p.created_at,
      })))
    } else {
      setPayouts(getStaticPayouts())
    }
  }, [supabase])

  // Stats
  const stats: PayoutStats = useMemo(() => {
    const qualified = payouts.filter(p => p.status === 'qualified').length
    const pendingApproval = payouts.filter(p => p.status === 'pending_approval').length
    const approved = payouts.filter(p => p.status === 'approved').length
    const completed = payouts.filter(p => p.status === 'completed').length
    const rejected = payouts.filter(p => p.status === 'rejected').length
    const totalQualifiedAmount = payouts.reduce((s, p) => s + p.reward_amount, 0)
    const totalPaidAmount = payouts.filter(p => p.status === 'completed').reduce((s, p) => s + p.reward_amount, 0)
    return { qualified, pendingApproval, approved, completed, rejected, totalQualifiedAmount, totalPaidAmount }
  }, [payouts])

  // Filtered payouts
  const filtered = useMemo(() => {
    let result = payouts
    if (payoutSubTab !== 'all') {
      result = result.filter(p => p.status === payoutSubTab)
    }
    if (campaignFilter !== 'all') {
      result = result.filter(p => p.campaign_id === campaignFilter)
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      result = result.filter(p =>
        p.org_name.toLowerCase().includes(term) ||
        p.org_code.toLowerCase().includes(term) ||
        p.campaign_name.toLowerCase().includes(term)
      )
    }
    return result
  }, [payouts, payoutSubTab, campaignFilter, searchTerm])

  // Actions
  const handleAction = useCallback((payout: Payout, action: string) => {
    setActionDialog({ open: true, payout, action })
    setPaymentMethod('bank_transfer')
    setPaymentRef('')
    setPaymentNotes('')
    setRejectionReason('')
    setAdjustedAmount(null)
  }, [])

  const executeAction = useCallback(async () => {
    const { payout, action } = actionDialog
    if (!payout) return

    if (action === 'submit') {
      setPayouts(prev => prev.map(p => p.id === payout.id ? { ...p, status: 'pending_approval' } : p))
      // DB update
      await (supabase as any).from('incentive_payouts').update({ status: 'pending_approval' }).eq('id', payout.id).then(() => {})
    } else if (action === 'approve') {
      const updates: any = {
        status: 'approved',
        approved_at: new Date().toISOString(),
      }
      if (adjustedAmount !== null && adjustedAmount > 0) {
        updates.adjusted_amount = adjustedAmount
      }
      setPayouts(prev => prev.map(p => p.id === payout.id ? {
        ...p,
        status: 'approved',
        approved_at: new Date().toISOString(),
        adjusted_amount: adjustedAmount,
        reward_amount: adjustedAmount || p.reward_amount,
      } : p))
      await (supabase as any).from('incentive_payouts').update(updates).eq('id', payout.id).then(() => {})
    } else if (action === 'reject') {
      setPayouts(prev => prev.map(p => p.id === payout.id ? {
        ...p,
        status: 'rejected',
        rejection_reason: rejectionReason,
        approved_at: new Date().toISOString(),
      } : p))
      await (supabase as any).from('incentive_payouts').update({
        status: 'rejected',
        rejection_reason: rejectionReason,
        approved_at: new Date().toISOString(),
      }).eq('id', payout.id).then(() => {})
    } else if (action === 'pay') {
      setPayouts(prev => prev.map(p => p.id === payout.id ? {
        ...p,
        status: 'completed',
        payment_method: paymentMethod,
        payment_reference: paymentRef,
        payment_notes: paymentNotes,
        paid_at: new Date().toISOString(),
      } : p))
      await (supabase as any).from('incentive_payouts').update({
        status: 'completed',
        payment_method: paymentMethod,
        payment_reference: paymentRef,
        payment_notes: paymentNotes,
        paid_at: new Date().toISOString(),
      }).eq('id', payout.id).then(() => {})
    }

    setActionDialog({ open: false, payout: null, action: '' })
  }, [actionDialog, adjustedAmount, rejectionReason, paymentMethod, paymentRef, paymentNotes, supabase])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-500" /> Incentive Payouts
          </h2>
          <p className="text-sm text-muted-foreground">Manage incentive settlements from qualification to payment</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadPayouts()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Qualified', value: stats.qualified, color: '#3b82f6', icon: CheckCircle2 },
          { label: 'Pending', value: stats.pendingApproval, color: '#f59e0b', icon: Clock },
          { label: 'Approved', value: stats.approved, color: '#22c55e', icon: ThumbsUp },
          { label: 'Completed', value: stats.completed, color: '#10b981', icon: DollarSign },
          { label: 'Rejected', value: stats.rejected, color: '#ef4444', icon: XCircle },
          { label: 'Total Paid', value: `RM${stats.totalPaidAmount.toLocaleString()}`, color: '#8b5cf6', icon: Banknote },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-md bg-card/80 backdrop-blur">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{kpi.label}</span>
                <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
              </div>
              <p className="text-xl font-bold text-foreground">{typeof kpi.value === 'number' ? kpi.value : kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Workflow Visual */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur">
        <CardContent className="p-4">
          <div className="flex items-center justify-between overflow-x-auto gap-2">
            {[
              { label: 'Qualified', count: stats.qualified, status: 'qualified' },
              { label: 'Pending Approval', count: stats.pendingApproval, status: 'pending_approval' },
              { label: 'Approved', count: stats.approved, status: 'approved' },
              { label: 'Payment Executed', count: stats.completed, status: 'completed' },
            ].map((step, i, arr) => {
              const cfg = STATUS_CONFIG[step.status]
              return (
                <div key={step.status} className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    onClick={() => setPayoutSubTab(step.status)}
                    className={`flex-1 p-3 rounded-xl border-2 text-center transition-all cursor-pointer ${
                      payoutSubTab === step.status
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20 shadow-md'
                        : 'border-border hover:border-indigo-300'
                    }`}
                  >
                    <p className="text-2xl font-bold text-foreground">{step.count}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">{step.label}</p>
                  </button>
                  {i < arr.length - 1 && <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={payoutSubTab} onValueChange={setPayoutSubTab}>
          <TabsList className="bg-muted/50 p-1 rounded-lg h-auto flex-wrap">
            <TabsTrigger value="all" className="rounded-md text-xs h-8">All ({payouts.length})</TabsTrigger>
            <TabsTrigger value="qualified" className="rounded-md text-xs h-8">Qualified ({stats.qualified})</TabsTrigger>
            <TabsTrigger value="pending_approval" className="rounded-md text-xs h-8">Pending ({stats.pendingApproval})</TabsTrigger>
            <TabsTrigger value="approved" className="rounded-md text-xs h-8">Approved ({stats.approved})</TabsTrigger>
            <TabsTrigger value="completed" className="rounded-md text-xs h-8">Completed ({stats.completed})</TabsTrigger>
            <TabsTrigger value="rejected" className="rounded-md text-xs h-8">Rejected ({stats.rejected})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search distributor..."
              className="pl-9 w-[200px] h-9"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="All Campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-lg bg-card/80 backdrop-blur overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="font-semibold">Distributor</TableHead>
                <TableHead className="font-semibold">Campaign</TableHead>
                <TableHead className="font-semibold">Qualified Metric</TableHead>
                <TableHead className="font-semibold">Reward</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Date</TableHead>
                <TableHead className="font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="font-medium">No payouts found</p>
                    <p className="text-xs">Payouts will appear here when distributors qualify for incentive campaigns</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(p => <PayoutRow key={p.id} payout={p} onAction={handleAction} />)
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Action Dialog */}
      <Dialog open={actionDialog.open} onOpenChange={(open) => !open && setActionDialog({ open: false, payout: null, action: '' })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionDialog.action === 'approve' && <><ThumbsUp className="w-5 h-5 text-green-500" /> Approve Payout</>}
              {actionDialog.action === 'reject' && <><ThumbsDown className="w-5 h-5 text-red-500" /> Reject Payout</>}
              {actionDialog.action === 'pay' && <><CreditCard className="w-5 h-5 text-indigo-500" /> Execute Payment</>}
              {actionDialog.action === 'submit' && <><Send className="w-5 h-5 text-blue-500" /> Submit for Approval</>}
              {actionDialog.action === 'view' && <><Eye className="w-5 h-5 text-muted-foreground" /> Payout Details</>}
            </DialogTitle>
          </DialogHeader>

          {actionDialog.payout && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="p-4 bg-muted/40 rounded-xl space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Distributor</span>
                  <span className="font-medium">{actionDialog.payout.org_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Campaign</span>
                  <span className="font-medium">{actionDialog.payout.campaign_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Achievement</span>
                  <span className="font-medium">{actionDialog.payout.qualified_value} / {actionDialog.payout.target_value} {actionDialog.payout.qualified_metric}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Reward Amount</span>
                  <span className="font-bold text-lg text-foreground">RM{actionDialog.payout.reward_amount.toLocaleString()}</span>
                </div>
              </div>

              {/* Action-specific fields */}
              {actionDialog.action === 'approve' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Adjust Reward Amount (optional)</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder={`${actionDialog.payout.reward_amount}`}
                      value={adjustedAmount || ''}
                      onChange={e => setAdjustedAmount(e.target.value ? Number(e.target.value) : null)}
                    />
                    <p className="text-xs text-muted-foreground">Leave blank to approve the original amount</p>
                  </div>
                </div>
              )}

              {actionDialog.action === 'reject' && (
                <div className="space-y-2">
                  <Label>Rejection Reason</Label>
                  <Input
                    placeholder="Provide reason for rejection..."
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                  />
                </div>
              )}

              {actionDialog.action === 'pay' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {PAYMENT_METHODS.map(pm => (
                        <button
                          key={pm.value}
                          onClick={() => setPaymentMethod(pm.value)}
                          className={`p-3 rounded-lg border-2 text-left transition-all flex items-center gap-2 ${
                            paymentMethod === pm.value
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20'
                              : 'border-border hover:border-indigo-300'
                          }`}
                        >
                          <pm.icon className={`w-4 h-4 ${paymentMethod === pm.value ? 'text-indigo-600' : 'text-muted-foreground'}`} />
                          <span className="text-sm font-medium">{pm.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Reference</Label>
                    <Input
                      placeholder="e.g. PAY-2025-003"
                      value={paymentRef}
                      onChange={e => setPaymentRef(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes (optional)</Label>
                    <Input
                      placeholder="Any additional notes..."
                      value={paymentNotes}
                      onChange={e => setPaymentNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {actionDialog.action === 'view' && actionDialog.payout.status === 'completed' && (
                <div className="space-y-2 p-4 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Payment Method</span>
                    <span className="font-medium capitalize">{actionDialog.payout.payment_method?.replace('_', ' ')}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Paid Date</span>
                    <span className="font-medium">{actionDialog.payout.paid_at ? format(new Date(actionDialog.payout.paid_at), 'dd MMM yyyy HH:mm') : '-'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Reference</span>
                    <span className="font-medium">{actionDialog.payout.payment_reference || '-'}</span>
                  </div>
                </div>
              )}

              {actionDialog.action === 'view' && actionDialog.payout.status === 'rejected' && (
                <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-200 dark:border-red-800">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Rejection Reason</p>
                  <p className="text-sm text-muted-foreground">{actionDialog.payout.rejection_reason || 'No reason provided'}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setActionDialog({ open: false, payout: null, action: '' })}>
              {actionDialog.action === 'view' ? 'Close' : 'Cancel'}
            </Button>
            {actionDialog.action !== 'view' && (
              <Button
                onClick={executeAction}
                className={`text-white shadow-lg ${
                  actionDialog.action === 'reject'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700'
                }`}
                disabled={actionDialog.action === 'reject' && !rejectionReason}
              >
                {actionDialog.action === 'submit' && 'Submit for Approval'}
                {actionDialog.action === 'approve' && 'Approve Payout'}
                {actionDialog.action === 'reject' && 'Reject Payout'}
                {actionDialog.action === 'pay' && 'Execute Payment'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
