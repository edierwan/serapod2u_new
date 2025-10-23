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
  Package, 
  Plus,
  Factory,
  Warehouse,
  Save,
  ArrowLeft,
  CheckCircle,
  AlertCircle
} from 'lucide-react'

interface Product {
  id: string
  product_code: string
  product_name: string
  brand_id: string | null
  brands?: {
    brand_name: string
  }
}

interface Variant {
  id: string
  variant_code: string
  variant_name: string
  suggested_retail_price: number | null
  base_cost: number | null
}

interface Manufacturer {
  id: string
  org_code: string
  org_name: string
}

interface WarehouseLocation {
  id: string
  org_code: string
  org_name: string
}

interface AddStockViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function AddStockView({ userProfile, onViewChange }: AddStockViewProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([])
  const [warehouseLocations, setWarehouseLocations] = useState<WarehouseLocation[]>([])
  
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [selectedManufacturer, setSelectedManufacturer] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [warehouseLocationText, setWarehouseLocationText] = useState('')
  const [notes, setNotes] = useState('')
  
  const [loading, setLoading] = useState(false)
  const [productsLoading, setProductsLoading] = useState(true)
  
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadProducts()
      loadManufacturers()
      loadWarehouseLocations()
    }
  }, [isReady])

  useEffect(() => {
    if (selectedProduct) {
      loadVariants(selectedProduct)
    } else {
      setVariants([])
      setSelectedVariant('')
    }
  }, [selectedProduct])

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
      setProducts(data || [])
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
        .select('id, variant_code, variant_name, suggested_retail_price, base_cost')
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('variant_name')

      if (error) throw error
      const variantsList: Variant[] = data || []
      setVariants(variantsList)
      
      // Auto-select if only one variant
      if (variantsList.length === 1) {
        const firstVariant = variantsList[0]
        setSelectedVariant(firstVariant.id)
        // Auto-fill cost if available
        if (firstVariant.base_cost) {
          setUnitCost(firstVariant.base_cost.toString())
        }
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to load variants: ${error.message}`,
        variant: 'destructive'
      })
    }
  }

  const loadManufacturers = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_code, org_name')
        .in('org_type_code', ['MANU', 'MFG'])
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error
      setManufacturers(data || [])
    } catch (error: any) {
      console.error('Failed to load manufacturers:', error)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedProduct || !selectedVariant || !selectedWarehouse || !quantity) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields',
        variant: 'destructive'
      })
      return
    }

    const qty = parseInt(quantity)
    if (qty <= 0) {
      toast({
        title: 'Validation Error',
        description: 'Quantity must be greater than 0',
        variant: 'destructive'
      })
      return
    }

    const cost = unitCost ? parseFloat(unitCost) : null
    if (cost !== null && cost < 0) {
      toast({
        title: 'Validation Error',
        description: 'Unit cost cannot be negative',
        variant: 'destructive'
      })
      return
    }

    try {
      setLoading(true)

      // Call the record_stock_movement function via RPC
      const { error } = await supabase.rpc('record_stock_movement', {
        p_movement_type: 'addition',
        p_variant_id: selectedVariant,
        p_organization_id: selectedWarehouse,
        p_quantity_change: qty,
        p_unit_cost: cost,
        p_manufacturer_id: selectedManufacturer || null,
        p_warehouse_location: warehouseLocationText || null,
        p_reason: 'Manual stock addition',
        p_notes: notes || null,
        p_reference_type: 'manual',
        p_reference_id: null,
        p_reference_no: null,
        p_company_id: userProfile.organizations.id,
        p_created_by: userProfile.id
      } as any)

      if (error) throw error

      toast({
        title: 'Success',
        description: `Successfully added ${qty} units to inventory`,
        variant: 'default'
      })

      // Reset form
      setSelectedProduct('')
      setSelectedVariant('')
      setSelectedManufacturer('')
      setQuantity('')
      setUnitCost('')
      setWarehouseLocationText('')
      setNotes('')
      setVariants([])

      // Optionally navigate back to inventory
      // onViewChange?.('inventory')

    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to add stock: ${error.message}`,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const selectedVariantData = variants.find(v => v.id === selectedVariant)
  const selectedProductData = products.find(p => p.id === selectedProduct)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Add Stock</h1>
          <p className="text-gray-600 mt-1">Manually add stock to your inventory</p>
        </div>
        {onViewChange && (
          <Button variant="outline" onClick={() => onViewChange('inventory')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Inventory
          </Button>
        )}
      </div>

      {/* Info Card */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-gray-700">
                <strong>Stock Addition Process:</strong> Select the product and variant you want to add stock for, 
                specify the quantity and cost, optionally record the manufacturer. The system will automatically 
                update inventory levels and calculate weighted average costs.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Form */}
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Product Selection */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Product Selection
                </CardTitle>
                <CardDescription>Select the product and variant to add stock</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                            {product.brands && (
                              <span className="text-gray-500 text-sm">- {product.brands.brand_name}</span>
                            )}
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
                    onValueChange={(value) => {
                      setSelectedVariant(value)
                      const variant = variants.find(v => v.id === value)
                      if (variant?.base_cost) {
                        setUnitCost(variant.base_cost.toString())
                      }
                    }}
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
                            {variant.suggested_retail_price && (
                              <span className="text-gray-500 text-sm">
                                - RM {variant.suggested_retail_price.toFixed(2)}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Selected Product Summary */}
                {selectedVariantData && selectedProductData && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <h4 className="font-semibold text-green-900">Selected Item</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-600">Product:</span>
                        <p className="font-medium">{selectedProductData.product_name}</p>
                      </div>
                      <div>
                        <span className="text-gray-600">Variant:</span>
                        <p className="font-medium">{selectedVariantData.variant_name}</p>
                      </div>
                      {selectedVariantData.base_cost && (
                        <div>
                          <span className="text-gray-600">Base Cost:</span>
                          <p className="font-medium">RM {selectedVariantData.base_cost.toFixed(2)}</p>
                        </div>
                      )}
                      {selectedVariantData.suggested_retail_price && (
                        <div>
                          <span className="text-gray-600">Retail Price:</span>
                          <p className="font-medium">RM {selectedVariantData.suggested_retail_price.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Quantity & Cost
                </CardTitle>
                <CardDescription>Specify how much stock you're adding</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Quantity */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Quantity (Units) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="e.g., 500"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">Number of units to add</p>
                  </div>

                  {/* Unit Cost */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Unit Cost (RM)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={unitCost}
                      onChange={(e) => setUnitCost(e.target.value)}
                      placeholder="e.g., 25.50"
                    />
                    <p className="text-xs text-gray-500 mt-1">Cost per unit (optional)</p>
                  </div>
                </div>

                {/* Total Cost Calculation */}
                {quantity && unitCost && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">Total Cost:</span>
                      <span className="text-lg font-bold text-blue-600">
                        RM {(parseInt(quantity) * parseFloat(unitCost)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      {quantity} units × RM {parseFloat(unitCost).toFixed(2)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Additional Details */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Factory className="w-5 h-5" />
                  Manufacturer
                </CardTitle>
                <CardDescription>Track stock source</CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={selectedManufacturer} onValueChange={setSelectedManufacturer}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select manufacturer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Not specified</SelectItem>
                    {manufacturers.map(mfg => (
                      <SelectItem key={mfg.id} value={mfg.id}>
                        {mfg.org_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-2">
                  Optional: Record which manufacturer supplied this stock
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Warehouse className="w-5 h-5" />
                  Warehouse Location
                </CardTitle>
                <CardDescription>Where is this stock stored?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Organization/Warehouse */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Organization <span className="text-red-500">*</span>
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

                {/* Physical Location */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Physical Location
                  </label>
                  <Input
                    type="text"
                    value={warehouseLocationText}
                    onChange={(e) => setWarehouseLocationText(e.target.value)}
                    placeholder="e.g., Shelf A-12, Zone 3"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Optional: Specific shelf or zone
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional notes about this stock addition..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </CardContent>
            </Card>
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
            disabled={loading || !selectedProduct || !selectedVariant || !selectedWarehouse || !quantity}
            className="bg-green-600 hover:bg-green-700"
          >
            <Save className="w-4 h-4 mr-2" />
            {loading ? 'Adding Stock...' : 'Add Stock to Inventory'}
          </Button>
        </div>
      </form>
    </div>
  )
}
