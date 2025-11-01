'use client'

import { useState, useEffect } from 'react'
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

    // Check if products have been shipped to distributor
    useEffect(() => {
        async function checkShipmentStatus() {
            try {
                setCheckingShipment(true)
                
                // Query QR master codes for this order via qr_batches
                // Need to join through qr_batches to get to the order
                const { data, error } = await supabase
                    .from('qr_master_codes')
                    .select(`
                        id,
                        status,
                        qr_batches!inner (
                            order_id
                        )
                    `)
                    .eq('qr_batches.order_id', order.id)
                    .eq('status', 'shipped_distributor')
                    .limit(1)
                
                if (error) {
                    console.error('[Journey] Error checking shipment status:', error)
                    // Default to false if error - safer to assume not shipped
                    setProductsShipped(false)
                } else {
                    // If at least one product has shipped, consider order as shipped
                    const hasShipped = (data?.length || 0) > 0
                    setProductsShipped(hasShipped)
                    console.log(`[Journey] Shipment check for order ${order.order_no}:`, hasShipped ? 'Products shipped ✅' : 'Awaiting shipment 🕐')
                }
            } catch (error) {
                console.error('[Journey] Error checking shipment:', error)
                setProductsShipped(false)
            } finally {
                setCheckingShipment(false)
            }
        }
        
        checkShipmentStatus()
    }, [order.id, order.order_no, supabase])

    const handleImageUpload = async (file: File) => {
        try {
            setUploadingImage(true)

            const fileExt = file.name.split('.').pop()
            const fileName = `journey-${order.id}-${Date.now()}.${fileExt}`
            const filePath = `journey-images/${fileName}`

            // Upload to Supabase storage
            const { error: uploadError } = await supabase.storage
                .from('product-images')
                .upload(filePath, file, {
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
                description: "Journey image has been uploaded successfully",
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
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                            {order.has_lucky_draw && (
                                <div className="flex items-start justify-between p-4 bg-purple-50 rounded-lg border border-purple-200">
                                    <div className="flex items-start gap-3 flex-1">
                                        <div className="p-2 bg-purple-100 rounded-lg">
                                            <Star className="w-5 h-5 text-purple-600" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-semibold text-purple-900">Lucky Draw</h3>
                                                <Switch
                                                    checked={config.lucky_draw_enabled}
                                                    onCheckedChange={(checked) => setConfig({ ...config, lucky_draw_enabled: checked })}
                                                />
                                            </div>
                                            <p className="text-sm text-purple-700 mt-1">
                                                Give consumers chances to win prizes
                                            </p>
                                            {config.lucky_draw_enabled && (
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
                            )}

                            {/* Redemption */}
                            {order.has_redeem && (
                                <div className="flex items-start justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                                    <div className="flex items-start gap-3 flex-1">
                                        <div className="p-2 bg-green-100 rounded-lg">
                                            <Gift className="w-5 h-5 text-green-600" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-semibold text-green-900">Free Gift Redemption</h3>
                                                <Switch
                                                    checked={config.redemption_enabled}
                                                    onCheckedChange={(checked) => setConfig({ ...config, redemption_enabled: checked })}
                                                />
                                            </div>
                                            <p className="text-sm text-green-700 mt-1">
                                                Consumers claim free gifts at shops by scanning QR codes
                                            </p>
                                            {config.redemption_enabled && (
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
                            )}
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
                    <div className="lg:col-span-1">
                        <div className="sticky top-6">
                            <InteractiveMobilePreviewV2 config={config} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
