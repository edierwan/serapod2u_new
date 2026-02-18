'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Plus, Trash2, Eye, EyeOff, Upload, Image as ImageIcon,
  Save, ArrowLeft, Loader2, Calendar, Link as LinkIcon,
  ExternalLink
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

interface LoginBanner {
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
  banner_type: string
  created_at: string
  updated_at: string
}

interface LoginHeroBannerManagerViewProps {
  userProfile: any
  onViewChange: (view: string) => void
}

export default function LoginHeroBannerManagerView({ userProfile, onViewChange }: LoginHeroBannerManagerViewProps) {
  const [banners, setBanners] = useState<LoginBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingBanner, setEditingBanner] = useState<LoginBanner | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      const supabase = createClient()
      const { data, error: fetchError } = await supabase
        .from('store_hero_banners' as any)
        .select('*')
        .eq('banner_type', 'login')
        .order('sort_order', { ascending: true })

      if (fetchError) throw new Error(fetchError.message)
      setBanners((data as any[]) || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchBanners() }, [fetchBanners])

  // ── Image upload ──────────────────────────────────────────────

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Only image files'); return }
    if (file.size > 5 * 1024 * 1024) { setError('Max 5MB'); return }

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

  const saveBanner = async () => {
    if (!form.image_url) { setError('Please upload an image'); return }
    setSaving(true)
    setError(null)

    try {
      const supabase = createClient()
      const payload = {
        title: form.title,
        subtitle: form.subtitle,
        badge_text: form.badge_text,
        image_url: form.image_url,
        link_url: form.link_url || '/store/products',
        link_text: form.link_text || 'Shop Now',
        is_active: form.is_active,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
        banner_type: 'login',
        layout_slot: 'carousel',
        org_id: userProfile?.company_id,
        updated_at: new Date().toISOString(),
        updated_by: userProfile?.id,
      }

      if (editingBanner) {
        const { error: updateErr } = await supabase
          .from('store_hero_banners' as any)
          .update(payload as any)
          .eq('id', editingBanner.id)
        if (updateErr) throw new Error(updateErr.message)
      } else {
        const { error: insertErr } = await supabase
          .from('store_hero_banners' as any)
          .insert({
            ...payload,
            sort_order: banners.length,
            created_at: new Date().toISOString(),
            created_by: userProfile?.id,
          } as any)
        if (insertErr) throw new Error(insertErr.message)
      }

      setShowForm(false)
      setEditingBanner(null)
      resetForm()
      fetchBanners()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete banner ─────────────────────────────────────────────

  const deleteBanner = async (id: string) => {
    if (!confirm('Delete this login banner?')) return
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('store_hero_banners' as any)
        .delete()
        .eq('id', id)
      if (error) throw new Error(error.message)
      fetchBanners()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // ── Toggle visibility ─────────────────────────────────────────

  const toggleVisibility = async (banner: LoginBanner) => {
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('store_hero_banners' as any)
        .update({ is_active: !banner.is_active, updated_at: new Date().toISOString() } as any)
        .eq('id', banner.id)
      if (error) throw new Error(error.message)
      fetchBanners()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const resetForm = () => {
    setForm({
      title: '', subtitle: '', badge_text: '', image_url: '',
      link_url: '/store/products', link_text: 'Shop Now', is_active: true,
      starts_at: '', ends_at: '',
    })
  }

  const startEdit = (banner: LoginBanner) => {
    setEditingBanner(banner)
    setForm({
      title: banner.title, subtitle: banner.subtitle, badge_text: banner.badge_text,
      image_url: banner.image_url, link_url: banner.link_url, link_text: banner.link_text,
      is_active: banner.is_active,
      starts_at: banner.starts_at ? banner.starts_at.slice(0, 16) : '',
      ends_at: banner.ends_at ? banner.ends_at.slice(0, 16) : '',
    })
    setShowForm(true)
  }

  const activeBanners = banners.filter(b => b.is_active)

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onViewChange('store-banner-manager')}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Login Hero Banners</h1>
            <p className="text-sm text-muted-foreground">
              Manage the hero banner on the login &amp; sign-up pages
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/login"
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-accent transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Preview Login
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
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-sm">{editingBanner ? 'Edit' : 'Add'} Login Banner</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Image */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Banner Image *</label>
              <div className="relative">
                {form.image_url ? (
                  <div className="relative">
                    <img src={form.image_url} alt="Preview" className="w-full h-48 object-cover rounded-lg" />
                    <button
                      onClick={() => setForm(prev => ({ ...prev, image_url: '' }))}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full text-xs"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div
                    className="h-48 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-violet-400 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Click to upload (max 5MB)</span>
                      </>
                    )}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                />
              </div>
            </div>

            {/* Form fields */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  placeholder="Banner title (optional)"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Subtitle</label>
                <input
                  type="text"
                  value={form.subtitle}
                  onChange={(e) => setForm(prev => ({ ...prev, subtitle: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  placeholder="Short description (optional)"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Link URL</label>
                  <input
                    type="text"
                    value={form.link_url}
                    onChange={(e) => setForm(prev => ({ ...prev, link_url: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Link Text</label>
                  <input
                    type="text"
                    value={form.link_text}
                    onChange={(e) => setForm(prev => ({ ...prev, link_text: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="login-banner-active"
                  checked={form.is_active}
                  onChange={(e) => setForm(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded border-border"
                />
                <label htmlFor="login-banner-active" className="text-xs text-muted-foreground">Active</label>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <button
              onClick={saveBanner}
              disabled={saving || !form.image_url}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {editingBanner ? 'Update' : 'Save'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingBanner(null); resetForm() }}
              className="px-4 py-2 text-xs font-medium border border-border rounded-lg hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Banner List */}
      {!loading && banners.length === 0 && !showForm && (
        <div className="text-center py-16 bg-card border border-border rounded-xl">
          <ImageIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">No login banners yet</p>
          <p className="text-sm text-muted-foreground mt-1">Upload banners to display on the login page</p>
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-500 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add Your First Banner
          </button>
        </div>
      )}

      {!loading && banners.length > 0 && (
        <div className="space-y-3">
          {banners.map((banner, idx) => (
            <div key={banner.id} className="flex gap-4 bg-card border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
              {/* Thumbnail */}
              <div className="w-40 h-24 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                {banner.image_url ? (
                  <img src={banner.image_url} alt={banner.title || 'Banner'} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
                    <span className={`ml-2 inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                      banner.is_active
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {banner.is_active ? 'Active' : 'Hidden'}
                    </span>
                    <h3 className="font-medium text-sm mt-1">
                      {banner.title || <span className="text-muted-foreground italic">(no title)</span>}
                    </h3>
                  </div>
                </div>
                {banner.link_url && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                    <LinkIcon className="h-3 w-3" />
                    {banner.link_url}
                    {banner.link_text && <span>&quot;{banner.link_text}&quot;</span>}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => toggleVisibility(banner)}
                  className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title={banner.is_active ? 'Hide' : 'Show'}
                >
                  {banner.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => startEdit(banner)}
                  className="px-2 py-1 text-xs font-medium hover:bg-accent rounded-md transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteBanner(banner.id)}
                  className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer info */}
      {!loading && banners.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {activeBanners.length} active of {banners.length} total login banners
        </p>
      )}
    </div>
  )
}
