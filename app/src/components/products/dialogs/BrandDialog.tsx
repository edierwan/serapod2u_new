'use client'

import { useState, useEffect, useRef } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { X, Loader2, Upload, Image as ImageIcon } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { compressAvatar, formatFileSize } from '@/lib/utils/imageCompression'

interface Brand {
  id?: string
  brand_code?: string
  brand_name: string
  brand_description: string | null
  logo_url: string | null
  is_active: boolean
}

interface BrandDialogProps {
  brand: Brand | null
  open: boolean
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Partial<Brand>) => void
}

export default function BrandDialog({
  brand,
  open,
  isSaving,
  onOpenChange,
  onSave
}: BrandDialogProps) {
  const [formData, setFormData] = useState<Partial<Brand>>({
    brand_name: '',
    brand_description: '',
    logo_url: '',
    is_active: true
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [imagePreview, setImagePreview] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      if (brand) {
        setFormData({
          brand_name: brand.brand_name,
          brand_description: brand.brand_description || '',
          logo_url: brand.logo_url || '',
          is_active: brand.is_active
        })
        setImagePreview(brand.logo_url || '')
      } else {
        setFormData({
          brand_name: '',
          brand_description: '',
          logo_url: '',
          is_active: true
        })
        setImagePreview('')
      }
      setErrors({})
    }
  }, [open, brand])

  const validate = async (): Promise<boolean> => {
    const newErrors: Record<string, string> = {}

    if (!formData.brand_name) {
      newErrors.brand_name = 'Name is required'
      setErrors(newErrors)
      return false
    }

    // Check for duplicate brand name (only among active brands)
    if (isReady) {
      let query = supabase
        .from('brands')
        .select('id, brand_name')
        .ilike('brand_name', formData.brand_name)
        .eq('is_active', true)  // Only check active brands
      
      // Exclude current brand when editing
      if (brand?.id) {
        query = query.neq('id', brand.id)
      }
      
      const { data: existingBrands } = await query
      
      if (existingBrands && existingBrands.length > 0) {
        newErrors.brand_name = 'This brand name is already in use. Please choose a different name.'
        setErrors(newErrors)
        return false
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid File',
        description: 'Please select an image file',
        variant: 'destructive'
      })
      return
    }

    // Check for AVIF format - not supported by Supabase Storage
    if (file.type === 'image/avif') {
      toast({
        title: 'Format Not Supported',
        description: 'AVIF format is not supported. Please use JPG, PNG, GIF, or WebP instead.',
        variant: 'destructive'
      })
      if (event.target) {
        event.target.value = ''
      }
      return
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'File Too Large',
        description: 'Image must be less than 2MB',
        variant: 'destructive'
      })
      return
    }

    try {
      setUploading(true)

      // Compress the image first
      const compressionResult = await compressAvatar(file)
      
      toast({
        title: '🖼️ Image Compressed',
        description: `${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% smaller)`,
      })

      // Create unique filename
      const fileName = `brand-${Date.now()}.jpg`
      const filePath = `brands/${fileName}`

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from('product-images')
        .upload(filePath, compressionResult.file, {
          contentType: compressionResult.file.type,
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase
        .storage
        .from('product-images')
        .getPublicUrl(filePath)

      const publicUrl = urlData.publicUrl

      setFormData(prev => ({ ...prev, logo_url: publicUrl }))
      setImagePreview(publicUrl)
      
      toast({
        title: 'Success',
        description: 'Image uploaded successfully'
      })
    } catch (error) {
      console.error('Error uploading image:', error)
      toast({
        title: 'Upload Failed',
        description: 'Failed to upload image. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setUploading(false)
    }
  }

  const generateBrandCode = (): string => {
    // Generate code from brand name: BRD-NAME-TIMESTAMP
    const timestamp = Date.now().toString().slice(-6)
    const nameCode = formData.brand_name?.substring(0, 3).toUpperCase() || 'BRD'
    return `${nameCode}-${timestamp}`
  }

  const handleSubmit = async () => {
    const isValid = await validate()
    if (isValid) {
      onSave({
        ...formData,
        brand_code: generateBrandCode()
      })
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">
            {brand ? 'Edit Brand' : 'Add Brand'}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Brand Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Vape Pro Brand"
              value={formData.brand_name || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, brand_name: e.target.value }))
                if (errors.brand_name) setErrors(prev => ({ ...prev, brand_name: '' }))
              }}
              className={errors.brand_name ? 'border-red-500' : ''}
            />
            {errors.brand_name && <p className="text-xs text-red-500">{errors.brand_name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter brand description..."
              value={formData.brand_description || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, brand_description: e.target.value }))}
              className="min-h-24"
            />
          </div>

          <div className="space-y-2">
            <Label>Brand Logo</Label>
            <div className="space-y-3">
              {imagePreview && (
                <div className="relative w-full h-32 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview}
                    alt="Brand logo preview"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}
              
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={handleImageUpload}
                className="hidden"
              />
              
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    {imagePreview ? 'Change Image' : 'Upload Image'}
                  </>
                )}
              </Button>
              
              <p className="text-xs text-gray-500">
                Recommended: PNG or JPG, max 2MB
              </p>
            </div>
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
            disabled={isSaving || uploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving || uploading}
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
