'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { X, Loader2 } from 'lucide-react'

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
          hide_price: fals
          is_active: true
        })
      }
      setErrors({})
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
    // Generate code from category name: CAT-NAME-TIMESTAMP
    const timestamp = Date.now().toString().slice(-6)
    const nameCode = formData.category_name?.substring(0, 3).toUpperCase() || 'CAT'
    return `${nameCode}-${timestamp}`
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">
            {category ? 'Edit Category' : 'Add Category'}
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

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_vape"
              checked={formData.is_vape || false}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_vape: Boolean(checked) }))}
            />
            <Label htmlFor="is_vape" className="font-normal cursor-pointer">This is a Vape category</Label>
          </div>start gap-2">
            <Checkbox
              id="hide_price"
              checked={formData.hide_price || false}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, hide_price: Boolean(checked) }))}
              className="mt-1"
            />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="hide_price" className="font-normal cursor-pointer">Hide Price</Label>
              <p className="text-xs text-gray-500">
                If enabled, prices will be hidden in the mobile app for products in this category.
              </p>
            </div>
          </div>

          <div className="flex items-

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_active"
              checked={formData.is_active !== false}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: Boolean(checked) }))}
            />
            <Label htmlFor="is_active" className="font-normal cursor-pointer">Active</Label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
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
