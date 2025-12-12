'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Plus, Search, Filter, Edit, Eye, Copy, Trash2, Gift, Gamepad2, Sparkles, Ticket } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
    const { toast } = useToast()
    const supabase = createClient()

    useEffect(() => {
        fetchCampaigns()
    }, [activeTab])

    const fetchCampaigns = async () => {
        setLoading(true)
        
        let tableName = 'scratch_card_campaigns'
        if (activeTab === 'spin-wheel') tableName = 'spin_wheel_campaigns'
        if (activeTab === 'daily-quiz') tableName = 'daily_quiz_campaigns'

        // Fetch campaigns
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .eq('org_id', userProfile.organization_id)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Error fetching campaigns:', error)
            // Don't show error toast immediately as table might not exist yet (migration pending)
            // toast({
            //     title: "Error",
            //     description: "Failed to load campaigns",
            //     variant: "destructive",
            // })
            setCampaigns([])
            setLoading(false)
            return
        }

        // Fetch stats (simplified for now, as RPCs might differ)
        // For now, we'll skip complex stats fetching for new game types to avoid errors
        // We can add specific stats fetching later
        
        // Fetch Order No for each campaign
        const campaignsWithOrder = await Promise.all((data || []).map(async (c: any) => {
            let orderNo = '-'
            if (c.journey_config_id) {
                // Try to find order via journey_order_links
                const { data: linkData } = await supabase
                    .from('journey_order_links')
                    .select('orders(order_no)')
                    .eq('journey_config_id', c.journey_config_id)
                    .limit(1)
                    .maybeSingle()
                
                if (linkData?.orders) {
                    // @ts-ignore
                    orderNo = linkData.orders.order_no
                }
            }
            
            // Placeholder stats
            const stats = { plays_count: 0, winners_count: 0 }
            
            return { 
                ...c, 
                order_no: orderNo,
                plays_count: stats.plays_count,
                winners_count: stats.winners_count
            }
        }))
        setCampaigns(campaignsWithOrder)
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
                    onBack={handleBack} 
                />
            )
        }
        if (activeTab === 'spin-wheel') {
            return (
                <SpinWheelCampaignForm 
                    userProfile={userProfile} 
                    campaignId={selectedCampaignId} 
                    onBack={handleBack} 
                />
            )
        }
        if (activeTab === 'daily-quiz') {
            return (
                <DailyQuizCampaignForm 
                    userProfile={userProfile} 
                    campaignId={selectedCampaignId} 
                    onBack={handleBack} 
                />
            )
        }
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
                        <TableCell colSpan={5} className="text-center py-8">No campaigns found. Create one to get started.</TableCell>
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
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Games</h2>
                    <p className="text-muted-foreground">
                        Create and manage interactive games for your consumers.
                    </p>
                </div>
                <Button onClick={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" /> New Campaign
                </Button>
            </div>

            <Tabs defaultValue="scratch-card" value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 max-w-[600px]">
                    <TabsTrigger value="scratch-card" className="flex items-center gap-2">
                        <Ticket className="w-4 h-4" />
                        Scratch Card
                    </TabsTrigger>
                    <TabsTrigger value="spin-wheel" className="flex items-center gap-2">
                        <Gamepad2 className="w-4 h-4" />
                        Spin the Wheel
                    </TabsTrigger>
                    <TabsTrigger value="daily-quiz" className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Daily Quiz
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