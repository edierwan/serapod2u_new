'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Plus, Search, Filter, Edit, Eye, Copy, Trash2, Gift, Gamepad2, Sparkles, Ticket, ArrowLeft } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { useToast } from '@/components/ui/use-toast'
import ScratchCardCampaignForm from './ScratchCardCampaignForm'
import SpinWheelCampaignForm from './SpinWheelCampaignForm'
import DailyQuizCampaignForm from './DailyQuizCampaignForm'
import ScratchCardStats from './ScratchCardStats'

interface ScratchCardGameViewProps {
    userProfile: any
    onViewChange: (view: string) => void
}

export default function ScratchCardGameView({ userProfile, onViewChange }: ScratchCardGameViewProps) {
    const [view, setView] = useState<'list' | 'create' | 'edit' | 'stats'>('list')
    const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState('scratch-card')
    const [campaigns, setCampaigns] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')

    // New state for Order Selection
    const [selectedOrder, setSelectedOrder] = useState<any>(null)
    const [orders, setOrders] = useState<any[]>([])
    const [loadingOrders, setLoadingOrders] = useState(false)
    const [currentPage, setCurrentPage] = useState(1)
    const itemsPerPage = 9

    // State for active game status (for tab coloring)
    const [gameStatuses, setGameStatuses] = useState({
        scratch: false,
        spin: false,
        quiz: false
    })

    const { toast } = useToast()
    const supabase = createClient()

    useEffect(() => {
        fetchOrders()
    }, [])

    useEffect(() => {
        if (selectedOrder) {
            fetchCampaigns()
            checkGameStatuses()
        }
    }, [selectedOrder, activeTab])

    const fetchOrders = async () => {
        setLoadingOrders(true)
        console.log('Fetching orders for org:', userProfile.organization_id)

        // 1. Fetch orders - use buyer_org_id or seller_org_id to find orders for this organization
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('id, order_no, display_doc_no')
            .or(`buyer_org_id.eq.${userProfile.organization_id},seller_org_id.eq.${userProfile.organization_id}`)
            .order('created_at', { ascending: false })

        if (ordersError) {
            console.error('Error fetching orders:', ordersError)
            toast({
                title: "Error",
                description: "Failed to load orders",
                variant: "destructive",
            })
            setLoadingOrders(false)
            return
        }

        // 2. Fetch journey links separately to avoid join issues/RLS complexity
        const orderIds = orders.map(o => o.id)
        const { data: links, error: linksError } = await supabase
            .from('journey_order_links')
            .select('order_id, journey_config_id')
            .in('order_id', orderIds)

        if (linksError) {
            console.error('Error fetching links:', linksError)
            // Don't fail completely, just assume no links
        }

        // 3. Map links to orders
        const linkMap = new Map(links?.map(l => [l.order_id, l.journey_config_id]) || [])

        const formattedOrders = orders.map((order: any) => ({
            id: order.id,
            order_no: order.display_doc_no || order.order_no,  // Use display_doc_no when available
            legacy_order_no: order.order_no,  // Keep original order_no as legacy
            journey_config_id: linkMap.get(order.id)
        }))

        console.log('Formatted orders:', formattedOrders)
        setOrders(formattedOrders)
        setLoadingOrders(false)
    }

    const checkGameStatuses = async () => {
        if (!selectedOrder?.journey_config_id) return

        const checkStatus = async (table: string) => {
            const { count } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true })
                .eq('journey_config_id', selectedOrder.journey_config_id)
                .eq('status', 'active')
            return (count || 0) > 0
        }

        const [scratchActive, spinActive, quizActive] = await Promise.all([
            checkStatus('scratch_card_campaigns'),
            checkStatus('spin_wheel_campaigns'),
            checkStatus('daily_quiz_campaigns')
        ])

        setGameStatuses({
            scratch: scratchActive,
            spin: spinActive,
            quiz: quizActive
        })
    }

    const fetchCampaigns = async () => {
        if (!selectedOrder) return

        setLoading(true)

        let tableName = 'scratch_card_campaigns'
        if (activeTab === 'spin-wheel') tableName = 'spin_wheel_campaigns'
        if (activeTab === 'daily-quiz') tableName = 'daily_quiz_campaigns'

        // Fetch campaigns for the selected journey
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .eq('org_id', userProfile.organization_id)
            .eq('journey_config_id', selectedOrder.journey_config_id)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Error fetching campaigns:', error)
            setCampaigns([])
        } else {
            const campaignsWithOrder = data.map((c: any) => ({
                ...c,
                order_no: selectedOrder.order_no
            }))
            setCampaigns(campaignsWithOrder)
        }
        setLoading(false)
    }

    const handleCreate = () => {
        setSelectedCampaignId(null)
        setView('create')
    }

    const handleEdit = (id: string) => {
        setSelectedCampaignId(id)
        setView('edit')
    }

    const handleStats = (id: string) => {
        setSelectedCampaignId(id)
        setView('stats')
    }

    const handleBack = () => {
        setView('list')
        setSelectedCampaignId(null)
        fetchCampaigns()
        checkGameStatuses()
    }

    const handleBackToOrders = () => {
        setSelectedOrder(null)
        setCampaigns([])
        setView('list')
    }

    const handleDelete = async (campaign: any) => {
        if (!confirm('Are you sure you want to delete this campaign? This will return any unused stock and disable the feature in the journey.')) {
            return
        }

        setLoading(true)
        try {
            if (activeTab === 'scratch-card') {
                // 1. Fetch rewards to return stock
                const { data: rewards, error: fetchError } = await supabase
                    .from('scratch_card_rewards')
                    .select('*')
                    .eq('campaign_id', campaign.id)

                if (fetchError) throw fetchError

                // 2. Return stock
                if (rewards && rewards.length > 0) {
                    for (const reward of rewards) {
                        if (reward.type === 'product' && reward.variant_id) {
                            const remaining = reward.quantity_remaining || 0

                            if (remaining > 0) {
                                const qtyToReturn = remaining * (reward.product_quantity || 1)

                                // Find inventory to return to
                                const { data: inventory } = await supabase
                                    .from('product_inventory')
                                    .select('id, quantity_available')
                                    .eq('variant_id', reward.variant_id)
                                    .order('quantity_available', { ascending: false })
                                    .limit(1)
                                    .single()

                                if (inventory) {
                                    await supabase
                                        .from('product_inventory')
                                        .update({ quantity_available: inventory.quantity_available + qtyToReturn })
                                        .eq('id', inventory.id)
                                }
                            }
                        }
                    }

                    // 3. Delete rewards
                    const { error: delRewardsError } = await supabase
                        .from('scratch_card_rewards')
                        .delete()
                        .eq('campaign_id', campaign.id)

                    if (delRewardsError) throw delRewardsError
                }

                // 4. Delete plays
                await supabase.from('scratch_card_plays').delete().eq('campaign_id', campaign.id)

                // 5. Delete campaign
                const { error: delCampaignError } = await supabase
                    .from('scratch_card_campaigns')
                    .delete()
                    .eq('id', campaign.id)

                if (delCampaignError) throw delCampaignError

            } else if (activeTab === 'spin-wheel') {
                // Similar logic for Spin Wheel
                const { data: rewards, error: fetchError } = await supabase
                    .from('spin_wheel_rewards')
                    .select('*')
                    .eq('campaign_id', campaign.id)

                if (fetchError) throw fetchError

                if (rewards && rewards.length > 0) {
                    for (const reward of rewards) {
                        if (reward.type === 'product' && reward.variant_id) {
                            const remaining = reward.quantity_remaining || 0
                            if (remaining > 0) {
                                const qtyToReturn = remaining * (reward.product_quantity || 1)
                                const { data: inventory } = await supabase
                                    .from('product_inventory')
                                    .select('id, quantity_available')
                                    .eq('variant_id', reward.variant_id)
                                    .order('quantity_available', { ascending: false })
                                    .limit(1)
                                    .single()
                                if (inventory) {
                                    await supabase
                                        .from('product_inventory')
                                        .update({ quantity_available: inventory.quantity_available + qtyToReturn })
                                        .eq('id', inventory.id)
                                }
                            }
                        }
                    }
                    await supabase.from('spin_wheel_rewards').delete().eq('campaign_id', campaign.id)
                }
                await supabase.from('spin_wheel_plays').delete().eq('campaign_id', campaign.id)
                const { error: delCampaignError } = await supabase.from('spin_wheel_campaigns').delete().eq('id', campaign.id)
                if (delCampaignError) throw delCampaignError

            } else if (activeTab === 'daily-quiz') {
                // Daily Quiz deletion
                await supabase.from('daily_quiz_questions').delete().eq('campaign_id', campaign.id)
                await supabase.from('daily_quiz_plays').delete().eq('campaign_id', campaign.id)
                const { error: delCampaignError } = await supabase.from('daily_quiz_campaigns').delete().eq('id', campaign.id)
                if (delCampaignError) throw delCampaignError
            }

            toast({
                title: "Success",
                description: "Campaign deleted successfully",
            })
            fetchCampaigns()
        } catch (error: any) {
            console.error('Error deleting campaign:', error)
            toast({
                title: "Error",
                description: error.message || "Failed to delete campaign",
                variant: "destructive",
            })
            setLoading(false)
        }
    }

    if (view === 'create' || view === 'edit') {
        if (activeTab === 'scratch-card') {
            return (
                <ScratchCardCampaignForm
                    userProfile={userProfile}
                    campaignId={selectedCampaignId}
                    initialJourneyId={selectedOrder?.journey_config_id}
                    onBack={handleBack}
                />
            )
        }
        if (activeTab === 'spin-wheel') {
            return (
                <SpinWheelCampaignForm
                    userProfile={userProfile}
                    campaignId={selectedCampaignId}
                    initialJourneyId={selectedOrder?.journey_config_id}
                    onBack={handleBack}
                />
            )
        }
        if (activeTab === 'daily-quiz') {
            return (
                <DailyQuizCampaignForm
                    userProfile={userProfile}
                    campaignId={selectedCampaignId}
                    initialJourneyId={selectedOrder?.journey_config_id}
                    onBack={handleBack}
                />
            )
        }
    }

    // If no order selected, show order selector
    if (!selectedOrder) {
        const totalPages = Math.ceil(orders.length / itemsPerPage)
        const currentOrders = orders.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Games</h2>
                    <p className="text-muted-foreground">
                        Select an Order to manage games.
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Select Order</CardTitle>
                        <CardDescription>Choose an order to configure games for its journey.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loadingOrders ? (
                            <div className="text-center py-4">Loading orders...</div>
                        ) : orders.length === 0 ? (
                            <div className="text-center py-4 text-muted-foreground">
                                No orders found.
                            </div>
                        ) : (
                            <>
                                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-4">
                                    {currentOrders.map((order) => (
                                        <Button
                                            key={order.id}
                                            variant="outline"
                                            className={`h-auto p-3 flex flex-col items-start gap-1.5 ${!order.journey_config_id
                                                    ? 'opacity-60 cursor-not-allowed'
                                                    : 'hover:border-green-500 hover:bg-green-50 bg-green-50/30 border-green-200'
                                                }`}
                                            onClick={() => {
                                                if (order.journey_config_id) {
                                                    setSelectedOrder(order)
                                                } else {
                                                    toast({
                                                        title: "No Journey Linked",
                                                        description: "Please create a journey for this order in Journey Builder first.",
                                                        variant: "destructive"
                                                    })
                                                }
                                            }}
                                        >
                                            <div className="flex justify-between w-full items-center">
                                                <div className="text-left">
                                                    <span className="font-bold text-base">{order.order_no}</span>
                                                    {order.legacy_order_no && order.legacy_order_no !== order.order_no && (
                                                        <p className="text-[10px] text-gray-400">Legacy: {order.legacy_order_no}</p>
                                                    )}
                                                </div>
                                                {!order.journey_config_id ? (
                                                    <Badge variant="secondary" className="text-[10px] px-1.5 h-5">No Journey</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 h-5 bg-green-100 text-green-700 border-green-200">Linked</Badge>
                                                )}
                                            </div>
                                            <span className="text-[11px] text-muted-foreground">
                                                {order.journey_config_id ? 'Click to manage games' : 'Journey required'}
                                            </span>
                                        </Button>
                                    ))}
                                </div>

                                {totalPages > 1 && (
                                    <div className="flex items-center justify-center gap-2 mt-6">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                        >
                                            Previous
                                        </Button>
                                        <span className="text-sm text-muted-foreground">
                                            Page {currentPage} of {totalPages}
                                        </span>
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
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (view === 'stats' && selectedCampaignId) {
        return (
            <ScratchCardStats
                campaignId={selectedCampaignId}
                onBack={handleBack}
            />
        )
    }

    const renderCampaignTable = () => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Campaign Name</TableHead>
                    <TableHead>Order No</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Validity</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {loading ? (
                    <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">Loading...</TableCell>
                    </TableRow>
                ) : campaigns.length === 0 ? (
                    <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">
                            <div className="flex flex-col items-center gap-2">
                                <p>No campaigns found for this order.</p>
                                <Button onClick={handleCreate} size="sm">
                                    <Plus className="mr-2 h-4 w-4" /> Create Campaign
                                </Button>
                            </div>
                        </TableCell>
                    </TableRow>
                ) : (
                    campaigns.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase())).map((campaign) => (
                        <TableRow key={campaign.id}>
                            <TableCell className="font-medium">{campaign.name}</TableCell>
                            <TableCell>
                                {campaign.order_no !== '-' ? (
                                    <Badge variant="outline" className="font-mono">
                                        {campaign.order_no}
                                    </Badge>
                                ) : (
                                    <span className="text-muted-foreground">-</span>
                                )}
                            </TableCell>
                            <TableCell>
                                <Badge variant={
                                    campaign.status === 'active' ? 'default' :
                                        campaign.status === 'draft' ? 'secondary' :
                                            'outline'
                                }>
                                    {campaign.status}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                <div className="text-sm">
                                    <div>{campaign.start_at ? new Date(campaign.start_at).toLocaleDateString() : '-'}</div>
                                    <div className="text-muted-foreground text-xs">to {campaign.end_at ? new Date(campaign.end_at).toLocaleDateString() : '-'}</div>
                                </div>
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                    {activeTab === 'scratch-card' && (
                                        <Button variant="ghost" size="icon" onClick={() => handleStats(campaign.id)}>
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                    )}
                                    <Button variant="ghost" size="icon" onClick={() => handleEdit(campaign.id)}>
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                        onClick={() => handleDelete(campaign)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))
                )}
            </TableBody>
        </Table>
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={handleBackToOrders}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Games</h2>
                        <p className="text-muted-foreground">
                            Managing games for Order: <span className="font-mono font-medium text-foreground">{selectedOrder.order_no}</span>
                            {selectedOrder.legacy_order_no && selectedOrder.legacy_order_no !== selectedOrder.order_no && (
                                <span className="text-[10px] text-gray-400 ml-2">(Legacy: {selectedOrder.legacy_order_no})</span>
                            )}
                        </p>
                    </div>
                </div>
                {campaigns.length > 0 && (
                    <Button onClick={handleCreate}>
                        <Plus className="mr-2 h-4 w-4" /> New Campaign
                    </Button>
                )}
            </div>

            <Tabs defaultValue="scratch-card" value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 max-w-[600px]">
                    <TabsTrigger
                        value="scratch-card"
                        className={`flex items-center gap-2 ${gameStatuses.scratch ? 'data-[state=active]:bg-green-100 data-[state=active]:text-green-900 bg-green-50/50' : ''}`}
                    >
                        <Ticket className={`w-4 h-4 ${gameStatuses.scratch ? 'text-green-600' : ''}`} />
                        Scratch Card
                        {gameStatuses.scratch && <Badge variant="secondary" className="ml-2 bg-green-200 text-green-800 hover:bg-green-200 text-[10px] h-5">Active</Badge>}
                    </TabsTrigger>
                    <TabsTrigger
                        value="spin-wheel"
                        className={`flex items-center gap-2 ${gameStatuses.spin ? 'data-[state=active]:bg-green-100 data-[state=active]:text-green-900 bg-green-50/50' : ''}`}
                    >
                        <Gamepad2 className={`w-4 h-4 ${gameStatuses.spin ? 'text-green-600' : ''}`} />
                        Spin the Wheel
                        {gameStatuses.spin && <Badge variant="secondary" className="ml-2 bg-green-200 text-green-800 hover:bg-green-200 text-[10px] h-5">Active</Badge>}
                    </TabsTrigger>
                    <TabsTrigger
                        value="daily-quiz"
                        className={`flex items-center gap-2 ${gameStatuses.quiz ? 'data-[state=active]:bg-green-100 data-[state=active]:text-green-900 bg-green-50/50' : ''}`}
                    >
                        <Sparkles className={`w-4 h-4 ${gameStatuses.quiz ? 'text-green-600' : ''}`} />
                        Daily Quiz
                        {gameStatuses.quiz && <Badge variant="secondary" className="ml-2 bg-green-200 text-green-800 hover:bg-green-200 text-[10px] h-5">Active</Badge>}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="scratch-card" className="mt-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Scratch Card Campaigns</CardTitle>
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search campaigns..."
                                            className="pl-8 w-[250px]"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {renderCampaignTable()}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="spin-wheel" className="mt-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>Spin the Wheel Campaigns</CardTitle>
                                    <CardDescription>Manage your Spin the Wheel games.</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {renderCampaignTable()}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="daily-quiz" className="mt-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>Daily Quiz Campaigns</CardTitle>
                                    <CardDescription>Manage your Daily Quiz games.</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {renderCampaignTable()}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}