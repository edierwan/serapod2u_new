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

interface DistributorOrderViewProps {
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
  distributor_price: number
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

export default function DistributorOrderView({ userProfile, onViewChange }: DistributorOrderViewProps) {
  const supabase = createClient()
  const { toast } = useToast()
  
  // Ref to prevent duplicate toasts in React Strict Mode
  const toastShownRef = useRef(false)
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Organizations
  const [buyerOrg, setBuyerOrg] = useState<Organization | null>(null)
  const [sellerOrg, setSellerOrg] = useState<Organization | null>(null)
  const [availableDistributors, setAvailableDistributors] = useState<Organization[]>([])
  const [selectedDistributorId, setSelectedDistributorId] = useState('')
  
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
      
      // Load user's organization details
      const { data: userOrgData, error: userOrgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userProfile.organization_id)
        .single()
      
      if (userOrgError) throw userOrgError
      
      // Set SELLER as current organization (Warehouse/HQ)
      setSellerOrg(userOrgData)
      setBuyerOrg(null)
      
      // Find parent HQ org to load distributors
      let hqOrgId = userOrgData.parent_org_id

      // If no parent_org_id, check if current org is HQ or WH acting as parent
      if (!hqOrgId) {
        if (userOrgData.org_type_code === 'HQ' || userOrgData.org_type_code === 'WH') {
          // Assume we are the parent/HQ
          hqOrgId = userOrgData.id
        } else {
          toast({
            title: 'Configuration Error',
            description: 'Your organization is not linked to a parent HQ. Please contact administrator.',
            variant: 'destructive'
          })
          return
        }
      }

      // Determine inventory source organization
      // If we are HQ, inventory is likely in a child Warehouse
      let inventoryOrgId = userProfile.organization_id
      if (userOrgData.org_type_code === 'HQ') {
        const { data: whData } = await supabase
          .from('organizations')
          .select('id')
          .eq('parent_org_id', userOrgData.id)
          .eq('org_type_code', 'WH')
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        
        if (whData) {
          inventoryOrgId = whData.id
        }
      }

      // Load available distributors (children of HQ)
      await loadDistributors(hqOrgId, inventoryOrgId)
      
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

  const loadDistributors = async (hqOrgId: string, inventoryOrgId?: string) => {
    try {
      // Load all distributor organizations under the HQ
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('parent_org_id', hqOrgId)
        .eq('org_type_code', 'DIST')
        .eq('is_active', true)
        .order('org_name')
      
      if (error) throw error
      
      setAvailableDistributors(data || [])
      
      if (data && data.length === 0 && !toastShownRef.current) {
        toastShownRef.current = true
        toast({
          title: 'No Distributors Found',
          description: 'No active distributors found under HQ. Please contact administrator.',
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      console.error('Error loading distributors:', error)
      toast({
        title: 'Error',
        description: 'Failed to load distributors',
        variant: 'destructive'
      })
    }
  }

  const handleDistributorChange = async (distributorId: string) => {
    setSelectedDistributorId(distributorId)
    
    const distributor = availableDistributors.find(d => d.id === distributorId)
    if (!distributor) return
    
    setBuyerOrg(distributor)
    
    // Update customer information with distributor details
    setCustomerName(distributor.contact_name || distributor.org_name)
    setPhoneNumber(distributor.contact_phone || '')
    
    // Combine address and address_line2 for delivery address
    const fullAddress = [
      distributor.address,
      distributor.address_line2
    ].filter(Boolean).join(', ')
    
    setDeliveryAddress(fullAddress || '')
    
    // Determine inventory source again (need to pass it or store it)
    // For now, re-fetch or assume we stored it. 
    // Better to store it in state.
    // But since I can't easily add state without replacing the whole component, 
    // I'll re-derive it or pass it.
    // Actually, I can just re-derive it inside loadAvailableProducts or pass it.
    // Let's modify loadAvailableProducts to accept inventoryOrgId.
    
    // Wait, I need to pass inventoryOrgId to loadAvailableProducts.
    // I'll fetch it again here to be safe/simple.
    
    let inventoryOrgId = userProfile.organization_id
    // Check if we are HQ
    const { data: userOrg } = await supabase.from('organizations').select('org_type_code').eq('id', userProfile.organization_id).single()
    if (userOrg?.org_type_code === 'HQ') {
       const { data: wh } = await supabase
         .from('organizations')
         .select('id')
         .eq('parent_org_id', userProfile.organization_id)
         .eq('org_type_code', 'WH')
         .order('created_at', { ascending: true })
         .limit(1)
         .maybeSingle()
       if (wh) inventoryOrgId = wh.id
    }

    await loadAvailableProducts(distributorId, inventoryOrgId)
  }

  const loadAvailableProducts = async (distributorId: string, inventoryOrgId: string) => {
    if (!distributorId) return
    
    try {
      // Get company_id for order creation (still needed later)
      const { data: companyData } = await supabase
        .rpc('get_company_id', { p_org_id: userProfile.organization_id })
      
      const companyId = companyData || userProfile.organization_id
      
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
          distributor_price,
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
      
      // Get inventory for each variant
      const variantsWithInventory = await Promise.all(
        (data || []).map(async (v: any) => {
          const product = Array.isArray(v.products) ? v.products[0] : v.products
          
          // Get available quantity from product_inventory using inventoryOrgId (Warehouse)
          const { data: inventoryData } = await supabase
            .from('product_inventory')
            .select('quantity_available')
            .eq('variant_id', v.id)
            .eq('organization_id', inventoryOrgId)
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
            distributor_price: v.distributor_price || 0,
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
          description: 'No products with available inventory found in Warehouse. Please ensure products are in stock.',
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

  const handleBack = () => {
    if (onViewChange) {
      onViewChange('distributor-order')
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
    if (!variant.distributor_price || variant.distributor_price <= 0) {
      toast({
        title: 'Price Not Maintained',
        description: 'Please maintain the distributor price for this product first.',
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

    // Add product variant with distributor price
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
      unit_price: variant.distributor_price,
      line_total: variant.distributor_price
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

  const saveOrder = async () => {
    try {
      setSaving(true)
      
      // Validation
      if (!selectedDistributorId) {
        toast({
          title: 'Validation Error',
          description: 'Please select a distributor',
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

      // Generate order number (format: D2H-MMDD-XX)
      const now = new Date()
      const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const orderPrefix = `D2H-${monthDay}-`
      
      // Fetch existing orders for today to find available sequence numbers
      const { data: existingOrders } = await supabase
        .from('orders')
        .select('order_no')
        .like('order_no', `${orderPrefix}%`)
        .order('order_no', { ascending: true })
      
      // Extract sequence numbers from existing orders
      const usedSequences = new Set(
        (existingOrders || [])
          .map(order => {
            const parts = order.order_no.split('-')
            return parseInt(parts[parts.length - 1])
          })
          .filter(num => !isNaN(num))
      )
      
      // Find the lowest available sequence number
      let sequenceNumber = 1
      while (usedSequences.has(sequenceNumber)) {
        sequenceNumber++
      }
      
      const sequenceSuffix = String(sequenceNumber).padStart(2, '0')
      const generatedOrderNo = `${orderPrefix}${sequenceSuffix}`
      
      // Create order with draft status first (RLS requirement)
      const orderData = {
        order_type: 'D2H',
        order_no: generatedOrderNo,
        company_id: companyId,
        buyer_org_id: buyerOrg.id,
        seller_org_id: sellerOrg.id,
        status: 'draft', // Create as draft first
        // units_per_case: 100, // Removed for D2H
        // qr_buffer_percent: 10, // Removed for D2H
        // extra_qr_master: 5, // Removed for D2H
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
        <h2 className="text-xl font-bold text-gray-900">Order to HQ (D2H)</h2>
        <p className="text-gray-600 text-xs mt-1">Create a D2H order to headquarters using distributor pricing</p>
      </div>

      {/* Main Layout - Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Forms */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Distributor Selection */}
          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Building2 className="w-4 h-4" />
                Select Distributor
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Distributor <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedDistributorId}
                  onChange={(e) => handleDistributorChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  disabled={availableDistributors.length === 0}
                >
                  <option value="">Choose distributor...</option>
                  {availableDistributors.map((dist) => (
                    <option key={dist.id} value={dist.id}>
                      {dist.org_name} ({dist.org_code})
                    </option>
                  ))}
                </select>
                {!selectedDistributorId && availableDistributors.length > 0 && (
                  <p className="text-xs text-amber-600 mt-2">
                    ⚠️ Please select a distributor to view available products
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
              {selectedDistributorId && (
                <>
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-xs text-blue-700">
                      ℹ️ Customer information is automatically filled from the selected distributor's profile
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
              {!selectedDistributorId && (
                <div className="text-center py-8 text-gray-500">
                  <p>Please select a distributor first</p>
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
              {!selectedDistributorId ? (
                <div className="text-center py-12 text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                  <p className="text-lg font-medium mb-1">No Distributor Selected</p>
                  <p className="text-sm">Please select a distributor above to view available products</p>
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
                      Price: RM {formatCurrency(variant.distributor_price)} | 
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
                    D2H (Distributor → HQ)
                  </span>
                </div>
              </div>

              {/* Distributor */}
              {selectedDistributorId && (
                <div className="mb-6 pb-6 border-b">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Selected Distributor</h4>
                  <div className="text-sm">
                    <p className="font-medium text-blue-600">
                      {availableDistributors.find(d => d.id === selectedDistributorId)?.org_name}
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
                {(!selectedDistributorId || !sellerOrg || !customerName || !deliveryAddress || orderItems.length === 0) && (
                  <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                    <strong>Required:</strong>
                    {!selectedDistributorId && ' Select distributor.'}
                    {!sellerOrg && ' HQ organization.'}
                    {!customerName && ' Customer name.'}
                    {!deliveryAddress && ' Delivery address.'}
                    {orderItems.length === 0 && ' At least one product.'}
                  </div>
                )}
                <Button 
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={saveOrder}
                  disabled={saving || !selectedDistributorId || !sellerOrg || !customerName || !deliveryAddress || orderItems.length === 0}
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
