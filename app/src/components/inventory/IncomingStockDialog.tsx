'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertTriangle, ArrowRightLeft, Factory, Truck } from 'lucide-react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import {
  formatQrStage,
  type IncomingStockDetailRow,
  type IncomingTransferDetailRow,
} from '@/lib/inventory/incoming-stock'

interface IncomingStockDialogProps {
  open: boolean
  onClose: () => void
  variantId: string
  warehouseOrgId: string
  productName: string
  variantName: string
}

const LINK_CLASSES =
  'text-xs font-medium text-[var(--sera-orange)] underline decoration-dotted underline-offset-2 ' +
  'hover:text-[var(--sera-orange-deep)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sera-orange)]/30 ' +
  'focus-visible:ring-offset-1 rounded-sm'

/**
 * Incoming detail for one variant + destination warehouse, split by source:
 *  - Manufacturer Orders (confirmed H2M orders not yet fully received)
 *  - Warehouse Transfers (confirmed in-transit transfers not yet posted)
 *
 * Order No. deep-links to the existing Order Detail view by database id
 * (/supply-chain?view=view-order&orderId=...). Transfer No. deep-links to the
 * Movement Reports view pre-filtered by the transfer number — there is no
 * dedicated transfer detail view in the app today.
 */
export default function IncomingStockDialog({
  open,
  onClose,
  variantId,
  warehouseOrgId,
  productName,
  variantName,
}: IncomingStockDialogProps) {
  const [orderRows, setOrderRows] = useState<IncomingStockDetailRow[]>([])
  const [transferRows, setTransferRows] = useState<IncomingTransferDetailRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { isReady, supabase } = useSupabaseAuth()

  useEffect(() => {
    if (!open || !isReady || !variantId || !warehouseOrgId) return

    let cancelled = false
    const fetchDetail = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const { data: orders, error: ordersError } = await supabase
          .from('v_incoming_stock_detail' as any)
          .select('*')
          .eq('variant_id', variantId)
          .eq('destination_warehouse_org_id', warehouseOrgId)
          .gt('incoming_qty', 0)
          .order('approved_at', { ascending: true })
        if (ordersError) throw ordersError

        // Transfers view arrives with migration 07 — treat absence as "none".
        let transfers: IncomingTransferDetailRow[] = []
        const { data: transferData, error: transferError } = await supabase
          .from('v_incoming_transfers_detail' as any)
          .select('*')
          .eq('variant_id', variantId)
          .eq('destination_warehouse_org_id', warehouseOrgId)
          .gt('incoming_qty', 0)
          .order('dispatched_at', { ascending: true })
        if (transferError) {
          console.warn('v_incoming_transfers_detail unavailable, transfer incoming hidden', transferError)
        } else {
          transfers = (transferData || []) as unknown as IncomingTransferDetailRow[]
        }

        if (!cancelled) {
          setOrderRows((orders || []) as unknown as IncomingStockDetailRow[])
          setTransferRows(transfers)
        }
      } catch (error: any) {
        console.error('Failed to load incoming stock detail:', error)
        if (!cancelled) setLoadError(error?.message || 'Failed to load incoming stock')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDetail()
    return () => {
      cancelled = true
    }
  }, [open, isReady, variantId, warehouseOrgId, supabase])

  const formatNumber = (value?: number | null) =>
    new Intl.NumberFormat('en-MY').format(value ?? 0)

  const formatDate = (value?: string | null) => {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB')
  }

  const orderStatusBadge = (status: string) => {
    if (status === 'approved') {
      return <Badge variant="outline" className="bg-[var(--sera-orange)]/[0.06] text-[var(--sera-orange-deep)] border-[var(--sera-orange)]/20">Approved</Badge>
    }
    if (status === 'closed') {
      return <Badge variant="outline" className="bg-[var(--sera-ink)]/[0.03] text-[var(--sera-ink)]/80 border-[var(--sera-line)]">Closed (paid)</Badge>
    }
    return <Badge variant="outline">{status}</Badge>
  }

  const manufacturerTotal = orderRows.reduce((sum, row) => sum + (row.incoming_qty || 0), 0)
  const transferTotal = transferRows.reduce((sum, row) => sum + (row.incoming_qty || 0), 0)
  const totalIncoming = manufacturerTotal + transferTotal
  const hasMismatch = orderRows.some(row => row.warehouse_mismatch)

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-[var(--sera-orange)]" />
            Incoming Stock — {formatNumber(totalIncoming)} units
          </DialogTitle>
          <DialogDescription>
            {productName} [{variantName}] — manufacturer {formatNumber(manufacturerTotal)} · transfers {formatNumber(transferTotal)}
          </DialogDescription>
        </DialogHeader>

        {hasMismatch && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              One or more orders declare a different warehouse than the receiving destination.
              Incoming is scoped to where warehouse receiving actually posts stock.
            </span>
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--sera-muted)]">Loading incoming stock...</p>
        ) : loadError ? (
          <p className="py-8 text-center text-sm text-red-600">{loadError}</p>
        ) : totalIncoming === 0 && orderRows.length === 0 && transferRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--sera-muted)]">No incoming stock for this variant.</p>
        ) : (
          <div className="max-h-[480px] space-y-6 overflow-y-auto">
            {/* Manufacturer Orders */}
            <section aria-label="Manufacturer orders">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--sera-ink)]">
                  <Factory className="h-4 w-4 text-[var(--sera-orange)]" />
                  Manufacturer Orders
                </h3>
                <span className="text-xs text-[var(--sera-muted)]">
                  Subtotal: <span className="font-semibold text-[var(--sera-orange-deep)]">{formatNumber(manufacturerTotal)}</span> units
                </span>
              </div>
              {orderRows.length === 0 ? (
                <p className="rounded-md bg-[var(--sera-ink)]/[0.03] px-3 py-3 text-xs text-[var(--sera-muted)]/80">
                  No open manufacturer orders for this variant.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order No.</TableHead>
                      <TableHead>Manufacturer</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orderRows.map(row => (
                      <TableRow key={`${row.order_id}-${row.variant_id}`}>
                        <TableCell>
                          <Link
                            href={`/supply-chain?view=view-order&orderId=${row.order_id}`}
                            onClick={onClose}
                            className={LINK_CLASSES}
                            title={`Open order ${row.display_doc_no || row.order_no}`}
                          >
                            {row.display_doc_no || row.order_no}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">{row.manufacturer_name || '—'}</TableCell>
                        <TableCell className="text-xs text-right">{formatNumber(row.ordered_qty)}</TableCell>
                        <TableCell className="text-xs text-right">{formatNumber(row.received_qty)}</TableCell>
                        <TableCell className="text-xs text-right font-semibold text-[var(--sera-orange-deep)]">
                          {formatNumber(row.incoming_qty)}
                        </TableCell>
                        <TableCell>{orderStatusBadge(row.order_status)}</TableCell>
                        <TableCell className="text-xs text-[var(--sera-muted)]">{formatQrStage(row.qr_stage)}</TableCell>
                        <TableCell className="text-xs text-[var(--sera-muted)]">{formatDate(row.approved_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>

            {/* Warehouse Transfers */}
            <section aria-label="Warehouse transfers">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--sera-ink)]">
                  <ArrowRightLeft className="h-4 w-4 text-purple-600" />
                  Warehouse Transfers
                </h3>
                <span className="text-xs text-[var(--sera-muted)]">
                  Subtotal: <span className="font-semibold text-purple-700">{formatNumber(transferTotal)}</span> units
                </span>
              </div>
              {transferRows.length === 0 ? (
                <p className="rounded-md bg-[var(--sera-ink)]/[0.03] px-3 py-3 text-xs text-[var(--sera-muted)]/80">
                  No in-transit transfers for this variant.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transfer No.</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">In Transit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Dispatched</TableHead>
                      <TableHead>Received</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transferRows.map(row => (
                      <TableRow key={`${row.transfer_id}-${row.variant_id}`}>
                        <TableCell>
                          <Link
                            href={`/dashboard?view=stock-movements&id=${encodeURIComponent(row.transfer_no)}`}
                            onClick={onClose}
                            className={LINK_CLASSES}
                            title={`View movements for transfer ${row.transfer_no}`}
                          >
                            {row.transfer_no}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">{row.source_warehouse_name || '—'}</TableCell>
                        <TableCell className="text-xs">{row.destination_warehouse_name || '—'}</TableCell>
                        <TableCell className="text-xs text-right font-semibold text-purple-700">
                          {formatNumber(row.incoming_qty)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            In Transit
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-[var(--sera-muted)]">{formatDate(row.dispatched_at)}</TableCell>
                        <TableCell className="text-xs text-[var(--sera-muted)]">{formatDate(row.received_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
