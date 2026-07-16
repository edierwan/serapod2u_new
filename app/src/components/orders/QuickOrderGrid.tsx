'use client'

import { useMemo, useState } from 'react'
import { ClipboardPaste, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { matchPastedOrder, PasteMatchResult } from './quick-order-matcher'

interface QuickVariant {
  id: string
  product_id: string
  product_name: string
  product_code: string
  group_name?: string
  variant_name: string
  alternative_name?: string | null
  manufacturer_sku?: string | null
  distributor_price: number
  available_qty: number
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

const statusLabel = (status: PasteMatchResult['status']) => status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function QuickOrderGrid({ variants, items, formatCurrency, onQuantityChange, onClear }: QuickOrderGridProps) {
  const [search, setSearch] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [availableOnly, setAvailableOnly] = useState(false)
  const [activeGroup, setActiveGroup] = useState('All')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteResults, setPasteResults] = useState<PasteMatchResult[]>([])
  const [combineDuplicates, setCombineDuplicates] = useState(false)

  const quantities = useMemo(() => new Map(items.map(item => [item.variant_id, item.qty])), [items])
  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    variants.forEach(variant => counts.set(variant.group_name || 'Other', (counts.get(variant.group_name || 'Other') || 0) + 1))
    return ['All', ...Array.from(counts.keys()).sort()]
  }, [variants])

  const visibleVariants = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return variants.filter(variant => {
      const group = variant.group_name || 'Other'
      const haystack = [variant.variant_name, variant.alternative_name, variant.product_name, variant.product_code, variant.manufacturer_sku].filter(Boolean).join(' ').toLowerCase()
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
  }

  const updateResolution = (line: number, variantId: string) => {
    setPasteResults(results => results.map(result => result.line === line ? { ...result, selectedVariantId: variantId || undefined } : result))
  }

  const resolvedVariantIds = pasteResults.map(result => result.selectedVariantId).filter((id): id is string => Boolean(id))
  const hasResolvedDuplicates = new Set(resolvedVariantIds).size !== resolvedVariantIds.length
  const canApplyPaste = pasteResults.length > 0 && (!hasResolvedDuplicates || combineDuplicates) && pasteResults.every(result => {
    if (result.status === 'invalid_quantity') return false
    if (result.status === 'duplicate') return combineDuplicates && Boolean(result.selectedVariantId)
    return Boolean(result.selectedVariantId)
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
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${activeGroup === group ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-300' : 'text-gray-600 hover:bg-gray-50'}`}>
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
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>{['Flavour', 'Product', 'Available', 'Order Qty', 'Unit Price (RM)', 'Line Total (RM)', 'Status'].map(label => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr>
          </thead>
          <tbody>
            {visibleVariants.map((variant, index) => {
              const quantity = quantities.get(variant.id) || 0
              const insufficient = quantity > variant.available_qty
              return (
                <tr key={variant.id} className={quantity > 0 ? 'border-t bg-orange-50/50' : 'border-t'}>
                  <td className="px-3 py-2 font-medium">{variant.variant_name}</td>
                  <td className="px-3 py-2">{variant.product_name}</td>
                  <td className="px-3 py-2 tabular-nums">{variant.available_qty.toLocaleString()}</td>
                  <td className="px-3 py-2"><Input data-quick-qty={index} type="number" inputMode="numeric" min={0} max={variant.available_qty} value={quantity || ''} onChange={event => handleQuantity(variant, event.target.value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); document.querySelector<HTMLInputElement>(`[data-quick-qty=\"${index + 1}\"]`)?.focus() } }} className="w-28" aria-label={`Order quantity for ${variant.variant_name}`} /></td>
                  <td className="px-3 py-2 tabular-nums">{formatCurrency(variant.distributor_price)}</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{formatCurrency(quantity * variant.distributor_price)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${insufficient || variant.available_qty === 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{insufficient ? 'Insufficient stock' : variant.available_qty === 0 ? 'Unavailable' : 'Available'}</span></td>
                </tr>
              )
            })}
            {visibleVariants.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">No variants match these filters.</td></tr>}
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
              <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Line</th><th className="p-2">Entry</th><th className="p-2">Qty</th><th className="p-2">Result</th><th className="p-2">Resolve to authorized variant</th></tr></thead><tbody>
                {pasteResults.map(result => <tr key={result.line} className="border-b align-top"><td className="p-2">{result.line}</td><td className="p-2"><div>{result.name}</div><div className="text-xs text-gray-500">Original: {result.raw}</div></td><td className="p-2">{result.quantity ?? 'Invalid'}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-xs ${statusStyle(result.status)}`}>{statusLabel(result.status)}</span>{result.duplicateOfLine && <div className="mt-1 text-xs text-gray-500">Duplicates line {result.duplicateOfLine}</div>}{result.status === 'suggestion' && <div className="mt-1 text-xs text-purple-700">Choose a suggestion to confirm this typo match.</div>}</td><td className="p-2">
                  <select value={result.selectedVariantId || ''} onChange={event => updateResolution(result.line, event.target.value)} className="w-full rounded border p-2" disabled={result.status === 'invalid_quantity'}><option value="">Select manually…</option>{variants.map(variant => <option key={variant.id} value={variant.id}>{variant.variant_name} — {variant.product_name}</option>)}</select>
                  {result.candidates.length > 0 && !result.selectedVariantId && <div className="mt-2 space-y-1"><div className="text-xs font-medium text-gray-600">{result.status === 'suggestion' ? 'Suggested matches' : 'Possible matches'}</div>{result.candidates.slice(0, 3).map(candidate => <button key={candidate.id} type="button" onClick={() => updateResolution(result.line, candidate.id)} className="block w-full rounded border bg-white px-2 py-1 text-left text-xs hover:border-blue-400 hover:bg-blue-50"><strong>{candidate.variant_name}</strong> — {candidate.product_name}</button>)}</div>}
                </td></tr>)}
              </tbody></table></div>
              {hasResolvedDuplicates && <label className="flex items-start gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm"><input type="checkbox" checked={combineDuplicates} onChange={event => setCombineDuplicates(event.target.checked)} className="mt-1" /><span><strong>Combine duplicate entries.</strong> I confirm quantities resolving to the same variant should be added together.</span></label>}
            </div>
          )}
          <DialogFooter>
            {pasteResults.length > 0 && <Button type="button" variant="outline" onClick={() => setPasteResults([])}>Edit text</Button>}
            {pasteResults.length === 0 ? <Button type="button" onClick={reviewPaste} disabled={!pasteText.trim()}>Review matches</Button> : <Button type="button" onClick={applyPaste} disabled={!canApplyPaste}>Apply reviewed quantities</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
