'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Search, Users, TrendingUp, ArrowUpDown, Eye, Download,
  CheckCircle, XCircle, Clock, Banknote, UserCheck, AlertCircle,
  Loader2, ChevronLeft, ChevronRight, RefreshCw, DollarSign,
  UserMinus, ArrowRightLeft
} from 'lucide-react'
import { formatNumber } from './catalog-utils'

interface ReferralMonitorEntry {
  reference_user_id: string
  reference_name: string
  reference_phone: string
  reference_email: string
  employment_status: string
  assigned_shops_count: number
  total_accrued_points: number
  total_accrued_rm: number
  total_claimed_points: number
  total_claimed_rm: number
  pending_claims_count: number
  claimable_points: number
  claimable_rm: number
}

interface PendingClaim {
  id: string
  reference_user_id: string
  claim_points: number
  claim_rm: number
  status: string
  submitted_at: string
  reference_name?: string
}

interface ReferralMonitorProps {
  userProfile: any
  onViewDetail?: (referenceUserId: string) => void
}

export function ReferralMonitor({ userProfile, onViewDetail }: ReferralMonitorProps) {
  const supabase = createClient()
  const companyId = userProfile.organizations.id

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ReferralMonitorEntry[]>([])
  const [pendingClaims, setPendingClaims] = useState<PendingClaim[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'resigned'>('all')
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'total_accrued_rm', direction: 'desc'
  })
  const [page, setPage] = useState(1)
  const pageSize = 20

  // Claim approval dialog
  const [selectedClaim, setSelectedClaim] = useState<PendingClaim | null>(null)
  const [claimAction, setClaimAction] = useState<'approve' | 'reject' | null>(null)
  const [claimReason, setClaimReason] = useState('')
  const [processing, setProcessing] = useState(false)

  // Bulk reassign dialog
  const [showReassignDialog, setShowReassignDialog] = useState(false)
  const [reassignFrom, setReassignFrom] = useState<ReferralMonitorEntry | null>(null)
  const [reassignToId, setReassignToId] = useState('')
  const [transferBalance, setTransferBalance] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const { data: monitorData, error } = await supabase
        .from('v_referral_monitor')
        .select('*')
        .order('total_accrued_rm', { ascending: false })

      if (error) throw error
      setData(monitorData || [])

      // Load pending claims
      const { data: claims } = await supabase
        .from('referral_claims')
        .select('*, users!referral_claims_reference_user_id_fkey(full_name)')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false })

      setPendingClaims((claims || []).map((c: any) => ({
        ...c,
        reference_name: c.users?.full_name
      })))
    } catch (error: any) {
      console.error('Error loading referral monitor:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => { loadData() }, [loadData])

  const filteredData = useMemo(() => {
    let result = data
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      result = result.filter(r =>
        r.reference_name?.toLowerCase().includes(s) ||
        r.reference_phone?.toLowerCase().includes(s) ||
        r.reference_email?.toLowerCase().includes(s)
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter(r => r.employment_status === statusFilter)
    }
    // Sort
    result = [...result].sort((a: any, b: any) => {
      const aVal = a[sortConfig.key] ?? 0
      const bVal = b[sortConfig.key] ?? 0
      return sortConfig.direction === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1)
    })
    return result
  }, [data, searchTerm, statusFilter, sortConfig])

  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredData.slice(start, start + pageSize)
  }, [filteredData, page])

  const totalPages = Math.ceil(filteredData.length / pageSize)

  // Summary stats
  const summaryStats = useMemo(() => {
    return {
      totalReferences: data.length,
      activeReferences: data.filter(d => d.employment_status === 'active').length,
      totalAccruedRm: data.reduce((s, d) => s + Number(d.total_accrued_rm || 0), 0),
      totalClaimedRm: data.reduce((s, d) => s + Number(d.total_claimed_rm || 0), 0),
      totalClaimableRm: data.reduce((s, d) => s + Number(d.claimable_rm || 0), 0),
      pendingClaimsCount: pendingClaims.length,
    }
  }, [data, pendingClaims])

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }))
  }

  const handleClaimAction = async () => {
    if (!selectedClaim || !claimAction) return
    try {
      setProcessing(true)
      const { data: result, error } = await supabase.rpc('process_referral_claim', {
        p_claim_id: selectedClaim.id,
        p_action: claimAction,
        p_reviewer_id: userProfile.id,
        p_reason: claimReason || null,
      })
      if (error) throw error
      setSelectedClaim(null)
      setClaimAction(null)
      setClaimReason('')
      loadData()
    } catch (error: any) {
      console.error('Error processing claim:', error)
    } finally {
      setProcessing(false)
    }
  }

  const handleBulkReassign = async () => {
    if (!reassignFrom || !reassignToId) return
    try {
      setProcessing(true)
      const { data: result, error } = await supabase.rpc('bulk_reassign_reference', {
        p_old_reference_id: reassignFrom.reference_user_id,
        p_new_reference_id: reassignToId,
        p_admin_id: userProfile.id,
        p_transfer_balance: transferBalance,
      })
      if (error) throw error
      setShowReassignDialog(false)
      setReassignFrom(null)
      setReassignToId('')
      loadData()
    } catch (error: any) {
      console.error('Error reassigning:', error)
    } finally {
      setProcessing(false)
    }
  }

  const exportCSV = () => {
    const headers = ['#', 'Reference Name', 'Phone', 'Email', 'Status', 'Assigned Shops', 'Accrued Points', 'Accrued RM', 'Claimed RM', 'Claimable RM', 'Pending Claims']
    const rows = filteredData.map((d, i) => [
      i + 1, d.reference_name, d.reference_phone, d.reference_email, d.employment_status,
      d.assigned_shops_count, d.total_accrued_points, Number(d.total_accrued_rm).toFixed(2),
      Number(d.total_claimed_rm).toFixed(2), Number(d.claimable_rm).toFixed(2), d.pending_claims_count
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `referral-monitor-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Referral Monitor
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Track referral incentive accruals, claims, and assigned shops per marketing person.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} className="gap-1">
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1">
            <Download className="h-3 w-3" /> Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total References</p>
            <p className="text-2xl font-bold">{summaryStats.totalReferences}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="text-2xl font-bold text-green-600">{summaryStats.activeReferences}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Accrued</p>
            <p className="text-2xl font-bold text-blue-600">RM {formatNumber(summaryStats.totalAccruedRm)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Claimed</p>
            <p className="text-2xl font-bold text-purple-600">RM {formatNumber(summaryStats.totalClaimedRm)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Claimable</p>
            <p className="text-2xl font-bold text-amber-600">RM {formatNumber(summaryStats.totalClaimableRm)}</p>
          </CardContent>
        </Card>
        <Card className={summaryStats.pendingClaimsCount > 0 ? 'border-orange-300 bg-orange-50' : ''}>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Pending Claims</p>
            <p className="text-2xl font-bold text-orange-600">{summaryStats.pendingClaimsCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pending Claims Section */}
      {pendingClaims.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-500" />
              Pending Claims Requiring Approval
              <Badge variant="destructive">{pendingClaims.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingClaims.map(claim => (
                <div key={claim.id} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                  <div>
                    <p className="font-medium">{claim.reference_name || 'Unknown'}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatNumber(claim.claim_points)} points = RM {Number(claim.claim_rm).toFixed(2)}
                      <span className="ml-2 text-xs">
                        Submitted {new Date(claim.submitted_at).toLocaleString('en-MY')}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="gap-1 bg-green-600 hover:bg-green-700"
                      onClick={() => { setSelectedClaim(claim); setClaimAction('approve') }}
                    >
                      <CheckCircle className="h-3 w-3" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1"
                      onClick={() => { setSelectedClaim(claim); setClaimAction('reject') }}
                    >
                      <XCircle className="h-3 w-3" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reference name, phone, email..."
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v: any) => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="resigned">Resigned</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{filteredData.length} references</p>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left cursor-pointer" onClick={() => handleSort('reference_name')}>
                    <span className="flex items-center gap-1">Reference <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right cursor-pointer" onClick={() => handleSort('assigned_shops_count')}>
                    <span className="flex items-center gap-1 justify-end">Shops <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="px-3 py-2 text-right cursor-pointer" onClick={() => handleSort('total_accrued_points')}>
                    <span className="flex items-center gap-1 justify-end">Accrued Pts <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="px-3 py-2 text-right cursor-pointer" onClick={() => handleSort('total_accrued_rm')}>
                    <span className="flex items-center gap-1 justify-end">Accrued RM <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="px-3 py-2 text-right">Claimed RM</th>
                  <th className="px-3 py-2 text-right cursor-pointer" onClick={() => handleSort('claimable_rm')}>
                    <span className="flex items-center gap-1 justify-end">Claimable RM <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((row, idx) => (
                  <tr key={row.reference_user_id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground">{(page - 1) * pageSize + idx + 1}</td>
                    <td className="px-3 py-2">
                      <div>
                        <p className="font-medium">{row.reference_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">{row.reference_phone}</p>
                        {row.reference_email && (
                          <p className="text-xs text-muted-foreground">{row.reference_email}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={row.employment_status === 'active' ? 'default' : 'destructive'} className="text-xs">
                        {row.employment_status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{row.assigned_shops_count}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-green-600">+{formatNumber(row.total_accrued_points)}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      RM {Number(row.total_accrued_rm).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-purple-600">
                      RM {Number(row.total_claimed_rm).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-600">
                      RM {Number(row.claimable_rm).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.pending_claims_count > 0 && (
                        <Badge variant="destructive" className="text-xs">{row.pending_claims_count}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center gap-1 justify-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="View Details"
                          onClick={() => onViewDetail?.(row.reference_user_id)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {row.employment_status === 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-orange-500 hover:text-orange-700"
                            title="Reassign Shops"
                            onClick={() => { setReassignFrom(row); setShowReassignDialog(true) }}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {paginatedData.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                      No referral data found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredData.length)} of {filteredData.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Claim Approval Dialog */}
      <Dialog open={!!selectedClaim && !!claimAction} onOpenChange={() => { setSelectedClaim(null); setClaimAction(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {claimAction === 'approve' ? 'Approve Claim' : 'Reject Claim'}
            </DialogTitle>
            <DialogDescription>
              {selectedClaim && (
                <>
                  Claim by <strong>{selectedClaim.reference_name}</strong> for{' '}
                  <strong>{formatNumber(selectedClaim.claim_points)} points (RM {Number(selectedClaim.claim_rm).toFixed(2)})</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{claimAction === 'approve' ? 'Approval Notes (optional)' : 'Rejection Reason'}</Label>
            <Textarea
              value={claimReason}
              onChange={e => setClaimReason(e.target.value)}
              placeholder={claimAction === 'reject' ? 'Please provide a reason for rejection...' : 'Optional notes...'}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedClaim(null); setClaimAction(null) }}>
              Cancel
            </Button>
            <Button
              variant={claimAction === 'approve' ? 'default' : 'destructive'}
              onClick={handleClaimAction}
              disabled={processing || (claimAction === 'reject' && !claimReason.trim())}
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {claimAction === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Reassign Dialog */}
      <Dialog open={showReassignDialog} onOpenChange={setShowReassignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Reassign Shops</DialogTitle>
            <DialogDescription>
              Transfer all assigned shops from <strong>{reassignFrom?.reference_name}</strong> to a new reference.
              This will also update the referral_phone on each shop's profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Current Reference</Label>
              <p className="text-sm font-medium mt-1">
                {reassignFrom?.reference_name} ({reassignFrom?.assigned_shops_count} shops)
              </p>
            </div>
            <div>
              <Label>New Reference User ID</Label>
              <Input
                value={reassignToId}
                onChange={e => setReassignToId(e.target.value)}
                placeholder="UUID of the new reference user"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Paste the UUID of the new marketing person from User Management.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={transferBalance}
                onChange={e => setTransferBalance(e.target.checked)}
                id="transferBalance"
              />
              <Label htmlFor="transferBalance" className="text-sm">
                Also transfer remaining claimable balance (creates adjustment entries)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReassignDialog(false)}>Cancel</Button>
            <Button
              onClick={handleBulkReassign}
              disabled={processing || !reassignToId.trim()}
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
