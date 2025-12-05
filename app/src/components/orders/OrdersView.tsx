'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { formatNumber } from '@/lib/utils/formatters'
import { 
  FileText, 
  Plus, 
  Search, 
  Filter,
  Download,
  Eye,
  Edit,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Package,
  Building2,
  Calendar,
  DollarSign,
  Grid3x3,
  List,
  Trash2,
  ShoppingCart,
  Store,
  TrendingUp,
  Copy,
  User
} from 'lucide-react'
import type { Order, OrderStatus, OrderType, OrderSummary } from '@/types/order'

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

interface OrdersViewProps {
  userProfile: UserProfile
  onViewChange?: (view: string) => void
}

export default function OrdersView({ userProfile, onViewChange }: OrdersViewProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [summary, setSummary] = useState<OrderSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<OrderType | 'all'>('H2M')
  const [sellerFilter, setSellerFilter] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
  const [showOrderTypeDialog, setShowOrderTypeDialog] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  // Extract unique sellers from orders
  const uniqueSellers = orders.reduce((acc, order) => {
    const seller = order.seller_org
    if (seller && !acc.find(s => s.id === seller.id)) {
      acc.push(seller)
    }
    return acc
  }, [] as Array<{ id: string; org_name: string }>)

  // Filter orders based on all criteria
  const filteredOrders = orders.filter(order => {
    // Search filter
    const matchesSearch = order.order_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.notes?.toLowerCase().includes(searchQuery.toLowerCase())
    
    // Status filter
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter
    
    // Type filter
    const matchesType = typeFilter === 'all' || order.order_type === typeFilter
    
    // Seller filter
    const matchesSeller = !sellerFilter || order.seller_org_id === sellerFilter
    
    return matchesSearch && matchesStatus && matchesType && matchesSeller
  })

  const handleTrackOrder = (orderId: string) => {
    // Store order ID and navigate to track view
    if (onViewChange) {
      // You can use sessionStorage to pass the order ID
      sessionStorage.setItem('trackingOrderId', orderId)
      onViewChange('track-order')
    }
  }

  const handleDeleteOrder = async (orderId: string, orderNo: string) => {
    try {
      setLoading(true)

      // Step 1: Fetch comprehensive order details and all related records
      console.log('🔍 Fetching order details for:', orderNo)
      
      // Get order items count
      const { data: orderItems, error: itemsError } = await supabase
        .from('order_items')
        .select('id')
        .eq('order_id', orderId)
      
      // Get documents count
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('id, doc_type, doc_no')
        .eq('order_id', orderId)
      
      // Get QR batches count
      const { data: qrBatches, error: batchError } = await supabase
        .from('qr_batches')
        .select('id, status')
        .eq('order_id', orderId)
      
      // Get QR codes count (both master and regular)
      const { data: qrCodes, error: codesError } = await supabase
        .from('qr_codes')
        .select('id')
        .eq('order_id', orderId)
      
      const { data: masterCodes, error: masterError } = await supabase
        .from('qr_master_codes')
        .select('id')
        .eq('order_id', orderId)

      // Get Excel files from storage
      const { data: excelFiles, error: storageError } = await supabase
        .storage
        .from('order-excel')
        .list(`${orderId}/`)

      const itemsCount = orderItems?.length || 0
      const docsCount = documents?.length || 0
      const batchesCount = qrBatches?.length || 0
      const codesCount = (qrCodes?.length || 0) + (masterCodes?.length || 0)
      const excelCount = excelFiles?.length || 0

      // Step 2: Get count of scanned QR codes (if any)
      const { data: scannedQR } = await supabase
        .from('qr_codes')
        .select('id')
        .eq('order_id', orderId)
        .neq('status', 'pending')
      
      // Step 2b: Get count of stock movements (inventory history)
      const { count: stockMovementsCount } = await supabase
        .from('stock_movements')
        .select('id', { count: 'exact', head: true })
        .eq('reference_type', 'order')
        .eq('reference_id', orderId)
      
      const scannedCount = scannedQR?.length || 0
      const docsList = documents?.map(d => `${d.doc_type}: ${d.doc_no}`).join('\n  ') || 'None'

      // Step 3: Show confirmation dialog
      const confirmMessage = 
        `⚠️ DELETE ORDER ${orderNo}\n\n` +
        (scannedCount > 0 
          ? `⚠️ WARNING: This order has ${scannedCount} SCANNED QR code(s)!\n⚠️ Deleting scanned QR codes affects audit trails!\n\n`
          : '') +
        `This will PERMANENTLY delete:\n` +
        `• ${itemsCount} order item(s)\n` +
        `• ${docsCount} document(s):\n  ${docsList}\n` +
        `• ${batchesCount} QR batch(es)\n` +
        `• ${codesCount} QR code(s)${scannedCount > 0 ? ` (${scannedCount} scanned)` : ''}\n` +
        `• ${stockMovementsCount || 0} inventory movement record(s)\n` +
        `• ${excelCount} Excel file(s)\n\n` +
        `⚠️ This action CANNOT be undone!\n\n` +
        `Are you sure you want to delete this order?`

      // Show confirmation dialog
      const confirmed = window.confirm(confirmMessage)
      
      if (!confirmed) {
        toast({
          title: 'Delete Cancelled',
          description: 'Order deletion was cancelled.'
        })
        setLoading(false)
        return
      }

      console.log('✅ User confirmed deletion')

      // Call server-side API to delete order
      console.log('🗑️ Calling server API to delete order...')
      const response = await fetch('/api/orders/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orderId,
          forceDelete: true
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete order')
      }

      const result = await response.json()

      toast({
        title: '✅ Order Deleted Successfully',
        description: scannedCount > 0
          ? `Order ${orderNo} and ALL related records (including ${scannedCount} scanned QR codes) have been permanently deleted.`
          : `Order ${orderNo} and all related records have been permanently deleted.`,
      })

      // Reload orders
      await loadOrders()
      await loadSummary()
    } catch (error: any) {
      console.error('Error deleting order:', error)
      toast({
        title: '❌ Delete Failed',
        description: error.message || 'Failed to delete order. Please try again or contact support.',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleApproveOrder = async (orderId: string, orderNo: string) => {
    try {
      // 1. Check if current user has uploaded their digital signature
      const { data: currentUserData, error: userError } = await supabase
        .from('users')
        .select('signature_url, full_name')
        .eq('id', userProfile.id)
        .single()

      if (userError) throw userError

      if (!currentUserData.signature_url) {
        toast({
          title: 'Signature Required',
          description: 'You must upload your digital signature in My Profile before you can approve orders.',
          variant: 'destructive'
        })
        return
      }

      // 2. Check if user is trying to approve their own order
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('created_by')
        .eq('id', orderId)
        .single()

      if (orderError) throw orderError

      if (orderData.created_by === userProfile.id) {
        toast({
          title: 'Cannot Approve Own Order',
          description: 'You cannot approve an order that you created. Another HQ admin must approve this order.',
          variant: 'destructive'
        })
        return
      }

      // 3. Show confirmation dialog
      if (!confirm(`Approve order ${orderNo}?\n\nThis will:\n• Change status to "Approved"\n• Generate Purchase Order document\n• Allow production to begin\n\nThis action cannot be undone.`)) {
        return
      }

      setLoading(true)

      // Call the orders_approve database function
      const { data, error } = await supabase
        .rpc('orders_approve', { p_order_id: orderId })

      if (error) throw error

      // Inventory deduction is now handled by the orders_approve RPC for both D2H and S2D
      
      toast({
        title: 'Order Approved',
        description: `Order ${orderNo} has been approved successfully. PO document has been generated.`,
      })

      // Reload orders
      await loadOrders()
      await loadSummary()
    } catch (error: any) {
      console.error('Error approving order:', error)
      
      // User-friendly error messages
      let errorMessage = error.message || 'Failed to approve order'
      
      if (error.message?.includes('Order must be in submitted')) {
        errorMessage = 'Only submitted orders can be approved'
      } else if (error.message?.includes('User lacks permission')) {
        errorMessage = 'You do not have permission to approve this order type'
      } else if (error.message?.includes('Parent order must be approved')) {
        errorMessage = 'Parent order must be approved before approving this order'
      } else if (error.message?.includes('Order not found')) {
        errorMessage = 'Order not found'
      }

      toast({
        title: 'Approval Failed',
        description: errorMessage,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  // Helper function to check if user can approve orders
  const canApproveOrder = (order: Order): boolean => {
    // Must be submitted status
    if (order.status !== 'submitted') return false
    
    // Check role level (Power User or higher: role_level <= 20)
    const isPowerUser = userProfile.roles.role_level <= 20
    if (!isPowerUser) return false

    const userOrgType = userProfile.organizations.org_type_code

    // H2M: HQ Power Users can approve
    if (order.order_type === 'H2M' && userOrgType === 'HQ') return true

    // D2H: HQ Power Users or Seller (Warehouse) can approve
    if (order.order_type === 'D2H' && (userOrgType === 'HQ' || order.seller_org_id === userProfile.organization_id)) return true

    // S2D: Distributor (seller) Power Users can approve
    if (order.order_type === 'S2D' && order.seller_org_id === userProfile.organization_id) return true

    return false
  }

  // Helper function to check if user can delete orders (Super Admin only)
  const canDeleteOrder = (): boolean => {
    // Only Super Admin (role_level = 1) can delete orders
    return userProfile.roles.role_level === 1
  }

  // Helper function to check if user can edit orders
  const canEditOrder = (order: Order): boolean => {
    // Can only edit draft or submitted orders
    if (order.status !== 'draft' && order.status !== 'submitted') return false
    
    // User must be from the buyer organization
    return order.buyer_org_id === userProfile.organization_id
  }

  const canCopyOrder = (order: Order): boolean => {
    // Can copy orders from any status (excluding closed)
    if (order.status === 'closed') return false
    
    // User must be from the buyer organization
    return order.buyer_org_id === userProfile.organization_id
  }

  const handleEditOrder = (orderId: string) => {
    // Store order ID and navigate to edit view
    if (onViewChange) {
      sessionStorage.setItem('editingOrderId', orderId)
      onViewChange('create-order')
    }
  }

  const handleCopyOrder = async (orderId: string, orderNo: string) => {
    try {
      setLoading(true)

      // Fetch the order with all its items (including units_per_case)
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (*),
            product_variants (*)
          )
        `)
        .eq('id', orderId)
        .single()

      if (orderError) throw orderError
      if (!orderData) throw new Error('Order not found')

      // Create a copy object with the order data
      const orderCopy = {
        ...orderData,
        order_items: orderData.order_items || []
      }

      // Store in sessionStorage for the create order view to pick up
      sessionStorage.setItem('copyingOrderData', JSON.stringify(orderCopy))
      
      toast({
        title: 'Order Copied',
        description: `${orderNo} copied. You can now edit and submit as a new order.`,
      })

      // Navigate to create order view
      if (onViewChange) {
        onViewChange('create-order')
      }
    } catch (error: any) {
      console.error('Error copying order:', error)
      toast({
        title: 'Copy Failed',
        description: error.message || 'Failed to copy order',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
    loadSummary()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchQuery])

  const handleCreateOrder = () => {
    // If H2M filter is selected, go directly to H2M order creation
    if (typeFilter === 'H2M') {
      if (onViewChange) {
        onViewChange('create-order')
      }
      return
    }

    // If D2H filter is selected, go directly to D2H order creation
    if (typeFilter === 'D2H') {
      if (onViewChange) {
        onViewChange('distributor-order')
      }
      return
    }

    // If S2D filter is selected, go directly to S2D order creation
    if (typeFilter === 'S2D') {
      if (onViewChange) {
        onViewChange('shop-order')
      }
      return
    }

    // For distributors, warehouses, and HQ, show order type selection dialog
    if (userProfile.organizations.org_type_code === 'DIST' || 
        userProfile.organizations.org_type_code === 'WH' ||
        userProfile.organizations.org_type_code === 'HQ') {
      setShowOrderTypeDialog(true)
      return
    }
    
    // Navigate to create order view (regular flow)
    if (onViewChange) {
      onViewChange('create-order')
    }
  }

  const handleOrderTypeSelection = (orderType: 'regular' | 'd2h' | 's2d') => {
    setShowOrderTypeDialog(false)
    
    if (orderType === 'd2h') {
      if (onViewChange) {
        onViewChange('distributor-order')
      }
    } else if (orderType === 's2d') {
      if (onViewChange) {
        onViewChange('shop-order')
      }
    } else {
      if (onViewChange) {
        onViewChange('create-order')
      }
    }
  }

  const handleViewOrderDetails = (orderId: string) => {
    // Navigate to view order details (read-only)
    if (onViewChange) {
      sessionStorage.setItem('viewOrderId', orderId)
      onViewChange('view-order')
    }
  }

  const loadOrders = async () => {
    try {
      setLoading(true)
      
      // Get company_id from current org
      const { data: companyData } = await supabase
        .rpc('get_company_id', { p_org_id: userProfile.organization_id })
      
      const companyId = companyData || userProfile.organization_id
      const orgType = userProfile.organizations.org_type_code
      
      // First, get orders
      let query = supabase
        .from('orders')
        .select(`
          *,
          buyer_org:organizations!orders_buyer_org_id_fkey(id, org_name, org_code, org_type_code),
          seller_org:organizations!orders_seller_org_id_fkey(id, org_name, org_code, org_type_code),
          created_by_user:users!orders_created_by_fkey(id, email, full_name),
          approved_by_user:users!orders_approved_by_fkey(id, email, full_name)
        `)
      
      // Filter based on organization type
      if (orgType === 'MFG') {
        // Manufacturers see orders where they are the seller
        query = query.eq('seller_org_id', userProfile.organization_id)
      } else {
        // HQ and others see all orders in their company
        query = query.eq('company_id', companyId)
      }
      
      query = query.order('created_at', { ascending: false }).limit(50)

      // Apply status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      // Apply search filter
      if (searchQuery) {
        query = query.or(`order_no.ilike.%${searchQuery}%,notes.ilike.%${searchQuery}%`)
      }

      const { data: ordersData, error: ordersError } = await query

      if (ordersError) throw ordersError
      
      console.log('=== ORDER LOADING DEBUG ===')
      console.log('Orders loaded:', ordersData?.length, 'orders')
      console.log('Company ID used:', companyId)
      console.log('User org ID:', userProfile.organization_id)
      
      // Now get order_items for these orders separately
      if (ordersData && ordersData.length > 0) {
        const orderIds = ordersData.map(o => o.id)
        
        const { data: itemsData, error: itemsError } = await supabase
          .from('order_items')
          .select(`
            *,
            product:products(id, product_name, product_code),
            variant:product_variants(id, variant_name)
          `)
          .in('order_id', orderIds)
        
        console.log('Order items query result:', itemsData?.length || 0, 'items')
        
        if (itemsError) {
          console.error('Error loading order items:', itemsError)
        } else if (itemsData) {
          // Map items to orders
          const ordersWithItems = ordersData.map(order => ({
            ...order,
            order_items: itemsData.filter(item => item.order_id === order.id)
          }))
          
          console.log('First order with items:', ordersWithItems[0]?.order_no)
          console.log('First order items count:', ordersWithItems[0]?.order_items?.length || 0)
          
          if (ordersWithItems[0]?.order_items && ordersWithItems[0].order_items.length > 0) {
            console.log('First item details:', ordersWithItems[0].order_items[0])
          } else {
            console.log('⚠️ WARNING: No order items found')
            console.log('Items data received:', itemsData)
          }
          
          console.log('========================')
          setOrders(ordersWithItems as any)
          return
        }
      }
      
      console.log('========================')
      setOrders((ordersData || []) as any)
    } catch (error) {
      console.error('Error loading orders:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadSummary = async () => {
    try {
      // Get company_id from current org
      const { data: companyData } = await supabase
        .rpc('get_company_id', { p_org_id: userProfile.organization_id })
      
      const companyId = companyData || userProfile.organization_id
      
      const { data, error } = await supabase
        .from('orders')
        .select('status, order_items(line_total)')
        .eq('company_id', companyId)

      if (error) throw error

      const summary: OrderSummary = {
        total_orders: data?.length || 0,
        draft_orders: data?.filter(o => o.status === 'draft').length || 0,
        submitted_orders: data?.filter(o => o.status === 'submitted').length || 0,
        approved_orders: data?.filter(o => o.status === 'approved').length || 0,
        closed_orders: data?.filter(o => o.status === 'closed').length || 0,
        total_amount: data?.reduce((sum: number, order: any) => {
          const orderTotal = order.order_items?.reduce((itemSum: number, item: any) => 
            itemSum + (item.line_total || 0), 0) || 0
          return sum + orderTotal
        }, 0) || 0
      }

      setSummary(summary)
    } catch (error) {
      console.error('Error loading summary:', error)
    }
  }

  const getStatusColor = (status: OrderStatus) => {
    const colors = {
      draft: 'bg-gray-100 text-gray-800',
      submitted: 'bg-blue-100 text-blue-800',
      approved: 'bg-green-100 text-green-800',
      closed: 'bg-purple-100 text-purple-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const getStatusIcon = (status: OrderStatus) => {
    const icons = {
      draft: <Edit className="w-4 h-4" />,
      submitted: <Clock className="w-4 h-4" />,
      approved: <CheckCircle className="w-4 h-4" />,
      closed: <XCircle className="w-4 h-4" />,
    }
    return icons[status] || <AlertCircle className="w-4 h-4" />
  }

  const getOrderTypeLabel = (type: OrderType) => {
    const labels = {
      H2M: 'HQ → Manufacturer',
      D2H: 'Distributor → HQ',
      S2D: 'Shop → Distributor',
    }
    return labels[type] || type
  }

  const calculateOrderTotal = (order: Order) => {
    return order.order_items?.reduce((sum, item) => sum + (item.line_total || 0), 0) || 0
  }

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: 'MYR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount).replace('MYR', 'RM')
  }

  // Helper function to shorten organization name
  const shortenOrgName = (orgName: string): string => {
    if (!orgName) return 'N/A'
    // Remove common suffixes to shorten the name
    return orgName
      .replace(/\s+(Technologies|Technology|Tech)\s+(Co\.|Company)\s+(Limited|Ltd|Sdn Bhd)/gi, '')
      .replace(/\s+(Co\.|Company)\s+(Limited|Ltd|Sdn Bhd)/gi, '')
      .replace(/\s+(Limited|Ltd|Sdn Bhd)/gi, '')
      .replace(/\s+(Corporation|Corp)/gi, '')
      .trim()
  }

  if (loading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading orders...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Orders</h2>
          <p className="text-gray-600 mt-1">Manage and track all your orders</p>
        </div>
        {/* Hide Create Order button for Manufacturer (MANU/MFG) organizations */}
        {!['MANU', 'MFG'].includes(userProfile.organizations.org_type_code) && (
          <Button className="gap-2" onClick={handleCreateOrder}>
            <Plus className="w-4 h-4" />
            Create Order
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          <Card>
            <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Total Orders</p>
                  <p className="text-lg sm:text-xl lg:text-2xl font-bold">{summary.total_orders}</p>
                </div>
                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Draft</p>
                  <p className="text-lg sm:text-xl lg:text-2xl font-bold">{summary.draft_orders}</p>
                </div>
                <Edit className="w-6 h-6 sm:w-8 sm:h-8 text-gray-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Submitted</p>
                  <p className="text-lg sm:text-xl lg:text-2xl font-bold">{summary.submitted_orders}</p>
                </div>
                <Clock className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Approved</p>
                  <p className="text-lg sm:text-xl lg:text-2xl font-bold">{summary.approved_orders}</p>
                </div>
                <CheckCircle className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-base sm:text-lg lg:text-2xl font-bold truncate">
                    RM {summary.total_amount.toLocaleString('en-MY', { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </p>
                </div>
                <DollarSign className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and View Toggle */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Filter Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Order Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Order Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as OrderType | 'all')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="all">All Types</option>
                <option value="H2M">H2M (HQ → Manufacturer)</option>
                <option value="D2H">D2H (Distributor → HQ)</option>
                <option value="S2D">S2D (Shop → Distributor)</option>
              </select>
            </div>

            {/* Manufacturer/Seller Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Seller/Manufacturer</label>
              <select
                value={sellerFilter}
                onChange={(e) => setSellerFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All Sellers</option>
                {uniqueSellers.map(seller => (
                  <option key={seller.id} value={seller.id}>
                    {seller.org_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="all">All Status</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            {/* View Mode Toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">View Mode</label>
              <div className="flex border border-gray-300 rounded-md overflow-hidden">
                <Button
                  variant={viewMode === 'cards' ? 'default' : 'ghost'}
                  size="sm"
                  className={`flex-1 rounded-none ${viewMode === 'cards' ? 'bg-blue-600' : ''}`}
                  onClick={() => setViewMode('cards')}
                >
                  <Grid3x3 className="w-4 h-4 mr-2" />
                  Cards
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  className={`flex-1 rounded-none ${viewMode === 'list' ? 'bg-blue-600' : ''}`}
                  onClick={() => setViewMode('list')}
                >
                  <List className="w-4 h-4 mr-2" />
                  List
                </Button>
              </div>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search orders by order number or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Orders List - Card Layout */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Orders</h2>
          {filteredOrders.length > 0 && (
            <span className="text-sm text-gray-500">{filteredOrders.length} orders found</span>
          )}
        </div>

        {filteredOrders.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No orders found</h3>
                <p className="text-gray-600 mb-4">
                  {searchQuery || statusFilter !== 'all' 
                    ? 'Try adjusting your filters' 
                    : ['MANU', 'MFG'].includes(userProfile.organizations.org_type_code)
                      ? 'No orders available. Manufacturers receive orders from HQ.'
                      : 'Create your first order to get started'}
                </p>
                {/* Hide Create Order button for Manufacturer organizations */}
                {!['MANU', 'MFG'].includes(userProfile.organizations.org_type_code) && (
                  <Button className="gap-2" onClick={handleCreateOrder}>
                    <Plus className="w-4 h-4" />
                    Create Order
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : viewMode === 'list' ? (
          /* LIST VIEW */
          <div className="space-y-3">
            {filteredOrders.map((order) => {
              const totalAmount = calculateOrderTotal(order)
              const itemCount = order.order_items?.length || 0
              const totalUnits = order.order_items?.reduce((sum, item) => sum + item.qty, 0) || 0

              return (
                <Card key={order.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      {/* Left: Order Info */}
                      <div className="flex items-center gap-4 flex-1">
                        <div className="min-w-[180px]">
                          <div 
                            className="font-bold text-blue-600 mb-1 cursor-pointer hover:underline"
                            onClick={() => handleViewOrderDetails(order.id)}
                          >
                            {order.order_no}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                              {order.order_type}
                            </Badge>
                            <Badge className={getStatusColor(order.status)}>
                              <div className="flex items-center gap-1">
                                {getStatusIcon(order.status)}
                                <span className="text-xs">{order.status}</span>
                              </div>
                            </Badge>
                          </div>
                        </div>

                        {/* Customer */}
                        <div className="flex items-center gap-2 min-w-[200px]">
                          <ShoppingCart className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          <div>
                            <div className="text-xs text-gray-500">Customer</div>
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {order.buyer_org?.org_name || 'N/A'}
                            </div>
                          </div>
                        </div>

                        {/* Seller */}
                        <div className="flex items-center gap-2 min-w-[200px]">
                          <Store className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <div>
                            <div className="text-xs text-gray-500">Seller</div>
                            <div className="text-sm font-medium text-gray-900 truncate" title={order.seller_org?.org_name || 'N/A'}>
                              {shortenOrgName(order.seller_org?.org_name || 'N/A')}
                            </div>
                          </div>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-6">
                          <div className="text-center">
                            <div className="text-xs text-gray-500">Items</div>
                            <div className="text-sm font-bold text-gray-900">{formatNumber(itemCount)}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-gray-500">Units</div>
                            <div className="text-sm font-bold text-gray-900">{formatNumber(totalUnits)}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-gray-500">Amount</div>
                            <div className="text-sm font-bold text-blue-600">
                              {formatCurrency(totalAmount)}
                            </div>
                          </div>
                        </div>

                        {/* Date */}
                        <div className="flex items-center gap-1 text-xs text-gray-500 min-w-[120px]">
                          <Calendar className="w-3 h-3" />
                          <span>{new Date(order.created_at).toLocaleDateString('en-MY')}</span>
                        </div>
                      </div>

                      {/* Creator and Approver Info */}
                      <div className="flex items-center gap-4 text-xs mt-2 pt-2 border-t border-gray-100">
                        {order.created_by_user && (
                          <div className="flex items-center gap-1.5">
                            <User className="w-3 h-3 text-gray-400" />
                            <span className="text-gray-500">By:</span>
                            <span className="font-medium text-gray-700">
                              {order.created_by_user.full_name || order.created_by_user.email}
                            </span>
                          </div>
                        )}
                        {order.status === 'approved' && order.approved_by_user && (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle className="w-3 h-3 text-green-500" />
                            <span className="text-gray-500">Approved by:</span>
                            <span className="font-medium text-green-700">
                              {order.approved_by_user.full_name || order.approved_by_user.email}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2">
                        {canEditOrder(order) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1"
                            onClick={() => handleEditOrder(order.id)}
                            title="Edit Order"
                          >
                            <Edit className="w-3 h-3" />
                            Edit
                          </Button>
                        )}
                        {canCopyOrder(order) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                            onClick={() => handleCopyOrder(order.id, order.order_no)}
                            title="Copy Order"
                          >
                            <Copy className="w-3 h-3" />
                            Copy
                          </Button>
                        )}
                        {canApproveOrder(order) && (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-8 gap-1 bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => handleApproveOrder(order.id, order.order_no)}
                            title="Approve Order"
                          >
                            <CheckCircle className="w-3 h-3" />
                            Approve
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0"
                          onClick={() => handleViewOrderDetails(order.id)}
                          title="View Order Details"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canDeleteOrder() && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteOrder(order.id, order.order_no)}
                            title="Delete Order (Super Admin Only)"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          /* CARD VIEW */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredOrders.map((order) => {
              const totalAmount = calculateOrderTotal(order)
              const itemCount = order.order_items?.length || 0
              const totalUnits = order.order_items?.reduce((sum, item) => sum + item.qty, 0) || 0

              return (
                <Card key={order.id} className="hover:shadow-lg transition-shadow cursor-pointer">
                  <CardContent className="p-5">
                    {/* Header with Order Number and Status */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div 
                          className="font-bold text-blue-600 text-lg mb-1 cursor-pointer hover:underline"
                          onClick={() => handleViewOrderDetails(order.id)}
                        >
                          {order.order_no}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant="outline" 
                            className="text-xs bg-blue-50 text-blue-700 border-blue-200"
                          >
                            {order.order_type}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {getOrderTypeLabel(order.order_type)}
                          </span>
                        </div>
                      </div>
                      <Badge className={getStatusColor(order.status)}>
                        <div className="flex items-center gap-1">
                          {getStatusIcon(order.status)}
                          <span className="text-xs font-medium">{order.status}</span>
                        </div>
                      </Badge>
                    </div>

                    {/* Organization Details */}
                    <div className="space-y-2 mb-4 border-t border-b border-gray-100 py-3">
                      {/* Customer/Buyer */}
                      <div className="flex items-start gap-2">
                        <ShoppingCart className="w-4 h-4 text-blue-500 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500">Customer</div>
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {order.buyer_org?.org_name || 'Unknown'}
                          </div>
                        </div>
                      </div>

                      {/* Seller */}
                      <div className="flex items-start gap-2">
                        <Store className="w-4 h-4 text-green-500 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-500">Seller</div>
                          <div className="text-sm font-medium text-gray-900 truncate" title={order.seller_org?.org_name || 'Unknown'}>
                            {shortenOrgName(order.seller_org?.org_name || 'Unknown')}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Order Stats */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-500 mb-1">Items</div>
                        <div className="text-lg font-bold text-gray-900">{formatNumber(itemCount)}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-500 mb-1">Units</div>
                        <div className="text-lg font-bold text-gray-900">{formatNumber(totalUnits)}</div>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-2 text-center">
                        <div className="text-xs text-blue-600 mb-1">Amount</div>
                        <div className="text-sm font-bold text-blue-700">
                          {formatCurrency(totalAmount)}
                        </div>
                      </div>
                    </div>

                    {/* Date */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Calendar className="w-3 h-3" />
                        <span>Created {new Date(order.created_at).toLocaleDateString('en-MY')}</span>
                      </div>
                    </div>

                    {/* Creator and Approver Info */}
                    <div className="space-y-1.5 pt-2 border-t border-gray-100">
                      {order.created_by_user && (
                        <div className="flex items-center gap-2 text-xs">
                          <User className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-500">Created by:</span>
                          <span className="font-medium text-gray-700">
                            {order.created_by_user.full_name || order.created_by_user.email}
                          </span>
                        </div>
                      )}
                      {order.status === 'approved' && order.approved_by_user && (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span className="text-gray-500">Approved by:</span>
                          <span className="font-medium text-green-700">
                            {order.approved_by_user.full_name || order.approved_by_user.email}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1 text-xs h-8"
                        title="View Details"
                        onClick={() => handleViewOrderDetails(order.id)}
                      >
                        <Eye className="w-3 h-3" />
                        View
                      </Button>
                      {canEditOrder(order) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 gap-1 text-xs h-8"
                          title="Edit Order"
                          onClick={() => handleEditOrder(order.id)}
                        >
                          <Edit className="w-3 h-3" />
                          Edit
                        </Button>
                      )}
                      {canCopyOrder(order) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 gap-1 text-xs h-8 border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                          title="Copy Order"
                          onClick={() => handleCopyOrder(order.id, order.order_no)}
                        >
                          <Copy className="w-3 h-3" />
                          Copy
                        </Button>
                      )}
                      {canApproveOrder(order) && (
                        <Button
                          variant="default"
                          size="sm"
                          className="flex-1 gap-1 text-xs h-8 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handleApproveOrder(order.id, order.order_no)}
                          title="Approve Order"
                        >
                          <CheckCircle className="w-3 h-3" />
                          Approve
                        </Button>
                      )}
                      {canDeleteOrder() && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Delete Order (Super Admin Only)"
                          onClick={() => handleDeleteOrder(order.id, order.order_no)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Order Type Selection Dialog */}
      {showOrderTypeDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Select Order Type</h3>
            <p className="text-sm text-gray-600 mb-6">
              Choose the type of order you want to create:
            </p>
            
            <div className="space-y-3">
              <button
                onClick={() => handleOrderTypeSelection('regular')}
                className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="flex items-start gap-3">
                  <Store className="w-5 h-5 text-gray-600 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-gray-900">HQ Order to Manufacture (H2M)</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      Create a standard order (based on your organization type)
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleOrderTypeSelection('d2h')}
                className="w-full p-4 border-2 border-blue-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
              >
                <div className="flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-gray-900">Order to HQ (D2H)</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      Order products from headquarters using distributor pricing (only products with available stock)
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleOrderTypeSelection('s2d')}
                className="w-full p-4 border-2 border-green-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors text-left"
              >
                <div className="flex items-start gap-3">
                  <ShoppingCart className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-gray-900">Shop Order (S2D)</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      Create order for Shop from Distributor using retailer pricing (deducts from Distributor inventory)
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-6 flex justify-end">
              <Button
                variant="ghost"
                onClick={() => setShowOrderTypeDialog(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
