'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Package, ArrowRight, Gift, Star, Coins, CheckCircle2, AlertCircle, LayoutGrid, List } from 'lucide-react'

interface Order {
    id: string
    order_no: string
    display_doc_no?: string
    legacy_order_no?: string  // Original order_no (e.g., ORD-HM-0126-19)
    order_type: string
    status: string
    has_redeem: boolean
    has_lucky_draw: boolean
    company_id: string
    created_at: string
    order_items: any[]
}

interface UserProfile {
    id: string
    organization_id: string
    organizations: {
        org_type_code: string
    }
}

export default function JourneyOrderSelectorV2({
    userProfile,
    onOrderSelected
}: {
    userProfile: UserProfile
    onOrderSelected: (order: Order) => void
}) {
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [viewMode, setViewMode] = useState<'card' | 'list'>('list') // Default to list view
    const [currentPage, setCurrentPage] = useState(1)
    const ITEMS_PER_PAGE = 12
    const supabase = createClient()

    useEffect(() => {
        loadOrders()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function loadOrders() {
        try {
            setLoading(true)

            // Get orders for this organization - use buyer_org_id or seller_org_id
            // Filter to only show HM (H2M) orders - DH orders have QR codes that are part of HM orders
            // Only show approved/closed orders (ready for consumer engagement - products are manufactured)
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('id, order_no, display_doc_no, order_type, status, has_redeem, has_lucky_draw, company_id, created_at')
                .or(`buyer_org_id.eq.${userProfile.organization_id},seller_org_id.eq.${userProfile.organization_id}`)
                .eq('order_type', 'H2M') // Only HM orders - QR codes for DH are already part of HM orders
                .in('status', ['approved', 'closed']) // Only orders that have been approved (products manufactured)
                .order('created_at', { ascending: false })

            if (ordersError) {
                console.error('Error fetching orders:', ordersError)
                throw ordersError
            }

            // Filter: Only show orders with valid master QR status (received_warehouse or later)
            const orderIds = orders?.map(o => o.id) || []
            let ordersWithValidStatus = orders || []

            if (orderIds.length > 0) {
                 const { data: validMasters } = await supabase
                    .from('qr_master_codes')
                    .select('order_id')
                    .in('order_id', orderIds)
                    .in('status', ['received_warehouse', 'shipped_distributor', 'shipped_retailer', 'sold', 'consumed'])
                
                const validOrderSet = new Set(validMasters?.map(m => m.order_id))
                ordersWithValidStatus = orders?.filter(o => validOrderSet.has(o.id)) || []
            }

            // Get existing journey links to filter out
            const { data: existingLinks, error: linksError } = await supabase
                .from('journey_order_links')
                .select('order_id')

            if (linksError) {
                console.error('Error fetching journey links:', linksError)
                // Don't throw - just show all orders if we can't get links
            }

            // Get order items count for each order
            const ordersWithItems = await Promise.all(
                ordersWithValidStatus.map(async (order) => {
                    const { count } = await supabase
                        .from('order_items')
                        .select('*', { count: 'exact', head: true })
                        .eq('order_id', order.id)

                    return {
                        ...order,
                        // Use display_doc_no when available, keep legacy_order_no for reference
                        legacy_order_no: order.order_no,  // Keep original order_no as legacy
                        order_no: order.display_doc_no || order.order_no,
                        order_items: Array(count || 0).fill({}) // Create array with count
                    }
                })
            )

            // Filter out orders that already have journeys
            const existingOrderIds = new Set(existingLinks?.map(link => link.order_id) || [])
            const availableOrders = ordersWithItems.filter(order => !existingOrderIds.has(order.id))

            setOrders(availableOrders)
        } catch (error) {
            console.error('Error loading orders:', error)
            // Set empty array on error so UI can still render
            setOrders([])
        } finally {
            setLoading(false)
        }
    }

    function getOrderTypeLabel(orderType: string): string {
        switch (orderType) {
            case 'H2M': return 'HQ → Manufacturer'
            case 'D2H': return 'Distributor → HQ'
            case 'S2D': return 'Shop → Distributor'
            default: return orderType
        }
    }

    function getStatusBadge(status: string) {
        const statusConfig: Record<string, { label: string; className: string }> = {
            draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700' },
            submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-700' },
            approved: { label: 'Approved', className: 'bg-green-100 text-green-700' },
            closed: { label: 'Closed', className: 'bg-purple-100 text-purple-700' },
        }

        const config = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-700' }
        return (
            <Badge variant="outline" className={config.className}>
                {config.label}
            </Badge>
        )
    }

    function canCreateJourney(order: Order): { can: boolean; reason?: string } {
        // An order can have a journey if it has redemption or lucky draw features
        if (!order.has_redeem && !order.has_lucky_draw) {
            return {
                can: false,
                reason: 'Order must have redemption or lucky draw features enabled'
            }
        }

        return { can: true }
    }

    const filteredOrders = orders.filter(order =>
        order.order_no.toLowerCase().includes(searchQuery.toLowerCase())
    )

    // Pagination
    const totalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE)
    const paginatedOrders = filteredOrders.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    )

    // Reset page when search changes
    useEffect(() => {
        setCurrentPage(1)
    }, [searchQuery])

    if (loading) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-gray-500">
                    Loading orders...
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Step 1: Select an Order</CardTitle>
                    <CardDescription>
                        Choose an order to create a consumer journey experience.
                        Orders must have redemption or lucky draw features enabled.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4 items-center">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Search orders by order number..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <div className="flex border rounded-md">
                            <Button
                                variant={viewMode === 'card' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setViewMode('card')}
                                className="rounded-r-none"
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </Button>
                            <Button
                                variant={viewMode === 'list' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setViewMode('list')}
                                className="rounded-l-none"
                            >
                                <List className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {filteredOrders.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {searchQuery ? 'No matching orders found' : 'No available orders'}
                        </h3>
                        <p className="text-gray-600">
                            {searchQuery
                                ? 'Try adjusting your search terms'
                                : 'All orders already have journeys or no orders with redemption/lucky draw features exist'
                            }
                        </p>
                    </CardContent>
                </Card>
            ) : viewMode === 'card' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedOrders.map((order) => {
                        const journeyCheck = canCreateJourney(order)

                        return (
                            <Card
                                key={order.id}
                                className={`hover:shadow-lg transition-shadow ${!journeyCheck.can ? 'opacity-60' : ''}`}
                            >
                                <CardHeader>
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <CardTitle className="text-lg">{order.order_no}</CardTitle>
                                            {order.legacy_order_no && order.legacy_order_no !== order.order_no && (
                                                <p className="text-[10px] text-gray-400 mt-0.5">Legacy: {order.legacy_order_no}</p>
                                            )}
                                            <CardDescription className="mt-1">
                                                {getOrderTypeLabel(order.order_type)}
                                            </CardDescription>
                                        </div>
                                        {getStatusBadge(order.status)}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* Features */}
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-gray-700">Available Features:</p>
                                        <div className="flex flex-wrap gap-2">
                                            {order.has_lucky_draw && (
                                                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                                    <Star className="w-3 h-3 mr-1" />
                                                    Lucky Draw
                                                </Badge>
                                            )}
                                            {order.has_redeem && (
                                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                                    <Gift className="w-3 h-3 mr-1" />
                                                    Redemption
                                                </Badge>
                                            )}
                                            {!order.has_lucky_draw && !order.has_redeem && (
                                                <span className="text-sm text-gray-500">No features enabled</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Order Info */}
                                    <div className="text-sm text-gray-600 space-y-1">
                                        <p>Created: {new Date(order.created_at).toLocaleDateString()}</p>
                                        <p>Items: {order.order_items?.length || 0} products</p>
                                    </div>

                                    {/* Action */}
                                    {journeyCheck.can ? (
                                        <Button
                                            className="w-full"
                                            onClick={() => onOrderSelected(order)}
                                        >
                                            Create Journey
                                            <ArrowRight className="w-4 h-4 ml-2" />
                                        </Button>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                                                <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                                                <p className="text-xs text-yellow-700">{journeyCheck.reason}</p>
                                            </div>
                                            <Button className="w-full" disabled>
                                                Cannot Create Journey
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <div className="divide-y">
                            {paginatedOrders.map((order) => {
                                const journeyCheck = canCreateJourney(order)
                                return (
                                    <div
                                        key={order.id}
                                        className={`flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors ${!journeyCheck.can ? 'opacity-60' : ''}`}
                                    >
                                        {/* Order Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-medium text-gray-900">{order.order_no}</h3>
                                                {getStatusBadge(order.status)}
                                            </div>
                                            {order.legacy_order_no && order.legacy_order_no !== order.order_no && (
                                                <p className="text-[10px] text-gray-400">Legacy: {order.legacy_order_no}</p>
                                            )}
                                            <p className="text-sm text-gray-500">{getOrderTypeLabel(order.order_type)}</p>
                                        </div>

                                        {/* Features */}
                                        <div className="hidden md:flex items-center gap-1">
                                            {order.has_lucky_draw && (
                                                <div className="p-1.5 rounded-md bg-purple-100 text-purple-600" title="Lucky Draw">
                                                    <Star className="w-3.5 h-3.5" />
                                                </div>
                                            )}
                                            {order.has_redeem && (
                                                <div className="p-1.5 rounded-md bg-green-100 text-green-600" title="Redemption">
                                                    <Gift className="w-3.5 h-3.5" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Date & Items */}
                                        <div className="hidden lg:block text-xs text-gray-500 w-32">
                                            <p>Created: {new Date(order.created_at).toLocaleDateString()}</p>
                                            <p>Items: {order.order_items?.length || 0} products</p>
                                        </div>

                                        {/* Action */}
                                        {journeyCheck.can ? (
                                            <Button
                                                size="sm"
                                                onClick={() => onOrderSelected(order)}
                                            >
                                                Create Journey
                                                <ArrowRight className="w-4 h-4 ml-1" />
                                            </Button>
                                        ) : (
                                            <Button size="sm" disabled>
                                                Cannot Create
                                            </Button>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                    >
                        Previous
                    </Button>
                    <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                            <Button
                                key={page}
                                variant={currentPage === page ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setCurrentPage(page)}
                                className="w-8 h-8 p-0"
                            >
                                {page}
                            </Button>
                        ))}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                    >
                        Next
                    </Button>
                </div>
            )}
        </div>
    )
}
