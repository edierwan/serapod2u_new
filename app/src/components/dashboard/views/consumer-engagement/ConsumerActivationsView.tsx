'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Scan, Users, TrendingUp, Calendar, MapPin, Filter, ArrowUpDown, ChevronLeft, ChevronRight, Trophy, MessageSquare, Clock, CheckCircle2, Eye, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface UserProfile {
  id: string
  organization_id: string
  organizations: { id: string; org_name: string }
  roles?: { role_name: string; role_level: number }
}

interface ConsumerActivationsViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function ConsumerActivationsView({ userProfile, onViewChange }: ConsumerActivationsViewProps) {
  const organizationId = userProfile.organization_id
  const [activeTab, setActiveTab] = useState<'activations' | 'feedback'>('activations')
  const [activations, setActivations] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string>('all')
  const [selectedActivityType, setSelectedActivityType] = useState<string>('all')

  // Filters
  const [filterProduct, setFilterProduct] = useState('all')
  const [filterMMYY, setFilterMMYY] = useState('')
  const [filterConsumer, setFilterConsumer] = useState('')
  const [filterShop, setFilterShop] = useState('')

  // Column ordering for drag-and-drop
  const [columnOrder, setColumnOrder] = useState(['order', 'product'])
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)

  // Sorting & Pagination
  const [sortColumn, setSortColumn] = useState('updated_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalCount, setTotalCount] = useState(0)

  // Feedback state
  const [feedback, setFeedback] = useState<any[]>([])
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [feedbackSummary, setFeedbackSummary] = useState({ total: 0, pending: 0, reviewed: 0, resolved: 0 })
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<string>('all')
  const [feedbackPage, setFeedbackPage] = useState(1)
  const [feedbackTotal, setFeedbackTotal] = useState(0)
  const [selectedFeedback, setSelectedFeedback] = useState<any>(null)
  const [updatingFeedback, setUpdatingFeedback] = useState(false)
  const [feedbackToDelete, setFeedbackToDelete] = useState<any>(null)
  const [deletingFeedback, setDeletingFeedback] = useState(false)

  // Check if user is super admin (role_level = 1)
  const isSuperAdmin = userProfile.roles?.role_level === 1

  const [stats, setStats] = useState({
    total_scans: 0,
    unique_consumers: 0,
    total_points: 0,
    today_scans: 0,
    total_cost: 0
  })
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    if (userProfile?.organizations?.id) {
      loadOrders()
      loadProducts()
      loadStats()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile])

  useEffect(() => {
    if (userProfile?.organizations?.id) {
      loadActivations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId, selectedActivityType, filterProduct, filterMMYY, filterConsumer, filterShop, sortColumn, sortDirection, currentPage, userProfile])

  const loadOrders = async () => {
    try {
      if (!userProfile?.organizations?.id) return

      const { data, error } = await supabase
        .from('orders')
        .select('id, order_no, created_at')
        .eq('company_id', userProfile.organizations.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setOrders(data || [])
    } catch (error: any) {
      console.error('Error loading orders:', error.message || error)
    }
  }

  const loadProducts = async () => {
    try {
      if (!userProfile?.organizations?.id) return

      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, product_variants(image_url)')
        .eq('manufacturer_id', userProfile.organizations.id)
        .order('product_name', { ascending: true })

      if (error) throw error
      setProducts(data || [])
    } catch (error: any) {
      console.error('Error loading products:', error.message || error)
    }
  }

  const loadActivations = async () => {
    try {
      setLoading(true)
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
          order_id,
          sequence_number,
          orders ( order_no, display_doc_no ),
          products ( id, product_name ),
          product_variants ( variant_name, image_url ),
          redeem_items ( item_name, item_image_url ),
          redeem_gifts ( gift_name, gift_image_url ),
          scratch_card_plays (
            is_win,
            scratch_card_rewards (
              name,
              type,
              product_id
            )
          ),
          consumer_qr_scans ( 
            location_lat, 
            location_lng,
            shop_id,
            consumer_id,
            points_amount,
            scanned_at,
            organizations ( org_name, org_type_code ),
            users!consumer_qr_scans_consumer_id_fkey ( full_name, phone, email, organization_id, organizations!fk_users_organization ( org_type_code ) )
          )
        `, { count: 'exact' })
        .eq('company_id', userProfile.organizations.id)
        .or('is_redeemed.eq.true,is_lucky_draw_entered.eq.true,is_points_collected.eq.true')

      // Apply Filters
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

      if (filterProduct && filterProduct !== 'all') {
        query = query.eq('product_id', filterProduct)
      }

      if (filterConsumer) {
        query = query.ilike('consumer_name', `%${filterConsumer}%`)
      }

      // Note: Filtering by Shop Name or MMYY on related tables or derived fields is complex in Supabase/PostgREST directly.
      // For MMYY, we can filter on updated_at range if needed, or do client side filtering if dataset is small.
      // For Shop Name (in consumer_qr_scans), we can't easily filter the parent query based on child relation in standard PostgREST without embedding resource filtering which has limitations.
      // We will handle Shop Name and MMYY filtering client-side for now or use specific date range query for MMYY.

      // Sorting
      // Note: Sorting by related fields (product name, shop name) is also tricky. 
      // We'll stick to sorting by fields on qr_codes table for server-side sort.
      if (['updated_at', 'sequence_number', 'points_value', 'consumer_name'].includes(sortColumn)) {
        query = query.order(sortColumn, { ascending: sortDirection === 'asc' })
      } else {
        // Default sort
        query = query.order('updated_at', { ascending: false })
      }

      // Pagination
      const from = (currentPage - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data, error, count } = await query

      if (error) throw error

      setTotalCount(count || 0)

      let transformedData = data?.map((qr: any) => {
        // Get location and shop from the most recent scan if available
        const scans = qr.consumer_qr_scans?.sort((a: any, b: any) =>
          new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()
        ) || []

        const lastScan = scans[0]

        const location = lastScan?.location_lat && lastScan?.location_lng
          ? `${lastScan.location_lat.toFixed(4)}, ${lastScan.location_lng.toFixed(4)}`
          : null

        const shopName = lastScan?.organizations?.org_name || (lastScan?.shop_id ? 'Shop ID: ' + lastScan.shop_id.substring(0, 8) : '-')

        // Points logic: try qr_codes first, then scan record
        let points = 0
        if (qr.is_points_collected) {
          points = qr.points_value || lastScan?.points_amount || 0
        }

        // Gift logic: try redeem_gifts (free gift) first, then redeem_items (points catalog)
        const giftName = qr.redeem_gifts?.gift_name || qr.redeem_items?.item_name;
        const giftImage = qr.redeem_gifts?.gift_image_url || qr.redeem_items?.item_image_url;

        // Game Card logic
        const play = qr.scratch_card_plays?.[0];
        const gameCardWon = play?.is_win;
        const reward = play?.scratch_card_rewards;
        const gameCardName = reward?.name;

        // Try to get image from loaded products since we can't join directly due to missing FK
        let gameCardImage = null;
        if (reward?.product_id && products.length > 0) {
          const prod = products.find((p: any) => p.id === reward.product_id);
          gameCardImage = prod?.product_variants?.[0]?.image_url;
        }

        // Consumer name priority: 
        // 1) User's full_name from scan (registered user who collected points)
        // 2) qr_codes consumer_name (from gift claim / lucky draw / points collection by independent user)
        // 3) User's phone/email if available (fallback identifier)
        // 4) Check if shop collected (shop_id present but no consumer info)
        // 5) Legacy data (no tracking info available)
        const scanUser = lastScan?.users;
        const consumerNameFromScan = scanUser?.full_name;
        const fallbackIdentifier = scanUser?.phone || scanUser?.email || qr.consumer_phone || qr.consumer_email;

        let consumerName = 'Anonymous';
        if (consumerNameFromScan) {
          consumerName = consumerNameFromScan;
        } else if (qr.consumer_name) {
          consumerName = qr.consumer_name;
        } else if (fallbackIdentifier) {
          consumerName = `User: ${fallbackIdentifier}`;
        } else if (lastScan?.shop_id) {
          // Points collected by shop but consumer unknown
          consumerName = 'Shop Collected';
        } else if (lastScan?.consumer_id) {
          // Has consumer_id but couldn't join to users (shouldn't happen normally)
          consumerName = 'Registered User';
        }
        // Else stays 'Anonymous' for legacy data without tracking

        // Check if user is independent (org_type_code = 'INDEP')
        const isIndependentUser = scanUser?.organizations?.org_type_code === 'INDEP';
        const independentUserName = isIndependentUser ? scanUser?.full_name : null;

        // Order document numbers
        const orderDocNo = qr.orders?.display_doc_no || qr.orders?.order_no || 'N/A';
        const legacyOrderNo = qr.orders?.display_doc_no ? qr.orders?.order_no : null;

        return {
          id: qr.id,
          consumer_name: consumerName,
          consumer_phone: qr.consumer_phone,
          consumer_email: qr.consumer_email,
          activated_at: qr.redeemed_at || qr.updated_at,
          points_awarded: points,
          lucky_draw_entered: qr.is_lucky_draw_entered,
          gift_redeemed: qr.is_redeemed,
          activation_location: location,
          shop_name: shopName,
          independent_user_name: independentUserName,
          order_doc_no: orderDocNo,
          legacy_order_no: legacyOrderNo,
          product_name: qr.products?.product_name || 'Unknown Product',
          variant_name: qr.product_variants?.variant_name,
          variant_image: qr.product_variants?.image_url,
          sequence_number: qr.sequence_number,
          gift_name: giftName,
          gift_image: giftImage,
          game_card_won: gameCardWon,
          game_card_name: gameCardName,
          game_card_image: gameCardImage
        }
      }) || []

      // Client-side filtering for complex fields (Shop Name, MMYY)
      if (filterShop) {
        transformedData = transformedData.filter(item =>
          item.shop_name.toLowerCase().includes(filterShop.toLowerCase())
        )
      }

      if (filterMMYY) {
        // Format: MMYY e.g. 1125 for Nov 2025
        transformedData = transformedData.filter(item => {
          const date = new Date(item.activated_at)
          const month = (date.getMonth() + 1).toString().padStart(2, '0')
          const year = date.getFullYear().toString().slice(-2)
          return `${month}${year}` === filterMMYY
        })
      }

      setActivations(transformedData)
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const handleDragStart = (column: string) => {
    setDraggedColumn(column)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (targetColumn: string) => {
    if (!draggedColumn || draggedColumn === targetColumn) return

    const newOrder = [...columnOrder]
    const draggedIndex = newOrder.indexOf(draggedColumn)
    const targetIndex = newOrder.indexOf(targetColumn)

    if (draggedIndex !== -1 && targetIndex !== -1) {
      newOrder[draggedIndex] = targetColumn
      newOrder[targetIndex] = draggedColumn
      setColumnOrder(newOrder)
    }
    setDraggedColumn(null)
  }

  const totalPages = Math.ceil(totalCount / pageSize)

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

      // Fetch point value from organization settings
      let pointValueRM = 0
      const { data: orgData } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', userProfile.organizations.id)
        .single()

      if (orgData?.settings && typeof orgData.settings === 'object') {
        const settings = orgData.settings as any
        if (settings.point_value_rm !== undefined) {
          pointValueRM = Number(settings.point_value_rm) || 0
        }
      }

      // Total points
      let pointsQuery = supabase
        .from('qr_codes')
        .select('points_value, consumer_qr_scans(points_amount)')
        .eq('company_id', userProfile.organizations.id)
        .eq('is_points_collected', true)

      if (selectedOrderId && selectedOrderId !== 'all') {
        pointsQuery = pointsQuery.eq('order_id', selectedOrderId)
      }

      const { data: pointsData } = await pointsQuery
      const totalPoints = pointsData?.reduce((sum: number, qr: any) => {
        let points = qr.points_value || 0
        // Fallback to scans if points_value is 0/null
        if (!points && qr.consumer_qr_scans && qr.consumer_qr_scans.length > 0) {
          points = qr.consumer_qr_scans.reduce((s: number, scan: any) => s + (scan.points_amount || 0), 0)
        }
        return sum + points
      }, 0) || 0

      const totalCost = totalPoints * pointValueRM

      // Today's scans
      const today = new Date().toISOString().split('T')[0]
      let todayQuery = getBaseQuery().gte('updated_at', `${today}T00:00:00`)
      const { count: todayScans } = await todayQuery

      setStats({
        total_scans: totalScans || 0,
        unique_consumers: uniqueCount,
        total_points: totalPoints,
        today_scans: todayScans || 0,
        total_cost: totalCost
      })
    } catch (error: any) {
      console.error('Error loading stats:', error)
    }
  }

  const loadFeedback = async () => {
    if (!organizationId) return
    setFeedbackLoading(true)
    try {
      const { data, error } = await supabase
        .from('consumer_feedback')
        .select('*')
        .eq('org_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      setFeedback(data || [])
    } catch (error: any) {
      console.error('Error loading feedback:', error)
    } finally {
      setFeedbackLoading(false)
    }
  }

  // Delete feedback (Super Admin only)
  const handleDeleteFeedback = async (feedbackId: string) => {
    if (!isSuperAdmin) {
      toast({
        title: 'Permission Denied',
        description: 'Only Super Admin can delete feedback.',
        variant: 'destructive'
      })
      return
    }

    setDeletingFeedback(true)
    try {
      const { error } = await supabase
        .from('consumer_feedback')
        .delete()
        .eq('id', feedbackId)

      if (error) throw error

      // Remove from local state
      setFeedback(prev => prev.filter(f => f.id !== feedbackId))
      setFeedbackToDelete(null)

      toast({
        title: 'Feedback Deleted',
        description: 'The feedback has been successfully deleted.',
      })
    } catch (error: any) {
      console.error('Error deleting feedback:', error)
      toast({
        title: 'Error',
        description: 'Failed to delete feedback. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setDeletingFeedback(false)
    }
  }

  // Load feedback when switching to feedback tab
  useEffect(() => {
    if (activeTab === 'feedback' && feedback.length === 0 && !feedbackLoading) {
      loadFeedback()
    }
  }, [activeTab])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Consumer Activity</h1>
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
                      {order.order_no}
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
                <p className="text-xs text-gray-500 mt-1">Est. Cost: RM {stats.total_cost.toFixed(2)}</p>
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

      {/* Tabs for Activations and Feedback */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="activations">Recent Activations</TabsTrigger>
          <TabsTrigger value="feedback" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Consumer Feedback
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activations">
          {/* Recent Activations */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activations</CardTitle>
              {/* Filters Row */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-4">
                <Select value={filterProduct} onValueChange={setFilterProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter Product" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Products</SelectItem>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.product_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  placeholder="MMYY (e.g. 1125)"
                  value={filterMMYY}
                  onChange={(e) => setFilterMMYY(e.target.value)}
                />

                <Input
                  placeholder="Consumer Name/Phone"
                  value={filterConsumer}
                  onChange={(e) => setFilterConsumer(e.target.value)}
                />

                <Input
                  placeholder="Shop Name"
                  value={filterShop}
                  onChange={(e) => setFilterShop(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        #
                      </th>
                      {columnOrder.map((col) => {
                        if (col === 'order') {
                          return (
                            <th
                              key="order"
                              draggable
                              onDragStart={() => handleDragStart('order')}
                              onDragOver={handleDragOver}
                              onDrop={() => handleDrop('order')}
                              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-move hover:bg-gray-100"
                            >
                              <div className="flex items-center gap-1">
                                Ord No
                                <span className="text-[10px] text-gray-400">(Drag)</span>
                              </div>
                            </th>
                          )
                        } else {
                          return (
                            <th
                              key="product"
                              draggable
                              onDragStart={() => handleDragStart('product')}
                              onDragOver={handleDragOver}
                              onDrop={() => handleDrop('product')}
                              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-move hover:bg-gray-100"
                              onClick={() => handleSort('product_id')}
                            >
                              <div className="flex items-center gap-1">
                                Product <ArrowUpDown className="w-3 h-3" />
                                <span className="text-[10px] text-gray-400">(Drag)</span>
                              </div>
                            </th>
                          )
                        }
                      })}
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('sequence_number')}
                      >
                        <div className="flex items-center gap-1">Seq <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('updated_at')}
                      >
                        <div className="flex items-center gap-1">Date & Time <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('consumer_name')}
                      >
                        <div className="flex items-center gap-1">Consumer <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID Shop</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('points_value')}
                      >
                        <div className="flex items-center gap-1">Points <ArrowUpDown className="w-3 h-3" /></div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Redeem</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">GameCard</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {loading ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                      </tr>
                    ) : activations.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-gray-500">No activations found</td>
                      </tr>
                    ) : (
                      activations.map((activation, index) => {
                        const rowNumber = (currentPage - 1) * pageSize + index + 1
                        return (
                        <tr key={activation.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-xs text-gray-600 font-medium">
                            {rowNumber}
                          </td>
                          {columnOrder.map((col) => {
                            if (col === 'order') {
                              return (
                                <td key="order" className="px-4 py-3">
                                  <div className="flex flex-col">
                                    <span className="text-xs font-medium text-blue-600">{activation.order_doc_no}</span>
                                    {activation.legacy_order_no && (
                                      <span className="text-[10px] text-gray-500">Legacy: {activation.legacy_order_no}</span>
                                    )}
                                  </div>
                                </td>
                              )
                            } else {
                              return (
                                <td key="product" className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    {activation.variant_image && (
                                      <Avatar className="h-8 w-8">
                                        <AvatarImage src={activation.variant_image} alt={activation.variant_name} />
                                        <AvatarFallback>{activation.variant_name?.charAt(0)}</AvatarFallback>
                                      </Avatar>
                                    )}
                                    <div>
                                      <p className="text-xs font-medium text-gray-900">{activation.product_name}</p>
                                      {activation.variant_name && (
                                        <p className="text-[10px] text-gray-500">{activation.variant_name}</p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              )
                            }
                          })}
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {activation.sequence_number || '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            <div className="flex flex-col">
                              <span className="font-medium">{new Date(activation.activated_at).toLocaleDateString()}</span>
                              <span className="text-[10px] text-gray-500">{new Date(activation.activated_at).toLocaleTimeString()}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="text-xs font-medium text-gray-900">
                                {activation.consumer_name || 'Anonymous'}
                              </p>
                              <p className="text-[10px] text-gray-500">{activation.consumer_phone}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {activation.shop_name}
                          </td>
                          <td className="px-4 py-3">
                            {activation.independent_user_name ? (
                              <span className="text-xs font-medium text-blue-600">{activation.independent_user_name}</span>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {activation.points_awarded > 0 ? (
                              <span className="text-[10px] font-medium text-green-600">
                                +{activation.points_awarded}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {activation.gift_redeemed ? (
                              <div className="flex items-center gap-2">
                                {activation.gift_image && (
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage src={activation.gift_image} alt={activation.gift_name} />
                                    <AvatarFallback>R</AvatarFallback>
                                  </Avatar>
                                )}
                                <span className="text-xs text-gray-700">
                                  {activation.gift_name || 'Redeemed'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {activation.game_card_won ? (
                              <div className="flex items-center gap-2">
                                {activation.game_card_image ? (
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage src={activation.game_card_image} alt={activation.game_card_name} />
                                    <AvatarFallback>W</AvatarFallback>
                                  </Avatar>
                                ) : (
                                  <Trophy className="h-4 w-4 text-yellow-500" />
                                )}
                                <span className="text-xs text-gray-700">
                                  {activation.game_card_name || 'Won'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </td>
                        </tr>
                      )})
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-gray-500">
                  Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} results
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-medium">Page {currentPage} of {totalPages || 1}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages || totalPages === 0}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Consumer Feedback
              </CardTitle>
            </CardHeader>
            <CardContent>
              {feedbackLoading ? (
                <div className="text-center py-8 text-gray-500">Loading feedback...</div>
              ) : feedback.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No feedback received yet</div>
              ) : (
                <div className="space-y-4">
                  {feedback.map((item: any) => (
                    <div key={item.id} className="border rounded-lg p-4 bg-gray-50">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-semibold text-gray-900">{item.title}</h4>
                          <p className="text-sm text-gray-600">
                            From: {item.consumer_name || 'Anonymous'}
                            {item.consumer_phone && ` • ${item.consumer_phone}`}
                            {item.consumer_email && ` • ${item.consumer_email}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'new' ? 'bg-blue-100 text-blue-800' :
                            item.status === 'reviewed' ? 'bg-yellow-100 text-yellow-800' :
                              item.status === 'resolved' ? 'bg-green-100 text-green-800' :
                                'bg-gray-100 text-gray-800'
                            }`}>
                            {item.status || 'new'}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(item.created_at).toLocaleDateString()}
                          </span>
                          {isSuperAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => setFeedbackToDelete(item)}
                              title="Delete Feedback (Super Admin Only)"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-gray-700 whitespace-pre-wrap">{item.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Feedback Confirmation Dialog */}
      <AlertDialog open={!!feedbackToDelete} onOpenChange={(open) => !open && setFeedbackToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feedback</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this feedback? This action cannot be undone.
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="font-medium text-gray-900">{feedbackToDelete?.title}</p>
                <p className="text-sm text-gray-600 mt-1">{feedbackToDelete?.message?.substring(0, 100)}{feedbackToDelete?.message?.length > 100 ? '...' : ''}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFeedback}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => feedbackToDelete && handleDeleteFeedback(feedbackToDelete.id)}
              disabled={deletingFeedback}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletingFeedback ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
