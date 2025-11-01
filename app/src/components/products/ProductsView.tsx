'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { 
  Package, 
  Search, 
  Plus, 
  Download, 
  Eye, 
  Edit, 
  Trash2,
  TrendingUp,
  Filter,
  LayoutGrid,
  List
} from 'lucide-react'

interface Product {
  id: string
  product_code: string
  product_name: string
  product_description: string | null
  is_vape: boolean
  is_active: boolean
  age_restriction: number | null
  manufacturer_id: string | null
  brands?: {
    brand_name: string
  } | null
  product_categories?: {
    category_name: string
  } | null
  manufacturers?: {
    org_name: string
    org_code: string
  } | null
  product_images?: Array<{
    image_url: string
    is_primary: boolean
  }>
  product_variants?: Array<any>
}

interface ProductsViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function ProductsView({ userProfile, onViewChange }: ProductsViewProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')
  const [currentPage, setCurrentPage] = useState(1)
  const [categories, setCategories] = useState<any[]>([])
  const [brands, setBrands] = useState<any[]>([])
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()
  const itemsPerPage = 10

  useEffect(() => {
    if (isReady) {
      fetchProducts()
      fetchCategories()
      fetchBrands()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, searchQuery, categoryFilter, brandFilter, statusFilter, currentPage])

  const fetchProducts = async () => {
    if (!isReady) return
    
    setLoading(true)
    try {
      let query = supabase
        .from('products')
        .select(`
          id,
          product_code,
          product_name,
          product_description,
          is_vape,
          is_active,
          age_restriction,
          brand_id,
          category_id,
          manufacturer_id,
          brands (
            brand_name
          ),
          product_categories (
            category_name
          ),
          manufacturers:organizations!products_manufacturer_id_fkey (
            org_name,
            org_code
          ),
          product_images (
            image_url,
            is_primary
          )
        `)
        .order('created_at', { ascending: false })

      // Filter by manufacturer_id for manufacturers - they can only see their own products
      const orgTypeCode = userProfile?.organizations?.org_type_code
      if (orgTypeCode === 'MANU' || orgTypeCode === 'MFG') {
        query = query.eq('manufacturer_id', userProfile.organization_id)
      }

      // Apply filters
      if (searchQuery) {
        query = query.or(`product_name.ilike.%${searchQuery}%,product_code.ilike.%${searchQuery}%`)
      }

      if (categoryFilter !== 'all') {
        query = query.eq('category_id', categoryFilter)
      }

      if (brandFilter !== 'all') {
        query = query.eq('brand_id', brandFilter)
      }

      if (statusFilter !== 'all') {
        query = query.eq('is_active', statusFilter === 'active')
      }

      // Pagination
      const start = (currentPage - 1) * itemsPerPage
      const end = start + itemsPerPage - 1
      query = query.range(start, end)

      const { data, error } = await query

      if (error) throw error
      
      // Transform the data to match our interface
      const transformedData = (data || []).map((item: any) => ({
        ...item,
        brands: Array.isArray(item.brands) ? item.brands[0] : item.brands,
        product_categories: Array.isArray(item.product_categories) ? item.product_categories[0] : item.product_categories,
        manufacturers: Array.isArray(item.manufacturers) ? item.manufacturers[0] : item.manufacturers
      }))
      
      setProducts(transformedData)
    } catch (error) {
      console.error('Error fetching products:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('product_categories')
        .select('id, category_name')
        .eq('is_active', true)
        .order('category_name')

      if (error) throw error
      setCategories(data || [])
    } catch (error) {
      console.error('Error fetching categories:', error)
    }
  }

  const fetchBrands = async () => {
    try {
      const { data, error } = await supabase
        .from('brands')
        .select('id, brand_name')
        .eq('is_active', true)
        .order('brand_name')

      if (error) throw error
      setBrands(data || [])
    } catch (error) {
      console.error('Error fetching brands:', error)
    }
  }

  const handleViewProduct = (product: Product) => {
    // Store product ID and navigate to view
    sessionStorage.setItem('selectedProductId', product.id)
    onViewChange?.('view-product')
  }

  const handleEditProduct = (product: Product) => {
    // Store product ID and navigate to edit
    sessionStorage.setItem('selectedProductId', product.id)
    onViewChange?.('edit-product')
  }

  const handleDeleteProduct = async (product: Product) => {
    if (!window.confirm(`Are you sure you want to delete "${product.product_name}"? This action cannot be undone.`)) {
      return
    }

    setDeleting(true)
    setSelectedProductId(product.id)
    
    try {
      // Delete product - cascade will handle variants and images
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', product.id)

      if (error) throw error

      // Refresh the product list
      setProducts(products.filter(p => p.id !== product.id))
      
      toast({
        title: 'Success',
        description: `Product "${product.product_name}" has been deleted`,
      })
    } catch (error: any) {
      console.error('Error deleting product:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete product',
        variant: 'destructive'
      })
    } finally {
      setDeleting(false)
      setSelectedProductId(null)
    }
  }

  const getStatusBadge = (isActive: boolean, isVape: boolean) => {
    if (!isActive) {
      return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">Inactive</Badge>
    }
    return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Active</Badge>
  }

  // Mock stats - in real implementation, these would come from API
  const stats = {
    totalProducts: products.length,
    activeProducts: products.filter(p => p.is_active).length,
    totalCategories: categories.length,
    totalBrands: brands.length
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-600">Manage your product catalog</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button 
            size="sm" 
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => onViewChange?.('add-product')}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
        <Card>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-blue-50 flex items-center justify-center mb-2 sm:mb-0">
                <Package className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              </div>
              <div className="flex items-center gap-1 text-xs sm:text-sm text-green-600">
                <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>+12.5%</span>
              </div>
            </div>
            <p className="text-gray-600 text-xs sm:text-sm mb-1">Total Products</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.totalProducts}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-green-50 flex items-center justify-center mb-2 sm:mb-0">
                <Package className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" />
              </div>
              <div className="flex items-center gap-1 text-xs sm:text-sm text-green-600">
                <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>+8.1%</span>
              </div>
            </div>
            <p className="text-gray-600 text-xs sm:text-sm mb-1">Active Products</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.activeProducts}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-purple-50 flex items-center justify-center mb-2 sm:mb-0">
                <Filter className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
              </div>
            </div>
            <p className="text-gray-600 text-xs sm:text-sm mb-1">Categories</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.totalCategories}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-orange-50 flex items-center justify-center mb-2 sm:mb-0">
                <Package className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
              </div>
            </div>
            <p className="text-gray-600 text-xs sm:text-sm mb-1">Brands</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.totalBrands}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[300px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  placeholder="Search products by name or code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.category_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Brands</SelectItem>
                {brands.map((brand) => (
                  <SelectItem key={brand.id} value={brand.id}>
                    {brand.brand_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button
                variant={viewMode === 'card' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('card')}
                className={viewMode === 'card' ? 'bg-blue-600 hover:bg-blue-700' : ''}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
                className={viewMode === 'list' ? 'bg-blue-600 hover:bg-blue-700' : ''}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Products Display - Card or List View */}
      {viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            [...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-32 bg-gray-200 rounded mb-4"></div>
                  <div className="h-4 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </CardContent>
              </Card>
            ))
          ) : products.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="p-12 text-center">
                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
                <p className="text-gray-600">Try adjusting your search criteria</p>
              </CardContent>
            </Card>
          ) : (
            products.map((product) => {
              const primaryImage = product.product_images?.find(img => img.is_primary)?.image_url ||
                                 product.product_images?.[0]?.image_url
              const initials = product.product_name
                .split(' ')
                .map(word => word[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)

              return (
                <Card key={product.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between mb-3">
                      {primaryImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={primaryImage}
                          alt={product.product_name}
                          className="h-32 w-full object-cover rounded-lg"
                        />
                      ) : (
                        <div className="h-32 w-full rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
                          <span className="text-3xl font-bold text-white">{initials}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg mb-1">
                          <button
                            type="button"
                            onClick={() => handleViewProduct(product)}
                            className="w-full text-left text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded"
                          >
                            {product.product_name}
                          </button>
                        </CardTitle>
                        <CardDescription>{product.product_code}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {product.is_vape && (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                          Vape
                        </Badge>
                      )}
                      {product.age_restriction && product.age_restriction > 0 && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                          {product.age_restriction}+
                        </Badge>
                      )}
                      {getStatusBadge(product.is_active, product.is_vape)}
                    </div>
                    
                    <div className="text-sm space-y-1">
                      <p className="text-gray-600">
                        <span className="font-medium">Brand:</span> {product.brands?.brand_name || 'No Brand'}
                      </p>
                      <p className="text-gray-600">
                        <span className="font-medium">Category:</span> {product.product_categories?.category_name || 'No Category'}
                      </p>
                      <p className="text-gray-600">
                        <span className="font-medium">Manufacturer:</span> {product.manufacturers?.org_name || 'Unknown'} {product.manufacturers?.org_code && `(${product.manufacturers.org_code})`}
                      </p>
                      {product.product_description && (
                        <p className="text-gray-600 text-xs mt-2 line-clamp-2">
                          {product.product_description}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => handleViewProduct(product)}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => handleEditProduct(product)}
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                      {/* Hide delete button for manufacturers */}
                      {userProfile?.organizations?.org_type_code !== 'MANU' && 
                       userProfile?.organizations?.org_type_code !== 'MFG' && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-red-600 hover:text-red-700"
                          onClick={() => handleDeleteProduct(product)}
                          disabled={deleting && selectedProductId === product.id}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>
            {loading ? 'Loading...' : `${products.length} products found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Manufacturer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Loading products...
                  </TableCell>
                </TableRow>
              ) : products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    No products found
                  </TableCell>
                </TableRow>
              ) : (
                products.map((product) => {
                  // Get primary image or first image
                  const primaryImage = product.product_images?.find(img => img.is_primary)?.image_url ||
                                     product.product_images?.[0]?.image_url
                  // Get initials for avatar if no image
                  const initials = product.product_name
                    .split(' ')
                    .map(word => word[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)

                  return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {/* Avatar/Image */}
                        <div className="relative">
                          {primaryImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={primaryImage}
                              alt={product.product_name}
                              className="h-10 w-10 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
                              <span className="text-xs font-semibold text-white">{initials}</span>
                            </div>
                          )}
                        </div>
                        {/* Product Info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleViewProduct(product)}
                              className="font-medium text-left text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded"
                            >
                              {product.product_name}
                            </button>
                            {product.is_vape && (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                Vape
                              </Badge>
                            )}
                            {product.age_restriction && product.age_restriction > 0 && (
                              <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                                {product.age_restriction}+
                              </Badge>
                            )}
                          </div>
                          {product.product_description && (
                            <p className="text-sm text-gray-600 truncate max-w-[250px]">
                              {product.product_description}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {product.brands?.brand_name || 'No Brand'}
                    </TableCell>
                    <TableCell>
                      {product.product_categories?.category_name || 'No Category'}
                    </TableCell>
                    <TableCell>
                      {product.manufacturers?.org_name || 'Unknown'} {product.manufacturers?.org_code && `(${product.manufacturers.org_code})`}
                    </TableCell>
                    <TableCell>
                      {product.is_vape ? (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                          Vape Product
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          Regular Product
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(product.is_active, product.is_vape)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0"
                          onClick={() => handleViewProduct(product)}
                          title="View product details"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0"
                          onClick={() => handleEditProduct(product)}
                          title="Edit product"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        {/* Hide delete button for manufacturers */}
                        {userProfile?.organizations?.org_type_code !== 'MANU' && 
                         userProfile?.organizations?.org_type_code !== 'MFG' && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                            onClick={() => handleDeleteProduct(product)}
                            disabled={deleting && selectedProductId === product.id}
                            title="Delete product"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-gray-600 text-sm">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, products.length)} of {products.length} items
            </p>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="bg-blue-50 text-blue-600 border-blue-200"
              >
                {currentPage}
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={products.length < itemsPerPage}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  )
}