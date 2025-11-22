'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { 
  Settings,
  Search,
  ArrowLeft,
  Save,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Info,
  Package
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

interface StockAdjustmentViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function StockAdjustmentView({ userProfile, onViewChange }: StockAdjustmentViewProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [reasons, setReasons] = useState<AdjustmentReason[]>([])
  const [warehouseLocations, setWarehouseLocations] = useState<WarehouseLocation[]>([])
  
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [selectedReason, setSelectedReason] = useState('')
  
  const [currentInventory, setCurrentInventory] = useState<InventoryItem | null>(null)
  const [physicalCount, setPhysicalCount] = useState('')
  const [notes, setNotes] = useState('')
  
  const [loading, setLoading] = useState(false)
  const [checkingInventory, setCheckingInventory] = useState(false)
  const [productsLoading, setProductsLoading] = useState(true)
  
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadProducts()
      loadReasons()
      loadWarehouseLocations()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (selectedProduct) {
      loadVariants(selectedProduct)
    } else {
      setVariants([])
      setSelectedVariant('')
      setCurrentInventory(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

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

  const loadProducts = async () => {
    try {
      setProductsLoading(true)
      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          product_code,
          product_name,
          brand_id,
          brands (
            brand_name
          )
        `)
        .eq('is_active', true)
        .order('product_name')

      if (error) throw error
      
      // Transform the data to handle brands array
      const transformedData: Product[] = (data || []).map((item: any) => ({
        id: item.id,
        product_code: item.product_code,
        product_name: item.product_name,
        brand_id: item.brand_id,
        brands: Array.isArray(item.brands) ? item.brands[0] : item.brands
      }))
      
      setProducts(transformedData)
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

  const loadVariants = async (productId: string) => {
    try {
      const { data, error } = await supabase
        .from('product_variants')
        .select('id, variant_code, variant_name, image_url, suggested_retail_price')
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('variant_name')

      if (error) throw error
      const variantsList: Variant[] = data || []
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

  const handleSubmit = async (e: React.FormEvent) => {
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

    // Check if reason requires approval
    const selectedReasonData = reasons.find(r => r.id === selectedReason)
    if (selectedReasonData?.requires_approval && Math.abs(adjustment) > 100) {
      toast({
        title: 'Approval Required',
        description: 'Large adjustments with this reason require manager approval',
        variant: 'destructive'
      })
      // TODO: Implement approval workflow
      return
    }

    try {
      setLoading(true)

      // Call the record_stock_movement function via RPC
      const { error } = await supabase.rpc('record_stock_movement', {
        p_movement_type: 'adjustment',
        p_variant_id: selectedVariant,
        p_organization_id: selectedWarehouse,
        p_quantity_change: adjustment,
        p_unit_cost: currentInventory?.average_cost || null,
        p_manufacturer_id: null,
        p_warehouse_location: currentInventory?.warehouse_location || null,
        p_reason: selectedReasonData?.reason_name || 'Stock adjustment',
        p_notes: notes || `Physical count: ${physical}, System count: ${currentInventory?.quantity_on_hand || 0}, Adjustment: ${adjustment}`,
        p_reference_type: 'adjustment',
        p_reference_id: null,
        p_reference_no: null,
        p_company_id: userProfile.organizations.id,
        p_created_by: userProfile.id
      } as any)

      if (error) throw error

      toast({
        title: 'Success',
        description: `Stock adjusted by ${adjustment > 0 ? '+' : ''}${adjustment} units`,
        variant: 'default'
      })

      // Refresh inventory
      await checkCurrentInventory()

      // Reset form (keep product/variant/warehouse selected for convenience)
      setPhysicalCount('')
      setSelectedReason('')
      setNotes('')

    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to adjust stock: ${error.message}`,
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
      <form onSubmit={handleSubmit}>
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
                    disabled={productsLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={productsLoading ? "Loading products..." : "Select product"} />
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
                            src={variant.image_url}
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
                        <p className="text-xs text-gray-600 mt-1">
                          {adjustment > 0 ? '✅ Stock will be increased' : '⚠️ Stock will be decreased'}
                        </p>
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
            disabled={loading || !currentInventory || !physicalCount || !selectedReason || adjustment === 0}
            className={
              adjustment > 0 ? 'bg-green-600 hover:bg-green-700' :
              adjustment < 0 ? 'bg-red-600 hover:bg-red-700' :
              'bg-gray-600 hover:bg-gray-700'
            }
          >
            <Save className="w-4 h-4 mr-2" />
            {loading ? 'Adjusting Stock...' : 
             adjustment > 0 ? `Add ${adjustment} Units` :
             adjustment < 0 ? `Remove ${Math.abs(adjustment)} Units` :
             'Adjust Stock'}
          </Button>
        </div>
      </form>

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
