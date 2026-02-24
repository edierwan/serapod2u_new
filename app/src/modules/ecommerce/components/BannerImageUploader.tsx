'use client'

import { useState, useRef } from 'react'
import { Upload, Loader2, Trash2, AlertTriangle, CheckCircle2, Info, Monitor, Smartphone } from 'lucide-react'
import {
    LANDING_BANNER_SIZE,
    LOGIN_BANNER_SIZE,
    validateBannerImage,
    getImageDimensions,
    type BannerValidationResult,
} from '@/lib/storefront/banner-constants'

// ── Types ─────────────────────────────────────────────────────────

interface BannerImageUploaderProps {
    imageUrl: string
    context: 'landing' | 'login'
    uploading: boolean
    onUpload: (file: File) => void
    onClear: () => void
}

// ── Component ─────────────────────────────────────────────────────

export default function BannerImageUploader({
    imageUrl,
    context,
    uploading,
    onUpload,
    onClear,
}: BannerImageUploaderProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [validation, setValidation] = useState<BannerValidationResult | null>(null)
    const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')

    const spec = context === 'landing' ? LANDING_BANNER_SIZE : LOGIN_BANNER_SIZE

    const handleFileChange = async (file: File) => {
        // Validate file type
        if (!file.type.startsWith('image/')) return
        if (file.size > 5 * 1024 * 1024) return

        try {
            const dims = await getImageDimensions(file)
            const result = validateBannerImage(dims.width, dims.height, context)
            setValidation(result)
        } catch {
            setValidation(null)
        }

        onUpload(file)
    }

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Banner Image *</label>

            {imageUrl ? (
                <div className="space-y-2">
                    {/* Preview with desktop/mobile toggle */}
                    <div className="relative group rounded-xl overflow-hidden border border-border">
                        {/* Preview mode toggle */}
                        <div className="absolute top-2 left-2 z-10 flex gap-1 bg-black/60 backdrop-blur-sm rounded-lg p-0.5">
                            <button
                                type="button"
                                onClick={() => setPreviewMode('desktop')}
                                className={`p-1 rounded text-xs ${previewMode === 'desktop' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'}`}
                                title="Desktop preview"
                            >
                                <Monitor className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setPreviewMode('mobile')}
                                className={`p-1 rounded text-xs ${previewMode === 'mobile' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'}`}
                                title="Mobile preview (center crop)"
                            >
                                <Smartphone className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div
                            className={`transition-all duration-300 ${previewMode === 'mobile'
                                    ? 'max-w-[200px] mx-auto'
                                    : ''
                                }`}
                        >
                            <img
                                src={imageUrl}
                                alt="Banner preview"
                                className={`w-full object-cover transition-all ${context === 'landing'
                                        ? previewMode === 'mobile' ? 'h-48 object-center' : 'h-48'
                                        : previewMode === 'mobile' ? 'h-64 object-center' : 'h-48'
                                    }`}
                            />
                        </div>

                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                            >
                                Change Image
                            </button>
                            <button
                                type="button"
                                onClick={() => { onClear(); setValidation(null) }}
                                className="p-1.5 text-white bg-red-500/60 backdrop-blur-sm rounded-lg hover:bg-red-500/80 transition-colors"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Validation results */}
                    {validation && (
                        <div className="space-y-1">
                            {validation.dimensions && (
                                <p className="text-[11px] text-muted-foreground">
                                    Uploaded: {validation.dimensions.width} × {validation.dimensions.height}px
                                    (AR: {validation.dimensions.aspectRatio.toFixed(2)}:1)
                                </p>
                            )}
                            {validation.errors.map((err, i) => (
                                <div key={`err-${i}`} className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                    <span>{err}</span>
                                </div>
                            ))}
                            {validation.warnings.map((warn, i) => (
                                <div key={`warn-${i}`} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                    <span>{warn}</span>
                                </div>
                            ))}
                            {validation.valid && validation.warnings.length === 0 && (
                                <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                                    <span>Image dimensions look great!</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <button
                    type="button"
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

            {/* Size guidance */}
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
                <Info className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="text-[10px] text-blue-700 dark:text-blue-300 space-y-0.5">
                    <p><strong>Recommended:</strong> {spec.label} (alt: {spec.altLabel})</p>
                    <p><strong>Aspect ratio:</strong> {spec.aspectLabel}</p>
                    <p><strong>Format:</strong> JPG, PNG, WebP — max 5MB</p>
                    <p className="text-blue-600/70 dark:text-blue-400/70">
                        Keep key content centered; edges may be cropped on mobile.
                    </p>
                </div>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileChange(file)
                }}
            />
        </div>
    )
}
