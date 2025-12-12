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
        if (activeTab === 'scratch-card') {
            fetchCampaigns()
        } else {
            // Placeholder for other games
            setCampaigns([])
            setLoading(false)
        }
    }, [activeTab])

    const fetchCampaigns = async () => {
        setLoading(true)
        
        // Fetch campaigns
        const { data, error } = await supabase
            .from('scratch_card_campaigns')
            .select('*')
            .eq('org_id', userProfile.organization_id)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Error fetching campaigns:', error)
            toast({
                title: "Error",
                description: "Failed to load campaigns",
                variant: "destructive",
            })
            setLoading(false)
            return
        }

        // Fetch stats
        let statsMap = new Map()
        let rpcSuccess = false

        try {
            const { data: statsData, error: statsError } = await supabase
                .rpc('get_scratch_campaign_stats', { p_org_id: userProfile.organization_id })
            
            if (!statsError && statsData) {
                statsData.forEach((s: any) => {
                    statsMap.set(s.campaign_id, s)
                })
                rpcSuccess = true
            } else {
                console.warn('Failed to fetch stats via RPC, trying fallback', statsError)
            }
        } catch (e) {
            console.warn('RPC get_scratch_campaign_stats might not exist yet', e)
        }

        // Fallback: Fetch plays directly if RPC failed (likely migration not run)
        if (!rpcSuccess && data && data.length > 0) {
            try {
                const campaignIds = data.map((c: any) => c.id)
                const { data: playsData, error: playsError } = await supabase
                    .from('scratch_card_plays')
                    .select('campaign_id, is_win')
                    .in('campaign_id', campaignIds)
                
                if (!playsError && playsData) {
                    // Clear map to ensure we don't mix partial data
                    statsMap.clear()
                    
                    playsData.forEach((p: any) => {
                        const current = statsMap.get(p.campaign_id) || { plays_count: 0, winners_count: 0 }
                        statsMap.set(p.campaign_id, {
                            plays_count: current.plays_count + 1,
                            winners_count: current.winners_count + (p.is_win ? 1 : 0)
                        })
                    })
                }
            } catch (e) {
                console.error('Fallback stats fetch failed', e)
            }
        }

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
            
            const stats = statsMap.get(c.id) || { plays_count: 0, winners_count: 0 }
            
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
        // Placeholder for other games forms
        return (
            <div className="p-6">
                <Button variant="outline" onClick={handleBack} className="mb-4">Back</Button>
                <div className="text-center py-12">
                    <h3 className="text-lg font-medium">Configuration for {activeTab} coming soon</h3>
                </div>
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
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Campaign Name</TableHead>
                                        <TableHead>Order No</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Validity</TableHead>
                                        <TableHead>Plays</TableHead>
                                        <TableHead>Winners</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-8">Loading...</TableCell>
                                        </TableRow>
                                    ) : campaigns.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-8">No campaigns found. Create one to get started.</TableCell>
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
                                                <TableCell>{campaign.plays_count || 0}</TableCell>
                                                <TableCell>{campaign.winners_count || 0}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="ghost" size="icon" onClick={() => handleStats(campaign.id)}>
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" onClick={() => handleEdit(campaign.id)}>
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button 
                                                            variant="ghost" 
                                                            size="icon" 
                                                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                                            onClick={async () => {
                                                                if (confirm('Are you sure you want to delete this campaign? This will return any unused stock and disable the feature in the journey.')) {
                                                                    setLoading(true)
                                                                    try {
                                                                        const { error } = await supabase.rpc('delete_scratch_campaign', {
                                                                            p_campaign_id: campaign.id,
                                                                            p_user_id: userProfile.id
                                                                        })
                                                                        
                                                                        if (error) throw error
                                                                        
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
                                                            }}
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
                                <Button onClick={() => {
                                    toast({
                                        title: "Coming Soon",
                                        description: "Spin the Wheel campaign creation will be available soon!",
                                    })
                                }} className="gap-2">
                                    <Plus className="h-4 w-4" /> New Campaign
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-center py-12 text-muted-foreground">
                                <Gamepad2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                <p>No campaigns found. Create one to get started.</p>
                            </div>
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
                                <Button onClick={() => {
                                    toast({
                                        title: "Coming Soon",
                                        description: "Daily Quiz campaign creation will be available soon!",
                                    })
                                }} className="gap-2">
                                    <Plus className="h-4 w-4" /> New Campaign
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-center py-12 text-muted-foreground">
                                <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                <p>No campaigns found. Create one to get started.</p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}