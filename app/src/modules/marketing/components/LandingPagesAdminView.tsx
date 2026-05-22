'use client'

/**
 * Landing Pages Admin (Redesigned, UI/UX MVP)
 *
 * Step-based wizard layout replacing the previous all-in-one form.
 *
 * Modes:
 *   - 'list'    : campaigns list with summary cards, filters, table/cards
 *   - 'editor'  : 5-step wizard (Basic Info / Page Design / Products / CTA & Tracking / Preview & Publish)
 *   - 'analytics': lightweight per-page analytics view
 *
 * Backend contracts (APIs, types, DB) are unchanged.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
    Archive,
    ArrowLeft,
    ArrowRight,
    BarChart3,
    CheckCircle2,
    Copy,
    DollarSign,
    Eye,
    ExternalLink,
    FileText,
    Globe2,
    Layers,
    Layout,
    LineChart,
    Loader2,
    MessageCircle,
    Package,
    Pin,
    Plus,
    Rocket,
    Save,
    Search,
    Settings2,
    ShoppingBag,
    ShoppingCart,
    Sparkles,
    Tag,
    Trash2,
    TrendingUp,
    Users,
    X,
} from 'lucide-react'

import {
    DEFAULT_LANDING_PAGE_DISPLAY_SETTINGS,
    DEFAULT_LANDING_PAGE_HERO,
    DEFAULT_LANDING_PAGE_TRACKING,
    EMPTY_LANDING_PAGE_METRICS,
    type LandingPageAdminRecord,
    type LandingPageCategoryOption,
    type LandingPageDisplaySettings,
    type LandingPageHeroConfig,
    type LandingPagePayload,
    type LandingPageProductOption,
    type LandingPageStatus,
    type LandingPageTrackingDefaults,
} from '@/lib/landing-pages/types'
import { normalizeLandingPageSlug } from '@/lib/landing-pages/slug'

// ── Types & helpers ────────────────────────────────────────────────────

type Mode = 'list' | 'editor' | 'analytics'
type Step = 1 | 2 | 3 | 4 | 5
type MessageState = { type: 'success' | 'error' | 'info'; text: string } | null

const STEPS: { id: Step; label: string; hint: string; icon: any }[] = [
    { id: 1, label: 'Basic Info', hint: 'Name, slug, schedule', icon: FileText },
    { id: 2, label: 'Page Design', hint: 'Hero & sections', icon: Layout },
    { id: 3, label: 'Products', hint: 'Select curated products', icon: Package },
    { id: 4, label: 'CTA & Tracking', hint: 'Display, CTA, UTMs', icon: Settings2 },
    { id: 5, label: 'Preview & Publish', hint: 'Review & go live', icon: Rocket },
]

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

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(value || 0)
}

function formatNumber(value: number) {
    return new Intl.NumberFormat('en-MY').format(value || 0)
}

function formatDateTime(value: string | null | undefined) {
    if (!value) return '—'
    try {
        return new Date(value).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })
    } catch {
        return value
    }
}

function isScheduled(page: { status: LandingPageStatus; publish_start_at: string | null }) {
    if (page.status !== 'draft') return false
    if (!page.publish_start_at) return false
    return new Date(page.publish_start_at).getTime() > Date.now()
}

function statusPillClass(status: LandingPageStatus, scheduled = false) {
    if (scheduled) return 'bg-sky-50 text-sky-700 border-sky-200'
    if (status === 'published') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    if (status === 'archived') return 'bg-slate-100 text-slate-600 border-slate-200'
    return 'bg-amber-50 text-amber-700 border-amber-200'
}

function statusLabel(status: LandingPageStatus, scheduled = false) {
    if (scheduled) return 'Scheduled'
    return status.charAt(0).toUpperCase() + status.slice(1)
}

function publicPath(slug: string) {
    return `/lp/${slug}`
}

function previewPath(page: LandingPageAdminRecord) {
    return `/lp/${page.slug || 'preview'}?preview=${page.id}`
}

function copyToClipboard(text: string, onDone?: (ok: boolean) => void) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
        onDone?.(false)
        return
    }
    navigator.clipboard.writeText(text).then(
        () => onDone?.(true),
        () => onDone?.(false),
    )
}

function buildPublicLink(origin: string, slug: string, tracking: LandingPageTrackingDefaults) {
    const params = new URLSearchParams()
    if (tracking.utm_source) params.set('utm_source', tracking.utm_source)
    if (tracking.utm_medium) params.set('utm_medium', tracking.utm_medium)
    if (tracking.utm_campaign) params.set('utm_campaign', tracking.utm_campaign)
    if (tracking.utm_content) params.set('utm_content', tracking.utm_content)
    if (tracking.utm_term) params.set('utm_term', tracking.utm_term)
    if (tracking.source_code) params.set('source_code', tracking.source_code)
    const qs = params.toString()
    return `${origin}/lp/${slug || ''}${qs ? `?${qs}` : ''}`
}

// ── Main component ─────────────────────────────────────────────────────

export default function LandingPagesAdminView() {
    const [pages, setPages] = useState<LandingPageAdminRecord[]>([])
    const [products, setProducts] = useState<LandingPageProductOption[]>([])
    const [categories, setCategories] = useState<LandingPageCategoryOption[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState<MessageState>(null)

    const [mode, setMode] = useState<Mode>('list')
    const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
    const [form, setForm] = useState<LandingPagePayload>(() => emptyPayload())
    const [step, setStep] = useState<Step>(1)

    // list filters
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | LandingPageStatus | 'scheduled'>('all')
    const [sourceFilter, setSourceFilter] = useState<'all' | 'manual' | 'category'>('all')
    const [view, setView] = useState<'table' | 'cards'>('table')

    const selectedPage = useMemo(
        () => pages.find((page) => page.id === selectedPageId) || null,
        [pages, selectedPageId],
    )

    const summary = useMemo(() => {
        const totals = {
            total: pages.length,
            published: 0,
            views: 0,
            orders: 0,
            revenue: 0,
        }
        for (const page of pages) {
            if (page.status === 'published') totals.published += 1
            totals.views += page.metrics.views || 0
            totals.orders += page.metrics.orders || 0
            totals.revenue += page.metrics.revenue || 0
        }
        const conv = totals.views > 0 ? Number(((totals.orders / totals.views) * 100).toFixed(2)) : 0
        return { ...totals, conversion: conv }
    }, [pages])

    const filteredPages = useMemo(() => {
        const q = search.trim().toLowerCase()
        return pages.filter((page) => {
            const scheduled = isScheduled(page)
            if (statusFilter === 'scheduled' && !scheduled) return false
            if (statusFilter !== 'all' && statusFilter !== 'scheduled' && page.status !== statusFilter) return false
            if (sourceFilter !== 'all' && page.source_mode !== sourceFilter) return false
            if (q) {
                const hay = `${page.internal_name} ${page.public_title} ${page.slug}`.toLowerCase()
                if (!hay.includes(q)) return false
            }
            return true
        })
    }, [pages, search, statusFilter, sourceFilter])

    const loadData = useCallback(async (preferredPageId?: string) => {
        setLoading(true)
        try {
            const [pagesRes, optionsRes] = await Promise.all([
                fetch('/api/landing-pages', { cache: 'no-store' }),
                fetch('/api/landing-pages/product-options', { cache: 'no-store' }),
            ])
            const pagesJson = await pagesRes.json()
            const optionsJson = await optionsRes.json()
            if (!pagesJson.success) throw new Error(pagesJson.error || 'Failed to load landing pages.')
            if (!optionsJson.success) throw new Error(optionsJson.error || 'Failed to load product options.')

            const loaded = pagesJson.data as LandingPageAdminRecord[]
            setPages(loaded)
            setProducts(optionsJson.data.products || [])
            setCategories(optionsJson.data.categories || [])

            if (preferredPageId) {
                const target = loaded.find((p) => p.id === preferredPageId)
                if (target) {
                    setSelectedPageId(target.id)
                    setForm(recordToPayload(target))
                }
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'Landing pages could not be loaded.' })
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadData()
    }, [loadData])

    // ── Editor helpers ─────────────────────────────────────────────────

    const updateForm = <K extends keyof LandingPagePayload>(key: K, value: LandingPagePayload[K]) => {
        setForm((current) => ({ ...current, [key]: value }))
    }
    const updateHero = <K extends keyof LandingPageHeroConfig>(key: K, value: LandingPageHeroConfig[K]) => {
        setForm((current) => ({ ...current, hero: { ...current.hero, [key]: value } }))
    }
    const updateDisplay = <K extends keyof LandingPageDisplaySettings>(key: K, value: LandingPageDisplaySettings[K]) => {
        setForm((current) => ({ ...current, display_settings: { ...current.display_settings, [key]: value } }))
    }
    const updateTracking = <K extends keyof LandingPageTrackingDefaults>(key: K, value: LandingPageTrackingDefaults[K]) => {
        setForm((current) => ({ ...current, tracking_defaults: { ...current.tracking_defaults, [key]: value } }))
    }

    const generateSlug = () => {
        const base = form.public_title || form.internal_name
        updateForm('slug', normalizeLandingPageSlug(base))
    }

    const openEditor = (page: LandingPageAdminRecord | null) => {
        if (page) {
            setSelectedPageId(page.id)
            setForm(recordToPayload(page))
        } else {
            setSelectedPageId(null)
            setForm(emptyPayload())
        }
        setStep(1)
        setMode('editor')
        setMessage(null)
    }

    const openAnalytics = (page: LandingPageAdminRecord) => {
        setSelectedPageId(page.id)
        setForm(recordToPayload(page))
        setMode('analytics')
        setMessage(null)
    }

    const backToList = () => {
        setMode('list')
        setSelectedPageId(null)
        setForm(emptyPayload())
        setMessage(null)
    }

    // Validation summary (live)
    const validation = useMemo(() => {
        const issues: { key: string; text: string; step: Step }[] = []
        if (!form.internal_name.trim()) issues.push({ key: 'internal', text: 'Internal name is required.', step: 1 })
        if (!form.public_title.trim()) issues.push({ key: 'public', text: 'Public title is required.', step: 1 })
        if (!form.slug.trim()) issues.push({ key: 'slug', text: 'Slug is required.', step: 1 })
        if (form.publish_start_at && form.publish_end_at && new Date(form.publish_start_at) >= new Date(form.publish_end_at)) {
            issues.push({ key: 'window', text: 'Publish end must be after publish start.', step: 1 })
        }
        if (!form.hero.headline.trim()) issues.push({ key: 'headline', text: 'Hero headline is required to publish.', step: 2 })
        if (!form.hero.subtitle.trim() && !form.description.trim()) issues.push({ key: 'sub', text: 'Hero subtitle or description is required.', step: 2 })
        if (form.source_mode === 'category' && !form.category_id) issues.push({ key: 'cat', text: 'Select a category source.', step: 3 })
        if (form.source_mode === 'manual' && form.selected_product_ids.length === 0) issues.push({ key: 'prod', text: 'Select at least one product.', step: 3 })
        const purchaseCta = form.display_settings.cta_mode === 'add_to_cart' || form.display_settings.cta_mode === 'buy_now' || form.display_settings.enable_add_to_cart || form.display_settings.enable_buy_now
        if (!form.display_settings.show_price && purchaseCta) {
            issues.push({ key: 'price', text: 'Purchase CTAs cannot be enabled while Show Price is off.', step: 4 })
        }
        return issues
    }, [form])

    // Actions

    const savePage = async (opts: { advanceTo?: Step; statusOverride?: LandingPageStatus } = {}) => {
        setSaving(true)
        setMessage(null)
        try {
            const body = opts.statusOverride ? { ...form, status: opts.statusOverride } : form
            const res = await fetch(selectedPageId ? `/api/landing-pages/${selectedPageId}` : '/api/landing-pages', {
                method: selectedPageId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error || 'Save failed.')
            const saved = json.data as LandingPageAdminRecord
            setMessage({ type: 'success', text: selectedPageId ? 'Landing page saved.' : 'Landing page created.' })
            setSelectedPageId(saved.id)
            setForm(recordToPayload(saved))
            await loadData(saved.id)
            if (opts.advanceTo) setStep(opts.advanceTo)
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
            const res = await fetch(`/api/landing-pages/${selectedPageId}/${action}`, { method: 'POST' })
            const json = await res.json()
            if (!json.success) throw new Error(json.error || `Could not ${action} landing page.`)
            const next = json.data as LandingPageAdminRecord
            const msg = action === 'duplicate'
                ? 'Landing page duplicated.'
                : action === 'publish'
                    ? 'Landing page published.'
                    : action === 'unpublish'
                        ? 'Landing page unpublished.'
                        : 'Landing page archived.'
            setMessage({ type: 'success', text: msg })
            if (action === 'archive') {
                await loadData()
                setMode('list')
                setSelectedPageId(null)
                setForm(emptyPayload())
            } else {
                setSelectedPageId(next.id)
                setForm(recordToPayload(next))
                await loadData(next.id)
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || `Could not ${action} landing page.` })
        } finally {
            setSaving(false)
        }
    }

    // ── Render ─────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-100 bg-white">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            </div>
        )
    }

    return (
        <div className="space-y-5">
            {message && (
                <div
                    className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${message.type === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : message.type === 'error'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-sky-200 bg-sky-50 text-sky-800'
                        }`}
                >
                    <span>{message.text}</span>
                    <button type="button" onClick={() => setMessage(null)} className="text-current/60 hover:opacity-80"><X className="h-4 w-4" /></button>
                </div>
            )}

            {mode === 'list' && (
                <ListView
                    pages={filteredPages}
                    allPages={pages}
                    summary={summary}
                    search={search}
                    setSearch={setSearch}
                    statusFilter={statusFilter}
                    setStatusFilter={setStatusFilter}
                    sourceFilter={sourceFilter}
                    setSourceFilter={setSourceFilter}
                    view={view}
                    setView={setView}
                    onCreate={() => openEditor(null)}
                    onEdit={openEditor}
                    onAnalytics={openAnalytics}
                    onDuplicate={async (page) => {
                        setSelectedPageId(page.id)
                        await runAction('duplicate')
                    }}
                    onArchive={async (page) => {
                        if (!window.confirm(`Archive "${page.internal_name}"? It can be restored from the database.`)) return
                        setSelectedPageId(page.id)
                        await runAction('archive')
                    }}
                />
            )}

            {mode === 'editor' && (
                <EditorView
                    selectedPage={selectedPage}
                    form={form}
                    step={step}
                    setStep={setStep}
                    validation={validation}
                    products={products}
                    categories={categories}
                    saving={saving}
                    updateForm={updateForm}
                    updateHero={updateHero}
                    updateDisplay={updateDisplay}
                    updateTracking={updateTracking}
                    generateSlug={generateSlug}
                    onBack={backToList}
                    onSaveDraft={() => savePage()}
                    onSaveAndNext={(next) => savePage({ advanceTo: next })}
                    onPublish={() => runAction('publish')}
                    onUnpublish={() => runAction('unpublish')}
                    onArchive={() => runAction('archive')}
                    onDuplicate={() => runAction('duplicate')}
                />
            )}

            {mode === 'analytics' && selectedPage && (
                <AnalyticsView page={selectedPage} onBack={backToList} onEdit={() => setMode('editor')} />
            )}
        </div>
    )
}

// ── List view ───────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string | number; accent: string }) {
    return (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>
                    <Icon className="h-4 w-4" />
                </span>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
        </div>
    )
}

function ListView(props: {
    pages: LandingPageAdminRecord[]
    allPages: LandingPageAdminRecord[]
    summary: { total: number; published: number; views: number; orders: number; revenue: number; conversion: number }
    search: string
    setSearch: (value: string) => void
    statusFilter: 'all' | LandingPageStatus | 'scheduled'
    setStatusFilter: (value: 'all' | LandingPageStatus | 'scheduled') => void
    sourceFilter: 'all' | 'manual' | 'category'
    setSourceFilter: (value: 'all' | 'manual' | 'category') => void
    view: 'table' | 'cards'
    setView: (value: 'table' | 'cards') => void
    onCreate: () => void
    onEdit: (page: LandingPageAdminRecord) => void
    onAnalytics: (page: LandingPageAdminRecord) => void
    onDuplicate: (page: LandingPageAdminRecord) => void
    onArchive: (page: LandingPageAdminRecord) => void
}) {
    const { pages, summary } = props
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const handleCopy = (page: LandingPageAdminRecord) => {
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        copyToClipboard(`${origin}/lp/${page.slug}`, (ok) => {
            if (ok) {
                setCopiedId(page.id)
                setTimeout(() => setCopiedId(null), 1500)
            }
        })
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer & Growth / Marketing</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Landing Pages</h1>
                    <p className="text-sm text-slate-500">Create and manage curated campaign landing pages.</p>
                </div>
                <button
                    type="button"
                    onClick={props.onCreate}
                    className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                >
                    <Plus className="h-4 w-4" /> Create Landing Page
                </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCard icon={FileText} label="Total Pages" value={formatNumber(summary.total)} accent="bg-emerald-50 text-emerald-700" />
                <SummaryCard icon={Rocket} label="Published" value={formatNumber(summary.published)} accent="bg-sky-50 text-sky-700" />
                <SummaryCard icon={Eye} label="Total Views" value={formatNumber(summary.views)} accent="bg-violet-50 text-violet-700" />
                <SummaryCard icon={DollarSign} label="Total Revenue" value={formatCurrency(summary.revenue)} accent="bg-orange-50 text-orange-700" />
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="relative w-full max-w-md">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={props.search}
                            onChange={(event) => props.setSearch(event.target.value)}
                            placeholder="Search landing pages by title or slug…"
                            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-500"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={props.statusFilter}
                            onChange={(event) => props.setStatusFilter(event.target.value as any)}
                            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
                        >
                            <option value="all">All Status</option>
                            <option value="draft">Draft</option>
                            <option value="scheduled">Scheduled</option>
                            <option value="published">Published</option>
                            <option value="archived">Archived</option>
                        </select>
                        <select
                            value={props.sourceFilter}
                            onChange={(event) => props.setSourceFilter(event.target.value as any)}
                            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
                        >
                            <option value="all">All Product Source</option>
                            <option value="manual">Manual Products</option>
                            <option value="category">Category Source</option>
                        </select>
                        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
                            <button
                                type="button"
                                onClick={() => props.setView('cards')}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${props.view === 'cards' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
                            >
                                Cards
                            </button>
                            <button
                                type="button"
                                onClick={() => props.setView('table')}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${props.view === 'table' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
                            >
                                Table
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {pages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                        <Sparkles className="h-6 w-6" />
                    </span>
                    <h2 className="mt-4 text-lg font-bold text-slate-900">No landing pages yet</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Build a curated campaign page with manual products or a category source.
                    </p>
                    <button
                        type="button"
                        onClick={props.onCreate}
                        className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                    >
                        <Plus className="h-4 w-4" /> Create your first landing page
                    </button>
                </div>
            ) : props.view === 'cards' ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {pages.map((page) => {
                        const scheduled = isScheduled(page)
                        return (
                            <article key={page.id} className="flex flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-bold text-slate-900">{page.internal_name}</p>
                                        <p className="truncate text-xs text-slate-500">/lp/{page.slug}</p>
                                    </div>
                                    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusPillClass(page.status, scheduled)}`}>
                                        {statusLabel(page.status, scheduled)}
                                    </span>
                                </div>
                                <div className="mt-3 flex gap-3">
                                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
                                        {page.hero.hero_image_url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={page.hero.hero_image_url} alt="" className="h-full w-full object-contain" />
                                        ) : (
                                            <Package className="h-6 w-6 text-slate-300" />
                                        )}
                                    </div>
                                    <div className="min-w-0 text-xs text-slate-500">
                                        <p className="line-clamp-2 text-slate-700">{page.public_title}</p>
                                        <p className="mt-1 inline-flex items-center gap-1"><Layers className="h-3 w-3" /> {page.source_mode === 'manual' ? 'Manual Products' : 'Category Source'}</p>
                                    </div>
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center text-xs">
                                    <div><p className="font-bold text-slate-900">{formatNumber(page.metrics.views)}</p><p className="text-slate-500">Views</p></div>
                                    <div><p className="font-bold text-slate-900">{formatNumber(page.metrics.orders)}</p><p className="text-slate-500">Orders</p></div>
                                    <div><p className="font-bold text-slate-900">{formatCurrency(page.metrics.revenue)}</p><p className="text-slate-500">Revenue</p></div>
                                </div>
                                <div className="mt-4 flex flex-wrap items-center justify-end gap-1.5">
                                    <Link href={previewPath(page)} target="_blank" className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Eye className="h-3.5 w-3.5" /> Preview</Link>
                                    <button type="button" onClick={() => props.onEdit(page)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-700"><Settings2 className="h-3.5 w-3.5" /> Edit</button>
                                    <button type="button" onClick={() => props.onAnalytics(page)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><BarChart3 className="h-3.5 w-3.5" /> Analytics</button>
                                    <button type="button" onClick={() => handleCopy(page)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Copy className="h-3.5 w-3.5" /> {copiedId === page.id ? 'Copied' : 'Copy'}</button>
                                </div>
                            </article>
                        )
                    })}
                </div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-4 py-3 text-left">Title</th>
                                    <th className="px-4 py-3 text-left">Slug</th>
                                    <th className="px-4 py-3 text-left">Status</th>
                                    <th className="px-4 py-3 text-left">Source</th>
                                    <th className="px-4 py-3 text-right">Views</th>
                                    <th className="px-4 py-3 text-right">Orders</th>
                                    <th className="px-4 py-3 text-right">Revenue</th>
                                    <th className="px-4 py-3 text-left">Updated</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {pages.map((page) => {
                                    const scheduled = isScheduled(page)
                                    return (
                                        <tr key={page.id} className="hover:bg-slate-50/60">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                                                        {page.hero.hero_image_url ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img src={page.hero.hero_image_url} alt="" className="h-full w-full object-contain" />
                                                        ) : (
                                                            <Package className="h-4 w-4 text-slate-300" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="truncate font-semibold text-slate-900">{page.internal_name}</p>
                                                        <p className="truncate text-xs text-slate-500">{page.public_title}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-slate-600">{page.slug}</td>
                                            <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusPillClass(page.status, scheduled)}`}>{statusLabel(page.status, scheduled)}</span></td>
                                            <td className="px-4 py-3 text-xs text-slate-600">{page.source_mode === 'manual' ? 'Manual' : 'Category'}</td>
                                            <td className="px-4 py-3 text-right">{formatNumber(page.metrics.views)}</td>
                                            <td className="px-4 py-3 text-right">{formatNumber(page.metrics.orders)}</td>
                                            <td className="px-4 py-3 text-right">{formatCurrency(page.metrics.revenue)}</td>
                                            <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(page.updated_at)}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Link href={previewPath(page)} target="_blank" title="Preview" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Eye className="h-4 w-4" /></Link>
                                                    <button type="button" title="Edit" onClick={() => props.onEdit(page)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Settings2 className="h-4 w-4" /></button>
                                                    <button type="button" title="Analytics" onClick={() => props.onAnalytics(page)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><BarChart3 className="h-4 w-4" /></button>
                                                    <button type="button" title="Copy link" onClick={() => handleCopy(page)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Copy className="h-4 w-4" /></button>
                                                    <button type="button" title="Duplicate" onClick={() => props.onDuplicate(page)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Layers className="h-4 w-4" /></button>
                                                    <button type="button" title="Archive" onClick={() => props.onArchive(page)} disabled={page.status === 'archived'} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Editor view ─────────────────────────────────────────────────────────

interface EditorProps {
    selectedPage: LandingPageAdminRecord | null
    form: LandingPagePayload
    step: Step
    setStep: (step: Step) => void
    validation: { key: string; text: string; step: Step }[]
    products: LandingPageProductOption[]
    categories: LandingPageCategoryOption[]
    saving: boolean
    updateForm: <K extends keyof LandingPagePayload>(key: K, value: LandingPagePayload[K]) => void
    updateHero: <K extends keyof LandingPageHeroConfig>(key: K, value: LandingPageHeroConfig[K]) => void
    updateDisplay: <K extends keyof LandingPageDisplaySettings>(key: K, value: LandingPageDisplaySettings[K]) => void
    updateTracking: <K extends keyof LandingPageTrackingDefaults>(key: K, value: LandingPageTrackingDefaults[K]) => void
    generateSlug: () => void
    onBack: () => void
    onSaveDraft: () => void
    onSaveAndNext: (next: Step) => void
    onPublish: () => void
    onUnpublish: () => void
    onArchive: () => void
    onDuplicate: () => void
}

function EditorView(props: EditorProps) {
    const { form, step, setStep, validation, selectedPage, saving } = props
    const currentStepMeta = STEPS.find((s) => s.id === step)!
    const issuesForStep = (id: Step) => validation.filter((issue) => issue.step === id)
    const stepIsComplete = (id: Step) => issuesForStep(id).length === 0

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                    <button type="button" onClick={props.onBack} className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></button>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Landing Pages / {selectedPage ? 'Edit' : 'Create'}</p>
                        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                            {selectedPage ? selectedPage.internal_name || 'Untitled Landing Page' : 'Create Landing Page'}
                        </h1>
                        <p className="text-sm text-slate-500">{currentStepMeta.label} — {currentStepMeta.hint}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {selectedPage && (
                        <Link href={previewPath(selectedPage)} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Eye className="h-4 w-4" /> Preview</Link>
                    )}
                    <button type="button" onClick={props.onSaveDraft} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
                    </button>
                    {step < 5 ? (
                        <button type="button" onClick={() => props.onSaveAndNext((step + 1) as Step)} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
                            Next: {STEPS[step].label} <ArrowRight className="h-4 w-4" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={props.onPublish}
                            disabled={saving || validation.length > 0 || selectedPage?.status === 'archived'}
                            className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                            title={validation.length > 0 ? 'Resolve validation issues first' : ''}
                        >
                            <Rocket className="h-4 w-4" /> {selectedPage?.status === 'published' ? 'Republish' : 'Publish'}
                        </button>
                    )}
                </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[260px_1fr_280px]">
                {/* Step rail */}
                <aside className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                    <ol className="space-y-1">
                        {STEPS.map((s) => {
                            const active = s.id === step
                            const ok = stepIsComplete(s.id)
                            const Icon = s.icon
                            return (
                                <li key={s.id}>
                                    <button
                                        type="button"
                                        onClick={() => setStep(s.id)}
                                        className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                                    >
                                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? 'bg-emerald-600 text-white' : ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                            {ok && !active ? <CheckCircle2 className="h-4 w-4" /> : s.id}
                                        </span>
                                        <div className="min-w-0">
                                            <p className={`text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-700'}`}>
                                                <Icon className="mr-1.5 inline h-3.5 w-3.5 -translate-y-0.5 text-slate-400" />
                                                {s.label}
                                            </p>
                                            <p className="text-xs text-slate-500">{s.hint}</p>
                                        </div>
                                    </button>
                                </li>
                            )
                        })}
                    </ol>
                </aside>

                {/* Step body */}
                <section className="space-y-5">
                    {step === 1 && <StepBasicInfo {...props} />}
                    {step === 2 && <StepDesign {...props} />}
                    {step === 3 && <StepProducts {...props} />}
                    {step === 4 && <StepCtaTracking {...props} />}
                    {step === 5 && <StepPreviewPublish {...props} />}
                </section>

                {/* Right rail: validation + status */}
                <aside className="space-y-4">
                    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-900">Validation</h3>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${validation.length === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                {validation.length === 0 ? 'All good' : `${validation.length} issue${validation.length === 1 ? '' : 's'}`}
                            </span>
                        </div>
                        {validation.length === 0 ? (
                            <p className="mt-2 text-xs text-slate-500">You can publish whenever you are ready.</p>
                        ) : (
                            <ul className="mt-3 space-y-1.5 text-xs">
                                {validation.map((issue) => (
                                    <li key={issue.key} className="flex items-start gap-2 text-amber-800">
                                        <button type="button" onClick={() => setStep(issue.step)} className="text-left hover:underline">
                                            <span className="mr-1 font-bold text-amber-700">Step {issue.step}:</span>
                                            {issue.text}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {selectedPage && (
                        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-900">Page Status</h3>
                            <dl className="mt-3 space-y-2 text-xs">
                                <div className="flex items-center justify-between"><dt className="text-slate-500">Status</dt><dd><span className={`rounded-full border px-2 py-0.5 font-bold ${statusPillClass(selectedPage.status, isScheduled(selectedPage))}`}>{statusLabel(selectedPage.status, isScheduled(selectedPage))}</span></dd></div>
                                <div className="flex items-center justify-between"><dt className="text-slate-500">Published</dt><dd className="text-slate-700">{formatDateTime(selectedPage.published_at)}</dd></div>
                                <div className="flex items-center justify-between"><dt className="text-slate-500">Updated</dt><dd className="text-slate-700">{formatDateTime(selectedPage.updated_at)}</dd></div>
                                <div className="flex items-center justify-between"><dt className="text-slate-500">Products</dt><dd className="text-slate-700">{selectedPage.selected_products_count}</dd></div>
                            </dl>
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                {selectedPage.status === 'published' && (
                                    <button type="button" onClick={props.onUnpublish} disabled={saving} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Unpublish</button>
                                )}
                                <button type="button" onClick={props.onDuplicate} disabled={saving} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><Copy className="h-3.5 w-3.5" /> Duplicate</button>
                                <button type="button" onClick={() => { if (window.confirm('Archive this landing page?')) props.onArchive() }} disabled={saving || selectedPage.status === 'archived'} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"><Archive className="h-3.5 w-3.5" /> Archive</button>
                            </div>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    )
}

// ── Step 1: Basic Info ──────────────────────────────────────────────────

function StepBasicInfo(props: EditorProps) {
    const { form, updateForm, generateSlug } = props
    return (
        <div className="space-y-4">
            <Card title="Basic Information" subtitle="Provide the essential details for your landing page.">
                <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Internal Name" required hint="For your team's reference only.">
                        <input value={form.internal_name} onChange={(event) => updateForm('internal_name', event.target.value)} maxLength={100} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
                        <CharCount value={form.internal_name} max={100} />
                    </Field>
                    <Field label="Public Title" required hint="This will be visible to your audience.">
                        <input value={form.public_title} onChange={(event) => {
                            updateForm('public_title', event.target.value)
                            if (!form.slug) updateForm('slug', normalizeLandingPageSlug(event.target.value))
                        }} maxLength={100} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
                        <CharCount value={form.public_title} max={100} />
                    </Field>
                </div>
                <Field label="Slug" required hint="This will be used in the page URL.">
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
                        <span className="text-xs text-slate-500">/lp/</span>
                        <input value={form.slug} onChange={(event) => updateForm('slug', normalizeLandingPageSlug(event.target.value))} placeholder="campaign-slug" className="h-10 flex-1 bg-transparent text-sm outline-none" />
                        <button type="button" onClick={generateSlug} className="text-xs font-semibold text-emerald-700 hover:text-emerald-800">Auto-generate</button>
                    </div>
                </Field>
                <Field label="Description" hint="Briefly describe what this landing page is about.">
                    <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} rows={3} maxLength={500} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                    <CharCount value={form.description} max={500} />
                </Field>
            </Card>

            <Card title="Schedule" subtitle="Optionally set a publish window. Status determines visibility.">
                <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Status">
                        <select value={form.status} onChange={(event) => updateForm('status', event.target.value as LandingPageStatus)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500">
                            <option value="draft">Draft</option>
                            <option value="published">Published</option>
                            <option value="archived">Archived</option>
                        </select>
                    </Field>
                    <Field label="Publish Start" hint="When should this page go live?">
                        <input type="datetime-local" value={form.publish_start_at ? form.publish_start_at.slice(0, 16) : ''} onChange={(event) => updateForm('publish_start_at', event.target.value ? new Date(event.target.value).toISOString() : null)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
                    </Field>
                    <Field label="Publish End" hint="Optional. When should it stop being visible?">
                        <input type="datetime-local" value={form.publish_end_at ? form.publish_end_at.slice(0, 16) : ''} onChange={(event) => updateForm('publish_end_at', event.target.value ? new Date(event.target.value).toISOString() : null)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
                    </Field>
                </div>
            </Card>
        </div>
    )
}

// ── Step 2: Page Design ─────────────────────────────────────────────────

function StepDesign(props: EditorProps) {
    const { form, updateHero } = props
    return (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,420px)]">
            <Card title="Hero Section" subtitle="Customize the hero area at the top of your landing page.">
                <Field label="Badge"><input value={form.hero.badge_text} onChange={(event) => updateHero('badge_text', event.target.value)} placeholder="Exclusive Deal" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                <Field label="Headline" required><input value={form.hero.headline} onChange={(event) => updateHero('headline', event.target.value)} maxLength={100} placeholder="e.g. Vape Smarter. Save Bigger." className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /><CharCount value={form.hero.headline} max={100} /></Field>
                <Field label="Subtitle"><textarea value={form.hero.subtitle} onChange={(event) => updateHero('subtitle', event.target.value)} rows={2} maxLength={160} placeholder="Premium products at limited-time pricing." className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" /><CharCount value={form.hero.subtitle} max={160} /></Field>
                <Field label="Hero Image URL" hint="Recommended 1600 × 900 px. Falls back to first product image."><input value={form.hero.hero_image_url} onChange={(event) => updateHero('hero_image_url', event.target.value)} placeholder="https://…" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Primary CTA Label"><input value={form.hero.primary_cta_label} onChange={(event) => updateHero('primary_cta_label', event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                    <Field label="Secondary CTA Label"><input value={form.hero.secondary_cta_label} onChange={(event) => updateHero('secondary_cta_label', event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                </div>
                <Field label="Secondary CTA URL" hint="Optional. If empty, scrolls to products."><input value={form.hero.secondary_cta_url} onChange={(event) => updateHero('secondary_cta_url', event.target.value)} placeholder="/store/products" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
            </Card>

            <div className="space-y-3">
                <Card title="Live Preview" subtitle="Changes update automatically.">
                    <HeroPreview hero={form.hero} fallbackTitle={form.public_title} fallbackSubtitle={form.description} />
                </Card>
                <Card title="Sections" subtitle="MVP uses a fixed campaign template. Toggle ancillary blocks below.">
                    <p className="text-xs text-slate-500">
                        Trust strip, FAQ, testimonials and footer are part of the campaign template and always visible on public pages. Granular toggles will be added in a future iteration.
                    </p>
                </Card>
            </div>
        </div>
    )
}

function HeroPreview({ hero, fallbackTitle, fallbackSubtitle }: { hero: LandingPageHeroConfig; fallbackTitle: string; fallbackSubtitle: string }) {
    return (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br from-emerald-50 via-white to-orange-50 p-5">
            {hero.badge_text && (
                <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">{hero.badge_text}</span>
            )}
            <h3 className="mt-3 text-xl font-bold text-slate-900">{hero.headline || fallbackTitle || 'Your headline'}</h3>
            <p className="mt-1 text-sm text-slate-600 line-clamp-3">{hero.subtitle || fallbackSubtitle || 'Add a short subtitle to introduce the campaign.'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex h-9 items-center rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white">{hero.primary_cta_label || 'Shop Now'}</span>
                {hero.secondary_cta_label && (
                    <span className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">{hero.secondary_cta_label}</span>
                )}
            </div>
            <div className="mt-4 aspect-[16/9] overflow-hidden rounded-xl border border-slate-100 bg-white">
                {hero.hero_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={hero.hero_image_url} alt="" className="h-full w-full object-contain p-3" />
                ) : (
                    <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-10 w-10" /></div>
                )}
            </div>
        </div>
    )
}

// ── Step 3: Products ────────────────────────────────────────────────────

function StepProducts(props: EditorProps) {
    const { form, updateForm, products, categories } = props
    const [query, setQuery] = useState('')
    const [categoryFilter, setCategoryFilter] = useState('')
    const [hideOOS, setHideOOS] = useState(false)

    const filteredCatalog = useMemo(() => {
        const q = query.trim().toLowerCase()
        return products.filter((product) => {
            if (categoryFilter && product.category_id !== categoryFilter) return false
            if (hideOOS && !product.can_purchase) return false
            if (q) {
                const hay = `${product.product_name} ${product.product_code} ${product.category_name ?? ''} ${product.brand_name ?? ''}`.toLowerCase()
                if (!hay.includes(q)) return false
            }
            return true
        })
    }, [products, query, categoryFilter, hideOOS])

    const selectedIds = form.selected_product_ids
    const selectedDetails = useMemo(() => selectedIds.map((id) => products.find((p) => p.id === id)).filter(Boolean) as LandingPageProductOption[], [selectedIds, products])
    const max = Math.max(1, Math.min(60, form.max_products || 12))

    const addProduct = (id: string) => {
        if (selectedIds.includes(id)) return
        if (selectedIds.length >= max) return
        updateForm('selected_product_ids', [...selectedIds, id])
    }
    const removeProduct = (id: string) => {
        updateForm('selected_product_ids', selectedIds.filter((value) => value !== id))
    }
    const reorder = (id: string, direction: -1 | 1) => {
        const next = [...selectedIds]
        const index = next.indexOf(id)
        if (index < 0) return
        const target = index + direction
        if (target < 0 || target >= next.length) return
        ;[next[index], next[target]] = [next[target], next[index]]
        updateForm('selected_product_ids', next)
    }

    return (
        <div className="space-y-4">
            <Card title="1. Select Product Source" subtitle="Curated products only. Empty sources stay empty — no all-products fallback.">
                <div className="grid gap-3 sm:grid-cols-2">
                    <SourceCard
                        active={form.source_mode === 'manual'}
                        onClick={() => updateForm('source_mode', 'manual')}
                        title="Manual Products"
                        description="Search and select specific products to feature."
                        icon={Pin}
                    />
                    <SourceCard
                        active={form.source_mode === 'category'}
                        onClick={() => updateForm('source_mode', 'category')}
                        title="Category Source"
                        description="Automatically pull all in-stock products from a category."
                        icon={Layers}
                    />
                </div>
            </Card>

            {form.source_mode === 'manual' ? (
                <Card title="2. Selected Products" subtitle={`${selectedIds.length}/${max} selected`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="relative w-full max-w-md">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by product name, SKU or code" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-500" />
                        </div>
                        <div className="flex items-center gap-2">
                            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500">
                                <option value="">All Categories</option>
                                {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                            </select>
                            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                                <input type="checkbox" checked={hideOOS} onChange={(event) => setHideOOS(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                                Hide unavailable
                            </label>
                        </div>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
                        {/* Catalog */}
                        <div className="overflow-hidden rounded-xl border border-slate-100">
                            <div className="max-h-[480px] overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Product</th>
                                            <th className="px-3 py-2 text-left">Code</th>
                                            <th className="px-3 py-2 text-right">Price</th>
                                            <th className="px-3 py-2 text-right">Stock</th>
                                            <th className="px-3 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredCatalog.length === 0 ? (
                                            <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">No products match.</td></tr>
                                        ) : filteredCatalog.map((product) => {
                                            const added = selectedIds.includes(product.id)
                                            return (
                                                <tr key={product.id} className="hover:bg-slate-50/60">
                                                    <td className="px-3 py-2">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                                                                {product.image_url ? (
                                                                    // eslint-disable-next-line @next/next/no-img-element
                                                                    <img src={product.image_url} alt="" className="h-full w-full object-contain" />
                                                                ) : (
                                                                    <Package className="h-4 w-4 text-slate-300" />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="truncate font-semibold text-slate-900">{product.product_name}</p>
                                                                <p className="truncate text-xs text-slate-500">{product.category_name || 'Uncategorized'}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{product.product_code}</td>
                                                    <td className="px-3 py-2 text-right text-xs font-semibold text-slate-900">{product.starting_price ? formatCurrency(product.starting_price) : '—'}</td>
                                                    <td className="px-3 py-2 text-right text-xs">{product.can_purchase ? <span className="text-emerald-700">In stock</span> : <span className="text-red-600">Unavailable</span>}</td>
                                                    <td className="px-3 py-2 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => added ? removeProduct(product.id) : addProduct(product.id)}
                                                            disabled={!added && selectedIds.length >= max}
                                                            className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold ${added ? 'border border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'}`}
                                                        >
                                                            {added ? <><X className="h-3.5 w-3.5" /> Remove</> : <><Plus className="h-3.5 w-3.5" /> Add</>}
                                                        </button>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Selected panel */}
                        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected ({selectedIds.length}/{max})</p>
                            {selectedDetails.length === 0 ? (
                                <p className="mt-3 text-xs text-slate-500">No products selected yet. Pick from the list to feature them.</p>
                            ) : (
                                <ul className="mt-3 space-y-2">
                                    {selectedDetails.map((product, index) => (
                                        <li key={product.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white p-2">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                                                {product.image_url ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={product.image_url} alt="" className="h-full w-full object-contain" />
                                                ) : (
                                                    <Package className="h-4 w-4 text-slate-300" />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-xs font-semibold text-slate-900">{product.product_name}</p>
                                                <p className="truncate text-[11px] text-slate-500">{product.starting_price ? formatCurrency(product.starting_price) : '—'}</p>
                                            </div>
                                            <div className="flex items-center gap-0.5">
                                                <button type="button" disabled={index === 0} onClick={() => reorder(product.id, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">↑</button>
                                                <button type="button" disabled={index === selectedDetails.length - 1} onClick={() => reorder(product.id, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">↓</button>
                                                <button type="button" onClick={() => removeProduct(product.id)} className="rounded p-1 text-red-500 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className="mt-3">
                                <Field label="Max products to display" hint="Limit how many products are shown.">
                                    <input type="number" min={1} max={60} value={form.max_products} onChange={(event) => updateForm('max_products', Math.max(1, Math.min(60, Number(event.target.value) || 12)))} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
                                </Field>
                            </div>
                        </div>
                    </div>
                </Card>
            ) : (
                <Card title="2. Category Source" subtitle="All eligible products from the selected category will be resolved server-side.">
                    <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                        <Field label="Category" required>
                            <select value={form.category_id ?? ''} onChange={(event) => updateForm('category_id', event.target.value || null)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500">
                                <option value="">Select a category</option>
                                {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                            </select>
                        </Field>
                        <Field label="Max Products">
                            <input type="number" min={1} max={60} value={form.max_products} onChange={(event) => updateForm('max_products', Math.max(1, Math.min(60, Number(event.target.value) || 12)))} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
                        </Field>
                    </div>
                </Card>
            )}

            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <Sparkles className="mt-0.5 h-4 w-4 text-amber-600" />
                <div>
                    <p className="font-bold">Curated products only</p>
                    <p>This landing page will only display the products you select or products from the selected category. There is no all-products fallback.</p>
                </div>
            </div>
        </div>
    )
}

function SourceCard({ active, onClick, title, description, icon: Icon }: { active: boolean; onClick: () => void; title: string; description: string; icon: any }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition ${active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                <Icon className="h-5 w-5" />
            </span>
            <span>
                <p className="text-sm font-bold text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            </span>
        </button>
    )
}

// ── Step 4: CTA, Display & Tracking ─────────────────────────────────────

function StepCtaTracking(props: EditorProps) {
    const { form, updateDisplay, updateTracking } = props
    const display = form.display_settings
    const purchaseCtaRequested = display.cta_mode === 'add_to_cart' || display.cta_mode === 'buy_now' || display.enable_add_to_cart || display.enable_buy_now
    const priceWarning = !display.show_price && purchaseCtaRequested

    return (
        <div className="space-y-4">
            <Card title="Display Settings" subtitle="Choose which product information and actions to show on your landing page.">
                <div className="grid gap-3 md:grid-cols-2">
                    <ToggleRow label="Show Price" description="Display product price on the landing page." checked={display.show_price} onChange={(value) => updateDisplay('show_price', value)} />
                    <ToggleRow label="Show Brand" description="Display product brand or manufacturer." checked={display.show_brand} onChange={(value) => updateDisplay('show_brand', value)} />
                    <ToggleRow label="Show Category" description="Display product category." checked={display.show_category} onChange={(value) => updateDisplay('show_category', value)} />
                    <ToggleRow label="Hide Out of Stock" description="Hide products that are out of stock." checked={display.hide_out_of_stock} onChange={(value) => updateDisplay('hide_out_of_stock', value)} />
                    <ToggleRow label="Enable Add to Cart" description="Allow customers to add products to cart." checked={display.enable_add_to_cart} onChange={(value) => updateDisplay('enable_add_to_cart', value)} />
                    <ToggleRow label="Enable Buy Now" description="Allow direct purchase of the product." checked={display.enable_buy_now} onChange={(value) => updateDisplay('enable_buy_now', value)} />
                    <ToggleRow label="Enable WhatsApp Inquiry" description="Show WhatsApp button for inquiries." checked={display.enable_whatsapp} onChange={(value) => updateDisplay('enable_whatsapp', value)} />
                </div>
                {priceWarning && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        When <b>Show Price</b> is turned off, <b>Add to Cart</b> and <b>Buy Now</b> will be disabled automatically.
                    </div>
                )}
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
                <Card title="CTA Mode" subtitle="Choose how visitors take action on this landing page.">
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { value: 'view_product', label: 'View Product' },
                            { value: 'add_to_cart', label: 'Add to Cart' },
                            { value: 'buy_now', label: 'Buy Now' },
                            { value: 'whatsapp', label: 'WhatsApp Inquiry' },
                        ].map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => updateDisplay('cta_mode', option.value as LandingPageDisplaySettings['cta_mode'])}
                                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${display.cta_mode === option.value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </Card>
                <Card title="WhatsApp Inquiry" subtitle="Provide your WhatsApp number to receive inquiries.">
                    <Field label="WhatsApp Number" hint="Include country code. Example: +60 12-345 6789">
                        <input value={display.whatsapp_phone} onChange={(event) => updateDisplay('whatsapp_phone', event.target.value)} placeholder="+60 12-345 6789" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" />
                    </Field>
                </Card>
            </div>

            <Card title="Tracking Settings" subtitle="These values will be appended to your landing page URL as UTM parameters.">
                <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Source Code"><input value={form.tracking_defaults.source_code} onChange={(event) => updateTracking('source_code', event.target.value)} placeholder="d1-vape-kit-promo" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                    <Field label="UTM Source"><input value={form.tracking_defaults.utm_source} onChange={(event) => updateTracking('utm_source', event.target.value)} placeholder="serapod2u" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                    <Field label="UTM Medium"><input value={form.tracking_defaults.utm_medium} onChange={(event) => updateTracking('utm_medium', event.target.value)} placeholder="cpc" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                    <Field label="UTM Campaign"><input value={form.tracking_defaults.utm_campaign} onChange={(event) => updateTracking('utm_campaign', event.target.value)} placeholder="d1-vape-launch" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                    <Field label="UTM Content"><input value={form.tracking_defaults.utm_content} onChange={(event) => updateTracking('utm_content', event.target.value)} placeholder="hero-banner" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                    <Field label="UTM Term"><input value={form.tracking_defaults.utm_term} onChange={(event) => updateTracking('utm_term', event.target.value)} placeholder="optional" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500" /></Field>
                </div>
            </Card>

            <PublicLinkPreview slug={form.slug} tracking={form.tracking_defaults} />
        </div>
    )
}

function PublicLinkPreview({ slug, tracking }: { slug: string; tracking: LandingPageTrackingDefaults }) {
    const [origin, setOrigin] = useState('')
    const [copied, setCopied] = useState(false)
    useEffect(() => { if (typeof window !== 'undefined') setOrigin(window.location.origin) }, [])
    const link = origin && slug ? buildPublicLink(origin, slug, tracking) : ''
    return (
        <Card title="Public Link Preview" subtitle="Share this link to direct visitors to your landing page.">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <code className="flex-1 truncate text-xs text-slate-700">{link || '—'}</code>
                <button
                    type="button"
                    disabled={!link}
                    onClick={() => copyToClipboard(link, (ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) } })}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                    <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy Link'}
                </button>
            </div>
        </Card>
    )
}

// ── Step 5: Preview & Publish ───────────────────────────────────────────

function StepPreviewPublish(props: EditorProps) {
    const { form, selectedPage, validation, saving, onPublish, onUnpublish } = props
    const [origin, setOrigin] = useState('')
    const [copied, setCopied] = useState(false)
    useEffect(() => { if (typeof window !== 'undefined') setOrigin(window.location.origin) }, [])
    const shareLink = origin && form.slug ? `${origin}/lp/${form.slug}` : ''

    return (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card title="Preview" subtitle="Review the public page before going live.">
                {selectedPage ? (
                    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
                        <iframe
                            src={`/lp/${selectedPage.slug}?preview=${selectedPage.id}`}
                            title="Landing page preview"
                            className="h-[600px] w-full"
                        />
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                        Save the draft first to preview the page.
                    </div>
                )}
                {selectedPage && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Link href={`/lp/${selectedPage.slug}?preview=${selectedPage.id}`} target="_blank" className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ExternalLink className="h-3.5 w-3.5" /> Open Preview</Link>
                        {selectedPage.status === 'published' && (
                            <Link href={`/lp/${selectedPage.slug}`} target="_blank" className="inline-flex h-9 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"><Globe2 className="h-3.5 w-3.5" /> View Live</Link>
                        )}
                    </div>
                )}
            </Card>

            <div className="space-y-4">
                <Card title="Publish Settings" subtitle="Status and schedule.">
                    <dl className="space-y-2 text-sm">
                        <div className="flex items-center justify-between"><dt className="text-slate-500">Status</dt><dd><span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusPillClass(form.status, selectedPage ? isScheduled(selectedPage) : false)}`}>{statusLabel(form.status, selectedPage ? isScheduled(selectedPage) : false)}</span></dd></div>
                        <div className="flex items-center justify-between"><dt className="text-slate-500">Publish Start</dt><dd className="text-xs text-slate-700">{formatDateTime(form.publish_start_at)}</dd></div>
                        <div className="flex items-center justify-between"><dt className="text-slate-500">Publish End</dt><dd className="text-xs text-slate-700">{formatDateTime(form.publish_end_at)}</dd></div>
                        <div className="flex items-center justify-between"><dt className="text-slate-500">Slug</dt><dd className="font-mono text-xs text-slate-700">/{form.slug}</dd></div>
                    </dl>
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <code className="flex-1 truncate text-xs text-slate-700">{shareLink || '—'}</code>
                        <button type="button" disabled={!shareLink} onClick={() => copyToClipboard(shareLink, (ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) } })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                            <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                </Card>

                <Card title="Validation Checklist">
                    <ul className="space-y-1.5 text-xs">
                        <ChecklistRow ok={form.hero.headline.trim().length > 0} label="Hero section is set" />
                        <ChecklistRow ok={form.source_mode === 'manual' ? form.selected_product_ids.length > 0 : Boolean(form.category_id)} label="Product source configured" />
                        <ChecklistRow ok={!(!form.display_settings.show_price && (form.display_settings.enable_add_to_cart || form.display_settings.enable_buy_now))} label="CTA configuration is valid" />
                        <ChecklistRow ok={Boolean(form.slug)} label="Slug is set" />
                        <ChecklistRow ok={!(form.publish_start_at && form.publish_end_at && new Date(form.publish_start_at) >= new Date(form.publish_end_at))} label="Schedule is valid" />
                    </ul>
                    <div className="mt-3 flex flex-col gap-2">
                        {selectedPage?.status === 'published' ? (
                            <button type="button" onClick={onUnpublish} disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Unpublish Landing Page</button>
                        ) : (
                            <button type="button" onClick={onPublish} disabled={saving || validation.length > 0} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                                <Rocket className="h-4 w-4" /> {validation.length > 0 ? `Resolve ${validation.length} issue${validation.length === 1 ? '' : 's'}` : 'Publish Landing Page'}
                            </button>
                        )}
                    </div>
                </Card>
            </div>
        </div>
    )
}

function ChecklistRow({ ok, label }: { ok: boolean; label: string }) {
    return (
        <li className={`flex items-center gap-2 ${ok ? 'text-emerald-700' : 'text-slate-500'}`}>
            <CheckCircle2 className={`h-3.5 w-3.5 ${ok ? 'text-emerald-600' : 'text-slate-300'}`} /> {label}
        </li>
    )
}

// ── Analytics view ─────────────────────────────────────────────────────

function AnalyticsView({ page, onBack, onEdit }: { page: LandingPageAdminRecord; onBack: () => void; onEdit: () => void }) {
    const metrics = page.metrics || EMPTY_LANDING_PAGE_METRICS
    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                    <button type="button" onClick={onBack} className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></button>
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Landing Pages / Analytics</p>
                        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{page.internal_name}</h1>
                        <p className="text-sm text-slate-500">Track performance and insights for this landing page.</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link href={previewPath(page)} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Eye className="h-4 w-4" /> Preview</Link>
                    <button type="button" onClick={onEdit} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"><Settings2 className="h-4 w-4" /> Edit Page</button>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <SummaryCard icon={Eye} label="Views" value={formatNumber(metrics.views)} accent="bg-emerald-50 text-emerald-700" />
                <SummaryCard icon={Users} label="Sessions" value={formatNumber(metrics.sessions)} accent="bg-sky-50 text-sky-700" />
                <SummaryCard icon={ShoppingCart} label="Add to Cart" value={formatNumber(metrics.add_to_cart)} accent="bg-orange-50 text-orange-700" />
                <SummaryCard icon={ShoppingBag} label="Orders" value={formatNumber(metrics.orders)} accent="bg-violet-50 text-violet-700" />
                <SummaryCard icon={DollarSign} label="Revenue" value={formatCurrency(metrics.revenue)} accent="bg-emerald-50 text-emerald-700" />
                <SummaryCard icon={TrendingUp} label="Conversion" value={`${metrics.conversion_rate}%`} accent="bg-sky-50 text-sky-700" />
            </div>

            <Card title="Conversion Funnel" subtitle="From landing page view to completed order.">
                <FunnelRow label="Landing Page Views" value={metrics.views} of={metrics.views || 1} color="bg-emerald-500" />
                <FunnelRow label="Sessions" value={metrics.sessions} of={metrics.views || 1} color="bg-sky-500" />
                <FunnelRow label="Add to Cart" value={metrics.add_to_cart} of={metrics.views || 1} color="bg-orange-500" />
                <FunnelRow label="Checkout Initiated" value={metrics.checkout_starts} of={metrics.views || 1} color="bg-violet-500" />
                <FunnelRow label="Orders" value={metrics.orders} of={metrics.views || 1} color="bg-emerald-700" />
            </Card>

            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
                <LineChart className="mx-auto h-6 w-6 text-slate-400" />
                <p className="mt-2">Detailed time-series charts, traffic sources, and per-product performance breakdowns are planned for the next iteration.</p>
                <p>Aggregate numbers above stay live as the public page receives traffic.</p>
            </div>
        </div>
    )
}

function FunnelRow({ label, value, of, color }: { label: string; value: number; of: number; color: string }) {
    const pct = of > 0 ? Math.min(100, Math.round((value / of) * 100)) : 0
    return (
        <div className="mt-2 first:mt-0">
            <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">{label}</span>
                <span className="text-slate-500">{formatNumber(value)} <span className="text-slate-400">({pct}%)</span></span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    )
}

// ── Generic UI primitives ───────────────────────────────────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <header className="mb-4">
                <h2 className="text-sm font-bold text-slate-900">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
            </header>
            <div className="space-y-4">{children}</div>
        </section>
    )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {label}
                {required && <Tag className="h-3 w-3 text-red-500" />}
            </span>
            {children}
            {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
        </label>
    )
}

function CharCount({ value, max }: { value: string; max: number }) {
    return <span className="mt-1 block text-right text-[11px] text-slate-400">{value.length} / {max}</span>
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
            <span>
                <span className="block text-sm font-semibold text-slate-900">{label}</span>
                <span className="block text-xs text-slate-500">{description}</span>
            </span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-emerald-600' : 'bg-slate-200'}`}
            >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
            </button>
        </label>
    )
}
// Unused-import guard for tree-shaking-friendly imports
void MessageCircle
