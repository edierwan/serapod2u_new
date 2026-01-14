'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Edit, Trash2, Search, Loader2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import GroupDialog from '../dialogs/GroupDialog'

interface Category {
  id: string
  category_name: string
}

interface Group {
  id: string
  category_id: string
  group_code: string
  group_name: string
  group_description: string | null
  is_active: boolean
  hide_price?: boolean
  hide_product?: boolean
  created_at: string
  category_name?: string
}

interface GroupsTabProps {
  userProfile: any
  onRefresh: () => void
  refreshTrigger: number
}

export default function GroupsTab({ userProfile, onRefresh, refreshTrigger }: GroupsTabProps) {
  const [groups, setGroups] = useState<Group[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [sortColumn, setSortColumn] = useState<string>('group_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadCategories()
      loadGroups()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, refreshTrigger])

  const loadCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('product_categories')
        .select('id, category_name')
        .eq('is_active', true)
        .order('category_name', { ascending: true })

      if (error) throw error
      setCategories((data || []) as Category[])
      // Don't auto-select first category - show all by default
    } catch (error) {
      console.error('Error loading categories:', error)
    }
  }

  const loadGroups = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('product_groups')
        .select(`
          id,
          category_id,
          group_code,
          group_name,
          group_description,
          is_active,
          hide_price,
          hide_product,
          created_at,
          product_categories (
            category_name
          )
        `)
        .order('group_name', { ascending: true })

      if (error) throw error
      
      const groupsData = (data || []).map((group: any) => ({
        id: group.id,
        category_id: group.category_id,
        group_code: group.group_code,
        group_name: group.group_name,
        group_description: group.group_description,
        is_active: group.is_active,
        hide_price: group.hide_price || false,
        hide_product: group.hide_product || false,
        created_at: group.created_at,
        category_name: Array.isArray(group.product_categories) 
          ? group.product_categories[0]?.category_name || '-'
          : group.product_categories?.category_name || '-'
      }))
      
      setGroups(groupsData as Group[])
    } catch (error) {
      console.error('Error loading groups:', error)
      toast({
        title: 'Error',
        description: 'Failed to load groups',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (groupData: Partial<Group>) => {
    try {
      setIsSaving(true)
      if (editingGroup) {
        const { error } = await supabase
          .from('product_groups')
          .update(groupData)
          .eq('id', editingGroup.id)
        if (error) throw error
        toast({
          title: 'Success',
          description: 'Group updated successfully'
        })
      } else {
        const { error } = await supabase
          .from('product_groups')
          .insert([groupData])
        if (error) throw error
        toast({
          title: 'Success',
          description: 'Group created successfully'
        })
      }
      setDialogOpen(false)
      setEditingGroup(null)
      loadGroups()
    } catch (error) {
      console.error('Error saving group:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save group',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      // Step 1: Check if any products use this group
      const { data: products, error: prodError } = await supabase
        .from('products')
        .select('id, product_name, product_code')
        .eq('group_id', id)
        .eq('is_active', true)
        .limit(5)

      if (prodError) throw prodError

      if (products && products.length > 0) {
        const productList = products.map(p => `${p.product_code} - ${p.product_name}`).join(', ')
        const moreText = products.length === 5 ? ' and possibly more' : ''
        
        toast({
          title: '❌ Cannot Delete Group',
          description: `This group is used by ${products.length} product(s): ${productList}${moreText}. Please remove or reassign these products first.`,
          variant: 'destructive'
        })
        return
      }

      // Step 2: Check if any subgroups reference this group
      const { data: subgroups, error: subError } = await supabase
        .from('product_subgroups')
        .select('id, subgroup_name')
        .eq('group_id', id)
        .eq('is_active', true)
        .limit(5)

      if (subError) throw subError

      if (subgroups && subgroups.length > 0) {
        const subgroupList = subgroups.map(s => s.subgroup_name).join(', ')
        const moreText = subgroups.length === 5 ? ' and possibly more' : ''
        
        toast({
          title: '❌ Cannot Delete Group',
          description: `This group has ${subgroups.length} subgroup(s): ${subgroupList}${moreText}. Please delete these subgroups first.`,
          variant: 'destructive'
        })
        return
      }

      // Step 3: Confirm deletion
      if (!confirm('⚠️ Are you sure you want to permanently delete this group? This action cannot be undone.')) {
        return
      }

      // Step 4: Perform HARD DELETE
      const { error: deleteError } = await supabase
        .from('product_groups')
        .delete()
        .eq('id', id)

      if (deleteError) throw deleteError
      
      toast({
        title: '✅ Success',
        description: 'Group deleted successfully'
      })
      
      loadGroups()
    } catch (error: any) {
      console.error('Error deleting group:', error)
      toast({
        title: '❌ Delete Failed',
        description: error.message || 'Failed to delete group',
        variant: 'destructive'
      })
    }
  }

  const filteredGroups = groups.filter(group => {
    const matchesSearch = group.group_name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = !selectedCategory || group.category_id === selectedCategory
    return matchesSearch && matchesCategory && group.is_active
  })

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getSortedGroups = () => {
    const sorted = [...filteredGroups].sort((a, b) => {
      let aValue: any = a[sortColumn as keyof Group]
      let bValue: any = b[sortColumn as keyof Group]

      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = (bValue as string).toLowerCase()
        return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
      }

      if (typeof aValue === 'boolean') {
        aValue = aValue ? 1 : 0
        bValue = bValue ? 1 : 0
      }

      return sortDirection === 'asc' ? (aValue || 0) - (bValue || 0) : (bValue || 0) - (aValue || 0)
    })
    return sorted
  }

  const renderSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-4 h-4 opacity-40" />
    }
    return sortDirection === 'asc' ? <ArrowDown className="w-4 h-4" /> : <ArrowUp className="w-4 h-4" />
  }

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
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.category_name}</option>
            ))}
          </select>
          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button
          onClick={() => {
            setEditingGroup(null)
            setDialogOpen(true)
          }}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Group
        </Button>
      </div>

      <GroupDialog
        group={editingGroup}
        categories={categories}
        open={dialogOpen}
        isSaving={isSaving}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
      />

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('group_name')}
              >
                <div className="flex items-center justify-between gap-2">
                  Name {renderSortIcon('group_name')}
                </div>
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('category_name')}
              >
                <div className="flex items-center justify-between gap-2">
                  Category {renderSortIcon('category_name')}
                </div>
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('group_description')}
              >
                <div className="flex items-center justify-between gap-2">
                  Description {renderSortIcon('group_description')}
                </div>
              </TableHead>
              <TableHead 
                className="text-center cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('is_active')}
              >
                <div className="flex items-center justify-center gap-2">
                  Status {renderSortIcon('is_active')}
                </div>
              </TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {getSortedGroups().length > 0 ? (
              getSortedGroups().map((group, index) => (
                <TableRow key={group.id} className="hover:bg-gray-50">
                  <TableCell className="text-center text-sm text-gray-500 font-medium">{index + 1}</TableCell>
                  <TableCell className="text-sm">{group.group_name}</TableCell>
                  <TableCell className="text-xs text-gray-600">{group.category_name}</TableCell>
                  <TableCell className="text-xs text-gray-600 truncate max-w-xs">{group.group_description || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={group.is_active ? 'default' : 'secondary'} className="text-xs">
                      {group.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingGroup(group)
                          setDialogOpen(true)
                        }}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(group.id)}
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
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  No groups found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-gray-600">
        Showing {getSortedGroups().length} of {groups.filter(g => g.is_active).length} groups
      </div>
    </div>
  )
}
