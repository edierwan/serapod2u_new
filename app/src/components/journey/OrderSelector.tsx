'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Package, 
  Gift, 
  Trophy, 
  Check, 
  AlertCircle,
  RefreshCw,
  ChevronDown
} from 'lucide-react'

interface Order {
  id: string
  order_no: string
  order_type: string
  status: string
  has_redeem: boolean
  has_lucky_draw: boolean
  redeem_gifts_count?: number
  lucky_draw_campaigns_count?: number
  existing_journey_id?: string
  existing_journey_name?: string
  buyer_org_name?: string
  seller_org_name?: string
  created_at: string
}

interface OrderSelectorProps {
  selectedOrderId: string | null
  onOrderSelect: (order: Order | null) => void
}

export default function OrderSelector({ selectedOrderId, onOrderSelect }: OrderSelectorProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [showDropdown, setShowDropdown] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedOrder = orders.find(o => o.id === selectedOrderId)

  useEffect(() => {
    fetchEligibleOrders()
  }, [])

  const fetchEligibleOrders = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/journey/orders')
      const data = await response.json()
      
      if (data.success) {
        setOrders(data.orders || [])
      } else {
        setError(data.error || 'Failed to load orders')
      }
    } catch (err) {
      console.error('Error fetching orders:', err)
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectOrder = (order: Order) => {
    onOrderSelect(order)
    setShowDropdown(false)
  }

  const handleClearSelection = () => {
    onOrderSelect(null)
    setShowDropdown(false)
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select Order</CardTitle>
          <CardDescription>Loading available orders...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="flex items-center justify-between">
          <span className="text-red-800">{error}</span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchEligibleOrders}
          >
            <RefreshCw className="w-3 h-3 mr-2" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (orders.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="space-y-2">
            <p className="font-medium">No eligible orders found</p>
            <p className="text-sm text-gray-600">
              To create a journey, you need an order with:
            </p>
            <ul className="text-sm text-gray-600 list-disc list-inside ml-2">
              <li>Redeem Gifts enabled (has_redeem = true), OR</li>
              <li>Lucky Draw enabled (has_lucky_draw = true)</li>
            </ul>
            <p className="text-sm text-gray-600 mt-2">
              Create an order with these features in Order Management first.
            </p>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {/* Order Selection Card */}
      <Card className="border-2 border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            Step 1: Select Order
          </CardTitle>
          <CardDescription>
            Choose an order to create or manage its consumer journey
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Dropdown Button */}
          <div className="relative">
            <Button
              variant={selectedOrder ? "outline" : "default"}
              className="w-full justify-between"
              onClick={() => setShowDropdown(!showDropdown)}
            >
              <span>
                {selectedOrder ? selectedOrder.order_no : 'Select an order...'}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </Button>

            {/* Dropdown List */}
            {showDropdown && (
              <div className="absolute z-50 w-full mt-2 bg-white border rounded-lg shadow-lg max-h-96 overflow-y-auto">
                {orders.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => handleSelectOrder(order)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-b-0 transition-colors ${
                      selectedOrderId === order.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900">
                            {order.order_no}
                          </span>
                          {selectedOrderId === order.id && (
                            <Check className="w-4 h-4 text-blue-600" />
                          )}
                        </div>
                        
                        <div className="flex flex-wrap gap-1 mb-2">
                          <Badge variant="outline" className="text-xs">
                            {order.order_type}
                          </Badge>
                          <Badge 
                            variant={order.status === 'approved' ? 'default' : 'secondary'}
                            className={`text-xs ${order.status === 'approved' ? 'bg-green-100 text-green-800' : ''}`}
                          >
                            {order.status}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          {order.has_redeem && (
                            <span className="flex items-center gap-1 text-green-600">
                              <Gift className="w-3 h-3" />
                              {order.redeem_gifts_count || 0} Gifts
                            </span>
                          )}
                          {order.has_lucky_draw && (
                            <span className="flex items-center gap-1 text-purple-600">
                              <Trophy className="w-3 h-3" />
                              {order.lucky_draw_campaigns_count || 0} Campaigns
                            </span>
                          )}
                        </div>
                      </div>

                      {order.existing_journey_id && (
                        <Badge className="text-xs shrink-0 bg-green-100 text-green-800">
                          Has Journey
                        </Badge>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear Selection */}
          {selectedOrder && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearSelection}
              className="w-full"
            >
              Clear Selection
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Selected Order Info */}
      {selectedOrder && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-900 flex items-center gap-2">
              <Check className="w-5 h-5" />
              Selected Order: {selectedOrder.order_no}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Order Details */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Type:</span>
                <Badge variant="outline" className="ml-2">
                  {selectedOrder.order_type}
                </Badge>
              </div>
              <div>
                <span className="text-gray-600">Status:</span>
                <Badge 
                  variant={selectedOrder.status === 'approved' ? 'default' : 'secondary'}
                  className={`ml-2 ${selectedOrder.status === 'approved' ? 'bg-green-100 text-green-800' : ''}`}
                >
                  {selectedOrder.status}
                </Badge>
              </div>
            </div>

            {/* Engagement Features */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Engagement Features:</p>
              
              {selectedOrder.has_redeem ? (
                <div className="flex items-center gap-2 text-sm bg-green-100 px-3 py-2 rounded-lg">
                  <Gift className="w-4 h-4 text-green-600" />
                  <span className="font-medium text-green-900">
                    Redeem Gifts Enabled
                  </span>
                  <Badge className="ml-auto bg-green-200 text-green-900">
                    {selectedOrder.redeem_gifts_count || 0} Gifts
                  </Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-gray-500 px-3 py-2">
                  <Gift className="w-4 h-4" />
                  <span>Redeem Gifts Not Enabled</span>
                </div>
              )}

              {selectedOrder.has_lucky_draw ? (
                <div className="flex items-center gap-2 text-sm bg-purple-100 px-3 py-2 rounded-lg">
                  <Trophy className="w-4 h-4 text-purple-600" />
                  <span className="font-medium text-purple-900">
                    Lucky Draw Enabled
                  </span>
                  <Badge variant="secondary" className="ml-auto bg-purple-200">
                    {selectedOrder.lucky_draw_campaigns_count || 0} Campaigns
                  </Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-gray-500 px-3 py-2">
                  <Trophy className="w-4 h-4" />
                  <span>Lucky Draw Not Enabled</span>
                </div>
              )}
            </div>

            {/* Existing Journey */}
            {selectedOrder.existing_journey_id ? (
              <Alert>
                <Check className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium">Journey Already Configured</p>
                  <p className="text-sm text-gray-600">
                    &ldquo;{selectedOrder.existing_journey_name}&rdquo;
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    You can edit it or create additional pages below.
                  </p>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium">No Journey Configured Yet</p>
                  <p className="text-sm text-gray-600">
                    Create a new journey for this order below.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
