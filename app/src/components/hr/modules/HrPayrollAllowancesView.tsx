'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import {
    Tabs, TabsContent, TabsList, TabsTrigger
} from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { usePermissions } from '@/hooks/usePermissions'
import {
    AllowanceType, DeductionType, EmployeeAllowance, EmployeeDeduction,
    fetchAllowanceTypes, createAllowanceType, updateAllowanceType,
    fetchDeductionTypes, createDeductionType, updateDeductionType,
    fetchEmployeeAllowances, upsertEmployeeAllowance,
    fetchEmployeeDeductions, upsertEmployeeDeduction
} from '@/lib/api/payroll'
import { Gift, Minus, Pencil, Plus } from 'lucide-react'

interface HrPayrollAllowancesViewProps {
    userProfile: {
        id: string
        role_code: string
        roles: { role_level: number }
        department_id?: string | null
        organizations: { id: string }
    }
}

const emptyAllowType = { code: '', name: '', is_taxable: true, is_recurring: true, default_amount: 0 }
const emptyDedType = { code: '', name: '', category: 'other' as string, is_recurring: true }

export default function HrPayrollAllowancesView({ userProfile }: HrPayrollAllowancesViewProps) {
    const { hasPermission } = usePermissions(userProfile.roles.role_level, userProfile.role_code, userProfile.department_id)
    const canManage = userProfile.roles.role_level <= 20 || hasPermission('manage_org_chart')
    const { toast } = useToast()

    const [allowanceTypes, setAllowanceTypes] = useState<AllowanceType[]>([])
    const [deductionTypes, setDeductionTypes] = useState<DeductionType[]>([])
    const [empAllowances, setEmpAllowances] = useState<EmployeeAllowance[]>([])
    const [empDeductions, setEmpDeductions] = useState<EmployeeDeduction[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)

    const [allowTypeDialogOpen, setAllowTypeDialogOpen] = useState(false)
    const [editingAllowType, setEditingAllowType] = useState<AllowanceType | null>(null)
    const [allowTypeForm, setAllowTypeForm] = useState(emptyAllowType)

    const [dedTypeDialogOpen, setDedTypeDialogOpen] = useState(false)
    const [editingDedType, setEditingDedType] = useState<DeductionType | null>(null)
    const [dedTypeForm, setDedTypeForm] = useState(emptyDedType)

    const [empAllowDialogOpen, setEmpAllowDialogOpen] = useState(false)
    const [empAllowForm, setEmpAllowForm] = useState({ employee_id: '', allowance_type_id: '', amount: 0, effective_date: '', end_date: '' })

    const [empDedDialogOpen, setEmpDedDialogOpen] = useState(false)
    const [empDedForm, setEmpDedForm] = useState({ employee_id: '', deduction_type_id: '', amount: 0, effective_date: '', end_date: '', total_amount: '', remaining_amount: '' })

    const loadData = async () => {
        setLoading(true)
        const [at, dt, ea, ed] = await Promise.all([fetchAllowanceTypes(), fetchDeductionTypes(), fetchEmployeeAllowances(), fetchEmployeeDeductions()])
        if (at.success && at.data) setAllowanceTypes(at.data)
        if (dt.success && dt.data) setDeductionTypes(dt.data)
        if (ea.success && ea.data) setEmpAllowances(ea.data)
        if (ed.success && ed.data) setEmpDeductions(ed.data)
        setLoading(false)
    }

    useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleSaveAllowType = async () => {
        if (!allowTypeForm.code.trim() || !allowTypeForm.name.trim()) { toast({ title: 'Validation', description: 'Code and name required.', variant: 'destructive' }); return }
        setActionLoading(true)
        const result = editingAllowType
            ? await updateAllowanceType(editingAllowType.id, allowTypeForm)
            : await createAllowanceType(allowTypeForm)
        if (result.success) { toast({ title: editingAllowType ? 'Updated' : 'Created' }); setAllowTypeDialogOpen(false); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleSaveDedType = async () => {
        if (!dedTypeForm.code.trim() || !dedTypeForm.name.trim()) { toast({ title: 'Validation', description: 'Code and name required.', variant: 'destructive' }); return }
        setActionLoading(true)
        const result = editingDedType
            ? await updateDeductionType(editingDedType.id, dedTypeForm)
            : await createDeductionType(dedTypeForm)
        if (result.success) { toast({ title: editingDedType ? 'Updated' : 'Created' }); setDedTypeDialogOpen(false); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleSaveEmpAllow = async () => {
        if (!empAllowForm.employee_id || !empAllowForm.allowance_type_id || !empAllowForm.effective_date) { toast({ title: 'Validation', description: 'Fill required fields.', variant: 'destructive' }); return }
        setActionLoading(true)
        const result = await upsertEmployeeAllowance({
            employee_id: empAllowForm.employee_id, allowance_type_id: empAllowForm.allowance_type_id,
            amount: empAllowForm.amount, effective_date: empAllowForm.effective_date,
            end_date: empAllowForm.end_date || null
        })
        if (result.success) { toast({ title: 'Saved' }); setEmpAllowDialogOpen(false); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleSaveEmpDed = async () => {
        if (!empDedForm.employee_id || !empDedForm.deduction_type_id || !empDedForm.effective_date) { toast({ title: 'Validation', description: 'Fill required fields.', variant: 'destructive' }); return }
        setActionLoading(true)
        const result = await upsertEmployeeDeduction({
            employee_id: empDedForm.employee_id, deduction_type_id: empDedForm.deduction_type_id,
            amount: empDedForm.amount, effective_date: empDedForm.effective_date,
            end_date: empDedForm.end_date || null,
            total_amount: empDedForm.total_amount ? Number(empDedForm.total_amount) : null,
            remaining_amount: empDedForm.remaining_amount ? Number(empDedForm.remaining_amount) : null
        })
        if (result.success) { toast({ title: 'Saved' }); setEmpDedDialogOpen(false); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    return (
        <div className="space-y-6">
            <Tabs defaultValue="allowances">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="allowances"><Gift className="h-4 w-4 mr-1" />Allowances</TabsTrigger>
                    <TabsTrigger value="deductions"><Minus className="h-4 w-4 mr-1" />Deductions</TabsTrigger>
                </TabsList>

                <TabsContent value="allowances" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div><CardTitle className="text-base">Allowance Types</CardTitle><CardDescription>Master list of allowance categories.</CardDescription></div>
                                {canManage && <Button size="sm" onClick={() => { setEditingAllowType(null); setAllowTypeForm(emptyAllowType); setAllowTypeDialogOpen(true) }}><Plus className="h-4 w-4 mr-1" />Add Type</Button>}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : allowanceTypes.length === 0 ? (
                                <div className="text-center py-8 text-gray-400"><p>No allowance types defined.</p><p className="text-xs mt-1">Common: Travel, Meal, Housing, Phone.</p></div>
                            ) : (
                                <Table>
                                    <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Default (RM)</TableHead><TableHead>Taxable</TableHead><TableHead>Recurring</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {allowanceTypes.map(at => (
                                            <TableRow key={at.id}>
                                                <TableCell className="font-mono text-sm">{at.code}</TableCell>
                                                <TableCell>{at.name}</TableCell>
                                                <TableCell className="text-sm">{at.default_amount?.toLocaleString() || '-'}</TableCell>
                                                <TableCell>{at.is_taxable ? <Badge variant="secondary">Yes</Badge> : <span className="text-gray-400 text-sm">No</span>}</TableCell>
                                                <TableCell>{at.is_recurring ? '✓' : '—'}</TableCell>
                                                <TableCell className="text-right">
                                                    {canManage && <Button variant="ghost" size="sm" onClick={() => { setEditingAllowType(at); setAllowTypeForm({ code: at.code, name: at.name, is_taxable: at.is_taxable, is_recurring: at.is_recurring, default_amount: at.default_amount || 0 }); setAllowTypeDialogOpen(true) }}><Pencil className="h-4 w-4" /></Button>}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div><CardTitle className="text-base">Employee Allowances</CardTitle><CardDescription>Per-employee allowance assignments.</CardDescription></div>
                                {canManage && <Button size="sm" onClick={() => { setEmpAllowForm({ employee_id: '', allowance_type_id: '', amount: 0, effective_date: '', end_date: '' }); setEmpAllowDialogOpen(true) }}><Plus className="h-4 w-4 mr-1" />Assign</Button>}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {empAllowances.length === 0 ? <div className="text-sm text-gray-500 text-center py-6">No employee allowances.</div> : (
                                <Table>
                                    <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Amount (RM)</TableHead><TableHead>Effective</TableHead><TableHead>End</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {empAllowances.map(ea => (
                                            <TableRow key={ea.id}>
                                                <TableCell className="text-sm">{ea.employee_id.slice(0, 8)}...</TableCell>
                                                <TableCell className="text-sm">{allowanceTypes.find(at => at.id === ea.allowance_type_id)?.name || ea.allowance_type_id.slice(0, 8)}</TableCell>
                                                <TableCell className="text-sm font-medium">{ea.amount.toLocaleString()}</TableCell>
                                                <TableCell className="text-sm">{new Date(ea.effective_date).toLocaleDateString()}</TableCell>
                                                <TableCell className="text-sm">{ea.end_date ? new Date(ea.end_date).toLocaleDateString() : '—'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="deductions" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div><CardTitle className="text-base">Deduction Types</CardTitle><CardDescription>Master list of deduction categories.</CardDescription></div>
                                {canManage && <Button size="sm" onClick={() => { setEditingDedType(null); setDedTypeForm(emptyDedType); setDedTypeDialogOpen(true) }}><Plus className="h-4 w-4 mr-1" />Add Type</Button>}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {deductionTypes.length === 0 ? (
                                <div className="text-center py-8 text-gray-400"><p>No deduction types defined.</p><p className="text-xs mt-1">Common: Loan, Advance, Insurance, Other.</p></div>
                            ) : (
                                <Table>
                                    <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Recurring</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {deductionTypes.map(dt => (
                                            <TableRow key={dt.id}>
                                                <TableCell className="font-mono text-sm">{dt.code}</TableCell>
                                                <TableCell>{dt.name}</TableCell>
                                                <TableCell><Badge variant="outline" className="capitalize">{dt.category}</Badge></TableCell>
                                                <TableCell>{dt.is_recurring ? '✓' : '—'}</TableCell>
                                                <TableCell className="text-right">
                                                    {canManage && <Button variant="ghost" size="sm" onClick={() => { setEditingDedType(dt); setDedTypeForm({ code: dt.code, name: dt.name, category: dt.category, is_recurring: dt.is_recurring }); setDedTypeDialogOpen(true) }}><Pencil className="h-4 w-4" /></Button>}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div><CardTitle className="text-base">Employee Deductions</CardTitle><CardDescription>Per-employee deduction assignments (incl. loan tracking).</CardDescription></div>
                                {canManage && <Button size="sm" onClick={() => { setEmpDedForm({ employee_id: '', deduction_type_id: '', amount: 0, effective_date: '', end_date: '', total_amount: '', remaining_amount: '' }); setEmpDedDialogOpen(true) }}><Plus className="h-4 w-4 mr-1" />Assign</Button>}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {empDeductions.length === 0 ? <div className="text-sm text-gray-500 text-center py-6">No employee deductions.</div> : (
                                <Table>
                                    <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Amount (RM)</TableHead><TableHead>Total / Remaining</TableHead><TableHead>Effective</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {empDeductions.map(ed => (
                                            <TableRow key={ed.id}>
                                                <TableCell className="text-sm">{ed.employee_id.slice(0, 8)}...</TableCell>
                                                <TableCell className="text-sm">{deductionTypes.find(dt => dt.id === ed.deduction_type_id)?.name || ed.deduction_type_id.slice(0, 8)}</TableCell>
                                                <TableCell className="text-sm font-medium">{ed.amount.toLocaleString()}</TableCell>
                                                <TableCell className="text-sm">{ed.total_amount ? `${ed.total_amount.toLocaleString()} / ${ed.remaining_amount?.toLocaleString() || '0'}` : '—'}</TableCell>
                                                <TableCell className="text-sm">{new Date(ed.effective_date).toLocaleDateString()}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Allowance Type Dialog */}
            <Dialog open={allowTypeDialogOpen} onOpenChange={setAllowTypeDialogOpen}>
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader><DialogTitle>{editingAllowType ? 'Edit' : 'Add'} Allowance Type</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Code *</Label><Input placeholder="e.g. TRAVEL" value={allowTypeForm.code} onChange={e => setAllowTypeForm(p => ({ ...p, code: e.target.value }))} /></div>
                            <div className="space-y-2"><Label>Name *</Label><Input placeholder="e.g. Travel Allowance" value={allowTypeForm.name} onChange={e => setAllowTypeForm(p => ({ ...p, name: e.target.value }))} /></div>
                        </div>
                        <div className="space-y-2"><Label>Default Amount (RM)</Label><Input type="number" value={allowTypeForm.default_amount} onChange={e => setAllowTypeForm(p => ({ ...p, default_amount: Number(e.target.value) }))} /></div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2"><Switch checked={allowTypeForm.is_taxable} onCheckedChange={c => setAllowTypeForm(p => ({ ...p, is_taxable: c }))} /><span className="text-sm text-gray-600">Taxable</span></div>
                            <div className="flex items-center gap-2"><Switch checked={allowTypeForm.is_recurring} onCheckedChange={c => setAllowTypeForm(p => ({ ...p, is_recurring: c }))} /><span className="text-sm text-gray-600">Recurring</span></div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAllowTypeDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveAllowType} disabled={actionLoading}>{actionLoading ? 'Saving...' : 'Save'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Deduction Type Dialog */}
            <Dialog open={dedTypeDialogOpen} onOpenChange={setDedTypeDialogOpen}>
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader><DialogTitle>{editingDedType ? 'Edit' : 'Add'} Deduction Type</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Code *</Label><Input placeholder="e.g. LOAN" value={dedTypeForm.code} onChange={e => setDedTypeForm(p => ({ ...p, code: e.target.value }))} /></div>
                            <div className="space-y-2"><Label>Name *</Label><Input placeholder="e.g. Staff Loan" value={dedTypeForm.name} onChange={e => setDedTypeForm(p => ({ ...p, name: e.target.value }))} /></div>
                        </div>
                        <div className="space-y-2">
                            <Label>Category</Label>
                            <Select value={dedTypeForm.category} onValueChange={v => setDedTypeForm(p => ({ ...p, category: v as typeof p.category }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="loan">Loan</SelectItem>
                                    <SelectItem value="advance">Advance</SelectItem>
                                    <SelectItem value="statutory">Statutory</SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center gap-2"><Switch checked={dedTypeForm.is_recurring} onCheckedChange={c => setDedTypeForm(p => ({ ...p, is_recurring: c }))} /><span className="text-sm text-gray-600">Recurring monthly</span></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDedTypeDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveDedType} disabled={actionLoading}>{actionLoading ? 'Saving...' : 'Save'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Employee Allowance Assignment Dialog */}
            <Dialog open={empAllowDialogOpen} onOpenChange={setEmpAllowDialogOpen}>
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader><DialogTitle>Assign Allowance to Employee</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2"><Label>Employee ID *</Label><Input placeholder="User UUID" value={empAllowForm.employee_id} onChange={e => setEmpAllowForm(p => ({ ...p, employee_id: e.target.value }))} /></div>
                        <div className="space-y-2">
                            <Label>Allowance Type *</Label>
                            <Select value={empAllowForm.allowance_type_id} onValueChange={v => { const at = allowanceTypes.find(a => a.id === v); setEmpAllowForm(p => ({ ...p, allowance_type_id: v, amount: at?.default_amount || p.amount })) }}>
                                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>{allowanceTypes.map(at => <SelectItem key={at.id} value={at.id}>{at.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Amount (RM)</Label><Input type="number" value={empAllowForm.amount} onChange={e => setEmpAllowForm(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
                            <div className="space-y-2"><Label>Effective Date *</Label><Input type="date" value={empAllowForm.effective_date} onChange={e => setEmpAllowForm(p => ({ ...p, effective_date: e.target.value }))} /></div>
                        </div>
                        <div className="space-y-2"><Label>End Date (optional)</Label><Input type="date" value={empAllowForm.end_date} onChange={e => setEmpAllowForm(p => ({ ...p, end_date: e.target.value }))} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEmpAllowDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveEmpAllow} disabled={actionLoading}>{actionLoading ? 'Saving...' : 'Save'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Employee Deduction Assignment Dialog */}
            <Dialog open={empDedDialogOpen} onOpenChange={setEmpDedDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader><DialogTitle>Assign Deduction to Employee</DialogTitle><DialogDescription>For loans, specify total and remaining amounts.</DialogDescription></DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2"><Label>Employee ID *</Label><Input placeholder="User UUID" value={empDedForm.employee_id} onChange={e => setEmpDedForm(p => ({ ...p, employee_id: e.target.value }))} /></div>
                        <div className="space-y-2">
                            <Label>Deduction Type *</Label>
                            <Select value={empDedForm.deduction_type_id} onValueChange={v => setEmpDedForm(p => ({ ...p, deduction_type_id: v }))}>
                                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>{deductionTypes.map(dt => <SelectItem key={dt.id} value={dt.id}>{dt.name} ({dt.category})</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Monthly Amount (RM) *</Label><Input type="number" value={empDedForm.amount} onChange={e => setEmpDedForm(p => ({ ...p, amount: Number(e.target.value) }))} /></div>
                            <div className="space-y-2"><Label>Effective Date *</Label><Input type="date" value={empDedForm.effective_date} onChange={e => setEmpDedForm(p => ({ ...p, effective_date: e.target.value }))} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Total Loan Amount</Label><Input type="number" placeholder="For loans only" value={empDedForm.total_amount} onChange={e => setEmpDedForm(p => ({ ...p, total_amount: e.target.value }))} /></div>
                            <div className="space-y-2"><Label>Remaining Amount</Label><Input type="number" placeholder="Auto-tracks" value={empDedForm.remaining_amount} onChange={e => setEmpDedForm(p => ({ ...p, remaining_amount: e.target.value }))} /></div>
                        </div>
                        <div className="space-y-2"><Label>End Date (optional)</Label><Input type="date" value={empDedForm.end_date} onChange={e => setEmpDedForm(p => ({ ...p, end_date: e.target.value }))} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEmpDedDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveEmpDed} disabled={actionLoading}>{actionLoading ? 'Saving...' : 'Save'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
