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
import { Gift, Minus, Pencil, Plus, Sparkles } from 'lucide-react'
import EmployeeSearchPicker from '@/components/hr/shared/EmployeeSearchPicker'

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

const ALLOWANCE_TEMPLATES = [
    { code: 'TRAVEL', name: 'Travel Allowance', is_taxable: false, is_recurring: true, default_amount: 200 },
    { code: 'MEAL', name: 'Meal Allowance', is_taxable: false, is_recurring: true, default_amount: 150 },
    { code: 'HOUSING', name: 'Housing Allowance', is_taxable: true, is_recurring: true, default_amount: 500 },
    { code: 'PHONE', name: 'Phone Allowance', is_taxable: false, is_recurring: true, default_amount: 100 },
    { code: 'PETROL', name: 'Petrol/Fuel Allowance', is_taxable: false, is_recurring: true, default_amount: 300 },
    { code: 'PARKING', name: 'Parking Allowance', is_taxable: false, is_recurring: true, default_amount: 100 },
    { code: 'SHIFT', name: 'Shift Allowance', is_taxable: true, is_recurring: true, default_amount: 50 },
    { code: 'ATTENDANCE', name: 'Attendance Incentive', is_taxable: true, is_recurring: true, default_amount: 100 },
    { code: 'HARDSHIP', name: 'Hardship Allowance', is_taxable: true, is_recurring: true, default_amount: 200 },
]

const DEDUCTION_TEMPLATES = [
    { code: 'EPF-EE', name: 'EPF Employee (11%)', category: 'statutory', is_recurring: true },
    { code: 'EPF-ER', name: 'EPF Employer (12/13%)', category: 'statutory', is_recurring: true },
    { code: 'SOCSO-EE', name: 'SOCSO Employee', category: 'statutory', is_recurring: true },
    { code: 'EIS-EE', name: 'EIS Employee', category: 'statutory', is_recurring: true },
    { code: 'PCB', name: 'PCB / Monthly Tax Deduction', category: 'statutory', is_recurring: true },
    { code: 'ZAKAT', name: 'Zakat', category: 'statutory', is_recurring: true },
    { code: 'LOAN', name: 'Staff Loan', category: 'loan', is_recurring: true },
    { code: 'ADVANCE', name: 'Salary Advance', category: 'advance', is_recurring: false },
    { code: 'INSURANCE', name: 'Group Insurance Premium', category: 'other', is_recurring: true },
    { code: 'UNION', name: 'Union Fees', category: 'other', is_recurring: true },
]

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
    const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({})
    const [allowTemplateDialogOpen, setAllowTemplateDialogOpen] = useState(false)
    const [dedTemplateDialogOpen, setDedTemplateDialogOpen] = useState(false)

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

    const handleLoadAllowTemplate = async (tpl: typeof ALLOWANCE_TEMPLATES[0]) => {
        setActionLoading(true)
        const result = await createAllowanceType({ code: tpl.code, name: tpl.name, is_taxable: tpl.is_taxable, is_recurring: tpl.is_recurring, default_amount: tpl.default_amount })
        if (result.success) { toast({ title: `Added: ${tpl.name}` }); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleLoadDedTemplate = async (tpl: typeof DEDUCTION_TEMPLATES[0]) => {
        setActionLoading(true)
        const result = await createDeductionType({ code: tpl.code, name: tpl.name, category: tpl.category, is_recurring: tpl.is_recurring })
        if (result.success) { toast({ title: `Added: ${tpl.name}` }); loadData() }
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
                                {canManage && <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => setAllowTemplateDialogOpen(true)}><Sparkles className="h-3 w-3 mr-1" />Load Template</Button><Button size="sm" onClick={() => { setEditingAllowType(null); setAllowTypeForm(emptyAllowType); setAllowTypeDialogOpen(true) }}><Plus className="h-4 w-4 mr-1" />Add Type</Button></div>}
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
                                                <TableCell className="text-sm">{employeeNames[ea.employee_id] || ea.employee_id.slice(0, 8) + '...'}</TableCell>
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
                                {canManage && <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => setDedTemplateDialogOpen(true)}><Sparkles className="h-3 w-3 mr-1" />Load Template</Button><Button size="sm" onClick={() => { setEditingDedType(null); setDedTypeForm(emptyDedType); setDedTypeDialogOpen(true) }}><Plus className="h-4 w-4 mr-1" />Add Type</Button></div>}
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
                                                <TableCell className="text-sm">{employeeNames[ed.employee_id] || ed.employee_id.slice(0, 8) + '...'}</TableCell>
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
                        <div className="space-y-2"><Label>Employee *</Label><EmployeeSearchPicker value={empAllowForm.employee_id} onChange={(id, emp) => { setEmpAllowForm(p => ({ ...p, employee_id: id })); if (emp) setEmployeeNames(prev => ({ ...prev, [id]: emp.full_name || emp.email })) }} /></div>
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
                        <div className="space-y-2"><Label>Employee *</Label><EmployeeSearchPicker value={empDedForm.employee_id} onChange={(id, emp) => { setEmpDedForm(p => ({ ...p, employee_id: id })); if (emp) setEmployeeNames(prev => ({ ...prev, [id]: emp.full_name || emp.email })) }} /></div>
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

            {/* ─── Allowance Template Dialog ──────────────────────── */}
            <Dialog open={allowTemplateDialogOpen} onOpenChange={setAllowTemplateDialogOpen}>
                <DialogContent className="sm:max-w-[550px] max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Allowance Type Templates</DialogTitle>
                        <DialogDescription>Common Malaysian allowance types. Click Add to create.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        {ALLOWANCE_TEMPLATES.map((tpl, i) => {
                            const exists = allowanceTypes.some(at => at.code === tpl.code)
                            return (
                                <div key={i} className={`flex items-center justify-between rounded-lg border p-3 ${exists ? 'bg-gray-50 opacity-60' : 'hover:bg-blue-50'}`}>
                                    <div>
                                        <div className="font-medium text-sm">{tpl.name}</div>
                                        <div className="text-xs text-gray-500">{tpl.code} • RM {tpl.default_amount} • {tpl.is_taxable ? 'Taxable' : 'Tax-exempt'}</div>
                                    </div>
                                    {exists ? (
                                        <Badge variant="secondary" className="text-[10px]">Added</Badge>
                                    ) : (
                                        <Button size="sm" variant="outline" disabled={actionLoading} onClick={() => handleLoadAllowTemplate(tpl)}>
                                            <Plus className="h-3 w-3 mr-1" />Add
                                        </Button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setAllowTemplateDialogOpen(false)}>Done</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── Deduction Template Dialog ──────────────────────── */}
            <Dialog open={dedTemplateDialogOpen} onOpenChange={setDedTemplateDialogOpen}>
                <DialogContent className="sm:max-w-[550px] max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Deduction Type Templates</DialogTitle>
                        <DialogDescription>Malaysian statutory deductions and common types. Click Add to create.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        {DEDUCTION_TEMPLATES.map((tpl, i) => {
                            const exists = deductionTypes.some(dt => dt.code === tpl.code)
                            return (
                                <div key={i} className={`flex items-center justify-between rounded-lg border p-3 ${exists ? 'bg-gray-50 opacity-60' : 'hover:bg-blue-50'}`}>
                                    <div>
                                        <div className="font-medium text-sm">{tpl.name}</div>
                                        <div className="text-xs text-gray-500">{tpl.code} • {tpl.category}</div>
                                    </div>
                                    {exists ? (
                                        <Badge variant="secondary" className="text-[10px]">Added</Badge>
                                    ) : (
                                        <Button size="sm" variant="outline" disabled={actionLoading} onClick={() => handleLoadDedTemplate(tpl)}>
                                            <Plus className="h-3 w-3 mr-1" />Add
                                        </Button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setDedTemplateDialogOpen(false)}>Done</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
