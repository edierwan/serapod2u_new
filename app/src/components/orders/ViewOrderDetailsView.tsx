'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Package, Building2, Calendar, DollarSign, Sparkles, Gift, Trophy, QrCode } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

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
      
      // Fetch order with all related data
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          buyer_org:organizations!orders_buyer_org_id_fkey(org_name, org_code, address, contact_phone, contact_email),
          seller_org:organizations!orders_seller_org_id_fkey(org_name, org_code, address, contact_phone, contact_email),
          created_by_user:users!orders_created_by_fkey(full_name, email),
          order_items(
            *,
            product:products(product_name, product_code),
            variant:product_variants(variant_name)
          )
        `)
        .eq('id', orderId)
        .single()

      if (error) throw error
      setOrderData(data)
    } catch (error: any) {
      console.error('Error loading order:', error)
      toast({
        title: 'Error',
        description: 'Failed to load order details',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }
  
  async function loadJourneyData(orderId: string) {
    try {
      const { data, error } = await supabase
        .from('consumer_journeys')
        .select('*')
        .eq('order_id', orderId)
        .eq('is_active', true)
        .maybeSingle()
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error loading journey data:', error)
        return
      }
      setJourneyData(data)
    } catch (error: any) {
      console.error('Error loading journey data:', error)
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
      
      if (batchError && batchError.code !== 'PGRST116') {
        console.error('Error loading batch:', batchError)
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
        .select('id, status, is_redemption_completed')
        .eq('batch_id', batch.id)
      
      if (error) {
        console.error('Error loading QR codes:', error)
        return
      }
      
      const validLinks = codes?.length || 0
      const scanned = codes?.filter(c => c.status !== 'pending' && c.status !== 'printed').length || 0
      const redemptions = codes?.filter(c => c.is_redemption_completed).length || 0
      
      // Get lucky draw entries
      const { count: luckyDrawCount } = await supabase
        .from('lucky_draw_entries')
        .select('id', { count: 'exact', head: true })
        .in('qr_code_id', codes?.map(c => c.id) || [])
      
      setQrStats({
        validLinks,
        scanned,
        redemptions,
        luckyDraws: luckyDrawCount || 0
      })
    } catch (error: any) {
      console.error('Error loading QR stats:', error)
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
    return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
          <h1 className="text-2xl font-bold text-gray-900">Order Details (Read-Only)</h1>
          <p className="text-gray-600 mt-1">View complete order information</p>
        </div>
        <div>
          <Badge className="text-lg px-4 py-2">
            {orderData.status?.toUpperCase()}
          </Badge>
        </div>
      </div>

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
                    <td className="px-4 py-3 text-sm text-right">{item.qty}</td>
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
            
            {/* Journey Features - if active */}
            {journeyData && (
              <div className="mt-6 pt-6 border-t">
                <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  Features
                </h4>
                <div className="flex flex-wrap gap-2">
                  {journeyData.enable_points && (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                      <Package className="w-3 h-3 mr-1" />
                      Points
                    </Badge>
                  )}
                  {journeyData.enable_lucky_draw && (
                    <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                      <Trophy className="w-3 h-3 mr-1" />
                      Lucky Draw
                    </Badge>
                  )}
                  {journeyData.enable_redemption && (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      <Gift className="w-3 h-3 mr-1" />
                      Redemption
                    </Badge>
                  )}
                  {!journeyData.enable_points && !journeyData.enable_lucky_draw && !journeyData.enable_redemption && (
                    <span className="text-xs text-gray-500">Points (default)</span>
                  )}
                </div>
              </div>
            )}
            {!journeyData && (
              <div className="mt-6 pt-6 border-t">
                <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  Features
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    <Package className="w-3 h-3 mr-1" />
                    Points (default)
                  </Badge>
                </div>
              </div>
            )}
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
                <span className="font-medium">{totalQuantity} units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Buffer ({bufferPercent}%):</span>
                <span className="font-medium">{bufferQty} units (unassigned spares)</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-gray-700 font-medium">Total Unique QR Codes:</span>
                <span className="font-bold text-blue-600">{uniqueQR} ({totalQuantity} + {bufferQty})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700 font-medium">Master QR Codes (Cases):</span>
                <span className="font-bold text-green-600">{masterQR} cases</span>
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
                      <p className="text-2xl font-bold text-blue-900">{qrStats.validLinks}</p>
                    </div>
                    
                    <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                      <div className="flex items-center gap-2 mb-1">
                        <Package className="w-4 h-4 text-green-600" />
                        <span className="text-xs text-green-700 font-medium">Scanned</span>
                      </div>
                      <p className="text-2xl font-bold text-green-900">{qrStats.scanned}</p>
                    </div>
                    
                    <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                      <div className="flex items-center gap-2 mb-1">
                        <Gift className="w-4 h-4 text-purple-600" />
                        <span className="text-xs text-purple-700 font-medium">Redemptions</span>
                      </div>
                      <p className="text-2xl font-bold text-purple-900">{qrStats.redemptions}</p>
                    </div>
                    
                    <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                      <div className="flex items-center gap-2 mb-1">
                        <Trophy className="w-4 h-4 text-amber-600" />
                        <span className="text-xs text-amber-700 font-medium">Lucky Draw</span>
                      </div>
                      <p className="text-2xl font-bold text-amber-900">{qrStats.luckyDraws}</p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="bg-amber-50 border border-amber-200 rounded p-3 mt-3">
                <p className="text-xs text-amber-800">
                  <strong>Note:</strong> Buffer codes ({bufferQty}) are unassigned spares for damaged/lost QR codes. 
                  Master cases are calculated based on order quantity only ({totalQuantity} ÷ {orderData.units_per_case || 100} = {masterQR} cases).
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
    </div>
  )
}
