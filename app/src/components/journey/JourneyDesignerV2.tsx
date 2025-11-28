'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useToast } from '@/components/ui/use-toast'
import {
    ArrowLeft,
    Save,
    Eye,
    Gift,
    Star,
    Coins,
    Smartphone,
    CheckCircle2,
    Settings,
    Palette,
    Layout,
    Info,
    Truck,
    Clock
} from 'lucide-react'
import JourneyMobilePreviewV2 from './JourneyMobilePreviewV2'
import InteractiveMobilePreviewV2 from './InteractiveMobilePreviewV2'

const PRODUCT_CONSUMER_READY_STATUSES = ['shipped_distributor', 'activated', 'redeemed'] as const
const MASTER_CONSUMER_READY_STATUSES = ['shipped_distributor', 'opened'] as const

interface Order {
    id: string
    order_no: string
    order_type: string
    status: string
    has_redeem: boolean
    has_lucky_draw: boolean
    company_id: string
}

interface UserProfile {
    id: string
    organization_id: string
}

interface JourneyConfig {
    id?: string
    name: string
    is_active: boolean
    is_default: boolean
    points_enabled: boolean
    lucky_draw_enabled: boolean
    redemption_enabled: boolean
    require_staff_otp_for_points: boolean
    require_customer_otp_for_lucky_draw: boolean
    require_customer_otp_for_redemption: boolean
    start_at: string
    end_at: string
    welcome_title: string
    welcome_message: string
    thank_you_message: string
    primary_color: string
    button_color: string
    show_product_image?: boolean
    product_image_source?: 'variant' | 'custom' | 'genuine_badge'
    product_image_url?: string
    variant_image_url?: string | null
    custom_image_url?: string
    genuine_badge_style?: string
}

export default function JourneyDesignerV2({
    order,
    userProfile,
    journey,
    onBack,
    onSuccess
}: {
    order: Order
    userProfile: UserProfile
    journey?: any
    onBack: () => void
    onSuccess: () => void
}) {
    const [saving, setSaving] = useState(false)
    const [showPreview, setShowPreview] = useState(true)
    const [uploadingImage, setUploadingImage] = useState(false)
    const [productsShipped, setProductsShipped] = useState(false)
    const [checkingShipment, setCheckingShipment] = useState(true)
    const [hasLuckyDrawCampaign, setHasLuckyDrawCampaign] = useState(false)
    const [hasRedemptionConfig, setHasRedemptionConfig] = useState(false)
    const [checkingFeatures, setCheckingFeatures] = useState(true)
    const [luckyDrawCampaignId, setLuckyDrawCampaignId] = useState<string | null>(null)
    const headerRef = useRef<HTMLDivElement | null>(null)
    const [previewMetrics, setPreviewMetrics] = useState({ top: 104, maxHeight: 640 })
    const { toast } = useToast()

    const [config, setConfig] = useState<JourneyConfig>({
        id: journey?.id,
        name: journey?.name || `Journey for ${order.order_no}`,
        is_active: journey?.is_active ?? true,
        is_default: journey?.is_default ?? false,
        points_enabled: journey?.points_enabled ?? true,
        lucky_draw_enabled: journey?.lucky_draw_enabled ?? order.has_lucky_draw,
        redemption_enabled: journey?.redemption_enabled ?? order.has_redeem,
        require_staff_otp_for_points: journey?.require_staff_otp_for_points ?? false,
        require_customer_otp_for_lucky_draw: journey?.require_customer_otp_for_lucky_draw ?? false,
        require_customer_otp_for_redemption: journey?.require_customer_otp_for_redemption ?? false,
        start_at: journey?.start_at ? journey.start_at.split('T')[0] : new Date().toISOString().split('T')[0],
        end_at: journey?.end_at ? journey.end_at.split('T')[0] : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        welcome_title: journey?.welcome_title || 'Welcome!',
        welcome_message: journey?.welcome_message || 'Thank you for scanning our QR code. Enjoy exclusive rewards and benefits!',
        thank_you_message: journey?.thank_you_message || 'Thank you for your participation!',
        primary_color: journey?.primary_color || '#3B82F6',
        button_color: journey?.button_color || '#10B981',
        show_product_image: journey?.show_product_image ?? false,
        product_image_source: journey?.product_image_source ?? 'variant',
        custom_image_url: journey?.custom_image_url ?? '',
        genuine_badge_style: journey?.genuine_badge_style ?? 'gold'
    })

    const supabase = createClient()

    const updatePreviewMetrics = useCallback(() => {
        if (typeof window === 'undefined') return

        const headerHeight = headerRef.current?.offsetHeight ?? 0
        const viewportHeight = window.innerHeight
        const gutter = 24 // keep a comfortable gap below the header

        const top = headerHeight + gutter
        const maxHeight = Math.max(viewportHeight - top - gutter, 420)

        setPreviewMetrics((current) => {
            if (current.top === top && current.maxHeight === maxHeight) {
                return current
            }
            return { top, maxHeight }
        })
    }, [])

    useEffect(() => {
        updatePreviewMetrics()
        window.addEventListener('resize', updatePreviewMetrics)
        return () => window.removeEventListener('resize', updatePreviewMetrics)
    }, [updatePreviewMetrics])

    useEffect(() => {
        if (showPreview) {
            updatePreviewMetrics()
        }
    }, [showPreview, updatePreviewMetrics])

    // Check if products have been shipped to distributor
    useEffect(() => {
        async function checkShipmentStatus() {
            try {
                setCheckingShipment(true)
                const [masterResult, uniqueByOrderResult] = await Promise.all([
                    supabase
                        .from('qr_master_codes')
                        .select(`
                            id,
                            status,
                            qr_batches!inner (
                                order_id
                            )
                        `)
                        .eq('qr_batches.order_id', order.id)
                        .in('status', MASTER_CONSUMER_READY_STATUSES)
                        .limit(1),
                    supabase
                        .from('qr_codes')
                        .select('id')
                        .eq('order_id', order.id)
                        .in('status', PRODUCT_CONSUMER_READY_STATUSES)
                        .limit(1)
                ])

                let hasShipped = false

                if (masterResult.error) {
                    console.error('[Journey] Error checking master shipment status:', masterResult.error)
                } else if ((masterResult.data?.length || 0) > 0) {
                    hasShipped = true
                }

                if (uniqueByOrderResult.error) {
                    console.error('[Journey] Error checking unique shipment status (order linkage):', uniqueByOrderResult.error)
                } else if ((uniqueByOrderResult.data?.length || 0) > 0) {
                    hasShipped = true
                }

                // Some QR codes may only be linked through batches, so fall back to join if needed
                if (!hasShipped) {
                    const { data: uniqueByBatch, error: uniqueByBatchError } = await supabase
                        .from('qr_codes')
                        .select(`
                            id,
                            status,
                            qr_batches!inner (
                                order_id
                            )
                        `)
                        .in('status', PRODUCT_CONSUMER_READY_STATUSES)
                        .eq('qr_batches.order_id', order.id)
                        .limit(1)

                    if (uniqueByBatchError) {
                        console.error('[Journey] Error checking unique shipment status (batch linkage):', uniqueByBatchError)
                    } else if ((uniqueByBatch?.length || 0) > 0) {
                        hasShipped = true
                    }
                }

                setProductsShipped(hasShipped)
                console.log(`[Journey] Shipment check for order ${order.order_no}:`, hasShipped ? 'Products shipped ✅' : 'Awaiting shipment 🕐')
            } catch (error) {
                console.error('[Journey] Error checking shipment:', error)
                setProductsShipped(false)
            } finally {
                setCheckingShipment(false)
            }
        }
        
        checkShipmentStatus()
    }, [order.id, order.order_no, supabase])

    // Check for feature configuration existence
    useEffect(() => {
        async function checkFeatures() {
            if (!order.id) return
            setCheckingFeatures(true)
            
            try {
                // Check Lucky Draw
                if (order.has_lucky_draw) {
                    const { data: ldLink } = await supabase
                        .from('lucky_draw_order_links')
                        .select('id, campaign_id')
                        .eq('order_id', order.id)
                        .limit(1)
                        .maybeSingle()
                    
                    setHasLuckyDrawCampaign(!!ldLink)
                    if (ldLink?.campaign_id) {
                        setLuckyDrawCampaignId(ldLink.campaign_id)
                    }
                    
                    // If no campaign, ensure toggle is off (only for new journeys or if invalid)
                    if (!ldLink && !journey) {
                        setConfig(prev => ({ ...prev, lucky_draw_enabled: false }))
                    }
                }

                // Check Redemption
                if (order.has_redeem) {
                    const { count } = await supabase
                        .from('redeem_gifts')
                        .select('*', { count: 'exact', head: true })
                        .eq('order_id', order.id)
                    
                    const hasRedeem = (count || 0) > 0
                    setHasRedemptionConfig(hasRedeem)

                    // If no redemption config, ensure toggle is off
                    if (!hasRedeem && !journey) {
                        setConfig(prev => ({ ...prev, redemption_enabled: false }))
                    }
                }
            } catch (error) {
                console.error('Error checking features:', error)
            } finally {
                setCheckingFeatures(false)
            }
        }

        checkFeatures()
    }, [order.id, order.has_lucky_draw, order.has_redeem, journey, supabase])

    // Fetch product variant image
    useEffect(() => {
        async function fetchProductImage() {
            if (!order.id) return

            try {
                // Get the first order item to find the variant
                const { data: orderItems } = await supabase
                    .from('order_items')
                    .select('variant_id')
                    .eq('order_id', order.id)
                    .limit(1)
                    .single()

                if (orderItems?.variant_id) {
                    const { data: variant } = await supabase
                        .from('product_variants')
                        .select('image_url')
                        .eq('id', orderItems.variant_id)
                        .single()

                    if (variant?.image_url) {
                        setConfig(prev => ({ ...prev, variant_image_url: variant.image_url }))
                    }
                }
            } catch (error) {
                console.error('Error fetching product image:', error)
            }
        }

        fetchProductImage()
    }, [order.id, supabase])

    // Compress image for mobile optimization
    const compressImage = (file: File): Promise<File> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.readAsDataURL(file)
            reader.onload = (event) => {
                const img = new window.Image()
                img.src = event.target?.result as string
                img.onload = () => {
                    const canvas = document.createElement('canvas')
                    const ctx = canvas.getContext('2d')
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'))
                        return
                    }

                    // Target size: 400x400px for mobile display
                    const MAX_WIDTH = 400
                    const MAX_HEIGHT = 400
                    let width = img.width
                    let height = img.height

                    // Calculate aspect ratio
                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height = Math.round((height * MAX_WIDTH) / width)
                            width = MAX_WIDTH
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width = Math.round((width * MAX_HEIGHT) / height)
                            height = MAX_HEIGHT
                        }
                    }

                    canvas.width = width
                    canvas.height = height

                    // Draw image on canvas with high quality
                    ctx.imageSmoothingEnabled = true
                    ctx.imageSmoothingQuality = 'high'
                    ctx.drawImage(img, 0, 0, width, height)

                    // Convert to blob with compression (JPEG 70% quality for ~5KB)
                    canvas.toBlob(
                        (blob) => {
                            if (blob) {
                                const compressedFile = new File([blob], file.name, {
                                    type: 'image/jpeg',
                                    lastModified: Date.now(),
                                })
                                resolve(compressedFile)
                            } else {
                                reject(new Error('Failed to compress image'))
                            }
                        },
                        'image/jpeg',
                        0.7
                    )
                }
                img.onerror = () => reject(new Error('Failed to load image'))
            }
            reader.onerror = () => reject(new Error('Failed to read file'))
        })
    }

    const handleImageUpload = async (file: File) => {
        try {
            setUploadingImage(true)

            // Compress image before upload
            const compressedFile = await compressImage(file)

            const fileExt = 'jpg' // Always use jpg after compression
            const fileName = `journey-${order.id}-${Date.now()}.${fileExt}`
            const filePath = `journey-images/${fileName}`

            // Upload compressed image to Supabase storage
            const { error: uploadError } = await supabase.storage
                .from('product-images')
                .upload(filePath, compressedFile, {
                    cacheControl: '3600',
                    upsert: true
                })

            if (uploadError) throw uploadError

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('product-images')
                .getPublicUrl(filePath)

            // Update config with the uploaded image URL
            setConfig({ ...config, custom_image_url: urlData.publicUrl })

            toast({
                title: "Image uploaded",
                description: "Journey image has been compressed and uploaded successfully (~5KB)",
            })
        } catch (error: any) {
            console.error('[Journey] Error uploading image:', error)
            toast({
                title: "Upload failed",
                description: error.message || "Failed to upload image",
                variant: "destructive"
            })
        } finally {
            setUploadingImage(false)
        }
    }

    async function handleSave() {
        try {
            setSaving(true)

            // Validate
            if (!config.name.trim()) {
                toast({
                    title: "Validation Error",
                    description: "Please enter a journey name",
                    variant: "destructive",
                })
                return
            }

            if (!config.points_enabled && !config.lucky_draw_enabled && !config.redemption_enabled) {
                toast({
                    title: "Validation Error",
                    description: "Please enable at least one feature (Points, Lucky Draw, or Redemption)",
                    variant: "destructive",
                })
                return
            }

            if (config.start_at && config.end_at && new Date(config.start_at) >= new Date(config.end_at)) {
                toast({
                    title: "Validation Error",
                    description: "End date must be after start date",
                    variant: "destructive",
                })
                return
            }

            // Determine activation status
            let activationStatus = 'ready'
            let finalIsActive = config.is_active
            
            if (!productsShipped) {
                // Products haven't shipped yet
                if (config.is_active) {
                    // User wants to activate but products not shipped - set to pending
                    activationStatus = 'pending_ship'
                    finalIsActive = false // Keep inactive until products ship
                } else {
                    activationStatus = 'ready'
                }
            } else {
                // Products have shipped
                if (config.is_active) {
                    activationStatus = 'auto_activated'
                } else {
                    activationStatus = 'manually_deactivated'
                }
            }

            // Create or update journey configuration
            const journeyData: any = {
                org_id: userProfile.organization_id,
                name: config.name,
                is_active: finalIsActive,
                is_default: config.is_default,
                points_enabled: config.points_enabled,
                lucky_draw_enabled: config.lucky_draw_enabled,
                redemption_enabled: config.redemption_enabled,
                require_staff_otp_for_points: config.require_staff_otp_for_points,
                require_customer_otp_for_lucky_draw: config.require_customer_otp_for_lucky_draw,
                require_customer_otp_for_redemption: config.require_customer_otp_for_redemption,
                start_at: config.start_at || null,
                end_at: config.end_at || null,
                created_by: userProfile.id,
                activation_status: activationStatus
            }
            
            // Add theme fields if they exist in the schema
            // These will be ignored if columns don't exist yet (migration not run)
            if (config.welcome_title !== undefined) journeyData.welcome_title = config.welcome_title
            if (config.welcome_message !== undefined) journeyData.welcome_message = config.welcome_message
            if (config.thank_you_message !== undefined) journeyData.thank_you_message = config.thank_you_message
            if (config.primary_color !== undefined) journeyData.primary_color = config.primary_color
            if (config.button_color !== undefined) journeyData.button_color = config.button_color
            if (config.show_product_image !== undefined) journeyData.show_product_image = config.show_product_image
            if (config.product_image_source !== undefined) journeyData.product_image_source = config.product_image_source
            if (config.custom_image_url !== undefined) journeyData.custom_image_url = config.custom_image_url
            if (config.genuine_badge_style !== undefined) journeyData.genuine_badge_style = config.genuine_badge_style

            let journeyId = config.id

            if (config.id) {
                // Update existing journey
                const { error } = await supabase
                    .from('journey_configurations')
                    .update(journeyData)
                    .eq('id', config.id)

                if (error) {
                    console.error('Supabase update error:', error)
                    throw new Error(error.message || 'Failed to update journey')
                }
            } else {
                // Create new journey
                const { data, error } = await supabase
                    .from('journey_configurations')
                    .insert(journeyData)
                    .select()
                    .single()

                if (error) {
                    console.error('Supabase insert error:', error)
                    throw new Error(error.message || 'Failed to create journey')
                }

                journeyId = data.id

                // Link journey to order
                const { error: linkError } = await supabase
                    .from('journey_order_links')
                    .insert({
                        journey_config_id: journeyId,
                        order_id: order.id
                    })

                if (linkError) {
                    console.error('Supabase link error:', linkError)
                    throw new Error(linkError.message || 'Failed to link journey to order')
                }
            }

            // Update Lucky Draw Campaign status if needed
            if (luckyDrawCampaignId) {
                await supabase
                    .from('lucky_draw_campaigns')
                    .update({ 
                        status: config.lucky_draw_enabled ? 'active' : 'closed',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', luckyDrawCampaignId)
            }

            // Show success message based on activation status
            if (!productsShipped && config.is_active) {
                toast({
                    title: "Journey created successfully!",
                    description: `Journey will auto-activate when products from order ${order.order_no} are shipped to distributor.`,
                    variant: "default",
                })
            } else if (config.id) {
                toast({
                    title: "Journey updated!",
                    description: "Your changes have been saved successfully.",
                    variant: "default",
                })
            } else {
                toast({
                    title: "Journey created!",
                    description: "Your journey is now ready for consumers.",
                    variant: "default",
                })
            }
            
            onSuccess()
        } catch (error: any) {
            console.error('[Journey] Error saving journey:', error)
            const errorMessage = error?.message || error?.toString() || 'Unknown error occurred'
            
            toast({
                title: "Failed to save journey",
                description: errorMessage,
                variant: "destructive",
            })
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-6 pb-6">
            {/* Header - Fixed at top */}
            <div
                ref={headerRef}
                className="flex items-center justify-between sticky top-0 z-10 bg-muted/10 py-4 -mt-6 -mx-6 px-6 backdrop-blur-sm border-b"
            >
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="sm" onClick={onBack}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold">
                            {config.id ? 'Edit Journey' : 'Design Your Journey'}
                        </h1>
                        <div className="text-gray-600 mt-1">
                            Order: <Badge variant="outline">{order.order_no}</Badge>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowPreview(!showPreview)}
                    >
                        <Smartphone className="w-4 h-4 mr-2" />
                        {showPreview ? 'Hide' : 'Show'} Preview
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        <Save className="w-4 h-4 mr-2" />
                        {saving ? 'Saving...' : config.id ? 'Update Journey' : 'Create Journey'}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                {/* Configuration Panel */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Basic Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Settings className="w-5 h-5" />
                                Basic Settings
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Journey Name *</Label>
                                <Input
                                    id="name"
                                    value={config.name}
                                    onChange={(e) => setConfig({ ...config, name: e.target.value })}
                                    placeholder="Enter journey name"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="start_at">Start Date</Label>
                                    <Input
                                        id="start_at"
                                        type="date"
                                        value={config.start_at}
                                        onChange={(e) => setConfig({ ...config, start_at: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="end_at">End Date</Label>
                                    <Input
                                        id="end_at"
                                        type="date"
                                        value={config.end_at}
                                        onChange={(e) => setConfig({ ...config, end_at: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5 flex-1">
                                        <div className="flex items-center gap-2">
                                            <Label>Active</Label>
                                            {!productsShipped && !checkingShipment && (
                                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                                                    <Clock className="w-3 h-3 mr-1" />
                                                    Pending Shipment
                                                </Badge>
                                            )}
                                            {productsShipped && (
                                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                                                    <Truck className="w-3 h-3 mr-1" />
                                                    Products Shipped
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600">Enable this journey for consumers</p>
                                    </div>
                                    <Switch
                                        checked={config.is_active}
                                        disabled={!productsShipped && !config.is_active}
                                        onCheckedChange={(checked) => {
                                            if (checked && !productsShipped) {
                                                // User is trying to activate before products ship
                                                toast({
                                                    title: "Cannot activate journey yet",
                                                    description: `Products from order ${order.order_no} must be shipped to distributor first. The journey will auto-activate once products ship.`,
                                                    variant: "default",
                                                })
                                                return
                                            }
                                            setConfig({ ...config, is_active: checked })
                                        }}
                                    />
                                </div>
                                
                                {!productsShipped && !checkingShipment && (
                                    <Alert className="bg-blue-50 border-blue-200">
                                        <Info className="h-4 w-4 text-blue-600" />
                                        <AlertDescription className="text-sm text-blue-800">
                                            <strong>Journey will auto-activate when products ship to distributor.</strong>
                                            <br />
                                            You can create this journey now, but it will remain inactive until at least one product from order <strong>{order.order_no}</strong> reaches &quot;Shipped to Distributor&quot; status. Once shipped, the journey will automatically become active.
                                        </AlertDescription>
                                    </Alert>
                                )}
                                
                                {productsShipped && config.is_active && (
                                    <Alert className="bg-amber-50 border-amber-200">
                                        <Info className="h-4 w-4 text-amber-600" />
                                        <AlertDescription className="text-sm text-amber-800">
                                            <strong>Journey Control:</strong> You can deactivate this journey anytime. When deactivated, consumers will only be able to verify product authenticity and collect points. Lucky Draw and Redemption features will be disabled.
                                        </AlertDescription>
                                    </Alert>
                                )}
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>Set as Default</Label>
                                    <p className="text-sm text-gray-600">Use this journey by default</p>
                                </div>
                                <Switch
                                    checked={config.is_default}
                                    onCheckedChange={(checked) => setConfig({ ...config, is_default: checked })}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Features */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Layout className="w-5 h-5" />
                                Consumer Features
                            </CardTitle>
                            <CardDescription>
                                Enable features that consumers will experience when they scan the QR code
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Points */}
                            <div className="flex items-start justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
                                <div className="flex items-start gap-3 flex-1">
                                    <div className="p-2 bg-blue-100 rounded-lg">
                                        <Coins className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-semibold text-blue-900">Points Collection</h3>
                                            <Switch
                                                checked={config.points_enabled}
                                                onCheckedChange={(checked) => setConfig({ ...config, points_enabled: checked })}
                                            />
                                        </div>
                                        <p className="text-sm text-blue-700 mt-1">
                                            Reward consumers with points for scanning
                                        </p>
                                        {config.points_enabled && (
                                            <div className="mt-3 flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    id="require_staff_otp_for_points"
                                                    checked={config.require_staff_otp_for_points}
                                                    onChange={(e) => setConfig({ ...config, require_staff_otp_for_points: e.target.checked })}
                                                    className="rounded"
                                                />
                                                <Label htmlFor="require_staff_otp_for_points" className="text-sm font-normal cursor-pointer">
                                                    Require staff OTP verification
                                                </Label>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Lucky Draw */}
                            <div className={`flex items-start justify-between p-4 rounded-lg border ${order.has_lucky_draw ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="flex items-start gap-3 flex-1">
                                    <div className={`p-2 rounded-lg ${order.has_lucky_draw ? 'bg-purple-100' : 'bg-gray-100'}`}>
                                        <Star className={`w-5 h-5 ${order.has_lucky_draw ? 'text-purple-600' : 'text-gray-400'}`} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <h3 className={`font-semibold ${order.has_lucky_draw ? 'text-purple-900' : 'text-gray-700'}`}>Lucky Draw</h3>
                                            <Switch
                                                checked={config.lucky_draw_enabled && order.has_lucky_draw}
                                                onCheckedChange={(checked) => {
                                                    if (checked) {
                                                        if (!order.has_lucky_draw) {
                                                            toast({
                                                                title: "Cannot enable Lucky Draw",
                                                                description: "This order type does not support Lucky Draw.",
                                                                variant: "destructive",
                                                            })
                                                            return
                                                        }
                                                        if (!hasLuckyDrawCampaign && !checkingFeatures) {
                                                            toast({
                                                                title: "Cannot enable Lucky Draw",
                                                                description: "Please create a lucky draw campaign for this order first.",
                                                                variant: "destructive",
                                                            })
                                                            return
                                                        }
                                                    }
                                                    setConfig({ ...config, lucky_draw_enabled: checked })
                                                }}
                                            />
                                        </div>
                                        <p className={`text-sm mt-1 ${order.has_lucky_draw ? 'text-purple-700' : 'text-gray-500'}`}>
                                            Give consumers chances to win prizes
                                        </p>

                                        {(!order.has_lucky_draw || (order.has_lucky_draw && !hasLuckyDrawCampaign && !checkingFeatures)) && (
                                            <div className="mt-3 text-sm text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                                                <p className="font-medium">
                                                    {!order.has_lucky_draw ? "Feature Not Available" : "No Lucky Draw Campaign Found"}
                                                </p>
                                                <p className="mt-1">
                                                    {!order.has_lucky_draw 
                                                        ? "This order was created without Lucky Draw enabled." 
                                                        : <>Please <a href={`/dashboard/consumer-engagement/lucky-draw?order_id=${order.id}`} target="_blank" rel="noopener noreferrer" className="underline font-bold hover:text-amber-800">create a lucky draw campaign</a> for this order first.</>}
                                                </p>
                                            </div>
                                        )}

                                        {order.has_lucky_draw && config.lucky_draw_enabled && (
                                            <div className="mt-3 flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    id="require_customer_otp_for_lucky_draw"
                                                    checked={config.require_customer_otp_for_lucky_draw}
                                                    onChange={(e) => setConfig({ ...config, require_customer_otp_for_lucky_draw: e.target.checked })}
                                                    className="rounded"
                                                />
                                                <Label htmlFor="require_customer_otp_for_lucky_draw" className="text-sm font-normal cursor-pointer">
                                                    Require customer OTP verification
                                                </Label>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Redemption */}
                            <div className={`flex items-start justify-between p-4 rounded-lg border ${order.has_redeem ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="flex items-start gap-3 flex-1">
                                    <div className={`p-2 rounded-lg ${order.has_redeem ? 'bg-green-100' : 'bg-gray-100'}`}>
                                        <Gift className={`w-5 h-5 ${order.has_redeem ? 'text-green-600' : 'text-gray-400'}`} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <h3 className={`font-semibold ${order.has_redeem ? 'text-green-900' : 'text-gray-700'}`}>Free Gift Redemption</h3>
                                            <Switch
                                                checked={config.redemption_enabled && order.has_redeem}
                                                onCheckedChange={(checked) => {
                                                    if (checked) {
                                                        if (!order.has_redeem) {
                                                            toast({
                                                                title: "Cannot enable Redemption",
                                                                description: "This order type does not support Redemption.",
                                                                variant: "destructive",
                                                            })
                                                            return
                                                        }
                                                        if (!hasRedemptionConfig && !checkingFeatures) {
                                                            toast({
                                                                title: "Cannot enable Redemption",
                                                                description: "Please configure redemption settings for this order first.",
                                                                variant: "destructive",
                                                            })
                                                            return
                                                        }
                                                    }
                                                    setConfig({ ...config, redemption_enabled: checked })
                                                }}
                                            />
                                        </div>
                                        <p className={`text-sm mt-1 ${order.has_redeem ? 'text-green-700' : 'text-gray-500'}`}>
                                            Consumers claim free gifts at shops by scanning QR codes
                                        </p>

                                        {(!order.has_redeem || (order.has_redeem && !hasRedemptionConfig && !checkingFeatures)) && (
                                            <div className="mt-3 text-sm text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                                                <p className="font-medium">
                                                    {!order.has_redeem ? "Feature Not Available" : "No Redemption Configuration Found"}
                                                </p>
                                                <p className="mt-1">
                                                    {!order.has_redeem 
                                                        ? "This order was created without Redemption enabled." 
                                                        : <>Please <a href={`/dashboard?view=redeem-gift-management&order_id=${order.id}`} target="_blank" rel="noopener noreferrer" className="underline font-bold hover:text-amber-800">configure redemption settings</a> for this order first.</>}
                                                </p>
                                            </div>
                                        )}

                                        {order.has_redeem && config.redemption_enabled && (
                                            <div className="mt-3 flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    id="require_customer_otp_for_redemption"
                                                    checked={config.require_customer_otp_for_redemption}
                                                    onChange={(e) => setConfig({ ...config, require_customer_otp_for_redemption: e.target.checked })}
                                                    className="rounded"
                                                />
                                                <Label htmlFor="require_customer_otp_for_redemption" className="text-sm font-normal cursor-pointer">
                                                    Require customer OTP verification
                                                </Label>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Content Customization */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Palette className="w-5 h-5" />
                                Content & Appearance
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="welcome_title">Welcome Title</Label>
                                <Input
                                    id="welcome_title"
                                    value={config.welcome_title}
                                    onChange={(e) => setConfig({ ...config, welcome_title: e.target.value })}
                                    placeholder="Welcome!"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="welcome_message">Welcome Message</Label>
                                <Textarea
                                    id="welcome_message"
                                    value={config.welcome_message}
                                    onChange={(e) => setConfig({ ...config, welcome_message: e.target.value })}
                                    placeholder="Thank you for scanning our QR code..."
                                    rows={3}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="thank_you_message">Thank You Message</Label>
                                <Textarea
                                    id="thank_you_message"
                                    value={config.thank_you_message}
                                    onChange={(e) => setConfig({ ...config, thank_you_message: e.target.value })}
                                    placeholder="Thank you for your participation!"
                                    rows={2}
                                />
                            </div>

                            {/* Product Image Display Option */}
                            <div className="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label>Show Product Image</Label>
                                        <p className="text-sm text-gray-600">Display product/variant image above welcome title</p>
                                    </div>
                                    <Switch
                                        checked={config.show_product_image || false}
                                        onCheckedChange={(checked) => setConfig({ ...config, show_product_image: checked })}
                                    />
                                </div>

                                {config.show_product_image && (
                                    <div className="space-y-3 pt-3 border-t border-gray-300">
                                        <div className="space-y-2">
                                            <Label>Image Source</Label>
                                            <select
                                                value={config.product_image_source || 'variant'}
                                                onChange={(e) => setConfig({ ...config, product_image_source: e.target.value as 'variant' | 'custom' | 'genuine_badge' })}
                                                className="w-full h-10 px-3 rounded-md border border-gray-300"
                                            >
                                                <option value="variant">Product Variant Image</option>
                                                <option value="genuine_badge">Genuine Product Badge</option>
                                                <option value="custom">Custom Icon/Image</option>
                                            </select>
                                        </div>

                                        {config.product_image_source === 'custom' && (
                                            <div className="space-y-3">
                                                <Label>Upload Image or Enter URL</Label>
                                                
                                                {/* File Upload */}
                                                <div className="space-y-2">
                                                    <input
                                                        type="file"
                                                        id="journey_image_upload"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0]
                                                            if (file) handleImageUpload(file)
                                                        }}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        className="w-full"
                                                        disabled={uploadingImage}
                                                        onClick={() => document.getElementById('journey_image_upload')?.click()}
                                                    >
                                                        {uploadingImage ? 'Uploading...' : 'Upload Image from Device'}
                                                    </Button>
                                                    <p className="text-xs text-gray-500">Auto-compresses to ~5KB. Recommended: 400x400px for mobile display</p>
                                                </div>

                                                {/* Manual URL Input */}
                                                <div className="space-y-2">
                                                    <Label htmlFor="custom_image_url">Or Enter Image URL</Label>
                                                    <Input
                                                        id="custom_image_url"
                                                        value={config.custom_image_url || ''}
                                                        onChange={(e) => setConfig({ ...config, custom_image_url: e.target.value })}
                                                        placeholder="https://example.com/image.png"
                                                    />
                                                    <p className="text-xs text-gray-500">Upload an image or paste an external URL</p>
                                                </div>

                                                {/* Image Preview */}
                                                {config.custom_image_url && (
                                                    <div className="mt-2 p-3 bg-white rounded-lg border border-gray-200">
                                                        <p className="text-xs text-gray-500 mb-2">Preview:</p>
                                                        <Image
                                                            src={config.custom_image_url}
                                                            alt="Custom preview"
                                                            width={96}
                                                            height={96}
                                                            className="object-cover rounded-lg mx-auto"
                                                            onError={(e) => {
                                                                e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3EImage%3C/text%3E%3C/svg%3E'
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {config.product_image_source === 'genuine_badge' && (
                                            <div className="space-y-2">
                                                <Label>Badge Style</Label>
                                                <select
                                                    value={config.genuine_badge_style || 'gold'}
                                                    onChange={(e) => setConfig({ ...config, genuine_badge_style: e.target.value })}
                                                    className="w-full h-10 px-3 rounded-md border border-gray-300"
                                                >
                                                    <option value="gold">Gold Seal</option>
                                                    <option value="blue">Blue Stamp</option>
                                                    <option value="red">Red Certificate</option>
                                                    <option value="green">Green Badge</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="primary_color">Primary Color</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="primary_color"
                                            type="color"
                                            value={config.primary_color}
                                            onChange={(e) => setConfig({ ...config, primary_color: e.target.value })}
                                            className="w-20 h-10 p-1"
                                        />
                                        <Input
                                            type="text"
                                            value={config.primary_color}
                                            onChange={(e) => setConfig({ ...config, primary_color: e.target.value })}
                                            className="flex-1"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="button_color">Button Color</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="button_color"
                                            type="color"
                                            value={config.button_color}
                                            onChange={(e) => setConfig({ ...config, button_color: e.target.value })}
                                            className="w-20 h-10 p-1"
                                        />
                                        <Input
                                            type="text"
                                            value={config.button_color}
                                            onChange={(e) => setConfig({ ...config, button_color: e.target.value })}
                                            className="flex-1"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Mobile Preview */}
                {showPreview && (
                    <div className="lg:col-span-1 w-full">
                        <div
                            className="relative lg:sticky lg:transition-transform lg:duration-200 lg:ease-out"
                            style={{
                                top: `${previewMetrics.top}px`,
                                maxHeight: `${previewMetrics.maxHeight}px`
                            }}
                        >
                            <div
                                className="overflow-y-auto scroll-smooth pr-1"
                                style={{
                                    maxHeight: `${Math.max(previewMetrics.maxHeight - 24, 360)}px`
                                }}
                            >
                                <InteractiveMobilePreviewV2 config={config} />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
