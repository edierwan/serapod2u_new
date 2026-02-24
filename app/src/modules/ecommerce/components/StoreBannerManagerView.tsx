'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Plus,
  Trash2,
  GripVertical,
  Eye,
  EyeOff,
  ExternalLink,
  Upload,
  Image as ImageIcon,
  Save,
  ArrowLeft,
  Loader2,
  Calendar,
  Link as LinkIcon,
  LayoutGrid,
  Settings2,
  Columns,
  RotateCcw,
} from 'lucide-react'
import AnimationSettingsPanel from './AnimationSettingsPanel'
import BannerImageUploader from './BannerImageUploader'
import type { AnimationStyle, AnimationIntensity } from '@/lib/storefront/banner-constants'
import { DEFAULT_ANIMATION_CONFIG } from '@/lib/storefront/banner-constants'

// ── Types ─────────────────────────────────────────────────────────

type LayoutSlot = 'carousel' | 'split_main' | 'split_side_top' | 'split_side_bottom'

interface StoreBanner {
  id: string
  title: string
  subtitle: string
  badge_text: string
  image_url: string
  link_url: string
  link_text: string
  sort_order: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  layout_slot: LayoutSlot
  created_at: string
  updated_at: string
}

interface HeroConfig {
  layout_type: 'carousel' | 'split'
  auto_rotate_interval: number
  max_slides: number
}

const LAYOUT_SLOT_LABELS: Record<LayoutSlot, string> = {
  carousel: 'Carousel Slide',
  split_main: 'Split — Main (Left)',
  split_side_top: 'Split — Side Top (Right)',
  split_side_bottom: 'Split — Side Bottom (Right)',
}

const LAYOUT_SLOT_COLORS: Record<LayoutSlot, string> = {
  carousel: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  split_main: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  split_side_top: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  split_side_bottom: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
}

interface StoreBannerManagerViewProps {
  userProfile: any
  onViewChange: (view: string) => void
}

// ── Component ─────────────────────────────────────────────────────

export default function StoreBannerManagerView({ userProfile, onViewChange }: StoreBannerManagerViewProps) {
  const [banners, setBanners] = useState<StoreBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingBanner, setEditingBanner] = useState<StoreBanner | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showConfigPanel, setShowConfigPanel] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Hero config state
  const [heroConfig, setHeroConfig] = useState<HeroConfig>({
    layout_type: 'carousel',
    auto_rotate_interval: 6000,
    max_slides: 5,
  })

  // Form state
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    badge_text: '',
    image_url: '',
    link_url: '/store/products',
    link_text: 'Shop Now',
    is_active: true,
    starts_at: '',
    ends_at: '',
    layout_slot: 'carousel' as LayoutSlot,
    animation_enabled: false,
    animation_style: 'none' as AnimationStyle,
    animation_intensity: 'low' as AnimationIntensity,
  })

  // ── Fetch banners + config ──────────────────────────────────────

  const fetchBanners = useCallback(async () => {
    try {
      setLoading(true)
      const [bannersRes, configRes] = await Promise.all([
        fetch('/api/admin/store/banners'),
        fetch('/api/admin/store/hero-config'),
      ])

      if (!bannersRes.ok) {
        const errData = await bannersRes.json().catch(() => ({}))
        throw new Error(errData.error || `Failed to fetch banners (${bannersRes.status})`)
      }
      const bannersData = await bannersRes.json()
      setBanners(bannersData.banners || [])

      if (configRes.ok) {
        const configData = await configRes.json()
        if (configData.config) {
          setHeroConfig(configData.config)
        }
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchBanners() }, [fetchBanners])

  // ── Save hero config ──────────────────────────────────────────

  const saveHeroConfig = async (newConfig: Partial<HeroConfig>) => {
    setSavingConfig(true)
    setError(null)
    const merged = { ...heroConfig, ...newConfig }
    try {
      const res = await fetch('/api/admin/store/hero-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save config')
      }
      setHeroConfig(merged)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSavingConfig(false)
    }
  }

  // ── Image upload ──────────────────────────────────────────────

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/admin/store/banners/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Upload failed')
      }

      const data = await res.json()
      setForm(prev => ({ ...prev, image_url: data.url }))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  // ── Save banner ───────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.image_url && !form.animation_enabled) {
      setError('Please upload a banner image or enable an animation')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload = {
        ...form,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
        layout_slot: form.layout_slot || 'carousel',
        sort_order: editingBanner ? editingBanner.sort_order : banners.length,
        animation_enabled: form.animation_enabled,
        animation_style: form.animation_style,
        animation_intensity: form.animation_intensity,
      }

      if (editingBanner) {
        // Update
        const res = await fetch('/api/admin/store/banners', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingBanner.id, ...payload }),
        })
        if (!res.ok) {
          const resData = await res.json().catch(() => ({}))
          throw new Error(resData.error || 'Failed to update banner')
        }
      } else {
        // Create
        const res = await fetch('/api/admin/store/banners', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const resData = await res.json().catch(() => ({}))
          throw new Error(resData.error || 'Failed to create banner')
        }
      }

      setShowForm(false)
      setEditingBanner(null)
      resetForm()
      await fetchBanners()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete banner ─────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this banner? This cannot be undone.')) return

    try {
      const res = await fetch(`/api/admin/store/banners?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      await fetchBanners()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // ── Toggle active ─────────────────────────────────────────────

  const toggleActive = async (banner: StoreBanner) => {
    try {
      const res = await fetch('/api/admin/store/banners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: banner.id, is_active: !banner.is_active }),
      })
      if (!res.ok) throw new Error('Failed to update')
      await fetchBanners()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // ── Edit banner ───────────────────────────────────────────────

  const startEdit = (banner: StoreBanner) => {
    setEditingBanner(banner)
    setForm({
      title: banner.title,
      subtitle: banner.subtitle,
      badge_text: banner.badge_text,
      image_url: banner.image_url,
      link_url: banner.link_url,
      link_text: banner.link_text,
      is_active: banner.is_active,
      starts_at: banner.starts_at ? banner.starts_at.slice(0, 16) : '',
      ends_at: banner.ends_at ? banner.ends_at.slice(0, 16) : '',
      layout_slot: banner.layout_slot || 'carousel',
      animation_enabled: (banner as any).animation_enabled ?? false,
      animation_style: ((banner as any).animation_style || 'none') as AnimationStyle,
      animation_intensity: ((banner as any).animation_intensity || 'low') as AnimationIntensity,
    })
    setShowForm(true)
  }

  const resetForm = () => {
    setForm({
      title: '',
      subtitle: '',
      badge_text: '',
      image_url: '',
      link_url: '/store/products',
      link_text: 'Shop Now',
      is_active: true,
      starts_at: '',
      ends_at: '',
      layout_slot: 'carousel',
      animation_enabled: false,
      animation_style: 'none' as AnimationStyle,
      animation_intensity: 'low' as AnimationIntensity,
    })
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onViewChange('customer-growth')}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Store Hero Banners</h1>
            <p className="text-sm text-muted-foreground">
              Manage the hero banner slider on your storefront homepage
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfigPanel(prev => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border rounded-lg transition-colors ${showConfigPanel
                ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/30 dark:text-violet-300'
                : 'border-border hover:bg-accent'
              }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Layout Config
          </button>
          <a
            href="/store"
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-accent transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Preview Store
          </a>
          {!showForm && (
            <button
              onClick={() => { resetForm(); setEditingBanner(null); setShowForm(true) }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Banner
            </button>
          )}
        </div>
      </div>

      {/* Hero Layout Config Panel */}
      {showConfigPanel && (
        <div className="bg-card border border-violet-200 dark:border-violet-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-violet-500" />
              Hero Layout Configuration
            </h2>
            {savingConfig && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
          </div>

          {/* Layout type selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Layout Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {/* Carousel layout */}
              <button
                onClick={() => saveHeroConfig({ layout_type: 'carousel' })}
                className={`relative p-4 rounded-xl border-2 text-left transition-all ${heroConfig.layout_type === 'carousel'
                    ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-900/20'
                    : 'border-border hover:border-violet-200 dark:hover:border-violet-800'
                  }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-100 to-violet-200 dark:from-violet-800 dark:to-violet-900 flex items-center justify-center">
                    <RotateCcw className="h-5 w-5 text-violet-600 dark:text-violet-300" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Standard Carousel</p>
                    <p className="text-[11px] text-muted-foreground">Full-width auto-rotating slides</p>
                  </div>
                </div>
                {/* Mini preview */}
                <div className="h-8 bg-muted rounded flex items-center justify-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-violet-500" />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/20" />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/20" />
                </div>
                {heroConfig.layout_type === 'carousel' && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>

              {/* Split layout */}
              <button
                onClick={() => saveHeroConfig({ layout_type: 'split' })}
                className={`relative p-4 rounded-xl border-2 text-left transition-all ${heroConfig.layout_type === 'split'
                    ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-900/20'
                    : 'border-border hover:border-violet-200 dark:hover:border-violet-800'
                  }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-800 dark:to-emerald-900 flex items-center justify-center">
                    <Columns className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Split Layout</p>
                    <p className="text-[11px] text-muted-foreground">Shopee/Lazada style 2-column</p>
                  </div>
                </div>
                {/* Mini preview */}
                <div className="h-8 flex gap-1">
                  <div className="flex-[2] bg-muted rounded" />
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div className="flex-1 bg-muted rounded" />
                    <div className="flex-1 bg-muted rounded" />
                  </div>
                </div>
                {heroConfig.layout_type === 'split' && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Auto-rotate interval */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Auto-Rotate Interval (seconds)
              </label>
              <select
                value={heroConfig.auto_rotate_interval}
                onChange={(e) => saveHeroConfig({ auto_rotate_interval: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              >
                <option value={3000}>3 seconds</option>
                <option value={4000}>4 seconds</option>
                <option value={5000}>5 seconds</option>
                <option value={6000}>6 seconds</option>
                <option value={8000}>8 seconds</option>
                <option value={10000}>10 seconds</option>
                <option value={0}>No auto-rotate</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Max Carousel Slides
              </label>
              <select
                value={heroConfig.max_slides}
                onChange={(e) => saveHeroConfig({ max_slides: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              >
                <option value={3}>3 slides</option>
                <option value={5}>5 slides</option>
                <option value={8}>8 slides</option>
                <option value={10}>10 slides</option>
              </select>
            </div>
          </div>

          {/* Layout guide */}
          {heroConfig.layout_type === 'split' && (
            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Split Layout Guide:</p>
              <ul className="space-y-0.5 ml-3 list-disc">
                <li><span className="font-medium text-emerald-600 dark:text-emerald-400">Split — Main (Left):</span> Large carousel on the left (⅔ width)</li>
                <li><span className="font-medium text-amber-600 dark:text-amber-400">Split — Side Top:</span> Static banner, top-right (⅓ width)</li>
                <li><span className="font-medium text-rose-600 dark:text-rose-400">Split — Side Bottom:</span> Static banner, bottom-right (⅓ width)</li>
                <li>Banners marked as &quot;Carousel Slide&quot; will also be used in the main carousel</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-xs">Dismiss</button>
        </div>
      )}

      {/* Banner Form */}
      {showForm && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-5">
          <h2 className="font-semibold text-base">
            {editingBanner ? 'Edit Banner' : 'New Banner'}
          </h2>

          {/* Image Upload — enhanced with size guidance & validation */}
          <BannerImageUploader
            imageUrl={form.image_url}
            context="landing"
            uploading={uploading}
            onUpload={handleImageUpload}
            onClear={() => setForm(prev => ({ ...prev, image_url: '' }))}
          />

          {/* Title & Subtitle */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="e.g. Premium Products, Delivered Right"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Subtitle</label>
              <input
                type="text"
                value={form.subtitle}
                onChange={(e) => setForm(prev => ({ ...prev, subtitle: e.target.value }))}
                placeholder="e.g. Discover our curated selection"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
          </div>

          {/* Badge & Link */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Badge Text</label>
              <input
                type="text"
                value={form.badge_text}
                onChange={(e) => setForm(prev => ({ ...prev, badge_text: e.target.value }))}
                placeholder="e.g. New Collection"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Link URL</label>
              <input
                type="text"
                value={form.link_url}
                onChange={(e) => setForm(prev => ({ ...prev, link_url: e.target.value }))}
                placeholder="/store/products"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Button Text</label>
              <input
                type="text"
                value={form.link_text}
                onChange={(e) => setForm(prev => ({ ...prev, link_text: e.target.value }))}
                placeholder="Shop Now"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
          </div>

          {/* Schedule */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Start Date (optional)
              </label>
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm(prev => ({ ...prev, starts_at: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> End Date (optional)
              </label>
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm(prev => ({ ...prev, ends_at: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
          </div>

          {/* Layout Slot */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" /> Layout Position
            </label>
            <select
              value={form.layout_slot}
              onChange={(e) => setForm(prev => ({ ...prev, layout_slot: e.target.value as LayoutSlot }))}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            >
              <option value="carousel">Carousel Slide (Standard full-width)</option>
              <option value="split_main">Split — Main Left (Large carousel)</option>
              <option value="split_side_top">Split — Side Top Right (Static)</option>
              <option value="split_side_bottom">Split — Side Bottom Right (Static)</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              {form.layout_slot === 'carousel' && 'This banner will appear as a full-width carousel slide.'}
              {form.layout_slot === 'split_main' && 'This banner will appear in the large left carousel of the split layout.'}
              {form.layout_slot === 'split_side_top' && 'This banner will appear as the small static banner in the top-right of the split layout.'}
              {form.layout_slot === 'split_side_bottom' && 'This banner will appear as the small static banner in the bottom-right of the split layout.'}
            </p>
          </div>

          {/* Animation Settings */}
          <AnimationSettingsPanel
            enabled={form.animation_enabled}
            style={form.animation_style}
            intensity={form.animation_intensity}
            imageUrl={form.image_url}
            context="landing"
            onChange={(update) => setForm(prev => ({
              ...prev,
              ...(update.animation_enabled !== undefined && { animation_enabled: update.animation_enabled }),
              ...(update.animation_style !== undefined && { animation_style: update.animation_style }),
              ...(update.animation_intensity !== undefined && { animation_intensity: update.animation_intensity }),
            }))}
          />

          {/* Active toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm(prev => ({ ...prev, is_active: e.target.checked }))}
              className="w-4 h-4 rounded border-border text-violet-600 focus:ring-violet-500/40"
            />
            <span className="text-sm font-medium text-foreground">Active</span>
          </label>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || (!form.image_url && !form.animation_enabled)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingBanner ? 'Update' : 'Create'} Banner
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingBanner(null); resetForm() }}
              className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Banners List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : banners.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <h3 className="font-semibold text-foreground mb-1">No banners yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add hero banners for your storefront homepage slider
          </p>
          <button
            onClick={() => { resetForm(); setEditingBanner(null); setShowForm(true) }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add First Banner
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((banner, index) => (
            <div
              key={banner.id}
              className={`bg-card border rounded-xl overflow-hidden transition-all ${banner.is_active
                  ? 'border-border hover:border-violet-200 dark:hover:border-violet-800'
                  : 'border-border/50 opacity-60'
                }`}
            >
              <div className="flex items-stretch">
                {/* Thumbnail */}
                <div className="w-40 sm:w-56 flex-shrink-0 relative">
                  {banner.image_url ? (
                    <img
                      src={banner.image_url}
                      alt={banner.title || 'Banner'}
                      className="w-full h-full object-cover min-h-[100px]"
                    />
                  ) : (
                    <div className="w-full h-full min-h-[100px] bg-gradient-to-br from-slate-800 via-blue-900 to-indigo-900 flex items-center justify-center">
                      <span className="text-xs text-white/50 font-medium">Animation Only</span>
                    </div>
                  )}
                  {!banner.is_active && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-xs font-medium text-white bg-black/60 px-2 py-0.5 rounded">Hidden</span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-muted-foreground">#{index + 1}</span>
                          {banner.badge_text && (
                            <span className="text-[10px] font-medium uppercase tracking-wider text-violet-600 bg-violet-50 dark:bg-violet-900/30 dark:text-violet-300 px-1.5 py-0.5 rounded">
                              {banner.badge_text}
                            </span>
                          )}
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${LAYOUT_SLOT_COLORS[banner.layout_slot || 'carousel']}`}>
                            {LAYOUT_SLOT_LABELS[banner.layout_slot || 'carousel']}
                          </span>
                        </div>
                        <h3 className="font-semibold text-sm text-foreground truncate mt-1">
                          {banner.title || '(no title)'}
                        </h3>
                        {banner.subtitle && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {banner.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <LinkIcon className="h-3 w-3" />
                        {banner.link_url}
                      </span>
                      {banner.link_text && (
                        <span>"{banner.link_text}"</span>
                      )}
                    </div>
                  </div>

                  {/* Actions row */}
                  <div className="flex items-center gap-1.5 mt-3">
                    <button
                      onClick={() => toggleActive(banner)}
                      title={banner.is_active ? 'Hide' : 'Show'}
                      className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {banner.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => startEdit(banner)}
                      className="px-2 py-1 rounded-md text-xs font-medium hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(banner.id)}
                      className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer info */}
      {banners.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {banners.filter(b => b.is_active).length} active of {banners.length} total banners •
          Layout: <span className="font-medium">{heroConfig.layout_type === 'split' ? 'Split (Shopee-style)' : 'Standard Carousel'}</span> •
          Auto-rotate: {heroConfig.auto_rotate_interval > 0 ? `${heroConfig.auto_rotate_interval / 1000}s` : 'Off'}
        </p>
      )}
    </div>
  )
}
