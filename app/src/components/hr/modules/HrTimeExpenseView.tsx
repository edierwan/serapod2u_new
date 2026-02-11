'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Clock3, Receipt, ShieldCheck } from 'lucide-react'

interface Timesheet {
    id: string
    status: string
    period_start: string
    period_end: string
}

interface Claim {
    id: string
    status: string
    total_amount?: number | null
}

export default function HrTimeExpenseView() {
    const [timesheets, setTimesheets] = useState<Timesheet[]>([])
    const [claims, setClaims] = useState<Claim[]>([])
    const [loading, setLoading] = useState(true)
    const [timesheetDialogOpen, setTimesheetDialogOpen] = useState(false)
    const [claimDialogOpen, setClaimDialogOpen] = useState(false)
    const [glDialogOpen, setGlDialogOpen] = useState(false)
    const [timesheetForm, setTimesheetForm] = useState({ period_start: '', period_end: '' })
    const [claimForm, setClaimForm] = useState({ total_amount: '', currency: 'MYR' })
    const [glForm, setGlForm] = useState({ expense_account: '', reimbursement_account: '' })
    const [saving, setSaving] = useState(false)

    const load = async () => {
        setLoading(true)
        const [timesheetsRes, claimsRes] = await Promise.all([
            fetch('/api/hr/time-expense/timesheets'),
            fetch('/api/hr/time-expense/claims')
        ])
        const timesheetsJson = await timesheetsRes.json()
        const claimsJson = await claimsRes.json()
        setTimesheets(timesheetsJson.data || [])
        setClaims(claimsJson.data || [])
        setLoading(false)
    }

    useEffect(() => {
        load()
    }, [])

    const handleCreateTimesheet = async () => {
        if (!timesheetForm.period_start || !timesheetForm.period_end) return
        setSaving(true)
        const res = await fetch('/api/hr/time-expense/timesheets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                period_start: timesheetForm.period_start,
                period_end: timesheetForm.period_end
            })
        })
        setSaving(false)
        if (res.ok) {
            setTimesheetDialogOpen(false)
            setTimesheetForm({ period_start: '', period_end: '' })
            await load()
        }
    }

    const handleCreateClaim = async () => {
        setSaving(true)
        const res = await fetch('/api/hr/time-expense/claims', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                total_amount: claimForm.total_amount ? Number(claimForm.total_amount) : null,
                currency: claimForm.currency || 'MYR'
            })
        })
        setSaving(false)
        if (res.ok) {
            setClaimDialogOpen(false)
            setClaimForm({ total_amount: '', currency: 'MYR' })
            await load()
        }
    }

    const handleSaveGlMapping = async () => {
        if (!glForm.expense_account.trim() || !glForm.reimbursement_account.trim()) return
        setSaving(true)
        const res = await fetch('/api/hr/finance/gl-mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                document_type: 'HR_EXPENSE_CLAIM',
                expense_account_id: glForm.expense_account.trim(),
                offset_account_id: glForm.reimbursement_account.trim()
            })
        })
        setSaving(false)
        if (res.ok) {
            setGlDialogOpen(false)
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="text-lg">Time & Expense Tracking</CardTitle>
                            <CardDescription>Capture timesheets, overtime, and expense claims with approvals.</CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setTimesheetDialogOpen(true)}>New Timesheet</Button>
                            <Button onClick={() => setClaimDialogOpen(true)}>New Claim</Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Timesheets</p>
                            <p className="text-2xl font-semibold">{timesheets.length}</p>
                        </div>
                        <Clock3 className="h-6 w-6 text-blue-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Claims</p>
                            <p className="text-2xl font-semibold">{claims.length}</p>
                        </div>
                        <Receipt className="h-6 w-6 text-emerald-600" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Pending Approval</p>
                            <p className="text-2xl font-semibold">{claims.filter(c => c.status === 'submitted').length}</p>
                        </div>
                        <ShieldCheck className="h-6 w-6 text-indigo-600" />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Recent Expense Claims</CardTitle>
                    <CardDescription>Track reimbursement progress and approvals.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">Loading claims...</div>
                    ) : claims.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">No claims submitted.</div>
                    ) : (
                        <div className="space-y-3">
                            {claims.slice(0, 6).map(claim => (
                                <div key={claim.id} className="flex items-center justify-between rounded-lg border p-4">
                                    <div>
                                        <div className="font-medium">Claim #{claim.id.slice(0, 6).toUpperCase()}</div>
                                        <div className="text-sm text-muted-foreground">Total {claim.total_amount ?? 0} MYR</div>
                                    </div>
                                    <Badge variant={claim.status === 'approved' ? 'default' : 'secondary'}>
                                        {claim.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">GL Integration</CardTitle>
                    <CardDescription>Map approved claims to finance journals and reimbursement accounts.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">Configure GL mapping for expense categories and payroll reimbursements.</p>
                    <Button variant="outline" onClick={() => setGlDialogOpen(true)}>Configure GL Mapping</Button>
                </CardContent>
            </Card>

            <Dialog open={timesheetDialogOpen} onOpenChange={setTimesheetDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Timesheet</DialogTitle>
                        <DialogDescription>Define the period for this timesheet.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Period start</label>
                            <Input
                                type="date"
                                value={timesheetForm.period_start}
                                onChange={(e) => setTimesheetForm(prev => ({ ...prev, period_start: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Period end</label>
                            <Input
                                type="date"
                                value={timesheetForm.period_end}
                                onChange={(e) => setTimesheetForm(prev => ({ ...prev, period_end: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTimesheetDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateTimesheet} disabled={saving}>Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Create Expense Claim</DialogTitle>
                        <DialogDescription>Submit a new expense claim for approval.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Total amount</label>
                            <Input
                                type="number"
                                value={claimForm.total_amount}
                                onChange={(e) => setClaimForm(prev => ({ ...prev, total_amount: e.target.value }))}
                                placeholder="0.00"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Currency</label>
                            <Input
                                value={claimForm.currency}
                                onChange={(e) => setClaimForm(prev => ({ ...prev, currency: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setClaimDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleCreateClaim} disabled={saving}>Submit</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={glDialogOpen} onOpenChange={setGlDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>GL Mapping for Expenses</DialogTitle>
                        <DialogDescription>Map expense categories and reimbursements to GL accounts.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Expense account</label>
                            <Input
                                value={glForm.expense_account}
                                onChange={(e) => setGlForm(prev => ({ ...prev, expense_account: e.target.value }))}
                                placeholder="GL Account ID"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Reimbursement account</label>
                            <Input
                                value={glForm.reimbursement_account}
                                onChange={(e) => setGlForm(prev => ({ ...prev, reimbursement_account: e.target.value }))}
                                placeholder="GL Account ID"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGlDialogOpen(false)}>Close</Button>
                        <Button onClick={handleSaveGlMapping} disabled={saving}>Save Mapping</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
