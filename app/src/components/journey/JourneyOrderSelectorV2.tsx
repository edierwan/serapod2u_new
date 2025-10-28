'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Package, ArrowRight, Gift, Star, Coins, CheckCircle2, AlertCircle } from 'lucide-react'

interface Order {
    id: string
    order_no: string
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
    const supabase = createClient()

    useEffect(() => {
        loadOrders()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function loadOrders() {
        try {
            setLoading(true)

            // Get orders for this organization
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('id, order_no, order_type, status, has_redeem, has_lucky_draw, company_id, created_at')
                .eq('company_id', userProfile.organization_id)
                .order('created_at', { ascending: false })

            if (ordersError) {
                console.error('Error fetching orders:', ordersError)
                throw ordersError
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
                (orders || []).map(async (order) => {
                    const { count } = await supabase
                        .from('order_items')
                        .select('*', { count: 'exact', head: true })
                        .eq('order_id', order.id)

                    return {
                        ...order,
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
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Search orders by order number..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
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
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredOrders.map((order) => {
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
            )}
        </div>
    )
}
