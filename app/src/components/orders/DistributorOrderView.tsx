'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ArrowLeft, User, Package, Loader2, Trash2, ShoppingCart, Building2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import QuickOrderGrid from './QuickOrderGrid'
import {
  MISSING_DEFAULT_FULFILLMENT_WAREHOUSE_MESSAGE,
  filterEligibleHqFulfillmentWarehouses,
  resolveDefaultFulfillmentWarehouseId,
  resolveSellerHqId,
  type HqFulfillmentWarehouse,
} from '@/lib/orders/hq-fulfillment-warehouses'

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
  group_name?: string
  variant_name: string
  alternative_name?: string | null
  attributes?: Record<string, any>
  barcode?: string | null
  manufacturer_sku?: string | null
  distributor_price: number
  available_qty: number
  inventory_classification?: 'classified' | 'unclassified'
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
  const [distributorSearchQuery, setDistributorSearchQuery] = useState('')
  const [isDistributorDropdownOpen, setIsDistributorDropdownOpen] = useState(false)
  const distributorSearchRef = useRef<HTMLDivElement>(null)
  const [hqOrgId, setHqOrgId] = useState<string>('')
  const [fulfillmentWarehouses, setFulfillmentWarehouses] = useState<HqFulfillmentWarehouse[]>([])
  const [fulfillmentWarehouseId, setFulfillmentWarehouseId] = useState('')
  const [defaultFulfillmentMissing, setDefaultFulfillmentMissing] = useState(false)
  const submitLockRef = useRef(false)

  // Customer Information
  const [customerName, setCustomerName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')

  // Products and Variants
  const [availableVariants, setAvailableVariants] = useState<ProductVariant[]>([])
  const [quickOrderVariants, setQuickOrderVariants] = useState<ProductVariant[]>([])
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [orderMode, setOrderMode] = useState<'quick' | 'standard'>('quick')
  const selectedFulfillmentWarehouse = fulfillmentWarehouses.find((warehouse) => warehouse.id === fulfillmentWarehouseId) || null

  // Product filtering
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [selectedProductFilter, setSelectedProductFilter] = useState('')

  useEffect(() => {
    initializeOrder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (hqOrgId) {
      const timer = setTimeout(() => {
        loadDistributors(hqOrgId, undefined, distributorSearchQuery)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [distributorSearchQuery, hqOrgId])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (distributorSearchRef.current && !distributorSearchRef.current.contains(event.target as Node)) {
        setIsDistributorDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
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

      const resolvedHqOrgId = resolveSellerHqId(userOrgData)
      if (!resolvedHqOrgId) {
        toast({
          title: 'Configuration Error',
          description: 'Your organization is not linked to a parent HQ. Please contact administrator.',
          variant: 'destructive'
        })
        return
      }

      setHqOrgId(resolvedHqOrgId)

      const [{ data: hqData, error: hqError }, { data: warehouseRows, error: warehouseError }] = await Promise.all([
        supabase
          .from('organizations')
          .select('id, default_warehouse_org_id')
          .eq('id', resolvedHqOrgId)
          .single(),
        supabase
          .from('organizations')
          .select('id, org_name, org_code, org_type_code, parent_org_id, is_active')
          .eq('parent_org_id', resolvedHqOrgId)
          .eq('org_type_code', 'WH')
          .eq('is_active', true)
          .order('org_name', { ascending: true }),
      ])
      if (hqError) throw hqError
      if (warehouseError) throw warehouseError

      const eligibleWarehouses = filterEligibleHqFulfillmentWarehouses(
        (warehouseRows || []) as HqFulfillmentWarehouse[],
        resolvedHqOrgId,
      )
      setFulfillmentWarehouses(eligibleWarehouses)

      const defaultResolution = resolveDefaultFulfillmentWarehouseId(
        hqData?.default_warehouse_org_id,
        eligibleWarehouses,
      )
      setDefaultFulfillmentMissing(defaultResolution.defaultMissingOrInvalid)
      setFulfillmentWarehouseId(defaultResolution.warehouseId || '')

      // Load available distributors (children of HQ)
      await loadDistributors(resolvedHqOrgId)

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

  const loadDistributors = async (hqOrgId: string, inventoryOrgId?: string, search?: string) => {
    try {
      // Load all distributor organizations under the HQ
      let query = supabase
        .from('organizations')
        .select('*')
        .eq('parent_org_id', hqOrgId)
        .eq('org_type_code', 'DIST')
        .eq('is_active', true)
        .order('org_name')

      if (search && search.length >= 2) {
        query = query.ilike('org_name', `%${search}%`)
      } else {
        query = query.limit(50)
      }

      const { data, error } = await query

      if (error) throw error

      setAvailableDistributors(data || [])

      if (data && data.length === 0 && !toastShownRef.current && !search) {
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

  const refreshAvailabilityForSelection = async (
    distributorId: string,
    warehouseId: string,
  ) => {
    if (!distributorId || !warehouseId) {
      setAvailableVariants([])
      setQuickOrderVariants([])
      return
    }
    await Promise.all([
      loadAvailableProducts(distributorId, warehouseId),
      loadQuickOrderCatalog(distributorId, warehouseId),
    ])
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
    await refreshAvailabilityForSelection(distributorId, fulfillmentWarehouseId)
  }

  const handleFulfillmentWarehouseChange = async (warehouseId: string) => {
    setFulfillmentWarehouseId(warehouseId)
    if (!selectedDistributorId) return
    await refreshAvailabilityForSelection(selectedDistributorId, warehouseId)
    toast({
      title: 'Fulfillment warehouse updated',
      description: 'Available quantities were refreshed for the selected warehouse.',
    })
  }

  const loadQuickOrderCatalog = async (distributorId: string, warehouseId: string) => {
    const response = await fetch('/api/orders/d2h/quick-order-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ distributorId, fulfillmentWarehouseId: warehouseId }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      setQuickOrderVariants([])
      toast({
        title: 'Quick Order Catalog Unavailable',
        description: result?.error || 'Unable to load the distributor Quick Order catalog.',
        variant: 'destructive',
      })
      return
    }
    setQuickOrderVariants(result.variants || [])

    const availability = new Map<string, ProductVariant>(
      (result.variants || []).map((variant: ProductVariant) => [variant.id, variant]),
    )
    const insufficient = orderItems.filter((item) => {
      const variant = availability.get(item.variant_id)
      return !variant || (
        variant.inventory_classification !== 'unclassified' && item.qty > variant.available_qty
      )
    })
    if (insufficient.length > 0) {
      toast({
        title: 'Insufficient stock at selected warehouse',
        description: `${insufficient.length} selected item(s) exceed available stock at ${result.fulfillmentWarehouseName || 'the selected warehouse'}. Adjust quantities before submitting.`,
        variant: 'destructive',
      })
    }
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
          alternative_name,
          attributes,
          barcode,
          manufacturer_sku,
          distributor_price,
          is_active,
          products!inner (
            id,
            product_code,
            product_name,
            is_active,
            product_groups (group_name)
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
          const productGroup = Array.isArray(product?.product_groups) ? product.product_groups[0] : product?.product_groups

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
            group_name: productGroup?.group_name || 'Other',
            variant_name: v.variant_name,
            alternative_name: v.alternative_name || null,
            attributes: v.attributes || {},
            barcode: v.barcode,
            manufacturer_sku: v.manufacturer_sku,
            distributor_price: v.distributor_price || 0,
            available_qty: availableQty
          }
        })
      )

      setAvailableVariants(variantsWithInventory)

      if (variantsWithInventory.length === 0) {
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

  const handleQuickQuantityChange = (variantId: string, requestedQty: number) => {
    const variant = quickOrderVariants.find(candidate => candidate.id === variantId)
    if (!variant) return

    const newQty = Math.max(0, Math.trunc(requestedQty))
    if (variant.inventory_classification !== 'unclassified' && newQty > variant.available_qty) {
      toast({
        title: 'Insufficient Stock',
        description: `Only ${variant.available_qty} units of ${variant.variant_name} are available`,
        variant: 'destructive'
      })
      return
    }

    setOrderItems(currentItems => {
      const existing = currentItems.find(item => item.variant_id === variantId)
      if (newQty === 0) return currentItems.filter(item => item.variant_id !== variantId)
      if (existing) {
        return currentItems.map(item => item.variant_id === variantId
          ? { ...item, qty: newQty, unit_price: variant.distributor_price, line_total: newQty * variant.distributor_price }
          : item)
      }
      return [...currentItems, {
        id: `temp-${variantId}`,
        order_id: '',
        product_id: variant.product_id,
        variant_id: variant.id,
        product_name: variant.product_name,
        variant_name: variant.variant_name,
        attributes: variant.attributes,
        manufacturer_sku: variant.manufacturer_sku,
        qty: newQty,
        unit_price: variant.distributor_price,
        line_total: newQty * variant.distributor_price
      }]
    })
  }

  const handleOrderModeSwitch = () => {
    if (orderMode === 'quick') {
      setOrderMode('standard')
      return
    }

    const quickVariantsById = new Map(quickOrderVariants.map(variant => [variant.id, variant]))
    const itemsOutsideQuickCatalog = orderItems.filter(item => {
      const variant = quickVariantsById.get(item.variant_id)
      return !variant || item.qty > variant.available_qty
    })
    if (itemsOutsideQuickCatalog.length > 0) {
      const shouldClear = window.confirm(
        `${itemsOutsideQuickCatalog.length} selected item(s) are not available in the distributor Quick Order catalog and must be cleared before switching. Continue?`
      )
      if (!shouldClear) return
    }
    setOrderItems(items => items.flatMap(item => {
      const variant = quickVariantsById.get(item.variant_id)
      if (!variant || item.qty > variant.available_qty) return []
      return [{ ...item, unit_price: variant.distributor_price, line_total: item.qty * variant.distributor_price }]
    }))
    setOrderMode('quick')
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
    if (submitLockRef.current || saving) return

    try {
      setSaving(true)
      submitLockRef.current = true

      // Validation
      if (!selectedDistributorId) {
        toast({
          title: 'Validation Error',
          description: 'Please select a distributor',
          variant: 'destructive'
        })
        return
      }

      if (!fulfillmentWarehouseId) {
        toast({
          title: 'Validation Error',
          description: defaultFulfillmentMissing
            ? MISSING_DEFAULT_FULFILLMENT_WAREHOUSE_MESSAGE
            : 'Please select a fulfillment warehouse',
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

      const positiveOrderItems = orderItems.filter(item => item.qty > 0)
      if (positiveOrderItems.length === 0) {
        toast({
          title: 'Validation Error',
          description: 'Please add at least one product to the order',
          variant: 'destructive'
        })
        return
      }

      // Re-read authoritative active variants, distributor prices, and warehouse
      // availability on the server immediately before the atomic D2H submit RPC.
      const preflightResponse = await fetch('/api/orders/d2h/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: orderMode,
          distributorId: selectedDistributorId,
          fulfillmentWarehouseId,
          items: positiveOrderItems.map(item => ({ variantId: item.variant_id, quantity: item.qty }))
        })
      })
      const preflight = await preflightResponse.json().catch(() => null)
      if (!preflightResponse.ok) {
        throw new Error(preflight?.error || 'Stock and price validation failed. Please review the order and try again.')
      }
      const authoritativeItems = new Map<string, { distributorPrice: number }>(
        preflight.items.map((item: { variantId: string; distributorPrice: number }) => [item.variantId, item])
      )

      // Get company_id
      const { data: companyData } = await supabase
        .rpc('get_company_id', { p_org_id: userProfile.organization_id })

      const companyId = companyData || userProfile.organization_id
      const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `d2h-${Date.now()}-${Math.random().toString(36).slice(2)}`

      const { data: order, error: submitError } = await (supabase as any).rpc('submit_and_allocate_d2h_order', {
        p_company_id: companyId,
        p_buyer_org_id: buyerOrg.id,
        p_seller_org_id: sellerOrg.id,
        p_fulfillment_warehouse_id: fulfillmentWarehouseId,
        p_items: positiveOrderItems.map(item => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          qty: item.qty,
          unit_price: authoritativeItems.get(item.variant_id)!.distributorPrice,
        })),
        p_notes: `Customer: ${customerName}, Phone: ${phoneNumber}, Address: ${deliveryAddress}`,
        p_created_by: userProfile.id,
        p_idempotency_key: idempotencyKey,
      })

      if (submitError) {
        console.error('Error submitting D2H order:', submitError)
        throw new Error(submitError.message || 'Failed to submit and allocate the order')
      }

      await fetch('/api/notifications/order-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, eventCode: 'order_submitted' })
      }).catch((error) => {
        console.warn('Failed to queue order_submitted notification:', error)
      })

      // Fire-and-forget: trigger notification worker to send WhatsApp/SMS/Email immediately
      fetch('/api/cron/notification-outbox-worker').catch(() => { })

      console.log('✅ Order submitted and inventory allocated:', order.order_no)

      toast({
        title: 'Success',
        description: `Order created from ${selectedFulfillmentWarehouse?.org_name || 'selected warehouse'} and inventory allocated. Awaiting approval.`,
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
      submitLockRef.current = false
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

    return matchesSearch && matchesProductFilter && !isAlreadySelected && variant.available_qty > 0
  })

  const standardAvailableVariants = availableVariants.filter(variant => variant.available_qty > 0)

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
                <div className="relative" ref={distributorSearchRef}>
                  <Input
                    value={selectedDistributorId ? (availableDistributors.find(d => d.id === selectedDistributorId)?.org_name || distributorSearchQuery) : distributorSearchQuery}
                    onChange={(e) => {
                      setDistributorSearchQuery(e.target.value)
                      if (selectedDistributorId) {
                        setSelectedDistributorId('')
                        setBuyerOrg(null)
                      }
                      setIsDistributorDropdownOpen(true)
                    }}
                    onFocus={() => setIsDistributorDropdownOpen(true)}
                    placeholder="Search distributor (min 2 chars)..."
                    className="w-full"
                  />
                  {isDistributorDropdownOpen && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
                      {availableDistributors.length === 0 ? (
                        <div className="p-2 text-sm text-gray-500">No distributors found</div>
                      ) : (
                        availableDistributors.map((dist) => (
                          <div
                            key={dist.id}
                            className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
                            onClick={() => {
                              handleDistributorChange(dist.id)
                              setDistributorSearchQuery(dist.org_name)
                              setIsDistributorDropdownOpen(false)
                            }}
                          >
                            {dist.org_name} ({dist.org_code})
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {!selectedDistributorId && availableDistributors.length > 0 && (
                  <p className="text-xs text-amber-600 mt-2">
                    ⚠️ Please select a distributor to view available products
                  </p>
                )}
              </div>

              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Fulfillment Warehouse <span className="text-red-500">*</span>
                </label>
                <select
                  value={fulfillmentWarehouseId}
                  onChange={(e) => handleFulfillmentWarehouseChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  disabled={fulfillmentWarehouses.length === 0}
                >
                  <option value="">Select warehouse...</option>
                  {fulfillmentWarehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.org_name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  Stock for this order will be allocated and fulfilled from this warehouse.
                </p>
                {defaultFulfillmentMissing && !fulfillmentWarehouseId && (
                  <p className="text-xs text-amber-600 mt-2">
                    {MISSING_DEFAULT_FULFILLMENT_WAREHOUSE_MESSAGE}
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
              {!selectedDistributorId || !fulfillmentWarehouseId ? (
                <div className="text-center py-12 text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                  <p className="text-lg font-medium mb-1">
                    {!selectedDistributorId ? 'No Distributor Selected' : 'No Fulfillment Warehouse Selected'}
                  </p>
                  <p className="text-sm">
                    {!selectedDistributorId
                      ? 'Please select a distributor above to view available products'
                      : 'Please select a fulfillment warehouse above to view available products'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-gray-900">{orderMode === 'quick' ? 'Quick Order' : 'Standard Order'}</h4>
                      <p className="text-xs text-gray-500">{orderMode === 'quick' ? 'Enter quantities for multiple flavours at once.' : 'Add and edit products using the original order form.'}</p>
                    </div>
                    <div className="text-xs text-gray-600">
                      Using {orderMode === 'quick' ? 'Quick Order' : 'Standard Order'} <span aria-hidden="true">·</span>{' '}
                      <button type="button" className="font-medium text-blue-600 underline underline-offset-2" onClick={handleOrderModeSwitch}>
                        {orderMode === 'quick' ? 'Switch to Standard' : 'Try Quick Order'}
                      </button>
                    </div>
                  </div>
                  {orderMode === 'quick' ? (
                    <QuickOrderGrid
                      variants={quickOrderVariants}
                      items={orderItems}
                      formatCurrency={formatCurrency}
                      onQuantityChange={handleQuickQuantityChange}
                      onClear={() => setOrderItems([])}
                    />
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
                        <option value="">All Products ({Array.from(new Set(standardAvailableVariants.map(v => v.product_name))).length})</option>
                        {Array.from(new Set(standardAvailableVariants.map(v => v.product_name))).sort().map(productName => (
                          <option key={productName} value={productName}>
                            {productName} ({standardAvailableVariants.filter(v => v.product_name === productName).length})
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

              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Fulfillment</h4>
                <p className="text-sm text-gray-700">
                  Fulfilled From: {selectedFulfillmentWarehouse?.org_name || 'Not selected'}
                </p>
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
