'use client'

import { useState } from 'react'
import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'
import { cleanSerappLineLabel } from '@/lib/orders/paste-result-display'

interface Props {
  result: PasteMatchResult
  disabled?: boolean
  onSetQty: (line: number, quantity: number) => void
}

export default function SerappMissingQtyPicker({
  result,
  disabled,
  onSetQty,
}: Props) {
  const [qty, setQty] = useState('')
  if (result.status !== 'missing_quantity') return null

  const variant = result.selectedVariantId
    ? result.candidates.find((candidate) => candidate.id === result.selectedVariantId)
    : result.candidates.length === 1
      ? result.candidates[0]
      : undefined

  const label = cleanSerappLineLabel(result.name || result.raw) || 'this item'
  const available = typeof variant?.available_qty === 'number' ? variant.available_qty : null
  const parsedQty = Number(qty)
  const canSubmit = Number.isFinite(parsedQty) && parsedQty > 0
    && (available === null || parsedQty <= available)

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-[var(--sera-muted)]">
        For &quot;{label}&quot;:
      </p>
      {available !== null && (
        <p className="text-[11px] text-[var(--sera-ink-soft)]">
          {available > 0 ? `${available.toLocaleString()} in stock` : 'Out of stock'}
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={available && available > 0 ? available : undefined}
          inputMode="numeric"
          value={qty}
          disabled={disabled || available === 0}
          onChange={(event) => setQty(event.target.value)}
          placeholder="Qty"
          className="min-w-0 flex-1 rounded-xl border border-[var(--sera-line)] bg-white px-3 py-2 text-sm text-[var(--sera-ink)] outline-none focus:border-[var(--sera-orange)]"
        />
        <button
          type="button"
          disabled={disabled || !canSubmit}
          onClick={() => onSetQty(result.line, Math.floor(parsedQty))}
          className="shrink-0 rounded-xl bg-[var(--sera-orange)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
