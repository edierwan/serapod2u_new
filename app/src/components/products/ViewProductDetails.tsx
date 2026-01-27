'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { getStorageUrl } from '@/lib/utils'
import ImageUpload from '@/components/ui/image-upload'
import { compressProductImage, formatFileSize } from '@/lib/utils/imageCompression'
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
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  // Check if user is independent (no organization) - Guest users
  const isIndependentUser = !userProfile?.organization_id || !userProfile?.organizations

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
            image_url,
            animation_url
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
      // Compress image first
      const compressionResult = await compressProductImage(file)
      
      toast({
        title: '🖼️ Image Compressed',
        description: `${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% smaller)`,
      })

      // Upload to Supabase storage
      const fileName = `${product.product_code}-${Date.now()}.jpg`
      const filePath = `products/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, compressionResult.file, { 
          contentType: compressionResult.file.type,
          upsert: true 
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath)

      // Get current images count
      const currentImagesCount = product.product_images?.length || 0
      const isFirstImage = currentImagesCount === 0

      // Insert new product_images record
      const { error: dbError } = await supabase
        .from('product_images')
        .insert({
          product_id: product.id,
          image_url: publicUrl,
          is_primary: isFirstImage
        })

      if (dbError) throw dbError

      toast({
        title: 'Success',
        description: 'Product image added successfully',
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

  const handleDeleteImage = async (imageId: string, imageUrl: string) => {
    if (!window.confirm('Are you sure you want to delete this image?')) {
      return
    }

    setDeletingImageId(imageId)
    try {
      // Delete from database
      const { error: dbError } = await supabase
        .from('product_images')
        .delete()
        .eq('id', imageId)

      if (dbError) throw dbError

      // Try to delete from storage (optional, may fail if path doesn't match)
      try {
        const pathMatch = imageUrl.match(/products\/(.+)$/)
        if (pathMatch) {
          await supabase.storage
            .from('product-images')
            .remove([`products/${pathMatch[1]}`])
        }
      } catch (storageError) {
        console.warn('Could not delete from storage:', storageError)
      }

      // Update local state instead of refetching
      setProduct(prev => {
        if (!prev) return prev
        const updatedImages = prev.product_images.filter((img: any) => img.id !== imageId)
        
        // If we deleted the primary image and there are other images, make the first one primary
        if (updatedImages.length > 0) {
          const hasPrimary = updatedImages.some((img: any) => img.is_primary)
          if (!hasPrimary) {
            updatedImages[0].is_primary = true
          }
        }
        
        return {
          ...prev,
          product_images: updatedImages
        }
      })

      // Clear selected image if it was the deleted one
      if (selectedImageUrl === imageUrl) {
        setSelectedImageUrl(null)
      }

      toast({
        title: 'Success',
        description: 'Image deleted successfully',
      })
    } catch (error: any) {
      console.error('Error deleting image:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete image',
        variant: 'destructive'
      })
    } finally {
      setDeletingImageId(null)
    }
  }

  const handleSetPrimaryImage = async (imageId: string) => {
    try {
      // Set all images to non-primary
      const { error: resetError } = await supabase
        .from('product_images')
        .update({ is_primary: false })
        .eq('product_id', product.id)

      if (resetError) throw resetError

      // Set selected image as primary
      const { error: setPrimaryError } = await supabase
        .from('product_images')
        .update({ is_primary: true })
        .eq('id', imageId)

      if (setPrimaryError) throw setPrimaryError

      // Update local state without full page refresh
      setProduct((prev: any) => ({
        ...prev,
        product_images: prev.product_images.map((img: any) => ({
          ...img,
          is_primary: img.id === imageId
        }))
      }))
    } catch (error: any) {
      console.error('Error setting primary image:', error)
      toast({
        title: 'Error',
        description: 'Failed to set primary image',
        variant: 'destructive'
      })
    }
  }

  const handleDeleteVariant = async (variantId: string, variantName: string) => {
    if (!window.confirm(`Are you sure you want to delete variant "${variantName}"?`)) {
      return
    }

    setDeletingVariant(variantId)
    try {
      console.log('🗑️ Checking dependencies for variant:', variantId, variantName)
      
      // Check for dependencies in orders
      const { data: orderItems, error: orderCheckError } = await supabase
        .from('order_items')
        .select('id')
        .eq('variant_id', variantId)
        .limit(1)

      if (orderCheckError) {
        console.error('❌ Order check error:', orderCheckError)
        throw new Error(`Failed to check orders: ${orderCheckError.message || 'Unknown error'}`)
      }

      if (orderItems && orderItems.length > 0) {
        console.warn('⚠️ Variant is used in orders')
        toast({
          title: 'Cannot Delete',
          description: 'This variant is used in existing orders and cannot be deleted.',
          variant: 'destructive'
        })
        setDeletingVariant(null)
        return
      }

      // Check for dependencies in QR codes
      const { data: qrCodes, error: qrCheckError } = await supabase
        .from('qr_codes')
        .select('id')
        .eq('variant_id', variantId)
        .limit(1)

      if (qrCheckError) {
        console.error('❌ QR code check error:', qrCheckError)
        throw new Error(`Failed to check QR codes: ${qrCheckError.message || 'Unknown error'}`)
      }

      if (qrCodes && qrCodes.length > 0) {
        console.warn('⚠️ Variant has QR codes')
        toast({
          title: 'Cannot Delete',
          description: 'This variant has QR codes generated and cannot be deleted.',
          variant: 'destructive'
        })
        setDeletingVariant(null)
        return
      }

      // Check inventory (optional - table may not exist)
      console.log('📦 Checking inventory...')
      const { data: inventory, error: inventoryCheckError } = await supabase
        .from('inventory')
        .select('id')
        .eq('variant_id', variantId)
        .limit(1)

      if (inventoryCheckError) {
        // Log the error but don't fail if inventory table doesn't exist or has permission issues
        console.warn('⚠️ Inventory check skipped:', inventoryCheckError)
        console.log('ℹ️ Continuing with deletion (inventory table may not exist)')
      } else if (inventory && inventory.length > 0) {
        console.warn('⚠️ Variant has inventory records')
        toast({
          title: 'Cannot Delete',
          description: 'This variant has inventory records and cannot be deleted.',
          variant: 'destructive'
        })
        setDeletingVariant(null)
        return
      } else {
        console.log('✅ No inventory records found')
      }

      console.log('✅ No dependencies found, proceeding with deletion')
      
      // Delete variant
      const { error: deleteError } = await supabase
        .from('product_variants')
        .delete()
        .eq('id', variantId)

      if (deleteError) {
        console.error('❌ Delete error:', deleteError)
        throw new Error(`Failed to delete variant: ${deleteError.message || 'Unknown error'}`)
      }

      console.log('✅ Variant deleted successfully')
      toast({
        title: 'Success',
        description: `Variant "${variantName}" has been deleted`,
      })

      fetchProductDetails()
    } catch (error: any) {
      console.error('❌ Error deleting variant:', error)
      console.error('❌ Error details:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        error_description: error?.error_description
      })
      const errorMessage = error?.message || error?.error_description || error?.hint || 'Failed to delete variant. Please try again.'
      toast({
        title: 'Error',
        description: errorMessage,
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Product Image - Compact Design */}
        <Card className="lg:col-span-2 border-0 shadow-sm overflow-hidden">
          <CardHeader className="pb-2 px-4 pt-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <ImageIcon className="w-4 h-4 text-blue-600" />
                Product Image
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowImageUpload(!showImageUpload)}
                disabled={uploadingImage}
                className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              >
                <Upload className="w-3 h-3 mr-1" />
                {showImageUpload ? 'Cancel' : 'Change'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {showImageUpload ? (
              <ImageUpload
                currentImageUrl={primaryImage}
                onImageSelect={handleImageUpload}
                onImageRemove={() => setShowImageUpload(false)}
                label="Upload New Product Image"
              />
            ) : (
              <>
                {/* Main Image Display */}
                <div className="relative aspect-square w-full bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl overflow-hidden border border-gray-100">
                  {(selectedImageUrl || primaryImage) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img 
                      src={getStorageUrl(selectedImageUrl || primaryImage) || selectedImageUrl || primaryImage} 
                      alt={product.product_name}
                      className="w-full h-full object-contain p-2"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-12 h-12 text-gray-300" />
                    </div>
                  )}
                </div>

                {/* Thumbnail Gallery */}
                {product.product_images && product.product_images.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-2">
                      {product.product_images.length} image{product.product_images.length > 1 ? 's' : ''}
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {product.product_images.map((img: any) => (
                        <div key={img.id} className="relative group flex-shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img 
                            src={getStorageUrl(img.image_url) || img.image_url}
                            alt="Product"
                            onClick={() => {
                              setSelectedImageUrl(img.image_url)
                              handleSetPrimaryImage(img.id)
                            }}
                            className={`w-14 h-14 object-cover rounded-lg cursor-pointer transition-all duration-200 ${
                              (selectedImageUrl === img.image_url || (!selectedImageUrl && img.is_primary)) 
                                ? 'ring-2 ring-blue-500 ring-offset-1' 
                                : 'border border-gray-200 hover:border-blue-300 opacity-70 hover:opacity-100'
                            }`}
                          />
                          <button
                            type="button"
                            className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-600 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleDeleteImage(img.id, img.image_url)
                            }}
                            disabled={deletingImageId === img.id || product.product_images.length === 1}
                            title={product.product_images.length === 1 ? "Cannot delete the last image" : "Delete image"}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Product Information - Redesigned */}
        <Card className="lg:col-span-3 border-0 shadow-sm">
          <CardHeader className="pb-3 px-4 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Info className="w-4 h-4 text-blue-600" />
              Product Information
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {/* Brand */}
              <div className="space-y-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Brand</span>
                <p className="text-[13px] font-medium text-gray-900">{product.brands?.brand_name || 'No Brand'}</p>
              </div>

              {/* Category */}
              <div className="space-y-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Category</span>
                <p className="text-[13px] font-medium text-gray-900">{product.product_categories?.category_name || 'No Category'}</p>
              </div>

              {/* Manufacturer */}
              <div className="space-y-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Manufacturer</span>
                <p className="text-[13px] font-medium text-gray-900 leading-tight">
                  {product.manufacturers?.org_name || 'Unknown'}
                  {product.manufacturers?.org_code && (
                    <span className="text-gray-500 font-normal"> ({product.manufacturers.org_code})</span>
                  )}
                </p>
              </div>

              {/* Product Type */}
              <div className="space-y-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Product Type</span>
                <div>
                  {product.is_vape ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-700 ring-1 ring-red-600/20">
                      Vape Product
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-600/20">
                      Regular Product
                    </span>
                  )}
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Status</span>
                <div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    product.is_active 
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20' 
                      : 'bg-gray-100 text-gray-500 ring-1 ring-gray-500/20'
                  }`}>
                    {product.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              {/* Age Restriction */}
              {product.age_restriction && product.age_restriction > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Age Restriction</span>
                  <p className="text-[13px] font-medium text-gray-900">{product.age_restriction}+</p>
                </div>
              )}
            </div>

            {/* Description */}
            {product.product_description && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Description</span>
                <p className="text-[12px] text-gray-600 mt-1 leading-relaxed">{product.product_description}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Variants */}
      {product.product_variants && product.product_variants.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Tag className="w-4 h-4 text-blue-600" />
              Product Variants ({product.product_variants.length})
            </CardTitle>
            <CardDescription className="text-xs">Different variants of this product</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {product.product_variants.map((variant: any) => (
                <div 
                  key={variant.id} 
                  className="group relative bg-white rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all duration-200 overflow-hidden"
                >
                  {/* Status Badge & Delete Button */}
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        variant.is_active
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
                          : 'bg-gray-100 text-gray-500 ring-1 ring-gray-500/20'
                      }`}
                    >
                      {variant.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 rounded-full bg-white/80 backdrop-blur-sm text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDeleteVariant(variant.id, variant.variant_name)}
                      disabled={deletingVariant === variant.id}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Image/Animation Section */}
                  <div className="relative aspect-square bg-gradient-to-br from-gray-50 to-gray-100 overflow-hidden">
                    {variant.animation_url ? (
                      <div className="w-full h-full relative">
                        <video
                          src={getStorageUrl(variant.animation_url) || variant.animation_url}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          muted
                          loop
                          autoPlay
                          playsInline
                        />
                        {/* Animation indicator */}
                        <div className="absolute top-2 right-2 bg-black/40 rounded-full p-1.5 backdrop-blur-sm">
                          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                        </div>
                      </div>
                    ) : variant.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getStorageUrl(variant.image_url) || variant.image_url}
                        alt={variant.variant_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="h-10 w-10 text-gray-300" />
                      </div>
                    )}
                  </div>

                  {/* Content Section */}
                  <div className="p-3 space-y-2">
                    {/* Variant Name */}
                    <h4 className="font-medium text-[13px] text-gray-900 leading-tight line-clamp-2">
                      {variant.variant_name}
                    </h4>

                    {/* Info Grid */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-400">Code:</span>
                        <span className="text-gray-700 font-medium">{variant.variant_code}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-400">Mfg SKU:</span>
                        <span className="text-gray-700 font-medium truncate ml-2 max-w-[120px]">{variant.manufacturer_sku || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-400">Barcode:</span>
                        <span className="text-gray-700 font-medium">{variant.barcode || '-'}</span>
                      </div>
                    </div>

                    {/* Price Section */}
                    <div className="pt-2 border-t border-gray-100 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Retail Price</span>
                        <span className="text-[13px] font-semibold text-blue-600">RM {variant.suggested_retail_price?.toFixed(2) || '0.00'}</span>
                      </div>
                      {/* Hide BASE COST for independent users (Level 50 Guest users) */}
                      {!isIndependentUser && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Base Cost</span>
                        <span className="text-[11px] font-medium text-gray-600">RM {variant.base_cost?.toFixed(2) || '0.00'}</span>
                      </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
