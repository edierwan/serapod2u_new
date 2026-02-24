'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  Search, ArrowUpDown, Download, Loader2,
  ChevronLeft, ChevronRight, RefreshCw, Clock,
  CheckCircle, XCircle, AlertCircle, ArrowRight,
  FileText, Calendar, UserCheck
} from 'lucide-react'

interface ChangeLogEntry {
  id: string
  org_id: string
  shop_user_id: string
  shop_name: string | null
  shop_phone: string | null
  old_reference_phone: string | null
  old_reference_name: string | null
  old_reference_id: string | null
  new_reference_phone: string | null
  new_reference_name: string | null
  new_reference_id: string | null
  changed_by: string | null
  changed_by_type: string
  changed_at: string
  policy_mode: string
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  effective_from: string | null
}

interface ReferenceChangeLogProps {
  userProfile: any
}

const STATUS_COLORS: Record<string, string> = {
  auto_approved: 'bg-green-100 text-green-800 border-green-200',
  approved: 'bg-blue-100 text-blue-800 border-blue-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  auto_approved: <CheckCircle className="h-3 w-3" />,
  approved: <CheckCircle className="h-3 w-3" />,
  pending: <Clock className="h-3 w-3" />,
  rejected: <XCircle className="h-3 w-3" />,
}

export function ReferenceChangeLog({ userProfile }: ReferenceChangeLogProps) {
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ChangeLogEntry[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const pageSize = 25

  // Approval dialog
  const [selectedEntry, setSelectedEntry] = useState<ChangeLogEntry | null>(null)
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [processing, setProcessing] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const { data: logData, error } = await supabase
        .from('reference_change_log')
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(1000)

      if (error) throw error
      setData(logData || [])
    } catch (error: any) {
      console.error('Error loading change log:', error)
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
        r.shop_name?.toLowerCase().includes(s) ||
        r.shop_phone?.toLowerCase().includes(s) ||
        r.old_reference_name?.toLowerCase().includes(s) ||
        r.new_reference_name?.toLowerCase().includes(s) ||
        r.old_reference_phone?.toLowerCase().includes(s) ||
        r.new_reference_phone?.toLowerCase().includes(s)
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter(r => r.status === statusFilter)
    }
    return result
  }, [data, searchTerm, statusFilter])

  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredData.slice(start, start + pageSize)
  }, [filteredData, page])

  const totalPages = Math.ceil(filteredData.length / pageSize)

  const pendingCount = useMemo(() => data.filter(d => d.status === 'pending').length, [data])

  const handleApproval = async () => {
    if (!selectedEntry || !approvalAction) return
    try {
      setProcessing(true)
      const { data: result, error } = await supabase.rpc('approve_reference_change', {
        p_change_id: selectedEntry.id,
        p_action: approvalAction,
        p_reviewer_id: userProfile.id,
        p_reason: rejectionReason || null,
      })
      if (error) throw error
      setSelectedEntry(null)
      setApprovalAction(null)
      setRejectionReason('')
      loadData()
    } catch (error: any) {
      console.error('Error processing approval:', error)
    } finally {
      setProcessing(false)
    }
  }

  const exportCSV = () => {
    const headers = [
      'Date', 'Shop', 'Shop Phone', 'Old Reference', 'Old Ref Phone',
      'New Reference', 'New Ref Phone', 'Changed By', 'Policy', 'Status', 'Effective From'
    ]
    const rows = filteredData.map(d => [
      new Date(d.changed_at).toLocaleString('en-MY'),
      d.shop_name || '', d.shop_phone || '',
      d.old_reference_name || '', d.old_reference_phone || '',
      d.new_reference_name || '', d.new_reference_phone || '',
      d.changed_by_type, d.policy_mode, d.status,
      d.effective_from ? new Date(d.effective_from).toLocaleString('en-MY') : ''
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reference-changes-${new Date().toISOString().split('T')[0]}.csv`
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
            <FileText className="h-5 w-5 text-primary" />
            Reference Change Log
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Audit trail of all reference/referral changes with approval status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <Clock className="h-3 w-3" /> {pendingCount} pending
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={loadData} className="gap-1">
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1">
            <Download className="h-3 w-3" /> Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search shop, reference name/phone..."
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="auto_approved">Auto Approved</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{filteredData.length} records</p>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Shop</th>
                  <th className="px-3 py-2 text-left">Old Reference</th>
                  <th className="px-3 py-2 text-center w-8"></th>
                  <th className="px-3 py-2 text-left">New Reference</th>
                  <th className="px-3 py-2 text-left">Changed By</th>
                  <th className="px-3 py-2 text-left">Policy</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Effective From</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((row, idx) => (
                  <tr key={row.id} className={`border-b hover:bg-muted/30 ${row.status === 'pending' ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{(page - 1) * pageSize + idx + 1}</td>
                    <td className="px-3 py-2">
                      <div className="text-xs">
                        <p>{new Date(row.changed_at).toLocaleDateString('en-MY')}</p>
                        <p className="text-muted-foreground">{new Date(row.changed_at).toLocaleTimeString('en-MY')}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        <p className="font-medium text-xs">{row.shop_name || '—'}</p>
                        <p className="text-xs text-muted-foreground">{row.shop_phone || ''}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        <p className="text-xs">{row.old_reference_name || '(none)'}</p>
                        <p className="text-xs text-muted-foreground">{row.old_reference_phone || ''}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ArrowRight className="h-3 w-3 text-muted-foreground inline" />
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        <p className="text-xs font-medium">{row.new_reference_name || '(none)'}</p>
                        <p className="text-xs text-muted-foreground">{row.new_reference_phone || ''}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px]">{row.changed_by_type}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {row.policy_mode === 'first_time_auto' ? 'First time' : row.policy_mode}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={`text-[10px] gap-1 ${STATUS_COLORS[row.status] || ''}`}>
                        {STATUS_ICONS[row.status]} {row.status.replace('_', ' ')}
                      </Badge>
                      {row.rejection_reason && (
                        <p className="text-[10px] text-red-600 mt-0.5" title={row.rejection_reason}>
                          {row.rejection_reason.substring(0, 30)}...
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.effective_from ? (
                        <p className="text-xs">{new Date(row.effective_from).toLocaleString('en-MY')}</p>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.status === 'pending' && (
                        <div className="flex items-center gap-1 justify-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] bg-green-50 text-green-700 hover:bg-green-100"
                            onClick={() => { setSelectedEntry(row); setApprovalAction('approve') }}
                          >
                            <CheckCircle className="h-3 w-3 mr-0.5" /> Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] bg-red-50 text-red-700 hover:bg-red-100"
                            onClick={() => { setSelectedEntry(row); setApprovalAction('reject') }}
                          >
                            <XCircle className="h-3 w-3 mr-0.5" /> Reject
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {paginatedData.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                      No reference changes found.
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

      {/* Approval Dialog */}
      <Dialog open={!!selectedEntry && !!approvalAction} onOpenChange={() => { setSelectedEntry(null); setApprovalAction(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approvalAction === 'approve' ? 'Approve Reference Change' : 'Reject Reference Change'}
            </DialogTitle>
            <DialogDescription>
              {selectedEntry && (
                <>
                  <strong>{selectedEntry.shop_name}</strong> wants to change reference from{' '}
                  <strong>{selectedEntry.old_reference_name || '(none)'}</strong> to{' '}
                  <strong>{selectedEntry.new_reference_name || selectedEntry.new_reference_phone}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {approvalAction === 'reject' && (
            <div className="space-y-3">
              <Label>Rejection Reason <span className="text-red-500">*</span></Label>
              <Textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Please provide a reason..."
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedEntry(null); setApprovalAction(null) }}>
              Cancel
            </Button>
            <Button
              variant={approvalAction === 'approve' ? 'default' : 'destructive'}
              onClick={handleApproval}
              disabled={processing || (approvalAction === 'reject' && !rejectionReason.trim())}
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {approvalAction === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
