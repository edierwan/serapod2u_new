'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Edit, Trash2, Search, Loader2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import BrandDialog from '../dialogs/BrandDialog'
import BrandLogo from '../BrandLogo'
import { normalizePersistedBrandLogo, persistedBrandLogoMatches } from '@/lib/brands/logo'

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
  const [sortColumn, setSortColumn] = useState<string>('brand_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

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
        const expectedLogo = normalizePersistedBrandLogo(brandData.logo_url)
        const { data, error } = await supabase
          .from('brands')
          .update({ ...brandData, logo_url: expectedLogo })
          .eq('id', editingBrand.id)
          .select('*')
          .single()

        if (error) throw error
        if (!data || !persistedBrandLogoMatches(data.logo_url, expectedLogo)) {
          throw new Error('Brand logo was not persisted. Please try again.')
        }
        setBrands(current => current.map(item => item.id === data.id ? data as Brand : item))
        toast({
          title: 'Success',
          description: 'Brand updated successfully'
        })
      } else {
        const expectedLogo = normalizePersistedBrandLogo(brandData.logo_url)
        const { data, error } = await supabase
          .from('brands')
          .insert([{
            brand_name: brandData.brand_name!,
            brand_code: brandData.brand_code!,
            brand_description: brandData.brand_description || null,
            is_active: brandData.is_active !== false,
            logo_url: expectedLogo,
            created_by: userProfile.id
          }])
          .select('*')
          .single()

        if (error) throw error
        if (!data || !persistedBrandLogoMatches(data.logo_url, expectedLogo)) {
          throw new Error('Brand logo was not persisted. Please try again.')
        }
        setBrands(current => [...current, data as Brand])
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

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getSortedBrands = () => {
    const sorted = [...filteredBrands].sort((a, b) => {
      let aValue: any = a[sortColumn as keyof Brand]
      let bValue: any = b[sortColumn as keyof Brand]

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
        <Loader2 className="w-8 h-8 text-[var(--sera-orange)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md sm:flex-1">
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
          className="w-full shrink-0 bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white sm:w-auto"
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

      <div className="border rounded-lg overflow-x-auto">
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('brand_name')}
              >
                <div className="flex items-center justify-between gap-2">
                  Brand {renderSortIcon('brand_name')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('brand_description')}
              >
                <div className="flex items-center justify-between gap-2">
                  Description {renderSortIcon('brand_description')}
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
            {getSortedBrands().length > 0 ? (
              getSortedBrands().map((brand, index) => (
                <TableRow key={brand.id} className="hover:bg-gray-50">
                  <TableCell className="text-center text-sm text-gray-500 font-medium">{index + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <BrandLogo
                        name={brand.brand_name}
                        logoUrl={brand.logo_url}
                        className="w-10 h-10 rounded-full border border-slate-100 object-contain"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900">{brand.brand_name}</div>
                        <div className="text-xs text-gray-500">{brand.brand_code}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-gray-600 truncate max-w-xs">{brand.brand_description || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={brand.is_active ? 'default' : 'secondary'} className="text-xs">
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
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  No brands found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-gray-600">
        Showing {getSortedBrands().length} of {brands.length} brands
      </div>
    </div>
  )
}
