'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Scan, Users, TrendingUp, Calendar, MapPin, Filter } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface UserProfile {
  id: string
  organization_id: string
  organizations: { id: string; org_name: string }
}

interface ConsumerActivationsViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function ConsumerActivationsView({ userProfile, onViewChange }: ConsumerActivationsViewProps) {
  const [activations, setActivations] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string>('all')
  const [selectedActivityType, setSelectedActivityType] = useState<string>('all')
  const [stats, setStats] = useState({
    total_scans: 0,
    unique_consumers: 0,
    total_points: 0,
    today_scans: 0
  })
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadOrders()
    loadActivations()
    loadStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId, selectedActivityType])

  const loadOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, created_at')
        .eq('company_id', userProfile.organizations.id)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      setOrders(data || [])
    } catch (error) {
      console.error('Error loading orders:', error)
    }
  }

  const loadActivations = async () => {
    try {
      // Query qr_codes directly as it now holds consumer data
      let query = supabase
        .from('qr_codes')
        .select(`
          id,
          consumer_name,
          consumer_phone,
          consumer_email,
          updated_at,
          redeemed_at,
          is_redeemed,
          is_lucky_draw_entered,
          is_points_collected,
          points_value,
          product_id,
          sequence_number,
          products ( product_name ),
          product_variants ( variant_name, image_url ),
          redeem_items ( item_name, item_image_url ),
          consumer_qr_scans ( location_lat, location_lng )
        `)
        .eq('company_id', userProfile.organizations.id)
        .or('is_redeemed.eq.true,is_lucky_draw_entered.eq.true,is_points_collected.eq.true')
        .order('updated_at', { ascending: false })
        .limit(100)

      if (selectedOrderId && selectedOrderId !== 'all') {
        query = query.eq('order_id', selectedOrderId)
      }

      if (selectedActivityType && selectedActivityType !== 'all') {
        if (selectedActivityType === 'lucky_draw') {
          query = query.eq('is_lucky_draw_entered', true)
        } else if (selectedActivityType === 'points') {
          query = query.eq('is_points_collected', true)
        } else if (selectedActivityType === 'gift') {
          query = query.eq('is_redeemed', true)
        }
      }

      const { data, error } = await query

      if (error) throw error
      
      const transformedData = data?.map((qr: any) => {
        // Get location from the most recent scan if available
        const lastScan = qr.consumer_qr_scans?.[0]
        const location = lastScan?.location_lat && lastScan?.location_lng 
          ? `${lastScan.location_lat.toFixed(4)}, ${lastScan.location_lng.toFixed(4)}`
          : null

        return {
          id: qr.id,
          consumer_name: qr.consumer_name || 'Anonymous',
          consumer_phone: qr.consumer_phone,
          consumer_email: qr.consumer_email,
          activated_at: qr.redeemed_at || qr.updated_at,
          points_awarded: qr.is_points_collected ? (qr.points_value || 0) : 0,
          lucky_draw_entered: qr.is_lucky_draw_entered,
          gift_redeemed: qr.is_redeemed,
          activation_location: location,
          product_name: qr.products?.product_name || 'Unknown Product',
          variant_name: qr.product_variants?.variant_name,
          variant_image: qr.product_variants?.image_url,
          sequence_number: qr.sequence_number,
          gift_name: qr.redeem_items?.item_name,
          gift_image: qr.redeem_items?.item_image_url
        }
      }) || []
      
      setActivations(transformedData)
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      // Base query builder
      const getBaseQuery = () => {
        let q = supabase
          .from('qr_codes')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', userProfile.organizations.id)
          .or('is_redeemed.eq.true,is_lucky_draw_entered.eq.true,is_points_collected.eq.true')
        
        if (selectedOrderId && selectedOrderId !== 'all') {
          q = q.eq('order_id', selectedOrderId)
        }
        return q
      }

      // Total scans (activations)
      const { count: totalScans } = await getBaseQuery()

      // Unique consumers
      let uniqueQuery = supabase
        .from('qr_codes')
        .select('consumer_phone')
        .eq('company_id', userProfile.organizations.id)
        .not('consumer_phone', 'is', null)
      
      if (selectedOrderId && selectedOrderId !== 'all') {
        uniqueQuery = uniqueQuery.eq('order_id', selectedOrderId)
      }

      const { data: uniqueConsumers } = await uniqueQuery
      const uniqueCount = new Set(uniqueConsumers?.map((c: any) => c.consumer_phone)).size

      // Total points
      let pointsQuery = supabase
        .from('qr_codes')
        .select('points_value')
        .eq('company_id', userProfile.organizations.id)
        .eq('is_points_collected', true)

      if (selectedOrderId && selectedOrderId !== 'all') {
        pointsQuery = pointsQuery.eq('order_id', selectedOrderId)
      }

      const { data: pointsData } = await pointsQuery
      const totalPoints = pointsData?.reduce((sum: number, qr: any) => sum + (qr.points_value || 0), 0) || 0

      // Today's scans
      const today = new Date().toISOString().split('T')[0]
      let todayQuery = getBaseQuery().gte('updated_at', `${today}T00:00:00`)
      const { count: todayScans } = await todayQuery

      setStats({
        total_scans: totalScans || 0,
        unique_consumers: uniqueCount,
        total_points: totalPoints,
        today_scans: todayScans || 0
      })
    } catch (error: any) {
      console.error('Error loading stats:', error)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Consumer Activations</h1>
            <p className="text-gray-600 mt-1">Track consumer QR code scans and engagement</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <div className="w-full sm:w-48">
              <Select value={selectedActivityType} onValueChange={setSelectedActivityType}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-gray-500" />
                    <SelectValue placeholder="Activity Type" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Activities</SelectItem>
                  <SelectItem value="lucky_draw">Lucky Draw</SelectItem>
                  <SelectItem value="points">Points Collected</SelectItem>
                  <SelectItem value="gift">Gift Redeemed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-64">
              <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-gray-500" />
                    <SelectValue placeholder="Filter by Order" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Orders</SelectItem>
                  {orders.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="mb-2 sm:mb-0">
                <p className="text-xs sm:text-sm text-gray-600">Total Scans</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.total_scans}</p>
              </div>
              <Scan className="h-6 w-6 sm:h-8 sm:w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="mb-2 sm:mb-0">
                <p className="text-xs sm:text-sm text-gray-600">Unique Consumers</p>
                <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.unique_consumers}</p>
              </div>
              <Users className="h-6 w-6 sm:h-8 sm:w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="mb-2 sm:mb-0">
                <p className="text-xs sm:text-sm text-gray-600">Points Distributed</p>
                <p className="text-xl sm:text-2xl font-bold text-purple-600">{stats.total_points}</p>
              </div>
              <TrendingUp className="h-6 w-6 sm:h-8 sm:w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="mb-2 sm:mb-0">
                <p className="text-xs sm:text-sm text-gray-600">Today&apos;s Scans</p>
                <p className="text-xl sm:text-2xl font-bold text-orange-600">{stats.today_scans}</p>
              </div>
              <Calendar className="h-6 w-6 sm:h-8 sm:w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activations */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Consumer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sequence</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Points</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lucky Draw</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gift</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {activations.map((activation) => (
                  <tr key={activation.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <div className="flex flex-col">
                        <span className="font-medium">{new Date(activation.activated_at).toLocaleDateString()}</span>
                        <span className="text-xs text-gray-500">{new Date(activation.activated_at).toLocaleTimeString()}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {activation.consumer_name || 'Anonymous'}
                        </p>
                        <p className="text-xs text-gray-500">{activation.consumer_phone}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {activation.variant_image && (
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={activation.variant_image} alt={activation.variant_name} />
                            <AvatarFallback>{activation.variant_name?.charAt(0)}</AvatarFallback>
                          </Avatar>
                        )}
                        <div>
                          <p className="text-sm font-medium text-gray-900">{activation.product_name}</p>
                          {activation.variant_name && (
                            <p className="text-xs text-gray-500">{activation.variant_name}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {activation.sequence_number || '-'}
                    </td>
                    <td className="px-4 py-3">
                      {activation.points_awarded > 0 ? (
                        <Badge variant="default" className="bg-green-100 text-green-800">
                          +{activation.points_awarded}
                        </Badge>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {activation.lucky_draw_entered ? (
                        <Badge variant="default" className="bg-purple-100 text-purple-800">
                          Entered
                        </Badge>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {activation.gift_redeemed ? (
                        <div className="flex items-center gap-2">
                          {activation.gift_image && (
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={activation.gift_image} alt={activation.gift_name} />
                              <AvatarFallback>G</AvatarFallback>
                            </Avatar>
                          )}
                          <Badge variant="default" className="bg-blue-100 text-blue-800">
                            {activation.gift_name || 'Redeemed'}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {activation.activation_location ? (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-gray-400" />
                          <span className="text-xs">{activation.activation_location}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
