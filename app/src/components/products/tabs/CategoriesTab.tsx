'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Plus, Edit, Trash2, Search, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Package } from 'lucide-react'
import CategoryDialog from '../dialogs/CategoryDialog'

interface Category {
  id: string
  category_code: string
  category_name: string
  category_description: string | null
  is_vape: boolean
  image_url: string | null
  is_active: boolean
  created_at: string
}

interface CategoriesTabProps {
  userProfile: any
  onRefresh: () => void
  refreshTrigger: number
}

export default function CategoriesTab({ userProfile, onRefresh, refreshTrigger }: CategoriesTabProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [sortColumn, setSortColumn] = useState<string>('category_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadCategories()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, refreshTrigger])

  const loadCategories = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('product_categories')
        .select('*')
        .eq('is_active', true)
        .order('category_name', { ascending: true })

      if (error) throw error
      setCategories((data || []) as Category[])
    } catch (error) {
      console.error('Error loading categories:', error)
      toast({
        title: 'Error',
        description: 'Failed to load categories',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (categoryData: Partial<Category>) => {
    try {
      setIsSaving(true)
      
      if (editingCategory) {
        const { error } = await supabase
          .from('product_categories')
          .update(categoryData)
          .eq('id', editingCategory.id)

        if (error) throw error
        toast({
          title: 'Success',
          description: 'Category updated successfully'
        })
      } else {
        const { error } = await supabase
          .from('product_categories')
          .insert([{
            ...categoryData,
            created_by: userProfile.id
          }])

        if (error) throw error
        toast({
          title: 'Success',
          description: 'Category created successfully'
        })
      }

      setDialogOpen(false)
      setEditingCategory(null)
      loadCategories()
    } catch (error) {
      console.error('Error saving category:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save category',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      // Step 1: Check if any products use this category
      const { data: products, error: prodError } = await supabase
        .from('products')
        .select('id, product_name, product_code')
        .eq('category_id', id)
        .eq('is_active', true)
        .limit(5)

      if (prodError) throw prodError

      if (products && products.length > 0) {
        const productList = products.map(p => `${p.product_code} - ${p.product_name}`).join(', ')
        const moreText = products.length === 5 ? ' and possibly more' : ''
        
        toast({
          title: '❌ Cannot Delete Category',
          description: `This category is used by ${products.length} product(s): ${productList}${moreText}. Please remove or reassign these products first.`,
          variant: 'destructive'
        })
        return
      }

      // Step 2: Check if any groups reference this category
      const { data: groups, error: groupError } = await supabase
        .from('product_groups')
        .select('id, group_name')
        .eq('category_id', id)
        .eq('is_active', true)
        .limit(5)

      if (groupError) throw groupError

      if (groups && groups.length > 0) {
        const groupList = groups.map(g => g.group_name).join(', ')
        const moreText = groups.length === 5 ? ' and possibly more' : ''
        
        toast({
          title: '❌ Cannot Delete Category',
          description: `This category is used by ${groups.length} group(s): ${groupList}${moreText}. Please delete these groups first.`,
          variant: 'destructive'
        })
        return
      }

      // Step 3: Check if any sub-categories reference this as parent
      const { data: subCategories, error: subError } = await supabase
        .from('product_categories')
        .select('id, category_name')
        .eq('parent_category_id', id)
        .eq('is_active', true)
        .limit(5)

      if (subError) throw subError

      if (subCategories && subCategories.length > 0) {
        const subCatList = subCategories.map(c => c.category_name).join(', ')
        const moreText = subCategories.length === 5 ? ' and possibly more' : ''
        
        toast({
          title: '❌ Cannot Delete Category',
          description: `This category has ${subCategories.length} sub-category(ies): ${subCatList}${moreText}. Please delete these sub-categories first.`,
          variant: 'destructive'
        })
        return
      }

      // Step 4: Confirm deletion
      if (!confirm('⚠️ Are you sure you want to permanently delete this category? This action cannot be undone.')) {
        return
      }

      // Step 5: Perform HARD DELETE
      const { error: deleteError } = await supabase
        .from('product_categories')
        .delete()
        .eq('id', id)

      if (deleteError) throw deleteError
      
      toast({
        title: '✅ Success',
        description: 'Category deleted successfully'
      })
      
      loadCategories()
    } catch (error: any) {
      console.error('Error deleting category:', error)
      toast({
        title: '❌ Delete Failed',
        description: error.message || 'Failed to delete category',
        variant: 'destructive'
      })
    }
  }

  const filteredCategories = categories.filter(cat =>
    cat.category_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getSortedCategories = () => {
    const sorted = [...filteredCategories].sort((a, b) => {
      let aValue: any = a[sortColumn as keyof Category]
      let bValue: any = b[sortColumn as keyof Category]

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
      <div className="flex items-center justify-between">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          onClick={() => {
            setEditingCategory(null)
            setDialogOpen(true)
          }}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Category
        </Button>
      </div>

      <CategoryDialog
        category={editingCategory}
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
              <TableHead className="w-16 text-center">Image</TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('category_name')}
              >
                <div className="flex items-center justify-between gap-2">
                  Name {renderSortIcon('category_name')}
                </div>
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('category_description')}
              >
                <div className="flex items-center justify-between gap-2">
                  Description {renderSortIcon('category_description')}
                </div>
              </TableHead>
              <TableHead 
                className="text-center cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('is_vape')}
              >
                <div className="flex items-center justify-center gap-2">
                  Vape {renderSortIcon('is_vape')}
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
            {getSortedCategories().length > 0 ? (
              getSortedCategories().map((category, index) => (
                <TableRow key={category.id} className="hover:bg-gray-50">
                  <TableCell className="text-center text-sm text-gray-500 font-medium">{index + 1}</TableCell>
                  <TableCell className="text-center">
                    {category.image_url ? (
                      <img
                        src={category.image_url}
                        alt={category.category_name}
                        className="w-10 h-10 rounded-lg object-cover mx-auto border border-gray-100"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center mx-auto">
                        <Package className="w-4 h-4 text-gray-400" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{category.category_name}</TableCell>
                  <TableCell className="text-xs text-gray-600 truncate max-w-xs">{category.category_description || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={category.is_vape ? 'default' : 'secondary'} className="text-xs">
                      {category.is_vape ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={category.is_active ? 'default' : 'secondary'} className="text-xs">
                      {category.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingCategory(category)
                          setDialogOpen(true)
                        }}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(category.id)}
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
                <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                  No categories found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-gray-600">
        Showing {getSortedCategories().length} of {categories.length} categories
      </div>
    </div>
  )
}
