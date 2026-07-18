'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Boxes, Check, Loader2, Search, ShieldCheck, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isCelleraVapeVariant, type CelleraVapeProductLike } from '@/lib/inventory/cellera-variant'

interface ConfigurationRow {
  id: string
  config_code: string
  config_label: string
  stock_sku: string
  volume_ml: number | null
  packaging: string | null
  status: string
  allow_ord: boolean
  allow_so: boolean
  default_for_ord: boolean
  requires_repacking_before_sale: boolean
  onHand: number
  allocated: number
  available: number
  eligibleDistributorCount: number | null
}

interface PanelData {
  enabled: boolean
  configurations: ConfigurationRow[]
  legacy: ConfigurationRow[]
}

interface DistributorRow {
  id: string
  org_code: string
  org_name: string
  eligible: boolean
  createdAt: string | null
  updatedAt: string | null
  responsibleUser: string | null
}

export default function VariantStockConfigurationsPanel({
  variantId,
  product,
  canManage,
}: {
  variantId: string
  product: CelleraVapeProductLike | null
  canManage: boolean
}) {
  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [enabling, setEnabling] = useState(false)
  const [error, setError] = useState('')
  const [eligibilityOpen, setEligibilityOpen] = useState(false)
  const relevant = isCelleraVapeVariant(product)

  const load = useCallback(async () => {
    if (!variantId || !relevant || !canManage) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/inventory/stock-configurations/variant/${variantId}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to load stock configurations')
      setData(body)
    } catch (loadError: any) {
      setError(loadError.message || 'Unable to load stock configurations')
    } finally {
      setLoading(false)
    }
  }, [variantId, relevant, canManage])

  useEffect(() => { load() }, [load])
  if (!relevant || !canManage) return null

  const enable = async () => {
    if (!window.confirm('Enable 20ml New Box, 50ml New Box, and 50ml Old Box for this flavour? Existing balances will remain Legacy / Unclassified and will not be moved.')) return
    setEnabling(true)
    setError('')
    try {
      const response = await fetch(`/api/inventory/stock-configurations/variant/${variantId}`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to enable stock configurations')
      setData(body)
    } catch (enableError: any) {
      setError(enableError.message || 'Unable to enable stock configurations')
    } finally {
      setEnabling(false)
    }
  }

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-4" aria-label="Inventory Stock Configurations">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950 flex items-center gap-2"><Boxes className="h-4 w-4 text-blue-700" />Inventory Stock Configurations</h3>
          <p className="text-xs text-slate-600 mt-1">Physical inventory beneath this flavour. Pricing, QR identity, and distributor ordering remain flavour-level.</p>
        </div>
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">HQ Admin</Badge>
      </div>

      {loading ? <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading configuration balances…</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {!loading && data && !data.enabled ? (
        <div className="rounded-lg border border-dashed border-blue-300 bg-white p-4 text-center space-y-3">
          <p className="font-medium text-slate-900">This flavour is not configuration-enabled.</p>
          <p className="text-sm text-slate-600">Enabling creates exactly 20ml New Box, 50ml New Box, and 50ml Old Box. Existing quantities stay in Legacy / Unclassified until a controlled physical stock process is performed.</p>
          <Button type="button" onClick={enable} disabled={enabling}>
            {enabling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
            Enable Stock Configurations
          </Button>
        </div>
      ) : null}

      {!loading && data?.enabled ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="min-w-[980px] w-full text-xs">
              <thead className="bg-slate-50 text-slate-600"><tr>
                {['Volume','Packaging Version','Stock SKU','Lifecycle','On Hand','Allocated','Available','Allow ORD','Allow SO','ORD Default','Repack','50ml Eligibility'].map(label => <th key={label} className="px-3 py-2 text-left font-semibold">{label}</th>)}
              </tr></thead>
              <tbody className="divide-y">
                {data.configurations.map(config => (
                  <tr key={config.id}>
                    <td className="px-3 py-2 font-semibold">{config.volume_ml}ml</td>
                    <td className="px-3 py-2">{config.packaging === 'new_box' ? 'New Box' : 'Old Box'}</td>
                    <td className="px-3 py-2 font-mono text-blue-700">{config.stock_sku}</td>
                    <td className="px-3 py-2"><Badge variant="outline">{config.status}</Badge></td>
                    <td className="px-3 py-2 tabular-nums">{config.onHand.toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums">{config.allocated.toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold">{config.available.toLocaleString()}</td>
                    <BooleanCell value={config.allow_ord} />
                    <BooleanCell value={config.allow_so} />
                    <BooleanCell value={config.default_for_ord} />
                    <BooleanCell value={config.requires_repacking_before_sale} />
                    <td className="px-3 py-2">
                      {config.config_code === '50NB' ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => setEligibilityOpen(true)}>
                          <ShieldCheck className="mr-1 h-3.5 w-3.5" />{config.eligibleDistributorCount || 0} eligible
                        </Button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.legacy.filter(row => row.onHand !== 0 || row.allocated !== 0).map(row => (
            <div key={row.id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div><strong>Legacy / Unclassified:</strong> {row.onHand.toLocaleString()} on hand, {row.allocated.toLocaleString()} allocated, {row.available.toLocaleString()} available. These quantities were not automatically classified.</div>
            </div>
          ))}
        </div>
      ) : null}

      {eligibilityOpen ? <EligibilityManager onClose={() => { setEligibilityOpen(false); load() }} /> : null}
    </section>
  )
}

function BooleanCell({ value }: { value: boolean }) {
  return <td className="px-3 py-2">{value ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-slate-300" />}</td>
}

function EligibilityManager({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<DistributorRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/inventory/stock-configurations/eligibility?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to load distributors')
      setRows(body.distributors || [])
    } catch (loadError: any) { setError(loadError.message) } finally { setLoading(false) }
  }, [query])
  useEffect(() => { const timer = setTimeout(load, 200); return () => clearTimeout(timer) }, [load])

  const update = async (row: DistributorRow) => {
    if (row.eligible && !window.confirm(`Remove 50ml New Box eligibility for ${row.org_name}? Open 50ml allocations will block removal.`)) return
    setBusyId(row.id); setError('')
    try {
      const response = await fetch(
        row.eligible ? `/api/inventory/stock-configurations/eligibility?distributorOrgId=${row.id}` : '/api/inventory/stock-configurations/eligibility',
        row.eligible ? { method: 'DELETE' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ distributorOrgId: row.id }) },
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to update eligibility')
      await load()
    } catch (updateError: any) { setError(updateError.message) } finally { setBusyId('') }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-xl bg-white shadow-xl flex flex-col">
        <div className="p-4 border-b flex items-center justify-between"><div><h3 className="font-semibold">50ml New Box Eligibility</h3><p className="text-xs text-slate-500">Internal HQ administration only</p></div><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button></div>
        <div className="p-4 border-b"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search distributor name or code" /></div>{error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}</div>
        <div className="overflow-y-auto divide-y">
          {loading ? <div className="p-6 text-sm text-slate-500 flex gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading distributors…</div> : rows.map(row => (
            <div key={row.id} className="p-4 flex items-center justify-between gap-4">
              <div><p className="font-medium text-sm">{row.org_name}</p><p className="text-xs text-slate-500">{row.org_code}{row.responsibleUser ? ` · ${row.responsibleUser}` : ''}{row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleDateString()}` : ''}</p></div>
              <div className="flex items-center gap-2"><Badge className={row.eligible ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-100'}>{row.eligible ? 'Eligible' : 'Not Eligible'}</Badge><Button size="sm" variant={row.eligible ? 'destructive' : 'default'} disabled={busyId === row.id} onClick={() => update(row)}>{busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : row.eligible ? 'Remove' : 'Add'}</Button></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
