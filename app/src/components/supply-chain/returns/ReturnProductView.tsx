'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Plus, RefreshCw, Search, Trash2, Loader2, FileText, Eye, Printer,
    ArrowLeft, PackageOpen, Ban, Save, ChevronRight, Store, ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import ReturnStatusStepper from './ReturnStatusStepper'
import {
    RETURN_STATUS_LABELS,
    RETURN_NEXT_ACTION_LABEL,
    canAdvanceStatus,
    showsWarehouseProcessing,
    isTerminalStatus,
    type ReturnStatus,
} from '@/lib/returns/constants'
import { generateReturnPdf } from '@/lib/returns/pdf'
import type { ReturnCase, ReturnCaseItem, ReturnMeta } from '@/lib/returns/types'

interface UserProfile { id: string; full_name?: string | null }

type EditorItem = ReturnCaseItem & { _key: string }

const STATUS_BADGE: Record<string, string> = {
    return_draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    return_submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    return_received: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    return_processing: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    return_completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    return_cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

function StatusBadge({ status }: { status: string }) {
    return (
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_BADGE[status] || STATUS_BADGE.return_draft)}>
            {RETURN_STATUS_LABELS[status as ReturnStatus] || status}
        </span>
    )
}

export default function ReturnProductView({ userProfile }: { userProfile: UserProfile }) {
    const { toast } = useToast()
    const [meta, setMeta] = useState<ReturnMeta | null>(null)
    const [cases, setCases] = useState<ReturnCase[]>([])
    const [loading, setLoading] = useState(true)
    const [mode, setMode] = useState<'list' | 'editor'>('list')
    const [editingId, setEditingId] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [search, setSearch] = useState('')

    const loadMeta = useCallback(async () => {
        try {
            const res = await fetch('/api/returns/meta')
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            setMeta(json)
        } catch (e: any) {
            toast({ title: 'Failed to load return settings', description: e.message, variant: 'destructive' })
        }
    }, [toast])

    const loadCases = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (statusFilter !== 'all') params.set('status', statusFilter)
            if (search.trim()) params.set('search', search.trim())
            const res = await fetch(`/api/returns?${params.toString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            setCases(json.cases || [])
        } catch (e: any) {
            toast({ title: 'Failed to load returns', description: e.message, variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [statusFilter, search, toast])

    useEffect(() => { loadMeta() }, [loadMeta])
    useEffect(() => { if (mode === 'list') loadCases() }, [mode, loadCases])

    const openNew = () => { setEditingId(null); setMode('editor') }
    const openCase = (id: string) => { setEditingId(id); setMode('editor') }
    const backToList = () => { setMode('list'); setEditingId(null) }

    if (mode === 'editor' && meta) {
        return (
            <ReturnCaseEditor
                userProfile={userProfile}
                meta={meta}
                caseId={editingId}
                onBack={backToList}
                onSaved={() => { loadCases() }}
            />
        )
    }

    return (
        <div className="w-full space-y-4">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Return Product</h1>
                    <p className="text-sm text-muted-foreground">Create and manage product return cases from shops to warehouse.</p>
                </div>
                <Button onClick={openNew} className="gap-1.5">
                    <Plus className="h-4 w-4" /> New Return
                </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search return no…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadCases()}
                        className="pl-8"
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[190px]"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        {Object.entries(RETURN_STATUS_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={loadCases} disabled={loading} title="Refresh">
                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 font-medium">Return No</th>
                            <th className="px-3 py-2 font-medium">Shop</th>
                            <th className="px-3 py-2 font-medium">Warehouse</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                            <th className="px-3 py-2 text-right font-medium">Value (RM)</th>
                            <th className="px-3 py-2 font-medium">Created</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {loading ? (
                            <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                        ) : cases.length === 0 ? (
                            <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                                <PackageOpen className="mx-auto mb-2 h-8 w-8 opacity-40" />
                                No return cases yet.
                            </td></tr>
                        ) : cases.map((c) => (
                            <tr key={c.id} className="cursor-pointer hover:bg-accent/50" onClick={() => openCase(c.id)}>
                                <td className="px-3 py-2 font-medium text-foreground">{c.return_no}</td>
                                <td className="px-3 py-2">{c.shop?.org_name || '—'}</td>
                                <td className="px-3 py-2">{c.warehouse?.org_name || '—'}</td>
                                <td className="px-3 py-2">
                                    <StatusBadge status={c.status} />
                                    {c.is_overdue && <Badge variant="destructive" className="ml-1 text-[10px]">Overdue</Badge>}
                                </td>
                                <td className="px-3 py-2 text-right">{c.total_qty ?? 0}</td>
                                <td className="px-3 py-2 text-right">{Number(c.total_value ?? 0).toFixed(2)}</td>
                                <td className="px-3 py-2 text-muted-foreground">{c.created_at ? new Date(c.created_at).toLocaleDateString('en-MY') : '—'}</td>
                                <td className="px-3 py-2 text-right"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// ─────────────────────────── Editor ───────────────────────────

function newKey() { return Math.random().toString(36).slice(2) }

function ReturnCaseEditor({
    userProfile, meta, caseId, onBack, onSaved,
}: {
    userProfile: UserProfile
    meta: ReturnMeta
    caseId: string | null
    onBack: () => void
    onSaved: () => void
}) {
    const { toast } = useToast()
    const supabase = useMemo(() => createClient(), [])
    const isNew = !caseId

    const [rc, setRc] = useState<ReturnCase | null>(null)
    const [loading, setLoading] = useState(!isNew)
    const [saving, setSaving] = useState(false)
    const [advancing, setAdvancing] = useState(false)

    // Header form
    const [shopId, setShopId] = useState<string>(meta.isManager ? '' : (meta.userOrgId || ''))
    const [warehouseId, setWarehouseId] = useState<string>(meta.settings.default_return_warehouse_id || '')
    const [contactPerson, setContactPerson] = useState('')
    const [contactPhone, setContactPhone] = useState('')
    const [contactEmail, setContactEmail] = useState('')
    const [notes, setNotes] = useState('')
    const [items, setItems] = useState<EditorItem[]>([])

    // Warehouse processing form
    const [wh, setWh] = useState({ received_by: '', received_date: '', processing_notes: '', action_taken: '', return_courier: '', tracking_no: '', completed_date: '' })

    const status: ReturnStatus = rc?.status || 'return_draft'
    const readOnly = isTerminalStatus(status)
    const isDraft = status === 'return_draft'

    const loadCase = useCallback(async () => {
        if (isNew) return
        setLoading(true)
        try {
            const res = await fetch(`/api/returns/${caseId}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            const c: ReturnCase = json.case
            setRc(c)
            setShopId(c.shop_org_id)
            setWarehouseId(c.return_warehouse_id || '')
            setContactPerson(c.contact_person || '')
            setContactPhone(c.contact_phone || '')
            setContactEmail(c.contact_email || '')
            setNotes(c.notes || '')
            setItems((c.items || []).map((it) => ({ ...it, _key: newKey() })))
            setWh({
                received_by: c.received_by || '',
                received_date: c.received_date || '',
                processing_notes: c.processing_notes || '',
                action_taken: c.action_taken || '',
                return_courier: c.return_courier || '',
                tracking_no: c.tracking_no || '',
                completed_date: c.completed_date || '',
            })
        } catch (e: any) {
            toast({ title: 'Failed to load return', description: e.message, variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [caseId, isNew, toast])

    useEffect(() => { loadCase() }, [loadCase])

    // The currently selected shop's master record (used for auto-fill + info card).
    const selectedShop = useMemo(
        () => meta.shops.find((s) => s.id === shopId) || rc?.shop || null,
        [meta.shops, shopId, rc?.shop],
    )

    // Replace the contact fields with the selected shop's master data. Called when
    // the shop is (re)selected — the user can still override the fields afterwards.
    const applyShopContacts = useCallback((id: string) => {
        const shop = meta.shops.find((s) => s.id === id)
        setContactPerson(shop?.contact_name || '')
        setContactPhone(shop?.contact_phone || '')
        setContactEmail(shop?.contact_email || '')
    }, [meta.shops])

    // Shop-login: prefill contact from the user's own shop master data on a new case.
    useEffect(() => {
        if (isNew && !meta.isManager && shopId) applyShopContacts(shopId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Deep-link to the selected shop's organization edit page, scrolled to the
    // Contact Information block. Opened in a new tab so the return draft is kept.
    const openShopContactEditor = () => {
        if (!shopId) return
        // The org id travels in the URL; the edit page resolves it and scrolls to
        // the #contact-information block. Opened in a new tab to keep the draft.
        window.open(`/supply-chain/organizations/${shopId}/edit#contact-information`, '_blank')
    }

    const totals = useMemo(() => {
        const qty = items.reduce((s, it) => s + Number(it.quantity || 0), 0)
        const value = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_cost || 0), 0)
        return { count: items.length, qty, value }
    }, [items])

    // ── Item helpers ──
    const addItem = (partial?: Partial<EditorItem>) => {
        setItems((prev) => [...prev, {
            _key: newKey(), id: '', return_case_id: caseId || '',
            product_id: null, variant_id: null, sku: null, product_name: null, variant_name: null,
            quantity: 1, unit_cost: 0, reason: null, condition: null, photo_url: null, notes: null,
            ...partial,
        }])
    }
    const updateItem = (key: string, patch: Partial<EditorItem>) => {
        setItems((prev) => prev.map((it) => it._key === key ? { ...it, ...patch } : it))
    }
    const removeItem = (key: string) => setItems((prev) => prev.filter((it) => it._key !== key))

    const uploadPhoto = async (key: string, file: File) => {
        try {
            const path = `returns/${caseId || 'draft'}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
            const { error } = await supabase.storage.from('documents').upload(path, file, { cacheControl: '3600', upsert: false })
            if (error) throw error
            const { data } = supabase.storage.from('documents').getPublicUrl(path)
            updateItem(key, { photo_url: data.publicUrl })
        } catch (e: any) {
            toast({ title: 'Photo upload failed', description: e.message, variant: 'destructive' })
        }
    }

    // ── Persist ──
    const buildPayload = () => ({
        shop_org_id: meta.isManager ? shopId : meta.userOrgId,
        return_warehouse_id: warehouseId || null,
        contact_person: contactPerson || null,
        contact_phone: contactPhone || null,
        contact_email: contactEmail || null,
        notes: notes || null,
        items: items.map((it) => ({
            product_id: it.product_id, variant_id: it.variant_id, sku: it.sku,
            product_name: it.product_name, variant_name: it.variant_name,
            quantity: it.quantity, unit_cost: it.unit_cost,
            reason: it.reason, condition: it.condition, photo_url: it.photo_url, notes: it.notes,
        })),
    })

    const validate = (): string | null => {
        if (meta.isManager && !shopId) return 'Please select a Return From Shop.'
        return null
    }

    const saveDraft = async (): Promise<string | null> => {
        const err = validate()
        if (err) { toast({ title: 'Missing information', description: err, variant: 'destructive' }); return null }
        setSaving(true)
        try {
            if (isNew) {
                const res = await fetch('/api/returns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()) })
                const json = await res.json()
                if (!res.ok) throw new Error(json.error)
                toast({ title: 'Draft saved', description: json.return_no })
                onSaved()
                return json.id
            } else {
                const payload: any = buildPayload()
                // Once past draft, warehouse processing fields are the editable part.
                if (!isDraft) Object.assign(payload, wh)
                const res = await fetch(`/api/returns/${caseId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
                const json = await res.json()
                if (!res.ok) throw new Error(json.error)
                toast({ title: 'Saved' })
                onSaved()
                await loadCase()
                return caseId
            }
        } catch (e: any) {
            toast({ title: 'Save failed', description: e.message, variant: 'destructive' })
            return null
        } finally {
            setSaving(false)
        }
    }

    const advance = async () => {
        // Persist edits first so nothing is lost when the status flips.
        const id = await saveDraft()
        if (!id) return
        setAdvancing(true)
        try {
            const res = await fetch(`/api/returns/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast({ title: 'Status updated', description: RETURN_STATUS_LABELS[json.status as ReturnStatus] })
            onSaved()
            if (isNew) { onBack() } else { await loadCase() }
        } catch (e: any) {
            toast({ title: 'Status update failed', description: e.message, variant: 'destructive' })
        } finally {
            setAdvancing(false)
        }
    }

    const cancelReturn = async () => {
        if (!caseId) return
        if (!confirm('Cancel this return? This cannot be undone.')) return
        try {
            const res = await fetch(`/api/returns/${caseId}`, { method: 'DELETE' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast({ title: 'Return cancelled' })
            onSaved()
            onBack()
        } catch (e: any) {
            toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' })
        }
    }

    const makePdfCase = (): ReturnCase => ({
        ...(rc || ({} as ReturnCase)),
        return_no: rc?.return_no || 'DRAFT',
        status,
        contact_person: contactPerson, contact_phone: contactPhone, contact_email: contactEmail, notes,
        shop: meta.shops.find((s) => s.id === shopId) || rc?.shop || null,
        warehouse: meta.warehouses.find((w) => w.id === warehouseId) || rc?.warehouse || null,
        items,
        created_at: rc?.created_at || new Date().toISOString(),
        created_by_name: rc?.created_by_name || userProfile.full_name || null,
    } as ReturnCase)

    const previewPdf = () => generateReturnPdf(makePdfCase(), { instructionText: meta.settings.pdf_instruction_text, preview: true })
    const downloadPdf = () => generateReturnPdf(makePdfCase(), { instructionText: meta.settings.pdf_instruction_text, preview: false })

    const nextActionLabel = RETURN_NEXT_ACTION_LABEL[status]
    const canAdvance = canAdvanceStatus(status, meta.isManager)

    if (loading) {
        return <div className="flex items-center justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    }

    const shopName = meta.shops.find((s) => s.id === shopId)?.org_name || rc?.shop?.org_name || '—'

    return (
        <div className="w-full space-y-4">
            {/* Header bar */}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
                    <div>
                        <h1 className="text-xl font-semibold text-foreground">Return Product</h1>
                        <p className="text-sm text-muted-foreground">Create and manage product return cases from shops to warehouse.</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {!isNew && <StatusBadge status={status} />}
                </div>
            </div>

            {/* Stepper */}
            <div className="rounded-lg border border-border bg-card p-4">
                <ReturnStatusStepper status={status} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                    {/* Return Information */}
                    <section className="rounded-lg border border-border bg-card p-4">
                        <h2 className="mb-3 text-sm font-semibold text-foreground">Return Information</h2>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <Field label="Return No.">
                                <Input value={rc?.return_no || 'Auto-generated'} readOnly disabled />
                            </Field>
                            <Field label="Current Status">
                                <Input value={RETURN_STATUS_LABELS[status]} readOnly disabled />
                            </Field>
                            <Field label="Return Warehouse">
                                <Select value={warehouseId} onValueChange={setWarehouseId} disabled={readOnly}>
                                    <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                                    <SelectContent>
                                        {meta.warehouses.map((w) => (
                                            <SelectItem key={w.id} value={w.id}>{w.org_name}{w.org_code ? ` (${w.org_code})` : ''}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Return From Shop" required>
                                {meta.isManager ? (
                                    <Select value={shopId} onValueChange={(v) => { setShopId(v); applyShopContacts(v) }} disabled={!isDraft}>
                                        <SelectTrigger><SelectValue placeholder="Select shop" /></SelectTrigger>
                                        <SelectContent>
                                            {meta.shops.map((s) => (
                                                <SelectItem key={s.id} value={s.id}>{s.org_name}{s.org_code ? ` (${s.org_code})` : ''}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Input value={shopName} readOnly disabled />
                                )}
                            </Field>
                            <Field label="Contact Person">
                                <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} disabled={readOnly} placeholder="Name" />
                            </Field>
                            <Field label="Contact Phone">
                                <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={readOnly} placeholder="Phone" />
                            </Field>
                            <Field label="Contact Email">
                                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} disabled={readOnly} placeholder="name@example.com" />
                                {selectedShop && !selectedShop.contact_email && (
                                    <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                                        Email not updated yet in shop master data.
                                    </span>
                                )}
                            </Field>
                            {!isNew && (
                                <>
                                    <Field label="Created By"><Input value={rc?.created_by_name || '—'} readOnly disabled /></Field>
                                    <Field label="Created On"><Input value={rc?.created_at ? new Date(rc.created_at).toLocaleString('en-MY') : '—'} readOnly disabled /></Field>
                                </>
                            )}
                        </div>

                        {/* Compact shop master-data card + shortcut to edit shop contact */}
                        {selectedShop && (
                            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-start gap-2.5">
                                    <Store className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 text-sm">
                                        <div className="font-medium text-foreground">
                                            {selectedShop.org_name || '—'}
                                            {selectedShop.org_code && <span className="ml-1 text-xs text-muted-foreground">({selectedShop.org_code})</span>}
                                        </div>
                                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                            <span>Contact: {selectedShop.contact_name || '—'}</span>
                                            <span>Phone: {selectedShop.contact_phone || '—'}</span>
                                            <span>
                                                Email: {selectedShop.contact_email
                                                    ? selectedShop.contact_email
                                                    : <span className="text-amber-600 dark:text-amber-400">Email not updated yet</span>}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                {meta.isManager && (
                                    <Button type="button" variant="outline" size="sm" onClick={openShopContactEditor} className="shrink-0 gap-1.5">
                                        <ExternalLink className="h-3.5 w-3.5" /> Edit Shop Contact
                                    </Button>
                                )}
                            </div>
                        )}
                    </section>

                    {/* Return Items */}
                    <ReturnItemsSection
                        items={items}
                        meta={meta}
                        readOnly={!isDraft}
                        totals={totals}
                        onAdd={addItem}
                        onUpdate={updateItem}
                        onRemove={removeItem}
                        onUploadPhoto={uploadPhoto}
                        supabase={supabase}
                    />

                    {/* Additional Notes */}
                    <section className="rounded-lg border border-border bg-card p-4">
                        <h2 className="mb-2 text-sm font-semibold text-foreground">Additional Notes</h2>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} rows={3} placeholder="General return notes…" />
                    </section>

                    {/* Warehouse Processing */}
                    {showsWarehouseProcessing(status) && (
                        <section className="rounded-lg border border-border bg-card p-4">
                            <h2 className="mb-3 text-sm font-semibold text-foreground">Warehouse Processing</h2>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Received Date"><Input type="date" value={wh.received_date} onChange={(e) => setWh({ ...wh, received_date: e.target.value })} disabled={readOnly || !meta.isManager} /></Field>
                                <Field label="Received By"><Input value={wh.received_by} onChange={(e) => setWh({ ...wh, received_by: e.target.value })} disabled={readOnly || !meta.isManager} /></Field>
                                <Field label="Action Taken"><Input value={wh.action_taken} onChange={(e) => setWh({ ...wh, action_taken: e.target.value })} disabled={readOnly || !meta.isManager} placeholder="e.g. Replaced, Refunded, Scrapped" /></Field>
                                <Field label="Return/Replacement Courier"><Input value={wh.return_courier} onChange={(e) => setWh({ ...wh, return_courier: e.target.value })} disabled={readOnly || !meta.isManager} /></Field>
                                <Field label="Tracking No."><Input value={wh.tracking_no} onChange={(e) => setWh({ ...wh, tracking_no: e.target.value })} disabled={readOnly || !meta.isManager} /></Field>
                                <Field label="Completed Date"><Input type="date" value={wh.completed_date} onChange={(e) => setWh({ ...wh, completed_date: e.target.value })} disabled={readOnly || !meta.isManager} /></Field>
                                <div className="sm:col-span-2">
                                    <Field label="Processing Notes"><Textarea value={wh.processing_notes} onChange={(e) => setWh({ ...wh, processing_notes: e.target.value })} disabled={readOnly || !meta.isManager} rows={2} /></Field>
                                </div>
                            </div>
                        </section>
                    )}
                </div>

                {/* Timeline / actions side panel */}
                <div className="space-y-4">
                    <section className="rounded-lg border border-border bg-card p-4">
                        <h2 className="mb-3 text-sm font-semibold text-foreground">Actions</h2>
                        <div className="flex flex-col gap-2">
                            {!readOnly && (
                                <Button variant="outline" onClick={() => saveDraft()} disabled={saving} className="justify-start gap-2">
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
                                </Button>
                            )}
                            <Button variant="outline" onClick={previewPdf} className="justify-start gap-2"><Eye className="h-4 w-4" /> Preview PDF</Button>
                            <Button variant="outline" onClick={downloadPdf} className="justify-start gap-2"><FileText className="h-4 w-4" /> Generate Return PDF</Button>
                            {status === 'return_completed' && (
                                <Button variant="outline" onClick={() => window.print()} className="justify-start gap-2"><Printer className="h-4 w-4" /> Print Return Summary</Button>
                            )}
                            {nextActionLabel && canAdvance && (
                                <Button onClick={advance} disabled={advancing || saving} className="justify-start gap-2">
                                    {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />} {nextActionLabel}
                                </Button>
                            )}
                            {!isNew && !readOnly && (
                                <Button variant="ghost" onClick={cancelReturn} className="justify-start gap-2 text-red-600 hover:text-red-700">
                                    <Ban className="h-4 w-4" /> Cancel Return
                                </Button>
                            )}
                        </div>
                    </section>

                    {!isNew && rc?.status_history && rc.status_history.length > 0 && (
                        <section className="rounded-lg border border-border bg-card p-4">
                            <h2 className="mb-3 text-sm font-semibold text-foreground">Return Case Timeline</h2>
                            <ol className="space-y-3">
                                {rc.status_history.map((h) => (
                                    <li key={h.id} className="flex gap-2 text-sm">
                                        <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                                        <div>
                                            <div className="font-medium text-foreground">{RETURN_STATUS_LABELS[h.to_status as ReturnStatus] || h.to_status}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {new Date(h.changed_at).toLocaleString('en-MY')}
                                                {h.changed_by_name ? ` • ${h.changed_by_name}` : ''}
                                            </div>
                                            {h.notes && <div className="text-xs text-muted-foreground">{h.notes}</div>}
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    )}
                </div>
            </div>
        </div>
    )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-red-500"> *</span>}</span>
            {children}
        </label>
    )
}

// ─────────────────────────── Items section ───────────────────────────

interface VariantOption {
    id: string
    product_id: string
    product_name: string
    variant_name: string | null
    sku: string | null
    base_cost: number | null
}

function ReturnItemsSection({
    items, meta, readOnly, totals, onAdd, onUpdate, onRemove, onUploadPhoto, supabase,
}: {
    items: EditorItem[]
    meta: ReturnMeta
    readOnly: boolean
    totals: { count: number; qty: number; value: number }
    onAdd: (partial?: Partial<EditorItem>) => void
    onUpdate: (key: string, patch: Partial<EditorItem>) => void
    onRemove: (key: string) => void
    onUploadPhoto: (key: string, file: File) => void
    supabase: ReturnType<typeof createClient>
}) {
    const { toast } = useToast()
    const [search, setSearch] = useState('')
    const [variants, setVariants] = useState<VariantOption[]>([])
    const [loadingVariants, setLoadingVariants] = useState(false)
    const [showResults, setShowResults] = useState(false)

    const loadVariants = useCallback(async () => {
        if (variants.length > 0) return
        setLoadingVariants(true)
        try {
            const { data, error } = await (supabase as any)
                .from('product_variants')
                .select('id, product_id, variant_name, variant_code, manufacturer_sku, barcode, base_cost, is_active, products!inner(id, product_name, product_code)')
                .eq('is_active', true)
                .order('variant_name', { ascending: true })
            if (error) throw error
            const opts: VariantOption[] = (data || []).map((v: any) => ({
                id: v.id,
                product_id: v.products?.id,
                product_name: v.products?.product_name || 'Product',
                variant_name: v.variant_name || null,
                sku: v.manufacturer_sku || v.variant_code || v.barcode || v.products?.product_code || null,
                base_cost: v.base_cost != null ? Number(v.base_cost) : null,
            }))
            setVariants(opts)
        } catch (e: any) {
            toast({ title: 'Failed to load products', description: e.message, variant: 'destructive' })
        } finally {
            setLoadingVariants(false)
        }
    }, [variants.length, supabase, toast])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return variants.slice(0, 30)
        return variants.filter((v) =>
            [v.product_name, v.variant_name, v.sku].filter(Boolean).some((s) => (s as string).toLowerCase().includes(q)),
        ).slice(0, 30)
    }, [variants, search])

    const pick = (v: VariantOption) => {
        onAdd({
            product_id: v.product_id, variant_id: v.id, sku: v.sku,
            product_name: v.product_name, variant_name: v.variant_name,
            unit_cost: v.base_cost || 0,
        })
        setSearch(''); setShowResults(false)
    }

    return (
        <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Return Items</h2>
                <div className="text-xs text-muted-foreground">Total items: <b>{totals.count}</b> • Total qty: <b>{totals.qty}</b></div>
            </div>

            {!readOnly && (
                <div className="relative mb-3">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search product, variant, SKU or scan barcode"
                                value={search}
                                onFocus={() => { loadVariants(); setShowResults(true) }}
                                onChange={(e) => { setSearch(e.target.value); setShowResults(true) }}
                                className="pl-8"
                            />
                        </div>
                        <Button type="button" variant="outline" className="gap-1.5" onClick={() => { loadVariants(); onAdd() }}>
                            <Plus className="h-4 w-4" /> Add Item
                        </Button>
                    </div>
                    {showResults && (
                        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                            {loadingVariants ? (
                                <div className="p-3 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
                            ) : filtered.length === 0 ? (
                                <div className="p-3 text-center text-sm text-muted-foreground">No matches</div>
                            ) : filtered.map((v) => (
                                <button key={v.id} type="button" onClick={() => pick(v)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
                                    <span>
                                        <span className="font-medium text-foreground">{v.product_name}</span>
                                        <span className="text-muted-foreground"> · {v.variant_name || 'Standard'}{v.sku ? ` · ${v.sku}` : ''}</span>
                                    </span>
                                    {v.base_cost != null && <span className="text-xs text-muted-foreground">RM {v.base_cost.toFixed(2)}</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                            <th className="px-2 py-2 font-medium">No</th>
                            <th className="px-2 py-2 font-medium">Product</th>
                            <th className="px-2 py-2 font-medium">Variant / SKU</th>
                            <th className="px-2 py-2 font-medium">Qty</th>
                            <th className="px-2 py-2 font-medium">Unit Cost (RM)</th>
                            <th className="px-2 py-2 font-medium">Reason</th>
                            <th className="px-2 py-2 font-medium">Condition</th>
                            <th className="px-2 py-2 font-medium">Photo</th>
                            {!readOnly && <th className="px-2 py-2" />}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {items.length === 0 ? (
                            <tr><td colSpan={readOnly ? 8 : 9} className="px-2 py-6 text-center text-muted-foreground">No items added yet.</td></tr>
                        ) : items.map((it, i) => (
                            <tr key={it._key} className="align-top">
                                <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                                <td className="px-2 py-2">
                                    {readOnly ? (it.product_name || '—') : (
                                        <Input value={it.product_name || ''} onChange={(e) => onUpdate(it._key, { product_name: e.target.value })} placeholder="Product" className="h-8 min-w-[130px]" />
                                    )}
                                </td>
                                <td className="px-2 py-2">
                                    {readOnly ? [it.variant_name, it.sku].filter(Boolean).join(' / ') || '—' : (
                                        <div className="flex flex-col gap-1">
                                            <Input value={it.variant_name || ''} onChange={(e) => onUpdate(it._key, { variant_name: e.target.value })} placeholder="Variant" className="h-8 min-w-[120px]" />
                                            <Input value={it.sku || ''} onChange={(e) => onUpdate(it._key, { sku: e.target.value })} placeholder="SKU" className="h-8 min-w-[120px]" />
                                        </div>
                                    )}
                                </td>
                                <td className="px-2 py-2">
                                    {readOnly ? it.quantity : (
                                        <Input type="number" min={1} value={it.quantity} onChange={(e) => onUpdate(it._key, { quantity: Number(e.target.value) })} className="h-8 w-16" />
                                    )}
                                </td>
                                <td className="px-2 py-2">
                                    {readOnly ? Number(it.unit_cost).toFixed(2) : (
                                        <Input type="number" min={0} step="0.01" value={it.unit_cost} onChange={(e) => onUpdate(it._key, { unit_cost: Number(e.target.value) })} className="h-8 w-20" />
                                    )}
                                </td>
                                <td className="px-2 py-2">
                                    {readOnly ? (meta.reasons.find((r) => r.code === it.reason)?.label || it.reason || '—') : (
                                        <Select value={it.reason || ''} onValueChange={(v) => onUpdate(it._key, { reason: v })}>
                                            <SelectTrigger className="h-8 min-w-[120px]"><SelectValue placeholder="Reason" /></SelectTrigger>
                                            <SelectContent>{meta.reasons.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent>
                                        </Select>
                                    )}
                                </td>
                                <td className="px-2 py-2">
                                    {readOnly ? (meta.conditions.find((c) => c.code === it.condition)?.label || it.condition || '—') : (
                                        <Select value={it.condition || ''} onValueChange={(v) => onUpdate(it._key, { condition: v })}>
                                            <SelectTrigger className="h-8 min-w-[120px]"><SelectValue placeholder="Condition" /></SelectTrigger>
                                            <SelectContent>{meta.conditions.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
                                        </Select>
                                    )}
                                </td>
                                <td className="px-2 py-2">
                                    {it.photo_url ? (
                                        <a href={it.photo_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">View</a>
                                    ) : readOnly ? '—' : (
                                        <label className="cursor-pointer text-xs text-blue-600 underline">
                                            Upload
                                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPhoto(it._key, f) }} />
                                        </label>
                                    )}
                                </td>
                                {!readOnly && (
                                    <td className="px-2 py-2 text-right">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => onRemove(it._key)}><Trash2 className="h-4 w-4" /></Button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="border-t border-border font-medium">
                            <td className="px-2 py-2" colSpan={3}>Total</td>
                            <td className="px-2 py-2">{totals.qty}</td>
                            <td className="px-2 py-2">RM {totals.value.toFixed(2)}</td>
                            <td colSpan={readOnly ? 3 : 4} />
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>
    )
}
