'use client'

import { useMemo, useState } from 'react'
import { Check, ClipboardCopy, ClipboardPaste, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { variantAlternativeLabel, variantIdentityLabel } from '@/lib/inventory/variant-display-label'
import { AVAILABLE_MARK, UNAVAILABLE_MARK, buildPasteResultText } from '@/lib/orders/paste-order-result-text'
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
  inventory_classification?: 'classified' | 'unclassified'
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

const statusStyle = (status: PasteMatchResult['status']) => ({
  matched: 'bg-green-100 text-green-700',
  alternative_match: 'bg-cyan-100 text-cyan-800',
  smart_match: 'bg-emerald-100 text-emerald-800',
  suggestion: 'bg-purple-100 text-purple-800',
  ambiguous: 'bg-amber-100 text-amber-800',
  not_found: 'bg-red-100 text-red-700',
  invalid_quantity: 'bg-red-100 text-red-700',
  duplicate: 'bg-blue-100 text-blue-700',
}[status])

const pasteResultDisplay = (result: PasteMatchResult, variants: QuickVariant[]) => {
  if (result.status === 'invalid_quantity') return { label: 'Invalid Quantity', style: statusStyle(result.status) }
  if (result.status === 'duplicate') return { label: 'Duplicate', style: statusStyle(result.status) }
  if (!result.selectedVariantId && result.candidates.length > 1) return { label: 'Multiple Matches — Selection Required', style: statusStyle('ambiguous') }
  if (!result.selectedVariantId && result.candidates.length === 1) return { label: 'Possible Match — Review Required', style: statusStyle('suggestion') }
  const selected = variants.find(variant => variant.id === result.selectedVariantId)
  const outcome = resolvePasteInventoryOutcome(result.quantity, selected)
  if (outcome === 'inventory_unclassified') return { label: 'Matched — Inventory Unclassified', style: 'bg-amber-100 text-amber-800' }
  if (outcome === 'no_available_stock') return { label: 'Matched — No Available Stock', style: 'bg-red-100 text-red-700' }
  if (outcome === 'insufficient_stock') return { label: 'Matched — Insufficient Stock', style: 'bg-red-100 text-red-700' }
  if (outcome === 'matched') return { label: 'Matched', style: 'bg-green-100 text-green-700' }
  return { label: 'Product Not Found', style: statusStyle('not_found') }
}

/**
 * Whether the line can actually be ordered as reviewed. Drives both the ✅/❌
 * in the Result column and the mark in the copied WhatsApp reply, so the two
 * can never disagree.
 */
const isPasteResultBlocked = (
  result: PasteMatchResult,
  variants: QuickVariant[],
  combineDuplicates: boolean,
) => {
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
  const identity = variantIdentityLabel(variant.variant_name, variant.variant_product_code)
  const alternative = variantAlternativeLabel(variant.alternative_name)
  return (
    <>
      <span className="block font-medium text-gray-900">
        {withProduct ? `${variant.product_name} - ${identity}` : identity}
      </span>
      {alternative && <span className="block text-xs font-normal text-[var(--sera-muted)]">{alternative}</span>}
    </>
  )
}

const CandidateCard = ({ variant, onSelect }: { variant: QuickVariant; onSelect?: () => void }) => {
  const content = (
    <>
      <VariantIdentity variant={variant} withProduct />
      <span className="block text-[var(--sera-muted)]">{variant.available_qty.toLocaleString()} available</span>
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
      window.setTimeout(() => setResultCopied(false), 2000)
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
  }

  const handleQuantity = (variant: QuickVariant, rawValue: string) => {
    const quantity = rawValue === '' ? 0 : Math.max(0, Math.trunc(Number(rawValue) || 0))
    onQuantityChange(variant.id, quantity)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto border-b pb-2" role="tablist" aria-label="Product groups">
        {groups.map(group => {
          const count = group === 'All' ? variants.length : variants.filter(variant => (variant.group_name || 'Other') === group).length
          return (
            <button key={group} type="button" role="tab" aria-selected={activeGroup === group} onClick={() => setActiveGroup(group)}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${activeGroup === group ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-300' : 'text-[var(--sera-muted)] hover:bg-gray-50'}`}>
              {group} ({count})
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="Search flavour, product or Product Code" />
        </div>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm"><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} /> Show selected only</label>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm"><input type="checkbox" checked={availableOnly} onChange={event => setAvailableOnly(event.target.checked)} /> Available only</label>
        <Button type="button" variant="outline" onClick={() => setPasteOpen(true)}><ClipboardPaste className="mr-2 h-4 w-4" />Paste Order List</Button>
        <Button type="button" variant="ghost" onClick={onClear} disabled={selected.length === 0}><Trash2 className="mr-2 h-4 w-4" />Clear</Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-50 text-left text-[var(--sera-muted)]">
            <tr>{['Flavour', 'Product', 'Available', 'Order Qty (Cases)', 'Unit Price (RM)', 'Line Total (RM)', 'Status'].map(label => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr>
          </thead>
          <tbody>
            {visibleVariants.map((variant, index) => {
              const quantity = quantities.get(variant.id) || 0
              const insufficient = quantity > variant.available_qty
              const unclassified = variant.inventory_classification === 'unclassified'
              return (
                <tr key={variant.id} className={quantity > 0 ? 'border-t bg-orange-50/50' : 'border-t'}>
                  <td className="px-3 py-2"><VariantIdentity variant={variant} /></td>
                  <td className="px-3 py-2">{productShortNames.get(variant.product_name) || variant.product_name}</td>
                  <td className="px-3 py-2 tabular-nums">{variant.available_qty.toLocaleString()}</td>
                  <td className="px-3 py-2"><Input data-quick-qty={index} type="number" inputMode="numeric" min={0} max={variant.available_qty} value={quantity || ''} onChange={event => handleQuantity(variant, event.target.value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); document.querySelector<HTMLInputElement>(`[data-quick-qty=\"${index + 1}\"]`)?.focus() } }} className="w-28" aria-label={`Order quantity for ${variant.variant_name}`} /></td>
                  <td className="px-3 py-2 tabular-nums">{formatCurrency(variant.distributor_price)}</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{formatCurrency(quantity * variant.distributor_price)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${unclassified ? 'bg-amber-100 text-amber-800' : insufficient || variant.available_qty === 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{unclassified ? 'Inventory Unclassified' : insufficient ? 'Insufficient stock' : variant.available_qty === 0 ? 'No Available Stock' : 'Available'}</span></td>
                </tr>
              )
            })}
            {visibleVariants.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-[var(--sera-muted)]">No variants match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-gray-50 px-4 py-3 text-sm">
        <strong>{selected.length} flavours · {totalUnits.toLocaleString()} units</strong>
        <strong>Total: RM {formatCurrency(totalAmount)}</strong>
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
                  const mark = isPasteResultBlocked(result, variants, combineDuplicates) ? UNAVAILABLE_MARK : AVAILABLE_MARK
                  return (
                    <tr key={result.line} className="border-b align-top">
                      <td className="p-2">{result.line}</td>
                      <td className="p-2"><div>{result.name}</div><div className="text-xs text-[var(--sera-muted)]">Original: {stripStatusMarkers(result.raw)}</div></td>
                      <td className="p-2">{result.quantity ?? 'Invalid'}</td>
                      <td className="p-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${display.style}`}>
                          <span aria-hidden="true">{mark}</span>{display.label}
                        </span>
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
        </DialogContent>
      </Dialog>
    </div>
  )
}
