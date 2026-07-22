'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import SupplyChainPageHeader from '@/modules/supply-chain/components/SupplyChainPageHeader'
import { SC_PANEL_CLASS } from '@/modules/supply-chain/components/supplyChainChrome'
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
        return <div className="flex items-center justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-[var(--sera-muted)]" /></div>
    }

    return (
        <div className="sera-sc-page space-y-4">
            <SupplyChainPageHeader
                eyebrow="Quality · Returns"
                title="Return Settings"
                description="Configure the product return module."
                actions={
                    canEdit ? (
                        <Button onClick={save} disabled={saving} className="gap-1.5 bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                        </Button>
                    ) : undefined
                }
            />

            {!canEdit && (
                <div className="rounded-lg border border-[var(--sera-orange)]/25 bg-[var(--sera-orange)]/8 px-3 py-2 text-sm text-[var(--sera-orange-deep)]">
                    You have read-only access to return settings.
                </div>
            )}

            <section className={`${SC_PANEL_CLASS} p-4`}>
                <h2 className="mb-3 text-sm font-semibold text-[var(--sera-ink)]">General</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                        <span className="text-xs font-medium text-[var(--sera-muted)]">Default Return Warehouse</span>
                        <Select value={settings.default_return_warehouse_id || ''} onValueChange={(v) => setSettings({ ...settings, default_return_warehouse_id: v })} disabled={!canEdit}>
                            <SelectTrigger className="border-[var(--sera-line)]"><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                            <SelectContent>
                                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.org_name}{w.org_code ? ` (${w.org_code})` : ''}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-md border border-[var(--sera-line)] px-3 py-2">
                        <span className="text-sm text-[var(--sera-ink-soft)]">Enable shop self-service return</span>
                        <Switch checked={settings.shop_self_service_enabled} onCheckedChange={(v) => setSettings({ ...settings, shop_self_service_enabled: v })} disabled={!canEdit} />
                    </label>
                </div>
            </section>

            <section className={`${SC_PANEL_CLASS} p-4`}>
                <h2 className="mb-3 text-sm font-semibold text-[var(--sera-ink)]">KPI / SLA Targets (days)</h2>
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

            <section className={`${SC_PANEL_CLASS} p-4`}>
                <h2 className="mb-2 text-sm font-semibold text-[var(--sera-ink)]">PDF Instruction Text / Return Note</h2>
                <Textarea value={settings.pdf_instruction_text || ''} onChange={(e) => setSettings({ ...settings, pdf_instruction_text: e.target.value })} disabled={!canEdit} rows={3} placeholder="Text printed at the bottom of the return PDF…" className="border-[var(--sera-line)]" />
            </section>
        </div>
    )
}

function NumField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
    return (
        <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--sera-muted)]">{label}</span>
            <Input type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} disabled={disabled} className="border-[var(--sera-line)]" />
        </label>
    )
}

function MasterListEditor({ title, items, onChange, disabled }: { title: string; items: ReturnMasterItem[]; onChange: (items: ReturnMasterItem[]) => void; disabled?: boolean }) {
    const update = (i: number, label: string) => onChange(items.map((it, idx) => idx === i ? { ...it, label } : it))
    const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i))
    const add = () => onChange([...items, { id: '', code: '', label: '', sort_order: (items.length + 1) * 10, is_active: true }])
    return (
        <section className={`${SC_PANEL_CLASS} p-4`}>
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--sera-ink)]">{title}</h2>
                {!disabled && <Button variant="outline" size="sm" onClick={add} className="gap-1 border-[var(--sera-line)]"><Plus className="h-3.5 w-3.5" /> Add</Button>}
            </div>
            <div className="space-y-2">
                {items.length === 0 && <p className="text-sm text-[var(--sera-muted)]">No entries.</p>}
                {items.map((it, i) => (
                    <div key={it.id || i} className="flex items-center gap-2">
                        <Input value={it.label} onChange={(e) => update(i, e.target.value)} disabled={disabled} placeholder="Label" className="border-[var(--sera-line)]" />
                        {!disabled && <Button variant="ghost" size="icon" className="text-red-600" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                ))}
            </div>
        </section>
    )
}
