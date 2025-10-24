'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import { 
  ArrowLeft,
  Package,
  AlertCircle,
  Upload,
  X
} from 'lucide-react'

interface AddProductViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

interface FormData {
  product_code: string
  product_name: string
  product_description: string
  brand_id: string
  category_id: string
  group_id: string
  subgroup_id: string
  manufacturer_id: string
  is_vape: boolean
  age_restriction: number | null
  is_active: boolean
  image_file?: File
}

interface ImagePreview {
  file: File
  url: string
}

export default function AddProductView({ userProfile, onViewChange }: AddProductViewProps) {
  const [formData, setFormData] = useState<FormData>({
    product_code: '',
    product_name: '',
    product_description: '',
    brand_id: '',
    category_id: '',
    group_id: '',
    subgroup_id: '',
    manufacturer_id: '',
    is_vape: false,
    age_restriction: null,
    is_active: true
  })
  
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [brands, setBrands] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [subgroups, setSubgroups] = useState<any[]>([])
  const [manufacturers, setManufacturers] = useState<any[]>([])
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const [checkingName, setCheckingName] = useState(false)
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null)
  
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      fetchBrands()
      fetchCategories()
      fetchManufacturers()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [isReady])

  // Real-time product name validation with debounce
  useEffect(() => {
    if (!formData.product_name.trim()) {
      setNameAvailable(null)
      setCheckingName(false)
      return
    }

    const timer = setTimeout(async () => {
      setCheckingName(true)
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id, product_name')
          .ilike('product_name', formData.product_name.trim())
          .eq('is_active', true)
          .limit(1)

        if (error) {
          console.error('Error checking product name:', error)
          setNameAvailable(null)
        } else {
          const isDuplicate = data && data.length > 0
          setNameAvailable(!isDuplicate)
          
          if (isDuplicate) {
            setErrors(prev => ({
              ...prev,
              product_name: 'This product name is already in use'
            }))
          } else {
            setErrors(prev => {
              const { product_name, ...rest } = prev
              return rest
            })
          }
        }
      } catch (error) {
        console.error('Error in product name check:', error)
        setNameAvailable(null)
      } finally {
        setCheckingName(false)
      }
    }, 500) // 500ms debounce

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [formData.product_name, isReady])

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
      toast({
        title: 'Error',
        description: 'Failed to load brands',
        variant: 'destructive'
      })
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
      toast({
        title: 'Error',
        description: 'Failed to load categories',
        variant: 'destructive'
      })
    }
  }

  const fetchManufacturers = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name, org_code')
        .eq('org_type_code', 'MFG')
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error
      setManufacturers(data || [])
    } catch (error) {
      console.error('Error fetching manufacturers:', error)
      toast({
        title: 'Error',
        description: 'Failed to load manufacturers',
        variant: 'destructive'
      })
    }
  }

  const fetchGroups = async (categoryId: string) => {
    try {
      const { data, error } = await supabase
        .from('product_groups')
        .select('id, group_name')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('group_name')

      if (error) throw error
      setGroups(data || [])
      setSubgroups([]) // Reset subgroups when category changes
      setFormData(prev => ({ ...prev, group_id: '', subgroup_id: '' }))
    } catch (error) {
      console.error('Error fetching groups:', error)
      toast({
        title: 'Error',
        description: 'Failed to load groups',
        variant: 'destructive'
      })
    }
  }

  const fetchSubgroups = async (groupId: string) => {
    try {
      const { data, error } = await supabase
        .from('product_subgroups')
        .select('id, subgroup_name')
        .eq('group_id', groupId)
        .eq('is_active', true)
        .order('subgroup_name')

      if (error) throw error
      setSubgroups(data || [])
      setFormData(prev => ({ ...prev, subgroup_id: '' }))
    } catch (error) {
      console.error('Error fetching subgroups:', error)
      toast({
        title: 'Error',
        description: 'Failed to load subgroups',
        variant: 'destructive'
      })
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.product_name.trim()) {
      newErrors.product_name = 'Product name is required'
    }

    if (!formData.brand_id) {
      newErrors.brand_id = 'Brand is required'
    }

    if (!formData.category_id) {
      newErrors.category_id = 'Category is required'
    }

    if (!formData.group_id) {
      newErrors.group_id = 'Group is required'
    }

    if (!formData.subgroup_id) {
      newErrors.subgroup_id = 'SubGroup is required'
    }

    if (!formData.manufacturer_id) {
      newErrors.manufacturer_id = 'Manufacturer is required'
    }

    if (formData.is_vape && (!formData.age_restriction || formData.age_restriction < 0)) {
      newErrors.age_restriction = 'Age restriction is required for vape products'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const generateProductCode = (): string => {
    const brand = brands.find(b => b.id === formData.brand_id)
    const category = categories.find(c => c.id === formData.category_id)
    
    const brandCode = brand ? brand.brand_name.substring(0, 3).toUpperCase() : 'BRD'
    const categoryCode = category ? category.category_name.substring(0, 2).toUpperCase() : 'CAT'
    const timestamp = Date.now().toString().slice(-4)
    
    return `${brandCode}${categoryCode}${timestamp}`
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Error',
          description: 'Please select an image file',
          variant: 'destructive'
        })
        return
      }

      const reader = new FileReader()
      reader.onload = (event) => {
        setImagePreview({
          file,
          url: event.target?.result as string
        })
        setFormData(prev => ({ ...prev, image_file: file }))
      }
      reader.readAsDataURL(file)
    }
  }

  const removeImage = () => {
    setImagePreview(null)
    setFormData(prev => {
      const { image_file, ...rest } = prev
      return rest as FormData
    })
  }

  const checkDuplicateProductName = async (productName: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name')
        .ilike('product_name', productName.trim())
        .eq('is_active', true)
        .limit(1)

      if (error) {
        console.error('Error checking duplicate product name:', error)
        return false
      }

      return data && data.length > 0
    } catch (error) {
      console.error('Error in duplicate check:', error)
      return false
    }
  }

  const checkDuplicateCombination = async (): Promise<{ isDuplicate: boolean; existingProduct?: any }> => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, product_code')
        .eq('brand_id', formData.brand_id)
        .eq('category_id', formData.category_id)
        .eq('group_id', formData.group_id)
        .eq('subgroup_id', formData.subgroup_id)
        .eq('manufacturer_id', formData.manufacturer_id)
        .eq('is_active', true)
        .limit(1)

      if (error) {
        console.error('Error checking duplicate combination:', error)
        return { isDuplicate: false }
      }

      if (data && data.length > 0) {
        return { isDuplicate: true, existingProduct: data[0] }
      }

      return { isDuplicate: false }
    } catch (error) {
      console.error('Error in duplicate combination check:', error)
      return { isDuplicate: false }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      toast({
        title: 'Error',
        description: 'Please fix the errors in the form',
        variant: 'destructive'
      })
      return
    }

    // Check if name is available (real-time validation should have caught this)
    if (nameAvailable === false) {
      toast({
        title: 'Product Name Already Exists',
        description: `A product with the name "${formData.product_name}" already exists. Please choose a different name.`,
        variant: 'destructive'
      })
      return
    }

    // Check for duplicate combination (Brand + Category + Group + SubGroup + Manufacturer)
    const combinationCheck = await checkDuplicateCombination()
    if (combinationCheck.isDuplicate) {
      const brand = brands.find(b => b.id === formData.brand_id)
      const category = categories.find(c => c.id === formData.category_id)
      const group = groups.find(g => g.id === formData.group_id)
      const subgroup = subgroups.find(s => s.id === formData.subgroup_id)
      const manufacturer = manufacturers.find(m => m.id === formData.manufacturer_id)

      toast({
        title: 'Product Combination Already Exists',
        description: `A product with this exact combination already exists: "${combinationCheck.existingProduct?.product_name}" (${combinationCheck.existingProduct?.product_code}). Combination: ${brand?.brand_name} + ${category?.category_name} + ${group?.group_name} + ${subgroup?.subgroup_name} + ${manufacturer?.org_name}. Please change at least one attribute.`,
        variant: 'destructive'
      })
      
      // Highlight all combination fields
      setErrors(prev => ({
        ...prev,
        brand_id: 'This combination already exists',
        category_id: 'This combination already exists',
        group_id: 'This combination already exists',
        subgroup_id: 'This combination already exists',
        manufacturer_id: 'This combination already exists'
      }))
      return
    }

    setLoading(true)
    try {
      const productCode = generateProductCode()

      const { data: productData, error: productError } = await supabase
        .from('products')
        .insert([
          {
            product_code: productCode,
            product_name: formData.product_name.trim(),
            product_description: formData.product_description || null,
            brand_id: formData.brand_id,
            category_id: formData.category_id,
            group_id: formData.group_id,
            subgroup_id: formData.subgroup_id,
            manufacturer_id: formData.manufacturer_id,
            is_vape: formData.is_vape,
            age_restriction: formData.is_vape ? formData.age_restriction : null,
            is_active: formData.is_active,
            created_by: userProfile.id
          }
        ])
        .select()

      if (productError) throw productError

      // Upload image if provided
      if (imagePreview && productData && productData.length > 0) {
        const productId = productData[0].id
        const fileName = `product-${productId}-${Date.now()}`
        
        const { error: uploadError } = await supabase
          .storage
          .from('product-images')
          .upload(fileName, imagePreview.file)

        if (uploadError) {
          console.error('Image upload error:', uploadError)
          // Continue even if image upload fails
        } else {
          const { data: urlData } = supabase
            .storage
            .from('product-images')
            .getPublicUrl(fileName)

          await supabase
            .from('product_images')
            .insert([
              {
                product_id: productId,
                image_url: urlData.publicUrl,
                image_type: 'PRODUCT',
                is_primary: true,
                uploaded_by: userProfile.id
              }
            ])
        }
      }

      toast({
        title: 'Success',
        description: `Product created successfully with code: ${productCode}`
      })
      onViewChange?.('products')
    } catch (error) {
      console.error('Error creating product:', error)
      toast({
        title: 'Error',
        description: 'Failed to create product',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    
    // Trigger dependent field loading
    if (field === 'category_id' && value) {
      fetchGroups(value)
    }
    
    if (field === 'group_id' && value) {
      fetchSubgroups(value)
    }

    // Clear error for this field when user starts editing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onViewChange?.('products')}
          className="h-8 w-8 p-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Add New Product</h1>
          <p className="text-gray-600">Create a new product in your catalog</p>
        </div>
      </div>

      {/* Form Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Product Information
          </CardTitle>
          <CardDescription>Enter the details of the new product</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Product Code (Auto-generated) */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Product Code <span className="text-xs text-gray-500">(Auto-generated)</span>
              </label>
              <Input
                value={formData.brand_id && formData.category_id ? generateProductCode() : ''}
                readOnly
                className="bg-gray-100 cursor-not-allowed text-gray-700"
                placeholder="Code will be generated when Brand & Category are selected"
              />
              <p className="text-xs text-gray-500">Format: [Brand]-[Category]-[ID] for easy identification</p>
            </div>

            {/* Product Name */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Product Name <span className="text-red-600">*</span>
              </label>
              <div className="relative">
                <Input
                  value={formData.product_name}
                  onChange={(e) => handleChange('product_name', e.target.value)}
                  placeholder="e.g., Premium Vape Device"
                  className={
                    errors.product_name 
                      ? 'border-red-500' 
                      : nameAvailable === true 
                      ? 'border-green-500' 
                      : ''
                  }
                />
                {checkingName && formData.product_name.trim() && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
              
              {checkingName && formData.product_name.trim() && (
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  Checking availability...
                </div>
              )}
              
              {!checkingName && nameAvailable === false && formData.product_name.trim() && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  This product name is already in use. Please choose another name.
                </div>
              )}
              
              {!checkingName && nameAvailable === true && formData.product_name.trim() && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Product name is available
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Product Description
              </label>
              <Input
                value={formData.product_description}
                onChange={(e) => handleChange('product_description', e.target.value)}
                placeholder="Brief description of the product..."
              />
            </div>

            {/* Brand and Category */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Brand <span className="text-red-600">*</span>
                </label>
                <Select value={formData.brand_id} onValueChange={(value) => handleChange('brand_id', value)}>
                  <SelectTrigger className={errors.brand_id ? 'border-red-500' : ''}>
                    <SelectValue placeholder="Select a brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((brand) => (
                      <SelectItem key={brand.id} value={brand.id}>
                        {brand.brand_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.brand_id && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    {errors.brand_id}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Category <span className="text-red-600">*</span>
                </label>
                <Select value={formData.category_id} onValueChange={(value) => handleChange('category_id', value)}>
                  <SelectTrigger className={errors.category_id ? 'border-red-500' : ''}>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.category_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category_id && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    {errors.category_id}
                  </div>
                )}
              </div>
            </div>

            {/* Manufacturer */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Manufacturer <span className="text-red-600">*</span>
              </label>
              <Select value={formData.manufacturer_id} onValueChange={(value) => handleChange('manufacturer_id', value)}>
                <SelectTrigger className={errors.manufacturer_id ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select a manufacturer" />
                </SelectTrigger>
                <SelectContent>
                  {manufacturers.map((manufacturer) => (
                    <SelectItem key={manufacturer.id} value={manufacturer.id}>
                      {manufacturer.org_name} ({manufacturer.org_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.manufacturer_id && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  {errors.manufacturer_id}
                </div>
              )}
            </div>

            {/* Group and SubGroup */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Group <span className="text-red-600">*</span>
                </label>
                <Select 
                  value={formData.group_id} 
                  onValueChange={(value) => handleChange('group_id', value)}
                  disabled={!formData.category_id}
                >
                  <SelectTrigger className={errors.group_id ? 'border-red-500' : ''}>
                    <SelectValue placeholder={formData.category_id ? "Select a group" : "Select Category first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.group_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.group_id && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    {errors.group_id}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  SubGroup <span className="text-red-600">*</span>
                </label>
                <Select 
                  value={formData.subgroup_id} 
                  onValueChange={(value) => handleChange('subgroup_id', value)}
                  disabled={!formData.group_id}
                >
                  <SelectTrigger className={errors.subgroup_id ? 'border-red-500' : ''}>
                    <SelectValue placeholder={formData.group_id ? "Select a subgroup" : "Select Group first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {subgroups.map((subgroup) => (
                      <SelectItem key={subgroup.id} value={subgroup.id}>
                        {subgroup.subgroup_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.subgroup_id && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    {errors.subgroup_id}
                  </div>
                )}
              </div>
            </div>

            {/* Product Image Upload */}
            <div className="space-y-2 p-4 border-2 border-dashed border-gray-300 rounded-lg">
              <label className="text-sm font-medium text-gray-700">Product Image</label>
              
              {imagePreview ? (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src={imagePreview.url} 
                    alt="Product preview" 
                    className="h-32 w-32 object-cover rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={removeImage}
                    className="absolute top-0 right-0 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center py-8 cursor-pointer hover:bg-gray-50 rounded">
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">Click to upload product image</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Product Type and Restrictions */}
            <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={formData.is_vape}
                  onCheckedChange={(checked) => handleChange('is_vape', checked)}
                />
                <span className="text-sm font-medium text-gray-700">This is a vape product</span>
              </label>

              {formData.is_vape && (
                <div className="space-y-2 ml-6">
                  <label className="text-sm font-medium text-gray-700">
                    Age Restriction <span className="text-red-600">*</span>
                  </label>
                  <Select 
                    value={formData.age_restriction?.toString() || ''} 
                    onValueChange={(value) => handleChange('age_restriction', parseInt(value))}
                  >
                    <SelectTrigger className={errors.age_restriction ? 'border-red-500' : ''}>
                      <SelectValue placeholder="Select minimum age" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="18">18+</SelectItem>
                      <SelectItem value="21">21+</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.age_restriction && (
                    <div className="flex items-center gap-2 text-sm text-red-600">
                      <AlertCircle className="w-4 h-4" />
                      {errors.age_restriction}
                    </div>
                  )}
                </div>
              )}

              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={formData.is_active}
                  onCheckedChange={(checked) => handleChange('is_active', checked)}
                />
                <span className="text-sm font-medium text-gray-700">Product is active</span>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-6 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onViewChange?.('products')}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700"
                disabled={loading}
              >
                {loading ? 'Creating...' : 'Create Product'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
