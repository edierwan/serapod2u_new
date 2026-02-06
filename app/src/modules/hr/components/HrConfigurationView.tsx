'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Wrench, Upload, Image as ImageIcon, Trash2, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getStorageUrl } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────

interface HrConfigurationViewProps {
  organizationId: string
  canEdit: boolean
}

interface HrConfig {
  banner_image_url: string | null
  updated_at: string | null
}

// ── Component ────────────────────────────────────────────────────

export default function HrConfigurationView({ organizationId, canEdit }: HrConfigurationViewProps) {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [config, setConfig] = useState<HrConfig>({ banner_image_url: null, updated_at: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Load existing config from organization settings ──────────

  useEffect(() => {
    async function loadConfig() {
      try {
        const { data, error: fetchError } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', organizationId)
          .single()

        if (fetchError) throw fetchError

        let settings: Record<string, any> = {}
        if (typeof data?.settings === 'string') {
          try { settings = JSON.parse(data.settings) } catch { settings = {} }
        } else if (typeof data?.settings === 'object' && data?.settings !== null) {
          settings = data.settings as Record<string, any>
        }

        const hrConfig = settings?.hr_config || {}
        setConfig({
          banner_image_url: hrConfig.banner_image_url || null,
          updated_at: hrConfig.updated_at || null,
        })

        if (hrConfig.banner_image_url) {
          setPreviewUrl(
            hrConfig.banner_image_url.startsWith('http')
              ? hrConfig.banner_image_url
              : getStorageUrl(hrConfig.banner_image_url)
          )
        }
      } catch (err) {
        console.error('Failed to load HR config:', err)
        setError('Failed to load configuration')
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [organizationId, supabase])

  // ── Upload handler ──────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPEG, PNG, WebP)')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const filePath = `hr-banners/${organizationId}/banner-${Date.now()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { contentType: file.type, upsert: true })

      if (uploadError) throw uploadError

      const publicUrl = getStorageUrl(filePath)
      setConfig((prev) => ({ ...prev, banner_image_url: filePath }))
      setPreviewUrl(publicUrl)
    } catch (err: any) {
      console.error('Upload error:', err)
      setError(err.message || 'Failed to upload image')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Remove banner ───────────────────────────────────────────────

  const handleRemoveBanner = () => {
    setConfig((prev) => ({ ...prev, banner_image_url: null }))
    setPreviewUrl(null)
  }

  // ── Save config ─────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      // Read current settings first
      const { data: orgData, error: readErr } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', organizationId)
        .single()

      if (readErr) throw readErr

      let settings: Record<string, any> = {}
      if (typeof orgData?.settings === 'string') {
        try { settings = JSON.parse(orgData.settings) } catch { settings = {} }
      } else if (typeof orgData?.settings === 'object' && orgData?.settings !== null) {
        settings = { ...(orgData.settings as Record<string, any>) }
      }

      // Merge HR config
      settings.hr_config = {
        ...(settings.hr_config || {}),
        banner_image_url: config.banner_image_url,
        updated_at: new Date().toISOString(),
      }

      const { error: updateErr } = await supabase
        .from('organizations')
        .update({ settings })
        .eq('id', organizationId)

      if (updateErr) throw updateErr

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      console.error('Save error:', err)
      setError(err.message || 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Wrench className="h-6 w-6 text-blue-600" />
          HR Configuration
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the appearance and settings for the HR module.
        </p>
      </div>

      {/* Banner Image Section */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Banner Image</h2>
          <p className="text-sm text-muted-foreground">
            Upload a banner image for the HR landing page. Recommended size: 1200×300px. Max 5MB.
          </p>
        </div>

        {/* Preview */}
        {previewUrl ? (
          <div className="relative rounded-lg overflow-hidden border border-border" style={{ height: 200 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Banner Preview"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/20 to-transparent" />
            <div className="absolute bottom-3 left-4 text-white text-sm font-medium">
              Banner Preview
            </div>
            {canEdit && (
              <button
                onClick={handleRemoveBanner}
                className="absolute top-3 right-3 p-1.5 rounded-md bg-red-500/80 text-white hover:bg-red-600 transition-colors"
                title="Remove banner"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-40 rounded-lg border-2 border-dashed border-border bg-muted/30">
            <div className="text-center">
              <ImageIcon className="h-10 w-10 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No banner image set</p>
              <p className="text-xs text-muted-foreground/70">Default gradient will be used</p>
            </div>
          </div>
        )}

        {/* Upload button */}
        {canEdit && (
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-2"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? 'Uploading…' : 'Upload Image'}
            </Button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Save */}
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Configuration'}
          </Button>
        </div>
      )}
    </div>
  )
}
