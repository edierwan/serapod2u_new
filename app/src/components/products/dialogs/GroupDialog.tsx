'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { X, Loader2 } from 'lucide-react'

interface Category {
  id: string
  category_name: string
}

interface Group {
  id?: string
  category_id: string
  group_code?: string
  group_name: string
  group_description: string | null
  is_active: boolean
  hide_price?: boolean
  hide_product?: boolean
  hide_ecommerce?: boolean
}

interface GroupDialogProps {
  group: Group | null
  categories: Category[]
  open: boolean
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Partial<Group>) => void
}

export default function GroupDialog({
  group,
  categories,
  open,
  isSaving,
  onOpenChange,
  onSave
}: GroupDialogProps) {
  const [formData, setFormData] = useState<Partial<Group>>({
    category_id: '',
    group_name: '',
    group_description: '',
    is_active: true,
    hide_price: false,
    hide_product: false,
    hide_ecommerce: false
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const { isReady, supabase } = useSupabaseAuth()

  useEffect(() => {
    if (open) {
      if (group) {
        setFormData({
          category_id: group.category_id,
          group_name: group.group_name,
          group_description: group.group_description || '',
          is_active: group.is_active,
          hide_price: group.hide_price || false,
          hide_product: group.hide_product || false,
          hide_ecommerce: group.hide_ecommerce || false
        })
      } else {
        setFormData({
          category_id: categories.length > 0 ? categories[0].id : '',
          group_name: '',
          group_description: '',
          is_active: true,
          hide_price: false,
          hide_product: false,
          hide_ecommerce: false
        })
      }
      setErrors({})
    }
  }, [open, group, categories])

  const validate = async (): Promise<boolean> => {
    const newErrors: Record<string, string> = {}

    if (!formData.category_id) {
      newErrors.category_id = 'Category is required'
      setErrors(newErrors)
      return false
    }

    if (!formData.group_name) {
      newErrors.group_name = 'Name is required'
      setErrors(newErrors)
      return false
    }

    // Check for duplicate group name (only among active groups)
    if (isReady) {
      let query = supabase
        .from('product_groups')
        .select('id, group_name')
        .ilike('group_name', formData.group_name)
        .eq('is_active', true)  // Only check active groups

      // Exclude current group when editing
      if (group?.id) {
        query = query.neq('id', group.id)
      }

      const { data: existingGroups } = await query

      if (existingGroups && existingGroups.length > 0) {
        newErrors.group_name = 'This group name is already in use. Please choose a different name.'
        setErrors(newErrors)
        return false
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const generateGroupCode = (): string => {
    // Generate code from group name: GRP-NAME-TIMESTAMP
    const timestamp = Date.now().toString().slice(-6)
    const nameCode = formData.group_name?.substring(0, 3).toUpperCase() || 'GRP'
    return `${nameCode}-${timestamp}`
  }

  const handleSubmit = async () => {
    const isValid = await validate()
    if (isValid) {
      onSave({
        ...formData,
        group_code: generateGroupCode()
      })
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">
            {group ? 'Edit Group' : 'Add Group'}
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
            <Label htmlFor="category">Category *</Label>
            <select
              id="category"
              value={formData.category_id || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, category_id: e.target.value }))
                if (errors.category_id) setErrors(prev => ({ ...prev, category_id: '' }))
              }}
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.category_id ? 'border-red-500' : ''}`}
            >
              <option value="">Select a category</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.category_name}</option>
              ))}
            </select>
            {errors.category_id && <p className="text-xs text-red-500">{errors.category_id}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Group Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Vape Accessories"
              value={formData.group_name || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, group_name: e.target.value }))
                if (errors.group_name) setErrors(prev => ({ ...prev, group_name: '' }))
              }}
              className={errors.group_name ? 'border-red-500' : ''}
            />
            {errors.group_name && <p className="text-xs text-red-500">{errors.group_name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter group description..."
              value={formData.group_description || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, group_description: e.target.value }))}
              className="min-h-24"
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_active"
                checked={formData.is_active !== false}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: Boolean(checked) }))}
              />
              <Label htmlFor="is_active" className="font-normal cursor-pointer">Active</Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="hide_price"
                checked={formData.hide_price === true}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, hide_price: Boolean(checked) }))}
              />
              <Label htmlFor="hide_price" className="font-normal cursor-pointer">Hide Price (Catalog)</Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="hide_product"
                checked={formData.hide_product === true}
                onCheckedChange={(checked) => {
                  // If hiding product, also hide price automatically
                  if (checked) {
                    setFormData(prev => ({ ...prev, hide_product: true, hide_price: true }))
                  } else {
                    setFormData(prev => ({ ...prev, hide_product: false }))
                  }
                }}
              />
              <Label htmlFor="hide_product" className="font-normal cursor-pointer">Hide Product (Catalog)</Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="hide_ecommerce"
                checked={formData.hide_ecommerce === true}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, hide_ecommerce: Boolean(checked) }))}
              />
              <Label htmlFor="hide_ecommerce" className="font-normal cursor-pointer">Hide E-commerce</Label>
            </div>
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
