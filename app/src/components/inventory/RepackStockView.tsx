'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
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
import { Boxes, ArrowRight, AlertCircle, Check, CheckCircle2, RefreshCw, Search } from 'lucide-react'
import {
  createRepackPreview,
  isRepackDestinationConfiguration,
  isRepackSourceConfiguration,
} from '@/lib/inventory/repack-stock'

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
  sourceOnHand: number
  sourceAllocated: number
  destinationOnHand: number
  destinationAllocated: number
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
 * Manual 1:1 box reclassification: 50OB or 50NB -> 20NB.
 * Source configurations remain distinct in the paired movement audit trail.
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
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingRows, setLoadingRows] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lastReferenceNo, setLastReferenceNo] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const requestIdRef = useRef<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const quantityRef = useRef<HTMLInputElement>(null)

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
    requestIdRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWarehouse])

  /** Auto-scroll the form into view on selection, respecting reduced motion. */
  useEffect(() => {
    if (!selectedRow) return
    // Use requestAnimationFrame to ensure the DOM has rendered the form first
    const raf = requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      formRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'nearest',
      })
      // Focus the quantity field after a short delay to let scroll finish
      setTimeout(() => quantityRef.current?.focus(), prefersReducedMotion ? 0 : 100)
    })
    return () => cancelAnimationFrame(raf)
  }, [selectedRow])

  const warehouseName = useMemo(() => {
    const warehouse = warehouses.find(wh => wh.id === selectedWarehouse)
    return warehouse ? `${warehouse.org_name} (${warehouse.org_code})` : ''
  }, [warehouses, selectedWarehouse])

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
      // Load exact configuration balances, then retain 50OB and 50NB as
      // separate source rows. Eligibility is never inferred from quantity.
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          variant_id,
          quantity_on_hand,
          quantity_allocated,
          quantity_available,
          stock_config_id,
          inventory_stock_configurations!product_inventory_stock_config_fk (
            id, config_code, config_label, stock_sku, volume_ml, packaging, status, requires_repacking_before_sale
          ),
          product_variants!inner (
            id, variant_code, variant_name,
            products!inner ( product_name )
          )
        `)
        .eq('organization_id', warehouseId)
        .eq('is_active', true)
        .gt('quantity_on_hand', 0)

      if (error) throw error

      const candidates = (data || []).filter((item: any) => {
        const cfg = Array.isArray(item.inventory_stock_configurations)
          ? item.inventory_stock_configurations[0]
          : item.inventory_stock_configurations
        return cfg && isRepackSourceConfiguration(cfg)
          && Number(item.quantity_available ?? 0) > 0
      })

      if (candidates.length === 0) {
        setRows([])
        return
      }

      // Both source types converge on the same flavour's active 20NB config.
      const variantIds = Array.from(new Set(candidates.map((item: any) => item.variant_id)))
      const { data: targets, error: targetError } = await supabase
        .from('inventory_stock_configurations')
        .select('id, variant_id, config_code, config_label, stock_sku, volume_ml, packaging, status')
        .in('variant_id', variantIds)
        .eq('config_code', '20NB')
        .eq('volume_ml', 20)
        .eq('packaging', 'new_box')
        .eq('status', 'active')
      if (targetError) throw targetError

      const targetIds = (targets || []).map(target => target.id)
      const { data: targetBalances, error: targetBalanceError } = targetIds.length > 0
        ? await supabase
          .from('product_inventory')
          .select('stock_config_id, quantity_on_hand, quantity_allocated')
          .eq('organization_id', warehouseId)
          .eq('is_active', true)
          .in('stock_config_id', targetIds)
        : { data: [], error: null }
      if (targetBalanceError) throw targetBalanceError
      const targetBalanceByConfig = new Map(
        (targetBalances || []).map(balance => [balance.stock_config_id, balance]),
      )

      const nextRows: RepackableRow[] = candidates.flatMap((item: any) => {
        const cfg = Array.isArray(item.inventory_stock_configurations)
          ? item.inventory_stock_configurations[0]
          : item.inventory_stock_configurations
        const variant = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants
        const product = Array.isArray(variant?.products) ? variant.products[0] : variant?.products
        const target = (targets || []).find(t =>
          t.variant_id === item.variant_id && isRepackDestinationConfiguration(t)
        )
        if (!target || target.id === cfg.id) return []
        const targetBalance = targetBalanceByConfig.get(target.id)
        const availableQty = Number(item.quantity_available ?? 0)
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
          sourceOnHand: Number(item.quantity_on_hand || 0),
          sourceAllocated: Number(item.quantity_allocated || 0),
          destinationOnHand: Number(targetBalance?.quantity_on_hand || 0),
          destinationAllocated: Number(targetBalance?.quantity_allocated || 0),
          availableQty,
        }]
      }).sort((a, b) =>
        `${a.productName} ${a.variantName} ${a.fromConfigLabel}`
          .localeCompare(`${b.productName} ${b.variantName} ${b.fromConfigLabel}`)
      )

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
        reference_id, reference_no, created_at, quantity_change, movement_type,
        product_variants ( variant_name ),
        config:inventory_stock_configurations!stock_movements_stock_config_fk ( config_label )
      `)
      .eq('reference_type', 'repack')
      .or(`from_organization_id.eq.${warehouseId},to_organization_id.eq.${warehouseId}`)
      .in('movement_type', ['repack_out', 'repack_in'])
      .order('created_at', { ascending: false })
      .limit(40)
    if (error) {
      console.warn('Failed to load repack history:', error.message)
      return
    }
    const grouped = new Map<string, any[]>()
    for (const movement of data || []) {
      const key = movement.reference_id || movement.reference_no || movement.created_at
      grouped.set(key, [...(grouped.get(key) || []), movement])
    }
    setHistory(Array.from(grouped.values()).flatMap(group => {
      const outgoing = group.find(movement => movement.movement_type === 'repack_out')
      const incoming = group.find(movement => movement.movement_type === 'repack_in')
      if (!outgoing) return []
      const variant = Array.isArray(outgoing.product_variants) ? outgoing.product_variants[0] : outgoing.product_variants
      const fromConfig = Array.isArray(outgoing.config) ? outgoing.config[0] : outgoing.config
      const toConfig = Array.isArray(incoming?.config) ? incoming.config[0] : incoming?.config
      return [{
        referenceNo: outgoing.reference_no || '-',
        createdAt: outgoing.created_at,
        variantName: variant?.variant_name || '-',
        quantity: Math.abs(Number(outgoing.quantity_change || 0)),
        fromLabel: fromConfig?.config_label || 'Unknown source',
        toLabel: toConfig?.config_label || 'Unknown destination',
      }]
    }).slice(0, 20))
  }

  const parsedQuantity = useMemo(() => {
    const value = parseInt(quantity, 10)
    return Number.isFinite(value) && value > 0 ? value : null
  }, [quantity])

  const canSubmit = Boolean(
    selectedWarehouse && selectedRow && parsedQuantity && parsedQuantity <= (selectedRow?.availableQty ?? 0)
  )

  const preview = useMemo(() => {
    if (!selectedRow || parsedQuantity === null) return null
    try {
      return createRepackPreview(
        {
          configId: selectedRow.fromConfigId,
          onHand: selectedRow.sourceOnHand,
          allocated: selectedRow.sourceAllocated,
        },
        {
          configId: selectedRow.toConfigId,
          onHand: selectedRow.destinationOnHand,
          allocated: selectedRow.destinationAllocated,
        },
        parsedQuantity,
      )
    } catch {
      return null
    }
  }, [parsedQuantity, selectedRow])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return rows
    return rows.filter(row => [
      row.productName,
      row.variantName,
      row.variantCode,
      row.fromConfigLabel,
      row.fromStockSku,
    ].some(value => value.toLowerCase().includes(query)))
  }, [rows, searchQuery])

  const handleSelectRow = useCallback((row: RepackableRow) => {
    setSelectedRow(row)
    setQuantity('')
    setLastReferenceNo(null)
    requestIdRef.current = crypto.randomUUID()
  }, [])

  const handleCancel = useCallback(() => {
    setSelectedRow(null)
    setQuantity('')
    setNotes('')
    requestIdRef.current = null
  }, [])

  const submitRepack = async () => {
    if (submittingRef.current || !selectedRow || !parsedQuantity || !canSubmit || !preview) return
    requestIdRef.current ||= crypto.randomUUID()
    submittingRef.current = true
    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('repack_stock_v2', {
        p_request_id: requestIdRef.current,
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
      requestIdRef.current = null
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

  const isRowSelected = (row: RepackableRow) => selectedRow?.fromConfigId === row.fromConfigId && selectedRow?.variantId === row.variantId

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6" />
            Repack Stock
          </h1>
          <p className="text-muted-foreground">
            Reclassify 50ml Old Box or 50ml New Box into 20ml New Box at a 1:1 unit ratio. This operation changes the recorded box configuration, not measured liquid contents.
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
            <div className="text-sm">
              Generated RPK reference: <span className="font-mono font-semibold text-base">{lastReferenceNo}</span>
            </div>
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
            <CardTitle>Stock eligible for reclassification</CardTitle>
            <CardDescription>
              50ml Old Box and 50ml New Box balances are listed separately when unallocated available stock is greater than zero.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRows ? (
              <p className="text-sm text-muted-foreground py-6">Loading…</p>
            ) : rows.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <AlertCircle className="h-4 w-4" />
                No eligible 50ml stock at this warehouse.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Search product, flavour or stock SKU"
                  />
                </div>
                {filteredRows.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">No eligible source balances match this search.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product / Flavour</TableHead>
                        <TableHead>Source Configuration</TableHead>
                        <TableHead></TableHead>
                        <TableHead>Destination (20ml New Box)</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.map(row => {
                        const isSelected = isRowSelected(row)
                        return (
                          <TableRow
                            key={`${row.variantId}:${row.fromConfigId}`}
                            data-state={isSelected ? 'selected' : undefined}
                            className={isSelected ? 'bg-green-50 hover:bg-green-100' : undefined}
                            aria-selected={isSelected}
                          >
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
                              {isSelected ? (
                                <Button
                                  size="sm"
                                  disabled={submitting}
                                  variant="default"
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                  aria-pressed="true"
                                  onClick={() => handleSelectRow(row)}
                                >
                                  <Check className="h-4 w-4 mr-1" />
                                  Selected
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  disabled={submitting}
                                  variant="outline"
                                  aria-pressed="false"
                                  onClick={() => handleSelectRow(row)}
                                >
                                  Select
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedRow && (
        <Card ref={formRef}>
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
                <label className="text-sm font-medium" htmlFor="repack-quantity">Quantity to repack</label>
                <Input
                  id="repack-quantity"
                  ref={quantityRef}
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
                <label className="text-sm font-medium" htmlFor="repack-notes">Notes (optional)</label>
                <Input
                  id="repack-notes"
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  placeholder="Reason or operational notes"
                />
              </div>
            </div>
            {preview && (
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm md:grid-cols-3">
                <div>
                  <div className="font-medium">{selectedRow.fromConfigLabel}</div>
                  <div className="text-muted-foreground">Source: {preview.sourceBefore} → {preview.sourceAfter}</div>
                  <div className="text-xs text-muted-foreground">{preview.sourceAvailable} available before conversion</div>
                </div>
                <div>
                  <div className="font-medium">{selectedRow.toConfigLabel}</div>
                  <div className="text-muted-foreground">Destination: {preview.destinationBefore} → {preview.destinationAfter}</div>
                </div>
                <div>
                  <div className="font-medium">Total units</div>
                  <div className="text-muted-foreground">{preview.totalBefore} → {preview.totalAfter}</div>
                  <div className="text-xs text-green-700">No unit loss or gain</div>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button disabled={!canSubmit || !preview || submitting} onClick={() => setConfirmOpen(true)}>
                Repack {parsedQuantity ?? ''} unit{(parsedQuantity ?? 0) === 1 ? '' : 's'}
              </Button>
              <Button disabled={submitting} variant="ghost" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={open => { if (!submitting) setConfirmOpen(open) }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Repack</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="font-medium text-foreground">Product / Flavour</div>
                  <div>{selectedRow?.productName} — {selectedRow?.variantName}</div>

                  <div className="font-medium text-foreground">Warehouse</div>
                  <div>{warehouseName}</div>

                  <div className="font-medium text-foreground">Source Configuration</div>
                  <div>{selectedRow?.fromConfigLabel} · Stock SKU: {selectedRow?.fromStockSku}</div>

                  <div className="font-medium text-foreground">Destination</div>
                  <div>{selectedRow?.toConfigLabel} · Stock SKU: {selectedRow?.toStockSku}</div>

                  <div className="font-medium text-foreground">Quantity</div>
                  <div>{parsedQuantity} unit{(parsedQuantity ?? 0) === 1 ? '' : 's'}</div>
                </div>

                <div className="border-t pt-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="font-medium text-foreground">Source</div>
                      <div className="text-muted-foreground">{preview?.sourceBefore ?? 0} → {preview?.sourceAfter ?? 0}</div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Destination</div>
                      <div className="text-muted-foreground">{preview?.destinationBefore ?? 0} → {preview?.destinationAfter ?? 0}</div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Total</div>
                      <div className="text-muted-foreground">{preview?.totalBefore ?? 0} → {preview?.totalAfter ?? 0}</div>
                    </div>
                  </div>
                  <p className="text-xs text-green-700 text-center mt-1">No unit loss or gain</p>
                </div>

                <p className="text-xs text-muted-foreground">
                  This posts paired stock-out and stock-in movements under one auto-generated RPK reference and cannot be edited afterwards.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={event => { event.preventDefault(); submitRepack() }}>
              {submitting ? 'Posting…' : 'Confirm Repack'}
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