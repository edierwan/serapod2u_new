'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

interface TimelineEvent {
  id: string
  action: string
  previous_status: string | null
  new_status: string | null
  actor_channel: string | null
  created_at: string
  metadata?: Record<string, unknown> | null
}

interface DiscrepancyItem {
  id: string
  issue_type: string
  shipped_quantity: number
  received_quantity: number
  difference_quantity: number
  remarks: string | null
}

interface DiscrepancyRow {
  id: string
  status: string
  remarks: string | null
  reported_at: string
  resolution: string | null
  messaging_delivery_discrepancy_items?: DiscrepancyItem[]
}

function labelAction(action: string): string {
  return action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

/** Additive timeline for messaging (telegram/whatsapp) orders only. */
export function MessagingOrderTimelinePanel({ orderId }: { orderId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyRow[]>([])
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/messaging/timeline?orderId=${encodeURIComponent(orderId)}`)
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error || 'Unable to load timeline.')
        if (cancelled) return
        setVisible(Boolean(payload?.messaging))
        setEvents(payload?.events || [])
        setDiscrepancies(payload?.discrepancies || [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load timeline.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orderId])

  if (!visible && !error) return null

  return (
    <div className="mt-4 rounded-xl border border-[var(--sera-line)] bg-[var(--sera-surface)] p-4 print:hidden">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-[var(--sera-orange)]" />
        <h3 className="text-sm font-semibold text-[var(--sera-ink)]">Messaging timeline</h3>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && events.length === 0 && (
        <p className="text-sm text-[var(--sera-muted)]">No messaging events yet.</p>
      )}
      <ol className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="border-l-2 border-[var(--sera-orange)]/40 pl-3 text-sm">
            <p className="font-medium text-[var(--sera-ink)]">{labelAction(event.action)}</p>
            <p className="text-xs text-[var(--sera-muted)]">
              {new Date(event.created_at).toLocaleString()}
              {event.actor_channel ? ` · ${event.actor_channel}` : ''}
              {event.previous_status || event.new_status
                ? ` · ${event.previous_status || '—'} → ${event.new_status || '—'}`
                : ''}
            </p>
          </li>
        ))}
      </ol>

      {discrepancies.length > 0 && (
        <div className="mt-4 border-t border-[var(--sera-line)] pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
            Delivery discrepancies
          </p>
          {discrepancies.map((disc) => (
            <div key={disc.id} className="mb-3 rounded-lg border border-[var(--sera-line)] p-3 text-sm">
              <p className="font-medium capitalize">{disc.status.replace(/_/g, ' ')}</p>
              {disc.remarks && <p className="mt-1 text-[var(--sera-muted)]">{disc.remarks}</p>}
              {(disc.messaging_delivery_discrepancy_items || []).map((item) => (
                <p key={item.id} className="mt-1 text-xs text-[var(--sera-ink)]">
                  {item.issue_type.replace(/_/g, ' ')}: shipped {item.shipped_quantity} → received{' '}
                  {item.received_quantity}
                  {item.remarks ? ` · ${item.remarks}` : ''}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
