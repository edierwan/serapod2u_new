'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Search, Edit, ToggleLeft, ToggleRight, Users, Layers, Trash2 } from 'lucide-react'
import { createHrPosition, deleteHrPosition, fetchHrPositions, seedHrPositions, updateHrPosition, type HrPosition } from '@/lib/api/hr'

interface HrPositionsViewProps {
    organizationId: string
    canEdit: boolean
}

const HrPositionsView = ({ organizationId, canEdit }: HrPositionsViewProps) => {
    const [positions, setPositions] = useState<HrPosition[]>([])
    const [loading, setLoading] = useState(true)
    const [showDisabled, setShowDisabled] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingPosition, setEditingPosition] = useState<HrPosition | null>(null)
    const [formData, setFormData] = useState({ code: '', name: '', level: '', category: '' })
    const [saving, setSaving] = useState(false)
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
    const [selectedTemplate, setSelectedTemplate] = useState('standard_sme_my')
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deletePosition, setDeletePosition] = useState<HrPosition | null>(null)

    const { toast } = useToast()

    const loadPositions = async () => {
        setLoading(true)
        const result = await fetchHrPositions(showDisabled)
        if (result.success && result.data) {
            setPositions(result.data)
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to load positions', variant: 'destructive' })
        }
        setLoading(false)
    }

    useEffect(() => {
        loadPositions()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [organizationId, showDisabled])

    const filteredPositions = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        return positions.filter(p =>
            !query || p.code.toLowerCase().includes(query) || p.name.toLowerCase().includes(query)
        )
    }, [positions, searchQuery])

    const handleOpenDialog = (position?: HrPosition) => {
        if (position) {
            setEditingPosition(position)
            setFormData({
                code: position.code,
                name: position.name,
                level: position.level !== null && position.level !== undefined ? String(position.level) : '',
                category: position.category || ''
            })
        } else {
            setEditingPosition(null)
            setFormData({ code: '', name: '', level: '', category: '' })
        }
        setDialogOpen(true)
    }

    const handleSave = async () => {
        if (!formData.code.trim() || !formData.name.trim()) {
            toast({ title: 'Validation', description: 'Code and name are required', variant: 'destructive' })
            return
        }

        setSaving(true)
        if (editingPosition) {
            const result = await updateHrPosition(editingPosition.id, {
                name: formData.name,
                level: formData.level ? parseInt(formData.level, 10) : null,
                category: formData.category || null
            })
            if (result.success) {
                toast({ title: 'Updated', description: 'Position updated.' })
                setDialogOpen(false)
                loadPositions()
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to update position', variant: 'destructive' })
            }
        } else {
            const result = await createHrPosition({
                code: formData.code,
                name: formData.name,
                level: formData.level ? parseInt(formData.level, 10) : null,
                category: formData.category || null
            })
            if (result.success) {
                toast({ title: 'Created', description: 'Position created.' })
                setDialogOpen(false)
                loadPositions()
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to create position', variant: 'destructive' })
            }
        }
        setSaving(false)
    }

    const handleToggleActive = async (position: HrPosition) => {
        const result = await updateHrPosition(position.id, { is_active: !position.is_active })
        if (result.success) {
            toast({ title: 'Updated', description: `Position ${position.is_active ? 'disabled' : 'enabled'}.` })
            loadPositions()
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to update status', variant: 'destructive' })
        }
    }

    const handleSeedTemplate = async () => {
        setSaving(true)
        const result = await seedHrPositions(selectedTemplate)
        if (result.success) {
            toast({
                title: 'Seeded',
                description: `Positions added. ${result.data?.inserted ?? 0} inserted, ${result.data?.updated ?? 0} updated.`
            })
            setTemplateDialogOpen(false)
            loadPositions()
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to seed positions', variant: 'destructive' })
        }
        setSaving(false)
    }

    const handleOpenDelete = (position: HrPosition) => {
        setDeletePosition(position)
        setDeleteDialogOpen(true)
    }

    const handleDelete = async () => {
        if (!deletePosition) return
        setSaving(true)
        const result = await deleteHrPosition(deletePosition.id)
        if (result.success) {
            toast({ title: 'Deleted', description: 'Position removed.' })
            setDeleteDialogOpen(false)
            setDeletePosition(null)
            loadPositions()
        } else {
            toast({
                title: 'Cannot delete position',
                description: result.error || 'Position is in use and cannot be deleted.',
                variant: 'destructive'
            })
        }
        setSaving(false)
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <CardTitle className="text-base font-semibold">Positions</CardTitle>
                        <CardDescription className="text-xs">Manage job titles and seniority levels</CardDescription>
                    </div>
                    {canEdit && (
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => setTemplateDialogOpen(true)}>
                                <Layers className="h-4 w-4 mr-2" />
                                Add from Template
                            </Button>
                            <Button onClick={() => handleOpenDialog()}>
                                <Plus className="h-4 w-4 mr-2" />
                                Add Position
                            </Button>
                        </div>
                    )}
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Search positions..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            id="show-disabled-positions"
                            checked={showDisabled}
                            onCheckedChange={setShowDisabled}
                        />
                        <Label htmlFor="show-disabled-positions" className="text-sm text-gray-600">
                            Show disabled
                        </Label>
                    </div>
                </div>

                {loading ? (
                    <div className="py-8 text-center text-gray-500">Loading positions...</div>
                ) : filteredPositions.length === 0 ? (
                    <div className="py-8 text-center text-gray-500">No positions found.</div>
                ) : (
                    <div className="rounded-md border overflow-hidden">
                        <div className="grid grid-cols-12 gap-2 bg-gray-50 px-4 py-2 text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                            <div className="col-span-2">Code</div>
                            <div className="col-span-4">Name</div>
                            <div className="col-span-2">Category</div>
                            <div className="col-span-1">Level</div>
                            <div className="col-span-1">Users</div>
                            <div className="col-span-2 text-right">Actions</div>
                        </div>
                        {filteredPositions.map(position => (
                            <div key={position.id} className="grid grid-cols-12 gap-2 px-4 py-2.5 border-t items-center hover:bg-muted/30 transition-colors">
                                <div className="col-span-2 font-mono text-xs text-gray-500">{position.code}</div>
                                <div className="col-span-4">
                                    <div className="text-sm text-gray-800 dark:text-gray-200">{position.name}</div>
                                    {!position.is_active && <Badge variant="secondary" className="mt-0.5 text-[10px] h-4 px-1">Inactive</Badge>}
                                </div>
                                <div className="col-span-2 text-xs text-gray-500">
                                    {position.category || '—'}
                                </div>
                                <div className="col-span-1 text-xs text-gray-500">{position.level ?? '—'}</div>
                                <div className="col-span-1 text-xs text-gray-500 flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    {position.user_count ?? 0}
                                </div>
                                <div className="col-span-2 flex justify-end gap-1">
                                    {canEdit && (
                                        <>
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenDialog(position)}>
                                                <Edit className="h-3.5 w-3.5 text-gray-400" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => handleOpenDelete(position)}
                                                title="Delete position"
                                            >
                                                <Trash2 className="h-3.5 w-3.5 text-red-400" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggleActive(position)}>
                                                {position.is_active ? (
                                                    <ToggleRight className="h-3.5 w-3.5 text-green-500" />
                                                ) : (
                                                    <ToggleLeft className="h-3.5 w-3.5 text-gray-400" />
                                                )}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{editingPosition ? 'Edit Position' : 'Add Position'}</DialogTitle>
                        <DialogDescription>
                            {editingPosition ? 'Update position details below.' : 'Create a new job title for your org.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Code</Label>
                            <Input
                                value={formData.code}
                                onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                                disabled={!!editingPosition}
                                placeholder="e.g., CEO, HRM"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="e.g., Chief Executive Officer"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Category</Label>
                            <Select
                                value={formData.category || 'none'}
                                onValueChange={(value) => setFormData(prev => ({ ...prev, category: value === 'none' ? '' : value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">No category</SelectItem>
                                    <SelectItem value="Executive">Executive</SelectItem>
                                    <SelectItem value="Management">Management</SelectItem>
                                    <SelectItem value="Supervisor">Supervisor</SelectItem>
                                    <SelectItem value="Staff">Staff</SelectItem>
                                    <SelectItem value="Intern">Intern</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Level (optional)</Label>
                            <Input
                                type="number"
                                value={formData.level}
                                onChange={(e) => setFormData(prev => ({ ...prev, level: e.target.value }))}
                                placeholder="1, 2, 3..."
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving...' : 'Save'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Add from Template</DialogTitle>
                        <DialogDescription>
                            Seed a standard set of positions for your organization.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <Label>Template Set</Label>
                        <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select template" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="standard_sme_my">Standard SME (MY)</SelectItem>
                                <SelectItem value="retail_warehouse">Retail + Warehouse</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTemplateDialogOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={handleSeedTemplate} disabled={saving}>
                            {saving ? 'Seeding...' : 'Seed Positions'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete position?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deletePosition
                                ? `This will permanently remove ${deletePosition.name}. If it is assigned to users, deletion will be blocked.`
                                : 'This will permanently remove this position.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={saving}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {saving ? 'Deleting...' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    )
}

export default HrPositionsView
