'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Truck, Plus, Trash2, ArrowRight, Save, AlertCircle, Building2, X } from 'lucide-react'
import ProductThumbnail from './ProductThumbnail'

interface Product {
  id: string
  product_code: string
  product_name: string
}

interface Variant {
  id: string
  variant_code: string
  variant_name: string
  product_id: string
}

interface Warehouse {
  id: string
  org_code: string
  org_name: string
}

interface TransferItem {
  id: string // temporary ID for UI
  variant_id: string
  variant_code: string
  variant_name: string
  product_name: string
  quantity: number
  available_qty: number
  unit_cost: number | null
  variant_image_url?: string | null
}

interface StockTransferViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function StockTransferView({ userProfile, onViewChange }: StockTransferViewProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  
  const [fromWarehouse, setFromWarehouse] = useState('')
  const [toWarehouse, setToWarehouse] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedVariant, setSelectedVariant] = useState('')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  
  const [transferItems, setTransferItems] = useState<TransferItem[]>([])
  const [availableStock, setAvailableStock] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadWarehouses()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  useEffect(() => {
    if (fromWarehouse) {
      loadProducts()
      setSelectedProduct('')
      setSelectedVariant('')
      setVariants([])
      setQuantity('')
    } else {
      setProducts([])
      setVariants([])
      setSelectedProduct('')
      setSelectedVariant('')
      setQuantity('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromWarehouse])

  useEffect(() => {
    if (selectedProduct) {
      loadVariants(selectedProduct)
    } else {
      setVariants([])
      setSelectedVariant('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct])

  useEffect(() => {
    if (selectedVariant && fromWarehouse) {
      checkAvailableStock()
    } else {
      setAvailableStock(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant, fromWarehouse])

  const loadWarehouses = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_code, org_name')
        .in('org_type_code', ['HQ', 'WH'])
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error
      setWarehouses(data || [])
    } catch (error: any) {
      console.error('Failed to load warehouses:', error)
    }
  }

  const loadProducts = async () => {
    if (!fromWarehouse) return

    try {
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          variant_id,
          product_variants!inner (
            product_id,
            products!inner (
              id,
              product_code,
              product_name
            )
          )
        `)
        .eq('organization_id', fromWarehouse)
        .gt('quantity_available', 0)

      if (error) throw error

      // Extract unique products
      const uniqueProductsMap = new Map()
      if (data) {
        data.forEach((item: any) => {
          const product = item.product_variants.products
          if (!uniqueProductsMap.has(product.id)) {
            uniqueProductsMap.set(product.id, product)
          }
        })
      }

      const productsList = Array.from(uniqueProductsMap.values())
        .sort((a: any, b: any) => a.product_name.localeCompare(b.product_name))

      setProducts(productsList)
    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to load products: ${error.message}`,
        variant: 'destructive'
      })
    }
  }

  const loadVariants = async (productId: string) => {
    if (!fromWarehouse) return

    try {
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          quantity_available,
          product_variants!inner (
            id,
            variant_code,
            variant_name,
            product_id
          )
        `)
        .eq('organization_id', fromWarehouse)
        .eq('product_variants.product_id', productId)
        .gt('quantity_available', 0)

      if (error) throw error
      
      const variantsList = (data || [])
        .map((item: any) => item.product_variants)
        .sort((a: any, b: any) => a.variant_name.localeCompare(b.variant_name))

      setVariants(variantsList)
    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to load variants: ${error.message}`,
        variant: 'destructive'
      })
    }
  }

  const checkAvailableStock = async () => {
    if (!selectedVariant || !fromWarehouse) return

    try {
      const { data, error } = await supabase
        .from('product_inventory')
        .select('quantity_available, average_cost')
        .eq('variant_id', selectedVariant)
        .eq('organization_id', fromWarehouse)
        .eq('is_active', true)
        .single()

      if (error && error.code !== 'PGRST116') {
        throw error
      }

      const inventoryData: any = data
      setAvailableStock(inventoryData?.quantity_available || 0)
    } catch (error: any) {
      console.error('Failed to check available stock:', error)
    }
  }

  const addItem = async () => {
    if (!selectedProduct || !selectedVariant || !quantity || !fromWarehouse) {
      toast({
        title: 'Validation Error',
        description: 'Please select product, variant, and enter quantity',
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

    if (qty > availableStock) {
      toast({
        title: 'Insufficient Stock',
        description: `Only ${availableStock} units available`,
        variant: 'destructive'
      })
      return
    }

    // Check if variant already added
    if (transferItems.some(item => item.variant_id === selectedVariant)) {
      toast({
        title: 'Duplicate Item',
        description: 'This variant is already added to the transfer',
        variant: 'destructive'
      })
      return
    }

    try {
      // Get variant details
      const { data: variantData, error: variantError } = await supabase
        .from('product_variants')
        .select(`
          id,
          variant_code,
          variant_name,
          image_url,
          base_cost,
          products (
            product_name
          )
        `)
        .eq('id', selectedVariant)
        .single()

      if (variantError) throw variantError

      const variantInfo: any = variantData

      // Get cost from inventory
      const { data: inventoryData } = await supabase
        .from('product_inventory')
        .select('average_cost')
        .eq('variant_id', selectedVariant)
        .eq('organization_id', fromWarehouse)
        .single()

      const inventoryCost: any = inventoryData

      const newItem: TransferItem = {
        id: Date.now().toString(),
        variant_id: selectedVariant,
        variant_code: variantInfo.variant_code,
        variant_name: variantInfo.variant_name,
        product_name: variantInfo.products?.product_name || 'Unknown',
        quantity: qty,
        available_qty: availableStock,
        unit_cost: inventoryCost?.average_cost || variantInfo.base_cost || null,
        variant_image_url: variantInfo.image_url
      }

      setTransferItems([...transferItems, newItem])
      
      // Reset selection
      setSelectedProduct('')
      setSelectedVariant('')
      setQuantity('')
      setVariants([])
      setAvailableStock(0)

      toast({
        title: 'Item Added',
        description: `${qty} units of ${variantInfo.variant_name} added to transfer`
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to add item: ${error.message}`,
        variant: 'destructive'
      })
    }
  }

  const removeItem = (itemId: string) => {
    setTransferItems(transferItems.filter(item => item.id !== itemId))
    toast({
      title: 'Item Removed',
      description: 'Item removed from transfer'
    })
  }

  const calculateTotalValue = () => {
    return transferItems.reduce((sum, item) => {
      return sum + (item.quantity * (item.unit_cost || 0))
    }, 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!fromWarehouse || !toWarehouse) {
      toast({
        title: 'Validation Error',
        description: 'Please select from and to warehouses',
        variant: 'destructive'
      })
      return
    }

    if (fromWarehouse === toWarehouse) {
      toast({
        title: 'Validation Error',
        description: 'From and To warehouses must be different',
        variant: 'destructive'
      })
      return
    }

    if (transferItems.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please add at least one item to transfer',
        variant: 'destructive'
      })
      return
    }

    try {
      setLoading(true)

      // Generate transfer number
      const { data: transferNo, error: transferNoError } = await supabase
        .rpc('generate_transfer_number')

      if (transferNoError) throw transferNoError

      // Create transfer record
      const { data: transfer, error: transferError } = await supabase
        .from('stock_transfers')
        .insert([{
          transfer_no: transferNo,
          from_organization_id: fromWarehouse,
          to_organization_id: toWarehouse,
          status: 'in_transit',
          items: transferItems.map(item => ({
            variant_id: item.variant_id,
            variant_name: item.variant_name,
            product_name: item.product_name,
            quantity: item.quantity,
            cost: item.unit_cost
          })),
          total_items: transferItems.reduce((sum, item) => sum + item.quantity, 0),
          total_value: calculateTotalValue(),
          notes: notes,
          company_id: userProfile.organizations.id,
          created_by: userProfile.id
        }] as any)
        .select()
        .single()

      if (transferError) throw transferError

      const transferRecord: any = transfer

      // Create stock movements for each item
      for (const item of transferItems) {
        // 1. Transfer Out (Source)
        const { error: outError } = await supabase.rpc('record_stock_movement', {
          p_movement_type: 'transfer_out',
          p_variant_id: item.variant_id,
          p_organization_id: fromWarehouse,
          p_quantity_change: -item.quantity,
          p_unit_cost: item.unit_cost,
          p_manufacturer_id: null,
          p_warehouse_location: null,
          p_reason: `Transfer to ${warehouses.find(w => w.id === toWarehouse)?.org_name}`,
          p_notes: `Transfer ${transferNo}`,
          p_reference_type: 'transfer',
          p_reference_id: transferRecord.id,
          p_reference_no: transferNo,
          p_company_id: userProfile.organizations.id,
          p_created_by: userProfile.id
        } as any)

        if (outError) throw outError

        // 2. Transfer In (Destination)
        const { error: inError } = await supabase.rpc('record_stock_movement', {
          p_movement_type: 'transfer_in',
          p_variant_id: item.variant_id,
          p_organization_id: toWarehouse,
          p_quantity_change: item.quantity,
          p_unit_cost: item.unit_cost,
          p_manufacturer_id: null,
          p_warehouse_location: null,
          p_reason: `Transfer from ${warehouses.find(w => w.id === fromWarehouse)?.org_name}`,
          p_notes: `Transfer ${transferNo}`,
          p_reference_type: 'transfer',
          p_reference_id: transferRecord.id,
          p_reference_no: transferNo,
          p_company_id: userProfile.organizations.id,
          p_created_by: userProfile.id
        } as any)

        if (inError) throw inError
      }

      toast({
        title: 'Transfer Created',
        description: `Transfer ${transferNo} created successfully with ${transferItems.length} items`,
        variant: 'default'
      })

      // Reset form
      setFromWarehouse('')
      setToWarehouse('')
      setTransferItems([])
      setNotes('')

    } catch (error: any) {
      toast({
        title: 'Error',
        description: `Failed to create transfer: ${error.message}`,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const totalItems = transferItems.reduce((sum, item) => sum + item.quantity, 0)
  const totalValue = calculateTotalValue()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Stock Transfer</h1>
        <p className="text-gray-600 mt-1">Transfer inventory between warehouse locations</p>
      </div>

      {/* Info Card */}
      <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-gray-700">
                <strong>Stock Transfer Process:</strong> Select source and destination warehouses, add items with quantities, 
                and create the transfer. Stock will be deducted from source immediately. The receiving warehouse can later 
                mark the transfer as received to complete the process.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Warehouse Selection & Items */}
          <div className="lg:col-span-2 space-y-6">
            {/* Warehouse Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="w-5 h-5" />
                  Transfer Route
                </CardTitle>
                <CardDescription>Select source and destination warehouses</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                  {/* From Warehouse */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      From Warehouse <span className="text-red-500">*</span>
                    </label>
                    <Select value={fromWarehouse} onValueChange={setFromWarehouse}>
                      <SelectTrigger>
                        <SelectValue placeholder="Source" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses.map(wh => (
                          <SelectItem key={wh.id} value={wh.id} disabled={wh.id === toWarehouse}>
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4" />
                              <span>{wh.org_name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center items-center">
                    <ArrowRight className="w-8 h-8 text-gray-400" />
                  </div>

                  {/* To Warehouse */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      To Warehouse <span className="text-red-500">*</span>
                    </label>
                    <Select value={toWarehouse} onValueChange={setToWarehouse}>
                      <SelectTrigger>
                        <SelectValue placeholder="Destination" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses.map(wh => (
                          <SelectItem key={wh.id} value={wh.id} disabled={wh.id === fromWarehouse}>
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4" />
                              <span>{wh.org_name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Add Items */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Add Items to Transfer
                </CardTitle>
                <CardDescription>Select products and quantities to transfer</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {/* Product */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Product</label>
                    <Select 
                      value={selectedProduct} 
                      onValueChange={setSelectedProduct}
                      disabled={!fromWarehouse}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={!fromWarehouse ? "Select source first" : "Select product"} />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map(product => (
                          <SelectItem key={product.id} value={product.id}>
                            <Badge variant="outline" className="text-xs mr-2">{product.product_code}</Badge>
                            {product.product_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Variant */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Variant</label>
                    <Select 
                      value={selectedVariant} 
                      onValueChange={setSelectedVariant}
                      disabled={!selectedProduct || variants.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Variant" />
                      </SelectTrigger>
                      <SelectContent>
                        {variants.map(variant => (
                          <SelectItem key={variant.id} value={variant.id}>
                            {variant.variant_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedVariant && availableStock > 0 && (
                      <p className="text-xs text-green-600 mt-1">
                        Available: {availableStock.toLocaleString()} units
                      </p>
                    )}
                    {selectedVariant && availableStock === 0 && (
                      <p className="text-xs text-red-600 mt-1">Out of stock</p>
                    )}
                  </div>

                  {/* Quantity */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min="1"
                        max={availableStock}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="Qty"
                        disabled={!selectedVariant || availableStock === 0}
                      />
                      <Button 
                        type="button" 
                        onClick={addItem}
                        disabled={!selectedVariant || !quantity || availableStock === 0}
                        size="icon"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Transfer Items List */}
            {transferItems.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Transfer Items ({transferItems.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product Name</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transferItems.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <ProductThumbnail
                                src={item.variant_image_url ?? undefined}
                                alt={item.variant_name || item.product_name || 'Product'}
                                size={48}
                              />
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {item.product_name}
                                </p>
                                <p className="text-sm text-gray-500">
                                  [{item.variant_name}]
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold">{item.quantity.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            {item.unit_cost ? `RM ${item.unit_cost.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {item.unit_cost ? `RM ${(item.quantity * item.unit_cost).toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell>
                            <Button 
                              type="button"
                              variant="ghost" 
                              size="icon"
                              onClick={() => removeItem(item.id)}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Summary & Notes */}
          <div className="space-y-6">
            {/* Transfer Summary */}
            <Card className="bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
              <CardHeader>
                <CardTitle className="text-lg">Transfer Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-gray-600">Total Items</p>
                  <p className="text-2xl font-bold text-gray-900">{transferItems.length}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Quantity</p>
                  <p className="text-2xl font-bold text-purple-600">{totalItems} units</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Value</p>
                  <p className="text-2xl font-bold text-green-600">
                    RM {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                {fromWarehouse && toWarehouse && (
                  <div className="pt-3 border-t border-purple-200">
                    <p className="text-xs text-gray-600">Transfer Route:</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {warehouses.find(w => w.id === fromWarehouse)?.org_code}
                      </Badge>
                      <ArrowRight className="w-3 h-3 text-gray-400" />
                      <Badge variant="outline" className="text-xs">
                        {warehouses.find(w => w.id === toWarehouse)?.org_code}
                      </Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Transfer Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this transfer..."
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </CardContent>
            </Card>

            {/* Submit Button */}
            <Button 
              type="submit" 
              disabled={loading || !fromWarehouse || !toWarehouse || transferItems.length === 0}
              className="w-full bg-purple-600 hover:bg-purple-700"
              size="lg"
            >
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Creating Transfer...' : 'Create Transfer'}
            </Button>

            {onViewChange && (
              <Button 
                type="button"
                variant="outline"
                onClick={() => onViewChange('inventory')}
                className="w-full"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
