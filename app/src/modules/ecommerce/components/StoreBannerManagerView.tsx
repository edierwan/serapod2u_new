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
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

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
  created_at: string
  updated_at: string
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
  const fileInputRef = useRef<HTMLInputElement>(null)

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
  })

  // ── Fetch banners ─────────────────────────────────────────────

  const fetchBanners = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/store/banners')
      if (!res.ok) throw new Error('Failed to fetch banners')
      const data = await res.json()
      setBanners(data.banners || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchBanners() }, [fetchBanners])

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
    if (!form.image_url) {
      setError('Please upload a banner image')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload = {
        ...form,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
        sort_order: editingBanner ? editingBanner.sort_order : banners.length,
      }

      if (editingBanner) {
        // Update
        const res = await fetch('/api/admin/store/banners', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingBanner.id, ...payload }),
        })
        if (!res.ok) throw new Error('Failed to update banner')
      } else {
        // Create
        const res = await fetch('/api/admin/store/banners', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to create banner')
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

          {/* Image Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Banner Image *</label>
            {form.image_url ? (
              <div className="relative group rounded-xl overflow-hidden border border-border">
                <img
                  src={form.image_url}
                  alt="Banner preview"
                  className="w-full h-48 object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                  >
                    Change Image
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full h-48 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-violet-400 hover:text-violet-500 transition-colors"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="text-sm">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8" />
                    <span className="text-sm font-medium">Click to upload image</span>
                    <span className="text-xs">JPG, PNG, WebP — max 5MB</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImageUpload(file)
              }}
            />
          </div>

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
              disabled={saving || !form.image_url}
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
              className={`bg-card border rounded-xl overflow-hidden transition-all ${
                banner.is_active
                  ? 'border-border hover:border-violet-200 dark:hover:border-violet-800'
                  : 'border-border/50 opacity-60'
              }`}
            >
              <div className="flex items-stretch">
                {/* Thumbnail */}
                <div className="w-40 sm:w-56 flex-shrink-0 relative">
                  <img
                    src={banner.image_url}
                    alt={banner.title || 'Banner'}
                    className="w-full h-full object-cover min-h-[100px]"
                  />
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
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">#{index + 1}</span>
                          {banner.badge_text && (
                            <span className="text-[10px] font-medium uppercase tracking-wider text-violet-600 bg-violet-50 dark:bg-violet-900/30 dark:text-violet-300 px-1.5 py-0.5 rounded">
                              {banner.badge_text}
                            </span>
                          )}
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
          Banners auto-rotate on the storefront homepage
        </p>
      )}
    </div>
  )
}
