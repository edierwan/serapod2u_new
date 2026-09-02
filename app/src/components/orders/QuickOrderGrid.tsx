'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, CheckSquare, ClipboardCopy, ClipboardPaste, Copy, HelpCircle, ListTree, Package, Search, Trash2, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { variantAlternativeLabel, variantFlavourName, variantIdentityLabel, productVariantIdentityLabel } from '@/lib/inventory/variant-display-label'
import { groupDisplayName } from '@/lib/orders/group-display-name'
import { buildPasteResultText } from '@/lib/orders/paste-order-result-text'
import { resolveProductShortNames } from '@/lib/orders/product-short-name'
import { matchPastedOrder, PasteMatchResult, resolvePasteInventoryOutcome, stripStatusMarkers } from './quick-order-matcher'

interface QuickVariant {
  id: string
  product_id: string
  product_name: string
  product_code: string
  variant_product_code?: string | null
  group_name?: string
  variant_name: string
  alternative_name?: string | null
  manufacturer_sku?: string | null
  distributor_price: number
  available_qty: number
  on_hand_qty?: number
  reserved_qty?: number
  inventory_classification?: 'classified' | 'unclassified'
  pricing_status?: 'priced' | 'price_missing'
}

interface QuickItem {
  variant_id: string
  qty: number
}

interface QuickOrderGridProps {
  variants: QuickVariant[]
  items: QuickItem[]
  formatCurrency: (amount: number) => string
  onQuantityChange: (variantId: string, quantity: number) => void
  onClear: () => void
}

/**
 * The one status vocabulary Quick Order speaks — used by the catalog rows and
 * by the paste review's Result column, so an outcome looks and reads the same
 * wherever it appears. Each entry is a small icon plus a short word; no badges.
 */
const STATUS = {
  available: { label: 'Available', className: 'text-green-600', Icon: CheckCircle2 },
  unclassified: { label: 'Unclassified', className: 'text-amber-700', Icon: AlertTriangle },
  priceNotSet: { label: 'Price Not Set', className: 'text-amber-700', Icon: AlertTriangle },
  noStock: { label: 'No stock', className: 'text-red-600', Icon: XCircle },
  insufficient: { label: 'Insufficient', className: 'text-red-600', Icon: AlertTriangle },
  // Paste-review-only outcomes: no variant was resolved yet, so they have no
  // catalog-row equivalent.
  selectMatch: { label: 'Multiple Matches — Selection Required', className: 'text-amber-700', Icon: HelpCircle },
  reviewMatch: { label: 'Possible Match — Review Required', className: 'text-amber-700', Icon: HelpCircle },
  notFound: { label: 'Product Not Found', className: 'text-red-600', Icon: XCircle },
  duplicate: { label: 'Duplicate', className: 'text-blue-700', Icon: Copy },
  invalidQuantity: { label: 'Invalid Quantity', className: 'text-red-600', Icon: XCircle },
  // Paste sections (staging): a header line naming a product family, and a
  // header that also carries a quantity, which needs a human decision.
  sectionHeader: { label: 'Section', className: 'text-slate-600', Icon: ListTree },
  requiresReview: { label: 'Requires Review — Section Title With Quantity', className: 'text-amber-700', Icon: HelpCircle },
} as const

// The label is widened to a plain string so a section header can name the
// product line it opened while still rendering through StatusMark.
type StatusDescriptor = { label: string; className: string; Icon: (typeof STATUS)[keyof typeof STATUS]['Icon'] }

const StatusMark = ({ status }: { status: StatusDescriptor }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${status.className}`}>
    <status.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{status.label}
  </span>
)

const pasteResultDisplay = (result: PasteMatchResult, variants: QuickVariant[]): StatusDescriptor => {
  if (result.status === 'section_header') {
    return { ...STATUS.sectionHeader, label: `Section: ${result.sectionProductLine || result.name}` }
  }
  if (result.status === 'requires_review') return STATUS.requiresReview
  if (result.status === 'invalid_quantity') return STATUS.invalidQuantity
  if (result.status === 'duplicate') return STATUS.duplicate
  if (!result.selectedVariantId && result.candidates.length > 1) return STATUS.selectMatch
  if (!result.selectedVariantId && result.candidates.length === 1) return STATUS.reviewMatch
  const selected = variants.find(variant => variant.id === result.selectedVariantId)
  const outcome = resolvePasteInventoryOutcome(result.quantity, selected)
  if (outcome === 'price_not_set') return STATUS.priceNotSet
  if (outcome === 'inventory_unclassified') return STATUS.unclassified
  if (outcome === 'no_available_stock') return STATUS.noStock
  if (outcome === 'insufficient_stock') return STATUS.insufficient
  if (outcome === 'matched') return STATUS.available
  return STATUS.notFound
}

/**
 * Whether the line can actually be ordered as reviewed. Drives both the Result
 * status and the ✅/❌ in the copied WhatsApp reply, so the two can never
 * disagree: a line reads "Available" exactly when the reply marks it ✅.
 */
const isPasteResultBlocked = (
  result: PasteMatchResult,
  variants: QuickVariant[],
  combineDuplicates: boolean,
) => {
  // Section headers are informational only — they never block Apply.
  if (result.status === 'section_header') return false
  if (result.status === 'requires_review') return true
  if (result.status === 'invalid_quantity') return true
  if (result.status === 'duplicate' && !combineDuplicates) return true
  const selected = variants.find(variant => variant.id === result.selectedVariantId)
  if (!selected) return true
  return resolvePasteInventoryOutcome(result.quantity, selected) !== 'matched'
}

/**
 * Master-data identity for a catalog row: the bracketed flavour plus the
 * variant Product Code, with the distributor-facing Alternative Name beneath
 * it — the same two lines View Inventory and Product Management > Variants
 * show, so operators read one identity everywhere.
 */
const VariantIdentity = ({ variant, withProduct = false }: { variant: QuickVariant; withProduct?: boolean }) => {
  // With the Product folded in this is the full agreed identity
  // ("Cellera Hero / Strawberry Corn – SC"); without it, only the variant half,
  // because the Product already leads the row.
  const identity = withProduct
    ? productVariantIdentityLabel(variant.product_name, variant.variant_name, variant.variant_product_code)
    : variantIdentityLabel(variant.variant_name, variant.variant_product_code)
  const alternative = variantAlternativeLabel(variant.alternative_name)
  return (
    <>
      <span className="block font-medium text-gray-900">
        {identity}
      </span>
      {alternative && <span className="block text-xs font-normal text-[var(--sera-muted)]">{alternative}</span>}
    </>
  )
}

/**
 * Catalog-row identity, condensed into the single Product column: the flavour
 * with its variant Product Code beside it, and beneath it the group-relative
 * product label in caps ("HERO", "ZERO") followed by the Alternative Name when
 * master data carries one. Same master-data fields as {@link VariantIdentity} —
 * the paste review keeps the bracketed form, where rows are read one at a time.
 */
const ProductCell = ({ variant, productLabel }: { variant: QuickVariant; productLabel: string }) => {
  const alternative = (variant.alternative_name || '').trim()
  return (
    <>
      <span className="block font-semibold text-gray-900">
        {variantFlavourName(variant.variant_name)}
        {variant.variant_product_code && (
          <span className="ml-2 text-xs font-normal text-[var(--sera-muted)]">{variant.variant_product_code.trim()}</span>
        )}
      </span>
      <span className="block text-xs text-[var(--sera-muted)]">
        {productLabel.toUpperCase()}{alternative && ` · ${alternative}`}
      </span>
    </>
  )
}

/** Catalog-row outcome, drawn from the same {@link STATUS} vocabulary. */
const rowStatus = (variant: QuickVariant, quantity: number): StatusDescriptor => {
  if (variant.pricing_status === 'price_missing') return STATUS.priceNotSet
  if (variant.inventory_classification === 'unclassified') return STATUS.unclassified
  if (variant.available_qty === 0) return STATUS.noStock
  if (quantity > variant.available_qty) return STATUS.insufficient
  return STATUS.available
}

/**
 * Why availability is lower than the stock View Inventory shows.
 *
 * Submitted D2H/S2D orders hold their quantity against the warehouse until
 * they are approved or cancelled, so a flavour can sit on 10,514 cases and
 * still offer only 54. Stating the shortfall as a bare "54 available" read as
 * a system fault; naming the reserved part points at the queue of submitted
 * orders that actually holds it. Nothing is rendered when nothing is reserved.
 */
const ReservedNote = ({ variant, className = '' }: { variant: QuickVariant; className?: string }) => {
  const reserved = variant.reserved_qty || 0
  if (reserved <= 0) return null
  const onHand = variant.on_hand_qty ?? variant.available_qty + reserved
  return (
    <span className={`block text-[var(--sera-muted)] ${className}`}>
      {onHand.toLocaleString()} on hand · {reserved.toLocaleString()} reserved by submitted orders
    </span>
  )
}

/** Filter toggle rendered as a pressable chip so the filters read as one row. */
const FilterToggle = ({ label, icon: Icon, pressed, onToggle }: { label: string; icon: typeof CheckSquare; pressed: boolean; onToggle: () => void }) => (
  <button type="button" aria-pressed={pressed} onClick={onToggle}
    className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium ${pressed ? 'border-[var(--sera-orange)] bg-[var(--sera-orange)]/[0.08] text-[var(--sera-orange)]' : 'border-gray-300 text-[var(--sera-ink)] hover:bg-gray-50'}`}>
    <Icon className="h-4 w-4" />{label}
  </button>
)

/** How long the copied reply stays on screen before dismissing itself. */
const COPY_PREVIEW_MS = 5000

const CandidateCard = ({ variant, onSelect }: { variant: QuickVariant; onSelect?: () => void }) => {
  const content = (
    <>
      <VariantIdentity variant={variant} withProduct />
      <span className="block text-[var(--sera-muted)]">{variant.available_qty.toLocaleString()} available</span>
      <ReservedNote variant={variant} />
      {variant.pricing_status === 'price_missing' && (
        <span className="block text-amber-700">Distributor Price not set in Product Management</span>
      )}
    </>
  )
  return onSelect ? (
    <button type="button" onClick={onSelect} className="block w-full rounded border bg-white px-3 py-2 text-left text-xs hover:border-blue-400 hover:bg-[var(--sera-orange)]/[0.06]">
      {content}
    </button>
  ) : <div className="rounded border bg-[var(--sera-orange)]/[0.06] px-3 py-2 text-xs">{content}</div>
}

export default function QuickOrderGrid({ variants, items, formatCurrency, onQuantityChange, onClear }: QuickOrderGridProps) {
  const [search, setSearch] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [availableOnly, setAvailableOnly] = useState(false)
  const [activeGroup, setActiveGroup] = useState('All')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteResults, setPasteResults] = useState<PasteMatchResult[]>([])
  const [combineDuplicates, setCombineDuplicates] = useState(false)
  const [resultCopied, setResultCopied] = useState(false)
  // Exact text placed on the clipboard, shown back briefly so the operator
  // sees what will land in WhatsApp before switching apps.
  const [copiedPreview, setCopiedPreview] = useState<string | null>(null)
  const previewTimer = useRef<number | null>(null)

  useEffect(() => () => { if (previewTimer.current) window.clearTimeout(previewTimer.current) }, [])

  const quantities = useMemo(() => new Map(items.map(item => [item.variant_id, item.qty])), [items])
  // Group-relative product labels ("Cellera Hero" -> "Hero"). Derived from the
  // whole catalog, not the visible rows, so switching tabs never relabels.
  const productShortNames = useMemo(() => resolveProductShortNames(variants), [variants])
  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    variants.forEach(variant => counts.set(variant.group_name || 'Other', (counts.get(variant.group_name || 'Other') || 0) + 1))
    return ['All', ...Array.from(counts.keys()).sort()]
  }, [variants])

  const visibleVariants = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return variants.filter(variant => {
      const group = variant.group_name || 'Other'
      const haystack = [variant.variant_name, variant.alternative_name, variant.product_name, variant.product_code, variant.variant_product_code, variant.manufacturer_sku].filter(Boolean).join(' ').toLowerCase()
      return (activeGroup === 'All' || group === activeGroup)
        && (!needle || haystack.includes(needle))
        && (!selectedOnly || (quantities.get(variant.id) || 0) > 0)
        && (!availableOnly || variant.available_qty > 0)
    })
  }, [activeGroup, availableOnly, quantities, search, selectedOnly, variants])

  const selected = items.filter(item => item.qty > 0)
  const totalUnits = selected.reduce((sum, item) => sum + item.qty, 0)
  const totalAmount = selected.reduce((sum, item) => {
    const variant = variants.find(candidate => candidate.id === item.variant_id)
    return sum + item.qty * (variant?.distributor_price || 0)
  }, 0)

  const reviewPaste = () => {
    setPasteResults(matchPastedOrder(pasteText, variants))
    setCombineDuplicates(false)
    setResultCopied(false)
  }

  const copyResult = async () => {
    const text = buildPasteResultText(
      pasteResults,
      variants,
      result => !isPasteResultBlocked(result, variants, combineDuplicates),
    )
    try {
      await navigator.clipboard.writeText(text)
      setResultCopied(true)
      setCopiedPreview(text)
      if (previewTimer.current) window.clearTimeout(previewTimer.current)
      previewTimer.current = window.setTimeout(() => {
        setResultCopied(false)
        setCopiedPreview(null)
      }, COPY_PREVIEW_MS)
    } catch {
      // Clipboard access can be denied (insecure origin, permission prompt).
      // Falling back keeps the reply reachable instead of failing silently.
      window.prompt('Copy the reply below and paste it into WhatsApp', text)
    }
  }

  const updateResolution = (line: number, variantId: string) => {
    setPasteResults(results => results.map(result => result.line === line ? { ...result, selectedVariantId: variantId || undefined } : result))
  }

  const resolvedVariantIds = pasteResults.map(result => result.selectedVariantId).filter((id): id is string => Boolean(id))
  const hasResolvedDuplicates = new Set(resolvedVariantIds).size !== resolvedVariantIds.length
  const canApplyPaste = pasteResults.length > 0 && (!hasResolvedDuplicates || combineDuplicates) && pasteResults.every(result => {
    return !isPasteResultBlocked(result, variants, combineDuplicates)
  })

  const applyPaste = () => {
    const additions = new Map<string, number>()
    pasteResults.forEach(result => {
      if (result.selectedVariantId && result.quantity) {
        additions.set(result.selectedVariantId, (additions.get(result.selectedVariantId) || 0) + result.quantity)
      }
    })
    additions.forEach((quantity, variantId) => onQuantityChange(variantId, (quantities.get(variantId) || 0) + quantity))
    setPasteOpen(false)
    setPasteText('')
    setPasteResults([])
    // Land on exactly what was just applied. The group tab and search box are
    // cleared with it, otherwise "Selected" would still hide applied rows that
    // sit in another group or outside the search term.
    setSelectedOnly(true)
    setActiveGroup('All')
    setSearch('')
  }

  const handleQuantity = (variant: QuickVariant, rawValue: string) => {
    // An unpriced variant would price the line at RM 0; the D2H preflight
    // rejects it anyway, so the quantity never becomes enterable here.
    if (variant.pricing_status === 'price_missing') return
    const quantity = rawValue === '' ? 0 : Math.max(0, Math.trunc(Number(rawValue) || 0))
    onQuantityChange(variant.id, quantity)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-6 overflow-x-auto border-b" role="tablist" aria-label="Product groups">
        {groups.map(group => {
          const count = group === 'All' ? variants.length : variants.filter(variant => (variant.group_name || 'Other') === group).length
          return (
            <button key={group} type="button" role="tab" aria-selected={activeGroup === group} onClick={() => setActiveGroup(group)}
              className={`-mb-px whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium ${activeGroup === group ? 'border-[var(--sera-orange)] text-[var(--sera-orange)]' : 'border-transparent text-[var(--sera-muted)] hover:text-[var(--sera-ink)]'}`}>
              {groupDisplayName(group)} <span className="tabular-nums">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="Search flavour, product or Product Code" />
        </div>
        <FilterToggle label="Selected" icon={CheckSquare} pressed={selectedOnly} onToggle={() => setSelectedOnly(value => !value)} />
        <FilterToggle label="In stock" icon={Package} pressed={availableOnly} onToggle={() => setAvailableOnly(value => !value)} />
        <Button type="button" onClick={() => setPasteOpen(true)}><ClipboardPaste className="mr-2 h-4 w-4" />Paste list</Button>
        <Button type="button" variant="outline" size="icon" onClick={onClear} disabled={selected.length === 0} aria-label="Clear all quantities" title="Clear all quantities">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-gray-50 text-left text-[var(--sera-muted)]">
            <tr>
              <th className="px-3 py-3 font-medium">Product</th>
              <th className="px-3 py-3 text-right font-medium">Stock</th>
              <th className="px-3 py-3 font-medium">Qty</th>
              <th className="px-3 py-3 text-right font-medium">Price</th>
              <th className="px-3 py-3 text-right font-medium">Total</th>
              <th className="px-3 py-3 font-medium"><span className="sr-only">Status</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleVariants.map((variant, index) => {
              const quantity = quantities.get(variant.id) || 0
              const status = rowStatus(variant, quantity)
              const unpriced = variant.pricing_status === 'price_missing'
              return (
                <tr key={variant.id} className={quantity > 0 ? 'border-t bg-orange-50/50' : 'border-t'}>
                  <td className="px-3 py-2"><ProductCell variant={variant} productLabel={productShortNames.get(variant.product_name) || variant.product_name} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {variant.available_qty.toLocaleString()}
                    <ReservedNote variant={variant} className="text-[11px] font-normal" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Input data-quick-qty={index} type="number" inputMode="numeric" min={0} max={variant.available_qty} disabled={unpriced} value={quantity || ''} onChange={event => handleQuantity(variant, event.target.value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); document.querySelector<HTMLInputElement>(`[data-quick-qty=\"${index + 1}\"]`)?.focus() } }} className="w-20" aria-label={`Order quantity in cases for ${variant.variant_name}`} />
                      <span className="text-xs text-[var(--sera-muted)]">cases</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{unpriced ? 'Not set' : `RM ${formatCurrency(variant.distributor_price)}`}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{unpriced ? '—' : `RM ${formatCurrency(quantity * variant.distributor_price)}`}</td>
                  <td className="px-3 py-2"><StatusMark status={status} /></td>
                </tr>
              )
            })}
            {visibleVariants.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-[var(--sera-muted)]">No variants match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Kept in view while the operator scrolls a long catalog. */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 text-sm shadow-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <Package className="h-4 w-4 text-[var(--sera-muted)]" aria-hidden="true" />
          {selected.length} items selected
        </span>
        <span className="flex flex-wrap items-center gap-4">
          <span className="tabular-nums text-[var(--sera-muted)]">{totalUnits.toLocaleString()} cases</span>
          <strong className="tabular-nums">RM {formatCurrency(totalAmount)}</strong>
        </span>
      </div>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Paste Order List</DialogTitle><DialogDescription>Paste flavours, Product Codes, or SKUs with quantities. Works with one per line or several on one line (for example a WhatsApp list). Supported separators: dash, colon, tab, or spaces. Status marks like ✅/❌ are treated as separators only.</DialogDescription></DialogHeader>
          {pasteResults.length === 0 ? (
            <textarea autoFocus value={pasteText} onChange={event => setPasteText(event.target.value)} rows={10} className="w-full rounded-md border p-3 font-mono text-sm" placeholder={'LYCHEE BLACKCURRANT - 200\nGUAVA - 300'} />
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Line</th><th className="p-2">Entry</th><th className="p-2"><div>Qty</div><div className="text-[11px] font-normal text-[var(--sera-muted)]">(Cases)</div></th><th className="p-2">Result</th><th className="p-2">Resolve to authorized variant</th></tr></thead><tbody>
                {pasteResults.map(result => {
                  const display = pasteResultDisplay(result, variants)
                  const selectedVariant = variants.find(variant => variant.id === result.selectedVariantId)
                  return (
                    <tr key={result.line} className="border-b align-top">
                      <td className="p-2">{result.line}</td>
                      <td className="p-2"><div>{result.name}</div><div className="text-xs text-[var(--sera-muted)]">Original: {stripStatusMarkers(result.raw)}</div></td>
                      <td className="p-2">{result.quantity ?? 'Invalid'}</td>
                      <td className="p-2">
                        <StatusMark status={display} />
                        {result.duplicateOfLine && <div className="mt-1 text-xs text-[var(--sera-muted)]">Duplicates line {result.duplicateOfLine}</div>}
                      </td>
                      <td className="min-w-[320px] p-2">
                        {selectedVariant && <CandidateCard variant={selectedVariant} />}
                        {!selectedVariant && result.candidates.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-[var(--sera-muted)]">Relevant suggested matches ({Math.min(result.candidates.length, 8)})</div>
                            {result.candidates.slice(0, 8).map(candidate => (
                              <CandidateCard key={candidate.id} variant={candidate as QuickVariant} onSelect={() => updateResolution(result.line, candidate.id)} />
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody></table></div>
              {hasResolvedDuplicates && <label className="flex items-start gap-2 rounded border border-[var(--sera-orange)]/20 bg-[var(--sera-orange)]/[0.06] p-3 text-sm"><input type="checkbox" checked={combineDuplicates} onChange={event => setCombineDuplicates(event.target.checked)} className="mt-1" /><span><strong>Combine duplicate entries.</strong> I confirm quantities resolving to the same variant should be added together.</span></label>}
            </div>
          )}
          <DialogFooter>
            {pasteResults.length > 0 && <Button type="button" variant="outline" onClick={() => setPasteResults([])}>Edit text</Button>}
            {pasteResults.length > 0 && (
              <Button type="button" variant="outline" onClick={copyResult}>
                {resultCopied ? <Check className="mr-2 h-4 w-4" /> : <ClipboardCopy className="mr-2 h-4 w-4" />}
                {resultCopied ? 'Copied' : 'Copy Result'}
              </Button>
            )}
            {pasteResults.length === 0 ? <Button type="button" onClick={reviewPaste} disabled={!pasteText.trim()}>Review matches</Button> : <Button type="button" onClick={applyPaste} disabled={!canApplyPaste}>Apply reviewed quantities</Button>}
          </DialogFooter>

          {/* Sticky, not fixed: the dialog's own transform would anchor a fixed
              child to the dialog box anyway. Dismisses itself; the reply is
              already on the clipboard either way. */}
          {copiedPreview && (
            <div role="status" aria-live="polite"
              className="sticky bottom-0 z-10 mx-auto w-full max-w-md rounded-lg border bg-white p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-green-700">
                  <Check className="h-4 w-4" />Copied — this is what will be pasted
                </span>
                <button type="button" onClick={() => setCopiedPreview(null)} aria-label="Dismiss preview"
                  className="rounded p-1 text-[var(--sera-muted)] hover:bg-gray-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs">{copiedPreview}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
