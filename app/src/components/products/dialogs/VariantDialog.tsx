'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { X, Loader2, Upload, Image as ImageIcon } from 'lucide-react'

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
  base_cost: number | null
  suggested_retail_price: number | null
  is_active: boolean
  is_default: boolean
  image_url?: string | null
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
    base_cost: null,
    suggested_retail_price: null,
    is_active: true,
    is_default: false,
    image_url: null
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  useEffect(() => {
    if (open) {
      if (variant) {
        setFormData({
          product_id: variant.product_id,
          variant_name: variant.variant_name,
          attributes: variant.attributes || {},
          barcode: variant.barcode || '',
          manufacturer_sku: variant.manufacturer_sku || '',
          base_cost: variant.base_cost,
          suggested_retail_price: variant.suggested_retail_price,
          is_active: variant.is_active,
          is_default: variant.is_default,
          image_url: variant.image_url || null
        })
        setImagePreview(variant.image_url || null)
      } else {
        setFormData({
          product_id: products.length > 0 ? products[0].id : '',
          variant_name: '',
          attributes: {},
          barcode: '',
          manufacturer_sku: '',
          base_cost: null,
          suggested_retail_price: null,
          is_active: true,
          is_default: false,
          image_url: null
        })
        setImagePreview(null)
      }
      setErrors({})
      setImageFile(null)
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
      onSave({
        ...formData,
        variant_code: generateVariantCode(),
        imageFile: imageFile // Pass the image file to parent for upload
      } as any)
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setErrors(prev => ({ ...prev, image: 'Please select a valid image file' }))
        return
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, image: 'Image size must be less than 5MB' }))
        return
      }

      setImageFile(file)
      setErrors(prev => ({ ...prev, image: '' }))

      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleRemoveImage = () => {
    setImageFile(null)
    setImagePreview(null)
    setFormData(prev => ({ ...prev, image_url: null }))
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
          {/* Variant Image Upload */}
          <div className="space-y-2">
            <Label>Variant Image</Label>
            <div className="flex items-center gap-4">
              <Avatar className="w-20 h-20 rounded-lg">
                <AvatarImage 
                  src={imagePreview || undefined} 
                  alt={`${formData.variant_name || 'Variant'} image`}
                  className="object-cover"
                />
                <AvatarFallback className="rounded-lg bg-gray-100 text-gray-600 text-lg font-semibold">
                  {formData.variant_name ? getVariantInitials(formData.variant_name) : <ImageIcon className="w-8 h-8" />}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('variant-image-upload')?.click()}
                    className="flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    {imagePreview ? 'Change Image' : 'Upload Image'}
                  </Button>
                  {imagePreview && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRemoveImage}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <input
                  id="variant-image-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <p className="text-xs text-gray-500 mt-1">
                  PNG, JPG, GIF up to 5MB. Recommended: 400x400px
                </p>
                {errors.image && <p className="text-xs text-red-500 mt-1">{errors.image}</p>}
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
