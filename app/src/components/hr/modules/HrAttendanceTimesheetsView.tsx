'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { useToast } from '@/components/ui/use-toast'
import { usePermissions } from '@/hooks/usePermissions'
import {
    TimesheetRecord, fetchTimesheets, generateTimesheet, submitTimesheet,
    fetchCorrectionRequests, reviewCorrectionRequest, AttendanceCorrectionRequest
} from '@/lib/api/attendance'
import { CalendarDays, CheckCircle, Clock3, FileText, Inbox, XCircle } from 'lucide-react'

interface HrAttendanceTimesheetsViewProps {
    userProfile: {
        id: string
        role_code: string
        roles: { role_level: number }
        department_id?: string | null
        organizations: { id: string }
    }
}

const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
        draft: { variant: 'outline', label: 'Draft' },
        submitted: { variant: 'secondary', label: 'Submitted' },
        pending: { variant: 'secondary', label: 'Pending' },
        approved: { variant: 'default', label: 'Approved' },
        rejected: { variant: 'destructive', label: 'Rejected' },
    }
    const item = map[status] || { variant: 'outline' as const, label: status }
    return <Badge variant={item.variant}>{item.label}</Badge>
}

export default function HrAttendanceTimesheetsView({ userProfile }: HrAttendanceTimesheetsViewProps) {
    const { hasPermission } = usePermissions(userProfile.roles.role_level, userProfile.role_code, userProfile.department_id)
    const canManage = userProfile.roles.role_level <= 20 || hasPermission('manage_org_chart')
    const { toast } = useToast()

    const [timesheets, setTimesheets] = useState<TimesheetRecord[]>([])
    const [corrections, setCorrections] = useState<AttendanceCorrectionRequest[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [filter, setFilter] = useState<'all' | 'mine'>('mine')

    const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
    const [genForm, setGenForm] = useState({ period_start: '', period_end: '', period_type: 'monthly' as 'weekly' | 'biweekly' | 'monthly' })

    const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
    const [reviewItem, setReviewItem] = useState<AttendanceCorrectionRequest | null>(null)
    const [reviewNote, setReviewNote] = useState('')

    const loadData = async () => {
        setLoading(true)
        const userId = filter === 'mine' ? userProfile.id : undefined
        const [ts, cr] = await Promise.all([
            fetchTimesheets({ user_id: userId }),
            canManage ? fetchCorrectionRequests({ status: 'pending' }) : Promise.resolve({ success: true, data: [] })
        ])
        if (ts.success && ts.data) setTimesheets(ts.data)
        if (cr.success && cr.data) setCorrections(cr.data as AttendanceCorrectionRequest[])
        setLoading(false)
    }

    useEffect(() => { loadData() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

    const pendingCorrections = useMemo(() => corrections.filter(c => c.status === 'pending'), [corrections])

    const handleGenerate = async () => {
        if (!genForm.period_start || !genForm.period_end) { toast({ title: 'Validation', description: 'Period dates are required.', variant: 'destructive' }); return }
        setActionLoading(true)
        const result = await generateTimesheet({ period_start: genForm.period_start, period_end: genForm.period_end, period_type: genForm.period_type })
        if (result.success) { toast({ title: 'Timesheet generated' }); setGenerateDialogOpen(false); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleSubmitTimesheet = async (id: string) => {
        setActionLoading(true)
        const result = await submitTimesheet(id)
        if (result.success) { toast({ title: 'Timesheet submitted for approval' }); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleApproveTimesheet = async (id: string) => {
        setActionLoading(true)
        const res = await fetch(`/api/hr/attendance/timesheets/${id}/approve`, { method: 'POST' })
        const data = await res.json()
        if (data.success) { toast({ title: 'Timesheet approved' }); loadData() }
        else toast({ title: 'Error', description: data.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleRejectTimesheet = async (id: string) => {
        setActionLoading(true)
        const res = await fetch(`/api/hr/attendance/timesheets/${id}/reject`, { method: 'POST' })
        const data = await res.json()
        if (data.success) { toast({ title: 'Timesheet rejected' }); loadData() }
        else toast({ title: 'Error', description: data.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleReviewCorrection = async (action: 'approved' | 'rejected') => {
        if (!reviewItem) return
        setActionLoading(true)
        const result = await reviewCorrectionRequest(reviewItem.id, action, reviewNote || undefined)
        if (result.success) { toast({ title: `Correction ${action}` }); setReviewDialogOpen(false); setReviewNote(''); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const setMonthlyPeriod = () => {
        const now = new Date()
        const y = now.getFullYear(); const m = now.getMonth()
        const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
        const end = new Date(y, m + 1, 0).toISOString().split('T')[0]
        setGenForm({ period_start: start, period_end: end, period_type: 'monthly' })
    }

    return (
        <div className="space-y-6">
            {canManage && pendingCorrections.length > 0 && (
                <Card className="border-amber-200 bg-amber-50">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Inbox className="h-5 w-5 text-amber-600" />
                                <CardTitle className="text-base text-amber-800">Pending Corrections ({pendingCorrections.length})</CardTitle>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {pendingCorrections.map(item => (
                            <div key={item.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-white p-3">
                                <div>
                                    <div className="text-sm font-medium">{item.reason}</div>
                                    <div className="text-xs text-gray-500">
                                        Entry: {new Date(item.entry_id).toLocaleDateString()}
                                        {item.corrected_clock_out && ` → Out: ${new Date(item.corrected_clock_out).toLocaleString()}`}
                                    </div>
                                </div>
                                <Button size="sm" variant="outline" onClick={() => { setReviewItem(item); setReviewDialogOpen(true) }}>Review</Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-lg">Timesheets</CardTitle>
                            <CardDescription>Weekly or monthly aggregated timesheet records.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Select value={filter} onValueChange={v => setFilter(v as typeof filter)}>
                                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="mine">My Timesheets</SelectItem>
                                    {canManage && <SelectItem value="all">All Staff</SelectItem>}
                                </SelectContent>
                            </Select>
                            <Button size="sm" onClick={() => { setMonthlyPeriod(); setGenerateDialogOpen(true) }}>
                                <FileText className="h-4 w-4 mr-1" />Generate
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? <div className="text-center py-8 text-gray-500">Loading timesheets...</div> : timesheets.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                            <p>No timesheets found.</p>
                            <p className="text-xs mt-1">Generate a timesheet for the current period to get started.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Period</TableHead>
                                        {filter === 'all' && <TableHead>Employee</TableHead>}
                                        <TableHead>Days</TableHead>
                                        <TableHead>Total Hours</TableHead>
                                        <TableHead>OT Hours</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {timesheets.map(ts => (
                                        <TableRow key={ts.id}>
                                            <TableCell>
                                                <div className="text-sm font-medium">{new Date(ts.period_start).toLocaleDateString()} – {new Date(ts.period_end).toLocaleDateString()}</div>
                                                {ts.period_type && <div className="text-xs text-gray-400 capitalize">{ts.period_type}</div>}
                                            </TableCell>
                                            {filter === 'all' && <TableCell className="text-sm">{ts.user_id.slice(0, 8)}...</TableCell>}
                                            <TableCell className="text-sm">{ts.total_days || '-'}</TableCell>
                                            <TableCell className="text-sm">{ts.total_work_minutes ? `${(ts.total_work_minutes / 60).toFixed(1)}h` : '-'}</TableCell>
                                            <TableCell className="text-sm">{ts.total_overtime_minutes ? `${(ts.total_overtime_minutes / 60).toFixed(1)}h` : '-'}</TableCell>
                                            <TableCell>{statusBadge(ts.status)}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {ts.status === 'draft' && ts.user_id === userProfile.id && (
                                                        <Button size="sm" variant="outline" onClick={() => handleSubmitTimesheet(ts.id)} disabled={actionLoading}>Submit</Button>
                                                    )}
                                                    {canManage && (ts.status === 'submitted' || ts.status === 'pending') && (
                                                        <>
                                                            <Button size="sm" onClick={() => handleApproveTimesheet(ts.id)} disabled={actionLoading}><CheckCircle className="h-4 w-4 mr-1" />Approve</Button>
                                                            <Button size="sm" variant="destructive" onClick={() => handleRejectTimesheet(ts.id)} disabled={actionLoading}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
                                                        </>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader><DialogTitle>Generate Timesheet</DialogTitle><DialogDescription>Aggregate attendance entries into a timesheet for approval.</DialogDescription></DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Period type</Label>
                            <Select value={genForm.period_type} onValueChange={v => setGenForm(p => ({ ...p, period_type: v as typeof p.period_type }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="weekly">Weekly</SelectItem>
                                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                                    <SelectItem value="monthly">Monthly</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Start date</Label><Input type="date" value={genForm.period_start} onChange={e => setGenForm(p => ({ ...p, period_start: e.target.value }))} /></div>
                            <div className="space-y-2"><Label>End date</Label><Input type="date" value={genForm.period_end} onChange={e => setGenForm(p => ({ ...p, period_end: e.target.value }))} /></div>
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-1"><Clock3 className="h-3 w-3" />This will aggregate all approved attendance entries in this date range.</div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGenerateDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleGenerate} disabled={actionLoading}>{actionLoading ? 'Generating...' : 'Generate'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader><DialogTitle>Review Correction Request</DialogTitle></DialogHeader>
                    {reviewItem && (
                        <div className="space-y-4">
                            <div className="rounded-lg border p-3 bg-gray-50">
                                <div className="text-sm font-medium">Reason: {reviewItem.reason}</div>
                                {reviewItem.corrected_clock_in && <div className="text-xs text-gray-500 mt-1">Corrected in: {new Date(reviewItem.corrected_clock_in).toLocaleString()}</div>}
                                {reviewItem.corrected_clock_out && <div className="text-xs text-gray-500">Corrected out: {new Date(reviewItem.corrected_clock_out).toLocaleString()}</div>}
                            </div>
                            <div className="space-y-2"><Label>Review note (optional)</Label><Textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Reason for approval or rejection..." /></div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={() => handleReviewCorrection('rejected')} disabled={actionLoading}>Reject</Button>
                        <Button onClick={() => handleReviewCorrection('approved')} disabled={actionLoading}>Approve</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
