'use client'

import { useState, useEffect, useRef } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { Badge } from '@/components/ui/badge'
import {
  BarChart3,
  Truck,
  UsersRound,
  Briefcase,
  Calculator,
  Settings,
  Upload,
  X,
  Image as ImageIcon,
  Save,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react'

// ── Module definitions ───────────────────────────────────────────

type ModuleId = 'dashboard' | 'supply' | 'customer' | 'hr' | 'finance' | 'settings'

interface ModuleDef {
  id: ModuleId
  icon: LucideIcon
  label: string
  description: string
  gradient: string
}

const MODULES: ModuleDef[] = [
  {
    id: 'dashboard',
    icon: BarChart3,
    label: 'Dashboard',
    description: 'Main dashboard overview banner',
    gradient: 'linear-gradient(135deg, #1F2A44, #2F3F66)',
  },
  {
    id: 'supply',
    icon: Truck,
    label: 'Supply Chain',
    description: 'Supply chain module banner',
    gradient: 'linear-gradient(135deg, #8B5E1A, #C48A2E)',
  },
  {
    id: 'customer',
    icon: UsersRound,
    label: 'Customer & Growth',
    description: 'Customer engagement module banner',
    gradient: 'linear-gradient(135deg, #1E6F5C, #2E8B78)',
  },
  {
    id: 'hr',
    icon: Briefcase,
    label: 'Human Resources',
    description: 'HR module banner',
    gradient: 'linear-gradient(135deg, #2F4FA2, #4F6EDB)',
  },
  {
    id: 'finance',
    icon: Calculator,
    label: 'Finance & Accounting',
    description: 'Finance module banner',
    gradient: 'linear-gradient(135deg, #1B7A57, #2FAF7C)',
  },
  {
    id: 'settings',
    icon: Settings,
    label: 'Settings',
    description: 'Settings page banner',
    gradient: 'linear-gradient(135deg, #3E4655, #5B6678)',
  },
]

// ── Component ────────────────────────────────────────────────────

interface ModuleBannerTabProps {
  organizationId: string
  canEdit: boolean
}

export default function ModuleBannerTab({ organizationId, canEdit }: ModuleBannerTabProps) {
  const { supabase, isReady } = useSupabaseAuth()
  const [loading, setLoading] = useState(false)
  const [bannerUrls, setBannerUrls] = useState<Record<string, string | null>>({})
  const [pendingFiles, setPendingFiles] = useState<Record<string, File | null>>({})
  const [pendingPreviews, setPendingPreviews] = useState<Record<string, string | null>>({})
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Load existing banner URLs from org settings
  useEffect(() => {
    if (!isReady || !organizationId) return

    const loadBanners = async () => {
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('settings')
        .eq('id', organizationId)
        .single()

      if (!error && data?.settings?.module_banners) {
        setBannerUrls(data.settings.module_banners)
      }
    }

    loadBanners()
  }, [isReady, organizationId, supabase])

  const handleFileChange = (moduleId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Maximum file size is 5MB',
        variant: 'destructive',
      })
      return
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file (JPG, PNG, WebP)',
        variant: 'destructive',
      })
      return
    }

    setPendingFiles(prev => ({ ...prev, [moduleId]: file }))

    // Create preview
    const reader = new FileReader()
    reader.onload = (ev) => {
      setPendingPreviews(prev => ({ ...prev, [moduleId]: ev.target?.result as string }))
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveBanner = (moduleId: string) => {
    setPendingFiles(prev => ({ ...prev, [moduleId]: null }))
    setPendingPreviews(prev => ({ ...prev, [moduleId]: null }))
    setBannerUrls(prev => ({ ...prev, [moduleId]: null }))
  }

  const handleResetToDefault = (moduleId: string) => {
    setPendingFiles(prev => {
      const next = { ...prev }
      delete next[moduleId]
      return next
    })
    setPendingPreviews(prev => {
      const next = { ...prev }
      delete next[moduleId]
      return next
    })
    setBannerUrls(prev => {
      const next = { ...prev }
      delete next[moduleId]
      return next
    })
  }

  const handleSaveAll = async () => {
    if (!isReady) return

    try {
      setLoading(true)

      const newBannerUrls = { ...bannerUrls }

      // Upload any pending files
      for (const [moduleId, file] of Object.entries(pendingFiles)) {
        if (!file) {
          // null means user explicitly removed the banner
          newBannerUrls[moduleId] = null as any
          continue
        }

        const fileExt = file.name.split('.').pop()
        const fileName = `banner-${organizationId}-${moduleId}-${Date.now()}.${fileExt}`

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, file, {
            contentType: file.type,
            cacheControl: '3600',
            upsert: false,
          })

        if (uploadError) throw uploadError

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(uploadData.path)

        newBannerUrls[moduleId] = `${publicUrl}?v=${Date.now()}`
      }

      // Read current org settings
      const { data: orgData, error: readError } = await (supabase as any)
        .from('organizations')
        .select('settings')
        .eq('id', organizationId)
        .single()

      if (readError) throw readError

      // Merge module_banners into existing settings
      const currentSettings = orgData?.settings || {}
      const updatedSettings = {
        ...currentSettings,
        module_banners: newBannerUrls,
      }

      const { error: updateError } = await (supabase as any)
        .from('organizations')
        .update({ settings: updatedSettings, updated_at: new Date().toISOString() })
        .eq('id', organizationId)

      if (updateError) throw updateError

      setBannerUrls(newBannerUrls)
      setPendingFiles({})
      setPendingPreviews({})

      toast({
        title: '✅ Module Banners Saved',
        description: 'Banner images have been updated successfully.',
      })
    } catch (err: any) {
      console.error('Error saving banners:', err)
      toast({
        title: 'Error saving banners',
        description: err.message || 'Something went wrong',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const hasPendingChanges = Object.keys(pendingFiles).length > 0

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5" />
            Module Banners
          </CardTitle>
          <CardDescription>
            {canEdit
              ? 'Customize the banner image displayed at the top of each module. Upload a custom image or use the default gradient.'
              : 'View the banner images configured for each module.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {MODULES.map((mod) => {
            const currentUrl = pendingPreviews[mod.id] || bannerUrls[mod.id] || null
            const hasPending = mod.id in pendingFiles
            const Icon = mod.icon

            return (
              <div
                key={mod.id}
                className="border border-border rounded-lg overflow-hidden"
              >
                {/* Banner preview */}
                <div className="relative h-28 sm:h-36 overflow-hidden">
                  {currentUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={currentUrl}
                      alt={`${mod.label} banner`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full"
                      style={{ background: mod.gradient }}
                    />
                  )}
                  {/* Overlay for readability */}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/20 to-transparent" />
                  {/* Module label */}
                  <div className="absolute bottom-3 left-4 flex items-center gap-2">
                    <div className="flex items-center justify-center h-8 w-8 rounded-md bg-white/15 backdrop-blur-sm">
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-white font-semibold text-sm drop-shadow-sm">
                      {mod.label}
                    </span>
                    {hasPending && (
                      <Badge variant="secondary" className="text-xs bg-yellow-500/80 text-white border-0">
                        Unsaved
                      </Badge>
                    )}
                    {currentUrl && !hasPending && (
                      <Badge variant="secondary" className="text-xs bg-green-500/80 text-white border-0">
                        Custom
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Controls */}
                {canEdit && (
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/50">
                    <p className="text-xs text-muted-foreground hidden sm:block">
                      {mod.description} — Recommended: 1200×300px, JPG/PNG/WebP, max 5MB
                    </p>
                    <div className="flex items-center gap-2 ml-auto">
                      <input
                        ref={(el) => { fileInputRefs.current[mod.id] = el }}
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFileChange(mod.id, e)}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRefs.current[mod.id]?.click()}
                        disabled={loading}
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                        Upload
                      </Button>
                      {currentUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveBanner(mod.id)}
                          disabled={loading}
                        >
                          <X className="w-3.5 h-3.5 mr-1.5" />
                          Remove
                        </Button>
                      )}
                      {(hasPending || bannerUrls[mod.id]) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResetToDefault(mod.id)}
                          disabled={loading}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                          Default
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Save Button */}
          {canEdit && (
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSaveAll}
                disabled={loading || !hasPendingChanges}
              >
                <Save className="w-4 h-4 mr-2" />
                {loading ? 'Saving...' : 'Save Banner Changes'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
