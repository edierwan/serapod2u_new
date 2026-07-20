'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import type { ReturnMasterItem, ReturnSettings } from '@/lib/returns/types'

interface UserProfile { id: string }
interface OrgOpt { id: string; org_code: string | null; org_name: string | null }

export default function ReturnSettingsView({ userProfile: _userProfile }: { userProfile: UserProfile }) {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [canEdit, setCanEdit] = useState(false)
    const [settings, setSettings] = useState<ReturnSettings | null>(null)
    const [reasons, setReasons] = useState<ReturnMasterItem[]>([])
    const [conditions, setConditions] = useState<ReturnMasterItem[]>([])
    const [warehouses, setWarehouses] = useState<OrgOpt[]>([])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/returns/settings')
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            setSettings(json.settings)
            setReasons((json.reasons || []).filter((r: ReturnMasterItem) => r.is_active))
            setConditions((json.conditions || []).filter((c: ReturnMasterItem) => c.is_active))
            setWarehouses(json.warehouses || [])
            setCanEdit(!!json.canEdit)
        } catch (e: any) {
            toast({ title: 'Failed to load settings', description: e.message, variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { load() }, [load])

    const save = async () => {
        if (!settings) return
        setSaving(true)
        try {
            const res = await fetch('/api/returns/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings, reasons, conditions }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error)
            toast({ title: 'Settings saved' })
            await load()
        } catch (e: any) {
            toast({ title: 'Save failed', description: e.message, variant: 'destructive' })
        } finally {
            setSaving(false)
        }
    }

    if (loading || !settings) {
        return <div className="flex items-center justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    }

    return (
        <div className="w-full space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Return Settings</h1>
                    <p className="text-sm text-muted-foreground">Configure the product return module.</p>
                </div>
                {canEdit && (
                    <Button onClick={save} disabled={saving} className="gap-1.5">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                    </Button>
                )}
            </div>

            {!canEdit && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                    You have read-only access to return settings.
                </div>
            )}

            <section className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">General</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Default Return Warehouse</span>
                        <Select value={settings.default_return_warehouse_id || ''} onValueChange={(v) => setSettings({ ...settings, default_return_warehouse_id: v })} disabled={!canEdit || warehouses.length === 0}>
                            <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                            <SelectContent>
                                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.org_name}{w.org_code ? ` (${w.org_code})` : ''}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {warehouses.length === 0 && (
                            <span className="block text-xs text-amber-600 dark:text-amber-400">
                                No active Serapod HQ warehouse available
                            </span>
                        )}
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                        <span className="text-sm text-foreground">Enable shop self-service return</span>
                        <Switch checked={settings.shop_self_service_enabled} onCheckedChange={(v) => setSettings({ ...settings, shop_self_service_enabled: v })} disabled={!canEdit} />
                    </label>
                </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">KPI / SLA Targets (days)</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                    <NumField label="Submitted → Received" value={settings.sla_submitted_to_received_days} onChange={(n) => setSettings({ ...settings, sla_submitted_to_received_days: n })} disabled={!canEdit} />
                    <NumField label="Received → Processing" value={settings.sla_received_to_processing_days} onChange={(n) => setSettings({ ...settings, sla_received_to_processing_days: n })} disabled={!canEdit} />
                    <NumField label="Processing → Completed" value={settings.sla_processing_to_completed_days} onChange={(n) => setSettings({ ...settings, sla_processing_to_completed_days: n })} disabled={!canEdit} />
                </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
                <MasterListEditor title="Return Reasons" items={reasons} onChange={setReasons} disabled={!canEdit} />
                <MasterListEditor title="Return Conditions" items={conditions} onChange={setConditions} disabled={!canEdit} />
            </div>

            <section className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-semibold text-foreground">PDF Instruction Text / Return Note</h2>
                <Textarea value={settings.pdf_instruction_text || ''} onChange={(e) => setSettings({ ...settings, pdf_instruction_text: e.target.value })} disabled={!canEdit} rows={3} placeholder="Text printed at the bottom of the return PDF…" />
            </section>
        </div>
    )
}

function NumField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
    return (
        <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <Input type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} disabled={disabled} />
        </label>
    )
}

function MasterListEditor({ title, items, onChange, disabled }: { title: string; items: ReturnMasterItem[]; onChange: (items: ReturnMasterItem[]) => void; disabled?: boolean }) {
    const update = (i: number, label: string) => onChange(items.map((it, idx) => idx === i ? { ...it, label } : it))
    const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i))
    const add = () => onChange([...items, { id: '', code: '', label: '', sort_order: (items.length + 1) * 10, is_active: true }])
    return (
        <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                {!disabled && <Button variant="outline" size="sm" onClick={add} className="gap-1"><Plus className="h-3.5 w-3.5" /> Add</Button>}
            </div>
            <div className="space-y-2">
                {items.length === 0 && <p className="text-sm text-muted-foreground">No entries.</p>}
                {items.map((it, i) => (
                    <div key={it.id || i} className="flex items-center gap-2">
                        <Input value={it.label} onChange={(e) => update(i, e.target.value)} disabled={disabled} placeholder="Label" />
                        {!disabled && <Button variant="ghost" size="icon" className="text-red-600" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                ))}
            </div>
        </section>
    )
}
