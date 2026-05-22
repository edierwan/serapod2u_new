'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Archive,
  BarChart3,
  Copy,
  ExternalLink,
  Eye,
  Globe2,
  Loader2,
  Package,
  Plus,
  Rocket,
  Save,
  Search,
  ShoppingBag,
} from 'lucide-react'

import {
  DEFAULT_LANDING_PAGE_DISPLAY_SETTINGS,
  DEFAULT_LANDING_PAGE_HERO,
  DEFAULT_LANDING_PAGE_TRACKING,
  type LandingPageAdminRecord,
  type LandingPageCategoryOption,
  type LandingPagePayload,
  type LandingPageProductOption,
  type LandingPageStatus,
} from '@/lib/landing-pages/types'
import { normalizeLandingPageSlug } from '@/lib/landing-pages/slug'

type MessageState = { type: 'success' | 'error'; text: string } | null

function emptyPayload(): LandingPagePayload {
  return {
    internal_name: '',
    public_title: '',
    slug: '',
    description: '',
    status: 'draft',
    source_mode: 'manual',
    category_id: null,
    max_products: 12,
    hero: { ...DEFAULT_LANDING_PAGE_HERO },
    display_settings: { ...DEFAULT_LANDING_PAGE_DISPLAY_SETTINGS },
    tracking_defaults: { ...DEFAULT_LANDING_PAGE_TRACKING },
    publish_start_at: null,
    publish_end_at: null,
    selected_product_ids: [],
  }
}

function recordToPayload(page: LandingPageAdminRecord): LandingPagePayload {
  return {
    internal_name: page.internal_name,
    public_title: page.public_title,
    slug: page.slug,
    description: page.description || '',
    status: page.status,
    source_mode: page.source_mode,
    category_id: page.category_id,
    max_products: page.max_products,
    hero: page.hero,
    display_settings: page.display_settings,
    tracking_defaults: page.tracking_defaults,
    publish_start_at: page.publish_start_at,
    publish_end_at: page.publish_end_at,
    selected_product_ids: page.selected_product_ids,
  }
}

function statusBadge(status: LandingPageStatus) {
  if (status === 'published') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'archived') return 'bg-slate-100 text-slate-600 border-slate-200'
  return 'bg-amber-50 text-amber-700 border-amber-200'
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(value || 0)
}

function publicPath(slug: string) {
  return `/lp/${slug}`
}

function adminPreviewPath(page: LandingPageAdminRecord) {
  return `/lp/${page.slug}?preview=${page.id}`
}

export default function LandingPagesAdminView() {
  const [pages, setPages] = useState<LandingPageAdminRecord[]>([])
  const [products, setProducts] = useState<LandingPageProductOption[]>([])
  const [categories, setCategories] = useState<LandingPageCategoryOption[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [form, setForm] = useState<LandingPagePayload>(() => emptyPayload())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<MessageState>(null)
  const [productQuery, setProductQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const selectedPage = useMemo(() => pages.find((page) => page.id === selectedPageId) || null, [pages, selectedPageId])
  const selectedProducts = useMemo(() => new Set(form.selected_product_ids), [form.selected_product_ids])

  const filteredPages = useMemo(() => {
    return pages.filter((page) => showArchived || page.status !== 'archived')
  }, [pages, showArchived])

  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase()
    if (!query) return products
    return products.filter((product) =>
      [product.product_name, product.product_code, product.category_name, product.brand_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    )
  }, [productQuery, products])

  async function loadData(preferredPageId?: string) {
    setLoading(true)
    setMessage(null)
    try {
      const [pagesResponse, optionsResponse] = await Promise.all([
        fetch('/api/landing-pages', { cache: 'no-store' }),
        fetch('/api/landing-pages/product-options', { cache: 'no-store' }),
      ])

      const pagesJson = await pagesResponse.json()
      const optionsJson = await optionsResponse.json()
      if (!pagesJson.success) throw new Error(pagesJson.error || 'Failed to load landing pages.')
      if (!optionsJson.success) throw new Error(optionsJson.error || 'Failed to load product options.')

      const loadedPages = pagesJson.data as LandingPageAdminRecord[]
      setPages(loadedPages)
      setProducts(optionsJson.data.products || [])
      setCategories(optionsJson.data.categories || [])

      const nextSelection = loadedPages.find((page) => page.id === preferredPageId) || loadedPages[0] || null
      setSelectedPageId(nextSelection?.id ?? null)
      setForm(nextSelection ? recordToPayload(nextSelection) : emptyPayload())
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Landing pages could not be loaded.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const updateForm = <K extends keyof LandingPagePayload>(key: K, value: LandingPagePayload[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateHero = (key: keyof LandingPagePayload['hero'], value: string) => {
    setForm((current) => ({ ...current, hero: { ...current.hero, [key]: value } }))
  }

  const updateDisplay = (key: keyof LandingPagePayload['display_settings'], value: any) => {
    setForm((current) => ({ ...current, display_settings: { ...current.display_settings, [key]: value } }))
  }

  const updateTracking = (key: keyof LandingPagePayload['tracking_defaults'], value: string) => {
    setForm((current) => ({ ...current, tracking_defaults: { ...current.tracking_defaults, [key]: value } }))
  }

  const startNew = () => {
    setSelectedPageId(null)
    setForm(emptyPayload())
    setMessage(null)
  }

  const choosePage = (page: LandingPageAdminRecord) => {
    setSelectedPageId(page.id)
    setForm(recordToPayload(page))
    setMessage(null)
  }

  const savePage = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(selectedPageId ? `/api/landing-pages/${selectedPageId}` : '/api/landing-pages', {
        method: selectedPageId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await response.json()
      if (!json.success) throw new Error(json.error || 'Landing page could not be saved.')
      const saved = json.data as LandingPageAdminRecord
      setMessage({ type: 'success', text: selectedPageId ? 'Landing page saved.' : 'Landing page created.' })
      await loadData(saved.id)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Landing page could not be saved.' })
    } finally {
      setSaving(false)
    }
  }

  const runAction = async (action: 'publish' | 'unpublish' | 'archive' | 'duplicate') => {
    if (!selectedPageId) return
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/landing-pages/${selectedPageId}/${action}`, { method: 'POST' })
      const json = await response.json()
      if (!json.success) throw new Error(json.error || `Could not ${action} landing page.`)
      const nextPage = json.data as LandingPageAdminRecord
      const actionMessage = action === 'duplicate'
        ? 'Landing page duplicated.'
        : action === 'publish'
          ? 'Landing page published.'
          : action === 'unpublish'
            ? 'Landing page unpublished.'
            : 'Landing page archived.'
      setMessage({ type: 'success', text: actionMessage })
      await loadData(nextPage.id)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || `Could not ${action} landing page.` })
    } finally {
      setSaving(false)
    }
  }

  const toggleProduct = (productId: string) => {
    setForm((current) => {
      const ids = new Set(current.selected_product_ids)
      if (ids.has(productId)) ids.delete(productId)
      else ids.add(productId)
      return { ...current, selected_product_ids: Array.from(ids) }
    })
  }

  const generateSlug = () => {
    const base = form.public_title || form.internal_name
    updateForm('slug', normalizeLandingPageSlug(base))
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-border bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-700" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Customer & Growth / Marketing</p>
          <h1 className="text-2xl font-bold tracking-normal text-foreground">Landing Pages</h1>
          <p className="text-sm text-muted-foreground">Create curated campaign pages using manual product picks or an approved category source.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedPage && (
            <>
              <Link href={adminPreviewPath(selectedPage)} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-accent">
                <Eye className="h-4 w-4" /> Preview
              </Link>
              {selectedPage.status === 'published' && (
                <Link href={publicPath(selectedPage.slug)} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                  <ExternalLink className="h-4 w-4" /> Public Page
                </Link>
              )}
            </>
          )}
          <button type="button" onClick={startNew} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus className="h-4 w-4" /> New Page
          </button>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="font-semibold text-foreground">Pages</h2>
                <p className="text-xs text-muted-foreground">{filteredPages.length} visible</p>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="h-4 w-4 rounded border-border" />
                Archived
              </label>
            </div>
            <div className="max-h-[680px] overflow-y-auto p-2">
              {filteredPages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No landing pages yet.</div>
              ) : filteredPages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => choosePage(page)}
                  className={`mb-2 w-full rounded-lg border p-3 text-left transition ${selectedPageId === page.id ? 'border-emerald-300 bg-emerald-50/70' : 'border-border bg-background hover:border-emerald-200'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{page.internal_name}</p>
                      <p className="truncate text-xs text-muted-foreground">/{page.slug}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize ${statusBadge(page.status)}`}>{page.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <span><b className="text-foreground">{page.metrics.views}</b> views</span>
                    <span><b className="text-foreground">{page.metrics.orders}</b> orders</span>
                    <span><b className="text-foreground">{page.selected_products_count}</b> items</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            {[
              { label: 'Views', value: selectedPage?.metrics.views ?? 0, icon: Eye },
              { label: 'Orders', value: selectedPage?.metrics.orders ?? 0, icon: ShoppingBag },
              { label: 'Conversion', value: `${selectedPage?.metrics.conversion_rate ?? 0}%`, icon: BarChart3 },
              { label: 'Revenue', value: formatCurrency(selectedPage?.metrics.revenue ?? 0), icon: Globe2 },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</p>
                    <Icon className="h-4 w-4 text-emerald-700" />
                  </div>
                  <p className="mt-3 text-2xl font-bold text-foreground">{item.value}</p>
                </div>
              )
            })}
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Page Setup</h2>
                <p className="text-xs text-muted-foreground">Draft safely, then publish after product validation passes.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={savePage} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
                </button>
                {selectedPage && selectedPage.status !== 'published' && selectedPage.status !== 'archived' && (
                  <button type="button" onClick={() => runAction('publish')} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-orange-600 px-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
                    <Rocket className="h-4 w-4" /> Publish
                  </button>
                )}
                {selectedPage?.status === 'published' && (
                  <button type="button" onClick={() => runAction('unpublish')} disabled={saving} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold hover:bg-accent disabled:opacity-60">Unpublish</button>
                )}
                {selectedPage && (
                  <>
                    <button type="button" onClick={() => runAction('duplicate')} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-accent disabled:opacity-60"><Copy className="h-4 w-4" /> Duplicate</button>
                    <button type="button" onClick={() => runAction('archive')} disabled={saving || selectedPage.status === 'archived'} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-accent disabled:opacity-60"><Archive className="h-4 w-4" /> Archive</button>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm font-medium text-foreground">
                    Internal Name
                    <input value={form.internal_name} onChange={(event) => updateForm('internal_name', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-emerald-500" />
                  </label>
                  <label className="space-y-1.5 text-sm font-medium text-foreground">
                    Public Title
                    <input value={form.public_title} onChange={(event) => updateForm('public_title', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-emerald-500" />
                  </label>
                </div>

                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  Slug
                  <div className="flex gap-2">
                    <input value={form.slug} onChange={(event) => updateForm('slug', normalizeLandingPageSlug(event.target.value))} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-emerald-500" placeholder="campaign-slug" />
                    <button type="button" onClick={generateSlug} className="h-10 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-accent">Generate</button>
                  </div>
                </label>

                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  Description
                  <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm font-medium text-foreground">
                    Publish Start
                    <input type="datetime-local" value={form.publish_start_at ? form.publish_start_at.slice(0, 16) : ''} onChange={(event) => updateForm('publish_start_at', event.target.value ? new Date(event.target.value).toISOString() : null)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-emerald-500" />
                  </label>
                  <label className="space-y-1.5 text-sm font-medium text-foreground">
                    Publish End
                    <input type="datetime-local" value={form.publish_end_at ? form.publish_end_at.slice(0, 16) : ''} onChange={(event) => updateForm('publish_end_at', event.target.value ? new Date(event.target.value).toISOString() : null)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-emerald-500" />
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-background p-4">
                  <h3 className="text-sm font-bold text-foreground">Hero</h3>
                  <div className="mt-3 grid gap-3">
                    <input value={form.hero.badge_text} onChange={(event) => updateHero('badge_text', event.target.value)} placeholder="Badge text" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                    <input value={form.hero.headline} onChange={(event) => updateHero('headline', event.target.value)} placeholder="Headline" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                    <textarea value={form.hero.subtitle} onChange={(event) => updateHero('subtitle', event.target.value)} placeholder="Subtitle" rows={2} className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                    <input value={form.hero.hero_image_url} onChange={(event) => updateHero('hero_image_url', event.target.value)} placeholder="Hero image URL" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input value={form.hero.primary_cta_label} onChange={(event) => updateHero('primary_cta_label', event.target.value)} placeholder="Primary CTA" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                      <input value={form.hero.secondary_cta_label} onChange={(event) => updateHero('secondary_cta_label', event.target.value)} placeholder="Secondary CTA" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <input value={form.hero.secondary_cta_url} onChange={(event) => updateHero('secondary_cta_url', event.target.value)} placeholder="Secondary CTA URL" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-background p-4">
                  <h3 className="text-sm font-bold text-foreground">Display & Tracking</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      CTA Mode
                      <select value={form.display_settings.cta_mode} onChange={(event) => updateDisplay('cta_mode', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm normal-case text-foreground outline-none focus:border-emerald-500">
                        <option value="view_product">View Product</option>
                        <option value="add_to_cart">Add to Cart</option>
                        <option value="buy_now">Buy Now</option>
                        <option value="whatsapp">WhatsApp</option>
                      </select>
                    </label>
                    <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      WhatsApp Phone
                      <input value={form.display_settings.whatsapp_phone} onChange={(event) => updateDisplay('whatsapp_phone', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm normal-case text-foreground outline-none focus:border-emerald-500" />
                    </label>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                      ['show_price', 'Show price'],
                      ['show_stock', 'Show stock'],
                      ['enable_add_to_cart', 'Add to cart'],
                      ['enable_buy_now', 'Buy now'],
                      ['enable_whatsapp', 'WhatsApp'],
                      ['hide_out_of_stock', 'Hide out of stock'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium">
                        <input type="checkbox" checked={Boolean((form.display_settings as any)[key])} onChange={(event) => updateDisplay(key as any, event.target.checked)} className="h-4 w-4 rounded border-border" />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <input value={form.tracking_defaults.source_code} onChange={(event) => updateTracking('source_code', event.target.value)} placeholder="Source code" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                    <input value={form.tracking_defaults.utm_source} onChange={(event) => updateTracking('utm_source', event.target.value)} placeholder="UTM source" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                    <input value={form.tracking_defaults.utm_campaign} onChange={(event) => updateTracking('utm_campaign', event.target.value)} placeholder="UTM campaign" className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-emerald-500" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Product Source</h2>
                <p className="text-xs text-muted-foreground">Manual and category modes resolve server-side. Empty sources stay empty.</p>
              </div>
              <div className="flex rounded-lg border border-border bg-background p-1">
                <button type="button" onClick={() => updateForm('source_mode', 'manual')} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${form.source_mode === 'manual' ? 'bg-emerald-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>Manual</button>
                <button type="button" onClick={() => updateForm('source_mode', 'category')} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${form.source_mode === 'category' ? 'bg-emerald-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>Category</button>
              </div>
            </div>

            <div className="p-5">
              {form.source_mode === 'category' ? (
                <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                  <label className="space-y-1.5 text-sm font-medium text-foreground">
                    Category
                    <select value={form.category_id || ''} onChange={(event) => updateForm('category_id', event.target.value || null)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-emerald-500">
                      <option value="">Select category</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5 text-sm font-medium text-foreground">
                    Max Products
                    <input type="number" min={1} max={60} value={form.max_products} onChange={(event) => updateForm('max_products', Number(event.target.value) || 12)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-emerald-500" />
                  </label>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative max-w-md flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Search products" className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">{form.selected_product_ids.length} selected</p>
                  </div>
                  <div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                    {filteredProducts.map((product) => {
                      const checked = selectedProducts.has(product.id)
                      return (
                        <button key={product.id} type="button" onClick={() => toggleProduct(product.id)} className={`flex gap-3 rounded-xl border p-3 text-left transition ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-background hover:border-emerald-200'}`}>
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                            {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-contain" /> : <Package className="h-7 w-7 text-slate-300" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                              <input type="checkbox" checked={checked} onChange={() => toggleProduct(product.id)} onClick={(event) => event.stopPropagation()} className="mt-1 h-4 w-4 rounded border-border" />
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-sm font-bold text-foreground">{product.product_name}</p>
                                <p className="mt-1 truncate text-xs text-muted-foreground">{product.category_name || 'Uncategorized'}</p>
                                <p className="mt-2 text-xs font-semibold text-emerald-700">{product.starting_price ? formatCurrency(product.starting_price) : 'No public price'}</p>
                              </div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}