'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Package, Save, X, Image as ImageIcon, Star, Trash2, Upload } from 'lucide-react'
import Image from 'next/image'
import { compressProductImage } from '@/lib/utils/imageCompression'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface EditProductViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function EditProductView({ userProfile, onViewChange }: EditProductViewProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [brands, setBrands] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [productImages, setProductImages] = useState<any[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  const [formData, setFormData] = useState({
    product_code: '',
    product_name: '',
    product_description: '',
    brand_id: '',
    category_id: '',
    is_vape: false,
    is_active: true,
    age_restriction: 0
  })

  useEffect(() => {
    if (isReady) {
      fetchProductDetails()
      fetchProductImages()
      fetchBrands()
      fetchCategories()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  const fetchProductDetails = async () => {
    const productId = sessionStorage.getItem('selectedProductId')
    
    console.log('🔍 Fetching product for edit, ID:', productId)
    
    if (!productId || !isReady) {
      console.warn('⚠️ No product ID or Supabase not ready')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single()

      if (error) {
        console.error('❌ Error fetching product:', error)
        throw error
      }

      if (!data) {
        console.warn('⚠️ No product data returned')
        toast({
          title: 'Error',
          description: 'Product not found',
          variant: 'destructive'
        })
        onViewChange?.('products')
        return
      }

      console.log('✅ Product loaded for edit:', data)

      setFormData({
        product_code: data.product_code || '',
        product_name: data.product_name || '',
        product_description: data.product_description || '',
        brand_id: data.brand_id || '',
        category_id: data.category_id || '',
        is_vape: data.is_vape || false,
        is_active: data.is_active !== false,
        age_restriction: data.age_restriction || 0
      })
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

  const fetchProductImages = async () => {
    const productId = sessionStorage.getItem('selectedProductId')
    if (!productId || !isReady) return

    try {
      const { data, error } = await supabase
        .from('product_images')
        .select('*')
        .eq('product_id', productId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })

      if (error) throw error
      setProductImages(data || [])
    } catch (error) {
      console.error('Error fetching product images:', error)
    }
  }

  const handleImageUpload = async (file: File) => {
    const productId = sessionStorage.getItem('selectedProductId')
    if (!productId) return

    try {
      setUploadingImage(true)

      // Compress image
      const compressionResult = await compressProductImage(file)
      
      toast({
        title: 'Image Compressed',
        description: `${compressionResult.originalSize} → ${compressionResult.compressedSize} (${compressionResult.compressionRatio} smaller)`,
      })

      // Upload to Supabase Storage
      const fileExt = file.name.split('.').pop()
      const fileName = `${productId}-${Date.now()}.${fileExt}`
      const filePath = `products/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, compressionResult.file, {
          contentType: compressionResult.file.type,
          upsert: false
        })

      if (uploadError) {
        console.error('Storage upload error:', JSON.stringify(uploadError, null, 2))
        throw new Error(uploadError.message || 'Failed to upload file to storage')
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath)

      // Check if this is the first image (make it primary)
      const isPrimary = productImages.length === 0

      // Insert into database
      const { data: newImage, error: dbError } = await supabase
        .from('product_images')
        .insert({
          product_id: productId,
          image_url: publicUrl,
          is_primary: isPrimary
        })
        .select()
        .single()

      if (dbError) {
        console.error('Database error:', JSON.stringify(dbError, null, 2))
        throw new Error(dbError.message || 'Failed to save image to database')
      }

      // Update local state
      setProductImages(prev => [...prev, newImage])

      toast({
        title: 'Success',
        description: 'Product image uploaded successfully',
      })
    } catch (error: any) {
      console.error('Error uploading image:', error instanceof Error ? error.message : JSON.stringify(error, null, 2))
      const errorMessage = error instanceof Error ? error.message : 
                          error?.message || 
                          (typeof error === 'string' ? error : 'Failed to upload image')
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      })
    } finally {
      setUploadingImage(false)
    }
  }

  const handleDeleteImage = async (imageId: string, imageUrl: string) => {
    const productId = sessionStorage.getItem('selectedProductId')
    if (!productId) return

    try {
      // Delete from database
      const { error: dbError } = await supabase
        .from('product_images')
        .delete()
        .eq('id', imageId)

      if (dbError) throw dbError

      // Delete from storage
      const urlParts = imageUrl.split('/')
      const fileName = urlParts[urlParts.length - 1]
      const filePath = `products/${fileName}`

      await supabase.storage
        .from('product-images')
        .remove([filePath])

      // Update local state
      setProductImages(prev => prev.filter(img => img.id !== imageId))

      toast({
        title: 'Success',
        description: 'Image deleted successfully',
      })

      setDeletingImageId(null)
    } catch (error: any) {
      console.error('Error deleting image:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete image',
        variant: 'destructive'
      })
    }
  }

  const handleSetPrimaryImage = async (imageId: string) => {
    const productId = sessionStorage.getItem('selectedProductId')
    if (!productId) return

    try {
      // Remove primary from all images
      await supabase
        .from('product_images')
        .update({ is_primary: false })
        .eq('product_id', productId)

      // Set new primary
      await supabase
        .from('product_images')
        .update({ is_primary: true })
        .eq('id', imageId)

      // Update local state
      setProductImages(prev => 
        prev.map(img => ({
          ...img,
          is_primary: img.id === imageId
        }))
      )

      toast({
        title: 'Success',
        description: 'Primary image updated',
      })
    } catch (error: any) {
      console.error('Error setting primary image:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to update primary image',
        variant: 'destructive'
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.product_name || !formData.product_code) {
      toast({
        title: 'Validation Error',
        description: 'Product name and code are required',
        variant: 'destructive'
      })
      return
    }

    const productId = sessionStorage.getItem('selectedProductId')
    if (!productId) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('products')
        .update({
          product_name: formData.product_name,
          product_description: formData.product_description || null,
          brand_id: formData.brand_id || null,
          category_id: formData.category_id || null,
          is_vape: formData.is_vape,
          is_active: formData.is_active,
          age_restriction: formData.age_restriction || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', productId)

      if (error) throw error

      toast({
        title: 'Success',
        description: 'Product updated successfully',
      })

      onViewChange?.('view-product')
    } catch (error: any) {
      console.error('Error updating product:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to update product',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => onViewChange?.('view-product')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-200 rounded animate-pulse"></div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => onViewChange?.('view-product')} className="h-8 w-8 p-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Edit Product</h1>
            <p className="text-gray-600">Update product information</p>
          </div>
        </div>
      </div>

      {/* Product Images */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5" />
            Product Images
          </CardTitle>
          <CardDescription>Manage product images (click image to set as primary, images maintain aspect ratio)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Upload Section */}
          <div className="space-y-2">
            <Label>Upload New Image</Label>
            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="outline"
                disabled={uploadingImage}
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = 'image/*'
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (file) {
                      await handleImageUpload(file)
                    }
                  }
                  input.click()
                }}
              >
                <Upload className="w-4 h-4 mr-2" />
                {uploadingImage ? 'Uploading...' : 'Choose Image'}
              </Button>
              <p className="text-sm text-gray-500">
                Images will be compressed automatically. Supported formats: JPG, PNG, WebP
              </p>
            </div>
          </div>

          {/* Image Grid */}
          {productImages.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {productImages.map((image) => (
                <div
                  key={image.id}
                  className="relative group aspect-square border-2 rounded-lg overflow-hidden cursor-pointer hover:border-blue-500 transition-all"
                  style={{ borderColor: image.is_primary ? '#3b82f6' : '#e5e7eb' }}
                  onClick={() => {
                    if (!image.is_primary) {
                      handleSetPrimaryImage(image.id)
                    }
                  }}
                >
                  <Image
                    src={image.image_url}
                    alt="Product image"
                    fill
                    className="object-contain bg-gray-50"
                    sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
                  />
                  
                  {/* Primary Badge */}
                  {image.is_primary && (
                    <div className="absolute top-2 left-2 bg-blue-600 text-white px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1">
                      <Star className="w-3 h-3 fill-current" />
                      Primary
                    </div>
                  )}

                  {/* Delete Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletingImageId(image.id)
                    }}
                    className="absolute top-2 right-2 z-10 bg-red-600 text-white p-2 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  {/* Preview on Click Overlay */}
                  <div
                    className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-5 transition-all flex items-center justify-center"
                  >
                    {!image.is_primary && (
                      <span className="opacity-0 group-hover:opacity-100 text-sm font-medium text-gray-700 bg-white px-3 py-1 rounded-md shadow-sm">
                        Click to set as primary
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
              <ImageIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-2">No images uploaded yet</p>
              <p className="text-sm text-gray-500">Upload your first product image above</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Product Information
            </CardTitle>
            <CardDescription>Update the details of your product</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="product_code">Product Code *</Label>
                <Input
                  id="product_code"
                  value={formData.product_code}
                  disabled
                  className="bg-gray-50"
                />
                <p className="text-xs text-gray-500">Product code cannot be changed</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="product_name">Product Name *</Label>
                <Input
                  id="product_name"
                  value={formData.product_name}
                  onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="brand_id">Brand</Label>
                <Select value={formData.brand_id || 'none'} onValueChange={(value) => setFormData({ ...formData, brand_id: value === 'none' ? '' : value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select brand" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Brand</SelectItem>
                    {brands.map((brand) => (
                      <SelectItem key={brand.id} value={brand.id}>
                        {brand.brand_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category_id">Category</Label>
                <Select value={formData.category_id || 'none'} onValueChange={(value) => setFormData({ ...formData, category_id: value === 'none' ? '' : value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Category</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.category_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="age_restriction">Age Restriction</Label>
                <Select 
                  value={formData.age_restriction.toString()} 
                  onValueChange={(value) => setFormData({ ...formData, age_restriction: parseInt(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">No Restriction</SelectItem>
                    <SelectItem value="18">18+</SelectItem>
                    <SelectItem value="21">21+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="product_description">Description</Label>
              <Textarea
                id="product_description"
                value={formData.product_description}
                onChange={(e) => setFormData({ ...formData, product_description: e.target.value })}
                rows={4}
                placeholder="Enter product description..."
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_vape"
                  checked={formData.is_vape}
                  onCheckedChange={(checked: boolean) => setFormData({ ...formData, is_vape: checked })}
                />
                <Label htmlFor="is_vape" className="cursor-pointer">Vape Product</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked: boolean) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="is_active" className="cursor-pointer">Active</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 mt-6">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => onViewChange?.('view-product')}
            disabled={saving}
          >
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>

      {/* Delete Image Confirmation Dialog */}
      <AlertDialog open={deletingImageId !== null} onOpenChange={() => setDeletingImageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this image? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const image = productImages.find(img => img.id === deletingImageId)
                if (image) {
                  handleDeleteImage(image.id, image.image_url)
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
