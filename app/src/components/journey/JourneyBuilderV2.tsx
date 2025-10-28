'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
    Plus,
    Search,
    Package,
    Eye,
    Edit,
    Trash2,
    Copy,
    Smartphone,
    Gift,
    Star,
    Coins,
    Zap,
    ArrowRight,
    CheckCircle2,
    AlertCircle
} from 'lucide-react'
import JourneyOrderSelectorV2 from './JourneyOrderSelectorV2'
import JourneyDesignerV2 from './JourneyDesignerV2'
import JourneyMobilePreviewV2 from './JourneyMobilePreviewV2'

interface UserProfile {
    id: string
    organization_id: string
    full_name: string | null
    organizations: {
        id: string
        org_name: string
        org_type_code: string
    }
}

interface JourneyConfig {
    id: string
    org_id: string
    name: string
    is_active: boolean
    is_default: boolean
    points_enabled: boolean
    lucky_draw_enabled: boolean
    redemption_enabled: boolean
    require_staff_otp_for_points: boolean
    require_customer_otp_for_lucky_draw: boolean
    require_customer_otp_for_redemption: boolean
    start_at: string | null
    end_at: string | null
    created_at: string
    order_info?: {
        order_no: string
        order_type: string
    }
}

interface Order {
    id: string
    order_no: string
    order_type: string
    status: string
    has_redeem: boolean
    has_lucky_draw: boolean
    company_id: string
}

export default function JourneyBuilderV2({ userProfile }: { userProfile: UserProfile }) {
    const [step, setStep] = useState<'select-order' | 'design-journey' | 'preview'>('select-order')
    const [journeys, setJourneys] = useState<JourneyConfig[]>([])
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
    const [selectedJourney, setSelectedJourney] = useState<JourneyConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeTab, setActiveTab] = useState('existing')

    const supabase = createClient()

    useEffect(() => {
        loadJourneys()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function loadJourneys() {
        try {
            setLoading(true)

            // Get all journey configurations for this organization
            const { data: configs, error: configsError } = await supabase
                .from('journey_configurations')
                .select('*')
                .eq('org_id', userProfile.organization_id)
                .order('created_at', { ascending: false })

            if (configsError) {
                console.error('Error fetching journey configs:', configsError)
                throw configsError
            }

            // Get order links for these journeys
            const { data: links, error: linksError } = await supabase
                .from('journey_order_links')
                .select('id, journey_config_id, order_id')
                .in('journey_config_id', (configs || []).map(c => c.id))

            if (linksError) {
                console.error('Error fetching journey links:', linksError)
            }

            // Get orders for the links
            const orderIds = (links || []).map(l => l.order_id).filter(Boolean)
            let ordersMap = new Map()

            if (orderIds.length > 0) {
                const { data: orders, error: ordersError } = await supabase
                    .from('orders')
                    .select('id, order_no, order_type')
                    .in('id', orderIds)

                if (ordersError) {
                    console.error('Error fetching orders:', ordersError)
                } else {
                    ordersMap = new Map((orders || []).map(o => [o.id, o]))
                }
            }

            // Build links map
            const linksMap = new Map(
                (links || []).map(link => [
                    link.journey_config_id,
                    ordersMap.get(link.order_id)
                ])
            )

            // Transform data to include order info
            const journeysWithOrders = (configs || []).map((config: any) => ({
                ...config,
                order_info: linksMap.get(config.id)
            }))

            setJourneys(journeysWithOrders)
        } catch (error) {
            console.error('Error loading journeys:', error)
            setJourneys([]) // Set empty array on error
        } finally {
            setLoading(false)
        }
    }

    function handleOrderSelected(order: Order) {
        setSelectedOrder(order)
        setStep('design-journey')
    }

    function handleJourneyCreated() {
        loadJourneys()
        setStep('select-order')
        setSelectedOrder(null)
        setSelectedJourney(null)
        setActiveTab('existing')
    }

    async function handleEditJourney(journey: JourneyConfig) {
        try {
            // Get the order linked to this journey
            const { data: link } = await supabase
                .from('journey_order_links')
                .select('order_id')
                .eq('journey_config_id', journey.id)
                .single()

            if (link) {
                // Fetch full order details
                const { data: order } = await supabase
                    .from('orders')
                    .select('id, order_no, order_type, status, has_redeem, has_lucky_draw, company_id')
                    .eq('id', link.order_id)
                    .single()

                if (order) {
                    setSelectedOrder(order as Order)
                }
            }

            setSelectedJourney(journey)
            setStep('design-journey')
        } catch (error) {
            console.error('Error loading order for journey:', error)
            alert('Failed to load order details for editing')
        }
    }

    async function handleDeleteJourney(journeyId: string) {
        if (!confirm('Are you sure you want to delete this journey? This action cannot be undone.')) {
            return
        }

        try {
            const { error } = await supabase
                .from('journey_configurations')
                .delete()
                .eq('id', journeyId)

            if (error) throw error

            loadJourneys()
        } catch (error: any) {
            console.error('Error deleting journey:', error)
            alert('Failed to delete journey: ' + error.message)
        }
    }

    async function handleDuplicateJourney(journey: JourneyConfig) {
        try {
            const { data, error } = await supabase
                .from('journey_configurations')
                .insert({
                    org_id: userProfile.organization_id,
                    name: `${journey.name} (Copy)`,
                    is_active: false,
                    is_default: false,
                    points_enabled: journey.points_enabled,
                    lucky_draw_enabled: journey.lucky_draw_enabled,
                    redemption_enabled: journey.redemption_enabled,
                    require_staff_otp_for_points: journey.require_staff_otp_for_points,
                    require_customer_otp_for_lucky_draw: journey.require_customer_otp_for_lucky_draw,
                    require_customer_otp_for_redemption: journey.require_customer_otp_for_redemption,
                    created_by: userProfile.id
                })
                .select()
                .single()

            if (error) throw error

            loadJourneys()
            alert('Journey duplicated successfully!')
        } catch (error: any) {
            console.error('Error duplicating journey:', error)
            alert('Failed to duplicate journey: ' + error.message)
        }
    }

    function getEnabledFeatures(journey: JourneyConfig) {
        const features = []
        if (journey.points_enabled) features.push('Points')
        if (journey.lucky_draw_enabled) features.push('Lucky Draw')
        if (journey.redemption_enabled) features.push('Redemption')
        return features
    }

    const filteredJourneys = journeys.filter(j =>
        j.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.order_info?.order_no.toLowerCase().includes(searchQuery.toLowerCase())
    )

    if (step === 'design-journey' && selectedOrder) {
        return (
            <JourneyDesignerV2
                order={selectedOrder}
                userProfile={userProfile}
                journey={selectedJourney}
                onBack={() => {
                    setStep('select-order')
                    setSelectedOrder(null)
                    setSelectedJourney(null)
                }}
                onSuccess={handleJourneyCreated}
            />
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Journey Builder</h1>
                    <p className="text-gray-600 mt-1">
                        Create engaging consumer experiences when they scan QR codes
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-sm">
                        {journeys.length} {journeys.length === 1 ? 'Journey' : 'Journeys'}
                    </Badge>
                </div>
            </div>

            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-blue-200 bg-blue-50">
                    <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Coins className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-blue-900">Points Collection</h3>
                                <p className="text-sm text-blue-700 mt-1">
                                    Reward consumers with points when they scan QR codes
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-purple-200 bg-purple-50">
                    <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-purple-100 rounded-lg">
                                <Star className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-purple-900">Lucky Draw</h3>
                                <p className="text-sm text-purple-700 mt-1">
                                    Give consumers chances to win prizes
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-green-200 bg-green-50">
                    <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-green-100 rounded-lg">
                                <Gift className="w-5 h-5 text-green-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-green-900">Free Gift Redemption</h3>
                                <p className="text-sm text-green-700 mt-1">
                                    Consumers claim free gifts when they scan QR codes at shops
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Content */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2 max-w-md">
                    <TabsTrigger value="existing">Existing Journeys</TabsTrigger>
                    <TabsTrigger value="create">Create New</TabsTrigger>
                </TabsList>

                {/* Existing Journeys Tab */}
                <TabsContent value="existing" className="space-y-4">
                    {/* Search */}
                    <Card>
                        <CardContent className="pt-6">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input
                                    placeholder="Search journeys by name or order number..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-10"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Journeys List */}
                    {loading ? (
                        <Card>
                            <CardContent className="py-12 text-center text-gray-500">
                                Loading journeys...
                            </CardContent>
                        </Card>
                    ) : filteredJourneys.length === 0 ? (
                        <Card>
                            <CardContent className="py-12 text-center">
                                <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                    {searchQuery ? 'No matching journeys found' : 'No journeys yet'}
                                </h3>
                                <p className="text-gray-600 mb-6">
                                    {searchQuery
                                        ? 'Try adjusting your search terms'
                                        : 'Create your first consumer journey to get started'
                                    }
                                </p>
                                {!searchQuery && (
                                    <Button onClick={() => setActiveTab('create')}>
                                        <Plus className="w-4 h-4 mr-2" />
                                        Create Your First Journey
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredJourneys.map((journey) => (
                                <Card key={journey.id} className="hover:shadow-lg transition-shadow">
                                    <CardHeader>
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <CardTitle className="text-lg">{journey.name}</CardTitle>
                                                {journey.order_info && (
                                                    <CardDescription className="mt-1">
                                                        Order: {journey.order_info.order_no}
                                                    </CardDescription>
                                                )}
                                            </div>
                                            <div className="flex gap-1">
                                                {journey.is_active && (
                                                    <Badge variant="default" className="bg-green-500">
                                                        Active
                                                    </Badge>
                                                )}
                                                {journey.is_default && (
                                                    <Badge variant="secondary">Default</Badge>
                                                )}
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {/* Features */}
                                        <div className="space-y-2">
                                            <p className="text-sm font-medium text-gray-700">Features:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {journey.points_enabled && (
                                                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                        <Coins className="w-3 h-3 mr-1" />
                                                        Points
                                                    </Badge>
                                                )}
                                                {journey.lucky_draw_enabled && (
                                                    <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                                        <Star className="w-3 h-3 mr-1" />
                                                        Lucky Draw
                                                    </Badge>
                                                )}
                                                {journey.redemption_enabled && (
                                                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                                        <Gift className="w-3 h-3 mr-1" />
                                                        Redemption
                                                    </Badge>
                                                )}
                                                {!journey.points_enabled && !journey.lucky_draw_enabled && !journey.redemption_enabled && (
                                                    <span className="text-sm text-gray-500">No features enabled</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Dates */}
                                        {(journey.start_at || journey.end_at) && (
                                            <div className="text-sm text-gray-600">
                                                {journey.start_at && (
                                                    <p>Starts: {new Date(journey.start_at).toLocaleDateString()}</p>
                                                )}
                                                {journey.end_at && (
                                                    <p>Ends: {new Date(journey.end_at).toLocaleDateString()}</p>
                                                )}
                                            </div>
                                        )}

                                        {/* Actions */}
                                        <div className="flex gap-2 pt-2 border-t">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleEditJourney(journey)}
                                                className="flex-1"
                                            >
                                                <Edit className="w-4 h-4 mr-1" />
                                                Edit
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleDuplicateJourney(journey)}
                                            >
                                                <Copy className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleDeleteJourney(journey.id)}
                                                className="text-red-600 hover:bg-red-50"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* Create New Tab */}
                <TabsContent value="create">
                    <JourneyOrderSelectorV2
                        userProfile={userProfile}
                        onOrderSelected={handleOrderSelected}
                    />
                </TabsContent>
            </Tabs>
        </div>
    )
}
