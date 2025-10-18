'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Plus, Edit, Trash2, Search, Loader2 } from 'lucide-react'
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

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadCategories()
    }
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
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-center">Vape</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCategories.length > 0 ? (
              filteredCategories.map((category) => (
                <TableRow key={category.id} className="hover:bg-gray-50">
                  <TableCell>{category.category_name}</TableCell>
                  <TableCell className="text-sm text-gray-600 truncate max-w-xs">{category.category_description || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={category.is_vape ? 'default' : 'secondary'}>
                      {category.is_vape ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={category.is_active ? 'default' : 'secondary'}>
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
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  No categories found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-gray-600">
        Showing {filteredCategories.length} of {categories.length} categories
      </div>
    </div>
  )
}
