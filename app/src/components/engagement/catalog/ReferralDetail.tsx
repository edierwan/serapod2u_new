'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ArrowLeft, TrendingUp, Loader2, Users, Banknote, RefreshCw,
  Download, ChevronLeft, ChevronRight, Clock, CheckCircle,
  XCircle, DollarSign, FileText, Calendar, Edit, Plus
} from 'lucide-react'
import { formatNumber } from './catalog-utils'

interface ReferralDetailProps {
  userProfile: any
  referenceUserId: string
  onBack: () => void
}

interface AccrualEntry {
  id: string
  shop_user_id: string
  source_type: string
  points_amount: number
  rm_amount: number
  event_at: string
  shop_name?: string
  shop_phone?: string
}

interface ClaimEntry {
  id: string
  claim_points: number
  claim_rm: number
  status: string
  submitted_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  rejection_reason: string | null
  payment_reference: string | null
  paid_at: string | null
}

interface AssignmentEntry {
  id: string
  shop_user_id: string
  reference_phone: string | null
  effective_from: string
  effective_to: string | null
  change_source: string
  shop_name?: string
  shop_phone?: string
}

interface AdjustmentEntry {
  id: string
  adjustment_type: string
  points_amount: number
  rm_amount: number
  reason: string
  created_at: string
  created_by_name?: string
}

export function ReferralDetail({ userProfile, referenceUserId, onBack }: ReferralDetailProps) {
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'earnings' | 'claims' | 'shops' | 'adjustments'>('earnings')

  // Reference profile
  const [refProfile, setRefProfile] = useState<any>(null)
  const [monitorData, setMonitorData] = useState<any>(null)

  // Ledgers
  const [accruals, setAccruals] = useState<AccrualEntry[]>([])
  const [claims, setClaims] = useState<ClaimEntry[]>([])
  const [assignments, setAssignments] = useState<AssignmentEntry[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentEntry[]>([])

  // Adjustment dialog
  const [showAdjDialog, setShowAdjDialog] = useState(false)
  const [adjType, setAdjType] = useState<'credit' | 'debit'>('credit')
  const [adjPoints, setAdjPoints] = useState(0)
  const [adjReason, setAdjReason] = useState('')
  const [adjProcessing, setAdjProcessing] = useState(false)

  // Claim action dialog
  const [selectedClaim, setSelectedClaim] = useState<ClaimEntry | null>(null)
  const [claimAction, setClaimAction] = useState<string | null>(null)
  const [claimReason, setClaimReason] = useState('')
  const [claimPayRef, setClaimPayRef] = useState('')
  const [claimProcessing, setClaimProcessing] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      setLoading(true)

      // Reference profile
      const { data: profile } = await supabase
        .from('users')
        .select('id, full_name, phone, email, employment_status, role_code, manager_user_id')
        .eq('id', referenceUserId)
        .single()
      setRefProfile(profile)

      // Monitor summary
      const { data: monitor } = await supabase
        .from('v_referral_monitor')
        .select('*')
        .eq('reference_user_id', referenceUserId)
        .single()
      setMonitorData(monitor)

      // Accruals
      const { data: accData } = await supabase
        .from('referral_accruals')
        .select('*')
        .eq('reference_user_id', referenceUserId)
        .order('event_at', { ascending: false })
        .limit(500)

      if (accData && accData.length > 0) {
        // Enrich with shop names
        const shopIds = [...new Set(accData.map(a => a.shop_user_id))]
        const { data: shops } = await supabase
          .from('users')
          .select('id, full_name, phone')
          .in('id', shopIds)
        const shopMap = Object.fromEntries((shops || []).map(s => [s.id, s]))

        setAccruals(accData.map(a => ({
          ...a,
          shop_name: shopMap[a.shop_user_id]?.full_name || '',
          shop_phone: shopMap[a.shop_user_id]?.phone || '',
        })))
      } else {
        setAccruals([])
      }

      // Claims
      const { data: claimData } = await supabase
        .from('referral_claims')
        .select('*')
        .eq('reference_user_id', referenceUserId)
        .order('submitted_at', { ascending: false })
      setClaims(claimData || [])

      // Assignments
      const { data: assignData } = await supabase
        .from('reference_assignments')
        .select('*')
        .eq('reference_user_id', referenceUserId)
        .order('effective_from', { ascending: false })

      if (assignData && assignData.length > 0) {
        const shopIds = [...new Set(assignData.map(a => a.shop_user_id))]
        const { data: shops } = await supabase
          .from('users')
          .select('id, full_name, phone')
          .in('id', shopIds)
        const shopMap = Object.fromEntries((shops || []).map(s => [s.id, s]))

        setAssignments(assignData.map(a => ({
          ...a,
          shop_name: shopMap[a.shop_user_id]?.full_name || '',
          shop_phone: shopMap[a.shop_user_id]?.phone || '',
        })))
      } else {
        setAssignments([])
      }

      // Adjustments
      const { data: adjData } = await supabase
        .from('referral_adjustments')
        .select('*')
        .eq('reference_user_id', referenceUserId)
        .order('created_at', { ascending: false })
      setAdjustments(adjData || [])

    } catch (error: any) {
      console.error('Error loading referral detail:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase, referenceUserId])

  useEffect(() => { loadAll() }, [loadAll])

  const handleAdjustment = async () => {
    if (!adjPoints || !adjReason.trim()) return
    try {
      setAdjProcessing(true)

      // Get settings for RM conversion
      const { data: settings } = await supabase
        .from('referral_incentive_settings')
        .select('conversion_points, conversion_rm')
        .eq('org_id', userProfile.organizations.id)
        .single()

      const rmAmount = settings
        ? (adjPoints / settings.conversion_points) * Number(settings.conversion_rm)
        : 0

      const { error } = await supabase.from('referral_adjustments').insert({
        org_id: userProfile.organizations.id,
        reference_user_id: referenceUserId,
        adjustment_type: adjType,
        points_amount: adjPoints,
        rm_amount: rmAmount,
        reason: adjReason,
        created_by: userProfile.id,
      })

      if (error) throw error
      setShowAdjDialog(false)
      setAdjPoints(0)
      setAdjReason('')
      loadAll()
    } catch (error: any) {
      console.error('Error creating adjustment:', error)
    } finally {
      setAdjProcessing(false)
    }
  }

  const handleClaimAction = async () => {
    if (!selectedClaim || !claimAction) return
    try {
      setClaimProcessing(true)
      const { error } = await supabase.rpc('process_referral_claim', {
        p_claim_id: selectedClaim.id,
        p_action: claimAction,
        p_reviewer_id: userProfile.id,
        p_reason: claimReason || undefined,
        p_payment_reference: claimPayRef || undefined,
      })
      if (error) throw error
      setSelectedClaim(null)
      setClaimAction(null)
      setClaimReason('')
      setClaimPayRef('')
      loadAll()
    } catch (error: any) {
      console.error('Error processing claim:', error)
    } finally {
      setClaimProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const activeAssignments = assignments.filter(a => !a.effective_to)
  const historicalAssignments = assignments.filter(a => !!a.effective_to)

  return (
    <div className="space-y-6">
      {/* Back Button + Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div>
          <h3 className="text-xl font-semibold">
            {refProfile?.full_name || 'Unknown Reference'}
          </h3>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{refProfile?.phone}</span>
            <span>{refProfile?.email}</span>
            <Badge variant={refProfile?.employment_status === 'active' ? 'default' : 'destructive'}>
              {refProfile?.employment_status}
            </Badge>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Assigned Shops</p>
            <p className="text-2xl font-bold">{monitorData?.assigned_shops_count || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Accrued</p>
            <p className="text-xl font-bold text-green-600">
              {formatNumber(monitorData?.total_accrued_points || 0)} pts
            </p>
            <p className="text-xs text-muted-foreground">
              RM {Number(monitorData?.total_accrued_rm || 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Claimed</p>
            <p className="text-xl font-bold text-purple-600">
              RM {Number(monitorData?.total_claimed_rm || 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/30">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Claimable</p>
            <p className="text-xl font-bold text-amber-600">
              {formatNumber(monitorData?.claimable_points || 0)} pts
            </p>
            <p className="text-xs text-muted-foreground">
              RM {Number(monitorData?.claimable_rm || 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Pending Claims</p>
            <p className="text-2xl font-bold text-orange-600">{monitorData?.pending_claims_count || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="earnings" className="gap-2">
            <TrendingUp className="h-4 w-4" /> Earnings Ledger
          </TabsTrigger>
          <TabsTrigger value="claims" className="gap-2">
            <Banknote className="h-4 w-4" /> Claims
          </TabsTrigger>
          <TabsTrigger value="shops" className="gap-2">
            <Users className="h-4 w-4" /> Assigned Shops
          </TabsTrigger>
          <TabsTrigger value="adjustments" className="gap-2">
            <Edit className="h-4 w-4" /> Adjustments
          </TabsTrigger>
        </TabsList>

        {/* Earnings Tab */}
        <TabsContent value="earnings" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Shop</th>
                      <th className="px-3 py-2 text-left">Source</th>
                      <th className="px-3 py-2 text-right">Points</th>
                      <th className="px-3 py-2 text-right">RM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accruals.map((a, i) => (
                      <tr key={a.id} className="border-b hover:bg-muted/30">
                        <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                        <td className="px-3 py-2 text-xs">{new Date(a.event_at).toLocaleString('en-MY')}</td>
                        <td className="px-3 py-2">
                          <p className="text-xs font-medium">{a.shop_name || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">{a.shop_phone}</p>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {a.source_type === 'qr_scan' ? 'QR Scan' : a.source_type === 'migration' ? 'Migration' : a.source_type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right text-green-600 font-medium">
                          +{formatNumber(a.points_amount)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          RM {Number(a.rm_amount).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {accruals.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                          No earnings yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Claims Tab */}
        <TabsContent value="claims" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Submitted</th>
                      <th className="px-3 py-2 text-right">Points</th>
                      <th className="px-3 py-2 text-right">RM</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Reviewed</th>
                      <th className="px-3 py-2 text-left">Payment</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((c, i) => (
                      <tr key={c.id} className={`border-b hover:bg-muted/30 ${c.status === 'pending' ? 'bg-amber-50/50' : ''}`}>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 text-xs">{new Date(c.submitted_at).toLocaleString('en-MY')}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatNumber(c.claim_points)}</td>
                        <td className="px-3 py-2 text-right font-medium">RM {Number(c.claim_rm).toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <Badge className={`text-[10px] ${
                            c.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                            c.status === 'paid' ? 'bg-green-100 text-green-800' :
                            c.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {c.status}
                          </Badge>
                          {c.rejection_reason && (
                            <p className="text-[10px] text-red-600 mt-0.5">{c.rejection_reason}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {c.reviewed_at ? new Date(c.reviewed_at).toLocaleDateString('en-MY') : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {c.payment_reference || (c.paid_at ? new Date(c.paid_at).toLocaleDateString('en-MY') : '—')}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center gap-1 justify-center">
                            {c.status === 'pending' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px] bg-green-50 text-green-700"
                                  onClick={() => { setSelectedClaim(c); setClaimAction('approve') }}
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px] bg-red-50 text-red-700"
                                  onClick={() => { setSelectedClaim(c); setClaimAction('reject') }}
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                            {c.status === 'approved' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] bg-blue-50 text-blue-700"
                                onClick={() => { setSelectedClaim(c); setClaimAction('mark_paid') }}
                              >
                                Mark Paid
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {claims.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                          No claims submitted yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Shops Tab */}
        <TabsContent value="shops" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current Assignments ({activeAssignments.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Shop</th>
                      <th className="px-3 py-2 text-left">Effective From</th>
                      <th className="px-3 py-2 text-left">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAssignments.map((a, i) => (
                      <tr key={a.id} className="border-b hover:bg-muted/30">
                        <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">
                          <p className="text-xs font-medium">{a.shop_name || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">{a.shop_phone}</p>
                        </td>
                        <td className="px-3 py-2 text-xs">{new Date(a.effective_from).toLocaleString('en-MY')}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">{a.change_source}</Badge>
                        </td>
                      </tr>
                    ))}
                    {activeAssignments.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No active assignments.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {historicalAssignments.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-muted-foreground">Historical Assignments ({historicalAssignments.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Shop</th>
                        <th className="px-3 py-2 text-left">From</th>
                        <th className="px-3 py-2 text-left">To</th>
                        <th className="px-3 py-2 text-left">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalAssignments.map((a, i) => (
                        <tr key={a.id} className="border-b hover:bg-muted/30 opacity-60">
                          <td className="px-3 py-2 text-xs">{i + 1}</td>
                          <td className="px-3 py-2">
                            <p className="text-xs">{a.shop_name || '—'}</p>
                          </td>
                          <td className="px-3 py-2 text-xs">{new Date(a.effective_from).toLocaleDateString('en-MY')}</td>
                          <td className="px-3 py-2 text-xs">{a.effective_to ? new Date(a.effective_to).toLocaleDateString('en-MY') : '—'}</td>
                          <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{a.change_source}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Adjustments Tab */}
        <TabsContent value="adjustments" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" className="gap-1" onClick={() => setShowAdjDialog(true)}>
              <Plus className="h-3 w-3" /> Manual Adjustment
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Points</th>
                      <th className="px-3 py-2 text-right">RM</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustments.map((a, i) => (
                      <tr key={a.id} className="border-b hover:bg-muted/30">
                        <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 text-xs">{new Date(a.created_at).toLocaleString('en-MY')}</td>
                        <td className="px-3 py-2">
                          <Badge variant={a.adjustment_type.includes('credit') || a.adjustment_type.includes('transfer_in') ? 'default' : 'destructive'} className="text-[10px]">
                            {a.adjustment_type.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className={`px-3 py-2 text-right font-medium ${
                          a.adjustment_type.includes('credit') || a.adjustment_type.includes('transfer_in')
                            ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {a.adjustment_type.includes('credit') || a.adjustment_type.includes('transfer_in') ? '+' : '-'}
                          {formatNumber(a.points_amount)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          RM {Number(a.rm_amount).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                          {a.reason}
                        </td>
                      </tr>
                    ))}
                    {adjustments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                          No adjustments.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Manual Adjustment Dialog */}
      <Dialog open={showAdjDialog} onOpenChange={setShowAdjDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Referral Balance Adjustment</DialogTitle>
            <DialogDescription>
              Adjust the referral balance for <strong>{refProfile?.full_name}</strong>. This will be logged as an audit entry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={adjType} onValueChange={(v: any) => setAdjType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Credit (+)</SelectItem>
                  <SelectItem value="debit">Debit (-)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Points Amount</Label>
              <Input type="number" min={1} value={adjPoints || ''} onChange={e => setAdjPoints(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Reason <span className="text-red-500">*</span></Label>
              <Textarea value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="Reason for adjustment..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjDialog(false)}>Cancel</Button>
            <Button onClick={handleAdjustment} disabled={adjProcessing || !adjPoints || !adjReason.trim()}>
              {adjProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Apply Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Claim Action Dialog */}
      <Dialog open={!!selectedClaim && !!claimAction} onOpenChange={() => { setSelectedClaim(null); setClaimAction(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {claimAction === 'approve' ? 'Approve Claim' :
               claimAction === 'reject' ? 'Reject Claim' :
               'Mark Claim as Paid'}
            </DialogTitle>
            <DialogDescription>
              {selectedClaim && (
                <>Claim for {formatNumber(selectedClaim.claim_points)} points (RM {Number(selectedClaim.claim_rm).toFixed(2)})</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {claimAction === 'reject' && (
              <div>
                <Label>Rejection Reason <span className="text-red-500">*</span></Label>
                <Textarea value={claimReason} onChange={e => setClaimReason(e.target.value)} placeholder="Reason..." />
              </div>
            )}
            {claimAction === 'approve' && (
              <div>
                <Label>Notes (optional)</Label>
                <Textarea value={claimReason} onChange={e => setClaimReason(e.target.value)} placeholder="Approval notes..." />
              </div>
            )}
            {claimAction === 'mark_paid' && (
              <div>
                <Label>Payment Reference</Label>
                <Input value={claimPayRef} onChange={e => setClaimPayRef(e.target.value)} placeholder="e.g., Bank transfer ref #" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedClaim(null); setClaimAction(null) }}>Cancel</Button>
            <Button
              variant={claimAction === 'reject' ? 'destructive' : 'default'}
              onClick={handleClaimAction}
              disabled={claimProcessing || (claimAction === 'reject' && !claimReason.trim())}
            >
              {claimProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {claimAction === 'approve' ? 'Approve' : claimAction === 'reject' ? 'Reject' : 'Mark Paid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
