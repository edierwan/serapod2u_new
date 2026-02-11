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
import { useToast } from '@/components/ui/use-toast'
import { usePermissions } from '@/hooks/usePermissions'
import {
    SalaryBand, EmployeeCompensation,
    fetchSalaryBands, createSalaryBand, updateSalaryBand, deleteSalaryBand,
    fetchEmployeeCompensations, upsertEmployeeCompensation
} from '@/lib/api/payroll'
import { Banknote, Pencil, Plus, Trash2, Users } from 'lucide-react'
import EmployeeSearchPicker from '@/components/hr/shared/EmployeeSearchPicker'

interface HrPayrollSalaryViewProps {
    userProfile: {
        id: string
        role_code: string
        roles: { role_level: number }
        department_id?: string | null
        organizations: { id: string }
    }
}

const emptySalaryBand = { code: '', name: '', pay_type: 'monthly' as 'monthly' | 'hourly', min_salary: 0, max_salary: 0, ot_eligible: false, ot_rate: 1.5, position_id: '' }
const emptyComp = { employee_id: '', salary_band_id: '', pay_type: 'monthly' as 'monthly' | 'hourly', basic_salary: 0, hourly_rate: null as number | null, effective_date: '' }

export default function HrPayrollSalaryView({ userProfile }: HrPayrollSalaryViewProps) {
    const { hasPermission } = usePermissions(userProfile.roles.role_level, userProfile.role_code, userProfile.department_id)
    const canManage = userProfile.roles.role_level <= 20 || hasPermission('manage_org_chart')
    const { toast } = useToast()

    const [bands, setBands] = useState<SalaryBand[]>([])
    const [compensations, setCompensations] = useState<EmployeeCompensation[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)

    const [bandDialogOpen, setBandDialogOpen] = useState(false)
    const [editingBand, setEditingBand] = useState<SalaryBand | null>(null)
    const [bandForm, setBandForm] = useState(emptySalaryBand)

    const [compDialogOpen, setCompDialogOpen] = useState(false)
    const [compForm, setCompForm] = useState(emptyComp)
    const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({})

    const loadData = async () => {
        setLoading(true)
        const [b, c] = await Promise.all([fetchSalaryBands(), fetchEmployeeCompensations()])
        if (b.success && b.data) setBands(b.data)
        if (c.success && c.data) setCompensations(c.data)
        setLoading(false)
    }

    useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleOpenBandDialog = (band?: SalaryBand) => {
        if (band) {
            setEditingBand(band)
            setBandForm({ code: band.code, name: band.name, pay_type: band.pay_type, min_salary: band.min_salary, max_salary: band.max_salary, ot_eligible: band.ot_eligible, ot_rate: band.ot_rate || 1.5, position_id: band.position_id || '' })
        } else {
            setEditingBand(null)
            setBandForm(emptySalaryBand)
        }
        setBandDialogOpen(true)
    }

    const handleSaveBand = async () => {
        if (!bandForm.code.trim() || !bandForm.name.trim()) { toast({ title: 'Validation', description: 'Code and name are required.', variant: 'destructive' }); return }
        setActionLoading(true)
        const payload = {
            code: bandForm.code, name: bandForm.name, pay_type: bandForm.pay_type,
            min_salary: bandForm.min_salary, max_salary: bandForm.max_salary,
            ot_eligible: bandForm.ot_eligible, ot_rate: bandForm.ot_rate,
            position_id: bandForm.position_id || null
        }
        const result = editingBand ? await updateSalaryBand(editingBand.id, payload) : await createSalaryBand(payload)
        if (result.success) { toast({ title: editingBand ? 'Updated' : 'Created' }); setBandDialogOpen(false); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleDeleteBand = async (band: SalaryBand) => {
        if (!confirm(`Delete salary band "${band.name}"?`)) return
        setActionLoading(true)
        const result = await deleteSalaryBand(band.id)
        if (result.success) { toast({ title: 'Deleted' }); loadData() }
        else toast({ title: 'Error', description: result.error || 'In use by employees', variant: 'destructive' })
        setActionLoading(false)
    }

    const handleSaveComp = async () => {
        if (!compForm.employee_id || !compForm.salary_band_id || !compForm.effective_date) { toast({ title: 'Validation', description: 'All fields are required.', variant: 'destructive' }); return }
        setActionLoading(true)
        const result = await upsertEmployeeCompensation({
            employee_id: compForm.employee_id, salary_band_id: compForm.salary_band_id,
            pay_type: compForm.pay_type, basic_salary: compForm.basic_salary,
            hourly_rate: compForm.hourly_rate, effective_date: compForm.effective_date,
            status: 'active'
        })
        if (result.success) { toast({ title: 'Compensation saved' }); setCompDialogOpen(false); loadData() }
        else toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' })
        setActionLoading(false)
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div><CardTitle className="text-lg">Salary Bands</CardTitle><CardDescription>Define salary grades, ranges, and overtime eligibility.</CardDescription></div>
                        {canManage && <Button size="sm" onClick={() => handleOpenBandDialog()}><Plus className="h-4 w-4 mr-1" />Add Band</Button>}
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : bands.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <Banknote className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                            <p>No salary bands configured.</p>
                            <p className="text-xs mt-1">Create bands (e.g. Grade A, Grade B) to standardize compensation.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Code</TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Pay Type</TableHead>
                                        <TableHead>Range (RM)</TableHead>
                                        <TableHead>OT</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {bands.map(band => (
                                        <TableRow key={band.id}>
                                            <TableCell className="font-mono text-sm">{band.code}</TableCell>
                                            <TableCell>{band.name}</TableCell>
                                            <TableCell><Badge variant="secondary" className="capitalize">{band.pay_type}</Badge></TableCell>
                                            <TableCell className="text-sm">{band.min_salary.toLocaleString()} – {band.max_salary.toLocaleString()}</TableCell>
                                            <TableCell>{band.ot_eligible ? <Badge>OT ×{band.ot_rate}</Badge> : <span className="text-gray-400 text-sm">No</span>}</TableCell>
                                            <TableCell className="text-right">
                                                {canManage && (
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button variant="ghost" size="sm" onClick={() => handleOpenBandDialog(band)}><Pencil className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="sm" onClick={() => handleDeleteBand(band)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div><CardTitle className="text-lg">Employee Compensation</CardTitle><CardDescription>Assign salary bands and basic salary to employees.</CardDescription></div>
                        {canManage && <Button size="sm" onClick={() => { setCompForm(emptyComp); setCompDialogOpen(true) }}><Users className="h-4 w-4 mr-1" />Assign</Button>}
                    </div>
                </CardHeader>
                <CardContent>
                    {compensations.length === 0 ? (
                        <div className="text-sm text-gray-500 text-center py-6">No employee compensation records.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Employee</TableHead>
                                        <TableHead>Salary Band</TableHead>
                                        <TableHead>Basic Salary (RM)</TableHead>
                                        <TableHead>Effective Date</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {compensations.map(comp => (
                                        <TableRow key={comp.id}>
                                            <TableCell className="text-sm">{employeeNames[comp.employee_id] || comp.employee_id.slice(0, 8) + '...'}</TableCell>
                                            <TableCell className="text-sm">{bands.find(b => b.id === comp.salary_band_id)?.name || (comp.salary_band_id || '').slice(0, 8)}</TableCell>
                                            <TableCell className="text-sm font-medium">{comp.basic_salary.toLocaleString()}</TableCell>
                                            <TableCell className="text-sm">{new Date(comp.effective_date).toLocaleDateString()}</TableCell>
                                            <TableCell><Badge variant={comp.status === 'active' ? 'default' : 'secondary'}>{comp.status}</Badge></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={bandDialogOpen} onOpenChange={setBandDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader><DialogTitle>{editingBand ? 'Edit' : 'Add'} Salary Band</DialogTitle><DialogDescription>Define the salary grade and range.</DialogDescription></DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Code *</Label><Input placeholder="e.g. GRADE-A" value={bandForm.code} onChange={e => setBandForm(p => ({ ...p, code: e.target.value }))} /></div>
                            <div className="space-y-2"><Label>Name *</Label><Input placeholder="e.g. Senior Engineer" value={bandForm.name} onChange={e => setBandForm(p => ({ ...p, name: e.target.value }))} /></div>
                        </div>
                        <div className="space-y-2">
                            <Label>Pay Type</Label>
                            <Select value={bandForm.pay_type} onValueChange={v => setBandForm(p => ({ ...p, pay_type: v as typeof p.pay_type }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="monthly">Monthly</SelectItem>
                                    <SelectItem value="hourly">Hourly</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Min Salary (RM)</Label><Input type="number" value={bandForm.min_salary} onChange={e => setBandForm(p => ({ ...p, min_salary: Number(e.target.value) }))} /></div>
                            <div className="space-y-2"><Label>Max Salary (RM)</Label><Input type="number" value={bandForm.max_salary} onChange={e => setBandForm(p => ({ ...p, max_salary: Number(e.target.value) }))} /></div>
                        </div>
                        <div className="flex items-center gap-2"><Switch checked={bandForm.ot_eligible} onCheckedChange={c => setBandForm(p => ({ ...p, ot_eligible: c }))} /><span className="text-sm text-gray-600">Overtime eligible</span></div>
                        {bandForm.ot_eligible && (
                            <div className="space-y-2"><Label>OT Rate Multiplier</Label><Input type="number" step="0.1" value={bandForm.ot_rate} onChange={e => setBandForm(p => ({ ...p, ot_rate: Number(e.target.value) }))} /></div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBandDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveBand} disabled={actionLoading}>{actionLoading ? 'Saving...' : editingBand ? 'Update' : 'Create'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={compDialogOpen} onOpenChange={setCompDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader><DialogTitle>Assign Compensation</DialogTitle><DialogDescription>Set basic salary for an employee with a salary band.</DialogDescription></DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2"><Label>Employee *</Label><EmployeeSearchPicker value={compForm.employee_id} onChange={(id, emp) => { setCompForm(p => ({ ...p, employee_id: id })); if (emp) setEmployeeNames(prev => ({ ...prev, [id]: emp.full_name || emp.email })) }} /></div>
                        <div className="space-y-2">
                            <Label>Salary Band *</Label>
                            <Select value={compForm.salary_band_id} onValueChange={v => { const band = bands.find(b => b.id === v); setCompForm(p => ({ ...p, salary_band_id: v, pay_type: band?.pay_type || 'monthly' })) }}>
                                <SelectTrigger><SelectValue placeholder="Select band" /></SelectTrigger>
                                <SelectContent>{bands.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Basic Salary (RM)</Label><Input type="text" inputMode="numeric" value={compForm.basic_salary ? compForm.basic_salary.toLocaleString() : ''} onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); setCompForm(p => ({ ...p, basic_salary: Number(v) || 0 })) }} placeholder="e.g. 3,500" /></div>
                            <div className="space-y-2"><Label>Effective Date *</Label><Input type="date" value={compForm.effective_date} onChange={e => setCompForm(p => ({ ...p, effective_date: e.target.value }))} /></div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCompDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveComp} disabled={actionLoading}>{actionLoading ? 'Saving...' : 'Save'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
