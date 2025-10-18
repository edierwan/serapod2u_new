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
import { ArrowLeft, Package, Save, X } from 'lucide-react'

interface EditProductViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function EditProductView({ userProfile, onViewChange }: EditProductViewProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [brands, setBrands] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
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
      fetchBrands()
      fetchCategories()
    }
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
    </div>
  )
}
