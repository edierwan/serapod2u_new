'use client'

import { useState } from 'react'
import type { MatchableVariant, PasteMatchResult } from '@/components/orders/quick-order-matcher'
import { isSerappReviewLine } from '@/lib/serapp/line-resolutions'

interface CatalogHit {
  id: string
  product_name: string
  variant_name: string
  available_qty?: number
}

interface Props {
  result: PasteMatchResult
  disabled?: boolean
  distributorId?: string
  fulfillmentWarehouseId?: string
  onPick: (line: number, variantId: string) => void
}

function displayName(variant: { product_name: string; variant_name: string }) {
  const flavour = variant.variant_name.match(/\[\s*([^\[\]]+?)\s*\]/)
  const label = flavour ? `[ ${flavour[1].trim()} ]` : variant.variant_name
  return `${variant.product_name} · ${label}`
}

export default function SerappReviewLinePicker({
  result,
  disabled,
  distributorId,
  fulfillmentWarehouseId,
  onPick,
}: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CatalogHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  if (!isSerappReviewLine(result.status) || result.selectedVariantId) return null

  const candidates = result.candidates.slice(0, 8)
  const needsSearch = result.status === 'not_found' || candidates.length === 0

  const runSearch = async () => {
    const needle = query.trim()
    if (needle.length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch('/api/serapp/catalog-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: needle,
          distributorId: distributorId || undefined,
          fulfillmentWarehouseId: fulfillmentWarehouseId || undefined,
          sectionProductLine: result.sectionProductLine || undefined,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Search failed.')
      setHits((payload?.variants || []) as CatalogHit[])
    } catch (err) {
      setHits([])
      setSearchError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {candidates.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-[var(--sera-muted)]">
            Pick the real item from the catalog
          </p>
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
      )}

      {needsSearch && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-[var(--sera-muted)]">
            This name is not in the catalog. Search the real item.
          </p>
          <div className="flex gap-2">
            <input
              value={query}
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void runSearch()
                }
              }}
              placeholder="Search catalog…"
              className="h-9 flex-1 rounded-xl border border-[var(--sera-line)] bg-white px-3 text-xs outline-none focus:border-[var(--sera-orange)]"
            />
            <button
              type="button"
              disabled={disabled || searching || query.trim().length < 2}
              onClick={() => void runSearch()}
              className="h-9 rounded-xl bg-[var(--sera-ink)] px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {searching ? '…' : 'Search'}
            </button>
          </div>
          {searchError && <p className="text-[11px] text-[var(--sera-danger)]">{searchError}</p>}
          {hits && hits.length === 0 && !searching && (
            <p className="text-[11px] text-[var(--sera-muted)]">No catalog match.</p>
          )}
          {hits?.map((hit) => (
            <button
              key={hit.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(result.line, hit.id)}
              className="block w-full rounded-xl border border-[var(--sera-line)] bg-white px-3 py-2 text-left text-xs hover:border-[var(--sera-orange)] disabled:opacity-50"
            >
              <span className="block font-semibold text-[var(--sera-ink)]">{displayName(hit)}</span>
              {typeof hit.available_qty === 'number' && (
                <span className="text-[var(--sera-muted)]">{hit.available_qty.toLocaleString()} available</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
