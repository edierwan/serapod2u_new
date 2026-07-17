'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Boxes, ArrowRight, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'

interface Warehouse {
  id: string
  org_code: string
  org_name: string
}

interface RepackableRow {
  variantId: string
  productName: string
  variantName: string
  variantCode: string
  fromConfigId: string
  fromConfigLabel: string
  fromStockSku: string
  toConfigId: string
  toConfigLabel: string
  toStockSku: string
  availableQty: number
}

interface RepackHistoryRow {
  referenceNo: string
  createdAt: string
  variantName: string
  quantity: number
  fromLabel: string
  toLabel: string
}

interface RepackStockViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

/**
 * Manual warehouse repacking: 50ml Old Box -> 50ml New Box.
 * Lists only balances whose configuration requires repacking before sale and
 * that have unallocated stock; the target configuration (same variant, same
 * volume, new box) is resolved automatically. Posting goes through the atomic
 * repack_stock RPC which creates paired repack_out / repack_in movements
 * under one RPK-* reference.
 */
export default function RepackStockView({ userProfile }: RepackStockViewProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [rows, setRows] = useState<RepackableRow[]>([])
  const [history, setHistory] = useState<RepackHistoryRow[]>([])
  const [selectedRow, setSelectedRow] = useState<RepackableRow | null>(null)
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lastReferenceNo, setLastReferenceNo] = useState<string | null>(null)
  const submittingRef = useRef(false)

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) loadWarehouses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (selectedWarehouse) {
      loadRepackableRows(selectedWarehouse)
      loadHistory(selectedWarehouse)
    } else {
      setRows([])
      setHistory([])
    }
    setSelectedRow(null)
    setQuantity('')
    setNotes('')
    setLastReferenceNo(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWarehouse])

  const loadWarehouses = async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, org_code, org_name')
      .in('org_type_code', ['HQ', 'WH'])
      .eq('is_active', true)
      .order('org_name')
    if (error) {
      toast({ title: 'Failed to load warehouses', description: error.message, variant: 'destructive' })
      return
    }
    setWarehouses(data || [])
    const locations = data || []
    const profileOrganizationId = userProfile?.organization_id || userProfile?.organizations?.id
    const preferred = locations.find(location => location.id === profileOrganizationId)
      || locations.find(location => location.org_code === 'HQ' || location.org_name.toLowerCase().includes('warehouse'))
      || locations[0]
    if (preferred) setSelectedWarehouse(preferred.id)
  }

  const loadRepackableRows = async (warehouseId: string) => {
    setLoadingRows(true)
    try {
      // Balances whose configuration requires repacking (50ml Old Box).
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          variant_id,
          quantity_on_hand,
          quantity_allocated,
          stock_config_id,
          inventory_stock_configurations!product_inventory_stock_config_fk (
            id, config_label, stock_sku, volume_ml, packaging, status, requires_repacking_before_sale
          ),
          product_variants!inner (
            id, variant_code, variant_name,
            products!inner ( product_name )
          )
        `)
        .eq('organization_id', warehouseId)
        .eq('is_active', true)
        .eq('inventory_stock_configurations.volume_ml', 50)
        .eq('inventory_stock_configurations.packaging', 'old_box')
        .gt('quantity_on_hand', 0)

      if (error) throw error

      const candidates = (data || []).filter((item: any) => {
        const cfg = Array.isArray(item.inventory_stock_configurations)
          ? item.inventory_stock_configurations[0]
          : item.inventory_stock_configurations
        return cfg?.volume_ml === 50
          && cfg?.packaging === 'old_box'
          && cfg?.requires_repacking_before_sale === true
          && cfg?.status !== 'inactive'
      })

      if (candidates.length === 0) {
        setRows([])
        return
      }

      // Resolve each source row's target configuration: same variant, same
      // volume, new box, active.
      const variantIds = Array.from(new Set(candidates.map((item: any) => item.variant_id)))
      const { data: targets, error: targetError } = await supabase
        .from('inventory_stock_configurations')
        .select('id, variant_id, config_label, stock_sku, volume_ml, packaging, status')
        .in('variant_id', variantIds)
        .eq('volume_ml', 50)
        .eq('packaging', 'new_box')
        .eq('status', 'active')
      if (targetError) throw targetError

      const nextRows: RepackableRow[] = candidates.flatMap((item: any) => {
        const cfg = Array.isArray(item.inventory_stock_configurations)
          ? item.inventory_stock_configurations[0]
          : item.inventory_stock_configurations
        const variant = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants
        const product = Array.isArray(variant?.products) ? variant.products[0] : variant?.products
        const target = (targets || []).find(t => t.variant_id === item.variant_id && t.volume_ml === cfg.volume_ml)
        if (!target) return []
        const availableQty = Number(item.quantity_on_hand || 0) - Number(item.quantity_allocated || 0)
        if (availableQty <= 0) return []
        return [{
          variantId: item.variant_id,
          productName: product?.product_name || 'Unnamed product',
          variantName: variant?.variant_name || 'Unnamed variant',
          variantCode: variant?.variant_code || '',
          fromConfigId: cfg.id,
          fromConfigLabel: cfg.config_label,
          fromStockSku: cfg.stock_sku,
          toConfigId: target.id,
          toConfigLabel: target.config_label,
          toStockSku: target.stock_sku,
          availableQty,
        }]
      }).sort((a, b) => `${a.productName} ${a.variantName}`.localeCompare(`${b.productName} ${b.variantName}`))

      setRows(nextRows)
    } catch (error: any) {
      toast({ title: 'Failed to load repackable stock', description: error.message, variant: 'destructive' })
    } finally {
      setLoadingRows(false)
    }
  }

  const loadHistory = async (warehouseId: string) => {
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        reference_no, created_at, quantity_change, movement_type,
        product_variants ( variant_name ),
        config:inventory_stock_configurations!stock_movements_stock_config_fk ( config_label )
      `)
      .eq('reference_type', 'repack')
      .eq('from_organization_id', warehouseId)
      .eq('movement_type', 'repack_out')
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) {
      console.warn('Failed to load repack history:', error.message)
      return
    }
    setHistory((data || []).map((m: any) => {
      const variant = Array.isArray(m.product_variants) ? m.product_variants[0] : m.product_variants
      const cfg = Array.isArray(m.config) ? m.config[0] : m.config
      return {
        referenceNo: m.reference_no || '-',
        createdAt: m.created_at,
        variantName: variant?.variant_name || '-',
        quantity: Math.abs(Number(m.quantity_change || 0)),
        fromLabel: cfg?.config_label || 'Old Box',
        toLabel: 'New Box',
      }
    }))
  }

  const parsedQuantity = useMemo(() => {
    const value = parseInt(quantity, 10)
    return Number.isFinite(value) && value > 0 ? value : null
  }, [quantity])

  const canSubmit = Boolean(
    selectedWarehouse && selectedRow && parsedQuantity && parsedQuantity <= (selectedRow?.availableQty ?? 0)
  )

  const submitRepack = async () => {
    if (submittingRef.current || !selectedRow || !parsedQuantity || !canSubmit) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('repack_stock', {
        p_variant_id: selectedRow.variantId,
        p_warehouse_org_id: selectedWarehouse,
        p_from_config_id: selectedRow.fromConfigId,
        p_to_config_id: selectedRow.toConfigId,
        p_quantity: parsedQuantity,
        p_notes: notes.trim() || undefined,
        p_created_by: userProfile?.id,
      })
      if (error) throw error
      const referenceNo = (data as any)?.reference_no || 'RPK'
      setLastReferenceNo(referenceNo)
      toast({
        title: 'Repack posted',
        description: `${referenceNo}: ${parsedQuantity} × ${selectedRow.variantName} — ${selectedRow.fromConfigLabel} → ${selectedRow.toConfigLabel}`,
      })
      setSelectedRow(null)
      setQuantity('')
      setNotes('')
      await Promise.all([
        loadRepackableRows(selectedWarehouse),
        loadHistory(selectedWarehouse),
      ])
    } catch (error: any) {
      toast({ title: 'Repack failed', description: error.message, variant: 'destructive' })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6" />
            Repacking
          </h1>
          <p className="text-muted-foreground">
            Convert 50ml Old Box stock into 50ml New Box. Volume never changes; each repack posts a traceable RPK reference.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedWarehouse || loadingRows}
          onClick={() => { loadRepackableRows(selectedWarehouse); loadHistory(selectedWarehouse) }}
        >
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {lastReferenceNo && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div>
            <div className="font-medium">Repack posted successfully</div>
            <div className="text-sm">Reference: <span className="font-mono font-semibold">{lastReferenceNo}</span></div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Warehouse</CardTitle>
          <CardDescription>Repacking is performed at a single warehouse; stock never moves between organizations.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
            <SelectTrigger className="w-full md:w-96">
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map(warehouse => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.org_name} ({warehouse.org_code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedWarehouse && (
        <Card>
          <CardHeader>
            <CardTitle>Stock awaiting repack</CardTitle>
            <CardDescription>
              Only configurations flagged “requires repacking before sale” with unallocated stock are listed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRows ? (
              <p className="text-sm text-muted-foreground py-6">Loading…</p>
            ) : rows.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <AlertCircle className="h-4 w-4" />
                No stock awaiting repack at this warehouse.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product / Flavour</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead></TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={`${row.variantId}:${row.fromConfigId}`} data-state={selectedRow?.fromConfigId === row.fromConfigId ? 'selected' : undefined}>
                      <TableCell>
                        <div className="font-medium">{row.productName}</div>
                        <div className="text-sm text-muted-foreground">{row.variantName} · {row.variantCode}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.fromConfigLabel}</Badge>
                        <div className="text-xs text-muted-foreground mt-1">{row.fromStockSku}</div>
                      </TableCell>
                      <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                      <TableCell>
                        <Badge>{row.toConfigLabel}</Badge>
                        <div className="text-xs text-muted-foreground mt-1">{row.toStockSku}</div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{row.availableQty}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          disabled={submitting}
                          variant={selectedRow?.fromConfigId === row.fromConfigId ? 'default' : 'outline'}
                          onClick={() => { setSelectedRow(row); setQuantity('') }}
                        >
                          Select
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {selectedRow && (
        <Card>
          <CardHeader>
            <CardTitle>Repack {selectedRow.variantName}</CardTitle>
            <CardDescription>
              {selectedRow.fromConfigLabel} ({selectedRow.fromStockSku}) → {selectedRow.toConfigLabel} ({selectedRow.toStockSku})
              {' '}· source available: {selectedRow.availableQty} units
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Quantity to repack</label>
                <Input
                  type="number"
                  min={1}
                  max={selectedRow.availableQty}
                  value={quantity}
                  onChange={event => setQuantity(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={`1 – ${selectedRow.availableQty}`}
                />
                {parsedQuantity !== null && parsedQuantity > selectedRow.availableQty && (
                  <p className="text-sm text-destructive mt-1">Exceeds available unallocated stock.</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium">Notes (optional)</label>
                <Input value={notes} onChange={event => setNotes(event.target.value)} placeholder="e.g. repack batch reference" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button disabled={!canSubmit || submitting} onClick={() => setConfirmOpen(true)}>
                Repack {parsedQuantity ?? ''} unit{(parsedQuantity ?? 0) === 1 ? '' : 's'}
              </Button>
              <Button disabled={submitting} variant="ghost" onClick={() => { setSelectedRow(null); setQuantity(''); setNotes('') }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={open => { if (!submitting) setConfirmOpen(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm repack</AlertDialogTitle>
            <AlertDialogDescription>
              {parsedQuantity} unit{(parsedQuantity ?? 0) === 1 ? '' : 's'} of {selectedRow?.productName} — {selectedRow?.variantName} will be
              moved from {selectedRow?.fromConfigLabel} ({selectedRow?.fromStockSku}) to {selectedRow?.toConfigLabel} ({selectedRow?.toStockSku}).
              {' '}The current source balance available to repack is {selectedRow?.availableQty ?? 0} units. This posts paired stock-out and
              stock-in movements under one RPK reference and cannot be edited afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Back</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={event => { event.preventDefault(); submitRepack() }}>
              {submitting ? 'Posting…' : 'Confirm repack'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedWarehouse && history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent repacks</CardTitle>
            <CardDescription>Latest RPK references at this warehouse.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Flavour</TableHead>
                  <TableHead>Configuration</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(entry => (
                  <TableRow key={`${entry.referenceNo}:${entry.createdAt}`}>
                    <TableCell className="font-mono text-sm">{entry.referenceNo}</TableCell>
                    <TableCell>{entry.variantName}</TableCell>
                    <TableCell>{entry.fromLabel} <ArrowRight className="mx-1 inline h-3 w-3" /> {entry.toLabel}</TableCell>
                    <TableCell className="text-right">{entry.quantity}</TableCell>
                    <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
