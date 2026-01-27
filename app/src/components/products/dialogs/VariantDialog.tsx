'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { X, Loader2, Upload, Image as ImageIcon, Plus, Star } from 'lucide-react'
import { getStorageUrl } from '@/lib/utils'

// Image compression utility for variant images
// Variant images are small display images, compress to ~5KB
const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height
        
        // Variant image dimensions - small size for display
        const MAX_WIDTH = 400
        const MAX_HEIGHT = 400
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width)
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height)
            height = MAX_HEIGHT
          }
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)
        
        // Convert to JPEG with compression (quality 0.7 = 70%)
        // This targets ~5KB file size for variant images
        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Create a new File object with compressed blob
              const compressedFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
                type: 'image/jpeg',
                lastModified: Date.now(),
              })
              console.log(`🖼️ Variant image compressed: ${(file.size / 1024).toFixed(2)}KB → ${(compressedFile.size / 1024).toFixed(2)}KB`)
              resolve(compressedFile)
            } else {
              reject(new Error('Canvas to Blob conversion failed'))
            }
          },
          'image/jpeg',
          0.7 // Compression quality for ~5KB target
        )
      }
      img.onerror = () => reject(new Error('Image loading failed'))
    }
    reader.onerror = () => reject(new Error('File reading failed'))
  })
}

interface Product {
  id: string
  product_name: string
}

interface Variant {
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
}

interface ImageItem {
  id: string
  file?: File
  url: string
  isDefault?: boolean
}

interface VariantDialogProps {
  variant: Variant | null
  products: Product[]
  open: boolean
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Partial<Variant>) => void
}

export default function VariantDialog({
  variant,
  products,
  open,
  isSaving,
  onOpenChange,
  onSave
}: VariantDialogProps) {
  const [formData, setFormData] = useState<Partial<Variant>>({
    product_id: '',
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
    image_url: null,
    additional_images: [],
    animation_url: null
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [images, setImages] = useState<ImageItem[]>([])
  const [animationPreview, setAnimationPreview] = useState<string | null>(null)
  const [animationFile, setAnimationFile] = useState<File | null>(null)

  useEffect(() => {
    if (open) {
      if (variant) {
        setFormData({
          product_id: variant.product_id,
          variant_name: variant.variant_name,
          attributes: variant.attributes || {},
          barcode: variant.barcode || '',
          manufacturer_sku: variant.manufacturer_sku || '',
          manual_sku: variant.manual_sku || '',
          base_cost: variant.base_cost,
          suggested_retail_price: variant.suggested_retail_price,
          retailer_price: variant.retailer_price,
          distributor_price: variant.distributor_price,
          other_price: variant.other_price,
          is_active: variant.is_active,
          is_default: variant.is_default,
          image_url: variant.image_url || null,
          additional_images: variant.additional_images || [],
          animation_url: variant.animation_url || null
        })
        
        // Load existing images
        const loadedImages: ImageItem[] = []
        const additionalImages = variant.additional_images || []
        
        // If we have additional_images, use them
        if (additionalImages.length > 0) {
          additionalImages.forEach((url, index) => {
            loadedImages.push({
              id: `loaded-${index}`,
              url: getStorageUrl(url) || url,
              isDefault: index === 0
            })
          })
        } else if (variant.image_url) {
          // Fallback to single image_url
          loadedImages.push({
            id: 'loaded-primary',
            url: getStorageUrl(variant.image_url) || variant.image_url,
            isDefault: true
          })
        }
        setImages(loadedImages)
        setAnimationPreview(getStorageUrl(variant.animation_url) || null)
      } else {
        setFormData({
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
          image_url: null,
          additional_images: [],
          animation_url: null
        })
        setImages([])
        setAnimationPreview(null)
      }
      setErrors({})
      setAnimationFile(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant, products])

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.product_id) {
      newErrors.product_id = 'Product is required'
    }

    if (!formData.variant_name) {
      newErrors.variant_name = 'Name is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const generateVariantCode = (): string => {
    const timestamp = Date.now().toString().slice(-6)
    const nameCode = formData.variant_name?.substring(0, 3).toUpperCase() || 'VAR'
    return `${nameCode}-${timestamp}`
  }

  const generateBarcode = (): string => {
    if (!formData.product_id || !formData.variant_name) return ''
    const product = products.find(p => p.id === formData.product_id)
    const productCode = product ? product.product_name.substring(0, 3).toUpperCase() : 'PRD'
    const variantCode = formData.variant_name.substring(0, 2).toUpperCase()
    const timestamp = Date.now().toString().slice(-5)
    return `${productCode}${variantCode}${timestamp}`
  }

  const generateSKU = (): string => {
    if (!formData.product_id || !formData.variant_name) return ''
    const product = products.find(p => p.id === formData.product_id)
    const productCode = product ? product.product_name.substring(0, 3).toUpperCase() : 'PRD'
    const variantCode = formData.variant_name.substring(0, 3).toUpperCase()
    const timestamp = Date.now().toString().slice(-4)
    return `SKU-${productCode}-${variantCode}-${timestamp}`
  }

  useEffect(() => {
    // Auto-generate barcode and SKU when variant name or product changes
    if (formData.variant_name && formData.product_id && !variant) {
      setFormData(prev => ({
        ...prev,
        barcode: generateBarcode(),
        manufacturer_sku: generateSKU()
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.product_id, formData.variant_name, variant])

  const handleSubmit = () => {
    if (validate()) {
      // Get image files to upload
      const imageFiles = images.filter(img => img.file).map(img => img.file!)
      const existingImageUrls = images.filter(img => !img.file).map(img => img.url)
      const defaultImageIndex = images.findIndex(img => img.isDefault)
      
      onSave({
        ...formData,
        variant_code: generateVariantCode(),
        imageFiles: imageFiles, // Pass multiple image files
        existingImageUrls: existingImageUrls, // Keep existing images
        defaultImageIndex: defaultImageIndex >= 0 ? defaultImageIndex : 0,
        animationFile: animationFile // Pass the animation file
      } as any)
    }
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const remainingSlots = 5 - images.length
    if (remainingSlots <= 0) {
      setErrors(prev => ({ ...prev, image: 'Maximum 5 images allowed' }))
      return
    }

    const filesToAdd = Array.from(files).slice(0, remainingSlots)
    
    for (const file of filesToAdd) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setErrors(prev => ({ ...prev, image: 'Please select valid image files' }))
        continue
      }

      // Check for AVIF format - not supported by Supabase Storage
      if (file.type === 'image/avif') {
        setErrors(prev => ({ ...prev, image: 'AVIF format is not supported. Please use JPG, PNG, GIF, or WebP instead.' }))
        continue
      }

      // Validate file size (max 5MB before compression)
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, image: 'Image size must be less than 5MB' }))
        continue
      }

      try {
        // Always compress variant images to optimize size (target ~5KB)
        console.log('🖼️ Compressing variant image...')
        const compressedFile = await compressImage(file)
        
        // Create preview
        const reader = new FileReader()
        reader.onloadend = () => {
          const newImage: ImageItem = {
            id: `new-${Date.now()}-${Math.random()}`,
            file: compressedFile,
            url: reader.result as string,
            isDefault: images.length === 0 // First image is default
          }
          setImages(prev => [...prev, newImage])
        }
        reader.readAsDataURL(compressedFile)
        
        setErrors(prev => ({ ...prev, image: '' }))
      } catch (error) {
        console.error('Image compression failed:', error)
        setErrors(prev => ({ ...prev, image: 'Image compression failed. Please try a different image.' }))
      }
    }
    
    // Reset input
    if (e.target) {
      e.target.value = ''
    }
  }

  const handleRemoveImage = (imageId: string) => {
    setImages(prev => {
      const filtered = prev.filter(img => img.id !== imageId)
      // If we removed the default, make the first one default
      if (filtered.length > 0 && !filtered.some(img => img.isDefault)) {
        filtered[0].isDefault = true
      }
      return filtered
    })
  }

  const handleSetDefaultImage = (imageId: string) => {
    setImages(prev => prev.map(img => ({
      ...img,
      isDefault: img.id === imageId
    })))
  }

  const handleAnimationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('video/')) {
        setErrors(prev => ({ ...prev, animation: 'Please select a valid video file' }))
        return
      }
      
      // Validate file size (max 50MB for animation)
      if (file.size > 50 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, animation: 'Animation size must be less than 50MB' }))
        return
      }

      setAnimationFile(file)
      setErrors(prev => ({ ...prev, animation: '' }))

      // Create preview
      const url = URL.createObjectURL(file)
      setAnimationPreview(url)
    }
  }

  const handleRemoveAnimation = () => {
    setAnimationFile(null)
    setAnimationPreview(null)
    setFormData(prev => ({ ...prev, animation_url: null }))
  }

  const getVariantInitials = (name: string) => {
    if (!name) return 'V'
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-900">
            {variant ? 'Edit Variant' : 'Add Variant'}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Variant Images Upload - Up to 5 images */}
          <div className="space-y-2">
            <Label>Variant Images (Up to 5)</Label>
            <div className="space-y-3">
              {/* Image Grid */}
              <div className="flex flex-wrap gap-3">
                {images.map((image, index) => (
                  <div key={image.id} className="relative group">
                    <div className={`w-20 h-20 rounded-lg border-2 overflow-hidden ${image.isDefault ? 'border-primary ring-2 ring-primary/30' : 'border-gray-200'}`}>
                      <img 
                        src={image.url} 
                        alt={`Variant image ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {/* Overlay with actions */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1">
                      {!image.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefaultImage(image.id)}
                          className="p-1.5 bg-white/90 rounded-full hover:bg-white text-primary"
                          title="Set as default"
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(image.id)}
                        className="p-1.5 bg-white/90 rounded-full hover:bg-white text-red-600"
                        title="Remove image"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {/* Default badge */}
                    {image.isDefault && (
                      <div className="absolute -top-1 -right-1 bg-primary text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        Default
                      </div>
                    )}
                  </div>
                ))}
                
                {/* Add Image Button */}
                {images.length < 5 && (
                  <button
                    type="button"
                    onClick={() => document.getElementById('variant-image-upload')?.click()}
                    className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-primary"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="text-[10px]">Add</span>
                  </button>
                )}
              </div>
              
              <input
                id="variant-image-upload"
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={handleImageChange}
                multiple
                className="hidden"
              />
              <p className="text-xs text-gray-500">
                PNG, JPG, GIF up to 5MB each. Auto-compresses. First image is default. {images.length}/5 images
              </p>
              {errors.image && <p className="text-xs text-red-500">{errors.image}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Variant Animation (Optional)</Label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-lg border-2 border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
                {animationPreview ? (
                  <video 
                    src={animationPreview} 
                    className="w-full h-full object-cover"
                    muted
                    loop
                    autoPlay
                    playsInline
                  />
                ) : (
                  <div className="text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('variant-animation-upload')?.click()}
                    className="flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    {animationPreview ? 'Change Animation' : 'Upload Animation'}
                  </Button>
                  {animationPreview && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRemoveAnimation}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <input
                  id="variant-animation-upload"
                  type="file"
                  accept="video/mp4,video/webm"
                  onChange={handleAnimationChange}
                  className="hidden"
                />
                <p className="text-xs text-gray-500 mt-1">
                  MP4, WebM up to 50MB. Max 8 seconds recommended.
                </p>
                {errors.animation && <p className="text-xs text-red-500 mt-1">{errors.animation}</p>}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="product">Product *</Label>
            <select
              id="product"
              value={formData.product_id || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, product_id: e.target.value }))
                if (errors.product_id) setErrors(prev => ({ ...prev, product_id: '' }))
              }}
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.product_id ? 'border-red-500' : ''}`}
            >
              <option value="">Select a product</option>
              {products.map(product => (
                <option key={product.id} value={product.id}>{product.product_name}</option>
              ))}
            </select>
            {errors.product_id && <p className="text-xs text-red-500">{errors.product_id}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Variant Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Strawberry - 6mg"
              value={formData.variant_name || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, variant_name: e.target.value }))
                if (errors.variant_name) setErrors(prev => ({ ...prev, variant_name: '' }))
              }}
              className={errors.variant_name ? 'border-red-500' : ''}
            />
            {errors.variant_name && <p className="text-xs text-red-500">{errors.variant_name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="barcode">Barcode <span className="text-xs text-gray-500">(Auto-generated)</span></Label>
            <Input
              id="barcode"
              value={formData.barcode || ''}
              readOnly
              className="bg-gray-100 cursor-not-allowed text-gray-700"
            />
            <p className="text-xs text-gray-500">Automatically generated from product and variant name</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sku">Manufacturer SKU <span className="text-xs text-gray-500">(Auto-generated)</span></Label>
            <Input
              id="sku"
              value={formData.manufacturer_sku || ''}
              readOnly
              className="bg-gray-100 cursor-not-allowed text-gray-700"
            />
            <p className="text-xs text-gray-500">Format: SKU-[Product]-[Variant]-[ID] for easy product identification</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual_sku">Manual SKU <span className="text-xs text-gray-500">(Optional, 5 chars max)</span></Label>
            <Input
              id="manual_sku"
              value={formData.manual_sku || ''}
              onChange={(e) => {
                const value = e.target.value.toUpperCase().slice(0, 5)
                setFormData(prev => ({ ...prev, manual_sku: value }))
              }}
              maxLength={5}
              placeholder="Enter custom SKU"
              className="uppercase"
            />
            <p className="text-xs text-gray-500">Enter your own SKU code (max 5 characters)</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="baseCost">Base Cost (RM)</Label>
              <div className="flex items-center">
                <span className="text-gray-600 mr-2">RM</span>
                <Input
                  id="baseCost"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.base_cost || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, base_cost: e.target.value ? parseFloat(e.target.value) : null }))}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="retailPrice">Retail Price (RM)</Label>
              <div className="flex items-center">
                <span className="text-gray-600 mr-2">RM</span>
                <Input
                  id="retailPrice"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.suggested_retail_price || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, suggested_retail_price: e.target.value ? parseFloat(e.target.value) : null }))}
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="retailerPrice">Retailer Price (RM)</Label>
              <div className="flex items-center">
                <span className="text-gray-600 mr-2">RM</span>
                <Input
                  id="retailerPrice"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.retailer_price || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, retailer_price: e.target.value ? parseFloat(e.target.value) : null }))}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="distributorPrice">Distributor Price (RM)</Label>
              <div className="flex items-center">
                <span className="text-gray-600 mr-2">RM</span>
                <Input
                  id="distributorPrice"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.distributor_price || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, distributor_price: e.target.value ? parseFloat(e.target.value) : null }))}
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="otherPrice">Promo Price (RM)</Label>
            <div className="flex items-center">
              <span className="text-gray-600 mr-2">RM</span>
              <Input
                id="otherPrice"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.other_price || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, other_price: e.target.value ? parseFloat(e.target.value) : null }))}
                className="flex-1"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_default"
              checked={formData.is_default || false}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_default: Boolean(checked) }))}
            />
            <Label htmlFor="is_default" className="font-normal cursor-pointer">Set as Default Variant</Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_active"
              checked={formData.is_active !== false}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: Boolean(checked) }))}
            />
            <Label htmlFor="is_active" className="font-normal cursor-pointer">Active</Label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 sticky bottom-0 bg-white">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
