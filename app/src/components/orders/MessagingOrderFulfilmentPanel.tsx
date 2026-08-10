'use client'

import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'

interface FulfilmentLine {
  order_item_id: string
  variant_name: string
  ordered: number
  reserved: number
  prepared: number | null
  shipped: number | null
  received: number | null
}

interface FulfilmentMeta {
  status?: string
  receipt_status?: string | null
  delivery_method?: string | null
  delivery_reference?: string | null
  do_number?: string | null
}

function cell(value: number | null | undefined): string {
  if (value == null) return '—'
  return String(value)
}

/** §54 — Ordered / Reserved / Prepared / Shipped / Received for messaging orders. */
export function MessagingOrderFulfilmentPanel({ orderId }: { orderId: string }) {
  const [lines, setLines] = useState<FulfilmentLine[]>([])
  const [meta, setMeta] = useState<FulfilmentMeta | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/messaging/fulfilment-items?orderId=${encodeURIComponent(orderId)}`)
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.messaging) {
          if (!cancelled) setVisible(false)
          return
        }
        if (!cancelled) {
          setVisible(true)
          setLines(payload.lines || [])
          setMeta(payload.fulfilment || null)
        }
      } catch {
        if (!cancelled) setVisible(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orderId])

  if (!visible) return null

  const first = lines[0] as FulfilmentLine & FulfilmentMeta | undefined

  return (
    <div className="mt-4 rounded-xl border border-[var(--sera-line)] bg-[var(--sera-surface)] p-4 print:hidden">
      <div className="mb-3 flex items-center gap-2">
        <Package className="h-4 w-4 text-[var(--sera-orange)]" />
        <h3 className="text-sm font-semibold text-[var(--sera-ink)]">Messaging fulfilment</h3>
      </div>

      {(meta || first) && (
        <div className="mb-3 grid gap-1 text-xs text-[var(--sera-muted)] md:grid-cols-2">
          {meta?.status && <p>Preparation: {meta.status.replace(/_/g, ' ')}</p>}
          {meta?.receipt_status && <p>Receipt: {meta.receipt_status.replace(/_/g, ' ')}</p>}
          {first?.do_number && <p>DO: {first.do_number}</p>}
          {meta?.delivery_method && (
            <p>
              Delivery: {meta.delivery_method.replace(/_/g, ' ')}
              {meta.delivery_reference ? ` · ${meta.delivery_reference}` : ''}
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--sera-line)] text-left text-[var(--sera-muted)]">
              <th className="py-2 pr-3 font-semibold">Product</th>
              <th className="py-2 px-2 text-right font-semibold">Ordered</th>
              <th className="py-2 px-2 text-right font-semibold">Reserved</th>
              <th className="py-2 px-2 text-right font-semibold">Prepared</th>
              <th className="py-2 px-2 text-right font-semibold">Shipped</th>
              <th className="py-2 pl-2 text-right font-semibold">Received</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.order_item_id} className="border-b border-[var(--sera-line)]/60">
                <td className="py-2 pr-3 text-[var(--sera-ink)]">{line.variant_name}</td>
                <td className="py-2 px-2 text-right">{cell(line.ordered)}</td>
                <td className="py-2 px-2 text-right">{cell(line.reserved)}</td>
                <td className="py-2 px-2 text-right">{cell(line.prepared)}</td>
                <td className="py-2 px-2 text-right">{cell(line.shipped)}</td>
                <td className="py-2 pl-2 text-right">{cell(line.received)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
