'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { getStorageUrl } from '@/lib/utils'
import { 
  Settings,
  Search,
  ArrowLeft,
  Save,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Info,
  Package,
  Upload,
  X
} from 'lucide-react'

interface Product {
  id: string
  product_code: string
  product_name: string
  brand_id: string | null
  brands?: {
    brand_name: string
  } | null
}

interface Variant {
  id: string
  variant_code: string
  variant_name: string
  image_url: string | null
  suggested_retail_price: number | null
}

interface InventoryItem {
  id: string
  variant_id: string
  organization_id: string
  quantity_on_hand: number
  quantity_allocated: number
  quantity_available: number
  warehouse_location: string | null
  average_cost: number | null
}

interface AdjustmentReason {
  id: string
  reason_code: string
  reason_name: string
  reason_description: string | null
  requires_approval: boolean | null
}

interface WarehouseLocation {
  id: string
  org_code: string
  org_name: string
}

interface PendingAdjustment {
  id: string
  variantId: string
  variantName: string
  productName: string
  warehouseId: string
  warehouseName: string
  physicalCount: number
  systemCount: number
  adjustment: number
  reasonId: string
  reasonName: string
  notes: string
  evidenceFiles: File[]
  unitCost: number | null
  warehouseLocation: string | null
}

interface StockAdjustmentViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function StockAdjustmentView({ userProfile, onViewChange }: StockAdjustmentViewProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [reasons, setReasons] = useState<AdjustmentReason[]>([])
  const [warehouseLocations, setWarehouseLocations] = useState<WarehouseLocation[]>([])
  const [pendingAdjustments, setPendingAdjustments] = useState<PendingAdjustment[]>([])
  
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [selectedReason, setSelectedReason] = useState('')
  
  const [currentInventory, setCurrentInventory] = useState<InventoryItem | null>(null)
  const [physicalCount, setPhysicalCount] = useState('')
  const [notes, setNotes] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const [uploadingImages, setUploadingImages] = useState(false)
  
  const [loading, setLoading] = useState(false)
  const [checkingInventory, setCheckingInventory] = useState(false)
  const [productsLoading, setProductsLoading] = useState(true)
  
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadReasons()
      loadWarehouseLocations()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (selectedWarehouse) {
      loadProducts(selectedWarehouse)
      // Reset product and variant when warehouse changes
      setSelectedProduct('')
      setSelectedVariant('')
      setVariants([])
      setCurrentInventory(null)
    } else {
      setProducts([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWarehouse])

  useEffect(() => {
    if (selectedProduct && selectedWarehouse) {
      loadVariants(selectedProduct, selectedWarehouse)
    } else {
      setVariants([])
      setSelectedVariant('')
      setCurrentInventory(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct])

  useEffect(() => {
    if (selectedVariant && selectedWarehouse) {
      checkCurrentInventory()
    } else {
      setCurrentInventory(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant, selectedWarehouse])

  const loadProducts = async (warehouseId: string) => {
    try {
      setProductsLoading(true)
      
      // Only fetch products that have inventory in the selected warehouse
      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          product_code,
          product_name,
          brand_id,
          brands (
            brand_name
          ),
          product_variants!inner (
            product_inventory!inner (
              organization_id
            )
          )
        `)
        .eq('is_active', true)
        .eq('product_variants.product_inventory.organization_id', warehouseId)
        .order('product_name')

      if (error) throw error
      
      // Transform the data to handle brands array
      // Use a Map to filter out duplicates since the join might return multiple rows per product
      const productMap = new Map()
      
      ;(data || []).forEach((item: any) => {
        if (!productMap.has(item.id)) {
          productMap.set(item.id, {
            id: item.id,
            product_code: item.product_code,
            product_name: item.product_name,
            brand_id: item.brand_id,
            brands: Array.isArray(item.brands) ? item.brands[0] : item.brands
          })
        }
      })
      
      setProducts(Array.from(productMap.values()))
    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to load products: ${error.message}`,
        variant: 'destructive'
      })
    } finally {
      setProductsLoading(false)
    }
  }

  const loadVariants = async (productId: string, warehouseId: string) => {
    try {
      // Only fetch variants that have inventory in the selected warehouse
      const { data, error } = await supabase
        .from('product_variants')
        .select(`
          id, 
          variant_code, 
          variant_name, 
          image_url, 
          suggested_retail_price,
          product_inventory!inner (
            organization_id
          )
        `)
        .eq('product_id', productId)
        .eq('is_active', true)
        .eq('product_inventory.organization_id', warehouseId)
        .order('variant_name')

      if (error) throw error
      
      // Transform to remove the inner join data from the result type
      const variantsList: Variant[] = (data || []).map((item: any) => ({
        id: item.id,
        variant_code: item.variant_code,
        variant_name: item.variant_name,
        image_url: item.image_url,
        suggested_retail_price: item.suggested_retail_price
      }))
      
      setVariants(variantsList)
      
      // Auto-select if only one variant
      if (variantsList.length === 1) {
        setSelectedVariant(variantsList[0].id)
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to load variants: ${error.message}`,
        variant: 'destructive'
      })
    }
  }

  const loadReasons = async () => {
    try {
      const { data, error } = await supabase
        .from('stock_adjustment_reasons')
        .select('*')
        .eq('is_active', true)
        .order('reason_name')

      if (error) throw error
      setReasons(data || [])
    } catch (error: any) {
      console.error('Failed to load adjustment reasons:', error)
    }
  }

  const loadWarehouseLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_code, org_name')
        .in('org_type_code', ['HQ', 'WH'])
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error
      const locationsList: WarehouseLocation[] = data || []
      setWarehouseLocations(locationsList)
      
      // Auto-select HQ if available
      const hqLocation = locationsList.find((loc: WarehouseLocation) => 
        loc.org_code === 'HQ' || loc.org_name.includes('Headquarter')
      )
      if (hqLocation) {
        setSelectedWarehouse(hqLocation.id)
      } else if (locationsList.length === 1) {
        setSelectedWarehouse(locationsList[0].id)
      }
    } catch (error: any) {
      console.error('Failed to load warehouse locations:', error)
    }
  }

  const checkCurrentInventory = async () => {
    if (!selectedVariant || !selectedWarehouse) return

    try {
      setCheckingInventory(true)
      const { data, error } = await supabase
        .from('product_inventory')
        .select('*')
        .eq('variant_id', selectedVariant)
        .eq('organization_id', selectedWarehouse)
        .eq('is_active', true)
        .single()

      if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        throw error
      }

      const inventoryData: InventoryItem | null = data as any
      setCurrentInventory(inventoryData)
      
      // Pre-fill physical count with current quantity
      if (inventoryData) {
        setPhysicalCount(inventoryData.quantity_on_hand.toString())
      } else {
        setPhysicalCount('0')
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to check inventory: ${error.message}`,
        variant: 'destructive'
      })
    } finally {
      setCheckingInventory(false)
    }
  }

  const calculateAdjustment = () => {
    if (!currentInventory || !physicalCount) return 0
    const physical = parseInt(physicalCount)
    const system = currentInventory.quantity_on_hand
    return physical - system
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      // Validate files (e.g., size, type)
      const validFiles = newFiles.filter(file => {
        if (!file.type.startsWith('image/')) {
          toast({
            title: 'Invalid File',
            description: `${file.name} is not an image`,
            variant: 'destructive'
          })
          return false
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
          toast({
            title: 'File Too Large',
            description: `${file.name} exceeds 5MB limit`,
            variant: 'destructive'
          })
          return false
        }
        return true
      })
      
      setEvidenceFiles(prev => [...prev, ...validFiles])
    }
  }

  const removeFile = (index: number) => {
    setEvidenceFiles(prev => prev.filter((_, i) => i !== index))
  }

  const uploadEvidenceFiles = async (filesToUpload: File[]): Promise<string[]> => {
    if (filesToUpload.length === 0) return []
    
    setUploadingImages(true)
    const uploadedUrls: string[] = []
    
    try {
      for (const file of filesToUpload) {
        const fileExt = file.name.split('.').pop()
        const fileName = `${userProfile.id}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = `stock_evidence/${fileName}`
        
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          })
          
        if (uploadError) throw uploadError
        
        const { data: { publicUrl } } = supabase.storage
          .from('documents')
          .getPublicUrl(filePath)
          
        uploadedUrls.push(publicUrl)
      }
      return uploadedUrls
    } catch (error: any) {
      console.error('Error uploading evidence:', error)
      throw new Error('Failed to upload evidence images')
    } finally {
      setUploadingImages(false)
    }
  }

  const handleAddToQueue = (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedProduct || !selectedVariant || !selectedWarehouse || !physicalCount || !selectedReason) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields',
        variant: 'destructive'
      })
      return
    }

    const physical = parseInt(physicalCount)
    if (physical < 0) {
      toast({
        title: 'Validation Error',
        description: 'Physical count cannot be negative',
        variant: 'destructive'
      })
      return
    }

    const adjustment = calculateAdjustment()
    if (adjustment === 0) {
      toast({
        title: 'No Adjustment Needed',
        description: 'Physical count matches system quantity',
        variant: 'default'
      })
      return
    }

    const selectedReasonData = reasons.find(r => r.id === selectedReason)
    const selectedVariantData = variants.find(v => v.id === selectedVariant)
    const selectedProductData = products.find(p => p.id === selectedProduct)
    const selectedWarehouseData = warehouseLocations.find(w => w.id === selectedWarehouse)

    if (!selectedVariantData || !selectedProductData || !selectedWarehouseData || !selectedReasonData) return

    // Validation for specific reasons
    const reasonName = selectedReasonData.reason_name
    const reasonCode = (selectedReasonData as any).reason_code
    
    const decreaseOnlyReasons = [
      "Damaged Goods",
      "Expired Goods",
      "Quality Issue",
      "Return to Supplier"
    ]
    
    const increaseOnlyReasons = [
      "Found Stock"
    ]

    // Check decrease only reasons
    if (decreaseOnlyReasons.some(r => reasonName.includes(r))) {
      if (adjustment >= 0) {
        toast({
          title: 'Invalid Adjustment',
          description: `For reason "${reasonName}", stock can only be decreased. Physical count must be less than system count.`,
          variant: 'destructive'
        })
        return
      }
    }

    // Check increase only reasons
    if (increaseOnlyReasons.some(r => reasonName.includes(r))) {
      if (adjustment <= 0) {
        toast({
          title: 'Invalid Adjustment',
          description: `For reason "${reasonName}", stock can only be increased. Physical count must be greater than system count.`,
          variant: 'destructive'
        })
        return
      }
    }

    // If this reason requires manufacturer proof (quality/return), ensure files are attached
    const requiresEvidenceCodes = ['quality_issue', 'return_to_supplier']
    if (requiresEvidenceCodes.includes(reasonCode) && evidenceFiles.length === 0) {
      toast({
        title: 'Evidence Required',
        description: `Reason "${reasonName}" requires at least one image attachment as proof. Please attach evidence before adding to queue.`,
        variant: 'destructive'
      })
      return
    }

    const newItem: PendingAdjustment = {
      id: Math.random().toString(36).substring(7),
      variantId: selectedVariant,
      variantName: selectedVariantData.variant_name,
      productName: selectedProductData.product_name,
      warehouseId: selectedWarehouse,
      warehouseName: selectedWarehouseData.org_name,
      physicalCount: physical,
      systemCount: currentInventory?.quantity_on_hand || 0,
      adjustment,
      reasonId: selectedReason,
      reasonName: selectedReasonData?.reason_name || 'Stock adjustment',
      notes,
            evidenceFiles: [...evidenceFiles],
      unitCost: currentInventory?.average_cost || null,
      warehouseLocation: currentInventory?.warehouse_location || null
    }

    setPendingAdjustments(prev => [...prev, newItem])
    
    toast({
      title: 'Added to Queue',
      description: 'Item added to pending adjustments list',
      variant: 'default'
    })

    // Reset form
    setPhysicalCount('')
    setSelectedReason('')
    setNotes('')
    setEvidenceFiles([])
    // Keep warehouse selected
  }

  const handleRemovePending = (id: string) => {
    setPendingAdjustments(prev => prev.filter(item => item.id !== id))
  }

  const handleProcessAll = async () => {
    if (pendingAdjustments.length === 0) return

    // Validate user profile requirements
    if (!userProfile?.organizations?.id) {
      toast({
        title: 'Configuration Error',
        description: 'User organization information is missing. Please contact support.',
        variant: 'destructive'
      })
      return
    }

    try {
      // Prevent processing if any pending item requires evidence but has none
      const reasonsMap = new Map(reasons.map(r => [r.id, r]))
      const missingEvidenceItems = pendingAdjustments.filter(item => {
        const r = reasonsMap.get(item.reasonId)
        return r && ['quality_issue', 'return_to_supplier'].includes((r as any).reason_code) && (!item.evidenceFiles || item.evidenceFiles.length === 0)
      })

      if (missingEvidenceItems.length > 0) {
        toast({
          title: 'Missing Evidence',
          description: `There are ${missingEvidenceItems.length} adjustments that require evidence but have none attached. Please attach images before processing.`,
          variant: 'destructive'
        })
        return
      }
      setLoading(true)
      let successCount = 0
      let failCount = 0

      for (const item of pendingAdjustments) {
        try {
          // Upload evidence images if any
          let evidenceUrls: string[] = []
          if (item.evidenceFiles && item.evidenceFiles.length > 0) {
            evidenceUrls = await uploadEvidenceFiles(item.evidenceFiles)
          }

          const payload: any = {
            p_movement_type: 'adjustment',
            p_variant_id: item.variantId,
            p_organization_id: item.warehouseId,
            p_quantity_change: item.adjustment,
            p_unit_cost: item.unitCost,
            p_manufacturer_id: null,
            p_warehouse_location: item.warehouseLocation,
            p_reason: item.reasonName,
            p_notes: item.notes || `Physical count: ${item.physicalCount}, System count: ${item.systemCount}, Adjustment: ${item.adjustment}`,
            p_reference_type: 'adjustment',
            p_reference_id: null,
            p_reference_no: null,
            p_company_id: userProfile.organizations.id,
            p_created_by: userProfile.id
          }

          // Add evidence URLs to payload
          payload.p_evidence_urls = evidenceUrls.length > 0 ? evidenceUrls : null

          console.log('Processing item payload:', payload)

          // Call the record_stock_movement function via RPC
          const { error } = await supabase.rpc('record_stock_movement', payload as any)

          if (error) {
            console.error('RPC Error for item:', item.variantName, JSON.stringify(error, null, 2))
            throw error
          }
          successCount++
        } catch (error: any) {
          console.error('Error processing item:', item.variantName, error)
          failCount++
          
          toast({
            title: 'Error Processing Item',
            description: `Failed to adjust ${item.variantName}: ${error.message || JSON.stringify(error) || 'Unknown error'}`,
            variant: 'destructive'
          })
        }
      }

      if (successCount > 0) {
        toast({
          title: 'Batch Processing Complete',
          description: `Successfully processed ${successCount} adjustments.${failCount > 0 ? ` Failed: ${failCount}` : ''}`,
          variant: failCount > 0 ? 'destructive' : 'default'
        })
        setPendingAdjustments([])
        // Refresh inventory if the currently selected item was adjusted
        if (selectedVariant && selectedWarehouse) {
          checkCurrentInventory()
        }
      } else if (failCount > 0) {
        toast({
          title: 'Processing Failed',
          description: 'Failed to process adjustments. Please try again.',
          variant: 'destructive'
        })
      }

    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to process adjustments: ${error.message}`,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const adjustment = calculateAdjustment()
  const selectedVariantData = variants.find(v => v.id === selectedVariant)
  const selectedProductData = products.find(p => p.id === selectedProduct)
  const selectedReasonData = reasons.find(r => r.id === selectedReason)

  // Count pending items that require evidence but have none
  const missingEvidenceCount = pendingAdjustments.reduce((acc, item) => {
    const r = reasons.find(rr => rr.id === item.reasonId)
    if (!r) return acc
    const rc = (r as any).reason_code
    if (['quality_issue', 'return_to_supplier'].includes(rc) && (!item.evidenceFiles || item.evidenceFiles.length === 0)) return acc + 1
    return acc
  }, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Stock Adjustment</h1>
          <p className="text-gray-600 mt-1">Correct inventory based on physical count</p>
        </div>
        {onViewChange && (
          <Button variant="outline" onClick={() => onViewChange('inventory')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Inventory
          </Button>
        )}
      </div>

      {/* Info Card */}
      <Card className="bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-yellow-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-gray-700">
                <strong>Stock Adjustment Process:</strong> Select the product and location, enter the actual physical count 
                from your warehouse. The system will calculate the difference and update inventory accordingly. 
                All adjustments are logged for audit purposes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Form */}
      <form onSubmit={handleAddToQueue}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Product & Location Selection */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Select Item to Adjust
                </CardTitle>
                <CardDescription>Choose product, variant, and warehouse location</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Warehouse Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Warehouse Location <span className="text-red-500">*</span>
                  </label>
                  <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouseLocations.map(loc => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.org_name} ({loc.org_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Product Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Product <span className="text-red-500">*</span>
                  </label>
                  <Select 
                    value={selectedProduct} 
                    onValueChange={setSelectedProduct}
                    disabled={productsLoading || !selectedWarehouse}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={
                        !selectedWarehouse ? "Select a warehouse first" :
                        productsLoading ? "Loading products..." : 
                        products.length === 0 ? "No products found in this warehouse" :
                        "Select product"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map(product => (
                        <SelectItem key={product.id} value={product.id}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {product.product_code}
                            </Badge>
                            <span>{product.product_name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Variant Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Variant <span className="text-red-500">*</span>
                  </label>
                  <Select 
                    value={selectedVariant} 
                    onValueChange={setSelectedVariant}
                    disabled={!selectedProduct || variants.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={
                        !selectedProduct ? "Select a product first" :
                        variants.length === 0 ? "No variants available" :
                        "Select variant"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {variants.map(variant => (
                        <SelectItem key={variant.id} value={variant.id}>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {variant.variant_code}
                            </Badge>
                            <span>{variant.variant_name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Selected Variant Display */}
            {selectedVariant && variants.length > 0 && (() => {
              const variant = variants.find(v => v.id === selectedVariant)
              return variant ? (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <div className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                        {variant.image_url ? (
                          <img
                            src={getStorageUrl(variant.image_url) || variant.image_url}
                            alt={variant.variant_name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                              const sibling = e.currentTarget.nextElementSibling as HTMLElement
                              if (sibling) sibling.style.display = 'flex'
                            }}
                          />
                        ) : null}
                        <div className="w-full h-full flex items-center justify-center text-gray-400" style={{ display: variant.image_url ? 'none' : 'flex' }}>
                          <Package className="w-8 h-8" />
                        </div>
                      </div>
                      <div className="flex-1">
                        <p className="text-lg font-semibold text-gray-900">{variant.variant_name}</p>
                        <p className="text-sm text-gray-600">{variant.variant_code}</p>
                        {variant.suggested_retail_price && (
                          <p className="text-sm text-gray-600 mt-1">
                            SRP: <span className="font-medium">RM {variant.suggested_retail_price.toFixed(2)}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : null
            })()}

            {/* Current Inventory Card */}
            {currentInventory && (
              <Card className="border-blue-200 bg-blue-50">
                <CardHeader>
                  <CardTitle className="text-lg">Current System Inventory</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">On Hand</p>
                      <p className="text-2xl font-bold text-gray-900">{currentInventory.quantity_on_hand}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Allocated</p>
                      <p className="text-2xl font-bold text-orange-600">{currentInventory.quantity_allocated}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Available</p>
                      <p className="text-2xl font-bold text-green-600">{currentInventory.quantity_available}</p>
                    </div>
                  </div>
                  {currentInventory.warehouse_location && (
                    <p className="text-sm text-gray-600 mt-3">
                      Location: <span className="font-medium">{currentInventory.warehouse_location}</span>
                    </p>
                  )}
                  {currentInventory.average_cost && (
                    <p className="text-sm text-gray-600 mt-1">
                      Average Cost: <span className="font-medium">RM {currentInventory.average_cost.toFixed(2)}</span>
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Physical Count Card */}
            {currentInventory && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    Physical Count
                  </CardTitle>
                  <CardDescription>Enter the actual quantity counted in warehouse</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Actual Physical Count <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      min="0"
                      value={physicalCount}
                      onChange={(e) => setPhysicalCount(e.target.value)}
                      placeholder="Enter actual count..."
                      required
                      className="text-lg font-semibold"
                    />
                  </div>

                  {/* Adjustment Calculation */}
                  {physicalCount && (
                    <div className={`rounded-lg p-4 ${
                      adjustment === 0 ? 'bg-gray-100 border-gray-300' :
                      adjustment > 0 ? 'bg-green-100 border-green-300' :
                      'bg-red-100 border-red-300'
                    } border-2`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {adjustment > 0 ? (
                            <TrendingUp className="w-5 h-5 text-green-600" />
                          ) : adjustment < 0 ? (
                            <TrendingDown className="w-5 h-5 text-red-600" />
                          ) : (
                            <Info className="w-5 h-5 text-gray-600" />
                          )}
                          <span className="font-medium text-gray-700">Adjustment:</span>
                        </div>
                        <span className={`text-2xl font-bold ${
                          adjustment === 0 ? 'text-gray-600' :
                          adjustment > 0 ? 'text-green-600' :
                          'text-red-600'
                        }`}>
                          {adjustment > 0 ? '+' : ''}{adjustment} units
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-2">
                        System: {currentInventory.quantity_on_hand} → Physical: {physicalCount}
                      </p>
                      {adjustment !== 0 && (
                        <div>
                          <p className="text-xs text-gray-600 mt-1">
                            {adjustment > 0 ? '✅ Stock will be increased' : '⚠️ Stock will be decreased'}
                          </p>
                          {selectedReasonData && (() => {
                             const reasonName = selectedReasonData.reason_name;
                             const decreaseOnlyReasons = ["Damaged Goods", "Expired Goods", "Quality Issue", "Return to Supplier"];
                             const increaseOnlyReasons = ["Found Stock"];
                             
                             if (decreaseOnlyReasons.some(r => reasonName.includes(r)) && adjustment > 0) {
                               return <p className="text-xs text-red-600 mt-1 font-bold">Error: For &quot;{reasonName}&quot;, stock must be decreased.</p>
                             }
                             if (increaseOnlyReasons.some(r => reasonName.includes(r)) && adjustment < 0) {
                               return <p className="text-xs text-red-600 mt-1 font-bold">Error: For &quot;{reasonName}&quot;, stock must be increased.</p>
                             }
                             return null;
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Reason & Notes */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Adjustment Reason</CardTitle>
                <CardDescription>Why is this adjustment needed?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason <span className="text-red-500">*</span>
                  </label>
                  <Select value={selectedReason} onValueChange={setSelectedReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {reasons.map(reason => (
                        <SelectItem key={reason.id} value={reason.id}>
                          <div>
                            <div className="font-medium">{reason.reason_name}</div>
                            {reason.reason_description && (
                              <div className="text-xs text-gray-500">{reason.reason_description}</div>
                            )}
                            {reason.requires_approval && (
                              <Badge variant="outline" className="text-xs mt-1">Requires Approval</Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedReasonData?.reason_description && (
                    <p className="text-xs text-gray-500 mt-2">
                      {selectedReasonData.reason_description}
                    </p>
                  )}
                  {selectedReasonData?.requires_approval && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-yellow-600">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Large adjustments may require approval</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Evidence {(['quality_issue','return_to_supplier'].includes((selectedReasonData as any)?.reason_code) ? '(Required)' : '(Optional)')}</CardTitle>
                <CardDescription>Attach images to prove the adjustment{(['quality_issue','return_to_supplier'].includes((selectedReasonData as any)?.reason_code) ? ' — Required for this reason' : '')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-gray-50 transition-colors relative">
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleFileSelect}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      disabled={uploadingImages}
                    />
                    <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600 font-medium">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      PNG, JPG up to 5MB
                    </p>
                  </div>

                  {evidenceFiles.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {evidenceFiles.map((file, index) => (
                        <div key={index} className="relative group border rounded-lg p-2 flex items-center gap-2 bg-white">
                          <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
                            <img 
                              src={URL.createObjectURL(file)} 
                              alt="Preview" 
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{file.name}</p>
                            <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(0)} KB</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            className="p-1 hover:bg-red-100 rounded-full text-gray-400 hover:text-red-600 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Additional Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional details about this adjustment..."
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Optional: Provide context for this adjustment
                </p>
              </CardContent>
            </Card>

            {selectedVariantData && selectedProductData && (
              <Card className="bg-gray-50">
                <CardHeader>
                  <CardTitle className="text-sm">Selected Item</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-600">Product:</span>
                    <p className="font-medium">{selectedProductData.product_name}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Variant:</span>
                    <p className="font-medium">{selectedVariantData.variant_name}</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end gap-3 mt-6">
          {onViewChange && (
            <Button type="button" variant="outline" onClick={() => onViewChange('inventory')}>
              Cancel
            </Button>
          )}
          <Button 
            type="submit" 
            disabled={loading || !currentInventory || !physicalCount || !selectedReason || adjustment === 0 || (selectedReasonData && ['quality_issue','return_to_supplier'].includes((selectedReasonData as any).reason_code) && evidenceFiles.length === 0)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Add to Queue
          </Button>
        </div>
      </form>

      {/* Pending Adjustments Queue */}
      {pendingAdjustments.length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Pending Adjustments ({pendingAdjustments.length})</span>
              <div className="flex items-center gap-3">
              <Button 
                onClick={handleProcessAll}
                disabled={loading || missingEvidenceCount > 0}
                className="bg-green-600 hover:bg-green-700"
              >
                {loading ? 'Processing...' : 'Process All Adjustments'}
              </Button>
              {missingEvidenceCount > 0 && (
                <div className="text-sm text-red-600">{missingEvidenceCount} item(s) require evidence</div>
              )}
              </div>
            </CardTitle>
            <CardDescription>Review items before finalizing adjustments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pendingAdjustments.map((item) => (
                <div key={item.id} className="bg-white p-4 rounded-lg border shadow-sm flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">{item.productName}</span>
                      <Badge variant="secondary">{item.variantName}</Badge>
                    </div>
                    <div className="text-sm text-gray-600 mt-1 flex items-center gap-2">
                      <div>{item.warehouseName} • {item.reasonName}</div>
                      {/* show warning when evidence required but missing */}
                      {(() => {
                        const r = reasons.find(rr => rr.id === item.reasonId)
                        const rc = (r as any)?.reason_code
                        if (r && ['quality_issue','return_to_supplier'].includes(rc) && (!item.evidenceFiles || item.evidenceFiles.length === 0)) {
                          return (
                            <div className="text-xs text-red-600 font-semibold">Missing evidence</div>
                          )
                        }
                        return null
                      })()}
                    </div>
                    <div className="text-sm mt-1">
                      System: {item.systemCount} → Physical: {item.physicalCount} 
                      <span className={`ml-2 font-bold ${
                        item.adjustment > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        ({item.adjustment > 0 ? '+' : ''}{item.adjustment})
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemovePending(item.id)}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Inventory Warning */}
      {selectedVariant && selectedWarehouse && !currentInventory && !checkingInventory && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              <div>
                <p className="font-medium text-yellow-900">No Inventory Record Found</p>
                <p className="text-sm text-yellow-700 mt-1">
                  This product variant has no inventory record at the selected location. 
                  Please use &quot;Add Stock&quot; first to create an initial inventory record.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
