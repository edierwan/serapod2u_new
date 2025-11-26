'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import ImageUpload from '@/components/ui/image-upload'
import { 
  ArrowLeft,
  Package,
  Edit,
  Trash2,
  Image as ImageIcon,
  Tag,
  Info,
  AlertCircle,
  Upload
} from 'lucide-react'

interface ViewProductDetailsProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function ViewProductDetails({ userProfile, onViewChange }: ViewProductDetailsProps) {
  const [product, setProduct] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showImageUpload, setShowImageUpload] = useState(false)
  const [deletingVariant, setDeletingVariant] = useState<string | null>(null)
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      fetchProductDetails()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  const fetchProductDetails = async () => {
    const productId = sessionStorage.getItem('selectedProductId')
    
    console.log('🔍 Fetching product details for ID:', productId)
    
    if (!productId || !isReady) {
      console.warn('⚠️ No product ID or Supabase not ready')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('products')
        .select(`
          *,
          brands (
            brand_name,
            brand_code
          ),
          product_categories (
            category_name,
            category_code
          ),
          manufacturers:organizations!products_manufacturer_id_fkey (
            org_name,
            org_code
          ),
          product_images (
            id,
            image_url,
            is_primary,
            sort_order
          ),
          product_variants (
            id,
            variant_name,
            variant_code,
            manufacturer_sku,
            barcode,
            suggested_retail_price,
            base_cost,
            is_active,
            image_url
          )
        `)
        .eq('id', productId)
        .single()

      if (error) {
        console.error('❌ Error fetching product:', error)
        throw error
      }
      
      if (!data) {
        console.warn('⚠️ No product data returned')
        setProduct(null)
        setLoading(false)
        return
      }
      
      console.log('✅ Product loaded:', data)
      
      // Transform the data
      const transformedProduct: any = {
        ...(data as any),
        brands: Array.isArray((data as any).brands) ? (data as any).brands[0] : (data as any).brands,
        product_categories: Array.isArray((data as any).product_categories) ? (data as any).product_categories[0] : (data as any).product_categories,
        manufacturers: Array.isArray((data as any).manufacturers) ? (data as any).manufacturers[0] : (data as any).manufacturers
      }
      
      setProduct(transformedProduct)
    } catch (error) {
      console.error('Error fetching product:', error)
      toast({
        title: 'Error',
        description: 'Failed to load product details',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = () => {
    onViewChange?.('edit-product')
  }

  const handleDelete = async () => {
    if (!product) return
    
    if (!window.confirm(`Are you sure you want to delete "${product.product_name}"? This action cannot be undone.`)) {
      return
    }

    setDeleting(true)
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', product.id)

      if (error) throw error

      toast({
        title: 'Success',
        description: `Product "${product.product_name}" has been deleted`,
      })
      
      onViewChange?.('products')
    } catch (error: any) {
      console.error('Error deleting product:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete product',
        variant: 'destructive'
      })
    } finally {
      setDeleting(false)
    }
  }

  const handleImageUpload = async (file: File) => {
    if (!product) return
    
    setUploadingImage(true)
    try {
      // Upload to Supabase storage
      const fileExt = file.name.split('.').pop()
      const fileName = `${product.product_code}-${Date.now()}.${fileExt}`
      const filePath = `products/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath)

      // Update or create product_images record
      const { error: dbError } = await supabase
        .from('product_images')
        .upsert({
          product_id: product.id,
          image_url: publicUrl,
          is_primary: true,
          sort_order: 0
        })

      if (dbError) throw dbError

      toast({
        title: 'Success',
        description: 'Product image updated successfully',
      })

      setShowImageUpload(false)
      fetchProductDetails()
    } catch (error: any) {
      console.error('Error uploading image:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to upload image',
        variant: 'destructive'
      })
    } finally {
      setUploadingImage(false)
    }
  }

  const handleDeleteVariant = async (variantId: string, variantName: string) => {
    if (!window.confirm(`Are you sure you want to delete variant "${variantName}"?`)) {
      return
    }

    setDeletingVariant(variantId)
    try {
      // Check for dependencies in orders
      const { data: orderItems, error: orderCheckError } = await supabase
        .from('order_items')
        .select('id')
        .eq('variant_id', variantId)
        .limit(1)

      if (orderCheckError) throw orderCheckError

      if (orderItems && orderItems.length > 0) {
        toast({
          title: 'Cannot Delete',
          description: 'This variant is used in existing orders and cannot be deleted.',
          variant: 'destructive'
        })
        return
      }

      // Check for dependencies in QR codes
      const { data: qrCodes, error: qrCheckError } = await supabase
        .from('qr_codes')
        .select('id')
        .eq('variant_id', variantId)
        .limit(1)

      if (qrCheckError) throw qrCheckError

      if (qrCodes && qrCodes.length > 0) {
        toast({
          title: 'Cannot Delete',
          description: 'This variant has QR codes generated and cannot be deleted.',
          variant: 'destructive'
        })
        return
      }

      // Check inventory
      const { data: inventory, error: inventoryCheckError } = await supabase
        .from('inventory')
        .select('id')
        .eq('variant_id', variantId)
        .limit(1)

      if (inventoryCheckError) throw inventoryCheckError

      if (inventory && inventory.length > 0) {
        toast({
          title: 'Cannot Delete',
          description: 'This variant has inventory records and cannot be deleted.',
          variant: 'destructive'
        })
        return
      }

      // Delete variant
      const { error: deleteError } = await supabase
        .from('product_variants')
        .delete()
        .eq('id', variantId)

      if (deleteError) throw deleteError

      toast({
        title: 'Success',
        description: `Variant "${variantName}" has been deleted`,
      })

      fetchProductDetails()
    } catch (error: any) {
      console.error('Error deleting variant:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete variant',
        variant: 'destructive'
      })
    } finally {
      setDeletingVariant(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => onViewChange?.('products')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-200 rounded animate-pulse"></div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => onViewChange?.('products')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-2xl font-bold">Product Not Found</h1>
        </div>
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">The product you&apos;re looking for could not be found.</p>
            <Button className="mt-4" onClick={() => onViewChange?.('products')}>
              Back to Products
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const primaryImage = product.product_images?.find((img: any) => img.is_primary)?.image_url ||
                      product.product_images?.[0]?.image_url

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => onViewChange?.('products')} className="h-8 w-8 p-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{product.product_name}</h1>
            <p className="text-gray-600">Product Code: {product.product_code}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleEdit}>
            <Edit className="w-4 h-4 mr-2" />
            Edit
          </Button>
          <Button 
            variant="outline" 
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product Image */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5" />
                Product Image
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImageUpload(!showImageUpload)}
                disabled={uploadingImage}
              >
                <Upload className="w-4 h-4 mr-1" />
                {showImageUpload ? 'Cancel' : 'Change'}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showImageUpload ? (
              <ImageUpload
                currentImageUrl={primaryImage}
                onImageSelect={handleImageUpload}
                onImageRemove={() => setShowImageUpload(false)}
                label="Upload New Product Image"
              />
            ) : (
              <>
                {primaryImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img 
                    src={primaryImage} 
                    alt={product.product_name}
                    className="w-full h-64 object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
                    <Package className="w-16 h-16 text-gray-400" />
                  </div>
                )}
                {product.product_images && product.product_images.length > 1 && (
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {product.product_images.map((img: any) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img 
                        key={img.id}
                        src={img.image_url}
                        alt="Product"
                        className={`w-full h-16 object-cover rounded cursor-pointer border-2 ${
                          img.is_primary ? 'border-blue-500' : 'border-transparent'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Product Details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="w-5 h-5" />
              Product Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="text-sm font-medium text-gray-700">Brand</label>
                <p className="text-gray-900 mt-1">{product.brands?.brand_name || 'No Brand'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Category</label>
                <p className="text-gray-900 mt-1">{product.product_categories?.category_name || 'No Category'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Manufacturer</label>
                <p className="text-gray-900 mt-1">
                  {product.manufacturers?.org_name || 'Unknown'} 
                  {product.manufacturers?.org_code && ` (${product.manufacturers.org_code})`}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Product Type</label>
                <div className="mt-1">
                  {product.is_vape ? (
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      Vape Product
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                      Regular Product
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Status</label>
                <div className="mt-1">
                  <Badge variant="outline" className={product.is_active ? 
                    'bg-green-50 text-green-700 border-green-200' : 
                    'bg-gray-50 text-gray-700 border-gray-200'
                  }>
                    {product.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
              {product.age_restriction && product.age_restriction > 0 && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Age Restriction</label>
                  <p className="text-gray-900 mt-1">{product.age_restriction}+</p>
                </div>
              )}
            </div>

            {product.product_description && (
              <div>
                <label className="text-sm font-medium text-gray-700">Description</label>
                <p className="text-gray-900 mt-1">{product.product_description}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Variants */}
      {product.product_variants && product.product_variants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              Product Variants ({product.product_variants.length})
            </CardTitle>
            <CardDescription>Different variants of this product</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
              {product.product_variants.map((variant: any) => (
                <Card key={variant.id} className="overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-col gap-3 md:flex-row">
                      <div className="w-full overflow-hidden rounded-lg border border-gray-100 bg-gray-50 md:w-32 md:flex-shrink-0">
                        {variant.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={variant.image_url}
                            alt={variant.variant_name}
                            className="h-32 w-full object-cover md:h-full"
                          />
                        ) : (
                          <div className="flex h-32 w-full items-center justify-center text-gray-400 md:h-24">
                            <ImageIcon className="h-8 w-8" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium text-gray-900">{variant.variant_name}</h4>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={variant.is_active
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : 'bg-gray-50 text-gray-700 border-gray-200'
                              }
                            >
                              {variant.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleDeleteVariant(variant.id, variant.variant_name)}
                              disabled={deletingVariant === variant.id}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1.5 text-sm">
                          <p className="text-gray-600">Code: <span className="text-gray-900">{variant.variant_code}</span></p>
                          <p className="text-gray-600">Mfg SKU: <span className="text-gray-900">{variant.manufacturer_sku || 'N/A'}</span></p>
                          <p className="text-gray-600">Barcode: <span className="text-gray-900">{variant.barcode || 'N/A'}</span></p>
                          <p className="text-gray-600">Retail Price: <span className="text-gray-900 font-medium">RM {variant.suggested_retail_price?.toFixed(2) || '0.00'}</span></p>
                          <p className="text-gray-600">Base Cost: <span className="text-gray-900">RM {variant.base_cost?.toFixed(2) || '0.00'}</span></p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
