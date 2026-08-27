'use client'

import type { MatchableVariant, PasteMatchResult } from '@/components/orders/quick-order-matcher'
import { isSerappReviewLine } from '@/lib/serapp/line-resolutions'

interface Props {
  result: PasteMatchResult
  disabled?: boolean
  onPick: (line: number, variantId: string) => void
}

function displayName(variant: { product_name: string; variant_name: string }) {
  const flavour = variant.variant_name.match(/\[\s*([^\[\]]+?)\s*\]/)
  const label = flavour ? `[ ${flavour[1].trim()} ]` : variant.variant_name
  return `${variant.product_name} · ${label}`
}

/**
 * Unmatched-line picker — mirrors Quick Order paste review:
 * show matcher candidates only; no per-line catalog search field.
 */
export default function SerappReviewLinePicker({
  result,
  disabled,
  onPick,
}: Props) {
  if (!isSerappReviewLine(result.status) || result.selectedVariantId) return null

  const candidates = result.candidates.slice(0, 8)

  if (candidates.length === 0) {
    if (result.status === 'not_found') {
      return (
        <p className="mt-1 text-[11px] text-[var(--sera-muted)]">
          Product Not Found
        </p>
      )
    }
    return null
  }

  const heading = candidates.length > 1
    ? `Tap to match "${result.name || result.raw}":`
    : 'Tap to confirm match:'

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[11px] font-medium text-[var(--sera-muted)]">{heading}</p>
      {candidates.map((candidate: MatchableVariant) => (
        <button
          key={candidate.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(result.line, candidate.id)}
          className="block w-full rounded-xl border border-[var(--sera-line)] bg-white px-3 py-2 text-left text-xs hover:border-[var(--sera-orange)] disabled:opacity-50"
        >
          <span className="block font-semibold text-[var(--sera-ink)]">
            {displayName(candidate)}
          </span>
          {typeof candidate.available_qty === 'number' && (
            <span className="text-[var(--sera-muted)]">
              {candidate.available_qty.toLocaleString()} available
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
