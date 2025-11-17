'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ArrowLeft, User, Package, CheckSquare, Loader2, Trash2 } from 'lucide-react'
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

interface CreateOrderViewProps {
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
}

interface Product {
  id: string
  product_code: string
  product_name: string
  brand_name?: string
  category_name?: string
  manufacturer_id?: string
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
  base_cost: number
  suggested_retail_price: number
  is_default: boolean
  manufacturer_id?: string
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
  company_id?: string
  units_per_case?: number  // Individual units per case for this product (when useIndividualCases is true)
}

interface DistributorOption {
  id: string
  org_name: string
  org_code: string
  is_preferred: boolean
}

// Helper function to format currency with thousand separators
const formatCurrency = (amount: number): string => {
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export default function CreateOrderView({ userProfile, onViewChange }: CreateOrderViewProps) {
  const supabase = createClient()
  const { toast } = useToast()
  
  // Determine order type based on user's organization type
  const [orderType, setOrderType] = useState<'H2M' | 'D2H' | 'S2D'>('H2M')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Organizations
  const [buyerOrg, setBuyerOrg] = useState<Organization | null>(null)
  const [sellerOrg, setSellerOrg] = useState<Organization | null>(null)
  const [availableSellerOrgs, setAvailableSellerOrgs] = useState<Organization[]>([])
  const [selectedSellerOrgId, setSelectedSellerOrgId] = useState('')
  
  // For S2D: Multiple distributor options
  const [availableDistributors, setAvailableDistributors] = useState<DistributorOption[]>([])
  const [showDistributorSelector, setShowDistributorSelector] = useState(false)
  
  // Customer Information (derived from organization or custom)
  const [customerName, setCustomerName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  
  // Order Configuration
  const [unitsPerCase, setUnitsPerCase] = useState(100)
  const [useIndividualCases, setUseIndividualCases] = useState(false)  // Toggle for individual case sizes
  const [qrBuffer, setQrBuffer] = useState(10.00)
  const [enableRFID, setEnableRFID] = useState(false)
  const [hasPoints, setHasPoints] = useState(true)
  const [enableLuckyDraw, setEnableLuckyDraw] = useState(true)
  const [enableRedeem, setEnableRedeem] = useState(true)
  const [notes, setNotes] = useState('')
  
  // Products and Variants
  const [availableVariants, setAvailableVariants] = useState<ProductVariant[]>([])
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  
  // Product filtering and search
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [selectedProductFilter, setSelectedProductFilter] = useState('')

  useEffect(() => {
    initializeOrder()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const initializeOrder = async () => {
    try {
      setLoading(true)
      
      // Check if we're editing an existing order
      const editingOrderId = sessionStorage.getItem('editingOrderId')
      if (editingOrderId) {
        await loadExistingOrder(editingOrderId)
        sessionStorage.removeItem('editingOrderId')
        return
      }
      
      // Check if we're copying an order
      const copyingOrderData = sessionStorage.getItem('copyingOrderData')
      if (copyingOrderData) {
        await loadCopiedOrder(JSON.parse(copyingOrderData))
        sessionStorage.removeItem('copyingOrderData')
        return
      }
      
      // Determine order type and buyer based on user's org type
      const userOrgType = userProfile.organizations.org_type_code
      
      // Fetch user's organization full details
      const { data: userOrgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userProfile.organization_id)
        .single()
      
      if (!userOrgData) throw new Error('User organization not found')
      
      // Set order type and buyer based on user's organization
      if (userOrgType === 'HQ') {
        setOrderType('H2M')
        setBuyerOrg(userOrgData)
        // For H2M: Load all active products first, seller will be auto-detected from products
        await loadAvailableProducts('')
      } else if (userOrgType === 'DIST') {
        setOrderType('D2H')
        setBuyerOrg(userOrgData)
        // For D2H: Distributor buys from HQ - auto-select parent org as seller
        if (userOrgData.parent_org_id) {
          const { data: parentOrg } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', userOrgData.parent_org_id)
            .single()
          
          if (parentOrg) {
            setSellerOrg(parentOrg)
            setSelectedSellerOrgId(parentOrg.id)
            // Auto-load products for HQ
            await loadAvailableProducts(parentOrg.id)
          }
        }
      } else if (userOrgType === 'SHOP') {
        setOrderType('S2D')
        setBuyerOrg(userOrgData)
        
        console.log('🏪 Shop Order - Auto-filling customer info:', {
          org_name: userOrgData.org_name,
          contact_name: userOrgData.contact_name,
          contact_phone: userOrgData.contact_phone,
          address: userOrgData.address
        })
        
        // Auto-fill customer information from shop organization
        // For shops, customer = shop itself
        setCustomerName(userOrgData.org_name) // Use shop name as customer name
        setPhoneNumber(userOrgData.contact_phone || '')
        
        // Combine address and address_line2 for delivery address
        const fullAddress = [
          userOrgData.address,
          userOrgData.address_line2
        ].filter(Boolean).join(', ')
        
        setDeliveryAddress(fullAddress || '')
        
        // For S2D: Shop buys from Distributor - load available distributors
        await loadShopDistributors(userOrgData.id)
      }
      
      // Auto-fill customer information from organization (for HQ and DIST orders)
      if (userOrgType !== 'SHOP') {
        setCustomerName(userOrgData.contact_name || userOrgData.org_name)
        setPhoneNumber(userOrgData.contact_phone || '')
        
        // Combine address and address_line2 for delivery address
        const fullAddress = [
          userOrgData.address,
          userOrgData.address_line2
        ].filter(Boolean).join(', ')
        
        setDeliveryAddress(fullAddress || '')
      }
      
    } catch (error) {
      console.error('Error initializing order:', error)
      toast({
        title: 'Error',
        description: 'Failed to initialize order form',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const loadSellerOrganizations = async (orgType: string) => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name, org_type_code, org_code, address, contact_phone, contact_name')
        .eq('org_type_code', orgType)
        .eq('is_active', true)
        .order('org_name')
      
      if (error) throw error
      setAvailableSellerOrgs(data || [])
    } catch (error) {
      console.error('Error loading seller organizations:', error)
    }
  }

  const loadShopDistributors = async (shopId: string) => {
    try {
      // Query shop_distributors table to get linked distributors
      const { data, error } = await supabase
        .from('shop_distributors')
        .select(`
          distributor_id,
          is_preferred,
          organizations:distributor_id (
            id,
            org_name,
            org_code
          )
        `)
        .eq('shop_id', shopId)
        .eq('is_active', true)
      
      if (error) throw error
      
      const distributors: DistributorOption[] = (data || [])
        .filter(item => item.organizations)
        .map(item => {
          const org: any = Array.isArray(item.organizations) 
            ? item.organizations[0] 
            : item.organizations
          return {
            id: org.id,
            org_name: org.org_name,
            org_code: org.org_code,
            is_preferred: item.is_preferred || false
          }
        })
      
      setAvailableDistributors(distributors)
      
      // For S2D orders, load products first (shops can order any product from distributor)
      // Don't filter by distributor - distributors act as middlemen
      await loadAvailableProducts('')
      
      // Then auto-select preferred distributor if exists
      const preferred = distributors.find(d => d.is_preferred)
      if (preferred) {
        setSellerOrg({
          id: preferred.id,
          org_name: preferred.org_name,
          org_code: preferred.org_code,
          org_type_code: 'DIST'
        })
        setSelectedSellerOrgId(preferred.id)
        setShowDistributorSelector(distributors.length > 1) // Show selector only if multiple options
      } else if (distributors.length === 1) {
        // If only one distributor, auto-select it
        const single = distributors[0]
        setSellerOrg({
          id: single.id,
          org_name: single.org_name,
          org_code: single.org_code,
          org_type_code: 'DIST'
        })
        setSelectedSellerOrgId(single.id)
        setShowDistributorSelector(false)
      } else if (distributors.length > 1) {
        // Multiple distributors, no preferred - show selector
        setShowDistributorSelector(true)
      } else {
        // No distributors linked
        toast({
          title: 'No Distributors Linked',
          description: 'This shop has no linked distributors. Please contact your administrator.',
          variant: 'destructive'
        })
      }
    } catch (error) {
      console.error('Error loading shop distributors:', error)
      toast({
        title: 'Error',
        description: 'Failed to load available distributors',
        variant: 'destructive'
      })
    }
  }

  const handleDistributorChange = async (distributorId: string) => {
    setSelectedSellerOrgId(distributorId)
    const distributor = availableDistributors.find(d => d.id === distributorId)
    if (distributor) {
      setSellerOrg({
        id: distributor.id,
        org_name: distributor.org_name,
        org_code: distributor.org_code,
        org_type_code: 'DIST'
      })
      // For S2D orders, products are already loaded (not distributor-specific)
      // No need to reload products when changing distributor
    }
  }

  const handleSellerChange = async (sellerId: string) => {
    setSelectedSellerOrgId(sellerId)
    const seller = availableSellerOrgs.find(org => org.id === sellerId)
    if (seller) {
      setSellerOrg(seller)
      // Load products available for this seller
      await loadAvailableProducts(sellerId)
    }
  }

  const loadAvailableProducts = async (sellerOrgId: string) => {
    try {
      console.log('🔍 Loading product variants - orderType:', orderType, 'sellerOrgId:', sellerOrgId)
      
      // Load product variants with product details
      let query = supabase
        .from('product_variants')
        .select(`
          id,
          product_id,
          variant_name,
          attributes,
          barcode,
          manufacturer_sku,
          base_cost,
          suggested_retail_price,
          is_active,
          is_default,
          products!inner (
            id,
            product_code,
            product_name,
            manufacturer_id,
            is_active
          )
        `)
        .eq('is_active', true)
        .eq('products.is_active', true)
      
      // Filter by manufacturer ONLY for H2M orders (HQ buying from specific manufacturer)
      // For S2D orders, shops should see ALL products regardless of manufacturer
      if (orderType === 'H2M' && sellerOrgId) {
        console.log('🔍 Filtering by manufacturer:', sellerOrgId)
        query = query.eq('products.manufacturer_id', sellerOrgId)
      } else if (orderType === 'S2D') {
        console.log('🔍 S2D order: Loading all active products for shop')
        // No manufacturer filter for S2D - shops can order any product
      }
      
      query = query.order('variant_name')
      
      const { data, error } = await query
      
      console.log('📦 Variants query result - data:', data, 'error:', error)
      
      if (error) {
        console.error('❌ Error loading variants:', error)
        toast({
          title: 'Database Error',
          description: `Failed to load product variants: ${error.message}`,
          variant: 'destructive'
        })
        throw error
      }
      
      console.log('📦 Raw variants data (first item):', data?.[0])
      
      const formattedVariants = data?.map((v: any) => {
        const product = Array.isArray(v.products) ? v.products[0] : v.products
        
        return {
          id: v.id,
          product_id: v.product_id,
          product_name: product?.product_name || '',
          product_code: product?.product_code || '',
          variant_name: v.variant_name,
          attributes: v.attributes || {},
          barcode: v.barcode,
          manufacturer_sku: v.manufacturer_sku,
          base_cost: v.base_cost || 0,
          suggested_retail_price: v.suggested_retail_price || 0,
          is_default: v.is_default || false,
          manufacturer_id: product?.manufacturer_id
        }
      }) || []
      
      console.log('✅ Formatted variants:', formattedVariants)
      
      setAvailableVariants(formattedVariants)
      
      if (formattedVariants.length === 0) {
        const errorMessages = {
          'H2M': 'This manufacturer has no active product variants. Please select a different manufacturer.',
          'S2D': 'No active product variants available. Please contact your administrator to ensure products are properly configured.',
          'D2H': 'No active product variants available from HQ. Please contact your administrator.'
        }
        
        toast({
          title: 'No Products',
          description: errorMessages[orderType as keyof typeof errorMessages] || 'No active product variants available.',
          variant: 'destructive'
        })
      }
    } catch (error) {
      console.error('Error loading product variants:', error)
      toast({
        title: 'Error',
        description: 'Failed to load product variants',
        variant: 'destructive'
      })
    }
  }

  const handleBack = () => {
    if (onViewChange) {
      onViewChange('orders')
    }
  }

  const handleSaveAsDraft = async () => {
    await saveOrder('draft')
  }

  const handleCreateOrder = async () => {
    await saveOrder('submitted')
  }

  const handleAddProduct = async () => {
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

    // Check if variant already added
    if (orderItems.find(item => item.variant_id === selectedVariantId)) {
      toast({
        title: 'Product Already Added',
        description: 'This product variant is already in the order',
        variant: 'destructive'
      })
      return
    }

    // For H2M orders: Auto-detect and validate manufacturer
    if (orderType === 'H2M') {
      if (!variant.manufacturer_id) {
        toast({
          title: 'Invalid Product',
          description: 'This product has no manufacturer assigned',
          variant: 'destructive'
        })
        return
      }

      // Check if this is the first product or if manufacturer matches
      if (orderItems.length > 0) {
        const firstVariant = availableVariants.find(v => v.id === orderItems[0].variant_id)
        if (firstVariant && firstVariant.manufacturer_id !== variant.manufacturer_id) {
          toast({
            title: 'Mixed Manufacturers',
            description: 'All products in an order must be from the same manufacturer',
            variant: 'destructive'
          })
          return
        }
      }

      // Auto-set seller if not already set
      if (!sellerOrg && variant.manufacturer_id) {
        try {
          const { data: manufacturer, error } = await supabase
            .from('organizations')
            .select('id, org_name, org_code, org_type_code')
            .eq('id', variant.manufacturer_id)
            .single()

          if (error) throw error
          
          if (manufacturer) {
            setSellerOrg(manufacturer)
            setSelectedSellerOrgId(manufacturer.id)
            // Silently set manufacturer - no notification needed
          }
        } catch (error) {
          console.error('Error fetching manufacturer:', error)
        }
      }
    }

    // Add product variant with default quantity based on unitsPerCase
    const newItem: OrderItem = {
      id: `temp-${Date.now()}`,
      order_id: '',
      product_id: variant.product_id,
      variant_id: variant.id,
      product_name: variant.product_name,
      variant_name: variant.variant_name,
      attributes: variant.attributes,
      manufacturer_sku: variant.manufacturer_sku,
      qty: unitsPerCase,
      unit_price: variant.base_cost,
      line_total: unitsPerCase * variant.base_cost,
      units_per_case: useIndividualCases ? unitsPerCase : undefined  // Set individual case size if mode enabled
    }

    setOrderItems([...orderItems, newItem])
    setSelectedVariantId('')
    
    toast({
      title: 'Product Added',
      description: `${variant.product_name} - ${variant.variant_name} has been added to the order`,
    })
  }

  const handleRemoveProduct = (variantId: string) => {
    setOrderItems(orderItems.filter(item => item.variant_id !== variantId))
    toast({
      title: 'Product Removed',
      description: 'Product has been removed from the order',
    })
  }

  const handleUpdateQuantity = (variantId: string, qty: number) => {
    // Available units per case options
    const availableUnitsPerCase = [50, 100, 200]
    
    // Check if quantity is divisible by current units per case
    if (qty > 0 && qty % unitsPerCase !== 0) {
      // Check if quantity itself could be a valid units per case
      if (availableUnitsPerCase.includes(qty)) {
        // Automatically adjust units per case to match the quantity
        setUnitsPerCase(qty)
        toast({
          title: 'Units Per Case Adjusted',
          description: `Units per case automatically changed to ${qty} to match your quantity.`,
        })
      } else {
        // Quantity doesn't match any standard case size
        // Find if it's a multiple of any available units per case
        const validOption = availableUnitsPerCase.find(units => qty % units === 0)
        
        if (validOption) {
          // It's a valid multiple - suggest or auto-adjust
          toast({
            title: 'Quantity Accepted',
            description: `Quantity ${qty} is valid (${qty / validOption} cases of ${validOption} units each).`,
          })
        }
        // If not divisible by any option, we'll show validation error in UI
      }
    }
    
    setOrderItems(orderItems.map(item => 
      item.variant_id === variantId 
        ? { ...item, qty, line_total: qty * item.unit_price } 
        : item
    ))
  }

  const handleUpdatePrice = (variantId: string, price: number) => {
    setOrderItems(orderItems.map(item => 
      item.variant_id === variantId 
        ? { ...item, unit_price: price, line_total: item.qty * price } 
        : item
    ))
  }

  const handleUpdateIndividualUnitsPerCase = (variantId: string, units: number) => {
    setOrderItems(orderItems.map(item => 
      item.variant_id === variantId 
        ? { ...item, units_per_case: units } 
        : item
    ))
  }

  const handleUnitsPerCaseChange = (newUnitsPerCase: number) => {
    setUnitsPerCase(newUnitsPerCase)
    // Update all existing order items to have at least the new minimum quantity
    if (orderItems.length > 0) {
      setOrderItems(orderItems.map(item => {
        const newQty = Math.max(item.qty, newUnitsPerCase)
        return {
          ...item,
          qty: newQty,
          line_total: newQty * item.unit_price
        }
      }))
    }
  }

  const loadExistingOrder = async (orderId: string) => {
    try {
      // Load order data with organizations
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single()

      if (orderError) {
        console.error('Error loading order:', orderError)
        throw orderError
      }
      if (!orderData) throw new Error('Order not found')

      console.log('📝 Loading order for edit:', orderData)

      // Load buyer organization
      const { data: buyerOrg } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orderData.buyer_org_id)
        .single()

      // Load seller organization if exists
      let sellerOrg = null
      if (orderData.seller_org_id) {
        const { data } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', orderData.seller_org_id)
          .single()
        sellerOrg = data
      }

      // Load order items
      const { data: orderItems, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId)

      if (itemsError) {
        console.error('Error loading order items:', itemsError)
        throw itemsError
      }

      console.log('📦 Loaded order items:', orderItems)

      // Load product details for each order item
      const itemsWithDetails = await Promise.all(
        (orderItems || []).map(async (item: any) => {
          // Load product
          const { data: product } = await supabase
            .from('products')
            .select('product_name, product_code')
            .eq('id', item.product_id)
            .single()

          // Load product variant
          const { data: variant } = await supabase
            .from('product_variants')
            .select('variant_name, attributes, manufacturer_sku')
            .eq('id', item.variant_id)
            .single()

          return {
            ...item,
            products: product,
            product_variants: variant
          }
        })
      )

      console.log('📦 Order items with details:', itemsWithDetails)
      console.log('📋 Order data for customer info:', {
        customer_name: orderData.customer_name,
        phone_number: orderData.phone_number,
        delivery_address: orderData.delivery_address,
        notes: orderData.notes
      })

      // Set order type
      setOrderType(orderData.order_type)

      // Set buyer and seller organizations
      if (buyerOrg) {
        setBuyerOrg(buyerOrg)
      }
      if (sellerOrg) {
        setSellerOrg(sellerOrg)
        setSelectedSellerOrgId(orderData.seller_org_id)
      }

      // Set customer information
      // If customer info fields are empty, try to extract from notes field
      if (!orderData.customer_name && !orderData.phone_number && !orderData.delivery_address && orderData.notes) {
        // Parse notes field (format: "Customer: Name, Phone: Number, Address: Address")
        const notesText = orderData.notes
        const customerMatch = notesText.match(/Customer:\s*([^,]+)/)
        const phoneMatch = notesText.match(/Phone:\s*([^,]+)/)
        const addressMatch = notesText.match(/Address:\s*(.+)/)
        
        setCustomerName(customerMatch ? customerMatch[1].trim() : '')
        setPhoneNumber(phoneMatch ? phoneMatch[1].trim() : '')
        setDeliveryAddress(addressMatch ? addressMatch[1].trim() : '')
      } else {
        setCustomerName(orderData.customer_name || '')
        setPhoneNumber(orderData.phone_number || '')
        setDeliveryAddress(orderData.delivery_address || '')
      }

      // Set order configuration
      setUnitsPerCase(orderData.units_per_case || 100)
      setQrBuffer(orderData.qr_buffer_percent || 10)
      setEnableRFID(orderData.rfid_enabled || false)
      setHasPoints(orderData.has_points !== false)
      setEnableLuckyDraw(orderData.enable_lucky_draw !== false)
      setEnableRedeem(orderData.enable_redeem !== false)
      setNotes(orderData.notes || '')

      // Check if order uses individual case sizes
      const hasIndividualCases = itemsWithDetails?.some((item: any) => item.units_per_case != null)
      setUseIndividualCases(hasIndividualCases)

      // Map order items to the correct format
      const items: OrderItem[] = (itemsWithDetails || []).map((item: any) => ({
        id: item.id,
        order_id: orderId,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: item.products?.product_name || 'Unknown Product',
        variant_name: item.product_variants?.variant_name || 'Default',
        attributes: item.product_variants?.attributes,
        manufacturer_sku: item.product_variants?.manufacturer_sku,
        qty: item.qty,
        unit_price: item.unit_price,
        line_total: item.line_total,
        units_per_case: item.units_per_case
      }))

      setOrderItems(items)

      // Load available products for the seller
      if (orderData.seller_org_id) {
        await loadAvailableProducts(orderData.seller_org_id)
      }

      toast({
        title: 'Order Loaded',
        description: `Editing order ${orderData.order_no}`,
      })

    } catch (error) {
      console.error('Error loading order:', error)
      toast({
        title: 'Error',
        description: 'Failed to load order for editing',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const loadCopiedOrder = async (orderData: any) => {
    try {
      console.log('📋 Loading copied order:', orderData)

      // Set order type
      setOrderType(orderData.order_type)

      // Load buyer organization
      const { data: buyerOrg } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orderData.buyer_org_id)
        .single()

      // Load seller organization if exists
      let sellerOrg = null
      if (orderData.seller_org_id) {
        const { data } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', orderData.seller_org_id)
          .single()
        sellerOrg = data
      }

      // Set buyer and seller organizations
      if (buyerOrg) {
        setBuyerOrg(buyerOrg)
      }
      if (sellerOrg) {
        setSellerOrg(sellerOrg)
        setSelectedSellerOrgId(orderData.seller_org_id)
      }

      // Set customer information from copied order
      if (!orderData.customer_name && !orderData.phone_number && !orderData.delivery_address && orderData.notes) {
        // Parse notes field (format: "Customer: Name, Phone: Number, Address: Address")
        const notesText = orderData.notes
        const customerMatch = notesText.match(/Customer:\s*([^,]+)/)
        const phoneMatch = notesText.match(/Phone:\s*([^,]+)/)
        const addressMatch = notesText.match(/Address:\s*(.+)/)
        
        setCustomerName(customerMatch ? customerMatch[1].trim() : '')
        setPhoneNumber(phoneMatch ? phoneMatch[1].trim() : '')
        setDeliveryAddress(addressMatch ? addressMatch[1].trim() : '')
      } else {
        setCustomerName(orderData.customer_name || '')
        setPhoneNumber(orderData.phone_number || '')
        setDeliveryAddress(orderData.delivery_address || '')
      }

      // Set order configuration from copied order
      setUnitsPerCase(orderData.units_per_case || 100)
      setQrBuffer(orderData.qr_buffer_percent || 10)
      setEnableRFID(orderData.rfid_enabled || false)
      setHasPoints(orderData.has_points !== false)
      setEnableLuckyDraw(orderData.enable_lucky_draw !== false)
      setEnableRedeem(orderData.enable_redeem !== false)
      setNotes(orderData.notes || '')

      // Check if order uses individual case sizes
      const hasIndividualCases = orderData.order_items?.some((item: any) => item.units_per_case != null)
      setUseIndividualCases(hasIndividualCases)

      // Map order items to the correct format (without IDs since this is a new order)
      const items: OrderItem[] = (orderData.order_items || []).map((item: any) => ({
        // Don't include id or order_id for copied items
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: item.product?.product_name || 'Unknown Product',
        variant_name: item.product_variants?.variant_name || item.variant_name || 'Default',
        attributes: item.product_variants?.attributes || item.attributes,
        manufacturer_sku: item.product_variants?.manufacturer_sku || item.manufacturer_sku,
        qty: item.qty,
        unit_price: item.unit_price,
        line_total: item.qty * item.unit_price,
        units_per_case: item.units_per_case
      }))

      setOrderItems(items)

      // Load available products for the seller
      if (orderData.seller_org_id) {
        await loadAvailableProducts(orderData.seller_org_id)
      }

      toast({
        title: 'Order Copied',
        description: `Order copied successfully. Update details and submit as a new order.`,
        duration: 4000,
      })

    } catch (error) {
      console.error('Error loading copied order:', error)
      toast({
        title: 'Error',
        description: 'Failed to load copied order',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  // Smart packing logic: Calculate how products can be packed into cases
  const calculatePackingPlan = () => {
    const plan = orderItems.map(item => {
      const itemUnitsPerCase = item.units_per_case || unitsPerCase
      const fullCases = Math.floor(item.qty / itemUnitsPerCase)
      const remainder = item.qty % itemUnitsPerCase
      
      return {
        variantId: item.variant_id,
        productName: item.product_name,
        variantName: item.variant_name,
        qty: item.qty,
        unitsPerCase: itemUnitsPerCase,
        fullCases,
        remainder
      }
    })

    // Get all products with remainders
    const productsWithRemainders = plan.filter(p => p.remainder > 0)
    
    // Calculate if remainders can be paired into complete cases
    const totalRemainder = productsWithRemainders.reduce((sum, p) => sum + p.remainder, 0)
    const canFormMixedCases = productsWithRemainders.length >= 2
    
    // Use the same case size from the products for mixed cases
    // Pick the first product's case size as the standard for mixed cases
    let suggestedMixedCaseSize = 0
    let mixedCasesNeeded = 0
    
    if (canFormMixedCases && totalRemainder > 0) {
      // Use the case size from the first product with remainder
      suggestedMixedCaseSize = productsWithRemainders[0].unitsPerCase
      // Calculate how many mixed cases are needed
      mixedCasesNeeded = Math.ceil(totalRemainder / suggestedMixedCaseSize)
    }

    return {
      plan,
      productsWithRemainders,
      canFormMixedCases,
      totalRemainder,
      suggestedMixedCaseSize,
      mixedCasesNeeded,
      hasIssue: productsWithRemainders.length === 1 // Issue if only one product has remainder
    }
  }

  const saveOrder = async (status: 'draft' | 'submitted') => {
    try {
      // Validation
      if (!sellerOrg) {
        toast({
          title: 'Validation Error',
          description: 'Please select a seller organization',
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

      // Smart packing validation when using individual case sizes
      if (useIndividualCases) {
        const packingPlan = calculatePackingPlan()
        
        if (packingPlan.hasIssue) {
          const problem = packingPlan.productsWithRemainders[0]
          toast({
            title: '⚠️ Incomplete Case Packing',
            description: `${problem.productName} has ${problem.remainder} units left over from ${problem.qty} units. Cannot pack into ${problem.unitsPerCase}/case. Add another product with a remainder to create a mixed case, or adjust the quantity to a multiple of ${problem.unitsPerCase}.`,
            variant: 'destructive',
            duration: 8000
          })
          return
        }
        
        if (packingPlan.canFormMixedCases && packingPlan.totalRemainder > 0) {
          // Show info about mixed cases that will be created
          const remainderProducts = packingPlan.productsWithRemainders
            .map(p => `${p.productName}: ${p.remainder} units`)
            .join(', ')
          
          toast({
            title: '✅ Mixed Cases Will Be Created',
            description: `${packingPlan.mixedCasesNeeded} mixed case(s) will contain remainders: ${remainderProducts}`,
            duration: 6000
          })
        }
      }

      if (orderItems.length === 0) {
        toast({
          title: 'Validation Error',
          description: 'Please add at least one product to the order',
          variant: 'destructive'
        })
        return
      }

      setSaving(true)

      // Get company_id (root HQ)
      const { data: companyData } = await supabase
        .rpc('get_company_id', { p_org_id: userProfile.organization_id })

      const companyId = companyData || userProfile.organization_id

      // For H2M orders: Get the HQ's default warehouse
      let warehouseOrgId: string | null = null
      if (orderType === 'H2M' && buyerOrg) {
        const { data: hqData, error: hqError } = await supabase
          .from('organizations')
          .select('default_warehouse_org_id')
          .eq('id', buyerOrg.id)
          .single()

        if (hqError) {
          console.error('Error fetching HQ default warehouse:', hqError)
          toast({
            title: 'Error',
            description: 'Failed to determine destination warehouse',
            variant: 'destructive'
          })
          setSaving(false)
          return
        }

        if (!hqData?.default_warehouse_org_id) {
          toast({
            title: 'No Default Warehouse',
            description: 'Please set a default warehouse for your HQ before creating orders.',
            variant: 'destructive'
          })
          setSaving(false)
          return
        }

        warehouseOrgId = hqData.default_warehouse_org_id
      }

      // Generate order number (format: ORD-YYYYMMDD-RANDOM)
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase()
      const generatedOrderNo = `${orderType}-${dateStr}-${randomSuffix}`

      // STEP 1: Always create order in 'draft' status first (required by RLS policy)
      const orderData = {
        order_type: orderType,
        order_no: generatedOrderNo,
        company_id: companyId,
        buyer_org_id: buyerOrg!.id,
        seller_org_id: sellerOrg.id,
        warehouse_org_id: warehouseOrgId, // Set warehouse for H2M orders
        status: 'draft' as const, // ← Always draft first! RLS policy requires this
        units_per_case: unitsPerCase,
        qr_buffer_percent: qrBuffer,
        has_rfid: enableRFID,
        has_points: hasPoints,
        has_lucky_draw: enableLuckyDraw,
        has_redeem: enableRedeem,
        notes: notes || `Customer: ${customerName}, Phone: ${phoneNumber}, Address: ${deliveryAddress}`,
        created_by: userProfile.id
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single()

      if (orderError) throw orderError

      // STEP 2: Insert order items (now passes RLS check because order is 'draft')
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

      // STEP 3: If requested status was 'submitted', update the order
      if (status === 'submitted') {
        const { error: updateError } = await supabase
          .from('orders')
          .update({ status: 'submitted' })
          .eq('id', order.id)

        if (updateError) {
          console.error('Error updating order status:', updateError)
          throw new Error(`Failed to submit order: ${updateError.message}`)
        }
      }

      toast({
        title: 'Success',
        description: `Order ${status === 'draft' ? 'saved as draft' : 'created and submitted'} successfully`,
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
    const tax = subtotal * 0.0 // Adjust tax rate as needed
    const total = subtotal + tax
    
    // Calculate total cases based on individual or global units per case
    const totalCases = useIndividualCases
      ? orderItems.reduce((sum, item) => sum + Math.ceil(item.qty / (item.units_per_case || unitsPerCase)), 0)
      : Math.ceil(orderItems.reduce((sum, item) => sum + item.qty, 0) / unitsPerCase)
    
    const masterQR = totalCases
    // Calculate unique QR per item with buffer, then sum them up (matches Product Selection logic)
    const uniqueQR = orderItems.reduce((sum, item) => sum + Math.round(item.qty + (item.qty * qrBuffer / 100)), 0)
    
    return { subtotal, tax, total, totalCases, masterQR, uniqueQR }
  }

  const totals = calculateTotals()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
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
        <h2 className="text-2xl font-bold text-gray-900">Create New Order</h2>
        <p className="text-gray-600 text-sm mt-1">Fill in the details to create a new order</p>
      </div>

      {/* Main Layout - Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Auto-determined Seller Info - Show for D2H */}
          {orderType === 'D2H' && sellerOrg && (
            <Card>
              <CardHeader className="border-b bg-gray-50">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Package className="w-4 h-4" />
                  Seller Organization
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Package className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{sellerOrg.org_name}</h4>
                      <p className="text-sm text-gray-600">{sellerOrg.org_code}</p>
                      <p className="text-xs text-blue-600 mt-1">
                        ✓ Auto-selected: Your Headquarters
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Distributors automatically order from their parent HQ organization
                </p>
              </CardContent>
            </Card>
          )}

          {/* Seller Selection - Show for S2D if multiple distributors */}
          {orderType === 'S2D' && showDistributorSelector && (
            <Card>
              <CardHeader className="border-b bg-gray-50">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Package className="w-4 h-4" />
                  Seller Organization
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Distributor <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedSellerOrgId}
                    onChange={(e) => handleDistributorChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Choose distributor...</option>
                    {availableDistributors.map(dist => (
                      <option key={dist.id} value={dist.id}>
                        {dist.org_name} ({dist.org_code}) {dist.is_preferred && '★ Preferred'}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Select the distributor you want to order from
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Auto-determined Seller Info - Show for S2D with single/preferred distributor */}
          {orderType === 'S2D' && !showDistributorSelector && sellerOrg && (
            <Card>
              <CardHeader className="border-b bg-gray-50">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Package className="w-4 h-4" />
                  Seller Organization
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Package className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{sellerOrg.org_name}</h4>
                      <p className="text-sm text-gray-600">{sellerOrg.org_code}</p>
                      <p className="text-xs text-blue-600 mt-1">
                        ✓ Auto-selected: Your Distributor
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Shops automatically order from their linked distributor organization
                </p>
              </CardContent>
            </Card>
          )}

          {/* Customer Information */}
          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <User className="w-4 h-4" />
                Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Customer Name <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Enter customer name"
                    className="bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <Input
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="Enter phone number"
                    className="bg-gray-50"
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
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                  placeholder="Enter delivery address"
                />
              </div>
            </CardContent>
          </Card>

          {/* Order Configuration */}
          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Package className="w-4 h-4" />
                Order Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {/* Case Size Configuration Mode Toggle */}
              <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <label className="block text-sm font-medium text-gray-900 mb-3">
                  Case Size Configuration
                </label>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="caseMode"
                      checked={!useIndividualCases}
                      onChange={() => {
                        setUseIndividualCases(false)
                        // Reset individual case sizes when switching to global mode
                        setOrderItems(orderItems.map(item => ({ ...item, units_per_case: undefined })))
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">Same units per case for all products</span>
                      <p className="text-xs text-gray-500 mt-1">All products will use the same case size (recommended for standard orders)</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="caseMode"
                      checked={useIndividualCases}
                      onChange={() => {
                        setUseIndividualCases(true)
                        // Set default individual case sizes when switching to individual mode
                        setOrderItems(orderItems.map(item => ({ ...item, units_per_case: item.units_per_case || unitsPerCase })))
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">Individual units per case for each product</span>
                      <p className="text-xs text-gray-500 mt-1">Set different case sizes for each product variant (flexible for mixed orders)</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {useIndividualCases ? 'Default Units per Case' : 'Units per Case'}
                  </label>
                  <select
                    value={unitsPerCase}
                    onChange={(e) => handleUnitsPerCaseChange(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                    disabled={useIndividualCases}
                  >
                    <option value="100">100 units per case</option>
                    <option value="200">200 units per case</option>
                    <option value="50">50 units per case</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {useIndividualCases ? 'Default value for new products' : 'This setting applies to all products in this order'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    QR Buffer (%)
                  </label>
                  <Input
                    type="number"
                    value={qrBuffer}
                    onChange={(e) => setQrBuffer(parseFloat(e.target.value))}
                    className="bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">Additional QR codes for manufacturing (default 10%)</p>
                </div>
              </div>
              
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <input
                  type="checkbox"
                  id="rfid"
                  checked={enableRFID}
                  onChange={(e) => setEnableRFID(e.target.checked)}
                  className="mt-0.5"
                />
                <label htmlFor="rfid" className="flex-1">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-gray-900">This order supports RFID</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">RFID tags will equal the total number of Master QR codes to print</p>
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Product Selection - Always show, but enable/disable based on availability */}
          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="text-base font-semibold">Product Selection</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {/* Search and Filter */}
              <div className="space-y-3 mb-4">
                {/* Product Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Filter by Product
                  </label>
                  <select
                    value={selectedProductFilter}
                    onChange={(e) => {
                      setSelectedProductFilter(e.target.value)
                      setSelectedVariantId('') // Reset variant selection
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    disabled={availableVariants.length === 0}
                  >
                    <option value="">All Products ({Array.from(new Set(availableVariants.map(v => v.product_name))).length})</option>
                    {Array.from(new Set(availableVariants.map(v => v.product_name))).sort().map(productName => {
                      const variantsCount = availableVariants.filter(v => v.product_name === productName && !orderItems.find(item => item.variant_id === v.id)).length
                      return (
                        <option key={productName} value={productName}>
                          {productName} ({variantsCount} variant{variantsCount !== 1 ? 's' : ''})
                        </option>
                      )
                    })}
                  </select>
                </div>

                {/* Search */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Search Variant
                  </label>
                  <Input
                    type="text"
                    placeholder="Search by variant name or attributes..."
                    value={productSearchQuery}
                    onChange={(e) => setProductSearchQuery(e.target.value)}
                    className="w-full"
                    disabled={availableVariants.length === 0}
                  />
                </div>

                {/* Variant Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Variant
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={selectedVariantId}
                      onChange={(e) => setSelectedVariantId(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white max-h-[200px]"
                      disabled={availableVariants.length === 0}
                      size={Math.min(8, Math.max(3, availableVariants.filter(v => {
                        const alreadyAdded = orderItems.find(item => item.variant_id === v.id)
                        if (alreadyAdded) return false
                        
                        const matchesProduct = !selectedProductFilter || v.product_name === selectedProductFilter
                        const searchLower = productSearchQuery.toLowerCase()
                        const matchesSearch = !productSearchQuery || 
                          v.variant_name.toLowerCase().includes(searchLower) ||
                          v.product_name.toLowerCase().includes(searchLower) ||
                          (v.attributes?.strength && String(v.attributes.strength).toLowerCase().includes(searchLower)) ||
                          (v.attributes?.nicotine && String(v.attributes.nicotine).toLowerCase().includes(searchLower))
                        
                        return matchesProduct && matchesSearch
                      }).length))}
                    >
                      <option value="">
                        {(() => {
                          const filteredVariants = availableVariants.filter(v => {
                            const alreadyAdded = orderItems.find(item => item.variant_id === v.id)
                            if (alreadyAdded) return false
                            
                            const matchesProduct = !selectedProductFilter || v.product_name === selectedProductFilter
                            const searchLower = productSearchQuery.toLowerCase()
                            const matchesSearch = !productSearchQuery || 
                              v.variant_name.toLowerCase().includes(searchLower) ||
                              v.product_name.toLowerCase().includes(searchLower) ||
                              (v.attributes?.strength && String(v.attributes.strength).toLowerCase().includes(searchLower)) ||
                              (v.attributes?.nicotine && String(v.attributes.nicotine).toLowerCase().includes(searchLower))
                            
                            return matchesProduct && matchesSearch
                          })
                          return filteredVariants.length === 0 ? 'No variants available' : `Select a variant (${filteredVariants.length} available)`
                        })()}
                      </option>
                      {availableVariants
                        .filter(variant => {
                          const alreadyAdded = orderItems.find(item => item.variant_id === variant.id)
                          if (alreadyAdded) return false
                          
                          const matchesProduct = !selectedProductFilter || variant.product_name === selectedProductFilter
                          const searchLower = productSearchQuery.toLowerCase()
                          const matchesSearch = !productSearchQuery || 
                            variant.variant_name.toLowerCase().includes(searchLower) ||
                            variant.product_name.toLowerCase().includes(searchLower) ||
                            (variant.attributes?.strength && String(variant.attributes.strength).toLowerCase().includes(searchLower)) ||
                            (variant.attributes?.nicotine && String(variant.attributes.nicotine).toLowerCase().includes(searchLower))
                          
                          return matchesProduct && matchesSearch
                        })
                        .sort((a, b) => a.product_name.localeCompare(b.product_name) || a.variant_name.localeCompare(b.variant_name))
                        .map(variant => {
                          const attrText = variant.attributes?.strength || variant.attributes?.nicotine || ''
                          return (
                            <option key={variant.id} value={variant.id}>
                              {!selectedProductFilter ? `${variant.product_name} - ` : ''}{variant.variant_name} {attrText ? `(${attrText})` : ''} - RM {formatCurrency(variant.base_cost)}
                            </option>
                          )
                        })}
                    </select>
                    <Button 
                      variant="outline" 
                      className="bg-blue-600 text-white hover:bg-blue-700 shrink-0"
                      onClick={handleAddProduct}
                      disabled={!selectedVariantId}
                    >
                      Add Product
                    </Button>
                  </div>
                </div>

                {availableVariants.length === 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    {orderType === 'H2M' 
                      ? 'No active products available. Products will be filtered by manufacturer once added.' 
                      : 'No active products available. Please contact your administrator.'}
                  </p>
                )}
              </div>
                
                {/* Product List */}
                {orderItems.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    <p className="text-gray-500 text-sm">No products selected. Add products to create your order.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orderItems.map((item) => (
                      <div key={item.variant_id} className="border border-gray-200 rounded-lg p-4 bg-white">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900">{item.product_name}</h4>
                            <p className="text-sm text-gray-600 mt-1">{item.variant_name} • {item.attributes?.strength || item.attributes?.nicotine || ''}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              RM {formatCurrency(item.unit_price)} per unit
                              {item.manufacturer_sku && ` • SKU: ${item.manufacturer_sku}`}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveProduct(item.variant_id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 p-2"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {useIndividualCases && (
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">
                                Units per Case
                              </label>
                              <select
                                value={item.units_per_case || unitsPerCase}
                                onChange={(e) => handleUpdateIndividualUnitsPerCase(item.variant_id, parseInt(e.target.value))}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="50">50</option>
                                <option value="100">100</option>
                                <option value="200">200</option>
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Quantity
                            </label>
                            <Input
                              type="number"
                              value={item.qty}
                              onChange={(e) => handleUpdateQuantity(item.variant_id, parseInt(e.target.value) || 0)}
                              min="1"
                              className="text-sm"
                            />
                            {useIndividualCases && item.qty > 0 && item.qty % (item.units_per_case || unitsPerCase) !== 0 && (() => {
                              const itemUnitsPerCase = item.units_per_case || unitsPerCase
                              const fullCases = Math.floor(item.qty / itemUnitsPerCase)
                              const remainder = item.qty % itemUnitsPerCase
                              return (
                                <p className="text-xs text-amber-600 mt-1">
                                  {fullCases} full case(s) + {remainder} units remainder
                                </p>
                              )
                            })()}
                            {!useIndividualCases && item.qty > 0 && item.qty % (item.units_per_case || unitsPerCase) !== 0 && item.qty !== 50 && item.qty !== 100 && item.qty !== 200 && (
                              <p className="text-xs text-red-600 mt-1">
                                Please enter multiples of {item.units_per_case || unitsPerCase}
                              </p>
                            )}
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
                        </div>
                        
                        {/* Auto-calculated summary */}
                        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500 block">Cases:</span>
                            {useIndividualCases && item.qty % (item.units_per_case || unitsPerCase) !== 0 ? (
                              <>
                                <span className="font-semibold">
                                  {Math.floor(item.qty / (item.units_per_case || unitsPerCase))} full + 
                                  {item.qty % (item.units_per_case || unitsPerCase)} units
                                </span>
                                {useIndividualCases && (
                                  <span className="text-xs text-amber-600 block mt-0.5">⚠ Will mix with other remainders</span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="font-semibold">{Math.ceil(item.qty / (item.units_per_case || unitsPerCase))} cases</span>
                                {useIndividualCases && (
                                  <span className="text-xs text-blue-600 block mt-0.5">({item.units_per_case || unitsPerCase}/case)</span>
                                )}
                              </>
                            )}
                          </div>
                          <div>
                            <span className="text-gray-500 block">Unique Units (with {qrBuffer}% buffer):</span>
                            <span className="font-semibold">{Math.round(item.qty + (item.qty * qrBuffer / 100))} units</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">Line Total:</span>
                            <span className="font-semibold text-blue-600">RM {formatCurrency(item.line_total || (item.qty * item.unit_price))}</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">QR Codes:</span>
                            <span className="font-semibold">{Math.ceil(item.qty / (item.units_per_case || unitsPerCase))} master + {Math.round(item.qty + (item.qty * qrBuffer / 100))} unique</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

          {/* Packing Plan Summary - Show when using individual cases with remainders */}
          {useIndividualCases && orderItems.length > 0 && (() => {
            const packingPlan = calculatePackingPlan()
            if (packingPlan.productsWithRemainders.length === 0) return null
            
            return (
              <Card className={packingPlan.hasIssue ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}>
                <CardHeader className="border-b bg-white">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Package className="w-4 h-4" />
                    {packingPlan.hasIssue ? '⚠️ Packing Issue Detected' : '📦 Smart Packing Plan'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {packingPlan.hasIssue ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-red-800">
                        Cannot pack incomplete cases with only one product having a remainder.
                      </p>
                      <div className="bg-white rounded-lg p-3 border border-red-200">
                        {packingPlan.productsWithRemainders.map(p => (
                          <div key={p.variantId} className="text-sm">
                            <span className="font-semibold">{p.productName}</span>: {p.qty} units
                            <br />
                            <span className="text-red-700">
                              → {p.fullCases} full cases ({p.fullCases * p.unitsPerCase} units) + <strong>{p.remainder} units remainder</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-red-700">
                        <strong>Solutions:</strong><br />
                        • Add another product with a remainder to create mixed cases<br />
                        • Adjust quantity to {packingPlan.productsWithRemainders[0].fullCases * packingPlan.productsWithRemainders[0].unitsPerCase} or {(packingPlan.productsWithRemainders[0].fullCases + 1) * packingPlan.productsWithRemainders[0].unitsPerCase} units<br />
                        • Change units per case to match your quantity
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-amber-800">
                        ✓ Remainders from multiple products will be mixed into {packingPlan.mixedCasesNeeded} case(s)
                      </p>
                      <div className="bg-white rounded-lg p-3 border border-amber-200 space-y-2">
                        <div className="text-sm font-semibold text-gray-700">Full Cases:</div>
                        {packingPlan.plan.filter(p => p.fullCases > 0).map(p => (
                          <div key={p.variantId} className="text-sm pl-3">
                            • {p.fullCases} case(s) of {p.productName} - {p.variantName} ({p.unitsPerCase}/case)
                          </div>
                        ))}
                        
                        {packingPlan.productsWithRemainders.length > 0 && (
                          <>
                            <div className="text-sm font-semibold text-amber-700 mt-3">Mixed Case(s):</div>
                            <div className="text-sm pl-3 text-amber-700">
                              • {packingPlan.mixedCasesNeeded} case(s) containing:
                              {packingPlan.productsWithRemainders.map(p => (
                                <div key={p.variantId} className="pl-4">
                                  - {p.productName} - {p.variantName}: {p.remainder} units
                                </div>
                              ))}
                              <div className="mt-1 font-medium">
                                Total: {packingPlan.totalRemainder} units in {packingPlan.suggestedMixedCaseSize}/case format
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-amber-700">
                        Mixed cases will be labeled clearly for warehouse and manufacturing.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })()}

          {/* Lucky Draw & Redeem */}
          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <CheckSquare className="w-4 h-4" />
                Lucky Draw & Redeem
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableLuckyDraw}
                    onChange={(e) => setEnableLuckyDraw(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Enable Lucky Draw</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableRedeem}
                    onChange={(e) => setEnableRedeem(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Enable Redeem</span>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Order Summary */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Package className="w-4 h-4" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {/* Customer Info */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Customer</h4>
                <div className="text-sm space-y-1">
                  <p><span className="font-medium">Name:</span> {customerName}</p>
                  <p><span className="font-medium">Phone:</span> {phoneNumber}</p>
                  <p className="flex items-start gap-1">
                    <span className="font-medium">📍</span>
                    <span>{deliveryAddress}</span>
                  </p>
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
                          <span className="text-gray-700 font-medium">{item.product_name}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600">
                          <span>{item.variant_name}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>{item.qty} units • {Math.ceil(item.qty / (item.units_per_case || unitsPerCase))} cases</span>
                          <span className="font-medium text-gray-700">
                            RM {formatCurrency(item.line_total || (item.qty * item.unit_price))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Calculations */}
              <div className="space-y-2 mb-6 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Cases:</span>
                  <span className="font-medium">{totals.totalCases}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Master QR:</span>
                  <span className="font-medium">{totals.masterQR}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Unique QR:</span>
                  <span className="font-medium">{totals.uniqueQR}</span>
                </div>
                {enableRFID && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">RFID Tags:</span>
                    <span className="font-medium">{totals.masterQR}</span>
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="border-t pt-4 space-y-2 mb-6">
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
                <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4" />
                  Order Actions
                </h4>
                {(!sellerOrg || !customerName || !deliveryAddress || orderItems.length === 0) && (
                  <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                    <strong>Required:</strong>
                    {!sellerOrg && ' Select seller organization.'}
                    {!customerName && ' Enter customer name.'}
                    {!deliveryAddress && ' Enter delivery address.'}
                    {orderItems.length === 0 && ' Add at least one product.'}
                  </div>
                )}
                <Button 
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleCreateOrder}
                  disabled={saving || !sellerOrg || !customerName || !deliveryAddress || orderItems.length === 0}
                >
                  {saving ? 'Creating...' : 'Create Order'}
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleSaveAsDraft}
                  disabled={saving || !sellerOrg || !customerName || !deliveryAddress || orderItems.length === 0}
                >
                  {saving ? 'Saving...' : 'Save as Draft'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
