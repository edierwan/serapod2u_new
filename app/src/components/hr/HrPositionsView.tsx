'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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
import {
    ArrowLeft,
    Briefcase,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Edit,
    Info,
    Layers,
    Plus,
    RefreshCw,
    Search,
    ToggleLeft,
    ToggleRight,
    Trash2,
    Users,
    X
} from 'lucide-react'
import { createHrPosition, deleteHrPosition, fetchHrPositions, seedHrPositions, updateHrPosition, type HrPosition } from '@/lib/api/hr'

interface HrPositionsViewProps {
    organizationId: string
    canEdit: boolean
}

type CreateStep = 'list' | 'create' | 'success'
type PositionStatus = 'active' | 'draft' | 'archived'

interface CreatePositionForm {
    code: string
    name: string
    category: string
    reportsTo: string
    levelLabel: string
    positionType: string
    status: PositionStatus
    description: string
}

const CATEGORY_OPTIONS = ['Operations', 'HR', 'Finance', 'Sales', 'Warehouse', 'Admin', 'Management', 'Other']
const LEVEL_OPTIONS = [
    { label: 'Executive', value: 'Executive', level: 5 },
    { label: 'Supervisor', value: 'Supervisor', level: 3 },
    { label: 'Manager', value: 'Manager', level: 2 },
    { label: 'Head', value: 'Head', level: 1 },
    { label: 'Director', value: 'Director', level: 1 },
]
const POSITION_TYPES = ['Permanent', 'Contract', 'Part-Time', 'Internship', 'Temporary']

const emptyCreateForm = (): CreatePositionForm => ({
    code: '',
    name: '',
    category: 'Operations',
    reportsTo: 'none',
    levelLabel: 'Supervisor',
    positionType: 'Permanent',
    status: 'active',
    description: ''
})

const generatePositionCode = (name: string) => {
    const words = name
        .trim()
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)

    if (words.length === 0) return ''
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase()

    const initials = words.map(word => word[0]).join('').toUpperCase()
    return initials.length >= 2 ? initials.slice(0, 4) : words.join('').slice(0, 3).toUpperCase()
}

const statusLabel = (status: PositionStatus) => status.charAt(0).toUpperCase() + status.slice(1)

const HrPositionsView = ({ organizationId, canEdit }: HrPositionsViewProps) => {
    const [positions, setPositions] = useState<HrPosition[]>([])
    const [loading, setLoading] = useState(true)
    const [showDisabled, setShowDisabled] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [createStep, setCreateStep] = useState<CreateStep>('list')
    const [createForm, setCreateForm] = useState<CreatePositionForm>(() => emptyCreateForm())
    const [advancedOpen, setAdvancedOpen] = useState(true)
    const [createdPosition, setCreatedPosition] = useState<HrPosition | null>(null)
    const [createdSummary, setCreatedSummary] = useState<CreatePositionForm | null>(null)
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

    const reportsToOptions = useMemo(() => (
        positions
            .filter(position => position.is_active)
            .map(position => ({
                id: position.id,
                label: position.name,
                code: position.code
            }))
    ), [positions])

    const selectedReportsTo = useMemo(() => (
        reportsToOptions.find(position => position.id === createForm.reportsTo) || null
    ), [reportsToOptions, createForm.reportsTo])

    const selectedLevel = useMemo(() => (
        LEVEL_OPTIONS.find(level => level.value === createForm.levelLabel) || LEVEL_OPTIONS[0]
    ), [createForm.levelLabel])

    const duplicateCode = useMemo(() => {
        const code = createForm.code.trim().toUpperCase()
        if (!code) return false
        return positions.some(position => position.code.toUpperCase() === code)
    }, [positions, createForm.code])

    const createErrors = useMemo(() => ({
        name: createForm.name.trim() ? '' : 'Position name is required.',
        code: !createForm.code.trim()
            ? 'Position code is required.'
            : duplicateCode
                ? 'A position with this code already exists.'
                : ''
    }), [createForm.name, createForm.code, duplicateCode])

    const canCreatePosition = !createErrors.name && !createErrors.code

    const updateCreateForm = (updates: Partial<CreatePositionForm>) => {
        setCreateForm(prev => ({ ...prev, ...updates }))
    }

    const resetCreateFlow = () => {
        setCreateForm(emptyCreateForm())
        setAdvancedOpen(true)
        setCreatedPosition(null)
        setCreatedSummary(null)
    }

    const handleOpenCreate = () => {
        resetCreateFlow()
        setCreateStep('create')
    }

    const handleCreateNameChange = (name: string) => {
        setCreateForm(prev => ({
            ...prev,
            name,
            code: prev.code ? prev.code : generatePositionCode(name)
        }))
    }

    const handleRegenerateCode = () => {
        updateCreateForm({ code: generatePositionCode(createForm.name) })
    }

    const handleCancelCreate = () => {
        resetCreateFlow()
        setCreateStep('list')
    }

    const handleCreateAnother = () => {
        resetCreateFlow()
        setCreateStep('create')
    }

    const handleGoToPositions = () => {
        resetCreateFlow()
        setCreateStep('list')
        loadPositions()
    }

    const handleViewPosition = () => {
        if (createdPosition) {
            setSearchQuery(createdPosition.code)
        }
        handleGoToPositions()
    }

    const handleCreatePosition = async (statusOverride?: PositionStatus) => {
        const nextStatus = statusOverride || createForm.status
        if (!canCreatePosition) {
            toast({
                title: 'Validation',
                description: createErrors.name || createErrors.code || 'Please complete the required fields.',
                variant: 'destructive'
            })
            return
        }

        const summary = { ...createForm, status: nextStatus }
        setSaving(true)
        const result = await createHrPosition({
            code: createForm.code,
            name: createForm.name,
            level: selectedLevel.level,
            category: createForm.category || null,
            is_active: nextStatus === 'active'
        })

        if (result.success && result.data) {
            setCreatedPosition(result.data)
            setCreatedSummary(summary)
            setCreateStep('success')
            loadPositions()
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to create position', variant: 'destructive' })
        }
        setSaving(false)
    }

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

    if (createStep === 'create') {
        const previewName = createForm.name.trim() || 'New Position'
        const previewCode = createForm.code.trim().toUpperCase() || 'CODE'
        const previewReportsTo = selectedReportsTo?.label || 'CEO'
        const descriptionLength = createForm.description.length

        return (
            <div className="space-y-5">
                <div className="flex flex-col gap-4 rounded-lg border bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-3">
                        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={handleCancelCreate}>
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                            <Briefcase className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold tracking-tight text-gray-950">Create Position</h2>
                            <p className="text-sm text-gray-500">Define a role within your organization structure.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => handleCreatePosition('draft')}
                            disabled={saving || !canCreatePosition}
                        >
                            {saving ? 'Saving...' : 'Save as Draft'}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handleCancelCreate}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
                    <div className="rounded-lg border bg-white shadow-sm">
                        <div className="border-b p-5">
                            <h3 className="text-sm font-semibold text-gray-950">Basic Information</h3>
                        </div>
                        <div className="space-y-5 p-5">
                            <div className="space-y-2">
                                <Label htmlFor="position-name">Position Name <span className="text-red-500">*</span></Label>
                                <Input
                                    id="position-name"
                                    value={createForm.name}
                                    onChange={(event) => handleCreateNameChange(event.target.value)}
                                    placeholder="Warehouse Supervisor"
                                    className={createErrors.name ? 'border-red-300 focus-visible:ring-red-200' : ''}
                                />
                                {createErrors.name && <p className="text-xs text-red-600">{createErrors.name}</p>}
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Label htmlFor="position-code">Position Code <span className="text-red-500">*</span></Label>
                                    <Info className="h-3.5 w-3.5 text-gray-400" />
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <Input
                                        id="position-code"
                                        value={createForm.code}
                                        onChange={(event) => updateCreateForm({ code: event.target.value.toUpperCase() })}
                                        placeholder="WHS"
                                        className={createErrors.code ? 'border-red-300 focus-visible:ring-red-200' : ''}
                                    />
                                    <Button type="button" variant="outline" onClick={handleRegenerateCode} disabled={!createForm.name.trim()}>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Regenerate
                                    </Button>
                                </div>
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-xs text-gray-500">Auto-generated based on position name.</p>
                                    {createErrors.code && <p className="text-xs text-red-600">{createErrors.code}</p>}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Category</Label>
                                <Select value={createForm.category} onValueChange={(value) => updateCreateForm({ category: value })}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CATEGORY_OPTIONS.map(category => (
                                            <SelectItem key={category} value={category}>{category}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="border-t">
                            <button
                                type="button"
                                className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-semibold text-gray-950"
                                onClick={() => setAdvancedOpen(open => !open)}
                            >
                                Advanced Settings
                                {advancedOpen ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
                            </button>
                            {advancedOpen && (
                                <div className="space-y-5 border-t p-5">
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>Reports To</Label>
                                            <Select value={createForm.reportsTo} onValueChange={(value) => updateCreateForm({ reportsTo: value })}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select parent position" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">CEO</SelectItem>
                                                    {reportsToOptions.map(position => (
                                                        <SelectItem key={position.id} value={position.id}>
                                                            {position.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Hierarchy Level</Label>
                                            <Select value={createForm.levelLabel} onValueChange={(value) => updateCreateForm({ levelLabel: value })}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select level" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {LEVEL_OPTIONS.map(level => (
                                                        <SelectItem key={level.value} value={level.value}>
                                                            {level.label} (Level {level.level})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Position Type</Label>
                                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                                            {POSITION_TYPES.map(type => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => updateCreateForm({ positionType: type })}
                                                    className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition ${createForm.positionType === type
                                                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    <span className={`h-2 w-2 rounded-full ${createForm.positionType === type ? 'bg-indigo-600' : 'bg-gray-300'}`} />
                                                    {type}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Status</Label>
                                        <div className="grid gap-2 sm:grid-cols-3">
                                            {(['active', 'draft', 'archived'] as PositionStatus[]).map(status => (
                                                <button
                                                    key={status}
                                                    type="button"
                                                    onClick={() => updateCreateForm({ status })}
                                                    className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition ${createForm.status === status
                                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    <span className={`h-2 w-2 rounded-full ${createForm.status === status ? 'bg-emerald-600' : 'bg-gray-300'}`} />
                                                    {statusLabel(status)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Description <span className="font-normal text-gray-400">(optional)</span></Label>
                                        <Textarea
                                            value={createForm.description}
                                            onChange={(event) => updateCreateForm({ description: event.target.value.slice(0, 1000) })}
                                            placeholder="Responsible for overseeing daily warehouse operations, inventory management, staff supervision, and ensuring safety and efficiency."
                                            className="min-h-[120px] resize-none"
                                        />
                                        <p className="text-right text-xs text-gray-400">{descriptionLength}/1000</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-2 border-t p-5 sm:flex-row sm:justify-end">
                            <Button variant="outline" onClick={handleCancelCreate} disabled={saving}>
                                Cancel
                            </Button>
                            <Button onClick={() => handleCreatePosition()} disabled={saving || !canCreatePosition}>
                                {saving ? 'Creating...' : 'Create Position'}
                            </Button>
                        </div>
                    </div>

                    <div className="rounded-lg border bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b p-5">
                            <h3 className="text-sm font-semibold text-gray-950">Position Preview</h3>
                            <Badge className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50">Live Preview</Badge>
                        </div>
                        <div className="space-y-5 p-5">
                            <div className="flex flex-col items-center text-center">
                                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                                    <Briefcase className="h-7 w-7" />
                                </div>
                                <p className="font-mono text-sm font-semibold text-gray-600">{previewCode}</p>
                                <h3 className="text-lg font-semibold text-gray-950">{previewName}</h3>
                            </div>

                            <div className="divide-y rounded-md border">
                                <div className="flex items-center justify-between px-4 py-3 text-sm">
                                    <span className="text-gray-500">Category</span>
                                    <span className="font-medium text-gray-900">{createForm.category || '—'}</span>
                                </div>
                                <div className="flex items-center justify-between px-4 py-3 text-sm">
                                    <span className="text-gray-500">Reports To</span>
                                    <span className="font-medium text-gray-900">{previewReportsTo}</span>
                                </div>
                                <div className="flex items-center justify-between px-4 py-3 text-sm">
                                    <span className="text-gray-500">Level</span>
                                    <span className="font-medium text-gray-900">{selectedLevel.label} (Level {selectedLevel.level})</span>
                                </div>
                                <div className="flex items-center justify-between px-4 py-3 text-sm">
                                    <span className="text-gray-500">Type</span>
                                    <span className="font-medium text-gray-900">{createForm.positionType}</span>
                                </div>
                                <div className="flex items-center justify-between px-4 py-3 text-sm">
                                    <span className="text-gray-500">Status</span>
                                    <Badge className={createForm.status === 'active' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50' : 'bg-gray-100 text-gray-700 hover:bg-gray-100'}>
                                        {statusLabel(createForm.status)}
                                    </Badge>
                                </div>
                            </div>

                            <div className="rounded-lg border bg-gray-50 p-4">
                                <p className="mb-4 text-sm font-semibold text-gray-950">Org Chart Preview</p>
                                <div className="flex flex-col items-center text-sm">
                                    <div className="rounded-md border bg-white px-6 py-2 font-medium text-gray-700 shadow-sm">CEO</div>
                                    <div className="h-7 w-px bg-gray-300" />
                                    <div className="rounded-md border bg-white px-5 py-2 text-gray-700 shadow-sm">{previewReportsTo}</div>
                                    <div className="h-7 w-px bg-gray-300" />
                                    <div className="rounded-md border border-indigo-300 bg-white px-5 py-2 font-semibold text-indigo-700 shadow-sm">{previewName}</div>
                                </div>
                            </div>

                            <div className="flex items-start gap-2 rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>Position will be placed under {previewReportsTo} in the organization structure.</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (createStep === 'success' && createdSummary) {
        const summaryLevel = LEVEL_OPTIONS.find(level => level.value === createdSummary.levelLabel) || LEVEL_OPTIONS[0]

        return (
            <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-10 w-10" />
                </div>
                <h2 className="text-2xl font-semibold text-gray-950">Position Created Successfully!</h2>
                <p className="mt-2 text-sm text-gray-500">{createdSummary.name} has been added to your organization.</p>

                <div className="mx-auto mt-7 grid max-w-4xl gap-0 overflow-hidden rounded-lg border text-left sm:grid-cols-5">
                    <div className="border-b p-4 sm:border-b-0 sm:border-r">
                        <p className="text-xs text-gray-500">Position Code</p>
                        <p className="mt-2 font-mono font-semibold text-gray-950">{createdSummary.code}</p>
                    </div>
                    <div className="border-b p-4 sm:border-b-0 sm:border-r">
                        <p className="text-xs text-gray-500">Category</p>
                        <p className="mt-2 font-semibold text-gray-950">{createdSummary.category || '—'}</p>
                    </div>
                    <div className="border-b p-4 sm:border-b-0 sm:border-r">
                        <p className="text-xs text-gray-500">Reports To</p>
                        <p className="mt-2 font-semibold text-gray-950">{selectedReportsTo?.label || 'CEO'}</p>
                    </div>
                    <div className="border-b p-4 sm:border-b-0 sm:border-r">
                        <p className="text-xs text-gray-500">Level</p>
                        <Badge className="mt-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-50">{summaryLevel.label}</Badge>
                    </div>
                    <div className="p-4">
                        <p className="text-xs text-gray-500">Status</p>
                        <Badge className={`mt-2 ${createdSummary.status === 'active' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50' : 'bg-gray-100 text-gray-700 hover:bg-gray-100'}`}>
                            {statusLabel(createdSummary.status)}
                        </Badge>
                    </div>
                </div>

                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                    <Button variant="outline" onClick={handleViewPosition}>
                        View Position
                    </Button>
                    <Button variant="outline" onClick={handleCreateAnother}>
                        Create Another
                    </Button>
                    <Button onClick={handleGoToPositions}>
                        Go to Positions
                    </Button>
                </div>
            </div>
        )
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
                            <Button onClick={handleOpenCreate}>
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
