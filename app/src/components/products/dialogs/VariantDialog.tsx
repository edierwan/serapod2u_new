'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  X,
  Loader2,
  Plus,
  Star,
  Film,
  ImageIcon,
} from 'lucide-react'
import { getStorageUrl } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────

interface Product {
  id: string
  product_name: string
}

export interface MediaItem {
  id: string
  type: 'image' | 'video'
  url: string
  thumbnailUrl?: string | null
  file?: File | null
  thumbnailFile?: Blob | null
  isDefault: boolean
  dbId?: string | null
  mimeType?: string
  fileSize?: number
  durationMs?: number | null
}

export interface Variant {
  id?: string
  product_id: string
  variant_code?: string
  variant_name: string
  attributes: Record<string, any>
  barcode: string | null
  manufacturer_sku: string | null
  manual_sku: string | null
  base_cost: number | null
  suggested_retail_price: number | null
  retailer_price?: number | null
  distributor_price?: number | null
  other_price?: number | null
  is_active: boolean
  is_default: boolean
  image_url?: string | null
  additional_images?: string[] | null
  animation_url?: string | null
  media?: MediaItem[]
}

interface VariantDialogProps {
  variant: Variant | null
  products: Product[]
  open: boolean
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Partial<Variant> & { mediaItems?: MediaItem[] }) => void
}

const MAX_MEDIA = 10
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_VIDEO_SIZE = 50 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm']
const ALL_ACCEPTED = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES]

function isVideoType(mime: string) {
  return ACCEPTED_VIDEO_TYPES.includes(mime)
}

function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let w = img.width, h = img.height
        const MAX = 400
        if (w > h) { if (w > MAX) { h = Math.round((h * MAX) / w); w = MAX } }
        else { if (h > MAX) { w = Math.round((w * MAX) / h); h = MAX } }
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('compress failed'))
            resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg', lastModified: Date.now() }))
          },
          'image/jpeg',
          0.75,
        )
      }
      img.onerror = () => reject(new Error('Image load failed'))
    }
    reader.onerror = () => reject(new Error('File read failed'))
  })
}

function captureVideoThumbnail(file: File): Promise<{ blob: Blob; url: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const objectUrl = URL.createObjectURL(file)
    video.src = objectUrl
    video.onloadeddata = () => { video.currentTime = Math.min(video.duration * 0.25, 2) }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(video.videoWidth, 400)
      canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight)
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          const durationMs = Math.round(video.duration * 1000)
          URL.revokeObjectURL(objectUrl)
          if (!blob) return reject(new Error('Thumbnail capture failed'))
          resolve({ blob, url: URL.createObjectURL(blob), durationMs })
        },
        'image/jpeg',
        0.8,
      )
    }
    video.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Video load failed')) }
  })
}

export default function VariantDialog({ variant, products, open, isSaving, onOpenChange, onSave }: VariantDialogProps) {
  const mkInitial = useCallback(
    (): Partial<Variant> =>
      variant
        ? {
            product_id: variant.product_id || (products.length === 1 ? products[0].id : ''),
            variant_name: variant.variant_name || '',
            attributes: variant.attributes || {},
            barcode: variant.barcode || '',
            manufacturer_sku: variant.manufacturer_sku || '',
            manual_sku: variant.manual_sku || '',
            base_cost: variant.base_cost,
            suggested_retail_price: variant.suggested_retail_price,
            retailer_price: variant.retailer_price,
            distributor_price: variant.distributor_price,
            other_price: variant.other_price,
            is_active: variant.is_active !== false,
            is_default: variant.is_default || false,
          }
        : {
            product_id: products.length > 0 ? products[0].id : '',
            variant_name: '',
            attributes: {},
            barcode: '',
            manufacturer_sku: '',
            manual_sku: '',
            base_cost: null,
            suggested_retail_price: null,
            retailer_price: null,
            distributor_price: null,
            other_price: null,
            is_active: true,
            is_default: false,
          },
    [variant, products],
  )

  const [formData, setFormData] = useState<Partial<Variant>>(mkInitial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setFormData(mkInitial())
    setErrors({})
    const items: MediaItem[] = []
    if (variant?.media && variant.media.length > 0) {
      items.push(...variant.media.map((m) => ({ ...m, file: null, thumbnailFile: null })))
    } else {
      if (variant?.image_url) {
        items.push({ id: `legacy-img-${Date.now()}`, type: 'image' as const, url: getStorageUrl(variant.image_url) || variant.image_url, isDefault: true, dbId: null, file: null })
      }
      if (variant?.animation_url) {
        items.push({ id: `legacy-vid-${Date.now()}`, type: 'video' as const, url: getStorageUrl(variant.animation_url) || variant.animation_url, thumbnailUrl: null, isDefault: items.length === 0, dbId: null, file: null })
      }
    }
    setMediaItems(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant, products])

  const generateBarcode = useCallback(() => {
    if (!formData.product_id || !formData.variant_name) return ''
    const product = products.find((p) => p.id === formData.product_id)
    const pc = product ? product.product_name.substring(0, 3).toUpperCase() : 'PRD'
    const vc = formData.variant_name.substring(0, 2).toUpperCase()
    return `${pc}${vc}${Date.now().toString().slice(-5)}`
  }, [formData.product_id, formData.variant_name, products])

  const generateSKU = useCallback(() => {
    if (!formData.product_id || !formData.variant_name) return ''
    const product = products.find((p) => p.id === formData.product_id)
    const pc = product ? product.product_name.substring(0, 3).toUpperCase() : 'PRD'
    const vc = formData.variant_name.substring(0, 3).toUpperCase()
    return `SKU-${pc}-${vc}-${Date.now().toString().slice(-4)}`
  }, [formData.product_id, formData.variant_name, products])

  const generateVariantCode = useCallback(() => {
    const nc = formData.variant_name?.substring(0, 3).toUpperCase() || 'VAR'
    return `${nc}-${Date.now().toString().slice(-6)}`
  }, [formData.variant_name])

  useEffect(() => {
    if (formData.variant_name && formData.product_id && !variant) {
      setFormData((p) => ({ ...p, barcode: generateBarcode(), manufacturer_sku: generateSKU() }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.product_id, formData.variant_name, variant])

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!(formData.product_id || variant?.product_id)) e.product_id = 'Product is required'
    if (!formData.variant_name) e.variant_name = 'Name is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleAddMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const remaining = MAX_MEDIA - mediaItems.length
    if (remaining <= 0) { setErrors((p) => ({ ...p, media: `Maximum ${MAX_MEDIA} media items allowed` })); return }
    const toProcess = Array.from(files).slice(0, remaining)
    const newItems: MediaItem[] = []
    for (const file of toProcess) {
      const isVideo = isVideoType(file.type)
      if (!ALL_ACCEPTED.includes(file.type)) { setErrors((p) => ({ ...p, media: `Unsupported type: ${file.type}` })); continue }
      if (file.type === 'image/avif') { setErrors((p) => ({ ...p, media: 'AVIF not supported.' })); continue }
      if (isVideo && file.size > MAX_VIDEO_SIZE) { setErrors((p) => ({ ...p, media: 'Video must be under 50 MB' })); continue }
      if (!isVideo && file.size > MAX_IMAGE_SIZE) { setErrors((p) => ({ ...p, media: 'Image must be under 5 MB' })); continue }
      try {
        if (isVideo) {
          const { blob: thumbBlob, url: thumbUrl, durationMs } = await captureVideoThumbnail(file)
          newItems.push({ id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, type: 'video', url: URL.createObjectURL(file), thumbnailUrl: thumbUrl, file, thumbnailFile: thumbBlob, isDefault: false, mimeType: file.type, fileSize: file.size, durationMs })
        } else {
          const compressed = await compressImage(file)
          newItems.push({ id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, type: 'image', url: URL.createObjectURL(compressed), file: compressed, isDefault: false, mimeType: compressed.type, fileSize: compressed.size })
        }
        setErrors((p) => ({ ...p, media: '' }))
      } catch (err) {
        console.error('Media processing error:', err)
        setErrors((p) => ({ ...p, media: 'Failed to process file.' }))
      }
    }
    if (newItems.length > 0) {
      setMediaItems((prev) => {
        const merged = [...prev, ...newItems]
        if (!merged.some((m) => m.isDefault)) merged[0].isDefault = true
        return merged
      })
    }
    if (e.target) e.target.value = ''
  }

  const handleRemoveMedia = (id: string) => {
    setMediaItems((prev) => {
      const filtered = prev.filter((m) => m.id !== id)
      if (filtered.length > 0 && !filtered.some((m) => m.isDefault)) filtered[0].isDefault = true
      return filtered
    })
  }

  const handleSetDefault = (id: string) => {
    setMediaItems((prev) => prev.map((m) => ({ ...m, isDefault: m.id === id })))
  }

  const handleMoveMedia = (index: number, direction: -1 | 1) => {
    setMediaItems((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const handleSubmit = () => {
    if (!validate()) return
    const finalProductId = formData.product_id || variant?.product_id || ''
    onSave({
      ...formData,
      product_id: finalProductId,
      variant_code: variant?.variant_code || generateVariantCode(),
      barcode: variant ? formData.barcode : generateBarcode(),
      mediaItems: mediaItems.map((m, i) => ({ ...m, sort_order: i } as any)),
    } as any)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-lg shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">{variant ? 'Edit Variant' : 'Add Variant'}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Unified Variant Media */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Variant Media <span className="font-normal text-gray-500">(Up to {MAX_MEDIA} \u2014 images &amp; videos)</span></Label>
            <div className="flex flex-wrap gap-3">
              {mediaItems.map((item, idx) => (
                <div key={item.id} className="relative group">
                  <div className={`w-20 h-20 rounded-lg border-2 overflow-hidden ${item.isDefault ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-200'}`}>
                    {item.type === 'video' ? (
                      <video src={item.url} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                    ) : (
                      <img src={item.url} alt={`Media ${idx + 1}`} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <span className={`absolute bottom-0.5 left-0.5 text-[9px] font-bold uppercase px-1 py-[1px] rounded flex items-center gap-0.5 ${item.type === 'video' ? 'bg-purple-600 text-white' : 'bg-emerald-600 text-white'}`}>
                    {item.type === 'video' ? <><Film className="w-2.5 h-2.5" /> Vid</> : <><ImageIcon className="w-2.5 h-2.5" /> Img</>}
                  </span>
                  {item.isDefault && <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">Default</div>}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1">
                    {idx > 0 && <button type="button" onClick={() => handleMoveMedia(idx, -1)} className="p-1 bg-white/90 rounded-full hover:bg-white text-gray-700" title="Move left"><span className="text-[10px] font-bold">\u2190</span></button>}
                    {!item.isDefault && <button type="button" onClick={() => handleSetDefault(item.id)} className="p-1.5 bg-white/90 rounded-full hover:bg-white text-blue-600" title="Set as default"><Star className="w-3.5 h-3.5" /></button>}
                    <button type="button" onClick={() => handleRemoveMedia(item.id)} className="p-1.5 bg-white/90 rounded-full hover:bg-white text-red-600" title="Remove"><X className="w-3.5 h-3.5" /></button>
                    {idx < mediaItems.length - 1 && <button type="button" onClick={() => handleMoveMedia(idx, 1)} className="p-1 bg-white/90 rounded-full hover:bg-white text-gray-700" title="Move right"><span className="text-[10px] font-bold">\u2192</span></button>}
                  </div>
                </div>
              ))}
              {mediaItems.length < MAX_MEDIA && (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 transition-colors flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-blue-500">
                  <Plus className="w-5 h-5" /><span className="text-[10px]">Add</span>
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept={ALL_ACCEPTED.join(',')} onChange={handleAddMedia} multiple className="hidden" />
            <p className="text-xs text-gray-500">Images: PNG, JPG, GIF \u2264 5 MB \u00B7 Videos: MP4, WebM \u2264 50 MB (8\u201315s recommended) \u00B7 {mediaItems.length}/{MAX_MEDIA}</p>
            {errors.media && <p className="text-xs text-red-500">{errors.media}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="product">Product *</Label>
            <select id="product" value={formData.product_id || variant?.product_id || ''} onChange={(e) => { setFormData((p) => ({ ...p, product_id: e.target.value })); if (errors.product_id) setErrors((p) => ({ ...p, product_id: '' })) }} className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.product_id ? 'border-red-500' : ''}`}>
              <option value="">Select a product</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.product_name}</option>)}
            </select>
            {errors.product_id && <p className="text-xs text-red-500">{errors.product_id}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Variant Name *</Label>
            <Input id="name" placeholder="e.g., Strawberry - 6mg" value={formData.variant_name || ''} onChange={(e) => { setFormData((p) => ({ ...p, variant_name: e.target.value })); if (errors.variant_name) setErrors((p) => ({ ...p, variant_name: '' })) }} className={errors.variant_name ? 'border-red-500' : ''} />
            {errors.variant_name && <p className="text-xs text-red-500">{errors.variant_name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="barcode">Barcode <span className="text-xs text-gray-500">(Auto-generated)</span></Label>
            <Input id="barcode" value={formData.barcode || ''} readOnly className="bg-gray-100 cursor-not-allowed text-gray-700" />
            <p className="text-xs text-gray-500">Automatically generated from product and variant name</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sku">Manufacturer SKU <span className="text-xs text-gray-500">(Auto-generated)</span></Label>
            <Input id="sku" value={formData.manufacturer_sku || ''} readOnly className="bg-gray-100 cursor-not-allowed text-gray-700" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual_sku">Manual SKU <span className="text-xs text-gray-500">(Optional, 5 chars max)</span></Label>
            <Input id="manual_sku" value={formData.manual_sku || ''} onChange={(e) => setFormData((p) => ({ ...p, manual_sku: e.target.value.toUpperCase().slice(0, 5) }))} maxLength={5} placeholder="Enter custom SKU" className="uppercase" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="baseCost">Base Cost (RM)</Label>
              <div className="flex items-center"><span className="text-gray-600 mr-2">RM</span><Input id="baseCost" type="number" step="0.01" placeholder="0.00" value={formData.base_cost ?? ''} onChange={(e) => setFormData((p) => ({ ...p, base_cost: e.target.value ? parseFloat(e.target.value) : null }))} className="flex-1" /></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="retailPrice">Retail Price (RM)</Label>
              <div className="flex items-center"><span className="text-gray-600 mr-2">RM</span><Input id="retailPrice" type="number" step="0.01" placeholder="0.00" value={formData.suggested_retail_price ?? ''} onChange={(e) => setFormData((p) => ({ ...p, suggested_retail_price: e.target.value ? parseFloat(e.target.value) : null }))} className="flex-1" /></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="retailerPrice">Retailer Price (RM)</Label>
              <div className="flex items-center"><span className="text-gray-600 mr-2">RM</span><Input id="retailerPrice" type="number" step="0.01" placeholder="0.00" value={formData.retailer_price ?? ''} onChange={(e) => setFormData((p) => ({ ...p, retailer_price: e.target.value ? parseFloat(e.target.value) : null }))} className="flex-1" /></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="distributorPrice">Distributor Price (RM)</Label>
              <div className="flex items-center"><span className="text-gray-600 mr-2">RM</span><Input id="distributorPrice" type="number" step="0.01" placeholder="0.00" value={formData.distributor_price ?? ''} onChange={(e) => setFormData((p) => ({ ...p, distributor_price: e.target.value ? parseFloat(e.target.value) : null }))} className="flex-1" /></div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="otherPrice">Promo Price (RM)</Label>
            <div className="flex items-center"><span className="text-gray-600 mr-2">RM</span><Input id="otherPrice" type="number" step="0.01" placeholder="0.00" value={formData.other_price ?? ''} onChange={(e) => setFormData((p) => ({ ...p, other_price: e.target.value ? parseFloat(e.target.value) : null }))} className="flex-1" /></div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="is_default" checked={formData.is_default || false} onCheckedChange={(checked) => setFormData((p) => ({ ...p, is_default: Boolean(checked) }))} />
            <Label htmlFor="is_default" className="font-normal cursor-pointer">Set as Default Variant</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="is_active" checked={formData.is_active !== false} onCheckedChange={(checked) => setFormData((p) => ({ ...p, is_active: Boolean(checked) }))} />
            <Label htmlFor="is_active" className="font-normal cursor-pointer">Active</Label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 sticky bottom-0 bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
            {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
