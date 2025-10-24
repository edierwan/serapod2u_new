'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { validateOrderDeletion, cascadeDeleteOrder } from '@/lib/utils/deletionValidation'
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
  TrendingUp
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
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
  const supabase = createClient()
  const { toast } = useToast()

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

      // Step 1: Validate if order can be deleted
      console.log('🔍 Validating order deletion for:', orderNo)
      const validation = await validateOrderDeletion(supabase, orderId)

      if (!validation.canDelete) {
        console.error('❌ Cannot delete order:', validation.reason)
        toast({
          title: '❌ Cannot Delete Order',
          description: validation.message,
          variant: 'destructive'
        })
        setLoading(false)
        return
      }

      // Step 2: Show confirmation with details
      const relatedRecords = validation.relatedRecords || { orderItems: 0, qrBatchesPending: 0, qrCodesPending: 0, documents: 0 }
      const confirmMessage = `⚠️ Are you sure you want to permanently delete order ${orderNo}?\n\nThis will also delete:\n• ${relatedRecords.orderItems} order item(s)\n• ${relatedRecords.qrBatchesPending} QR batch(es)\n• ${relatedRecords.qrCodesPending} pending QR code(s)\n• ${relatedRecords.documents} document(s)\n\nThis action CANNOT be undone!`

      if (!confirm(confirmMessage)) {
        setLoading(false)
        return
      }

      // Step 3: Cascade delete
      console.log('🗑️ Cascade deleting order and related records...')
      await cascadeDeleteOrder(supabase, orderId)

      toast({
        title: '✅ Order Deleted',
        description: `Order ${orderNo} and all related records have been permanently deleted.`
      })

      // Reload orders
      await loadOrders()
      await loadSummary()
    } catch (error: any) {
      console.error('Error deleting order:', error)
      toast({
        title: '❌ Delete Failed',
        description: error.message || 'Failed to delete order',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleApproveOrder = async (orderId: string, orderNo: string) => {
    if (!confirm(`Approve order ${orderNo}?\n\nThis will:\n• Change status to "Approved"\n• Generate Purchase Order document\n• Allow production to begin\n\nThis action cannot be undone.`)) {
      return
    }

    try {
      setLoading(true)

      // Call the orders_approve database function
      const { data, error } = await supabase
        .rpc('orders_approve', { p_order_id: orderId })

      if (error) throw error

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

    // D2H: HQ Power Users can approve
    if (order.order_type === 'D2H' && userOrgType === 'HQ') return true

    // S2D: Distributor (seller) Power Users can approve
    if (order.order_type === 'S2D' && order.seller_org_id === userProfile.organization_id) return true

    return false
  }

  // Helper function to check if user can delete orders (Super Admin only)
  const canDeleteOrder = (): boolean => {
    // Only Super Admin (role_level = 1) can delete orders
    return userProfile.roles.role_level === 1
  }

  useEffect(() => {
    loadOrders()
    loadSummary()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchQuery])

  const handleCreateOrder = () => {
    // Navigate to create order view
    if (onViewChange) {
      onViewChange('create-order')
    }
  }

  const loadOrders = async () => {
    try {
      setLoading(true)
      
      // Get company_id from current org
      const { data: companyData } = await supabase
        .rpc('get_company_id', { p_org_id: userProfile.organization_id })
      
      const companyId = companyData || userProfile.organization_id
      
      // First, get orders
      let query = supabase
        .from('orders')
        .select(`
          *,
          buyer_org:organizations!orders_buyer_org_id_fkey(id, org_name, org_code, org_type_code),
          seller_org:organizations!orders_seller_org_id_fkey(id, org_name, org_code, org_type_code),
          created_by_user:users!orders_created_by_fkey(id, email, full_name)
        `)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50)

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
          setOrders(ordersWithItems)
          return
        }
      }
      
      console.log('========================')
      setOrders(ordersData || [])
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
        <Button className="gap-2" onClick={handleCreateOrder}>
          <Plus className="w-4 h-4" />
          Create Order
        </Button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Orders</p>
                  <p className="text-2xl font-bold">{summary.total_orders}</p>
                </div>
                <FileText className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Draft</p>
                  <p className="text-2xl font-bold">{summary.draft_orders}</p>
                </div>
                <Edit className="w-8 h-8 text-gray-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Submitted</p>
                  <p className="text-2xl font-bold">{summary.submitted_orders}</p>
                </div>
                <Clock className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Approved</p>
                  <p className="text-2xl font-bold">{summary.approved_orders}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-2xl font-bold">
                    RM {summary.total_amount.toLocaleString('en-MY', { 
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2 
                    })}
                  </p>
                </div>
                <DollarSign className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and View Toggle */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search orders by order number or notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}
              className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="closed">Closed</option>
            </select>

            {/* View Mode Toggle */}
            <div className="flex border border-gray-300 rounded-md overflow-hidden">
              <Button
                variant={viewMode === 'cards' ? 'default' : 'ghost'}
                size="sm"
                className={`rounded-none ${viewMode === 'cards' ? 'bg-blue-600' : ''}`}
                onClick={() => setViewMode('cards')}
              >
                <Grid3x3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                className={`rounded-none ${viewMode === 'list' ? 'bg-blue-600' : ''}`}
                onClick={() => setViewMode('list')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>

            <Button variant="outline" className="gap-2">
              <Filter className="w-4 h-4" />
              More Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Orders List - Card Layout */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Orders</h2>
          {orders.length > 0 && (
            <span className="text-sm text-gray-500">{orders.length} orders found</span>
          )}
        </div>

        {orders.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No orders found</h3>
                <p className="text-gray-600 mb-4">
                  {searchQuery || statusFilter !== 'all' 
                    ? 'Try adjusting your filters' 
                    : 'Create your first order to get started'}
                </p>
                <Button className="gap-2" onClick={handleCreateOrder}>
                  <Plus className="w-4 h-4" />
                  Create Order
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : viewMode === 'list' ? (
          /* LIST VIEW */
          <div className="space-y-3">
            {orders.map((order) => {
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
                          <div className="font-bold text-blue-600 mb-1">{order.order_no}</div>
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
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {order.seller_org?.org_name || 'N/A'}
                            </div>
                          </div>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-6">
                          <div className="text-center">
                            <div className="text-xs text-gray-500">Items</div>
                            <div className="text-sm font-bold text-gray-900">{itemCount}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-gray-500">Units</div>
                            <div className="text-sm font-bold text-gray-900">{totalUnits}</div>
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

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          onClick={() => handleTrackOrder(order.id)}
                        >
                          <TrendingUp className="w-3 h-3" />
                          Track Order
                        </Button>
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
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canDeleteOrder() && (order.status === 'draft' || order.status === 'submitted') && (
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
            {orders.map((order) => {
              const totalAmount = calculateOrderTotal(order)
              const itemCount = order.order_items?.length || 0
              const totalUnits = order.order_items?.reduce((sum, item) => sum + item.qty, 0) || 0

              return (
                <Card key={order.id} className="hover:shadow-lg transition-shadow cursor-pointer">
                  <CardContent className="p-5">
                    {/* Header with Order Number and Status */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="font-bold text-blue-600 text-lg mb-1">
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
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {order.seller_org?.org_name || 'Unknown'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Order Stats */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-500 mb-1">Items</div>
                        <div className="text-lg font-bold text-gray-900">{itemCount}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-500 mb-1">Units</div>
                        <div className="text-lg font-bold text-gray-900">{totalUnits}</div>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-2 text-center">
                        <div className="text-xs text-blue-600 mb-1">Amount</div>
                        <div className="text-sm font-bold text-blue-700">
                          {formatCurrency(totalAmount)}
                        </div>
                      </div>
                    </div>

                    {/* Date and Notes */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Calendar className="w-3 h-3" />
                        <span>Created {new Date(order.created_at).toLocaleDateString('en-MY')}</span>
                      </div>
                      {order.notes && (
                        <div className="text-xs text-gray-500 line-clamp-2 bg-gray-50 p-2 rounded">
                          {order.notes}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1 text-xs h-8"
                        title="Track Order"
                        onClick={() => handleTrackOrder(order.id)}
                      >
                        <TrendingUp className="w-3 h-3" />
                        Track
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1 text-xs h-8"
                        title="View Details"
                      >
                        <Eye className="w-3 h-3" />
                        View
                      </Button>
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
                      {(order.status === 'draft' || order.status === 'submitted') && (
                        <>
                          {order.status === 'draft' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 gap-1 text-xs h-8"
                              title="Edit Order"
                            >
                              <Edit className="w-3 h-3" />
                              Edit
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
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
