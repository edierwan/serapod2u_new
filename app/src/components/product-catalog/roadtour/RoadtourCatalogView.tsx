'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import SafeImage from '@/components/shared/SafeImage'
import { getStorageUrl } from '@/lib/utils'
import {
  Package, CheckCircle2, PawPrint, Ban, Search, Plus, Star, Trash2, ChevronDown, Info,
} from 'lucide-react'

type InclusionMode = 'include_all' | 'selected_only' | 'excluded'

interface CategoryRule {
  product_category_id: string
  category_code: string | null
  category_name: string
  is_vape: boolean
  kind: string
  locked: boolean
  inclusion_mode: InclusionMode
  active_product_count: number
}

interface ProductRow {
  id: string
  product_code: string | null
  product_name: string
  category_id: string | null
  category_name: string | null
  brand_name: string | null
  primary_image_url: string | null
  price: number | null
  is_active: boolean | null
  inclusion_mode: InclusionMode | null
  override: 'include' | 'exclude' | null
  featured: boolean
  sort_order: number
  effective_included: boolean
  visibility_source: 'category' | 'manual' | 'vape_lock'
}

interface CatalogPayload {
  program: { id: string; name: string; active: boolean }
  catalog: { id: string; code: string; name: string }
  categoryRules: CategoryRule[]
  products: ProductRow[]
  summary: { totalProducts: number; includedCount: number; autoIncludedPetFood: number; excludedCount: number }
}

const MODE_LABEL: Record<InclusionMode, string> = {
  include_all: 'Include All',
  selected_only: 'Selected Only',
  excluded: 'Excluded',
}

function resolveImg(url: string | null | undefined) {
  if (!url) return ''
  return url.startsWith('/') ? url : getStorageUrl(url, 'product-images')
}

export default function RoadtourCatalogView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const program = (searchParams.get('program') === 'cellera' ? 'cellera' : 'ellbow') as 'ellbow' | 'cellera'

  const [data, setData] = useState<CatalogPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [visibilityFilter, setVisibilityFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [removeTarget, setRemoveTarget] = useState<ProductRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/product-catalog/roadtour/catalog', { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load RoadTour catalog')
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (program === 'ellbow') fetchData()
    else setLoading(false)
  }, [program, fetchData])

  const setProgram = (next: 'ellbow' | 'cellera') => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('program', next)
    router.push(`/engagement/product-catalog/roadtour?${params.toString()}`)
  }

  const refresh = () => fetchData()

  const updateCategoryRule = async (categoryId: string, mode: InclusionMode) => {
    setBusy(true)
    try {
      const res = await fetch('/api/product-catalog/roadtour/category-rules', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ product_category_id: categoryId, inclusion_mode: mode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update rule')
      await refresh()
    } catch (e: any) {
      toast({ title: 'Could not update category rule', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const updateProduct = async (productId: string, patch: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/product-catalog/roadtour/products/${productId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update product')
      await refresh()
    } catch (e: any) {
      toast({ title: 'Could not update product', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const removeOverride = async (productId: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/product-catalog/roadtour/products/${productId}`, { method: 'DELETE', credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to remove override')
      await refresh()
    } catch (e: any) {
      toast({ title: 'Could not remove override', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(false)
      setRemoveTarget(null)
    }
  }

  const bulk = async (action: string, ids: string[]) => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/product-catalog/roadtour/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ action, product_ids: ids }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Bulk action failed')
      if (json.skipped) toast({ title: 'Some products skipped', description: `${json.skipped} Vape product(s) cannot be included.` })
      setSelected(new Set())
      await refresh()
    } catch (e: any) {
      toast({ title: 'Bulk action failed', description: e.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const filteredProducts = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.products.filter((p) => {
      if (q && !(`${p.product_name} ${p.product_code ?? ''}`.toLowerCase().includes(q))) return false
      if (categoryFilter !== 'all' && p.category_id !== categoryFilter) return false
      if (visibilityFilter === 'included' && !p.effective_included) return false
      if (visibilityFilter === 'excluded' && p.effective_included) return false
      if (visibilityFilter === 'auto' && p.visibility_source !== 'category') return false
      if (visibilityFilter === 'manual' && p.visibility_source !== 'manual') return false
      if (visibilityFilter === 'featured' && !p.featured) return false
      return true
    })
  }, [data, search, categoryFilter, visibilityFilter])

  const allVisibleSelected = filteredProducts.length > 0 && filteredProducts.every((p) => selected.has(p.id))
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filteredProducts.forEach((p) => next.delete(p.id))
      else filteredProducts.forEach((p) => next.add(p.id))
      return next
    })
  }
  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // ---- Program toggle + Storefront/RoadTour toggle header ----
  const Header = (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Catalog Management</h1>
          <p className="text-gray-600 mt-1">Manage products and visibility for RoadTour mobile catalogs.</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <a href="/engagement/product-catalog" className="px-4 py-2 text-sm font-medium rounded-md text-gray-600 hover:text-gray-900">
            Storefront Catalog
          </a>
          <span className="px-4 py-2 text-sm font-medium rounded-md bg-white text-gray-900 shadow-sm">RoadTour Catalog</span>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500 mb-2">Loyalty Program / Mobile Catalog</p>
        <div className="inline-flex gap-2">
          <button
            onClick={() => setProgram('cellera')}
            className={`px-4 py-2 text-sm font-medium rounded-lg border ${program === 'cellera' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            Cellera Loyalty
          </button>
          <button
            onClick={() => setProgram('ellbow')}
            className={`px-4 py-2 text-sm font-medium rounded-lg border inline-flex items-center gap-2 ${program === 'ellbow' ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            <Star className="h-4 w-4" /> Ellbow Loyalty
          </button>
        </div>
        {program === 'ellbow' && (
          <p className="text-sm text-gray-500 mt-2">Program: <span className="font-medium text-gray-700">Ellbow Loyalty</span> · Mobile Experience: <span className="font-medium text-gray-700">Pet Food / Ellbow</span></p>
        )}
      </div>
    </div>
  )

  if (program === 'cellera') {
    return (
      <div className="space-y-6">
        {Header}
        <Card>
          <CardContent className="py-12 text-center">
            <Info className="h-8 w-8 text-gray-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-900">Cellera Loyalty (Legacy Vape program)</h3>
            <p className="text-gray-600 mt-1 max-w-md mx-auto">
              The Cellera/Vape RoadTour mobile experience is managed by the existing legacy flow and is read-only here.
              Ellbow RoadTour assortment rules do not apply to Cellera.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {Header}

      {loading && <div className="py-12 text-center text-gray-500">Loading RoadTour catalog…</div>}
      {error && <Card><CardContent className="py-8 text-center text-red-600">{error}</CardContent></Card>}

      {data && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard icon={<Package className="h-5 w-5 text-teal-600" />} label="Total Products" value={data.summary.totalProducts} hint="All products in master catalog" accent="border-l-teal-500" />
            <SummaryCard icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} label="Included in Ellbow Catalog" value={data.summary.includedCount} hint="Products visible in RoadTour" accent="border-l-green-500" />
            <SummaryCard icon={<PawPrint className="h-5 w-5 text-amber-600" />} label="Auto-Included Pet Food" value={data.summary.autoIncludedPetFood} hint="Automatically included items" accent="border-l-amber-500" />
            <SummaryCard icon={<Ban className="h-5 w-5 text-red-600" />} label="Excluded Products" value={data.summary.excludedCount} hint="Excluded / not selected items" accent="border-l-red-500" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Category rules */}
            <div className="lg:col-span-4 space-y-3">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Category Rules</h3>
                    <p className="text-xs text-gray-500 mt-1">Default visibility for product categories in RoadTour.</p>
                  </div>
                  {data.categoryRules.map((rule) => (
                    <div key={rule.product_category_id} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-gray-100 bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{rule.category_name}</p>
                        <p className="text-xs text-gray-500">{rule.locked ? 'Locked' : 'Rule'} · {rule.active_product_count} active</p>
                      </div>
                      {rule.locked ? (
                        <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200">Excluded</Badge>
                      ) : (
                        <Select value={rule.inclusion_mode} onValueChange={(v) => updateCategoryRule(rule.product_category_id, v as InclusionMode)} disabled={busy}>
                          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="include_all">Include All</SelectItem>
                            <SelectItem value="selected_only">Selected Only</SelectItem>
                            <SelectItem value="excluded">Excluded</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ))}
                  <p className="text-xs text-gray-500 bg-teal-50 border border-teal-100 rounded-md p-2">
                    Changes to category rules affect products without a manual override.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Products table */}
            <div className="lg:col-span-8 space-y-3">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <h3 className="font-semibold text-gray-900">Selected Products</h3>
                      <p className="text-xs text-gray-500">Review and manage products for the Ellbow Loyalty RoadTour catalog.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" disabled={busy || selected.size === 0}>
                            Bulk Actions <ChevronDown className="h-4 w-4 ml-1" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => bulk('include', [...selected])}>Include selected</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => bulk('exclude', [...selected])}>Exclude selected</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => bulk('remove_override', [...selected])}>Remove overrides</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => bulk('feature', [...selected])}>Mark featured</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => bulk('unfeature', [...selected])}>Remove featured</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setAddOpen(true)}>
                        <Plus className="h-4 w-4 mr-1" /> Add Product
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." className="pl-8 h-9" />
                    </div>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="All Categories" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {data.categoryRules.map((r) => <SelectItem key={r.product_category_id} value={r.product_category_id}>{r.category_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
                      <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="All Visibility" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Visibility</SelectItem>
                        <SelectItem value="included">Included</SelectItem>
                        <SelectItem value="excluded">Excluded</SelectItem>
                        <SelectItem value="auto">Auto (category)</SelectItem>
                        <SelectItem value="manual">Manual override</SelectItem>
                        <SelectItem value="featured">Featured</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"><Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} /></TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Brand</TableHead>
                          <TableHead>Price</TableHead>
                          <TableHead>RoadTour Visibility</TableHead>
                          <TableHead>Featured</TableHead>
                          <TableHead>Sort</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProducts.map((p) => (
                          <TableRow key={p.id} className={!p.is_active ? 'opacity-50' : ''}>
                            <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} /></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <SafeImage src={resolveImg(p.primary_image_url)} alt={p.product_name} className="h-9 w-9 rounded object-contain bg-slate-50" />
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{p.product_name}</p>
                                  <p className="text-xs text-gray-500">{p.product_code ?? '—'}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell><Badge variant="outline">{p.category_name ?? '—'}</Badge></TableCell>
                            <TableCell className="text-sm text-gray-600">{p.brand_name ?? '—'}</TableCell>
                            <TableCell className="text-sm text-gray-600">{p.price != null ? `RM${Number(p.price).toFixed(2)}` : '—'}</TableCell>
                            <TableCell><VisibilityBadge row={p} /></TableCell>
                            <TableCell>
                              <Switch checked={p.featured} disabled={busy || !p.effective_included} onCheckedChange={(v) => updateProduct(p.id, { featured: v })} />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number" min={0} value={p.sort_order}
                                onChange={(e) => updateProduct(p.id, { sort_order: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                                className="h-8 w-16" disabled={busy}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-1">
                                {p.override !== 'include' && p.visibility_source !== 'vape_lock' && (
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-green-700" disabled={busy} onClick={() => updateProduct(p.id, { visibility_override: 'include' })}>Include</Button>
                                )}
                                {p.override !== 'exclude' && (
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-gray-600" disabled={busy} onClick={() => updateProduct(p.id, { visibility_override: 'exclude' })}>Exclude</Button>
                                )}
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" disabled={busy || (!p.override && !p.featured && p.sort_order === 0)} title="Remove override / use category default" onClick={() => setRemoveTarget(p)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredProducts.length === 0 && (
                          <TableRow><TableCell colSpan={9} className="text-center text-gray-500 py-8">No products match the current filters.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* Remove override confirm */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Ellbow catalog?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the RoadTour override for <span className="font-medium">{removeTarget?.product_name}</span> and returns it to its
              category default. The Product Master product is not deleted or modified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeTarget && removeOverride(removeTarget.id)}>Remove override</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add product modal */}
      {data && (
        <AddProductDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          products={data.products}
          categoryRules={data.categoryRules}
          onAdd={async (ids) => { await bulk('include', ids); setAddOpen(false) }}
          busy={busy}
        />
      )}
    </div>
  )
}

function SummaryCard({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: number; hint: string; accent: string }) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">{icon}<span className="text-sm font-medium text-gray-600">{label}</span></div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-400 mt-1">{hint}</p>
      </CardContent>
    </Card>
  )
}

function VisibilityBadge({ row }: { row: ProductRow }) {
  if (row.effective_included) {
    if (row.visibility_source === 'category') {
      return <div><Badge className="bg-amber-100 text-amber-800 border-amber-200">Auto</Badge><p className="text-[11px] text-gray-500 mt-0.5">Included · category rule</p></div>
    }
    return <div><Badge className="bg-green-100 text-green-800 border-green-200">Included</Badge><p className="text-[11px] text-gray-500 mt-0.5">Manual override</p></div>
  }
  const sourceLabel = row.visibility_source === 'manual' ? 'Manual override' : row.visibility_source === 'vape_lock' ? 'Vape locked' : 'Category rule'
  return <div><Badge className="bg-red-50 text-red-700 border-red-200">Excluded</Badge><p className="text-[11px] text-gray-500 mt-0.5">{sourceLabel}</p></div>
}

function AddProductDialog({ open, onOpenChange, products, categoryRules, onAdd, busy }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  products: ProductRow[]
  categoryRules: CategoryRule[]
  onAdd: (ids: string[]) => void
  busy: boolean
}) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // Candidates: products not already manually included and not Vape.
  const candidates = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return products.filter((p) => {
      if (p.override === 'include') return false
      if (p.visibility_source === 'vape_lock') return false
      if (cat !== 'all' && p.category_id !== cat) return false
      if (ql && !(`${p.product_name} ${p.product_code ?? ''}`.toLowerCase().includes(ql))) return false
      return true
    })
  }, [products, q, cat])

  useEffect(() => { if (!open) { setPicked(new Set()); setQ(''); setCat('all') } }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Add products to Ellbow catalog</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products..." className="pl-8 h-9" />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categoryRules.filter((r) => !r.is_vape).map((r) => <SelectItem key={r.product_category_id} value={r.product_category_id}>{r.category_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y border rounded-md">
          {candidates.map((p) => (
            <label key={p.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 cursor-pointer">
              <Checkbox checked={picked.has(p.id)} onCheckedChange={() => setPicked((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} />
              <SafeImage src={resolveImg(p.primary_image_url)} alt={p.product_name} className="h-8 w-8 rounded object-contain bg-slate-50" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{p.product_name}</p>
                <p className="text-xs text-gray-500">{p.category_name} · {p.product_code ?? '—'}</p>
              </div>
            </label>
          ))}
          {candidates.length === 0 && <p className="p-4 text-center text-sm text-gray-500">No products available to add.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-teal-600 hover:bg-teal-700" disabled={busy || picked.size === 0} onClick={() => onAdd([...picked])}>Add {picked.size > 0 ? `(${picked.size})` : ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
