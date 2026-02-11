'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ArrowLeft, User, Package, Loader2, Trash2, ShoppingCart, Building2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  }
  roles: {
    role_name: string
    role_level: number
  }
}

interface ShopOrderViewProps {
  userProfile: UserProfile
  onViewChange?: (view: string) => void
}

interface Organization {
  id: string
  org_name: string
  org_type_code: string
  org_code: string
  address?: string | null
  contact_phone?: string | null
  contact_name?: string | null
  address_line2?: string | null
  parent_org_id?: string | null
}

interface ProductVariant {
  id: string
  product_id: string
  product_name: string
  product_code: string
  variant_name: string
  attributes?: Record<string, any>
  barcode?: string | null
  manufacturer_sku?: string | null
  retailer_price: number
  available_qty: number
}

interface OrderItem {
  id?: string
  order_id?: string
  product_id: string
  variant_id: string
  product_name: string
  variant_name: string
  attributes?: Record<string, any>
  manufacturer_sku?: string | null
  qty: number
  unit_price: number
  line_total?: number
}

// Helper function to format currency with thousand separators
const formatCurrency = (amount: number): string => {
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export default function ShopOrderView({ userProfile, onViewChange }: ShopOrderViewProps) {
  const supabase = createClient()
  const { toast } = useToast()

  // Ref to prevent duplicate toasts in React Strict Mode
  const toastShownRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Organizations
  const [buyerOrg, setBuyerOrg] = useState<Organization | null>(null)
  const [sellerOrg, setSellerOrg] = useState<Organization | null>(null)
  const [availableShops, setAvailableShops] = useState<Organization[]>([])
  const [selectedShopId, setSelectedShopId] = useState('')
  const [inventoryOrgId, setInventoryOrgId] = useState<string>('')

  // Customer Information
  const [customerName, setCustomerName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')

  // Products and Variants
  const [availableVariants, setAvailableVariants] = useState<ProductVariant[]>([])
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])

  // Product filtering
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [selectedProductFilter, setSelectedProductFilter] = useState('')

  useEffect(() => {
    initializeOrder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const initializeOrder = async () => {
    try {
      setLoading(true)

      // Load user's organization details (HQ)
      const { data: userOrgData, error: userOrgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userProfile.organization_id)
        .single()

      if (userOrgError) throw userOrgError

      // Set SELLER as current organization (HQ/WH)
      setSellerOrg(userOrgData)

      // Find parent HQ org (if we are not HQ)
      let hqOrgId = userOrgData.parent_org_id
      if (!hqOrgId) {
        if (userOrgData.org_type_code === 'HQ' || userOrgData.org_type_code === 'WH') {
          hqOrgId = userOrgData.id
        }
      }

      if (hqOrgId) {
        // Find Warehouse under HQ for inventory check
        const { data: whData } = await supabase
          .from('organizations')
          .select('id')
          .eq('parent_org_id', hqOrgId)
          .eq('org_type_code', 'WH')
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (whData) {
          setInventoryOrgId(whData.id)
        } else {
          setInventoryOrgId(hqOrgId)
        }

        await loadShops(hqOrgId)
      }

    } catch (error: any) {
      console.error('Error initializing order:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to initialize order',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const loadShops = async (hqOrgId: string) => {
    try {
      // 1. Get all Distributors under HQ
      const { data: distributors } = await supabase
        .from('organizations')
        .select('id')
        .eq('parent_org_id', hqOrgId)
        .eq('org_type_code', 'DIST')

      const distributorIds = distributors?.map(d => d.id) || []

      if (distributorIds.length === 0) {
        if (!toastShownRef.current) {
          toastShownRef.current = true
          toast({
            title: 'No Distributors Found',
            description: 'No distributors found under HQ.',
            variant: 'destructive'
          })
        }
        return
      }

      // 2. Get all Shops under these Distributors
      const { data: shops, error } = await supabase
        .from('organizations')
        .select('*')
        .in('parent_org_id', distributorIds)
        .eq('org_type_code', 'SHOP')
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error

      setAvailableShops(shops || [])

      if (shops && shops.length === 0 && !toastShownRef.current) {
        toastShownRef.current = true
        toast({
          title: 'No Shops Found',
          description: 'No active shops found under distributors.',
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      console.error('Error loading shops:', error)
      if (!toastShownRef.current) {
        toastShownRef.current = true
        toast({
          title: 'Error',
          description: 'Failed to load shops',
          variant: 'destructive'
        })
      }
    }
  }

  const handleShopChange = async (shopId: string) => {
    setSelectedShopId(shopId)

    const shop = availableShops.find(s => s.id === shopId)
    if (!shop) return

    setBuyerOrg(shop)

    // Update customer information with Shop details
    setCustomerName(shop.contact_name || shop.org_name)
    setPhoneNumber(shop.contact_phone || '')

    // Combine address and address_line2 for delivery address
    const fullAddress = [
      shop.address,
      shop.address_line2
    ].filter(Boolean).join(', ')

    setDeliveryAddress(fullAddress || '')

    // Load products from HQ Inventory
    if (inventoryOrgId) {
      await loadAvailableProducts(inventoryOrgId)
    }
  }

  const loadAvailableProducts = async (inventorySourceId: string) => {
    if (!inventorySourceId) return

    try {
      // Load product variants with inventory quantities
      const { data, error } = await supabase
        .from('product_variants')
        .select(`
          id,
          product_id,
          variant_name,
          attributes,
          barcode,
          manufacturer_sku,
          retailer_price,
          is_active,
          products!inner (
            id,
            product_code,
            product_name,
            is_active
          )
        `)
        .eq('is_active', true)
        .eq('products.is_active', true)
        .order('variant_name')

      if (error) throw error

      // Get inventory for each variant from Inventory Source (Warehouse/HQ)
      const variantsWithInventory = await Promise.all(
        (data || []).map(async (v: any) => {
          const product = Array.isArray(v.products) ? v.products[0] : v.products

          // Get available quantity from product_inventory using Inventory Source ID
          const { data: inventoryData } = await supabase
            .from('product_inventory')
            .select('quantity_available')
            .eq('variant_id', v.id)
            .eq('organization_id', inventorySourceId)
            .maybeSingle()

          const availableQty = inventoryData?.quantity_available || 0

          return {
            id: v.id,
            product_id: v.product_id,
            product_name: product?.product_name || '',
            product_code: product?.product_code || '',
            variant_name: v.variant_name,
            attributes: v.attributes || {},
            barcode: v.barcode,
            manufacturer_sku: v.manufacturer_sku,
            retailer_price: v.retailer_price || 0,
            available_qty: availableQty
          }
        })
      )

      // Filter to only show variants with available inventory
      const variantsWithStock = variantsWithInventory.filter(v => v.available_qty > 0)

      setAvailableVariants(variantsWithStock)

      if (variantsWithStock.length === 0) {
        toast({
          title: 'No Products Available',
          description: 'No products with available inventory found in Warehouse/HQ.',
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      console.error('Error loading products:', error)
      toast({
        title: 'Error',
        description: 'Failed to load available products',
        variant: 'destructive'
      })
    }
  }

  const handleAddProduct = () => {
    if (!selectedVariantId) {
      toast({
        title: 'Validation Error',
        description: 'Please select a product variant',
        variant: 'destructive'
      })
      return
    }

    const variant = availableVariants.find(v => v.id === selectedVariantId)
    if (!variant) return

    // Check if price is maintained
    if (!variant.retailer_price || variant.retailer_price <= 0) {
      toast({
        title: 'Price Not Maintained',
        description: 'Please maintain the retailer price for this product first.',
        variant: 'destructive'
      })
      return
    }

    // Check if variant already added
    if (orderItems.find(item => item.variant_id === selectedVariantId)) {
      toast({
        title: 'Product Already Added',
        description: 'This product variant is already in the order',
        variant: 'destructive'
      })
      return
    }

    // Add product variant with retailer price
    const newItem: OrderItem = {
      id: `temp-${Date.now()}`,
      order_id: '',
      product_id: variant.product_id,
      variant_id: variant.id,
      product_name: variant.product_name,
      variant_name: variant.variant_name,
      attributes: variant.attributes,
      manufacturer_sku: variant.manufacturer_sku,
      qty: 1,
      unit_price: variant.retailer_price,
      line_total: variant.retailer_price
    }

    setOrderItems([...orderItems, newItem])
    setSelectedVariantId('')
    setProductSearchQuery('')

    toast({
      title: 'Product Added',
      description: `${variant.product_name} - ${variant.variant_name} added to order`
    })
  }

  const handleRemoveProduct = (variantId: string) => {
    setOrderItems(orderItems.filter(item => item.variant_id !== variantId))
    toast({
      title: 'Product Removed',
      description: 'Product removed from order'
    })
  }

  const handleUpdateQty = (variantId: string, newQty: number) => {
    const variant = availableVariants.find(v => v.id === variantId)
    if (!variant) return

    // Validate against available inventory
    if (newQty > variant.available_qty) {
      toast({
        title: 'Insufficient Stock',
        description: `Only ${variant.available_qty} units available in inventory`,
        variant: 'destructive'
      })
      return
    }

    setOrderItems(orderItems.map(item =>
      item.variant_id === variantId
        ? {
          ...item,
          qty: Math.max(1, newQty),
          line_total: Math.max(1, newQty) * item.unit_price
        }
        : item
    ))
  }

  const handleUpdatePrice = (variantId: string, newPrice: number) => {
    setOrderItems(orderItems.map(item =>
      item.variant_id === variantId
        ? {
          ...item,
          unit_price: newPrice,
          line_total: item.qty * newPrice
        }
        : item
    ))
  }

  const calculateTotals = () => {
    const subtotal = orderItems.reduce((sum, item) => sum + (item.qty * item.unit_price), 0)
    const tax = 0
    const total = subtotal + tax

    return { subtotal, tax, total }
  }

  const totals = calculateTotals()

  // Filter variants based on search and product filter
  const filteredVariants = availableVariants.filter(variant => {
    const matchesSearch = !productSearchQuery ||
      variant.variant_name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      variant.product_name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      variant.manufacturer_sku?.toLowerCase().includes(productSearchQuery.toLowerCase())

    const matchesProductFilter = !selectedProductFilter ||
      variant.product_name === selectedProductFilter

    // Exclude already selected variants
    const isAlreadySelected = orderItems.some(item => item.variant_id === variant.id)

    return matchesSearch && matchesProductFilter && !isAlreadySelected
  })

  const saveOrder = async () => {
    try {
      setSaving(true)

      // Validation
      if (!selectedShopId) {
        toast({
          title: 'Validation Error',
          description: 'Please select a shop',
          variant: 'destructive'
        })
        return
      }

      if (!sellerOrg || !buyerOrg) {
        toast({
          title: 'Validation Error',
          description: 'Missing organization information',
          variant: 'destructive'
        })
        return
      }

      if (!customerName || !deliveryAddress) {
        toast({
          title: 'Validation Error',
          description: 'Customer name and delivery address are required',
          variant: 'destructive'
        })
        return
      }

      if (orderItems.length === 0) {
        toast({
          title: 'Validation Error',
          description: 'Please add at least one product to the order',
          variant: 'destructive'
        })
        return
      }

      // Get company_id
      const { data: companyData } = await supabase
        .rpc('get_company_id', { p_org_id: userProfile.organization_id })

      const companyId = companyData || userProfile.organization_id

      // Create order with draft status first (RLS requirement)
      // Note: order_no and display_doc_no will be auto-generated by database triggers
      const orderData = {
        order_type: 'S2D',
        // order_no is NOT set here - database trigger orders_before_insert() will generate it
        // in the format ORD-SD-YYMM-XX, and orders_auto_display_doc_no trigger will generate
        // display_doc_no in the format SO26XXXXXX
        company_id: companyId,
        buyer_org_id: buyerOrg.id,
        seller_org_id: sellerOrg.id,
        status: 'draft', // Create as draft first
        has_rfid: false,
        has_points: true,
        has_lucky_draw: true,
        has_redeem: true,
        notes: `Customer: ${customerName}, Phone: ${phoneNumber}, Address: ${deliveryAddress}`,
        created_by: userProfile.id
      }

      // Use a type assertion for the payload to satisfy supabase's typed insert
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert(orderData as any)
        .select()
        .single()

      if (orderError) {
        console.error('Error creating order:', orderError)
        throw new Error(`Failed to create order: ${orderError.message}`)
      }

      // Insert order items
      const itemsToInsert = orderItems.map(item => ({
        order_id: order.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        qty: item.qty,
        unit_price: item.unit_price,
        company_id: companyId
      }))

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(itemsToInsert)

      if (itemsError) {
        console.error('Error inserting order items:', itemsError)
        // Try to delete the order if items failed
        await supabase.from('orders').delete().eq('id', order.id)
        throw new Error(`Failed to add products to order: ${itemsError.message}`)
      }

      // Update order status to submitted (Pending Approval)
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'submitted' })
        .eq('id', order.id)

      if (updateError) {
        console.error('Error updating order status:', updateError)
        throw new Error(`Failed to submit order: ${updateError.message}`)
      }

      // Fire-and-forget: trigger notification worker to send WhatsApp/SMS/Email immediately
      fetch('/api/cron/notification-outbox-worker').catch(() => { })

      // Allocate inventory immediately upon submission (reserve stock)
      console.log('🔒 Allocating inventory for order:', order.order_no)
      const { error: allocateError } = await supabase
        .rpc('allocate_inventory_for_order', { p_order_id: order.id })

      if (allocateError) {
        console.error('Error allocating inventory:', allocateError)
        // Rollback order creation if allocation fails
        await supabase.from('orders').delete().eq('id', order.id)
        throw new Error(`Failed to allocate inventory: ${allocateError.message}`)
      }

      console.log('✅ Order submitted and inventory allocated:', order.order_no)

      toast({
        title: 'Success',
        description: 'Order created and inventory allocated successfully. Awaiting approval.',
      })

      // Navigate back to orders list
      if (onViewChange) {
        onViewChange('orders')
      }

    } catch (error: any) {
      console.error('Error saving order:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to save order',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleBack = () => {
    if (onViewChange) {
      onViewChange('orders')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="gap-2 -ml-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Create Shop Order (S2D)</h2>
        <p className="text-gray-600 text-xs mt-1">Create a new order for a Shop using retailer pricing</p>
      </div>

      {/* Main Layout - Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Forms */}
        <div className="lg:col-span-2 space-y-6">

          {/* Shop Selection */}
          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Building2 className="w-4 h-4" />
                Select Shop
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Shop <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedShopId}
                  onChange={(e) => handleShopChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  disabled={availableShops.length === 0}
                >
                  <option value="">Choose shop...</option>
                  {availableShops.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.org_name} ({shop.org_code})
                    </option>
                  ))}
                </select>
                {!selectedShopId && availableShops.length > 0 && (
                  <p className="text-xs text-amber-600 mt-2">
                    ⚠️ Please select a shop to view available products
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Customer Information */}
          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <User className="w-4 h-4" />
                Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {selectedShopId && (
                <>
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-xs text-blue-700">
                      ℹ️ Customer information is automatically filled from the selected shop's profile
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Customer Name <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Customer name"
                        className="bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Phone Number
                      </label>
                      <Input
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="Phone number"
                        className="bg-gray-100"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Delivery Address <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="Delivery address"
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-100"
                    />
                  </div>
                </>
              )}
              {!selectedShopId && (
                <div className="text-center py-8 text-gray-500">
                  <p>Please select a shop first</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Product Selection */}
          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Package className="w-4 h-4" />
                Product Selection
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {!selectedShopId ? (
                <div className="text-center py-12 text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                  <p className="text-lg font-medium mb-1">No Shop Selected</p>
                  <p className="text-sm">Please select a shop above to view available products</p>
                </div>
              ) : (
                <>
                  {/* Search and Filter */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Search Variant
                      </label>
                      <Input
                        value={productSearchQuery}
                        onChange={(e) => setProductSearchQuery(e.target.value)}
                        placeholder="Search by variant name or SKU..."
                        className="bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Filter by Product
                      </label>
                      <select
                        value={selectedProductFilter}
                        onChange={(e) => setSelectedProductFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="">All Products ({Array.from(new Set(availableVariants.map(v => v.product_name))).length})</option>
                        {Array.from(new Set(availableVariants.map(v => v.product_name))).sort().map(productName => (
                          <option key={productName} value={productName}>
                            {productName} ({availableVariants.filter(v => v.product_name === productName).length})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Variant Selection */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Variant ({filteredVariants.length} available)
                    </label>
                    <select
                      value={selectedVariantId}
                      onChange={(e) => setSelectedVariantId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      disabled={filteredVariants.length === 0}
                    >
                      <option value="">Choose variant...</option>
                      {filteredVariants.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.product_name} - {variant.variant_name} | SKU: {variant.manufacturer_sku || 'N/A'} |
                          Price: RM {formatCurrency(variant.retailer_price)} |
                          Stock: {variant.available_qty}
                        </option>
                      ))}
                    </select>
                  </div>

                  <Button
                    onClick={handleAddProduct}
                    disabled={!selectedVariantId}
                    className="w-full"
                  >
                    Add Product
                  </Button>

                  {/* Order Items List */}
                  {orderItems.length > 0 && (
                    <div className="mt-6 space-y-4">
                      <h4 className="font-semibold text-gray-900">Selected Products ({orderItems.length})</h4>
                      {orderItems.map((item) => {
                        const variant = availableVariants.find(v => v.id === item.variant_id)
                        return (
                          <div key={item.variant_id} className="border rounded-lg p-4 bg-gray-50">
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex-1">
                                <h5 className="font-medium text-gray-900">{item.product_name}</h5>
                                <p className="text-sm text-gray-600">{item.variant_name}</p>
                                {item.manufacturer_sku && (
                                  <p className="text-xs text-gray-500 mt-1">SKU: {item.manufacturer_sku}</p>
                                )}
                                {variant && (
                                  <p className="text-xs text-blue-600 mt-1">Available: {variant.available_qty} units</p>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveProduct(item.variant_id)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                  Quantity
                                </label>
                                <Input
                                  type="number"
                                  value={item.qty}
                                  onChange={(e) => handleUpdateQty(item.variant_id, parseInt(e.target.value) || 1)}
                                  min="1"
                                  max={variant?.available_qty}
                                  className="text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                  Unit Price (RM)
                                </label>
                                <Input
                                  type="number"
                                  value={item.unit_price}
                                  onChange={(e) => handleUpdatePrice(item.variant_id, parseFloat(e.target.value) || 0)}
                                  min="0"
                                  step="0.01"
                                  className="text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                  Line Total (RM)
                                </label>
                                <div className="text-sm font-semibold text-gray-900 py-2">
                                  {formatCurrency(item.line_total || 0)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Order Summary */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <ShoppingCart className="w-4 h-4" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {/* Customer Info */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Customer</h4>
                <div className="text-sm space-y-1">
                  <p><span className="font-medium">Name:</span> {customerName || 'Not set'}</p>
                  <p><span className="font-medium">Phone:</span> {phoneNumber || 'Not set'}</p>
                  <p className="flex items-start gap-1">
                    <span className="font-medium">📍</span>
                    <span>{deliveryAddress || 'Not set'}</span>
                  </p>
                </div>
              </div>

              {/* Order Type */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Order Type</h4>
                <div className="text-sm">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    S2D (Shop Order)
                  </span>
                </div>
              </div>

              {/* Shop */}
              {selectedShopId && (
                <div className="mb-6 pb-6 border-b">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Selected Shop</h4>
                  <div className="text-sm">
                    <p className="font-medium text-blue-600">
                      {availableShops.find(s => s.id === selectedShopId)?.org_name}
                    </p>
                  </div>
                </div>
              )}

              {/* Organizations */}
              <div className="mb-6 pb-6 border-b">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Organizations</h4>
                <div className="text-sm space-y-2">
                  <div>
                    <span className="font-medium">Buyer:</span> {buyerOrg?.org_name || 'Not set'}
                  </div>
                  <div>
                    <span className="font-medium">Seller:</span> {sellerOrg?.org_name || 'Not set'}
                  </div>
                </div>
              </div>

              {/* Products */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">
                  Products ({orderItems.length})
                </h4>
                {orderItems.length === 0 ? (
                  <p className="text-sm text-gray-500">No products selected</p>
                ) : (
                  <div className="space-y-2">
                    {orderItems.map((item) => (
                      <div key={item.variant_id} className="text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">{item.variant_name}</span>
                          <span className="font-medium">×{item.qty}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="space-y-2 mb-6 pb-6 border-b">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-medium">RM {formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Tax:</span>
                  <span className="font-medium">RM {formatCurrency(totals.tax)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Total:</span>
                  <span>RM {formatCurrency(totals.total)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                {(!selectedShopId || !sellerOrg || !customerName || !deliveryAddress || orderItems.length === 0) && (
                  <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                    <strong>Required:</strong>
                    {!selectedShopId && ' Select shop.'}
                    {!sellerOrg && ' HQ organization.'}
                    {!customerName && ' Customer name.'}
                    {!deliveryAddress && ' Delivery address.'}
                    {orderItems.length === 0 && ' At least one product.'}
                  </div>
                )}
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={saveOrder}
                  disabled={saving || !selectedShopId || !sellerOrg || !customerName || !deliveryAddress || orderItems.length === 0}
                >
                  {saving ? 'Creating Order...' : 'Create Order'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
