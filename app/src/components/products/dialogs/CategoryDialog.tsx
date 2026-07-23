'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Upload } from 'lucide-react'
import SafeImage from '@/components/shared/SafeImage'
import {
  SeraModalOverlay,
  SeraModalPanel,
  SeraModalHeader,
  SeraModalBody,
  SeraModalFooter,
} from '@/components/ui/sera-modal'

interface Category {
  id?: string
  category_code?: string
  category_name: string
  category_description: string | null
  is_vape: boolean
  image_url: string | null
  is_active: boolean
  hide_price?: boolean
}

interface CategoryDialogProps {
  category: Category | null
  open: boolean
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Partial<Category>) => void
}

export default function CategoryDialog({
  category,
  open,
  isSaving,
  onOpenChange,
  onSave
}: CategoryDialogProps) {
  const [formData, setFormData] = useState<Partial<Category>>({
    category_name: '',
    category_description: '',
    is_vape: false,
    image_url: '',
    is_active: true,
    hide_price: false
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      if (category) {
        setFormData({
          category_name: category.category_name,
          category_description: category.category_description || '',
          is_vape: category.is_vape,
          image_url: category.image_url,
          hide_price: category.hide_price || false
        })
      } else {
        setFormData({
          category_name: '',
          category_description: '',
          is_vape: false,
          image_url: '',
          is_active: true,
          hide_price: false
        })
      }
      setErrors({})
      setUploadError(null)
    }
  }, [open, category])

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.category_name) {
      newErrors.category_name = 'Name is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const generateCategoryCode = (): string => {
    const timestamp = Date.now().toString().slice(-6)
    const nameCode = formData.category_name?.substring(0, 3).toUpperCase() || 'CAT'
    return `${nameCode}-${timestamp}`
  }

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Only image files are allowed')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('File size must be under 2MB')
      return
    }

    setUploading(true)
    setUploadError(null)

    try {
      const fd = new FormData()
      fd.append('file', file)

      const res = await fetch('/api/admin/categories/upload', {
        method: 'POST',
        body: fd,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Upload failed')
      }

      const data = await res.json()
      setFormData(prev => ({ ...prev, image_url: data.url }))
    } catch (err: any) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = () => {
    if (validate()) {
      onSave({
        ...formData,
        category_code: generateCategoryCode()
      })
    }
  }

  if (!open) return null

  return (
    <SeraModalOverlay onBackdropClick={() => !isSaving && onOpenChange(false)}>
      <SeraModalPanel>
        <SeraModalHeader
          title={category ? 'Edit Category' : 'Add Category'}
          onClose={() => !isSaving && onOpenChange(false)}
        />

        <SeraModalBody className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Category Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Vape Liquids"
              value={formData.category_name || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, category_name: e.target.value }))
                if (errors.category_name) setErrors(prev => ({ ...prev, category_name: '' }))
              }}
              className={errors.category_name ? 'border-red-500' : ''}
            />
            {errors.category_name && <p className="text-xs text-red-500">{errors.category_name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter category description..."
              value={formData.category_description || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, category_description: e.target.value }))}
              className="min-h-24"
            />
          </div>

          <div className="space-y-2">
            <Label>Category Image</Label>
            <p className="text-xs text-[var(--sera-muted)]">
              This image will be shown as the category avatar on your storefront.
            </p>
            {formData.image_url ? (
              <div className="relative group">
                <div className="w-24 h-24 rounded-xl overflow-hidden border border-[var(--sera-line)] bg-[var(--sera-mist)]">
                  <SafeImage
                    src={formData.image_url}
                    alt="Category"
                    className="w-full h-full object-contain p-1"
                    fallbackClassName="bg-gray-50"
                    fallbackIconClassName="w-6 h-6 text-gray-300"
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-[var(--sera-orange)] hover:text-[var(--sera-orange-deep)] font-medium"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to remove this category image? This action will be applied when you save.')) {
                        setFormData(prev => ({ ...prev, image_url: '' }))
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-600 font-medium"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full h-20 border-2 border-dashed border-[var(--sera-line)] rounded-xl flex items-center justify-center gap-2 text-[var(--sera-muted)] hover:border-[var(--sera-orange)]/40 hover:text-[var(--sera-orange)] transition-colors"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    <span className="text-sm">Upload image (max 2MB)</span>
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
            {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_vape"
              checked={formData.is_vape || false}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_vape: Boolean(checked) }))}
            />
            <Label htmlFor="is_vape" className="font-normal cursor-pointer">This is a Vape category</Label>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="hide_price"
              checked={formData.hide_price || false}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, hide_price: Boolean(checked) }))}
              className="mt-1"
            />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="hide_price" className="font-normal cursor-pointer">Hide Price</Label>
              <p className="text-xs text-[var(--sera-muted)]">
                If enabled, prices will be hidden in the mobile app for products in this category.
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
        </SeraModalBody>

        <SeraModalFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="border-[var(--sera-line)]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            className="bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white"
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
        </SeraModalFooter>
      </SeraModalPanel>
    </SeraModalOverlay>
  )
}
