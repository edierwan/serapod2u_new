'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Edit, Trash2, Search, Loader2 } from 'lucide-react'
import BrandDialog from '../dialogs/BrandDialog'

interface Brand {
  id: string
  brand_code: string
  brand_name: string
  brand_description: string | null
  logo_url: string | null
  is_active: boolean
  created_at: string
}

interface BrandsTabProps {
  userProfile: any
  onRefresh: () => void
  refreshTrigger: number
}

export default function BrandsTab({ userProfile, onRefresh, refreshTrigger }: BrandsTabProps) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadBrands()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, refreshTrigger])

  const loadBrands = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('brands')
        .select('*')
        .eq('is_active', true)
        .order('brand_name', { ascending: true })

      if (error) throw error
      setBrands((data || []) as Brand[])
    } catch (error) {
      console.error('Error loading brands:', error)
      toast({
        title: 'Error',
        description: 'Failed to load brands',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (brandData: Partial<Brand>) => {
    try {
      setIsSaving(true)
      
      if (editingBrand) {
        const { error } = await supabase
          .from('brands')
          .update(brandData)
          .eq('id', editingBrand.id)

        if (error) throw error
        toast({
          title: 'Success',
          description: 'Brand updated successfully'
        })
      } else {
        const { error } = await supabase
          .from('brands')
          .insert([{
            ...brandData,
            created_by: userProfile.id
          }])

        if (error) throw error
        toast({
          title: 'Success',
          description: 'Brand created successfully'
        })
      }

      setDialogOpen(false)
      setEditingBrand(null)
      loadBrands()
    } catch (error) {
      console.error('Error saving brand:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save brand',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      // Step 1: Check if any products are using this brand
      const { data: products, error: checkError } = await supabase
        .from('products')
        .select('id, product_name, product_code')
        .eq('brand_id', id)
        .eq('is_active', true)
        .limit(5)

      if (checkError) {
        console.error('Error checking brand usage:', checkError)
        throw checkError
      }

      // Step 2: If products exist, show error and prevent deletion
      if (products && products.length > 0) {
        const productList = products.map(p => `${p.product_code} - ${p.product_name}`).join(', ')
        const moreText = products.length === 5 ? ' and possibly more' : ''
        
        toast({
          title: '❌ Cannot Delete Brand',
          description: `This brand is currently used by ${products.length} product(s): ${productList}${moreText}. Please remove or reassign these products first.`,
          variant: 'destructive'
        })
        return
      }

      // Step 3: Confirm deletion
      if (!confirm('⚠️ Are you sure you want to permanently delete this brand? This action cannot be undone.')) {
        return
      }

      // Step 4: Perform HARD DELETE
      const { error: deleteError } = await supabase
        .from('brands')
        .delete()
        .eq('id', id)

      if (deleteError) throw deleteError
      
      toast({
        title: '✅ Success',
        description: 'Brand deleted successfully'
      })
      
      loadBrands()
    } catch (error: any) {
      console.error('Error deleting brand:', error)
      toast({
        title: '❌ Delete Failed',
        description: error.message || 'Failed to delete brand',
        variant: 'destructive'
      })
    }
  }

  const filteredBrands = brands.filter(brand =>
    brand.brand_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getBrandInitials = (name: string): string => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
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
            placeholder="Search brands..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          onClick={() => {
            setEditingBrand(null)
            setDialogOpen(true)
          }}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Brand
        </Button>
      </div>

      <BrandDialog
        brand={editingBrand}
        open={dialogOpen}
        isSaving={isSaving}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
      />

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBrands.length > 0 ? (
              filteredBrands.map((brand) => (
                <TableRow key={brand.id} className="hover:bg-gray-50">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10">
                        {brand.logo_url && <AvatarImage src={brand.logo_url} alt={brand.brand_name} />}
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-xs font-medium">
                          {getBrandInitials(brand.brand_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900">{brand.brand_name}</div>
                        <div className="text-sm text-gray-500">{brand.brand_code}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 truncate max-w-xs">{brand.brand_description || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={brand.is_active ? 'default' : 'secondary'}>
                      {brand.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingBrand(brand)
                          setDialogOpen(true)
                        }}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(brand.id)}
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
                <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                  No brands found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-gray-600">
        Showing {filteredBrands.length} of {brands.length} brands
      </div>
    </div>
  )
}
