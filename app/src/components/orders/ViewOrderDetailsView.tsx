'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Package, Building2, Calendar, DollarSign, Sparkles, Gift, Trophy, QrCode, FileText } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { formatNumber, formatCurrency as formatCurrencyUtil } from '@/lib/utils/formatters'
import OrderDocumentsDialogEnhanced from '@/components/dashboard/views/orders/OrderDocumentsDialogEnhanced'

interface UserProfile {
  id: string
  email: string
  organization_id: string
  organizations: {
    org_name: string
    org_code: string
    org_type_code: string
  }
  roles: {
    role_level: number
  }
}

interface ViewOrderDetailsViewProps {
  userProfile: UserProfile
  onViewChange?: (view: string) => void
}

export default function ViewOrderDetailsView({ userProfile, onViewChange }: ViewOrderDetailsViewProps) {
  const [orderData, setOrderData] = useState<any>(null)
  const [journeyData, setJourneyData] = useState<any>(null)
  const [qrStats, setQrStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    const orderId = sessionStorage.getItem('viewOrderId')
    if (orderId) {
      loadOrderData(orderId)
      loadJourneyData(orderId)
      loadQRStats(orderId)
    } else {
      toast({
        title: 'Error',
        description: 'No order ID found',
        variant: 'destructive'
      })
      handleBack()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadOrderData(orderId: string) {
    try {
      setLoading(true)
      
      // Fetch order data
      const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single()

      if (error) throw error
      if (!order) throw new Error('Order not found')

      // Load buyer org
      const { data: buyerOrg } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', order.buyer_org_id)
        .single()

      // Load seller org
      const { data: sellerOrg } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', order.seller_org_id)
        .single()

      // Load created by user
      const { data: createdByUser } = await supabase
        .from('users')
        .select('full_name, email')
        .eq('id', order.created_by)
        .single()

      // Load order items
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId)

      // Load product details for each item
      const itemsWithDetails = await Promise.all(
        (orderItems || []).map(async (item: any) => {
          const { data: product } = await supabase
            .from('products')
            .select('product_name, product_code')
            .eq('id', item.product_id)
            .single()

          const { data: variant } = await supabase
            .from('product_variants')
            .select('variant_name')
            .eq('id', item.variant_id)
            .single()

          return {
            ...item,
            product,
            variant
          }
        })
      )

      // Combine all data
      const completeOrderData = {
        ...order,
        buyer_org: buyerOrg,
        seller_org: sellerOrg,
        created_by_user: createdByUser,
        order_items: itemsWithDetails
      }

      console.log('✅ Complete order data loaded:', completeOrderData)
      setOrderData(completeOrderData)
    } catch (error: any) {
      console.error('Error loading order:', error?.message || 'Unknown error', error)
      toast({
        title: 'Error',
        description: error?.message || 'Failed to load order details',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }
  
  async function loadJourneyData(orderId: string) {
    try {
      // Get journey configuration linked to this order
      const { data: link, error: linkError } = await supabase
        .from('journey_order_links')
        .select('journey_config_id')
        .eq('order_id', orderId)
        .maybeSingle()
      
      if (linkError) {
        if (linkError.code !== 'PGRST116') {
          console.error('Error loading journey link:', linkError.message || linkError.code || 'Unknown error', linkError)
        }
        return
      }

      if (!link) {
        return // No journey linked to this order
      }

      // Get journey configuration details
      const { data: journeyConfig, error: configError } = await supabase
        .from('journey_configurations')
        .select('*')
        .eq('id', link.journey_config_id)
        .eq('is_active', true)
        .maybeSingle()
      
      if (configError) {
        if (configError.code !== 'PGRST116') {
          console.error('Error loading journey config:', configError.message || configError.code || 'Unknown error', configError)
        }
        return
      }

      console.log('Journey config loaded:', journeyConfig)
      setJourneyData(journeyConfig)
    } catch (error: any) {
      console.error('Error loading journey data:', error?.message || 'Unknown error', error)
    }
  }
  
  async function loadQRStats(orderId: string) {
    try {
      // Get batch ID from order
      const { data: batch, error: batchError } = await supabase
        .from('qr_batches')
        .select('id')
        .eq('order_id', orderId)
        .maybeSingle()
      
      if (batchError) {
        if (batchError.code !== 'PGRST116') {
          console.error('Error loading batch:', batchError.message || batchError.code || 'Unknown error', batchError)
        }
        return
      }
      
      if (!batch) {
        // No batch found, set default stats
        setQrStats({
          validLinks: 0,
          scanned: 0,
          redemptions: 0,
          luckyDraws: 0
        })
        return
      }
      
      // Get QR codes stats
      const { data: codes, error } = await supabase
        .from('qr_codes')
        .select('id, status')
        .eq('batch_id', batch.id)
      
      if (error) {
        console.error('Error loading QR codes:', error.message || error.code || 'Unknown error', error)
        return
      }
      
      const validLinks = codes?.length || 0
      const scanned = codes?.filter(c => c.status !== 'pending' && c.status !== 'printed').length || 0
      
      // Get redemptions count from consumer_qr_scans where reward was redeemed
      const { count: redemptionCount } = await supabase
        .from('consumer_qr_scans')
        .select('id', { count: 'exact', head: true })
        .in('qr_code_id', codes?.map(c => c.id) || [])
        .not('redeemed_at', 'is', null)
      
      // Get lucky draw entries
      const { count: luckyDrawCount } = await supabase
        .from('lucky_draw_entries')
        .select('id', { count: 'exact', head: true })
        .in('qr_code_id', codes?.map(c => c.id) || [])
      
      setQrStats({
        validLinks,
        scanned,
        redemptions: redemptionCount || 0,
        luckyDraws: luckyDrawCount || 0
      })
    } catch (error: any) {
      console.error('Error loading QR stats:', error?.message || 'Unknown error', error)
      // Set default stats on error
      setQrStats({
        validLinks: 0,
        scanned: 0,
        redemptions: 0,
        luckyDraws: 0
      })
    }
  }

  const handleBack = () => {
    sessionStorage.removeItem('viewOrderId')
    if (onViewChange) {
      onViewChange('orders')
    }
  }

  const formatCurrency = (amount: number): string => {
    return formatCurrencyUtil(amount)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading order details...</p>
        </div>
      </div>
    )
  }

  if (!orderData) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Order not found</p>
        <Button onClick={handleBack} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Orders
        </Button>
      </div>
    )
  }

  const subtotal = orderData.order_items?.reduce((sum: number, item: any) => sum + (item.line_total || 0), 0) || 0
  const totalQuantity = orderData.order_items?.reduce((sum: number, item: any) => sum + (item.qty || 0), 0) || 0
  const bufferPercent = orderData.qr_buffer_percent || 10
  const bufferQty = Math.floor(totalQuantity * bufferPercent / 100)
  const uniqueQR = totalQuantity + bufferQty
  const masterQR = Math.ceil(totalQuantity / (orderData.units_per_case || 100)) // Based on base units only, not buffer

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" onClick={handleBack} className="mb-2">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Orders
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">{orderData.order_no}</h1>
          <p className="text-gray-600 mt-1">{orderData.order_type} • {orderData.buyer_org?.org_name} → {orderData.seller_org?.org_name}</p>
        </div>
        <div>
          <Badge 
            variant={orderData.status === 'approved' ? 'default' : 'secondary'}
            className="text-sm px-3 py-1 font-medium"
          >
            {orderData.status?.toUpperCase()}
          </Badge>
        </div>
      </div>

      {/* Order Summary - Similar to TrackOrderView */}
      {orderData && (
        <Card>
          <CardHeader className="border-b bg-gray-50">
            <CardTitle className="text-lg">Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Buyer */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Buyer</p>
                <p className="font-semibold text-gray-900">{orderData?.buyer_org?.org_name || 'N/A'}</p>
              </div>
            </div>

            {/* Seller */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Building2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Seller</p>
                <p className="font-semibold text-gray-900">{orderData?.seller_org?.org_name || 'N/A'}</p>
              </div>
            </div>

            {/* Total Items */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Package className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Items</p>
                <p className="font-semibold text-gray-900">{formatNumber(totalQuantity)} units</p>
              </div>
            </div>

            {/* Total Amount */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Amount</p>
                <p className="font-semibold text-gray-900">RM {formatCurrency(subtotal)}</p>
              </div>
            </div>

            {/* Created Date */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Calendar className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Created Date</p>
                <p className="font-semibold text-gray-900">{orderData?.created_at ? new Date(orderData.created_at).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}</p>
              </div>
            </div>
          </div>

          {/* Order Configuration */}
          <div className="mt-6 pt-6 border-t">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Order Configuration</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Lucky Draw */}
              {orderData.enable_lucky_draw && (
                <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <Trophy className="w-4 h-4 text-purple-600" />
                  <div>
                    <p className="text-xs text-purple-600 font-medium">🎰 Lucky Draw</p>
                    <p className="text-xs text-purple-700">Enabled</p>
                  </div>
                </div>
              )}

              {/* Redeem */}
              {orderData.enable_redeem && (
                <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <Gift className="w-4 h-4 text-orange-600" />
                  <div>
                    <p className="text-xs text-orange-600 font-medium">🎁 Redeem</p>
                    <p className="text-xs text-orange-700">Enabled</p>
                  </div>
                </div>
              )}

              {/* Points */}
              {orderData.has_points !== false && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <div>
                    <p className="text-xs text-blue-600 font-medium">💎 Points</p>
                    <p className="text-xs text-blue-700">Enabled</p>
                  </div>
                </div>
              )}

              {/* Units/Case */}
              <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <Package className="w-4 h-4 text-gray-600" />
                <div>
                  <p className="text-xs text-gray-600 font-medium">📦 Units/Case</p>
                  <p className="text-xs text-gray-700">{orderData.units_per_case || 100}</p>
                </div>
              </div>

              {/* QR Buffer */}
              <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <QrCode className="w-4 h-4 text-gray-600" />
                <div>
                  <p className="text-xs text-gray-600 font-medium">📊 QR Buffer</p>
                  <p className="text-xs text-gray-700">{orderData.qr_buffer_percent || 10}%</p>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {orderData.notes && (
            <div className="mt-6 pt-6 border-t">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Notes</h4>
              <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{orderData.notes}</p>
            </div>
          )}

          {/* Customer Information if available */}
          {(orderData.customer_name || orderData.phone_number || orderData.delivery_address) && (
            <div className="mt-6 pt-6 border-t">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Customer Information</h4>
              <div className="grid md:grid-cols-3 gap-4">
                {orderData.customer_name && (
                  <div>
                    <p className="text-xs text-gray-600">Customer Name</p>
                    <p className="text-sm font-medium text-gray-900">{orderData.customer_name}</p>
                  </div>
                )}
                {orderData.phone_number && (
                  <div>
                    <p className="text-xs text-gray-600">Phone Number</p>
                    <p className="text-sm font-medium text-gray-900">{orderData.phone_number}</p>
                  </div>
                )}
                {orderData.delivery_address && (
                  <div className="md:col-span-3">
                    <p className="text-xs text-gray-600">Delivery Address</p>
                    <p className="text-sm font-medium text-gray-900">{orderData.delivery_address}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Order Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Order Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Order Number</label>
              <p className="text-lg font-semibold text-blue-600">{orderData.order_no}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Order Type</label>
              <p className="text-sm">{orderData.order_type}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Created</label>
              <p className="text-sm flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {new Date(orderData.created_at).toLocaleDateString('en-MY')}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Created By</label>
              <p className="text-sm">{orderData.created_by_user?.full_name || 'N/A'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Units Per Case</label>
              <p className="text-sm">{orderData.units_per_case || 100}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">QR Buffer</label>
              <p className="text-sm">{orderData.qr_buffer_percent || 10}%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organizations */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              Buyer Organization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <label className="text-sm font-medium text-gray-700">Organization</label>
                <p className="text-sm">{orderData.buyer_org?.org_name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Code</label>
                <p className="text-sm">{orderData.buyer_org?.org_code}</p>
              </div>
              {orderData.buyer_org?.address && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Address</label>
                  <p className="text-sm">{orderData.buyer_org.address}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-green-600" />
              Seller Organization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <label className="text-sm font-medium text-gray-700">Organization</label>
                <p className="text-sm">{orderData.seller_org?.org_name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Code</label>
                <p className="text-sm">{orderData.seller_org?.org_code}</p>
              </div>
              {orderData.seller_org?.address && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Address</label>
                  <p className="text-sm">{orderData.seller_org.address}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <CardTitle>Order Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Variant</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Quantity</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Unit Price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {orderData.order_items?.map((item: any, index: number) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-sm">{index + 1}</td>
                    <td className="px-4 py-3 text-sm">{item.product?.product_name || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm">{item.variant?.variant_name || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm text-right">{formatNumber(item.qty)}</td>
                    <td className="px-4 py-3 text-sm text-right">{formatCurrency(item.unit_price)}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Order Summary Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Order Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-lg font-bold">Grand Total:</span>
                <span className="text-lg font-bold text-blue-600">{formatCurrency(subtotal)}</span>
              </div>
            </div>
            
            {/* Journey Features - based on order configuration */}
            <div className="mt-6 pt-6 border-t">
              <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                Features
              </h4>
              <div className="flex flex-wrap gap-2">
                {/* Show features based on order has_lucky_draw and has_redeem flags */}
                {!orderData.has_lucky_draw && !orderData.has_redeem && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    <Package className="w-3 h-3 mr-1" />
                    Points (default)
                  </Badge>
                )}
                {orderData.has_lucky_draw && (
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                    <Trophy className="w-3 h-3 mr-1" />
                    Lucky Draw
                  </Badge>
                )}
                {orderData.has_redeem && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <Gift className="w-3 h-3 mr-1" />
                    Redemption
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* QR Code Requirements & Statistics Combined */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5" />
              QR Code Requirements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Order Quantity:</span>
                <span className="font-medium">{formatNumber(totalQuantity)} units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Buffer ({bufferPercent}%):</span>
                <span className="font-medium">{formatNumber(bufferQty)} units (unassigned spares)</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-gray-700 font-medium">Total Unique QR Codes:</span>
                <span className="font-bold text-blue-600">{formatNumber(uniqueQR)} ({formatNumber(totalQuantity)} + {formatNumber(bufferQty)})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700 font-medium">Master QR Codes (Cases):</span>
                <span className="font-bold text-green-600">{formatNumber(masterQR)} cases</span>
              </div>
              
              {/* QR Code Statistics */}
              {qrStats && (
                <div className="mt-6 pt-6 border-t">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">QR Code Statistics</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                      <div className="flex items-center gap-2 mb-1">
                        <QrCode className="w-4 h-4 text-blue-600" />
                        <span className="text-xs text-blue-700 font-medium">Valid Links</span>
                      </div>
                      <p className="text-2xl font-bold text-blue-900">{formatNumber(qrStats.validLinks)}</p>
                    </div>
                    
                    <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                      <div className="flex items-center gap-2 mb-1">
                        <Package className="w-4 h-4 text-green-600" />
                        <span className="text-xs text-green-700 font-medium">Scanned</span>
                      </div>
                      <p className="text-2xl font-bold text-green-900">{formatNumber(qrStats.scanned)}</p>
                    </div>
                    
                    {/* Only show Redemptions if order has redemption feature */}
                    {orderData.has_redeem && (
                      <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                        <div className="flex items-center gap-2 mb-1">
                          <Gift className="w-4 h-4 text-purple-600" />
                          <span className="text-xs text-purple-700 font-medium">Redemptions</span>
                        </div>
                        <p className="text-2xl font-bold text-purple-900">{formatNumber(qrStats.redemptions)}</p>
                      </div>
                    )}
                    
                    {/* Only show Lucky Draw if order has lucky draw feature */}
                    {orderData.has_lucky_draw && (
                      <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                        <div className="flex items-center gap-2 mb-1">
                          <Trophy className="w-4 h-4 text-amber-600" />
                          <span className="text-xs text-amber-700 font-medium">Lucky Draw</span>
                        </div>
                        <p className="text-2xl font-bold text-amber-900">{formatNumber(qrStats.luckyDraws)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              <div className="bg-amber-50 border border-amber-200 rounded p-3 mt-3">
                <p className="text-xs text-amber-800">
                  <strong>Note:</strong> Buffer codes ({formatNumber(bufferQty)}) are unassigned spares for damaged/lost QR codes. 
                  Master cases are calculated based on order quantity only ({formatNumber(totalQuantity)} ÷ {formatNumber(orderData.units_per_case || 100)} = {formatNumber(masterQR)} cases).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      {orderData.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700">{orderData.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* View Documents Button */}
      <Card>
        <CardContent className="pt-6">
          <Button 
            onClick={() => setDocumentsDialogOpen(true)}
            className="w-full gap-2 bg-blue-600 hover:bg-blue-700"
            size="lg"
          >
            <FileText className="w-5 h-5" />
            View Order Documents
          </Button>
          <p className="text-sm text-center text-gray-600 mt-3">
            View and manage all documents including Purchase Orders, Invoices, Payments, and Receipts
          </p>
        </CardContent>
      </Card>

      {/* Order Documents Dialog */}
      {orderData && (
        <OrderDocumentsDialogEnhanced
          orderId={orderData.id}
          orderNo={orderData.order_no}
          userProfile={userProfile}
          open={documentsDialogOpen}
          onClose={() => setDocumentsDialogOpen(false)}
        />
      )}
    </div>
  )
}
