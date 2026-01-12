'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { formatNumber } from '@/lib/utils/formatters'
import { usePermissions } from '@/hooks/usePermissions'
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
  Grid3x3,
  List,
  Trash2,
  ShoppingCart,
  Store,
  TrendingUp,
  Copy,
  User,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight
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
  const [typeFilter, setTypeFilter] = useState<OrderType | 'all'>('all')
  const [sellerFilter, setSellerFilter] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('list')
  const [showOrderTypeDialog, setShowOrderTypeDialog] = useState(false)

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)

  const supabase = createClient()
  const { toast } = useToast()

  // Permission check for creating orders
  const { hasPermission, loading: permissionsLoading } = usePermissions(userProfile.roles.role_level, userProfile.role_code)
  const canCreateOrders = hasPermission('create_orders')

  // Debug: Log permission state
  console.log('[OrdersView] Permission check:', {
    roleLevel: userProfile.roles.role_level,
    permissionsLoading,
    canCreateOrders,
    hasCreateOrderPermission: hasPermission('create_orders')
  })

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
    // Search filter - search both legacy and display doc numbers
    const matchesSearch = order.order_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.display_doc_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.notes?.toLowerCase().includes(searchQuery.toLowerCase())

    // Status filter
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter

    // Type filter
    const matchesType = typeFilter === 'all' || order.order_type === typeFilter

    // Seller filter
    const matchesSeller = !sellerFilter || order.seller_org_id === sellerFilter

    return matchesSearch && matchesStatus && matchesType && matchesSeller
  })

  // Sort orders
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    let aValue: any
    let bValue: any

    switch (sortColumn) {
      case 'created_at':
        aValue = new Date(a.created_at).getTime()
        bValue = new Date(b.created_at).getTime()
        break
      case 'order_no':
        aValue = a.order_no
        bValue = b.order_no
        break
      case 'seller':
        aValue = getDisplayOrgName(a)
        bValue = getDisplayOrgName(b)
        break
      case 'total':
        aValue = calculateOrderTotal(a)
        bValue = calculateOrderTotal(b)
        break
      case 'balance':
        aValue = a.status === 'approved' ? 0 : calculateOrderTotal(a)
        bValue = b.status === 'approved' ? 0 : calculateOrderTotal(b)
        break
      case 'status':
        aValue = a.status
        bValue = b.status
        break
      case 'created_by':
        aValue = a.created_by_user?.full_name || a.created_by_user?.email || ''
        bValue = b.created_by_user?.full_name || b.created_by_user?.email || ''
        break
      default:
        return 0
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  // Pagination
  const totalPages = Math.ceil(sortedOrders.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedOrders = sortedOrders.slice(startIndex, endIndex)

  // Handle sort
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, typeFilter, sellerFilter])

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

  const handleApproveOrder = async (orderId: string, orderNo: string, displayDocNo?: string | null) => {
    // Use new display_doc_no format if available, fallback to legacy
    const displayOrderNo = displayDocNo || orderNo

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
          title: 'Action Not Allowed',
          description: 'For security reasons, you cannot approve an order you created. Please ask another admin to approve it.',
          variant: 'destructive'
        })
        return
      }

      // 3. Show confirmation dialog
      if (!confirm(`Approve order ${displayOrderNo}?\n\nThis will:\n• Change status to "Approved"\n• Reserve Inventory (Allocate)\n• Generate Purchase Order document\n\nThis action cannot be undone.`)) {
        return
      }

      setLoading(true)

      // Call the orders_approve database function
      const { data, error } = await supabase
        .rpc('orders_approve', { p_order_id: orderId })

      console.log('Approve result:', { data, error })

      if (error) {
        console.error('RPC error details:', JSON.stringify(error, null, 2))
        throw error
      }

      // Inventory deduction is now handled by the orders_approve RPC for both D2H and S2D

      // Fetch the updated order to get the newly generated display_doc_no
      const { data: updatedOrder } = await supabase
        .from('orders')
        .select('display_doc_no')
        .eq('id', orderId)
        .single()

      // Use the newly generated display_doc_no for the toast
      const newDisplayNo = updatedOrder?.display_doc_no || displayOrderNo

      toast({
        title: 'Order Approved',
        description: `Order ${newDisplayNo} has been approved successfully. PO document has been generated.`,
      })

      // Reload orders
      await loadOrders()
      await loadSummary()
    } catch (error: any) {
      console.error('Error approving order:', error)
      console.error('Error details:', JSON.stringify(error, null, 2))

      let title = 'Approval Failed'
      let description = 'An unexpected error occurred. Please try again.'

      if (error) {
        // Handle Supabase errors
        if (error.message) {
          description = error.message

          // Map technical errors to friendly messages
          if (description.includes('Order must be in submitted')) {
            description = 'Only submitted orders can be approved.'
          } else if (description.includes('User lacks permission')) {
            description = 'You do not have permission to approve this order.'
          } else if (description.includes('Parent order must be approved')) {
            description = 'The parent order must be approved first.'
          } else if (description.includes('Order not found')) {
            description = 'Order not found.'
          }
        } else if (typeof error === 'object' && Object.keys(error).length === 0) {
          // Empty error object usually means network or unknown error
          description = 'Unable to connect to the server. Please check your internet connection.'
        }
      }

      toast({
        title,
        description,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCancelOrder = async (orderId: string, orderNo: string) => {
    try {
      if (!confirm(`Cancel order ${orderNo}?\n\nThis will:\n• Change status to "Cancelled"\n• Release allocated inventory\n\nThis action cannot be undone.`)) {
        return
      }

      setLoading(true)

      // Update order status to cancelled
      // The trigger 'on_order_status_change' will handle inventory deallocation
      const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId)

      if (error) throw error

      toast({
        title: 'Order Cancelled',
        description: `Order ${orderNo} has been cancelled and inventory released.`,
      })

      // Reload orders
      await loadOrders()
      await loadSummary()
    } catch (error: any) {
      console.error('Error cancelling order:', error)
      toast({
        title: 'Cancellation Failed',
        description: error.message || 'Failed to cancel order',
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

    // Check role level authority
    const userLevel = userProfile.roles.role_level
    const creatorLevel = order.created_by_user?.roles?.role_level ?? 999 // Default to high number (low rank) if unknown

    let hasLevelAuthority = false

    if (creatorLevel === 10) {
      // Special condition: If creator is Level 10, only Level 10 or 20 can approve
      hasLevelAuthority = (userLevel === 10 || userLevel === 20)
    } else {
      // General rule: Approver must be higher rank (lower number) than creator
      hasLevelAuthority = (userLevel < creatorLevel)
    }

    if (!hasLevelAuthority) return false

    const userOrgType = userProfile.organizations.org_type_code

    // H2M: HQ Power Users can approve
    if (order.order_type === 'H2M' && userOrgType === 'HQ') return true

    // D2H: HQ Power Users or Seller (Warehouse) can approve
    // Also allow if user is HQ and order is D2H (Distributor -> HQ)
    if (order.order_type === 'D2H') {
      if (userOrgType === 'HQ') return true;
      // If user is the seller (e.g. Warehouse admin if that exists, though usually HQ manages WH)
      if (order.seller_org_id === userProfile.organization_id) return true;
    }

    // S2D: Distributor (seller) Power Users can approve
    if (order.order_type === 'S2D' && order.seller_org_id === userProfile.organization_id) return true

    return false
  }

  // Helper function to check if user can cancel orders
  const canCancelOrder = (order: Order & { approved_by_user?: any }): boolean => {
    // Can cancel Submitted, Approved or Processing orders
    // Submitted: No stock allocated yet, but can be cancelled
    // Approved/Processing: Stock allocated, will be released
    if (!['submitted', 'approved', 'processing'].includes(order.status)) return false

    const userOrgId = userProfile.organization_id
    const userOrgType = userProfile.organizations.org_type_code

    // Check if user is part of the transaction (HQ, Seller, Buyer)
    const isParticipant = userOrgType === 'HQ' || order.seller_org_id === userOrgId || order.buyer_org_id === userOrgId
    if (!isParticipant) return false

    // Issue 2: Cancel order only can be done level upper
    // If the order is approved, check the approver's level
    if (['approved', 'processing'].includes(order.status) && order.approved_by_user?.roles) {
      const approverLevel = order.approved_by_user.roles.role_level
      const myLevel = userProfile.roles.role_level

      // Current user must have a higher role (lower number) than the approver
      // e.g. If approved by 30, only 20, 10, 1 can cancel
      if (myLevel >= approverLevel) {
        return false
      }
    }

    return true
  }

  // Helper function to check if user can delete orders (Super Admin only)
  const canDeleteOrder = (): boolean => {
    // Explicitly disallow level 30 and 40
    if (userProfile.roles.role_level === 30 || userProfile.roles.role_level === 40) {
      return false
    }
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

  const handleCreateOrder = async () => {
    // Check if user has digital signature
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('signature_url')
        .eq('id', userProfile.id)
        .single()

      if (userError) throw userError

      if (!userData?.signature_url) {
        toast({
          title: 'Digital Signature Required',
          description: 'You must upload your digital signature before creating an order.',
          variant: 'destructive',
          action: (
            <Button
              variant="outline"
              size="sm"
              className="bg-white text-black hover:bg-gray-100"
              onClick={() => {
                if (onViewChange) onViewChange('my-profile')
              }}
            >
              Go to Profile
            </Button>
          )
        })
        return
      }
    } catch (error) {
      console.error('Error checking signature:', error)
      // Continue anyway if check fails to avoid blocking user due to technical error
    }

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
          created_by_user:users!orders_created_by_fkey(id, email, full_name, roles:role_code(role_level)),
          approved_by_user:users!orders_approved_by_fkey(id, email, full_name, roles:role_code(role_level))
        `)

      // Filter based on organization type
      if (orgType === 'MFG' || orgType === 'MANU') {
        // Manufacturers see orders where they are the seller
        query = query.eq('seller_org_id', userProfile.organization_id)

        // Issue 2: Manufacturers should only see 'approved' orders (or later stages), not 'submitted'
        // They need to see approved orders to start processing them
        // Assuming 'submitted' is the initial state before approval
        query = query.neq('status', 'submitted')
        query = query.neq('status', 'draft')
      } else {
        // HQ and others see all orders in their company
        query = query.eq('company_id', companyId)
      }

      query = query.order('created_at', { ascending: false }).limit(50)

      // Apply status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      // Apply search filter - search both legacy and display doc numbers
      if (searchQuery) {
        query = query.or(`order_no.ilike.%${searchQuery}%,display_doc_no.ilike.%${searchQuery}%,notes.ilike.%${searchQuery}%`)
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

        // 1. Fetch Order Items
        const { data: itemsData, error: itemsError } = await supabase
          .from('order_items')
          .select(`
            *,
            product:products(id, product_name, product_code),
            variant:product_variants(id, variant_name)
          `)
          .in('order_id', orderIds)

        // 2. Fetch PO Documents to check acknowledgement status (for Unpaid status logic)
        const { data: poData } = await supabase
          .from('documents')
          .select('order_id, status')
          .in('order_id', orderIds)
          .eq('doc_type', 'PO')

        // 3. Fetch acknowledged PAYMENT documents to calculate paid amounts
        const { data: paymentData } = await supabase
          .from('documents')
          .select('order_id, status, payment_percentage, payload')
          .in('order_id', orderIds)
          .eq('doc_type', 'PAYMENT')
          .eq('status', 'acknowledged')

        // 4. Fetch RECEIPT documents for D2H orders (customer receipts)
        const { data: receiptData } = await supabase
          .from('documents')
          .select('order_id, status, payment_percentage, payload')
          .in('order_id', orderIds)
          .eq('doc_type', 'RECEIPT')

        console.log('Order items query result:', itemsData?.length || 0, 'items')
        console.log('Acknowledged payments found:', paymentData?.length || 0)
        console.log('Receipts found:', receiptData?.length || 0)

        if (itemsError) {
          console.error('Error loading order items:', itemsError)
        } else if (itemsData) {
          // Map items to orders
          const ordersWithItems = ordersData.map(order => {
            const items = itemsData.filter(item => item.order_id === order.id)
            const poDoc = poData?.find(d => d.order_id === order.id)

            // Calculate paid amount from acknowledged payment documents
            const orderPayments = paymentData?.filter(p => p.order_id === order.id) || []
            const orderReceipts = receiptData?.filter(r => r.order_id === order.id) || []
            const orderTotal = items.reduce((sum, item) => sum + (item.line_total || 0), 0)

            // Sum up paid amounts from payment percentages (for H2M orders)
            let paidAmount = 0
            orderPayments.forEach(payment => {
              // Get payment percentage from document or payload
              const paymentPct = payment.payment_percentage ||
                (payment.payload as any)?.payment_percentage ||
                (payment.payload as any)?.requested_percent ||
                30 // default deposit percentage
              paidAmount += (orderTotal * paymentPct / 100)
            })

            // Add receipt amounts (for D2H orders - customer receipts have amount in payload)
            orderReceipts.forEach(receipt => {
              const receiptAmount = (receipt.payload as any)?.amount || 0
              if (receiptAmount > 0) {
                paidAmount += receiptAmount
              } else if (receipt.payment_percentage) {
                // Fallback to percentage calculation
                paidAmount += (orderTotal * receipt.payment_percentage / 100)
              }
            })

            return {
              ...order,
              order_items: items,
              paid_amount: paidAmount,
              po_acknowledged: poDoc?.status === 'acknowledged' || poDoc?.status === 'completed'
            }
          })

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
        // Only count total amount for approved and closed orders (exclude draft and submitted)
        total_amount: data?.reduce((sum: number, order: any) => {
          // Skip draft and submitted orders - only count approved and closed
          if (order.status === 'draft' || order.status === 'submitted') {
            return sum
          }
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

  // Helper function to get the organization name to display in the Name column
  // For D2H orders, we want to show the distributor (seller) name
  // For H2M orders, we want to show the manufacturer (seller) name
  // For S2D orders, we want to show the shop (buyer) name from distributor's view, or distributor (seller) from shop's view
  const getDisplayOrgName = (order: Order): string => {
    // For D2H (Distributor → HQ), show the distributor name (seller)
    // If seller is HQ (wrong data), use buyer instead
    if (order.order_type === 'D2H') {
      const sellerIsHQ = order.seller_org?.org_type_code === 'HQ'
      const buyerIsHQ = order.buyer_org?.org_type_code === 'HQ'

      // If data is correct (seller is distributor), return seller name
      if (!sellerIsHQ && order.seller_org?.org_name) {
        return order.seller_org.org_name
      }
      // If data is reversed (buyer is distributor), return buyer name
      if (!buyerIsHQ && order.buyer_org?.org_name) {
        return order.buyer_org.org_name
      }
      // Fallback
      return order.seller_org?.org_name || order.buyer_org?.org_name || 'N/A'
    }

    // For H2M (HQ → Manufacturer), show the manufacturer name (seller)
    if (order.order_type === 'H2M') {
      return order.seller_org?.org_name || 'N/A'
    }

    // For S2D (Shop → Distributor), show the shop name (buyer) or distributor (seller) based on perspective
    if (order.order_type === 'S2D') {
      // If current user is the seller (distributor), show buyer (shop) name
      if (order.seller_org_id === userProfile.organization_id) {
        return order.buyer_org?.org_name || 'N/A'
      }
      // If current user is the buyer (shop), show seller (distributor) name
      return order.seller_org?.org_name || 'N/A'
    }

    // Default: show seller name
    return order.seller_org?.org_name || 'N/A'
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
    <div className="space-y-6 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Orders</h2>
          <p className="text-xs text-gray-600 mt-1">Manage and track all your orders</p>
        </div>
        {/* Hide Create Order button for Manufacturer (MANU/MFG) organizations or if user doesn't have permission */}
        {!['MANU', 'MFG'].includes(userProfile.organizations.org_type_code) && canCreateOrders && (
          <Button className="gap-2" onClick={handleCreateOrder}>
            <Plus className="w-4 h-4" />
            Create Order
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Card className="border-t-4 border-t-[#1F4E55] shadow-sm">
            <CardContent className="p-6">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground font-medium">Total Orders</p>
                <p className="text-3xl font-bold text-gray-900">{summary.total_orders}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-t-4 border-t-[#1F4E55] shadow-sm">
            <CardContent className="p-6">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground font-medium">Submitted</p>
                <p className="text-3xl font-bold text-gray-900">{summary.submitted_orders}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-t-4 border-t-[#1F4E55] shadow-sm">
            <CardContent className="p-6">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground font-medium">Approved</p>
                <p className="text-3xl font-bold text-gray-900">{summary.approved_orders}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-t-4 border-t-[#1F4E55] shadow-sm">
            <CardContent className="p-6">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground font-medium">Total Amount</p>
                <p className="text-3xl font-bold text-gray-900 truncate">
                  RM {summary.total_amount.toLocaleString('en-MY', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                </p>
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
            {/* Order Type Filter - Hidden for Manufacturers */}
            {!['MANU', 'MFG'].includes(userProfile.organizations.org_type_code) && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Order Type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as OrderType | 'all')}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="all">All Types</option>
                  <option value="H2M">H2M (HQ → Manufacturer)</option>
                  <option value="D2H">D2H (Distributor → HQ)</option>
                  <option value="S2D">S2D (Shop → Distributor)</option>
                </select>
              </div>
            )}

            {/* Manufacturer/Seller Filter - Hidden for Manufacturers */}
            {!['MANU', 'MFG'].includes(userProfile.organizations.org_type_code) && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Seller/Manufacturer</label>
                <select
                  value={sellerFilter}
                  onChange={(e) => setSellerFilter(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">All Sellers</option>
                  {uniqueSellers.map(seller => (
                    <option key={seller.id} value={seller.id}>
                      {seller.org_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Status Filter - Hidden for Manufacturers */}
            {!['MANU', 'MFG'].includes(userProfile.organizations.org_type_code) && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="all">All Status</option>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            )}

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
                {/* Hide Create Order button for Manufacturer organizations or if user doesn't have permission */}
                {!['MANU', 'MFG'].includes(userProfile.organizations.org_type_code) && canCreateOrders && (
                  <Button className="gap-2" onClick={handleCreateOrder}>
                    <Plus className="w-4 h-4" />
                    Create Order
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : viewMode === 'list' ? (
          /* LIST VIEW - Table Format */
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('created_at')}
                      >
                        <div className="flex items-center gap-1">
                          Date
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('order_no')}
                      >
                        <div className="flex items-center gap-1">
                          Order
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('seller')}
                      >
                        <div className="flex items-center gap-1">
                          Name
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('total')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Total
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('balance')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Balance
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('status')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          Status
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">Due</th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('created_by')}
                      >
                        <div className="flex items-center gap-1">
                          <span>By</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedOrders.map((order) => {
                      const totalAmount = calculateOrderTotal(order)
                      const totalUnits = order.order_items?.reduce((sum, item) => sum + item.qty, 0) || 0
                      const paidAmount = (order as any).paid_amount || 0
                      const balance = Math.max(0, totalAmount - paidAmount)

                      return (
                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                          {/* Date Created */}
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-900">
                            {new Date(order.created_at).toLocaleDateString('en-MY', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit'
                            })}
                          </td>

                          {/* Order Number */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button
                              className="text-xs font-medium text-gray-900 hover:underline"
                              onClick={() => handleViewOrderDetails(order.id)}
                              title={order.display_doc_no ? `Legacy: ${order.order_no}` : undefined}
                            >
                              {order.display_doc_no || order.order_no}
                            </button>
                          </td>

                          {/* Seller Name */}
                          <td className="px-4 py-3 text-xs text-gray-900">
                            <div className="max-w-[200px] truncate" title={getDisplayOrgName(order)}>
                              {getDisplayOrgName(order)}
                            </div>
                          </td>

                          {/* Total Amount */}
                          <td className="px-4 py-3 whitespace-nowrap text-right text-xs font-medium text-gray-900">
                            {formatCurrency(totalAmount)}
                          </td>

                          {/* Balance */}
                          <td className={`px-4 py-3 whitespace-nowrap text-right text-xs font-medium ${balance > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                            {formatCurrency(balance)}
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            {order.status === 'approved' && (order as any).po_acknowledged ? (
                              (() => {
                                const totalAmount = calculateOrderTotal(order)
                                const paidAmount = (order as any).paid_amount || 0

                                if (paidAmount >= totalAmount && totalAmount > 0) {
                                  return (
                                    <Badge className="bg-green-100 text-green-800">
                                      <span className="text-[11px] capitalize">Paid</span>
                                    </Badge>
                                  )
                                } else if (paidAmount > 0) {
                                  return (
                                    <Badge className="bg-orange-100 text-orange-800">
                                      <span className="text-[11px] capitalize">Partial</span>
                                    </Badge>
                                  )
                                } else {
                                  return (
                                    <Badge className="bg-red-100 text-red-800">
                                      <span className="text-[11px] capitalize">Unpaid</span>
                                    </Badge>
                                  )
                                }
                              })()
                            ) : (
                              <Badge className={getStatusColor(order.status)}>
                                <span className="text-[11px] capitalize">{order.status}</span>
                              </Badge>
                            )}
                          </td>

                          {/* Due Date (empty for now) */}
                          <td className="px-4 py-3 whitespace-nowrap text-center text-xs text-gray-900">
                            -
                          </td>

                          {/* Created By */}
                          <td className="px-4 py-3 text-xs text-gray-900">
                            <div className="max-w-[120px] truncate" title={order.created_by_user?.full_name || order.created_by_user?.email || 'Unknown'}>
                              {order.created_by_user?.full_name || order.created_by_user?.email || 'Unknown'}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-2">
                              {canEditOrder(order) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1 text-xs px-2"
                                  onClick={() => handleEditOrder(order.id)}
                                  title="Edit Order"
                                >
                                  <Edit className="w-3 h-3" />
                                </Button>
                              )}
                              {canCopyOrder(order) && (userProfile.roles.role_level === 1 || userProfile.roles.role_level === 10) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1 text-xs px-2 border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                                  onClick={() => handleCopyOrder(order.id, order.order_no)}
                                  title="Copy Order"
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                              )}
                              {canApproveOrder(order) && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="h-7 gap-1 text-xs px-2 bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => handleApproveOrder(order.id, order.order_no, order.display_doc_no)}
                                  title="Approve Order"
                                >
                                  <CheckCircle className="w-3 h-3" />
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
                              {canCancelOrder(order) && (userProfile.roles.role_level === 1 || userProfile.roles.role_level === 10) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => handleCancelOrder(order.id, order.order_no)}
                                  title="Cancel Order"
                                >
                                  <XCircle className="w-4 h-4" />
                                </Button>
                              )}
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
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {sortedOrders.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-700">
                      Showing {startIndex + 1} to {Math.min(endIndex, sortedOrders.length)} of {sortedOrders.length} orders
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value))
                        setCurrentPage(1)
                      }}
                      className="px-2 py-1 text-xs border border-gray-300 rounded-md"
                    >
                      <option value={10}>10 per page</option>
                      <option value={25}>25 per page</option>
                      <option value={50}>50 per page</option>
                      <option value={100}>100 per page</option>
                    </select>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>

                    <span className="text-xs text-gray-700">
                      Page {currentPage} of {totalPages}
                    </span>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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
                          title={order.display_doc_no ? `Legacy: ${order.order_no}` : undefined}
                        >
                          {order.display_doc_no || order.order_no}
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
                      {order.status === 'approved' && (order as any).po_acknowledged ? (
                        (() => {
                          const totalAmount = calculateOrderTotal(order)
                          const paidAmount = (order as any).paid_amount || 0

                          if (paidAmount >= totalAmount && totalAmount > 0) {
                            return (
                              <Badge className="bg-green-100 text-green-800">
                                <div className="flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  <span className="text-xs font-medium">Paid</span>
                                </div>
                              </Badge>
                            )
                          } else if (paidAmount > 0) {
                            return (
                              <Badge className="bg-orange-100 text-orange-800">
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <span className="text-xs font-medium">Partial</span>
                                </div>
                              </Badge>
                            )
                          } else {
                            return (
                              <Badge className="bg-red-100 text-red-800">
                                <div className="flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  <span className="text-xs font-medium">Unpaid</span>
                                </div>
                              </Badge>
                            )
                          }
                        })()
                      ) : (
                        <Badge className={getStatusColor(order.status)}>
                          <div className="flex items-center gap-1">
                            {getStatusIcon(order.status)}
                            <span className="text-xs font-medium">{order.status}</span>
                          </div>
                        </Badge>
                      )}
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
                          <div className="text-sm font-medium text-gray-900 truncate" title={getDisplayOrgName(order)}>
                            {shortenOrgName(getDisplayOrgName(order))}
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
                        className="flex-1 gap-1 text-xs h-7 px-2"
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
                          className="flex-1 gap-1 text-xs h-7 px-2"
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
                          className="flex-1 gap-1 text-xs h-7 px-2 border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
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
                          className="flex-1 gap-1 text-xs h-7 px-2 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handleApproveOrder(order.id, order.order_no, order.display_doc_no)}
                          title="Approve Order"
                        >
                          <CheckCircle className="w-3 h-3" />
                          Approve
                        </Button>
                      )}
                      {canCancelOrder(order) && userProfile.roles.role_level !== 40 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleCancelOrder(order.id, order.order_no)}
                          title="Cancel Order"
                        >
                          <XCircle className="w-4 h-4" />
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
