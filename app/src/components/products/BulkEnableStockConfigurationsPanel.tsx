'use client'

import { useCallback, useEffect, useState } from 'react'
import { Boxes, CheckCircle2, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface EligibleVariant {
  id: string
  variantName: string
  variantCode: string
  productName: string
  productCode: string
  alreadyEnabled: boolean
}

interface ResultRow {
  variant_id: string
  status: 'enabled' | 'already_enabled' | 'error'
  message?: string
}

export default function BulkEnableStockConfigurationsPanel({ canManage }: { canManage: boolean }) {
  const [variants, setVariants] = useState<EligibleVariant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<ResultRow[] | null>(null)

  const load = useCallback(async () => {
    if (!canManage) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/inventory/stock-configurations/bulk-eligible', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to load eligible variants')
      const eligible: EligibleVariant[] = body.variants || []
      setVariants(eligible)
      setSelected(new Set(eligible.filter(variant => !variant.alreadyEnabled).map(variant => variant.id)))
    } catch (loadError: any) {
      setError(loadError.message || 'Unable to load eligible variants')
    } finally {
      setLoading(false)
    }
  }, [canManage])

  useEffect(() => { load() }, [load])
  if (!canManage) return null

  const toggle = (variantId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(variantId)) next.delete(variantId)
      else next.add(variantId)
      return next
    })
  }

  const submit = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`Enable 20ml New Box, 50ml New Box, and 50ml Old Box for ${selected.size} selected flavour(s)? Existing balances stay in Legacy/Unclassified and are not moved.`)) return
    setSubmitting(true)
    setError('')
    setResults(null)
    try {
      const response = await fetch('/api/inventory/stock-configurations/bulk-enable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantIds: Array.from(selected) }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to bulk-enable stock configurations')
      setResults(body.results || [])
      await load()
    } catch (submitError: any) {
      setError(submitError.message || 'Unable to bulk-enable stock configurations')
    } finally {
      setSubmitting(false)
    }
  }

  const pendingCount = variants.filter(variant => !variant.alreadyEnabled).length

  return (
    <Card className="border-blue-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Boxes className="h-4 w-4 text-blue-700" />Enable Stock Configurations for Existing Cellera Flavours</CardTitle>
        <p className="text-xs text-slate-600">HQ Admin only. Creates exactly 20ml New Box, 50ml New Box, and 50ml Old Box for the flavours you select. Does not move or classify any existing balance.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading Cellera vape variants…</div> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        {!loading && variants.length === 0 && !error ? (
          <p className="text-sm text-slate-500">No Cellera vape variants found.</p>
        ) : null}

        {!loading && variants.length > 0 ? (
          <>
            <p className="text-xs text-slate-500">{pendingCount} pending · {variants.length - pendingCount} already enabled</p>
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Product</TableHead><TableHead>Variant</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {variants.map(variant => (
                    <TableRow key={variant.id}>
                      <TableCell><Checkbox checked={selected.has(variant.id)} disabled={variant.alreadyEnabled} onCheckedChange={() => toggle(variant.id)} /></TableCell>
                      <TableCell>{variant.productName} <span className="text-xs text-slate-400">{variant.productCode}</span></TableCell>
                      <TableCell>{variant.variantName} <span className="text-xs text-slate-400">{variant.variantCode}</span></TableCell>
                      <TableCell>{variant.alreadyEnabled
                        ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Already enabled</Badge>
                        : <Badge variant="outline">Pending</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button type="button" onClick={submit} disabled={submitting || selected.size === 0}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
              Enable Selected ({selected.size})
            </Button>
          </>
        ) : null}

        {results ? (
          <div className="space-y-1 rounded-lg border bg-slate-50 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-slate-900"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Result: {results.filter(r => r.status === 'enabled').length} enabled, {results.filter(r => r.status === 'already_enabled').length} already enabled, {results.filter(r => r.status === 'error').length} failed</p>
            {results.filter(r => r.status === 'error').map(r => (
              <p key={r.variant_id} className="text-xs text-red-600">{r.variant_id}: {r.message}</p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
