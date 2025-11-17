'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { X, Loader2 } from 'lucide-react'

interface Group {
  id: string
  group_name: string
}

interface SubGroup {
  id?: string
  group_id: string
  subgroup_code?: string
  subgroup_name: string
  subgroup_description: string | null
  is_active: boolean
}

interface SubGroupDialogProps {
  subgroup: SubGroup | null
  groups: Group[]
  open: boolean
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Partial<SubGroup>) => void
}

export default function SubGroupDialog({
  subgroup,
  groups,
  open,
  isSaving,
  onOpenChange,
  onSave
}: SubGroupDialogProps) {
  const [formData, setFormData] = useState<Partial<SubGroup>>({
    group_id: '',
    subgroup_name: '',
    subgroup_description: '',
    is_active: true
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const { isReady, supabase } = useSupabaseAuth()

  useEffect(() => {
    if (open) {
      if (subgroup) {
        setFormData({
          group_id: subgroup.group_id,
          subgroup_name: subgroup.subgroup_name,
          subgroup_description: subgroup.subgroup_description || '',
          is_active: subgroup.is_active
        })
      } else {
        setFormData({
          group_id: groups.length > 0 ? groups[0].id : '',
          subgroup_name: '',
          subgroup_description: '',
          is_active: true
        })
      }
      setErrors({})
    }
  }, [open, subgroup, groups])

  const validate = async (): Promise<boolean> => {
    const newErrors: Record<string, string> = {}

    if (!formData.group_id) {
      newErrors.group_id = 'Group is required'
      setErrors(newErrors)
      return false
    }

    if (!formData.subgroup_name) {
      newErrors.subgroup_name = 'Name is required'
      setErrors(newErrors)
      return false
    }

    // Check for duplicate subgroup name within the same group (only among active subgroups)
    if (isReady) {
      let query = supabase
        .from('product_subgroups')
        .select('id, subgroup_name, group_id')
        .ilike('subgroup_name', formData.subgroup_name?.trim())
        .eq('group_id', formData.group_id)  // Check within same group only
        .eq('is_active', true)
      
      // Exclude current subgroup when editing
      if (subgroup?.id) {
        query = query.neq('id', subgroup.id)
      }
      
      const { data: existingSubGroups } = await query
      
      if (existingSubGroups && existingSubGroups.length > 0) {
        newErrors.subgroup_name = 'This sub-group name already exists in this group. Please choose a different name.'
        setErrors(newErrors)
        return false
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const generateSubGroupCode = (): string => {
    // Generate code from subgroup name: SGP-NAME-TIMESTAMP
    const timestamp = Date.now().toString().slice(-6)
    const nameCode = formData.subgroup_name?.substring(0, 3).toUpperCase() || 'SGP'
    return `${nameCode}-${timestamp}`
  }

  const handleSubmit = async () => {
    const isValid = await validate()
    if (isValid) {
      onSave({
        ...formData,
        subgroup_code: generateSubGroupCode()
      })
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">
            {subgroup ? 'Edit Sub-Group' : 'Add Sub-Group'}
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
            <Label htmlFor="group">Group *</Label>
            <select
              id="group"
              value={formData.group_id || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, group_id: e.target.value }))
                if (errors.group_id) setErrors(prev => ({ ...prev, group_id: '' }))
              }}
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.group_id ? 'border-red-500' : ''}`}
            >
              <option value="">Select a group</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>{group.group_name}</option>
              ))}
            </select>
            {errors.group_id && <p className="text-xs text-red-500">{errors.group_id}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Sub-Group Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Vape Devices"
              value={formData.subgroup_name || ''}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, subgroup_name: e.target.value }))
                if (errors.subgroup_name) setErrors(prev => ({ ...prev, subgroup_name: '' }))
              }}
              className={errors.subgroup_name ? 'border-red-500' : ''}
            />
            {errors.subgroup_name && <p className="text-xs text-red-500">{errors.subgroup_name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter sub-group description..."
              value={formData.subgroup_description || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, subgroup_description: e.target.value }))}
              className="min-h-24"
            />
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
