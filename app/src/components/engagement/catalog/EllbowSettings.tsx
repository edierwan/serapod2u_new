'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Save } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'

type Settings = {
  active: boolean; claim_mode: 'single' | 'dual'; staff_points_per_scan: number; consumer_points_per_scan: number
  point_value_rm: number; roadtour_reward_points: number; registration_bonus: number; referral_incentive_default: number
}
const defaults: Settings = { active: false, claim_mode: 'single', staff_points_per_scan: 0, consumer_points_per_scan: 0, point_value_rm: 0, roadtour_reward_points: 0, registration_bonus: 0, referral_incentive_default: 0 }

export function EllbowSettings() {
  const [settings, setSettings] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()
  useEffect(() => { fetch('/api/engagement/catalog/ellbow/settings').then(async response => {
    const body = await response.json(); if (!response.ok) throw new Error(body.error); setSettings({ ...defaults, ...body.settings, point_value_rm: Number(body.settings.point_value_rm) })
  }).catch(error => toast({ title: 'Unable to load Ellbow settings', description: error.message, variant: 'destructive' })).finally(() => setLoading(false)) }, [toast])
  const costs = useMemo(() => ({ staff: settings.staff_points_per_scan * settings.point_value_rm, consumer: settings.consumer_points_per_scan * settings.point_value_rm }), [settings])
  const incomplete = !settings.active || settings.point_value_rm <= 0 || (settings.staff_points_per_scan <= 0 && settings.consumer_points_per_scan <= 0)
  const unusuallyHighScanCost = costs.staff > 10 || costs.consumer > 10
  const setNumber = (key: keyof Settings, value: string) => setSettings(current => ({ ...current, [key]: Math.max(0, Number(value) || 0) }))
  const save = async () => { setSaving(true); try { const response = await fetch('/api/engagement/catalog/ellbow/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setSettings({ ...body.settings, point_value_rm: Number(body.settings.point_value_rm) }); toast({ title: 'Ellbow settings saved' }) } catch (error) { toast({ title: 'Unable to save settings', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' }) } finally { setSaving(false) } }
  if (loading) return <div className="py-12 text-center text-muted-foreground">Loading Ellbow settings…</div>
  return <div className="space-y-5">
    {incomplete && <Alert className="border-amber-300 bg-amber-50"><AlertTriangle className="h-4 w-4 text-amber-700" /><div className="font-semibold">Configuration incomplete</div><AlertDescription>Ellbow Loyalty is not active for point collection until its settings are configured.</AlertDescription></Alert>}
    {unusuallyHighScanCost && <Alert className="border-amber-300 bg-amber-50"><AlertTriangle className="h-4 w-4 text-amber-700" /><div className="font-semibold">High scan cost preview</div><AlertDescription>One or more Ellbow scan lanes currently exceed RM 10.00 per scan. Review the values before activation.</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>Ellbow Loyalty Settings</CardTitle><CardDescription>Independent configuration storage only. These values are not connected to the Cellera point engine in Phase 1.</CardDescription></CardHeader><CardContent className="grid gap-5 md:grid-cols-2">
      <div className="flex items-center justify-between rounded-lg border p-4 md:col-span-2"><div><Label>Program active</Label><p className="text-sm text-muted-foreground">Marks configuration readiness; it does not award points yet.</p></div><Switch checked={settings.active} onCheckedChange={active => setSettings(current => ({ ...current, active }))} /></div>
      <Field label="Claim mode"><Select value={settings.claim_mode} onValueChange={(claim_mode: 'single' | 'dual') => setSettings(current => ({ ...current, claim_mode }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single claim</SelectItem><SelectItem value="dual">Dual claim</SelectItem></SelectContent></Select></Field>
      <NumberField label="Point value (RM)" value={settings.point_value_rm} onChange={value => setNumber('point_value_rm', value)} step="0.0001" />
      <NumberField label="Shop staff points per QR scan" value={settings.staff_points_per_scan} onChange={value => setNumber('staff_points_per_scan', value)} hint={`Cost preview: RM ${costs.staff.toFixed(4)} per scan`} />
      <NumberField label="Consumer points per QR scan" value={settings.consumer_points_per_scan} onChange={value => setNumber('consumer_points_per_scan', value)} hint={`Cost preview: RM ${costs.consumer.toFixed(4)} per scan`} />
      <NumberField label="RoadTour reward points" value={settings.roadtour_reward_points} onChange={value => setNumber('roadtour_reward_points', value)} hint="Stored only; no automatic selection in Phase 1." />
      <NumberField label="Registration bonus" value={settings.registration_bonus} onChange={value => setNumber('registration_bonus', value)} hint="Stored only; no points are awarded." />
      <NumberField label="Referral incentive default" value={settings.referral_incentive_default} onChange={value => setNumber('referral_incentive_default', value)} hint="Configuration storage only." />
      <div className="flex items-end justify-end"><Button onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save Ellbow Settings'}</Button></div>
    </CardContent></Card>
  </div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div> }
function NumberField({ label, value, onChange, hint, step = '1' }: { label: string; value: number; onChange: (value: string) => void; hint?: string; step?: string }) { return <Field label={label}><Input type="number" min="0" step={step} value={value} onChange={event => onChange(event.target.value)} />{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</Field> }
