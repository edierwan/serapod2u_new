'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, Save, Plus, Trash2, Gift, Smartphone, ChevronLeft, ChevronRight } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

const THEMES = [
    { id: 'modern', name: 'Modern Gradient' },
    { id: 'retro', name: 'Retro Carnival' },
    { id: 'vip', name: 'VIP Gold' },
    { id: 'cyber', name: 'Cyber Arcade' }
]

interface ScratchCardCampaignFormProps {
    userProfile: any
    campaignId: string | null
    onBack: () => void
}

export default function ScratchCardCampaignForm({ userProfile, campaignId, onBack }: ScratchCardCampaignFormProps) {
    const [loading, setLoading] = useState(false)
    const [journeys, setJourneys] = useState<any[]>([])
    const [products, setProducts] = useState<any[]>([])
    const [pointValueRM, setPointValueRM] = useState(0)
    const { toast } = useToast()
    const supabase = createClient()

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        journey_config_id: '',
        status: 'draft',
        start_at: '',
        end_at: '',
        max_plays_per_day: 1,
        max_plays_total_per_consumer: 0, // 0 means unlimited
        max_total_plays: 0, // 0 means unlimited
        theme_config: {
            theme_id: 'modern',
            primary_color: '#3B82F6',
            title_text: 'Scratch to reveal your reward',
            success_message: 'You’ve won: {{reward_name}}',
            no_prize_message: 'Not this time, try again soon!',
            show_confetti: true,
            play_sound: true
        }
    })

    const [rewards, setRewards] = useState<any[]>([])

    useEffect(() => {
        fetchJourneys()
        fetchProducts()
        fetchOrgSettings()
        if (campaignId) {
            fetchCampaign()
        }
    }, [campaignId])

    const handleThemeChange = (direction: 'next' | 'prev') => {
        const currentIndex = THEMES.findIndex(t => t.id === formData.theme_config.theme_id)
        let newIndex
        if (direction === 'next') {
            newIndex = (currentIndex + 1) % THEMES.length
        } else {
            newIndex = (currentIndex - 1 + THEMES.length) % THEMES.length
        }
        setFormData({
            ...formData,
            theme_config: { ...formData.theme_config, theme_id: THEMES[newIndex].id }
        })
    }

    const fetchOrgSettings = async () => {
        const { data } = await supabase
            .from('organizations')
            .select('settings')
            .eq('id', userProfile.organization_id)
            .single()
        
        if (data?.settings && typeof data.settings === 'object') {
            const settings = data.settings as any
            if (settings.point_value_rm) {
                setPointValueRM(Number(settings.point_value_rm) || 0)
            }
        }
    }

    const fetchJourneys = async () => {
        const { data } = await supabase
            .from('journey_configurations')
            .select('id, name')
            .eq('org_id', userProfile.organization_id)
            .eq('is_active', true)
        if (data) setJourneys(data)
    }

    const fetchProducts = async () => {
        try {
            const { data, error } = await supabase
                .from('product_inventory')
                .select(`
                    variant_id,
                    quantity_available,
                    product_variants (
                        id,
                        variant_name,
                        image_url,
                        base_cost,
                        products (
                            id,
                            product_name
                        )
                    )
                `)
                .gt('quantity_available', 0)

            if (error) throw error

            if (data) {
                const aggregatedProducts = new Map();

                data.forEach((item: any) => {
                    const variant = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants
                    if (!variant) return;

                    const variantId = item.variant_id;
                    const current = aggregatedProducts.get(variantId);
                    
                    if (current) {
                        current.quantity_available += item.quantity_available;
                    } else {
                        const product = variant.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
                        aggregatedProducts.set(variantId, {
                            variant_id: variantId,
                            product_id: product?.id,
                            product_name: product?.product_name || 'Unknown',
                            variant_name: variant.variant_name || 'Unknown',
                            quantity_available: item.quantity_available,
                            variant_image_url: variant.image_url,
                            base_cost: variant.base_cost
                        });
                    }
                });

                setProducts(Array.from(aggregatedProducts.values()));
            }
        } catch (error) {
            console.error('Error fetching products:', error)
            toast({ title: "Error", description: "Failed to load products", variant: "destructive" })
        }
    }

    const fetchCampaign = async () => {
        setLoading(true)
        const { data: campaign, error } = await supabase
            .from('scratch_card_campaigns')
            .select('*')
            .eq('id', campaignId)
            .single()

        if (error) {
            toast({ title: "Error", description: "Failed to load campaign", variant: "destructive" })
            onBack()
            return
        }

        setFormData({
            name: campaign.name,
            description: campaign.description || '',
            journey_config_id: campaign.journey_config_id || '',
            status: campaign.status,
            start_at: campaign.start_at ? campaign.start_at.split('T')[0] : '',
            end_at: campaign.end_at ? campaign.end_at.split('T')[0] : '',
            max_plays_per_day: campaign.max_plays_per_day,
            max_plays_total_per_consumer: campaign.max_plays_total_per_consumer || 0,
            max_total_plays: campaign.max_total_plays || 0,
            theme_config: campaign.theme_config || formData.theme_config
        })

        const { data: rewardsData } = await supabase
            .from('scratch_card_rewards')
            .select('*')
            .eq('campaign_id', campaignId)
        
        if (rewardsData) setRewards(rewardsData)
        setLoading(false)
    }

    const handleSave = async () => {
        if (!formData.name) {
            toast({ title: "Error", description: "Campaign name is required", variant: "destructive" })
            return
        }

        // Validate probability
        const totalProb = rewards.reduce((sum, r) => sum + (parseFloat(r.probability) || 0), 0)
        if (Math.abs(totalProb - 100) > 0.1) {
            toast({ title: "Warning", description: `Total probability is ${totalProb}%. It should be 100%.`, variant: "destructive" })
            // We allow saving but warn
        }

        setLoading(true)
        
        const campaignData = {
            org_id: userProfile.organization_id,
            name: formData.name,
            description: formData.description,
            journey_config_id: formData.journey_config_id || null,
            status: formData.status,
            start_at: formData.start_at ? new Date(formData.start_at).toISOString() : null,
            end_at: formData.end_at ? new Date(formData.end_at).toISOString() : null,
            max_plays_per_day: formData.max_plays_per_day,
            max_plays_total_per_consumer: formData.max_plays_total_per_consumer || null,
            max_total_plays: formData.max_total_plays || null,
            theme_config: formData.theme_config,
            updated_at: new Date().toISOString(),
            created_by: userProfile.id
        }

        let currentCampaignId = campaignId

        if (campaignId) {
            const { error } = await supabase
                .from('scratch_card_campaigns')
                .update(campaignData)
                .eq('id', campaignId)
            
            if (error) {
                toast({ title: "Error", description: error.message, variant: "destructive" })
                setLoading(false)
                return
            }
        } else {
            const { data, error } = await supabase
                .from('scratch_card_campaigns')
                .insert(campaignData)
                .select()
                .single()
            
            if (error) {
                toast({ title: "Error", description: error.message, variant: "destructive" })
                setLoading(false)
                return
            }
            currentCampaignId = data.id
        }

        // Save rewards
        // First fetch existing rewards to calculate stock changes
        let existingRewards: any[] = []
        if (campaignId) {
            const { data } = await supabase.from('scratch_card_rewards').select('*').eq('campaign_id', campaignId)
            existingRewards = data || []
            
            // Then delete existing rewards
            await supabase.from('scratch_card_rewards').delete().eq('campaign_id', campaignId)
        }

        if (rewards.length > 0) {
            const rewardsToInsert = rewards.map(r => ({
                campaign_id: currentCampaignId,
                name: r.name,
                type: r.type,
                value_points: r.value_points || null,
                product_id: r.product_id || null,
                variant_id: r.variant_id || null,
                product_quantity: r.product_quantity || 1,
                external_link: r.external_link || null,
                image_url: r.image_url || null,
                probability: r.probability,
                max_winners: r.max_winners || null,
                max_winners_per_day: r.max_winners_per_day || null,
                is_active: r.is_active !== false
            }))

            const { error: rewardsError } = await supabase
                .from('scratch_card_rewards')
                .insert(rewardsToInsert)
            
            if (rewardsError) {
                console.error('Rewards error:', rewardsError)
                toast({ title: "Warning", description: "Campaign saved but rewards failed to save", variant: "destructive" })
            } else {
                // Calculate and record stock movements
                try {
                    const stockChanges = new Map<string, number>()

                    // Add new requirements (deduct from stock)
                    rewards.forEach(r => {
                        if (r.type === 'product' && r.variant_id && r.product_quantity) {
                            const current = stockChanges.get(r.variant_id) || 0
                            stockChanges.set(r.variant_id, current + r.product_quantity)
                        }
                    })

                    // Subtract existing allocations (return to stock)
                    existingRewards.forEach(r => {
                        if (r.type === 'product' && r.variant_id && r.product_quantity) {
                            const current = stockChanges.get(r.variant_id) || 0
                            stockChanges.set(r.variant_id, current - r.product_quantity)
                        }
                    })

                    // Process stock movements
                    for (const [variantId, change] of stockChanges.entries()) {
                        if (change === 0) continue

                        // Determine target organization
                        let targetOrgId = userProfile.organization_id
                        
                        // Always try to find the best location, even for returns, to ensure we target a valid warehouse
                        // For returns (change < 0), we ideally want to return to where we took it from, but we don't track that easily.
                        // So we return to the warehouse with existing stock or the user's org.
                        const { data: inventoryData } = await supabase
                            .from('product_inventory')
                            .select('organization_id, quantity_available')
                            .eq('variant_id', variantId)
                            .gt('quantity_available', 0)
                            .order('quantity_available', { ascending: false })
                        
                        if (inventoryData && inventoryData.length > 0) {
                            // If deducting (change > 0):
                            if (change > 0) {
                                // Prefer user's org if it has enough stock
                                const userOrgStock = inventoryData.find(i => i.organization_id === userProfile.organization_id)
                                if (userOrgStock && userOrgStock.quantity_available >= change) {
                                    targetOrgId = userProfile.organization_id
                                } else {
                                    // Otherwise take from the one with most stock
                                    targetOrgId = inventoryData[0].organization_id
                                }
                            } else {
                                // If returning (change < 0):
                                // Return to the warehouse that has the most stock (likely the main warehouse)
                                // Or prefer user's org if it exists in the list
                                const userOrgStock = inventoryData.find(i => i.organization_id === userProfile.organization_id)
                                if (userOrgStock) {
                                    targetOrgId = userProfile.organization_id
                                } else {
                                    targetOrgId = inventoryData[0].organization_id
                                }
                            }
                        } else {
                            // If no inventory found at all, we might be in trouble.
                            // But maybe we are returning stock to an empty inventory?
                            // In that case, default to user's org is probably fine, or we should look for ANY inventory record even with 0 stock.
                             const { data: anyInventory } = await supabase
                                .from('product_inventory')
                                .select('organization_id')
                                .eq('variant_id', variantId)
                                .limit(1)
                            
                            if (anyInventory && anyInventory.length > 0) {
                                targetOrgId = anyInventory[0].organization_id
                            }
                        }

                        // If change > 0, we need to DEDUCT from stock (allocate more) -> quantity_change should be negative
                        // If change < 0, we need to RETURN to stock (deallocate) -> quantity_change should be positive
                        const quantityChange = -1 * change
                        
                        console.log(`Processing stock movement: Variant ${variantId}, Change ${change}, QtyChange ${quantityChange}, TargetOrg ${targetOrgId}`)

                        if (!targetOrgId) {
                            console.error('No target organization found for stock movement')
                            throw new Error('No target organization found for stock movement')
                        }
                        
                        const { error: stockMoveError } = await supabase.rpc('record_stock_movement', {
                            p_movement_type: 'scratch_game_out',
                            p_variant_id: variantId,
                            p_organization_id: targetOrgId,
                            p_quantity_change: quantityChange,
                            p_unit_cost: 0, 
                            p_reason: `Scratch Card Campaign: ${formData.name}`,
                            p_reference_type: 'campaign',
                            p_reference_id: currentCampaignId,
                            p_created_by: userProfile.id
                        })

                        if (stockMoveError) {
                            console.error('Stock movement RPC error:', JSON.stringify(stockMoveError, null, 2))
                            throw new Error(`Stock movement failed: ${stockMoveError.message || JSON.stringify(stockMoveError)}`)
                        }
                    }
                } catch (stockError: any) {
                    console.error('Stock movement error:', stockError)
                    toast({ 
                        title: "Warning", 
                        description: `Campaign saved but stock updates failed: ${stockError.message || 'Unknown error'}`, 
                        variant: "destructive" 
                    })
                }
            }
        }

        toast({ title: "Success", description: "Campaign saved successfully" })
        setLoading(false)
        onBack()
    }

    const handleImageUpload = async (index: number, file: File) => {
        if (!file) return

        // Check size (5KB is extremely small, but user requested it)
        // We will try to resize aggressively
        const reader = new FileReader()
        reader.onload = (e) => {
            const img = new Image()
            img.onload = () => {
                const canvas = document.createElement('canvas')
                // Calculate new size to fit within reasonable bounds (e.g. 100x100 for small icon)
                const MAX_WIDTH = 150
                const MAX_HEIGHT = 150
                let width = img.width
                let height = img.height

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width
                        width = MAX_WIDTH
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height
                        height = MAX_HEIGHT
                    }
                }

                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext('2d')
                if (ctx) {
                    ctx.drawImage(img, 0, 0, width, height)
                    
                    // Try webp for better compression with transparency
                    let dataUrl = canvas.toDataURL('image/webp', 0.5)
                    
                    // Fallback to jpeg if webp not supported or resulted in larger size (unlikely)
                    if (dataUrl.indexOf('data:image/webp') === -1) {
                        // Fill white background for jpeg
                        ctx.globalCompositeOperation = 'destination-over'
                        ctx.fillStyle = '#ffffff'
                        ctx.fillRect(0, 0, width, height)
                        dataUrl = canvas.toDataURL('image/jpeg', 0.5)
                    }

                    // Check size
                    const sizeInBytes = Math.ceil((dataUrl.length - 'data:image/webp;base64,'.length) * 3 / 4)
                    console.log('Compressed image size:', sizeInBytes, 'bytes')

                    updateReward(index, 'image_url', dataUrl)
                }
            }
            img.src = e.target?.result as string
        }
        reader.readAsDataURL(file)
    }

    const addReward = () => {
        setRewards([...rewards, {
            name: 'New Reward',
            type: 'points',
            probability: 0,
            is_active: true
        }])
    }

    const removeReward = (index: number) => {
        const newRewards = [...rewards]
        newRewards.splice(index, 1)
        setRewards(newRewards)
    }

    const updateReward = (index: number, field: string, value: any) => {
        const newRewards = [...rewards]
        newRewards[index] = { ...newRewards[index], [field]: value }
        setRewards(newRewards)
    }

    return (
        <div className="space-y-6 pb-20">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={onBack}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">
                            {campaignId ? 'Edit Campaign' : 'New Campaign'}
                        </h2>
                    </div>
                </div>
                <Button onClick={handleSave} disabled={loading}>
                    <Save className="mr-2 h-4 w-4" />
                    {loading ? 'Saving...' : 'Save Campaign'}
                </Button>
            </div>

            <Tabs defaultValue="basic" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="basic">Basic Info</TabsTrigger>
                    <TabsTrigger value="rewards">Rewards & Rules</TabsTrigger>
                    <TabsTrigger value="design">Design & Experience</TabsTrigger>
                </TabsList>

                <TabsContent value="basic">
                    <Card>
                        <CardHeader>
                            <CardTitle>Campaign Details</CardTitle>
                            <CardDescription>Configure the basic settings for your scratch card campaign.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Campaign Name</Label>
                                    <Input 
                                        value={formData.name} 
                                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                                        placeholder="e.g. Summer Scratch & Win"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Status</Label>
                                    <Select 
                                        value={formData.status} 
                                        onValueChange={(val) => setFormData({...formData, status: val})}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="draft">Draft</SelectItem>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="scheduled">Scheduled</SelectItem>
                                            <SelectItem value="ended">Ended</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea 
                                    value={formData.description} 
                                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                                    placeholder="Internal description..."
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Linked Journey</Label>
                                <Select 
                                    value={formData.journey_config_id} 
                                    onValueChange={(val) => setFormData({...formData, journey_config_id: val})}
                                    disabled={journeys.length === 0}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={journeys.length === 0 ? "No journeys found. Please create a journey first." : "Select a journey..."} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {journeys.map(j => (
                                            <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Only journeys with "Scratch Card Game" enabled will show this campaign.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Start Date</Label>
                                    <Input 
                                        type="date" 
                                        value={formData.start_at} 
                                        onChange={(e) => setFormData({...formData, start_at: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>End Date</Label>
                                    <Input 
                                        type="date" 
                                        value={formData.end_at} 
                                        onChange={(e) => setFormData({...formData, end_at: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                                <div className="space-y-2">
                                    <Label>Max Plays / Day</Label>
                                    <Input 
                                        type="number" 
                                        value={formData.max_plays_per_day} 
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value)
                                            setFormData({...formData, max_plays_per_day: isNaN(val) ? 0 : val})
                                        }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Max Plays / Consumer</Label>
                                    <Input 
                                        type="number" 
                                        value={formData.max_plays_total_per_consumer} 
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value)
                                            setFormData({...formData, max_plays_total_per_consumer: isNaN(val) ? 0 : val})
                                        }}
                                        placeholder="0 for unlimited"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Max Total Plays (Campaign)</Label>
                                    <Input 
                                        type="number" 
                                        value={formData.max_total_plays} 
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value)
                                            setFormData({...formData, max_total_plays: isNaN(val) ? 0 : val})
                                        }}
                                        placeholder="0 for unlimited"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="rewards">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Rewards & Probabilities</CardTitle>
                                <CardDescription>
                                    Define what users can win. Total probability must equal 100%.
                                </CardDescription>
                            </div>
                            <Button size="sm" onClick={addReward}>
                                <Plus className="mr-2 h-4 w-4" /> Add Reward
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {rewards.map((reward, index) => (
                                <div key={index} className="flex gap-4 items-start p-4 border rounded-lg bg-slate-50">
                                    <div className="flex-1 grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Reward Name</Label>
                                            <Input 
                                                value={reward.name} 
                                                onChange={(e) => updateReward(index, 'name', e.target.value)}
                                                placeholder="e.g. 100 Points"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Type</Label>
                                            <Select 
                                                value={reward.type} 
                                                onValueChange={(val) => updateReward(index, 'type', val)}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="points">Points</SelectItem>
                                                    <SelectItem value="product">Product Gift</SelectItem>
                                                    <SelectItem value="voucher">Voucher</SelectItem>
                                                    <SelectItem value="link">Mystery Gift</SelectItem>
                                                    <SelectItem value="no_prize">No Prize</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {reward.type === 'points' && (
                                            <div className="space-y-2">
                                                <Label>Points Value</Label>
                                                <Input 
                                                    type="number" 
                                                    value={reward.value_points || ''} 
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value)
                                                        updateReward(index, 'value_points', isNaN(val) ? 0 : val)
                                                    }}
                                                />
                                                {pointValueRM > 0 && reward.value_points > 0 && (
                                                    <p className="text-xs text-muted-foreground">
                                                        Est. Cost: RM {((reward.value_points * pointValueRM).toFixed(2))}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {reward.type === 'product' && (
                                            <div className="space-y-2">
                                                <Label>Product</Label>
                                                <Select 
                                                    value={reward.variant_id || ''} 
                                                    onValueChange={(val) => {
                                                        const selected = products.find(p => p.variant_id === val)
                                                        const newRewards = [...rewards]
                                                        newRewards[index] = { 
                                                            ...newRewards[index], 
                                                            variant_id: val,
                                                            product_id: selected?.product_id || null
                                                        }
                                                        setRewards(newRewards)
                                                    }}
                                                    disabled={products.length === 0}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder={products.length === 0 ? "No products found" : "Select product..."} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {products.length === 0 ? (
                                                            <SelectItem value="none" disabled>No products available</SelectItem>
                                                        ) : (
                                                            products.map(p => (
                                                                <SelectItem key={p.variant_id} value={p.variant_id}>
                                                                    <div className="flex justify-between w-full gap-4">
                                                                        <span>{p.product_name} - {p.variant_name}</span>
                                                                        <span className="text-muted-foreground">({p.quantity_available} Available)</span>
                                                                    </div>
                                                                </SelectItem>
                                                            ))
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                                <div className="space-y-2 mt-2">
                                                    <Label>Quantity to Allocate</Label>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        value={reward.product_quantity || ''}
                                                        onChange={(e) => {
                                                            const val = parseInt(e.target.value)
                                                            updateReward(index, 'product_quantity', isNaN(val) ? 0 : val)
                                                        }}
                                                        placeholder="Qty"
                                                    />
                                                </div>
                                                {reward.variant_id && (
                                                    <div className="mt-2 p-2 border rounded-md bg-slate-50">
                                                        <Label className="text-xs text-muted-foreground mb-2 block">Product Variant Preview</Label>
                                                        {(() => {
                                                            const prod = products.find(p => p.variant_id === reward.variant_id)
                                                            const img = prod?.variant_image_url
                                                            
                                                            if (prod) {
                                                                return (
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="flex items-center gap-3">
                                                                            <div className="relative w-16 h-16 border rounded overflow-hidden bg-white">
                                                                                {img ? (
                                                                                    <img src={img} alt={prod.variant_name} className="w-full h-full object-contain" />
                                                                                ) : (
                                                                                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                                                        <Gift className="w-6 h-6" />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-sm font-medium">
                                                                                <div>{prod.product_name}</div>
                                                                                <div className="text-xs text-muted-foreground">{prod.variant_name}</div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <div className="text-xs text-muted-foreground">Available Stock</div>
                                                                            <div className="text-lg font-bold text-green-600">{prod.quantity_available}</div>
                                                                        </div>
                                                                    </div>
                                                                )
                                                            }
                                                            return <div className="text-sm text-muted-foreground italic">Product not found</div>
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {(reward.type === 'voucher' || reward.type === 'link') && (
                                            <div className="space-y-2">
                                                <Label>{reward.type === 'voucher' ? 'Voucher Image' : 'Mystery Gift Image'}</Label>
                                                <div className="flex items-center gap-4">
                                                    <Input 
                                                        type="file" 
                                                        accept="image/*"
                                                        onChange={(e) => {
                                                            if (e.target.files?.[0]) {
                                                                handleImageUpload(index, e.target.files[0])
                                                            }
                                                        }}
                                                    />
                                                    {reward.image_url && (
                                                        <div className="relative w-16 h-16 border rounded overflow-hidden shrink-0">
                                                            <img src={reward.image_url} alt="Preview" className="w-full h-full object-contain" />
                                                        </div>
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Image will be compressed to &lt; 5KB.
                                                </p>
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            <Label>Probability (%)</Label>
                                            <Input 
                                                type="number" 
                                                step="0.1"
                                                value={isNaN(reward.probability) ? '' : reward.probability} 
                                                onChange={(e) => {
                                                    const val = parseFloat(e.target.value)
                                                    updateReward(index, 'probability', isNaN(val) ? 0 : val)
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <Button variant="ghost" size="icon" className="text-red-500 mt-8" onClick={() => removeReward(index)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <div className="text-right text-sm font-medium">
                                Total Probability: {rewards.reduce((sum, r) => sum + (parseFloat(r.probability) || 0), 0)}%
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="design">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Theme & Content</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Primary Color</Label>
                                    <div className="flex gap-2">
                                        <Input 
                                            type="color" 
                                            value={formData.theme_config.primary_color} 
                                            onChange={(e) => setFormData({
                                                ...formData, 
                                                theme_config: { ...formData.theme_config, primary_color: e.target.value }
                                            })}
                                            className="w-12 h-10 p-1"
                                        />
                                        <Input 
                                            value={formData.theme_config.primary_color} 
                                            onChange={(e) => setFormData({
                                                ...formData, 
                                                theme_config: { ...formData.theme_config, primary_color: e.target.value }
                                            })}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>Title Text (Before Scratch)</Label>
                                    <Input 
                                        value={formData.theme_config.title_text} 
                                        onChange={(e) => setFormData({
                                            ...formData, 
                                            theme_config: { ...formData.theme_config, title_text: e.target.value }
                                        })}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Success Message</Label>
                                    <Input 
                                        value={formData.theme_config.success_message} 
                                        onChange={(e) => setFormData({
                                            ...formData, 
                                            theme_config: { ...formData.theme_config, success_message: e.target.value }
                                        })}
                                    />
                                    <p className="text-xs text-muted-foreground">Use {'{{reward_name}}'} as placeholder</p>
                                </div>

                                <div className="space-y-2">
                                    <Label>No Prize Message</Label>
                                    <Input 
                                        value={formData.theme_config.no_prize_message} 
                                        onChange={(e) => setFormData({
                                            ...formData, 
                                            theme_config: { ...formData.theme_config, no_prize_message: e.target.value }
                                        })}
                                    />
                                </div>

                                <div className="flex items-center justify-between pt-4">
                                    <Label>Show Confetti on Win</Label>
                                    <Switch 
                                        checked={formData.theme_config.show_confetti}
                                        onCheckedChange={(checked) => setFormData({
                                            ...formData, 
                                            theme_config: { ...formData.theme_config, show_confetti: checked }
                                        })}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Preview</CardTitle>
                                <CardDescription>
                                    Theme: {THEMES.find(t => t.id === formData.theme_config.theme_id)?.name}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center justify-center gap-4">
                                    <Button 
                                        variant="outline" 
                                        size="icon" 
                                        onClick={() => handleThemeChange('prev')}
                                        className="rounded-full h-10 w-10"
                                    >
                                        <ChevronLeft className="h-6 w-6" />
                                    </Button>

                                    <div className="border-8 border-gray-800 rounded-[30px] overflow-hidden bg-gray-100 h-[500px] relative w-[280px] shadow-2xl">
                                        {/* Phone Content - Matching Consumer UI */}
                                        {(() => {
                                            const themeId = formData.theme_config.theme_id || 'modern'
                                            const titleText = formData.theme_config.title_text || 'SCRATCH & WIN'

                                            if (themeId === 'retro') {
                                                return (
                                                    <div className="h-full flex flex-col relative overflow-hidden bg-green-500">
                                                        <div className="absolute inset-0 bg-[repeating-conic-gradient(#22c55e_0deg_15deg,#4ade80_15deg_30deg)] opacity-100"></div>
                                                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20"></div>
                                                        
                                                        <div className="relative z-10 flex items-center justify-between px-4 py-4">
                                                            <div className="p-2 bg-white/90 rounded-full shadow-lg text-green-700"><ArrowLeft className="w-4 h-4" strokeWidth={3} /></div>
                                                        </div>

                                                        <div className="relative z-10 flex-1 flex flex-col items-center px-4 pb-8">
                                                            <div className="mt-2 mb-6 relative transform -rotate-2">
                                                                <div className="absolute inset-0 bg-red-700 rounded-xl transform rotate-3 scale-105 border-2 border-white shadow-xl"></div>
                                                                <div className="relative bg-red-600 px-4 py-2 rounded-lg border-2 border-yellow-400 shadow-[0_5px_0_rgb(180,0,0)]">
                                                                    <h1 className="text-xl font-black text-yellow-300 drop-shadow-[1px_1px_0_rgba(0,0,0,0.5)] uppercase tracking-wider text-center leading-none">{titleText}</h1>
                                                                </div>
                                                            </div>

                                                            <div className="w-full max-w-[200px] mx-auto relative z-20 mb-6">
                                                                <div className="bg-yellow-400 p-1.5 rounded-xl shadow-[0_0_10px_rgba(255,255,0,0.5)]">
                                                                    <div className="bg-red-600 p-1.5 rounded-lg border-2 border-dashed border-white/50">
                                                                        <div className="bg-white rounded-md overflow-hidden relative aspect-[4/3]">
                                                                            <div className="w-full h-full bg-gradient-to-br from-gray-300 via-gray-100 to-gray-300 flex items-center justify-center">
                                                                                <span className="text-sm font-bold text-gray-500/80">SCRATCH</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }

                                            if (themeId === 'vip') {
                                                return (
                                                    <div className="h-full flex flex-col bg-slate-950 relative overflow-hidden">
                                                        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                                                        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/50 via-transparent to-slate-900/80"></div>
                                                        <div className="absolute inset-3 border border-yellow-600/30 rounded-[20px] pointer-events-none"></div>

                                                        <div className="relative z-10 flex items-center justify-between px-4 py-4">
                                                            <div className="text-yellow-500"><ArrowLeft className="w-4 h-4" /></div>
                                                            <span className="text-[8px] font-serif tracking-[0.2em] text-yellow-600 uppercase">Exclusive</span>
                                                            <div className="w-4"></div>
                                                        </div>

                                                        <div className="relative z-10 flex-1 flex flex-col items-center px-4 pb-8">
                                                            <div className="mt-4 mb-8 text-center">
                                                                <h1 className="text-xl font-serif text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-700 drop-shadow-sm tracking-widest">{titleText}</h1>
                                                                <div className="h-[1px] w-16 mx-auto mt-2 bg-gradient-to-r from-transparent via-yellow-600 to-transparent"></div>
                                                            </div>

                                                            <div className="w-full max-w-[200px] mx-auto relative z-20 mb-8">
                                                                <div className="p-[1px] bg-gradient-to-br from-yellow-400 via-yellow-600 to-yellow-800 rounded-xl shadow-xl">
                                                                    <div className="bg-slate-900 p-3 rounded-xl">
                                                                        <div className="relative aspect-[4/3] rounded-lg overflow-hidden border border-yellow-900/50">
                                                                            <div className="w-full h-full bg-gradient-to-br from-yellow-100 via-yellow-200 to-yellow-100 flex items-center justify-center">
                                                                                <span className="text-sm font-bold text-yellow-900">SCRATCH</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }

                                            if (themeId === 'cyber') {
                                                return (
                                                    <div className="h-full flex flex-col bg-slate-900 relative overflow-hidden font-mono">
                                                        <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:20px_20px]"></div>
                                                        
                                                        <div className="relative z-10 flex items-center justify-between px-4 py-4">
                                                            <div className="p-1 border border-cyan-500/50 text-cyan-400"><ArrowLeft className="w-4 h-4" /></div>
                                                            <div className="px-2 py-0.5 border border-pink-500/50 bg-pink-950/30"><span className="text-[8px] text-pink-400 uppercase tracking-widest">Sys.Init</span></div>
                                                            <div className="w-5"></div>
                                                        </div>

                                                        <div className="relative z-10 flex-1 flex flex-col items-center px-4 pb-8">
                                                            <div className="mt-6 mb-8 text-center relative">
                                                                <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 drop-shadow-[0_0_5px_rgba(0,255,255,0.5)] tracking-tighter">{titleText}</h1>
                                                            </div>

                                                            <div className="w-full max-w-[200px] mx-auto relative z-20 mb-8">
                                                                <div className="relative">
                                                                    <div className="absolute -top-1 -left-1 w-2 h-2 border-t border-l border-cyan-500"></div>
                                                                    <div className="absolute -top-1 -right-1 w-2 h-2 border-t border-r border-cyan-500"></div>
                                                                    <div className="absolute -bottom-1 -left-1 w-2 h-2 border-b border-l border-cyan-500"></div>
                                                                    <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b border-r border-cyan-500"></div>
                                                                    
                                                                    <div className="bg-slate-800/80 backdrop-blur border border-slate-700 p-1">
                                                                        <div className="relative aspect-[4/3] overflow-hidden">
                                                                            <div className="w-full h-full bg-gradient-to-br from-slate-700 via-slate-600 to-slate-700 flex items-center justify-center">
                                                                                <span className="text-sm font-bold text-cyan-400">SCRATCH</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }

                                            // Modern (Default)
                                            return (
                                                <div className="h-full flex flex-col bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-800 text-white">
                                                    <div className="flex items-center justify-between px-4 py-4">
                                                        <div className="p-2 bg-white/20 rounded-full backdrop-blur-sm"><ArrowLeft className="w-4 h-4 text-white" /></div>
                                                        <div className="px-3 py-1 bg-black/20 rounded-full backdrop-blur-sm border border-white/10"><span className="text-[10px] font-medium text-emerald-100">Scratch & Win</span></div>
                                                        <div className="w-8"></div>
                                                    </div>

                                                    <div className="flex-1 flex flex-col items-center px-4 pb-8">
                                                        <div className="mt-2 mb-4 text-center relative z-10">
                                                            <h1 className="text-2xl font-extrabold text-yellow-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] tracking-tight">{titleText}</h1>
                                                            <div className="mt-1 inline-block px-3 py-0.5 bg-gradient-to-r from-red-500 to-orange-500 rounded-full shadow-lg transform -rotate-2">
                                                                <p className="text-[10px] font-bold text-white uppercase tracking-widest">Daily Chance</p>
                                                            </div>
                                                        </div>

                                                        <div className="relative mb-4 w-full flex justify-center">
                                                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-white/20 blur-2xl rounded-full pointer-events-none animate-pulse"></div>
                                                            <div className="relative z-10 w-24 h-24 flex items-center justify-center">
                                                                <Gift className="w-16 h-16 text-white drop-shadow-lg opacity-90" />
                                                            </div>
                                                        </div>

                                                        <div className="w-full max-w-[200px] mx-auto relative z-20 mb-6">
                                                            <div className="bg-white p-1 rounded-[1.5rem] shadow-xl">
                                                                <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-[1.3rem] overflow-hidden relative aspect-[4/3]">
                                                                    <div className="w-full h-full bg-gradient-to-br from-gray-300 via-gray-200 to-gray-400 flex items-center justify-center">
                                                                        <span className="text-lg font-bold text-gray-500/80 drop-shadow-sm tracking-widest">SCRATCH</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })()}
                                    </div>

                                    <Button 
                                        variant="outline" 
                                        size="icon" 
                                        onClick={() => handleThemeChange('next')}
                                        className="rounded-full h-10 w-10"
                                    >
                                        <ChevronRight className="h-6 w-6" />
                                    </Button>
                                </div>
                                <div className="text-center mt-4 text-sm text-muted-foreground">
                                    Use arrows to select a theme
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}
