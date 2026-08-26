'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Package, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSerapp } from './SerappContext'
import { SerappHqDistributorPicker, useSerappHqDistributors } from './SerappHqDistributorPicker'

interface CatalogVariant {
  id: string
  product_name: string
  variant_name: string
  product_code: string
  available_qty?: number | null
  inventory_classification?: string | null
}

function stockMeta(variant: CatalogVariant) {
  const qty = typeof variant.available_qty === 'number' ? variant.available_qty : null
  if (qty === null) {
    return { label: 'Unknown', className: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)]' }
  }
  if (qty <= 0) {
    return { label: 'Out of stock', className: 'bg-[var(--sera-danger-soft)] text-[var(--sera-danger)]' }
  }
  return { label: `${qty} available`, className: 'bg-[var(--sera-success-soft)] text-[var(--sera-success)]' }
}

async function resolveAssistantChatHref(draft: string): Promise<string> {
  const encoded = encodeURIComponent(draft)
  try {
    const res = await fetch('/api/serapp/conversations')
    const payload = await res.json().catch(() => null)
    if (res.ok) {
      const list = (payload?.conversations || []) as Array<{ id: string; kind: string }>
      const assistant = list.find((chat) => chat.kind === 'assistant')
      if (assistant?.id) {
        return `/serapp/conversation/${assistant.id}?draft=${encoded}`
      }
    }
  } catch {
    // fall through
  }
  return `/serapp/conversation?draft=${encoded}`
}

export default function SerappOrderView() {
  const router = useRouter()
  const { isHqSupport } = useSerapp()
  const hq = useSerappHqDistributors()

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<CatalogVariant[]>([])
  const [searching, setSearching] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CatalogVariant | null>(null)
  const [qty, setQty] = useState('50')
  const [openingChat, setOpeningChat] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestRef = useRef(0)

  const hasDistributor = !isHqSupport || Boolean(hq.selectedId)

  const rememberProduct = useCallback((variant: CatalogVariant) => {
    setSelected(variant)
    setQty('50')
    setQuery('')
    setSuggestions([])
    setShowSuggest(false)
    setActiveIndex(0)
  }, [])

  const runSearch = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (trimmed.length < 1) {
      setSuggestions([])
      setSearching(false)
      return
    }
    if (!hasDistributor) {
      setSuggestions([])
      setSearching(false)
      setError('Select distributor first (HQ Support).')
      return
    }

    const requestId = ++requestRef.current
    setSearching(true)
    setError(null)
    try {
      const res = await fetch('/api/serapp/catalog-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: trimmed,
          distributorId: hq.selectedId || undefined,
          limit: 12,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Search failed.')
      if (requestId !== requestRef.current) return
      setSuggestions(Array.isArray(payload?.variants) ? payload.variants as CatalogVariant[] : [])
      setActiveIndex(0)
    } catch (err) {
      if (requestId !== requestRef.current) return
      setSuggestions([])
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      if (requestId === requestRef.current) setSearching(false)
    }
  }, [hasDistributor, hq.selectedId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 1) {
      setSuggestions([])
      setSearching(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query)
    }, 120)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  const pickActive = () => {
    const hit = suggestions[activeIndex] || suggestions[0]
    if (hit) rememberProduct(hit)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1))
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      pickActive()
      return
    }
    if (event.key === 'Escape') {
      setShowSuggest(false)
    }
  }

  const sendInChat = async () => {
    if (!selected) return
    const qtyNum = Number(qty)
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Enter a quantity greater than 0.')
      return
    }
    const draft = `${selected.product_code} - ${Math.floor(qtyNum)}`
    setOpeningChat(true)
    setError(null)
    try {
      const href = await resolveAssistantChatHref(draft)
      router.push(href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open chat.')
      setOpeningChat(false)
    }
  }

  const showDropdown = showSuggest && query.trim().length > 0
  const stock = selected ? stockMeta(selected) : null

  return (
    <div className="flex min-h-full flex-col px-4 py-4">
      <div className="mb-3">
        <p className="font-display text-base font-semibold text-[var(--sera-ink)]">Check stock</p>
        <p className="text-xs text-[var(--sera-muted)]">Search a product, then send it in Chat.</p>
      </div>

      {isHqSupport && (
        <div className="mb-3">
          <SerappHqDistributorPicker
            selectedId={hq.selectedId}
            distributors={hq.distributors}
            loading={hq.loading}
            disabled={searching || openingChat}
            onChange={hq.selectDistributor}
          />
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sera-muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setShowSuggest(true)
          }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => window.setTimeout(() => setShowSuggest(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="Search code or name (CV, ALMOND…)"
          className="w-full rounded-xl border border-[var(--sera-line)] bg-white py-3 pl-10 pr-10 text-sm text-[var(--sera-ink)] outline-none focus:border-[var(--sera-orange)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setSuggestions([])
              setShowSuggest(false)
              inputRef.current?.focus()
            }}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--sera-muted)] hover:bg-[var(--sera-mist)]"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {searching && (
          <Loader2 className="pointer-events-none absolute right-10 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--sera-muted)]" />
        )}

        {showDropdown && (
          <div className="serapp-wa-suggest absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-[var(--sera-line)] bg-white shadow-lg">
            {suggestions.length === 0 && !searching && (
              <p className="px-3 py-3 text-xs text-[var(--sera-muted)]">No matching products.</p>
            )}
            {suggestions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => rememberProduct(item)}
                className={cn(
                  'flex w-full items-start justify-between gap-3 border-b border-[var(--sera-line)]/70 px-3 py-2.5 text-left last:border-b-0',
                  index === activeIndex ? 'bg-[var(--sera-orange)]/5' : 'hover:bg-[var(--sera-surface)]',
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--sera-ink)]">{item.product_name}</p>
                  <p className="truncate text-xs text-[var(--sera-muted)]">{item.variant_name}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--sera-ink-soft)]">Code: {item.product_code}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', stockMeta(item).className)}>
                  {stockMeta(item).label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-[var(--sera-danger)]/20 bg-[var(--sera-danger-soft)] px-3 py-2 text-xs text-[var(--sera-danger)]">
          {error}
        </div>
      )}

      {selected && stock && (
        <div className="serapp-card mt-4 rounded-2xl p-4">
          <p className="text-base font-semibold text-[var(--sera-ink)]">{selected.product_name}</p>
          <p className="text-sm text-[var(--sera-muted)]">{selected.variant_name}</p>
          <p className="mt-2 text-sm text-[var(--sera-ink-soft)]">
            <span className="font-semibold">{selected.product_code}</span>
            {' · '}
            <span className={cn('font-semibold', stock.className.includes('danger') ? 'text-[var(--sera-danger)]' : 'text-[var(--sera-success)]')}>
              {stock.label}
            </span>
          </p>

          <label className="mt-3 block text-xs font-semibold text-[var(--sera-muted)]">
            Quantity
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--sera-line)] bg-white px-3 py-2.5 text-sm text-[var(--sera-ink)] outline-none focus:border-[var(--sera-orange)]"
            />
          </label>

          <button
            type="button"
            disabled={openingChat}
            onClick={() => void sendInChat()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sera-orange)] px-3 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {openingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send in Chat
          </button>
          <p className="mt-2 text-center text-[11px] text-[var(--sera-muted)]">
            Opens Chat with: <span className="font-semibold text-[var(--sera-ink)]">{selected.product_code} - {qty || '…'}</span>
          </p>
        </div>
      )}

      {!selected && !query && (
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--sera-line)] bg-[var(--sera-surface)]/60 px-4 py-8 text-center">
          <Package className="mx-auto h-8 w-8 text-[var(--sera-muted)]" />
          <p className="mt-2 text-sm font-medium text-[var(--sera-ink)]">Search a product</p>
          <p className="mt-1 text-xs text-[var(--sera-muted)]">Then send it to Chat with quantity.</p>
        </div>
      )}
    </div>
  )
}
