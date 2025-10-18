'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Edit, Trash2, Search, Loader2 } from 'lucide-react'
import SubGroupDialog from '../dialogs/SubGroupDialog'

interface Group {
  id: string
  group_name: string
}

interface SubGroup {
  id: string
  group_id: string
  subgroup_name: string
  subgroup_description: string | null
  is_active: boolean
  created_at: string
  group_name?: string
}

interface SubGroupsTabProps {
  userProfile: any
  onRefresh: () => void
  refreshTrigger: number
}

export default function SubGroupsTab({ userProfile, onRefresh, refreshTrigger }: SubGroupsTabProps) {
  const [subgroups, setSubGroups] = useState<SubGroup[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSubGroup, setEditingSubGroup] = useState<SubGroup | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadGroups()
      loadSubGroups()
    }
  }, [isReady, refreshTrigger])

  const loadGroups = async () => {
    try {
      const { data, error } = await supabase
        .from('product_groups')
        .select('id, group_name')
        .eq('is_active', true)
        .order('group_name', { ascending: true })

      if (error) throw error
      setGroups((data || []) as Group[])
      if (data && data.length > 0 && !selectedGroup) {
        setSelectedGroup(data[0].id)
      }
    } catch (error) {
      console.error('Error loading groups:', error)
    }
  }

  const loadSubGroups = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('product_subgroups')
        .select('*, product_groups(group_name)')
        .order('subgroup_name', { ascending: true })

      if (error) throw error
      const subgroupsData = (data || []).map((subgroup: any) => ({
        ...subgroup,
        group_name: subgroup.product_groups?.group_name || '-'
      }))
      setSubGroups(subgroupsData as SubGroup[])
    } catch (error) {
      console.error('Error loading subgroups:', error)
      toast({
        title: 'Error',
        description: 'Failed to load subgroups',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (subgroupData: Partial<SubGroup>) => {
    try {
      setIsSaving(true)
      if (editingSubGroup) {
        const { error } = await supabase
          .from('product_subgroups')
          .update(subgroupData)
          .eq('id', editingSubGroup.id)
        if (error) throw error
        toast({
          title: 'Success',
          description: 'Sub-group updated successfully'
        })
      } else {
        const { error } = await supabase
          .from('product_subgroups')
          .insert([subgroupData])
        if (error) throw error
        toast({
          title: 'Success',
          description: 'Sub-group created successfully'
        })
      }
      setDialogOpen(false)
      setEditingSubGroup(null)
      loadSubGroups()
    } catch (error) {
      console.error('Error saving subgroup:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save subgroup',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      // Step 1: Check if any products use this subgroup
      const { data: products, error: prodError } = await supabase
        .from('products')
        .select('id, product_name, product_code')
        .eq('subgroup_id', id)
        .eq('is_active', true)
        .limit(5)

      if (prodError) throw prodError

      if (products && products.length > 0) {
        const productList = products.map(p => `${p.product_code} - ${p.product_name}`).join(', ')
        const moreText = products.length === 5 ? ' and possibly more' : ''
        
        toast({
          title: '❌ Cannot Delete Sub-group',
          description: `This sub-group is used by ${products.length} product(s): ${productList}${moreText}. Please remove or reassign these products first.`,
          variant: 'destructive'
        })
        return
      }

      // Step 2: Confirm deletion
      if (!confirm('⚠️ Are you sure you want to permanently delete this sub-group? This action cannot be undone.')) {
        return
      }

      // Step 3: Perform HARD DELETE
      const { error: deleteError } = await supabase
        .from('product_subgroups')
        .delete()
        .eq('id', id)

      if (deleteError) throw deleteError
      
      toast({
        title: '✅ Success',
        description: 'Sub-group deleted successfully'
      })
      
      loadSubGroups()
    } catch (error: any) {
      console.error('Error deleting subgroup:', error)
      toast({
        title: '❌ Delete Failed',
        description: error.message || 'Failed to delete sub-group',
        variant: 'destructive'
      })
    }
  }

  const filteredSubGroups = subgroups.filter(subgroup => {
    const matchesSearch = subgroup.subgroup_name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesGroup = !selectedGroup || subgroup.group_id === selectedGroup
    return matchesSearch && matchesGroup && subgroup.is_active
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-3 flex-1">
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Groups</option>
            {groups.map(group => (
              <option key={group.id} value={group.id}>{group.group_name}</option>
            ))}
          </select>
          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search sub-groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button
          onClick={() => {
            setEditingSubGroup(null)
            setDialogOpen(true)
          }}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Sub-Group
        </Button>
      </div>

      <SubGroupDialog
        subgroup={editingSubGroup}
        groups={groups}
        open={dialogOpen}
        isSaving={isSaving}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
      />

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSubGroups.length > 0 ? (
              filteredSubGroups.map((subgroup) => (
                <TableRow key={subgroup.id} className="hover:bg-gray-50">
                  <TableCell>{subgroup.subgroup_name}</TableCell>
                  <TableCell className="text-sm text-gray-600">{subgroup.group_name}</TableCell>
                  <TableCell className="text-sm text-gray-600 truncate max-w-xs">{subgroup.subgroup_description || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={subgroup.is_active ? 'default' : 'secondary'}>
                      {subgroup.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingSubGroup(subgroup)
                          setDialogOpen(true)
                        }}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(subgroup.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  No sub-groups found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-gray-600">
        Showing {filteredSubGroups.length} of {subgroups.filter(s => s.is_active).length} sub-groups
      </div>
    </div>
  )
}
