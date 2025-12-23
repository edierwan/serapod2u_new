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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getStorageUrl } from '@/lib/utils'
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
    Layout,
    Info,
    Truck,
    Clock,
    Building2,
    ChevronLeft,
    ChevronRight,
    Palette
} from 'lucide-react'
import PremiumLoyaltyTemplate from './templates/PremiumLoyaltyTemplate'

const PRODUCT_CONSUMER_READY_STATUSES = ['shipped_distributor', 'activated', 'redeemed'] as const
const MASTER_CONSUMER_READY_STATUSES = ['shipped_distributor', 'opened'] as const

// Color themes configuration
const COLOR_THEMES = [
    {
        name: 'Spanish Orange',
        primary: '#F06105',
        button: '#F06105'
    },
    {
        name: 'Tangerine',
        primary: '#F78702',
        button: '#F78702'
    },
    {
        name: 'Dark Orange',
        primary: '#FF8C00',
        button: '#FF8C00'
    },
    {
        name: 'Vivid Orange',
        primary: '#FF5E0E',
        button: '#FF5E0E'
    },
    {
        name: 'Yellow-Orange',
        primary: '#FFA836',
        button: '#FFA836'
    },
    {
        name: 'Carrot Orange',
        primary: '#ED9121',
        button: '#ED9121'
    },
    {
        name: 'Princeton Orange',
        primary: '#FF8F00',
        button: '#FF8F00'
    },
    {
        name: 'Deep Saffron',
        primary: '#FFA52C',
        button: '#FFA52C'
    },
    {
        name: 'Gamboge',
        primary: '#E89611',
        button: '#E89611'
    },
    {
        name: 'Pastel Orange',
        primary: '#FEBA4F',
        button: '#FEBA4F'
    },
    {
        name: 'Vivid Tangelo',
        primary: '#EC7625',
        button: '#EC7625'
    }
]

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
    template_type?: 'classic' | 'premium'  // Template selection
    is_active: boolean
    is_default: boolean
    points_enabled: boolean
    lucky_draw_enabled: boolean
    redemption_enabled: boolean
    require_staff_otp_for_points: boolean
    require_customer_otp_for_lucky_draw: boolean
    require_customer_otp_for_redemption: boolean
    require_security_code: boolean
    require_two_digit_code_for_features?: boolean
    require_security_code_for_features?: boolean
    // Per-feature security code bypass (when main security code is ON)
    skip_security_code_for_points?: boolean
    skip_security_code_for_lucky_draw?: boolean
    skip_security_code_for_redemption?: boolean
    skip_security_code_for_scratch_card?: boolean
    enable_scratch_card_game: boolean
    scratch_card_require_otp: boolean
    
    // Feature Customization
    points_title?: string
    points_description?: string
    points_icon?: string
    
    lucky_draw_title?: string
    lucky_draw_description?: string
    lucky_draw_icon?: string
    
    redemption_title?: string
    redemption_description?: string
    redemption_icon?: string
    
    scratch_card_title?: string
    scratch_card_description?: string
    scratch_card_icon?: string

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
    banner_config?: {
        enabled: boolean
        template: 'grid' | 'carousel'
        location?: 'home' | 'rewards' | 'products' | 'profile' // kept for backward compatibility
        items: Array<{
            id: string
            image_url: string
            link_to: 'rewards' | 'products' | 'contact-us' | 'no-link' | string
            expires_at: string
            page?: 'home' | 'rewards' | 'products' | 'profile' // new: which page to show this banner
        }>
    }
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
    journey?: JourneyConfig
    onBack: () => void
    onSuccess: () => void
}) {
    // Debug: Log on component mount
    useEffect(() => {
        console.log('=== [JourneyDesigner] COMPONENT MOUNTED ===')
        console.log('Journey ID:', journey?.id)
        console.log('Journey require_security_code:', journey?.require_security_code)
    }, [])
    
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
    const [activationTrigger, setActivationTrigger] = useState<'shipped_distributor' | 'received_warehouse'>('shipped_distributor')
    const [activeBannerTab, setActiveBannerTab] = useState<'home' | 'rewards' | 'products' | 'profile'>('home')
    const [selectedColorThemeIndex, setSelectedColorThemeIndex] = useState(0)

    // Find initial theme index based on primary color
    useEffect(() => {
        if (config.primary_color) {
            const themeIndex = COLOR_THEMES.findIndex(theme => 
                theme.primary.toLowerCase() === config.primary_color.toLowerCase()
            )
            if (themeIndex !== -1) {
                setSelectedColorThemeIndex(themeIndex)
            }
        }
    }, [])

    // Handler for theme navigation
    const handlePreviousTheme = () => {
        const newIndex = selectedColorThemeIndex === 0 ? COLOR_THEMES.length - 1 : selectedColorThemeIndex - 1
        setSelectedColorThemeIndex(newIndex)
        const newTheme = COLOR_THEMES[newIndex]
        setConfig({
            ...config,
            primary_color: newTheme.primary,
            button_color: newTheme.button
        })
    }

    const handleNextTheme = () => {
        const newIndex = (selectedColorThemeIndex + 1) % COLOR_THEMES.length
        setSelectedColorThemeIndex(newIndex)
        const newTheme = COLOR_THEMES[newIndex]
        setConfig({
            ...config,
            primary_color: newTheme.primary,
            button_color: newTheme.button
        })
    }

    useEffect(() => {
        const fetchOrgSettings = async () => {
            const supabase = createClient()
            const { data, error } = await supabase
                .from('organizations')
                .select('settings')
                .eq('id', userProfile.organization_id)
                .single()
            
            if (data?.settings?.journey_builder_activation) {
                setActivationTrigger(data.settings.journey_builder_activation)
            }
        }
        fetchOrgSettings()
    }, [userProfile.organization_id])

    const [config, setConfig] = useState<JourneyConfig>({
        id: journey?.id,
        name: journey?.name || `Journey for ${order.order_no}`,
        template_type: 'premium',
        is_active: journey?.is_active ?? true,
        is_default: journey?.is_default ?? false,
        points_enabled: journey?.points_enabled ?? true,
        lucky_draw_enabled: journey?.lucky_draw_enabled ?? order.has_lucky_draw,
        redemption_enabled: journey?.redemption_enabled ?? order.has_redeem,
        require_staff_otp_for_points: journey?.require_staff_otp_for_points ?? false,
        require_customer_otp_for_lucky_draw: journey?.require_customer_otp_for_lucky_draw ?? false,
        require_customer_otp_for_redemption: journey?.require_customer_otp_for_redemption ?? false,
        require_security_code: journey?.require_security_code ?? false,
        // Per-feature security code bypass
        skip_security_code_for_points: (journey as any)?.skip_security_code_for_points ?? false,
        skip_security_code_for_lucky_draw: (journey as any)?.skip_security_code_for_lucky_draw ?? false,
        skip_security_code_for_redemption: (journey as any)?.skip_security_code_for_redemption ?? false,
        skip_security_code_for_scratch_card: (journey as any)?.skip_security_code_for_scratch_card ?? false,
        enable_scratch_card_game: journey?.enable_scratch_card_game ?? false,
        scratch_card_require_otp: journey?.scratch_card_require_otp ?? false,
        
        // Feature Customization
        points_title: journey?.points_title || 'Collect Points',
        points_description: journey?.points_description || 'Earn rewards with every scan',
        points_icon: journey?.points_icon || 'Coins',
        
        lucky_draw_title: journey?.lucky_draw_title || 'Lucky Draw',
        lucky_draw_description: journey?.lucky_draw_description || 'Try your luck and win prizes!',
        lucky_draw_icon: journey?.lucky_draw_icon || 'Star',
        
        redemption_title: journey?.redemption_title || 'Claim Free Gift',
        redemption_description: journey?.redemption_description || 'Get your free gift at the shop',
        redemption_icon: journey?.redemption_icon || 'Gift',
        
        scratch_card_title: journey?.scratch_card_title || 'Scratch Card Game',
        scratch_card_description: journey?.scratch_card_description || 'Scratch & win surprise rewards',
        scratch_card_icon: journey?.scratch_card_icon || 'Gift',

        start_at: journey?.start_at ? journey.start_at.split('T')[0] : new Date().toISOString().split('T')[0],
        end_at: journey?.end_at ? journey.end_at.split('T')[0] : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        welcome_title: journey?.welcome_title || 'Welcome!',
        welcome_message: journey?.welcome_message || 'Thank you for scanning our QR code. Enjoy exclusive rewards and benefits!',
        thank_you_message: journey?.thank_you_message || 'Thank you for your participation!',
        primary_color: journey?.primary_color || COLOR_THEMES[0].primary,
        button_color: journey?.button_color || COLOR_THEMES[0].button,
        show_product_image: journey?.show_product_image ?? false,
        product_image_source: journey?.product_image_source ?? 'variant',
        custom_image_url: journey?.custom_image_url ?? '',
        genuine_badge_style: journey?.genuine_badge_style ?? 'gold',
        banner_config: (journey as any)?.banner_config ?? {
            enabled: false,
            template: 'grid',
            items: []
        }
    })

    const supabase = createClient()

    // Update config when journey prop changes (e.g., after save and re-edit)
    useEffect(() => {
        if (journey) {
            console.log('[JourneyDesigner] Journey prop received:', {
                id: journey.id,
                require_security_code: journey.require_security_code
            })
            
            setConfig({
                id: journey.id,
                name: journey.name || `Journey for ${order.order_no}`,
                template_type: 'premium',
                is_active: journey.is_active ?? true,
                is_default: journey.is_default ?? false,
                points_enabled: journey.points_enabled ?? true,
                lucky_draw_enabled: journey.lucky_draw_enabled ?? order.has_lucky_draw,
                redemption_enabled: journey.redemption_enabled ?? order.has_redeem,
                require_staff_otp_for_points: journey.require_staff_otp_for_points ?? false,
                require_customer_otp_for_lucky_draw: journey.require_customer_otp_for_lucky_draw ?? false,
                require_customer_otp_for_redemption: journey.require_customer_otp_for_redemption ?? false,
                require_security_code: journey.require_security_code ?? false,
                // Per-feature security code bypass
                skip_security_code_for_points: (journey as any).skip_security_code_for_points ?? false,
                skip_security_code_for_lucky_draw: (journey as any).skip_security_code_for_lucky_draw ?? false,
                skip_security_code_for_redemption: (journey as any).skip_security_code_for_redemption ?? false,
                skip_security_code_for_scratch_card: (journey as any).skip_security_code_for_scratch_card ?? false,
                enable_scratch_card_game: journey.enable_scratch_card_game ?? false,
                scratch_card_require_otp: journey.scratch_card_require_otp ?? false,
                
                // Feature Customization
                points_title: journey.points_title || 'Collect Points',
                points_description: journey.points_description || 'Earn rewards with every scan',
                points_icon: journey.points_icon || 'Coins',
                
                lucky_draw_title: journey.lucky_draw_title || 'Lucky Draw',
                lucky_draw_description: journey.lucky_draw_description || 'Try your luck and win prizes!',
                lucky_draw_icon: journey.lucky_draw_icon || 'Star',
                
                redemption_title: journey.redemption_title || 'Claim Free Gift',
                redemption_description: journey.redemption_description || 'Get your free gift at the shop',
                redemption_icon: journey.redemption_icon || 'Gift',
                
                scratch_card_title: journey.scratch_card_title || 'Scratch Card Game',
                scratch_card_description: journey.scratch_card_description || 'Scratch & win surprise rewards',
                scratch_card_icon: journey.scratch_card_icon || 'Gift',

                start_at: journey.start_at ? journey.start_at.split('T')[0] : new Date().toISOString().split('T')[0],
                end_at: journey.end_at ? journey.end_at.split('T')[0] : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                welcome_title: journey.welcome_title || 'Welcome!',
                welcome_message: journey.welcome_message || 'Thank you for scanning our QR code. Enjoy exclusive rewards and benefits!',
                thank_you_message: journey.thank_you_message || 'Thank you for your participation!',
                primary_color: journey.primary_color || '#3B82F6',
                button_color: journey.button_color || '#10B981',
                show_product_image: journey.show_product_image ?? false,
                product_image_source: journey.product_image_source ?? 'variant',
                custom_image_url: journey.custom_image_url ?? '',
                genuine_badge_style: journey.genuine_badge_style ?? 'gold',
                banner_config: (journey as any)?.banner_config ?? {
                    enabled: false,
                    template: 'grid',
                    items: []
                }
            })
            
            console.log('[JourneyDesigner] Config state updated with require_security_code:', journey.require_security_code ?? false)
        }
    }, [journey])

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

                // Determine valid statuses based on activation trigger
                // Always include 'received_warehouse' because if it's received, it's definitely shipped/ready
                const validProductStatuses = [...PRODUCT_CONSUMER_READY_STATUSES, 'received_warehouse'] as string[]
                const validMasterStatuses = [...MASTER_CONSUMER_READY_STATUSES, 'received_warehouse'] as string[]
                
                // If activation trigger is strictly 'received_warehouse', we might want to exclude 'shipped_distributor'
                // But for now, the main issue is that 'received_warehouse' was missing from the default list.
                
                if (activationTrigger === 'received_warehouse') {
                    // If we wanted to be strict:
                    // validProductStatuses = validProductStatuses.filter(s => s !== 'shipped_distributor')
                    // validMasterStatuses = validMasterStatuses.filter(s => s !== 'shipped_distributor')
                }

                // FAST PATH: If order status already meets the criteria, we can skip the expensive/restricted QR check
                // This also helps when RLS policies might block access to QR tables but Order is visible
                if (activationTrigger === 'received_warehouse' && order.status === 'received_warehouse') {
                    setProductsShipped(true)
                    setCheckingShipment(false)
                    console.log(`[Journey] Shipment check for order ${order.order_no}: Products shipped ✅ (via order status)`)
                    return
                }

                if (activationTrigger === 'shipped_distributor' && (order.status === 'shipped_distributor' || order.status === 'completed')) {
                    setProductsShipped(true)
                    setCheckingShipment(false)
                    console.log(`[Journey] Shipment check for order ${order.order_no}: Products shipped ✅ (via order status)`)
                    return
                }

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
                        .in('status', validMasterStatuses)
                        .limit(1),
                    supabase
                        .from('qr_codes')
                        .select('id')
                        .eq('order_id', order.id)
                        .in('status', validProductStatuses)
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
                        .in('status', validProductStatuses)
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
    }, [order.id, order.order_no, supabase, activationTrigger])

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
    // For banner images: use higher quality settings to preserve text readability
    const compressImage = (file: File, options?: { isBanner?: boolean }): Promise<File> => {
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

                    // Banner images need higher resolution for text readability
                    // Target: 1080px width at 2x retina, 16:9 aspect ratio
                    const isBanner = options?.isBanner ?? false
                    const MAX_WIDTH = isBanner ? 1080 : 400
                    const MAX_HEIGHT = isBanner ? 608 : 400 // 1080 / (16/9) ≈ 608
                    const QUALITY = isBanner ? 0.80 : 0.7 // Higher quality for banners
                    
                    let width = img.width
                    let height = img.height

                    // Calculate new dimensions while maintaining aspect ratio
                    if (width > MAX_WIDTH) {
                        height = Math.round((height * MAX_WIDTH) / width)
                        width = MAX_WIDTH
                    }
                    if (height > MAX_HEIGHT) {
                        width = Math.round((width * MAX_HEIGHT) / height)
                        height = MAX_HEIGHT
                    }

                    canvas.width = width
                    canvas.height = height

                    // Draw image on canvas with high quality
                    ctx.imageSmoothingEnabled = true
                    ctx.imageSmoothingQuality = 'high'
                    ctx.drawImage(img, 0, 0, width, height)

                    // Convert to blob with compression
                    // Banner: JPEG 80% quality for better text clarity (~100-300KB)
                    // Other images: JPEG 70% quality (~5KB)
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
                        QUALITY
                    )
                }
                img.onerror = () => reject(new Error('Failed to load image'))
            }
            reader.onerror = () => reject(new Error('Failed to read file'))
        })
    }

    const handleImageUpload = async (file: File, onSuccess?: (url: string) => void, options?: { isBanner?: boolean }) => {
        try {
            setUploadingImage(true)

            // Compress image before upload (banner images use higher quality)
            // For banner images, we skip compression to ensure high quality as requested
            const compressedFile = options?.isBanner 
                ? file 
                : await compressImage(file, { isBanner: options?.isBanner })

            const fileExt = 'jpg' // Always use jpg after compression
            const imageType = options?.isBanner ? 'banner' : 'journey'
            const fileName = `${imageType}-${order.id}-${Date.now()}.${fileExt}`
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

            if (onSuccess) {
                onSuccess(urlData.publicUrl)
            } else {
                // Update config with the uploaded image URL (default behavior)
                setConfig({ ...config, custom_image_url: urlData.publicUrl })
            }

            const sizeMsg = options?.isBanner ? 'optimized for mobile display' : 'compressed (~5KB)'
            toast({
                title: "Image uploaded",
                description: `Image has been ${sizeMsg}`,
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
                require_security_code: config.require_security_code,
                // Per-feature security code bypass
                skip_security_code_for_points: config.skip_security_code_for_points ?? false,
                skip_security_code_for_lucky_draw: config.skip_security_code_for_lucky_draw ?? false,
                skip_security_code_for_redemption: config.skip_security_code_for_redemption ?? false,
                skip_security_code_for_scratch_card: config.skip_security_code_for_scratch_card ?? false,
                enable_scratch_card_game: config.enable_scratch_card_game,
                scratch_card_require_otp: config.scratch_card_require_otp,
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

            // Feature Customization
            if (config.points_title !== undefined) journeyData.points_title = config.points_title
            if (config.points_description !== undefined) journeyData.points_description = config.points_description
            if (config.points_icon !== undefined) journeyData.points_icon = config.points_icon
            
            if (config.lucky_draw_title !== undefined) journeyData.lucky_draw_title = config.lucky_draw_title
            if (config.lucky_draw_description !== undefined) journeyData.lucky_draw_description = config.lucky_draw_description
            if (config.lucky_draw_icon !== undefined) journeyData.lucky_draw_icon = config.lucky_draw_icon
            
            if (config.redemption_title !== undefined) journeyData.redemption_title = config.redemption_title
            if (config.redemption_description !== undefined) journeyData.redemption_description = config.redemption_description
            if (config.redemption_icon !== undefined) journeyData.redemption_icon = config.redemption_icon
            
            if (config.scratch_card_title !== undefined) journeyData.scratch_card_title = config.scratch_card_title
            if (config.scratch_card_description !== undefined) journeyData.scratch_card_description = config.scratch_card_description
            if (config.scratch_card_icon !== undefined) journeyData.scratch_card_icon = config.scratch_card_icon

            // Template selection
            if (config.template_type !== undefined) journeyData.template_type = config.template_type

            // Banner Configuration
            if (config.banner_config !== undefined) journeyData.banner_config = config.banner_config

            let journeyId = config.id

            if (config.id) {
                // Update existing journey
                console.log('[JourneyDesigner] Saving journey with require_security_code:', journeyData.require_security_code)
                
                const { error } = await supabase
                    .from('journey_configurations')
                    .update(journeyData)
                    .eq('id', config.id)

                if (error) {
                    console.error('Supabase update error:', error)
                    throw new Error(error.message || 'Failed to update journey')
                }
                
                console.log('[JourneyDesigner] Journey saved successfully')
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

                            {/* Template Selection */}
                            <div className="space-y-2">
                                <Label htmlFor="template">Template</Label>
                                <Select
                                    value={config.template_type || 'premium'}
                                    onValueChange={(value: 'premium') => setConfig({ ...config, template_type: value })}
                                >
                                    <SelectTrigger id="template">
                                        <SelectValue placeholder="Select template" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="premium">Premium Template</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-gray-500">More templates coming soon!</p>
                            </div>

                            {/* Color Theme Selector */}
                            <div className="space-y-3">
                                <Label>Color Theme</Label>
                                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                    {/* Theme Name Display */}
                                    <div className="text-center mb-4">
                                        <h4 className="text-lg font-semibold text-gray-900">
                                            {COLOR_THEMES[selectedColorThemeIndex].name}
                                        </h4>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {COLOR_THEMES[selectedColorThemeIndex].primary}
                                        </p>
                                    </div>

                                    {/* Color Preview */}
                                    <div className="flex items-center justify-center gap-3 mb-4">
                                        <div 
                                            className="w-20 h-20 rounded-2xl shadow-lg border-4 border-white"
                                            style={{ backgroundColor: COLOR_THEMES[selectedColorThemeIndex].primary }}
                                        />
                                    </div>

                                    {/* Navigation Arrows */}
                                    <div className="flex items-center justify-center gap-4">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={handlePreviousTheme}
                                            className="rounded-full"
                                        >
                                            <ChevronLeft className="w-5 h-5" />
                                        </Button>
                                        <div className="flex gap-1.5">
                                            {COLOR_THEMES.map((_, index) => (
                                                <button
                                                    key={index}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedColorThemeIndex(index)
                                                        const newTheme = COLOR_THEMES[index]
                                                        setConfig({
                                                            ...config,
                                                            primary_color: newTheme.primary,
                                                            button_color: newTheme.button
                                                        })
                                                    }}
                                                    className={`w-2 h-2 rounded-full transition-all ${
                                                        index === selectedColorThemeIndex 
                                                            ? 'w-6 bg-gray-800' 
                                                            : 'bg-gray-300 hover:bg-gray-400'
                                                    }`}
                                                />
                                            ))}
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={handleNextTheme}
                                            className="rounded-full"
                                        >
                                            <ChevronRight className="w-5 h-5" />
                                        </Button>
                                    </div>

                                    {/* Theme Info */}
                                    <div className="mt-4 flex items-center gap-2 text-xs text-gray-600 bg-white rounded-lg p-3">
                                        <Palette className="w-4 h-4 flex-shrink-0" />
                                        <span>Theme affects header, buttons, and accent colors throughout the app</span>
                                    </div>
                                </div>
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
                                                    {activationTrigger === 'received_warehouse' ? 'Pending Warehouse Receipt' : 'Pending Shipment'}
                                                </Badge>
                                            )}
                                            {productsShipped && (
                                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                                                    {activationTrigger === 'received_warehouse' ? <Building2 className="w-3 h-3 mr-1" /> : <Truck className="w-3 h-3 mr-1" />}
                                                    {activationTrigger === 'received_warehouse' ? 'Received at Warehouse' : 'Products Shipped'}
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
                                                const statusText = activationTrigger === 'received_warehouse' ? 'Received at Warehouse' : 'Shipped to Distributor'
                                                toast({
                                                    title: "Cannot activate journey yet",
                                                    description: `Products from order ${order.order_no} must reach "${statusText}" status first. The journey will auto-activate once products reach this status.`,
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
                                            <strong>Journey will auto-activate when products {activationTrigger === 'received_warehouse' ? 'are received at warehouse' : 'ship to distributor'}.</strong>
                                            <br />
                                            You can create this journey now, but it will remain inactive until at least one product from order <strong>{order.order_no}</strong> reaches &quot;{activationTrigger === 'received_warehouse' ? 'Received at Warehouse' : 'Shipped to Distributor'}&quot; status. Once reached, the journey will automatically become active.
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

                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="flex items-center gap-2">
                                        Require Security Code 🔒 <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">Anti-Fraud</span>
                                    </Label>
                                    <p className="text-sm text-gray-600">Require 2-digit code from product box for Lucky Draw, Redemption & Games</p>
                                </div>
                                <Switch
                                    checked={config.require_security_code}
                                    onCheckedChange={(checked) => setConfig({ ...config, require_security_code: checked })}
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
                                            <div className="mt-3 space-y-2">
                                                <div className="flex items-center gap-2">
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
                                                {config.require_security_code && (
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            id="skip_security_code_for_points"
                                                            checked={config.skip_security_code_for_points}
                                                            onChange={(e) => setConfig({ ...config, skip_security_code_for_points: e.target.checked })}
                                                            className="rounded border-orange-300"
                                                        />
                                                        <Label htmlFor="skip_security_code_for_points" className="text-sm font-normal cursor-pointer text-orange-700">
                                                            Skip security code for this feature
                                                        </Label>
                                                    </div>
                                                )}
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
                                                        : <>Please <a href={`/dashboard?view=lucky-draw&order_id=${order.id}`} target="_blank" rel="noopener noreferrer" className="underline font-bold hover:text-amber-800">create a lucky draw campaign</a> for this order first.</>}
                                                </p>
                                            </div>
                                        )}

                                        {order.has_lucky_draw && config.lucky_draw_enabled && (
                                            <div className="mt-3 space-y-2">
                                                <div className="flex items-center gap-2">
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
                                                {config.require_security_code && (
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            id="skip_security_code_for_lucky_draw"
                                                            checked={config.skip_security_code_for_lucky_draw}
                                                            onChange={(e) => setConfig({ ...config, skip_security_code_for_lucky_draw: e.target.checked })}
                                                            className="rounded border-orange-300"
                                                        />
                                                        <Label htmlFor="skip_security_code_for_lucky_draw" className="text-sm font-normal cursor-pointer text-orange-700">
                                                            Skip security code for this feature
                                                        </Label>
                                                    </div>
                                                )}
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
                                            <div className="mt-3 space-y-2">
                                                <div className="flex items-center gap-2">
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
                                                {config.require_security_code && (
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            id="skip_security_code_for_redemption"
                                                            checked={config.skip_security_code_for_redemption}
                                                            onChange={(e) => setConfig({ ...config, skip_security_code_for_redemption: e.target.checked })}
                                                            className="rounded border-orange-300"
                                                        />
                                                        <Label htmlFor="skip_security_code_for_redemption" className="text-sm font-normal cursor-pointer text-orange-700">
                                                            Skip security code for this feature
                                                        </Label>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                    </div>
                                </div>
                            </div>

                            {/* Games */}
                            <div className="flex items-start justify-between p-4 bg-purple-50 rounded-lg border border-purple-200">
                                <div className="flex items-start gap-3 flex-1">
                                    <div className="p-2 bg-purple-100 rounded-lg">
                                        <Gift className="w-5 h-5 text-purple-600" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-semibold text-purple-900">Games</h3>
                                            <Switch
                                                checked={config.enable_scratch_card_game}
                                                onCheckedChange={(checked) => setConfig({ ...config, enable_scratch_card_game: checked })}
                                            />
                                        </div>
                                        <p className="text-sm text-purple-700 mt-1">
                                            Enable games like Scratch Card, Spin the Wheel, and Daily Quiz
                                        </p>
                                        {config.enable_scratch_card_game && (
                                            <div className="mt-3 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        id="scratch_card_require_otp"
                                                        checked={config.scratch_card_require_otp}
                                                        onChange={(e) => setConfig({ ...config, scratch_card_require_otp: e.target.checked })}
                                                        className="rounded"
                                                    />
                                                    <Label htmlFor="scratch_card_require_otp" className="text-sm font-normal cursor-pointer">
                                                        Require customer OTP verification
                                                    </Label>
                                                </div>
                                                {config.require_security_code && (
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            id="skip_security_code_for_scratch_card"
                                                            checked={config.skip_security_code_for_scratch_card}
                                                            onChange={(e) => setConfig({ ...config, skip_security_code_for_scratch_card: e.target.checked })}
                                                            className="rounded border-orange-300"
                                                        />
                                                        <Label htmlFor="skip_security_code_for_scratch_card" className="text-sm font-normal cursor-pointer text-orange-700">
                                                            Skip security code for this feature
                                                        </Label>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Announcement Banner */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Layout className="w-5 h-5" />
                                Announcement Banner
                            </CardTitle>
                            <CardDescription>
                                Display promotional banners on the home screen
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <div className="space-y-0.5">
                                    <Label>Enable Announcement Banner</Label>
                                    <p className="text-sm text-gray-600">Show dynamic banners to consumers</p>
                                </div>
                                <Switch
                                    checked={config.banner_config?.enabled || false}
                                    onCheckedChange={(checked) => setConfig({
                                        ...config,
                                        banner_config: {
                                            ...config.banner_config!,
                                            enabled: checked
                                        }
                                    })}
                                />
                            </div>

                            {config.banner_config?.enabled && (
                                <div className="space-y-4 p-4 border border-gray-200 rounded-lg">
                                    <div className="space-y-2">
                                        <Label>Banner Page</Label>
                                        <Tabs value={activeBannerTab} onValueChange={(value) => setActiveBannerTab(value as 'home' | 'rewards' | 'products' | 'profile')} className="w-full">
                                            <TabsList className="grid w-full grid-cols-4">
                                                <TabsTrigger value="home">Home</TabsTrigger>
                                                <TabsTrigger value="rewards">Rewards</TabsTrigger>
                                                <TabsTrigger value="products">Product</TabsTrigger>
                                                <TabsTrigger value="profile">Profile</TabsTrigger>
                                            </TabsList>
                                        </Tabs>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Banner Template</Label>
                                        <Select
                                            value={config.banner_config.template}
                                            onValueChange={(value: 'grid' | 'carousel') => setConfig({
                                                ...config,
                                                banner_config: {
                                                    ...config.banner_config!,
                                                    template: value
                                                }
                                            })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="grid">Grid (Side by Side)</SelectItem>
                                                <SelectItem value="carousel">Carousel (Slider)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <Label>Banner Items for {activeBannerTab.charAt(0).toUpperCase() + activeBannerTab.slice(1)} Page</Label>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    const newItems = [...(config.banner_config?.items || [])]
                                                    newItems.push({
                                                        id: crypto.randomUUID(),
                                                        image_url: '',
                                                        link_to: 'rewards',
                                                        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                                                        page: activeBannerTab
                                                    })
                                                    setConfig({
                                                        ...config,
                                                        banner_config: {
                                                            ...config.banner_config!,
                                                            items: newItems
                                                        }
                                                    })
                                                }}
                                            >
                                                Add Banner Item
                                            </Button>
                                        </div>

                                        {config.banner_config.items.filter(item => (item.page || 'home') === activeBannerTab).map((item) => {
                                            const actualIndex = config.banner_config!.items.findIndex(i => i.id === item.id)
                                            return (
                                            <div key={item.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3 relative">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="absolute top-2 right-2 text-red-500 hover:text-red-700"
                                                    onClick={() => {
                                                        const newItems = config.banner_config!.items.filter(i => i.id !== item.id)
                                                        setConfig({
                                                            ...config,
                                                            banner_config: {
                                                                ...config.banner_config!,
                                                                items: newItems
                                                            }
                                                        })
                                                    }}
                                                >
                                                    Remove
                                                </Button>

                                                <div className="space-y-2">
                                                    <Label>Image URL</Label>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            value={item.image_url}
                                                            onChange={(e) => {
                                                                const newItems = [...config.banner_config!.items]
                                                                newItems[actualIndex].image_url = e.target.value
                                                                setConfig({
                                                                    ...config,
                                                                    banner_config: {
                                                                        ...config.banner_config!,
                                                                        items: newItems
                                                                    }
                                                                })
                                                            }}
                                                            placeholder="https://example.com/banner.jpg"
                                                        />
                                                        <div className="relative">
                                                            <input
                                                                type="file"
                                                                id={`banner-upload-${item.id}`}
                                                                className="hidden"
                                                                accept="image/*"
                                                                onChange={(e) => {
                                                                    const file = e.target.files?.[0]
                                                                    if (file) handleImageUpload(file, (url) => {
                                                                        const newItems = [...config.banner_config!.items]
                                                                        newItems[actualIndex].image_url = url
                                                                        setConfig({
                                                                            ...config,
                                                                            banner_config: {
                                                                                ...config.banner_config!,
                                                                                items: newItems
                                                                            }
                                                                        })
                                                                    }, { isBanner: true }) // Use banner-specific compression
                                                                }}
                                                            />
                                                            <Button
                                                                variant="outline"
                                                                onClick={() => document.getElementById(`banner-upload-${item.id}`)?.click()}
                                                            >
                                                                Upload
                                                            </Button>
                                                        </div>
                                                    </div>
                                                    {item.image_url && (
                                                        <div className="space-y-2">
                                                            <p className="text-xs text-gray-500">Preview (actual mobile size):</p>
                                                            <div className="relative w-full bg-gray-100 rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                                                                <Image
                                                                    src={getStorageUrl(item.image_url) || item.image_url}
                                                                    alt="Banner preview"
                                                                    fill
                                                                    className="object-cover"
                                                                />
                                                            </div>
                                                            <p className="text-[10px] text-gray-400">16:9 aspect ratio • Optimized for mobile</p>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <Label>Link Destination</Label>
                                                        <Select
                                                            value={['rewards', 'products', 'contact-us', 'no-link'].includes(item.link_to) ? item.link_to : 'external'}
                                                            onValueChange={(value: string) => {
                                                                const newItems = [...config.banner_config!.items]
                                                                if (value === 'external') {
                                                                    newItems[actualIndex].link_to = ''
                                                                } else {
                                                                    newItems[actualIndex].link_to = value
                                                                }
                                                                setConfig({
                                                                    ...config,
                                                                    banner_config: {
                                                                        ...config.banner_config!,
                                                                        items: newItems
                                                                    }
                                                                })
                                                            }}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="rewards">Rewards Page</SelectItem>
                                                                <SelectItem value="products">Product Page</SelectItem>
                                                                <SelectItem value="contact-us">Contact Us</SelectItem>
                                                                <SelectItem value="no-link">No Link</SelectItem>
                                                                <SelectItem value="external">Link</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        {(!['rewards', 'products', 'contact-us', 'no-link'].includes(item.link_to)) && (
                                                            <div className="mt-2">
                                                                <Input
                                                                    value={item.link_to}
                                                                    onChange={(e) => {
                                                                        const newItems = [...config.banner_config!.items]
                                                                        newItems[actualIndex].link_to = e.target.value
                                                                        setConfig({
                                                                            ...config,
                                                                            banner_config: {
                                                                                ...config.banner_config!,
                                                                                items: newItems
                                                                            }
                                                                        })
                                                                    }}
                                                                    placeholder="https://example.com"
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Expiration Date</Label>
                                                        <Input
                                                            type="date"
                                                            value={item.expires_at}
                                                            onChange={(e) => {
                                                                const newItems = [...config.banner_config!.items]
                                                                newItems[actualIndex].expires_at = e.target.value
                                                                setConfig({
                                                                    ...config,
                                                                    banner_config: {
                                                                        ...config.banner_config!,
                                                                        items: newItems
                                                                    }
                                                                })
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )})}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Content Customization */}

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
                                <div className="relative mx-auto" style={{ width: '300px', height: '600px' }}>
                                    <div className="absolute inset-0 border-8 border-gray-800 rounded-[40px] bg-white shadow-2xl overflow-hidden">
                                        <div className="h-6 bg-gray-800 flex items-center justify-between px-4 relative z-10">
                                            <span className="text-white text-xs">9:41</span>
                                            <div className="flex gap-1">
                                                <div className="w-4 h-3 bg-white rounded-sm"></div>
                                                <div className="w-1 h-3 bg-white rounded-sm"></div>
                                            </div>
                                        </div>
                                        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-32 h-6 bg-gray-800 rounded-b-3xl z-20"></div>
                                        <div className="h-[calc(100%-24px)] overflow-hidden">
                                            <PremiumLoyaltyTemplate config={config} isLive={false} />
                                        </div>
                                        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gray-800 rounded-full"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
