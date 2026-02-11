'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
    Calendar, Download, Loader2, Pencil, Plus, Trash2, Sparkles
} from 'lucide-react'

interface Holiday {
    id: string
    name: string
    date: string
    is_recurring: boolean
    category?: string
    state?: string | null
}

interface TemplateHoliday {
    name: string
    date: string
    category: string
}

interface HrPublicHolidaysViewProps {
    canEdit: boolean
}

export default function HrPublicHolidaysView({ canEdit }: HrPublicHolidaysViewProps) {
    const { toast } = useToast()

    const [holidays, setHolidays] = useState<Holiday[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

    // Template state
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
    const [templates, setTemplates] = useState<Record<string, TemplateHoliday[]>>({})
    const [availableYears, setAvailableYears] = useState<number[]>([])
    const [templateYear, setTemplateYear] = useState(new Date().getFullYear())
    const [replaceExisting, setReplaceExisting] = useState(false)
    const [templateLoading, setTemplateLoading] = useState(false)

    // CRUD dialog
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null)
    const [form, setForm] = useState({ name: '', date: '', is_recurring: false, category: 'custom' })

    const loadHolidays = async () => {
        setLoading(true)
        const res = await fetch(`/api/hr/public-holidays?year=${selectedYear}`)
        const json = await res.json()
        if (json.success) setHolidays(json.data)
        setLoading(false)
    }

    const loadTemplates = async () => {
        const res = await fetch('/api/hr/public-holidays?templates=1')
        const json = await res.json()
        if (json.success) {
            setTemplates(json.templates)
            setAvailableYears(json.available_years)
        }
    }

    useEffect(() => { loadHolidays() }, [selectedYear]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleLoadTemplate = async () => {
        setTemplateLoading(true)
        const res = await fetch('/api/hr/public-holidays', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'load_template', year: templateYear, replace: replaceExisting }),
        })
        const json = await res.json()
        if (json.success) {
            toast({ title: 'Template loaded', description: json.message })
            setTemplateDialogOpen(false)
            setSelectedYear(templateYear)
            loadHolidays()
        } else {
            toast({ title: 'Error', description: json.error, variant: 'destructive' })
        }
        setTemplateLoading(false)
    }

    const openCreateDialog = () => {
        setEditingHoliday(null)
        setForm({ name: '', date: `${selectedYear}-01-01`, is_recurring: false, category: 'custom' })
        setEditDialogOpen(true)
    }

    const openEditDialog = (h: Holiday) => {
        setEditingHoliday(h)
        setForm({ name: h.name, date: h.date, is_recurring: h.is_recurring, category: h.category || 'custom' })
        setEditDialogOpen(true)
    }

    const handleSave = async () => {
        if (!form.name.trim() || !form.date) {
            toast({ title: 'Validation', description: 'Name and date are required.', variant: 'destructive' })
            return
        }
        setActionLoading(true)
        const url = '/api/hr/public-holidays'
        const method = editingHoliday ? 'PUT' : 'POST'
        const body = editingHoliday
            ? { id: editingHoliday.id, name: form.name, date: form.date, is_recurring: form.is_recurring, category: form.category }
            : { name: form.name, date: form.date, is_recurring: form.is_recurring, category: form.category }

        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const json = await res.json()
        if (json.success) {
            toast({ title: editingHoliday ? 'Updated' : 'Created' })
            setEditDialogOpen(false)
            loadHolidays()
        } else {
            toast({ title: 'Error', description: json.error, variant: 'destructive' })
        }
        setActionLoading(false)
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this holiday?')) return
        setActionLoading(true)
        const res = await fetch(`/api/hr/public-holidays?id=${id}`, { method: 'DELETE' })
        const json = await res.json()
        if (json.success) { toast({ title: 'Deleted' }); loadHolidays() }
        else toast({ title: 'Error', description: json.error, variant: 'destructive' })
        setActionLoading(false)
    }

    const yearOptions = [2025, 2026, 2027, 2028, 2029, 2030]

    const getDayName = (dateStr: string) => {
        const d = new Date(dateStr + 'T00:00:00')
        return d.toLocaleDateString('en-MY', { weekday: 'short' })
    }

    const isUpcoming = (dateStr: string) => {
        const today = new Date().toISOString().split('T')[0]
        return dateStr >= today
    }

    const nextHoliday = holidays.find(h => isUpcoming(h.date))

    return (
        <div className="space-y-6">
            {/* Header */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-lg flex items-center gap-2"><Calendar className="h-5 w-5" />Public Holidays</CardTitle>
                            <CardDescription>Manage public holidays for your organization. These affect leave calculations and overtime rates.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            {canEdit && (
                                <>
                                    <Button variant="outline" size="sm" onClick={() => { loadTemplates(); setTemplateYear(selectedYear); setTemplateDialogOpen(true) }}>
                                        <Sparkles className="h-4 w-4 mr-1" />Load Malaysia Template
                                    </Button>
                                    <Button size="sm" onClick={openCreateDialog}>
                                        <Plus className="h-4 w-4 mr-1" />Add Holiday
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {/* Quick stats */}
                    <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="rounded-lg border p-3">
                            <div className="text-2xl font-bold">{holidays.length}</div>
                            <div className="text-xs text-gray-500">Total holidays in {selectedYear}</div>
                        </div>
                        <div className="rounded-lg border p-3">
                            <div className="text-2xl font-bold">{holidays.filter(h => h.category === 'national').length}</div>
                            <div className="text-xs text-gray-500">National holidays</div>
                        </div>
                        <div className="rounded-lg border p-3">
                            <div className="text-sm font-medium text-blue-600 truncate">{nextHoliday?.name || 'None'}</div>
                            <div className="text-xs text-gray-500">{nextHoliday ? `Next: ${new Date(nextHoliday.date + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}` : 'No upcoming holidays'}</div>
                        </div>
                    </div>

                    {/* Holiday list */}
                    {loading ? (
                        <div className="py-8 text-center text-gray-500"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Loading...</div>
                    ) : holidays.length === 0 ? (
                        <div className="py-12 text-center text-gray-400">
                            <Calendar className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                            <p className="font-medium">No holidays for {selectedYear}</p>
                            <p className="text-sm mt-1">Click &quot;Load Malaysia Template&quot; to auto-populate Malaysian public holidays.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[50px]">#</TableHead>
                                        <TableHead>Holiday</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Day</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Recurring</TableHead>
                                        {canEdit && <TableHead className="text-right">Actions</TableHead>}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {holidays.map((h, idx) => (
                                        <TableRow key={h.id} className={!isUpcoming(h.date) ? 'opacity-50' : ''}>
                                            <TableCell className="text-sm text-gray-400">{idx + 1}</TableCell>
                                            <TableCell className="font-medium text-sm">{h.name}</TableCell>
                                            <TableCell className="text-sm">
                                                {new Date(h.date + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </TableCell>
                                            <TableCell className="text-sm text-gray-600">{getDayName(h.date)}</TableCell>
                                            <TableCell>
                                                <Badge variant={h.category === 'national' ? 'default' : h.category === 'state' ? 'secondary' : 'outline'} className="text-[10px]">
                                                    {h.category || 'custom'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm">{h.is_recurring ? '✓' : '—'}</TableCell>
                                            {canEdit && (
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button variant="ghost" size="sm" onClick={() => openEditDialog(h)}><Pencil className="h-3.5 w-3.5" /></Button>
                                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(h.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                                                    </div>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Template Dialog */}
            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                <DialogContent className="sm:max-w-[520px] max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" />Load Malaysian Public Holidays</DialogTitle>
                        <DialogDescription>Select a year to auto-populate holidays from the Malaysian template (Peninsular). You can edit individual holidays after loading.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Year</Label>
                            <Select value={String(templateYear)} onValueChange={v => setTemplateYear(Number(v))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {availableYears.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>

                        <label className="flex items-center gap-2">
                            <Checkbox checked={replaceExisting} onCheckedChange={(c) => setReplaceExisting(c as boolean)} />
                            <span className="text-sm text-gray-700">Replace existing holidays for this year</span>
                        </label>

                        {/* Preview */}
                        {templates[templateYear] && (
                            <div className="rounded-lg border max-h-[250px] overflow-y-auto divide-y">
                                {templates[templateYear].map((h, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                                        <span>{h.name}</span>
                                        <span className="text-gray-500 text-xs">{new Date(h.date + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {templates[templateYear] && (
                            <div className="text-xs text-gray-500">{templates[templateYear].length} holidays will be loaded.</div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleLoadTemplate} disabled={templateLoading}>
                            {templateLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Loading...</> : <><Download className="h-4 w-4 mr-1" />Load Template</>}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create/Edit Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-[440px]">
                    <DialogHeader>
                        <DialogTitle>{editingHoliday ? 'Edit Holiday' : 'Add Holiday'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Holiday Name *</Label>
                            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Company Anniversary" />
                        </div>
                        <div className="space-y-2">
                            <Label>Date *</Label>
                            <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Category</Label>
                            <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="national">National</SelectItem>
                                    <SelectItem value="state">State</SelectItem>
                                    <SelectItem value="custom">Custom / Company</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={form.is_recurring} onCheckedChange={c => setForm(p => ({ ...p, is_recurring: c }))} />
                            <span className="text-sm text-gray-600">Recurring every year (fixed date)</span>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={actionLoading}>{actionLoading ? 'Saving...' : editingHoliday ? 'Update' : 'Create'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
