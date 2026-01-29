'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Edit, Trash2, Search, Loader2, Package, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react'
import VariantDialog from '../dialogs/VariantDialog'
import { getStorageUrl } from '@/lib/utils'
import { compressVariantImage, formatFileSize } from '@/lib/utils/imageCompression'

interface Product {
  id: string
  product_name: string
}

interface Variant {
  id: string
  product_id: string
  variant_code?: string
  variant_name: string
  attributes: Record<string, any>
  barcode: string | null
  manufacturer_sku: string | null
  manual_sku: string | null
  base_cost: number | null
  suggested_retail_price: number | null
  retailer_price: number | null
  distributor_price: number | null
  other_price: number | null
  is_active: boolean
  is_default: boolean
  created_at: string
  product_name?: string
  image_url?: string | null
  additional_images?: string[]
  animation_url?: string | null
}

interface VariantsTabProps {
  userProfile: any
  onRefresh: () => void
  refreshTrigger: number
}

export default function VariantsTab({ userProfile, onRefresh, refreshTrigger }: VariantsTabProps) {
  const [variants, setVariants] = useState<Variant[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [sortColumn, setSortColumn] = useState<string>('variant_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20)

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadProducts()
      loadVariants()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, refreshTrigger])

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name')
        .order('product_name', { ascending: true })

      if (error) throw error
      setProducts((data || []) as Product[])
      if (data && data.length > 0 && !selectedProduct) {
        setSelectedProduct((data as any[])[0].id)
      }
    } catch (error) {
      console.error('Error loading products:', error)
    }
  }

  const loadVariants = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('product_variants')
        .select('*, products(product_name)')
        .order('variant_name', { ascending: true })

      if (error) throw error
      const variantsData = (data || []).map((variant: any) => ({
        ...variant,
        product_name: variant.products?.product_name || '-',
        image_url: variant.image_url || null
      }))
      setVariants(variantsData as Variant[])
    } catch (error) {
      console.error('Error loading variants:', error)
      toast({
        title: 'Error',
        description: 'Failed to load variants',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
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

  const handleSave = async (variantData: Partial<Variant> & { imageFile?: File; animationFile?: File | null }) => {
    try {
      setIsSaving(true)
      console.log('💾 Saving variant data:', variantData)
      
      let imageUrl = variantData.image_url || null
      let animationUrl = variantData.animation_url || null

      // Handle image upload if there's a new image file
      if (variantData.imageFile) {
        const file = variantData.imageFile
        console.log('🖼️ Uploading image file:', file.name)
        
        // Compress the image first
        const compressionResult = await compressVariantImage(file)
        
        toast({
          title: '🖼️ Image Compressed',
          description: `${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% smaller)`,
        })

        const fileName = `variant-${Date.now()}.jpg`
        const filePath = `${fileName}`

        // Upload to avatars bucket
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, compressionResult.file, {
            contentType: compressionResult.file.type,
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          console.error('❌ Image upload failed:', uploadError)
          throw uploadError
        }

        // Get public URL with cache-busting
        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(uploadData.path)

        imageUrl = `${publicUrl}?v=${Date.now()}`
        console.log('✅ Image uploaded:', imageUrl)
      }

      // Handle animation upload
      if (variantData.animationFile) {
        const file = variantData.animationFile
        console.log('🎬 Uploading animation file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2) + 'MB')
        
        const fileExt = file.name.split('.').pop()
        const fileName = `variant-anim-${Date.now()}.${fileExt}`
        const filePath = `${fileName}`

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, file, {
            contentType: file.type,
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          console.error('❌ Animation upload failed:', uploadError)
          throw uploadError
        }

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(uploadData.path)

        animationUrl = `${publicUrl}?v=${Date.now()}`
        console.log('✅ Animation uploaded:', animationUrl)
      }

      // Remove files from data before saving to database
      const { imageFile, animationFile, imageFiles, existingImageUrls, defaultImageIndex, ...dbDataClean } = variantData as any
      
      // When editing, fallback to existing product_id if not provided
      const productId = dbDataClean.product_id || (editingVariant ? editingVariant.product_id : null)
      const variantName = dbDataClean.variant_name || (editingVariant ? editingVariant.variant_name : null)
      
      // Validate required fields
      if (!productId) {
        throw new Error('Product is required. Please select a product from the dropdown.')
      }
      if (!variantName) {
        throw new Error('Variant name is required')
      }
      
      console.log('🎯 Final product_id:', productId)
      console.log('📝 Final variant_name:', variantName)
      
      const dataToSave: Record<string, any> = {
        product_id: productId,
        variant_code: dbDataClean.variant_code,
        variant_name: variantName,
        attributes: dbDataClean.attributes || {},
        barcode: dbDataClean.barcode || null,
        manufacturer_sku: dbDataClean.manufacturer_sku || null,
        manual_sku: dbDataClean.manual_sku || null,
        base_cost: dbDataClean.base_cost,
        suggested_retail_price: dbDataClean.suggested_retail_price,
        retailer_price: dbDataClean.retailer_price,
        distributor_price: dbDataClean.distributor_price,
        other_price: dbDataClean.other_price,
        is_active: dbDataClean.is_active !== false,
        is_default: dbDataClean.is_default || false,
        image_url: imageUrl,
        animation_url: animationUrl
      }
      
      console.log('💾 Saving to database:', dataToSave)

      if (editingVariant) {
        console.log('✏️ Updating variant:', editingVariant.id)
        const { error } = await (supabase as any)
          .from('product_variants')
          .update(dataToSave)
          .eq('id', editingVariant.id)
        if (error) {
          console.error('❌ Update error:', error)
          throw error
        }
        console.log('✅ Variant updated successfully')
        toast({
          title: 'Success',
          description: 'Variant updated successfully'
        })
      } else {
        console.log('➕ Creating new variant')
        const { error } = await (supabase as any)
          .from('product_variants')
          .insert([dataToSave])
        if (error) {
          console.error('❌ Insert error:', error)
          throw error
        }
        console.log('✅ Variant created successfully')
        toast({
          title: 'Success',
          description: 'Variant created successfully'
        })
      }
      setDialogOpen(false)
      setEditingVariant(null)
      loadVariants()
    } catch (error: any) {
      console.error('❌ Error saving variant:', error)
      // Extract detailed error message
      let errorMessage = 'Failed to save variant'
      if (error?.message) {
        errorMessage = error.message
      }
      if (error?.details) {
        errorMessage += ': ' + error.details
      }
      if (error?.hint) {
        errorMessage += ' (' + error.hint + ')'
      }
      if (error?.code) {
        console.error('Error code:', error.code)
      }
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this variant?')) return
    try {
      const { error } = await (supabase as any)
        .from('product_variants')
        .update({ is_active: false })
        .eq('id', id)
      if (error) throw error
      toast({
        title: 'Success',
        description: 'Variant deleted successfully'
      })
      loadVariants()
    } catch (error) {
      console.error('Error deleting variant:', error)
      toast({
        title: 'Error',
        description: 'Failed to delete variant',
        variant: 'destructive'
      })
    }
  }

  const filteredVariants = variants.filter(variant => {
    const matchesSearch = variant.variant_name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesProduct = !selectedProduct || variant.product_id === selectedProduct
    return matchesSearch && matchesProduct && variant.is_active
  })

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedProduct])

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getSortedVariants = () => {
    const sorted = [...filteredVariants].sort((a, b) => {
      let aValue: any = a[sortColumn as keyof Variant]
      let bValue: any = b[sortColumn as keyof Variant]

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

  // Pagination calculations
  const totalItems = getSortedVariants().length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedVariants = getSortedVariants().slice(startIndex, endIndex)

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
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Products</option>
            {products.map(product => (
              <option key={product.id} value={product.id}>{product.product_name}</option>
            ))}
          </select>
          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search variants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button
          onClick={() => {
            setEditingVariant(null)
            setDialogOpen(true)
          }}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Variant
        </Button>
      </div>

      <VariantDialog
        key={editingVariant?.id || 'new'}
        variant={editingVariant}
        products={products}
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
              <TableHead>Image</TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('variant_name')}
              >
                <div className="flex items-center justify-between gap-2">
                  Name {renderSortIcon('variant_name')}
                </div>
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('product_name')}
              >
                <div className="flex items-center justify-between gap-2">
                  Product {renderSortIcon('product_name')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('base_cost')}
              >
                <div className="flex items-center justify-end gap-2">
                  Base Cost {renderSortIcon('base_cost')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('suggested_retail_price')}
              >
                <div className="flex items-center justify-end gap-2">
                  Retail Price {renderSortIcon('suggested_retail_price')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort('other_price')}
              >
                <div className="flex items-center justify-end gap-2">
                  Promo Price {renderSortIcon('other_price')}
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
            {paginatedVariants.length > 0 ? (
              paginatedVariants.map((variant, index) => (
                <TableRow key={variant.id} className="hover:bg-gray-50">
                  <TableCell className="text-center text-sm text-gray-500 font-medium">{startIndex + index + 1}</TableCell>
                  <TableCell>
                    <Avatar className="w-10 h-10 rounded-lg">
                      {variant.image_url ? (
                        <AvatarImage 
                          src={getStorageUrl(variant.image_url) || variant.image_url} 
                          alt={`${variant.variant_name} image`}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600 text-xs font-semibold">
                        {getVariantInitials(variant.variant_name)}
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="text-sm">{variant.variant_name}</TableCell>
                  <TableCell className="text-xs text-gray-600">{variant.product_name}</TableCell>
                  <TableCell className="text-right text-xs">{variant.base_cost ? `$${variant.base_cost.toFixed(2)}` : '-'}</TableCell>
                  <TableCell className="text-right text-xs">{variant.suggested_retail_price ? `$${variant.suggested_retail_price.toFixed(2)}` : '-'}</TableCell>
                  <TableCell className="text-right text-xs">
                    {variant.other_price ? `$${variant.other_price.toFixed(2)}` : '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={variant.is_active ? 'default' : 'secondary'} className="text-xs">
                      {variant.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingVariant(variant)
                          setDialogOpen(true)
                        }}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(variant.id)}
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
                <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                  No variants found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">
          Showing {totalItems > 0 ? startIndex + 1 : 0} - {Math.min(endIndex, totalItems)} of {totalItems} variants
        </div>
        
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="h-8"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (currentPage <= 3) {
                  pageNum = i + 1
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = currentPage - 2 + i
                }
                
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                    className="h-8 w-8 p-0"
                  >
                    {pageNum}
                  </Button>
                )
              })}
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="h-8"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
