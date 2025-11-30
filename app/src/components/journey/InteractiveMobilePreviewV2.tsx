'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Smartphone, Coins, Star, Gift, CheckCircle2, ArrowLeft, X, Users, Zap, Trophy, Heart, ShoppingBag, XCircle } from 'lucide-react'
import ScratchCanvas from './ScratchCanvas'

interface JourneyConfig {
    id?: string
    welcome_title: string
    welcome_message: string
    thank_you_message: string
    primary_color: string
    button_color: string
    points_enabled: boolean
    lucky_draw_enabled: boolean
    redemption_enabled: boolean
    show_product_image?: boolean
    product_image_source?: 'variant' | 'custom' | 'genuine_badge'
    custom_image_url?: string
    genuine_badge_style?: string
    variant_image_url?: string | null
    lucky_draw_image_url?: string | null
    lucky_draw_campaign_name?: string | null
    lucky_draw_prizes?: any[]
    enable_scratch_card_game?: boolean
    scratch_card_require_otp?: boolean
    
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

    theme_config?: {
        theme_id?: string
        primary_color?: string
        title_text?: string
        success_message?: string
        no_prize_message?: string
        show_confetti?: boolean
        play_sound?: boolean
    }
}

const THEMES = [
    { id: 'modern', name: 'Modern Gradient' },
    { id: 'retro', name: 'Retro Carnival' },
    { id: 'vip', name: 'VIP Gold' },
    { id: 'cyber', name: 'Cyber Arcade' }
]

type PageType = 'welcome' | 'collect-points' | 'lucky-draw' | 'redeem-gift' | 'scratch-card-game' | 'thank-you'

interface InteractiveMobilePreviewV2Props {
    config: JourneyConfig
    fullScreen?: boolean // When true, shows full-screen mobile view without phone frame
    qrCode?: string // The QR code that was scanned (for actual submissions)
    isLive?: boolean
    consumerPhone?: string
}

export default function InteractiveMobilePreviewV2({ config, fullScreen = false, qrCode, isLive = false, consumerPhone }: InteractiveMobilePreviewV2Props) {
    const router = useRouter()
    const [currentPage, setCurrentPage] = useState<PageType>('welcome')
    const [pointsCollected, setPointsCollected] = useState(false)
    const [luckyDrawEntered, setLuckyDrawEntered] = useState(false)
    const [giftRedeemed, setGiftRedeemed] = useState(false)
    const [scratchCardPlayed, setScratchCardPlayed] = useState(false)
    const [scratchResult, setScratchResult] = useState<any>(null)
    const [isScratching, setIsScratching] = useState(false)
    const [isGameLoading, setIsGameLoading] = useState(false)
    const [gameError, setGameError] = useState<string | null>(null)
    const [redeemGifts, setRedeemGifts] = useState<any[]>([])
    const [loadingGifts, setLoadingGifts] = useState(false)
    const [claimingGift, setClaimingGift] = useState(false)
    const [redemptionCode, setRedemptionCode] = useState('')
    const [claimedGiftDetails, setClaimedGiftDetails] = useState<any>(null)
    const [selectedGiftId, setSelectedGiftId] = useState<string | null>(null)

    // Form states
    const [userId, setUserId] = useState('')
    const [password, setPassword] = useState('')
    const [customerName, setCustomerName] = useState('')
    const [customerPhone, setCustomerPhone] = useState('')
    const [customerEmail, setCustomerEmail] = useState('')
    const [totalPoints, setTotalPoints] = useState(0)
    const [cumulativePoints, setCumulativePoints] = useState(0)
    const [isCollectingPoints, setIsCollectingPoints] = useState(false)
    const [variantImageError, setVariantImageError] = useState(false)
    const [customImageError, setCustomImageError] = useState(false)
    const [isClaiming, setIsClaiming] = useState(false)
    const [claimSuccess, setClaimSuccess] = useState(false)

    const handleClaimPrize = async () => {
        if (!scratchResult || !scratchResult.reward) return

        setIsClaiming(true)
        setGameError(null)
        try {
            const payload: any = {
                playId: scratchResult.playId,
                rewardType: scratchResult.reward.type,
            }

            if (scratchResult.reward.type === 'points') {
                if (!userId || !password) {
                    throw new Error('Please enter Shop ID and Password')
                }
                payload.shopId = userId
                payload.password = password
            } else {
                if (!customerName || !customerPhone) {
                    throw new Error('Please enter Name and Phone Number')
                }
                payload.name = customerName
                payload.phone = customerPhone
                payload.email = customerEmail
            }

            const res = await fetch('/api/scratch-card/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to claim prize')

            setClaimSuccess(true)
        } catch (error: any) {
            setGameError(error.message)
        } finally {
            setIsClaiming(false)
        }
    }

    // Check if points were already collected for this QR code on component mount
    useEffect(() => {
        async function checkCollectionStatus() {
            if (!qrCode) {
                console.log('⚠️ No QR code provided, skipping collection status check')
                return
            }

            console.log('🔍 Checking collection status for QR code:', qrCode)

            try {
                const response = await fetch(`/api/consumer/check-collection-status?qr_code=${encodeURIComponent(qrCode)}`)
                const result = await response.json()

                console.log('📊 Collection status result:', result)

                if (result.success) {
                    if (result.already_collected) {
                        console.log('✅ Points already collected! Setting state...')
                        setPointsCollected(true)
                        setTotalPoints(result.points_earned || 0)
                        setCumulativePoints(result.total_balance || 0)
                    }
                    
                    if (result.gift_redeemed) {
                        console.log('✅ Gift already redeemed!')
                        setGiftRedeemed(true)
                    }

                    if (result.lucky_draw_entered) {
                        console.log('✅ Lucky draw already entered!')
                        setLuckyDrawEntered(true)
                    }
                }
            } catch (error) {
                console.error('Error checking collection status:', error)
            }
        }

        checkCollectionStatus()
    }, [qrCode])

    async function handleCollectPoints() {
        if (!userId || !password) {
            alert('Please enter Shop ID and Password')
            return
        }

        // If qrCode is provided, call real API
        if (qrCode) {
            setIsCollectingPoints(true)
            try {
                const response = await fetch('/api/consumer/collect-points', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        qr_code: qrCode,
                        shop_id: userId,
                        password: password
                    })
                })

                const result = await response.json()

                // Handle already collected case (status 409)
                if (result.already_collected) {
                    console.log('⚠️ Points already collected for this QR code')
                    alert('Points already collected for this QR code!')
                    
                    // Attempt client-side login to establish session
                    if (result.email && password) {
                        const supabase = createClient()
                        await supabase.auth.signInWithPassword({
                            email: result.email,
                            password: password
                        })
                    }

                    setTotalPoints(result.points_earned || 0)
                    setCumulativePoints(result.total_balance || 0)
                    setPointsCollected(true)
                    setIsCollectingPoints(false)
                    setCurrentPage('thank-you')
                    return
                }

                if (!response.ok || !result.success) {
                    // Check if it's a preview mode error
                    if (result.preview) {
                        alert('This is a demo/preview QR code. Point collection is not available for codes that haven\'t been activated yet.')
                    } else {
                        alert(result.error || 'Failed to collect points')
                    }
                    setIsCollectingPoints(false)
                    return
                }

                // Success case
                // Attempt client-side login to establish session
                if (result.email && password) {
                    const supabase = createClient()
                    await supabase.auth.signInWithPassword({
                        email: result.email,
                        password: password
                    })
                }

                // Success - update points
                const earnedPoints = result.points_earned || 0
                const totalBalance = result.total_balance || earnedPoints
                
                setTotalPoints(earnedPoints)
                setCumulativePoints(totalBalance)
                setPointsCollected(true)
                setIsCollectingPoints(false)

                // Track successful point collection for statistics
                try {
                    await fetch('/api/consumer/track-scan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            qr_code: qrCode,
                            action: 'collect_points'
                        })
                    })
                } catch (err) {
                    console.error('Failed to track points collection:', err)
                }

                console.log('Points collected:', result)
            } catch (error) {
                console.error('Error collecting points:', error)
                alert('Failed to collect points. Please try again.')
                setIsCollectingPoints(false)
                return
            }
        } else {
            // Demo mode - simulate points collection
            const earnedPoints = Math.floor(Math.random() * 50) + 50 // 50-100 points
            setTotalPoints(earnedPoints)
            setCumulativePoints(cumulativePoints + earnedPoints)
            setPointsCollected(true)
        }
    }

    // Validation helpers
    const validateMalaysianPhone = (phone: string) => {
        // Remove non-numeric characters
        const cleanPhone = phone.replace(/\D/g, '')
        // Check if it starts with 60 or 0
        // If starts with 60, length should be 11-12 (e.g. 60123456789)
        // If starts with 0, length should be 10-11 (e.g. 0123456789)
        
        if (cleanPhone.startsWith('60')) {
            return /^601[0-9]{8,9}$/.test(cleanPhone)
        } else if (cleanPhone.startsWith('0')) {
            return /^01[0-9]{8,9}$/.test(cleanPhone)
        }
        return false
    }

    const validateEmail = (email: string) => {
        if (!email) return true // Optional
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    }

    async function handleLuckyDrawEntry() {
        if (!customerName || !customerPhone) {
            alert('Please enter Name and Phone')
            return
        }

        if (!validateMalaysianPhone(customerPhone)) {
            alert('Please enter a valid Malaysian phone number (e.g., 0123456789)')
            return
        }

        if (customerEmail && !validateEmail(customerEmail)) {
            alert('Please enter a valid email address')
            return
        }

        // If qrCode is provided, submit to actual API
        if (qrCode) {
            try {
                const response = await fetch('/api/consumer/lucky-draw-entry', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        qr_code: qrCode,
                        consumer_name: customerName,
                        consumer_phone: customerPhone,
                        consumer_email: customerEmail || undefined
                    })
                })

                const result = await response.json()

                if (!response.ok || !result.success) {
                    alert(result.error || 'Failed to submit lucky draw entry')
                    return
                }

                // Success - show the entry details
                console.log('Lucky draw entry submitted:', result)
            } catch (error) {
                console.error('Error submitting lucky draw entry:', error)
                alert('Failed to submit lucky draw entry. Please try again.')
                return
            }
        }

        // Show success page (works for both demo and real submissions)
        setLuckyDrawEntered(true)
    }

    async function fetchRedeemGifts() {
        if (!qrCode) return
        
        setLoadingGifts(true)
        try {
            const response = await fetch(`/api/consumer/redeem-gifts?qr_code=${encodeURIComponent(qrCode)}`)
            const result = await response.json()
            
            if (result.success) {
                setRedeemGifts(result.gifts || [])
            }
        } catch (error) {
            console.error('Error fetching redeem gifts:', error)
        } finally {
            setLoadingGifts(false)
        }
    }

    async function handleGiftRedeem() {
        // If qrCode is provided and gifts are available, call real API
        if (qrCode && redeemGifts.length > 0) {
            if (!selectedGiftId) {
                alert('Please select a gift to claim')
                return
            }

            if (!customerName || !customerPhone) {
                alert('Please enter your Name and Phone Number')
                return
            }

            if (!validateMalaysianPhone(customerPhone)) {
                alert('Please enter a valid Malaysian phone number (e.g., 0123456789)')
                return
            }

            if (customerEmail && !validateEmail(customerEmail)) {
                alert('Please enter a valid email address')
                return
            }

            setClaimingGift(true)
            try {
                const selectedGift = redeemGifts.find(g => g.id === selectedGiftId)
                if (!selectedGift) {
                    alert('Selected gift not found')
                    setClaimingGift(false)
                    return
                }
                
                const response = await fetch('/api/consumer/claim-gift', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        qr_code: qrCode,
                        gift_id: selectedGift.id,
                        consumer_name: customerName,
                        consumer_phone: customerPhone,
                        consumer_email: customerEmail || undefined
                    })
                })

                const result = await response.json()

                if (!response.ok || !result.success) {
                    alert(result.error || 'Failed to claim gift')
                    setClaimingGift(false)
                    return
                }

                // Success - show redemption screen
                setRedemptionCode(result.redemption_code)
                setClaimedGiftDetails(result)
                setGiftRedeemed(true)
                setClaimingGift(false)

                // Refresh gift list to update quantities
                if (result.remaining !== null && result.remaining <= 0) {
                    setRedeemGifts([])
                } else {
                    // Reload gifts to get updated quantities
                    await fetchRedeemGifts()
                }

                console.log('Gift claimed:', result)
            } catch (error) {
                console.error('Error claiming gift:', error)
                alert('Failed to claim gift. Please try again.')
                setClaimingGift(false)
                return
            }
        } else {
            // Demo mode - simulate gift redemption
            setRedemptionCode(`GFT-${Math.random().toString(36).substr(2, 6).toUpperCase()}`)
            setGiftRedeemed(true)
        }
    }

    function renderWelcomePage() {
        const getIcon = (iconName: string | undefined, defaultIcon: any) => {
            switch (iconName) {
                case 'Coins': return Coins;
                case 'Star': return Star;
                case 'Gift': return Gift;
                case 'Smartphone': return Smartphone;
                case 'Zap': return Zap;
                case 'Trophy': return Trophy;
                case 'Heart': return Heart;
                case 'ShoppingBag': return ShoppingBag;
                default: return defaultIcon;
            }
        }

        const PointsIcon = getIcon(config.points_icon, Coins)
        const LuckyDrawIcon = getIcon(config.lucky_draw_icon, Star)
        const RedemptionIcon = getIcon(config.redemption_icon, Gift)
        const ScratchCardIcon = getIcon(config.scratch_card_icon, Gift)

        // Genuine badge images based on style
        const genuineBadgeImages = {
            gold: 'https://images.unsplash.com/photo-1606318313732-1f8f83e9b6e1?w=200&h=200&fit=crop',
            blue: 'https://images.unsplash.com/photo-1606318313732-1f8f83e9b6e1?w=200&h=200&fit=crop',
            red: 'https://images.unsplash.com/photo-1606318313732-1f8f83e9b6e1?w=200&h=200&fit=crop',
            green: 'https://images.unsplash.com/photo-1606318313732-1f8f83e9b6e1?w=200&h=200&fit=crop'
        }

        return (
            <>
                {/* Header with Primary Color */}
                <div
                    className="px-4 py-6 text-white"
                    style={{ backgroundColor: config.primary_color }}
                >
                    <div className="text-center">
                        {config.show_product_image && (
                            <div className="mb-4">
                                {config.product_image_source === 'genuine_badge' ? (
                                    <div className="inline-flex items-center justify-center w-24 h-24 bg-white rounded-full p-2 mb-2">
                                        <div className="relative w-full h-full">
                                            {/* Genuine Product Badge SVG */}
                                            <svg viewBox="0 0 200 200" className="w-full h-full">
                                                <circle cx="100" cy="100" r="90" fill={
                                                    config.genuine_badge_style === 'gold' ? '#FFD700' :
                                                    config.genuine_badge_style === 'blue' ? '#4169E1' :
                                                    config.genuine_badge_style === 'red' ? '#DC143C' :
                                                    '#32CD32'
                                                } />
                                                <circle cx="100" cy="100" r="75" fill="white" />
                                                <circle cx="100" cy="100" r="65" fill={
                                                    config.genuine_badge_style === 'gold' ? '#FFD700' :
                                                    config.genuine_badge_style === 'blue' ? '#4169E1' :
                                                    config.genuine_badge_style === 'red' ? '#DC143C' :
                                                    '#32CD32'
                                                } />
                                                <text x="100" y="80" textAnchor="middle" fill="white" fontSize="28" fontWeight="bold">100%</text>
                                                <text x="100" y="110" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold">GENUINE</text>
                                                <text x="100" y="130" textAnchor="middle" fill="white" fontSize="14">PRODUCT</text>
                                                {/* Star decorations */}
                                                <path d="M 100 25 L 105 40 L 120 40 L 108 50 L 113 65 L 100 55 L 87 65 L 92 50 L 80 40 L 95 40 Z" fill="white" />
                                            </svg>
                                        </div>
                                    </div>
                                ) : config.product_image_source === 'custom' && config.custom_image_url && !customImageError ? (
                                    <div className="inline-flex mb-2 w-24 h-24 bg-white rounded-lg p-2 items-center justify-center overflow-hidden">
                                        <Image
                                            src={config.custom_image_url}
                                            alt="Product"
                                            width={96}
                                            height={96}
                                            className="max-w-full max-h-full object-contain"
                                            unoptimized
                                            priority
                                            loading="eager"
                                            onError={() => {
                                                console.error('Custom image failed to load:', config.custom_image_url)
                                                setCustomImageError(true)
                                            }}
                                        />
                                    </div>
                                ) : (config.product_image_source === 'variant' || !config.product_image_source) && config.variant_image_url ? (
                                    <div className="inline-flex mb-2 w-24 h-24 bg-white rounded-lg p-2 items-center justify-center overflow-hidden relative">
                                        <Image
                                            src={config.variant_image_url}
                                            alt="Product Variant"
                                            fill
                                            className="object-contain p-2"
                                            sizes="96px"
                                            priority
                                            unoptimized
                                        />
                                    </div>
                                ) : (
                                    <div className="inline-block mb-2">
                                        <div className="w-24 h-24 bg-white bg-opacity-30 rounded-lg flex items-center justify-center">
                                            <Gift className="w-12 h-12 text-white" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {!config.show_product_image && (
                            <div className="inline-flex items-center justify-center w-16 h-16 bg-white bg-opacity-20 rounded-full mb-3">
                                <CheckCircle2 className="w-8 h-8" />
                            </div>
                        )}
                        <h1 className="text-xl font-bold">
                            {config.welcome_title || 'This Product is Genuine Original'}
                        </h1>
                        <p className="text-sm mt-2 opacity-90">
                            {config.welcome_message || 'Congratulations! Scan verified successfully.'}
                        </p>
                    </div>
                </div>

                {/* Features Section */}
                <div className="px-4 py-4 space-y-3">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                        <p className="text-sm text-blue-800 font-medium">
                            Select an option below to continue
                        </p>
                    </div>

                    {/* Points */}
                    {config.points_enabled && (
                        <button
                            onClick={async () => {
                                // Prevent clicking if already collected
                                if (pointsCollected) {
                                    return
                                }
                                setCurrentPage('collect-points')
                                // Track that user clicked on collect points
                                if (qrCode) {
                                    try {
                                        await fetch('/api/consumer/track-scan', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                qr_code: qrCode,
                                                action: 'view_collect_points'
                                            })
                                        })
                                    } catch (err) {
                                        console.error('Failed to track collect points view:', err)
                                    }
                                }
                            }}
                            disabled={pointsCollected}
                            className={`w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 transition-colors text-left ${
                                pointsCollected 
                                    ? 'opacity-60 cursor-not-allowed' 
                                    : 'hover:border-blue-300 cursor-pointer'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="p-3 rounded-full"
                                    style={{ backgroundColor: `${config.primary_color}20` }}
                                >
                                    <PointsIcon className="w-5 h-5" style={{ color: config.primary_color }} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-sm">{config.points_title || 'Collect Points'}</h3>
                                    <p className="text-xs text-gray-600">{config.points_description || 'Earn rewards with every scan'}</p>
                                </div>
                                {pointsCollected && (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                )}
                            </div>
                        </button>
                    )}

                    {/* Lucky Draw */}
                    {config.lucky_draw_enabled && (
                        <button
                            onClick={() => setCurrentPage('lucky-draw')}
                            className="w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:border-purple-300 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="p-3 rounded-full"
                                    style={{ backgroundColor: `${config.primary_color}20` }}
                                >
                                    <LuckyDrawIcon className="w-5 h-5" style={{ color: config.primary_color }} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-sm">{config.lucky_draw_title || 'Lucky Draw'}</h3>
                                    <p className="text-xs text-gray-600">{config.lucky_draw_description || 'Try your luck and win prizes!'}</p>
                                </div>
                                {luckyDrawEntered && (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                )}
                            </div>
                        </button>
                    )}

                    {/* Redemption */}
                    {config.redemption_enabled && (
                        <button
                            onClick={() => {
                                setCurrentPage('redeem-gift')
                                fetchRedeemGifts()
                            }}
                            className="w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:border-green-300 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="p-3 rounded-full"
                                    style={{ backgroundColor: `${config.primary_color}20` }}
                                >
                                    <RedemptionIcon className="w-5 h-5" style={{ color: config.primary_color }} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-sm">{config.redemption_title || 'Claim Free Gift'}</h3>
                                    <p className="text-xs text-gray-600">{config.redemption_description || 'Get your free gift at the shop'}</p>
                                </div>
                                {giftRedeemed && (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                )}
                            </div>
                        </button>
                    )}

                    {/* Scratch Card Game */}
                    {config.enable_scratch_card_game && (
                        <button
                            onClick={() => setCurrentPage('scratch-card-game')}
                            className="w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:border-purple-300 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="p-3 rounded-full"
                                    style={{ backgroundColor: `${config.primary_color}20` }}
                                >
                                    <ScratchCardIcon className="w-5 h-5" style={{ color: config.primary_color }} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-sm">{config.scratch_card_title || 'Scratch Card Game'}</h3>
                                    <p className="text-xs text-gray-600">{config.scratch_card_description || 'Scratch & win surprise rewards'}</p>
                                </div>
                                {scratchCardPlayed && (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                )}
                            </div>
                        </button>
                    )}
                </div>

                {/* Exit Button */}
                <div className="px-4 py-2">
                    <button
                        onClick={() => setCurrentPage('thank-you')}
                        className="w-full py-2 text-sm text-gray-600 hover:text-gray-800"
                    >
                        Exit
                    </button>
                </div>
            </>
        )
    }

    function renderCollectPointsPage() {
        if (pointsCollected) {
            return (
                <>
                    <div
                        className="px-4 py-4 text-white text-center"
                        style={{ backgroundColor: config.primary_color }}
                    >
                        <h2 className="text-lg font-bold">Points Collected!</h2>
                    </div>
                    <div className="px-4 py-6 space-y-6">
                        <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6 text-center">
                            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                            <div className="space-y-3">
                                <div>
                                    <p className="text-sm text-gray-600">Points Earned This Purchase</p>
                                    <p className="text-4xl font-bold text-green-600">+{totalPoints}</p>
                                </div>
                                <div className="pt-3 border-t border-green-200">
                                    <p className="text-sm text-gray-600">Current Balance Point</p>
                                    <p className="text-3xl font-bold text-blue-600">{cumulativePoints}</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <button
                                onClick={() => window.location.href = '/engagement/catalog'}
                                className="w-full py-3 px-4 text-white font-medium rounded-lg shadow-md flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: config.button_color }}
                            >
                                <Gift className="w-5 h-5" />
                                View Rewards Catalog
                            </button>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setCurrentPage('welcome')}
                                    className="flex-1 py-3 px-4 bg-white border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                                >
                                    Main Menu
                                </button>
                                <button
                                    onClick={() => setCurrentPage('thank-you')}
                                    className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200"
                                >
                                    Exit
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )
        }

        return (
            <>
                <div className="flex items-center gap-3 px-4 py-3 border-b">
                    <button onClick={() => setCurrentPage('welcome')}>
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h2 className="font-semibold">Collect Points</h2>
                </div>
                <div className="px-4 py-6 space-y-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                        <Coins className="w-12 h-12 text-blue-600 mx-auto mb-2" />
                        <p className="text-sm text-blue-800">Enter your credentials to collect points</p>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label className="text-sm">Shop ID / Phone Number</Label>
                            <Input
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                placeholder="Enter your shop ID"
                                className="text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm">Password</Label>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter password"
                                className="text-sm"
                            />
                        </div>
                    </div>

                    <button
                        onClick={handleCollectPoints}
                        disabled={isCollectingPoints}
                        className="w-full py-3 px-4 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: config.button_color }}
                    >
                        {isCollectingPoints ? 'Collecting Points...' : 'Collect Points'}
                    </button>
                </div>
            </>
        )
    }

    function renderLuckyDrawPage() {
        if (luckyDrawEntered) {
            return (
                <>
                    <div
                        className="px-4 py-4 text-white text-center"
                        style={{ backgroundColor: config.primary_color }}
                    >
                        <h2 className="text-lg font-bold">Lucky Draw Entry Submitted!</h2>
                    </div>
                    <div className="px-4 py-6 space-y-6">
                        <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-6 text-center">
                            <Star className="w-16 h-16 text-purple-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-purple-900 mb-2">Good Luck!</h3>
                            <p className="text-sm text-purple-700">
                                You have been entered into the lucky draw. Winners will be announced soon!
                            </p>
                            <div className="mt-4 pt-4 border-t border-purple-200">
                                <p className="text-xs text-gray-600">Entry Details:</p>
                                <div className="mt-2 space-y-1 text-sm">
                                    <p><strong>Name:</strong> {customerName}</p>
                                    <p><strong>Phone:</strong> {customerPhone}</p>
                                    {customerEmail && <p><strong>Email:</strong> {customerEmail}</p>}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setCurrentPage('welcome')}
                                className="flex-1 py-3 px-4 bg-white border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                            >
                                Main Menu
                            </button>
                            <button
                                onClick={() => setCurrentPage('thank-you')}
                                className="flex-1 py-3 px-4 text-white font-medium rounded-lg"
                                style={{ backgroundColor: config.button_color }}
                            >
                                Exit
                            </button>
                        </div>
                    </div>
                </>
            )
        }

        const prizes = config.lucky_draw_prizes || []
        const totalPrizes = prizes.reduce((sum: number, prize: any) => sum + (parseInt(prize.quantity) || 0), 0)

        return (
            <>
                <div className="flex items-center gap-3 px-4 py-3 border-b">
                    <button onClick={() => setCurrentPage('welcome')}>
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h2 className="font-semibold">Lucky Draw</h2>
                </div>
                <div className="px-4 py-6 space-y-4">
                    {/* Campaign Header */}
                    <div className="flex items-center justify-between mb-2">
                        <h1 className="text-xl font-bold text-gray-900">
                            {config.lucky_draw_campaign_name || 'Lucky Draw'}
                        </h1>
                        <div className="flex items-center gap-2">
                            <div className="w-10 h-5 bg-blue-600 rounded-full relative">
                                <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full"></div>
                            </div>
                            <span className="text-green-600 font-medium text-sm">Active</span>
                        </div>
                    </div>

                    {/* Prizes List */}
                    {prizes.length > 0 ? (
                        <div className="flex gap-3 overflow-x-auto pb-2">
                            {prizes.map((prize: any, idx: number) => (
                                <div key={idx} className="relative flex-shrink-0">
                                    <div className="w-20 h-20 bg-white rounded-lg border border-gray-200 overflow-hidden flex items-center justify-center">
                                        {prize.image_url ? (
                                            <img 
                                                src={prize.image_url} 
                                                alt={prize.name} 
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <Gift className="w-8 h-8 text-gray-300" />
                                        )}
                                    </div>
                                    <div className="absolute -bottom-2 -right-2 bg-black text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                        x{prize.quantity}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : config.lucky_draw_image_url && (
                        <div className="w-full h-48 mb-4 rounded-lg overflow-hidden bg-white flex items-center justify-center border border-gray-200">
                            <img 
                                src={config.lucky_draw_image_url} 
                                alt={config.lucky_draw_campaign_name || "Lucky Draw Prize"} 
                                className="max-w-full max-h-full object-contain"
                            />
                        </div>
                    )}

                    {/* Stats */}
                    <div className="flex gap-6 text-gray-600 mb-2">
                        <div className="flex items-center gap-2">
                            <Users className="w-5 h-5" />
                            <span>0 entries</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Gift className="w-5 h-5" />
                            <span>{totalPrizes} prizes</span>
                        </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-gray-100">
                        <p className="text-sm text-purple-800 font-medium text-center">
                            Enter your details to participate!
                        </p>
                        <div className="space-y-2">
                            <Label className="text-sm">Name *</Label>
                            <Input
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="Enter your name"
                                className="text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm">Phone Number *</Label>
                            <Input
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                placeholder="Enter phone number"
                                className="text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm">Email (Optional)</Label>
                            <Input
                                type="email"
                                value={customerEmail}
                                onChange={(e) => setCustomerEmail(e.target.value)}
                                placeholder="Enter email address"
                                className="text-sm"
                            />
                        </div>
                    </div>

                    <button
                        onClick={handleLuckyDrawEntry}
                        className="w-full py-3 px-4 text-white font-medium rounded-lg"
                        style={{ backgroundColor: config.button_color }}
                    >
                        Enter Lucky Draw
                    </button>
                </div>
            </>
        )
    }

    function renderRedeemGiftPage() {
        if (giftRedeemed) {
            return (
                <>
                    <div
                        className="px-4 py-4 text-white text-center"
                        style={{ backgroundColor: config.primary_color }}
                    >
                        <h2 className="text-lg font-bold">Gift Claimed!</h2>
                    </div>
                    <div className="px-4 py-6 space-y-6">
                        <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6 text-center">
                            <Gift className="w-16 h-16 text-green-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-green-900 mb-2">Congratulations!</h3>
                            <p className="text-sm text-green-700 mb-4">
                                Please show this screen to the shop staff to claim your free gift
                            </p>

                            {/* Gift Image */}
                            <div className="bg-white border-2 border-green-300 rounded-lg p-4 mb-4">
                                {claimedGiftDetails?.gift_image_url ? (
                                    <div className="w-48 h-48 mx-auto bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden">
                                        <Image
                                            src={claimedGiftDetails.gift_image_url}
                                            alt={claimedGiftDetails.gift_name || 'Gift'}
                                            width={192}
                                            height={192}
                                            className="w-full h-full object-contain"
                                            unoptimized
                                            priority
                                            loading="eager"
                                        />
                                    </div>
                                ) : (
                                    <div className="w-32 h-32 mx-auto bg-gray-100 rounded-lg flex items-center justify-center">
                                        <Gift className="w-16 h-16 text-gray-400" />
                                    </div>
                                )}
                                <p className="mt-3 font-semibold text-gray-800">
                                    {claimedGiftDetails?.gift_name || 'Premium Gift Item'}
                                </p>
                                {claimedGiftDetails?.gift_description && (
                                    <p className="text-xs text-gray-600 mt-1">{claimedGiftDetails.gift_description}</p>
                                )}
                            </div>

                            <div className="bg-white border border-green-200 rounded p-3">
                                <p className="text-xs text-gray-600">Redemption Code</p>
                                <p className="text-lg font-mono font-bold text-gray-800">{redemptionCode}</p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setCurrentPage('welcome')}
                                className="flex-1 py-3 px-4 bg-white border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                            >
                                Main Menu
                            </button>
                            <button
                                onClick={() => setCurrentPage('thank-you')}
                                className="flex-1 py-3 px-4 text-white font-medium rounded-lg"
                                style={{ backgroundColor: config.button_color }}
                            >
                                Exit
                            </button>
                        </div>
                    </div>
                </>
            )
        }

        return (
            <>
                <div className="flex items-center gap-3 px-4 py-3 border-b">
                    <button onClick={() => setCurrentPage('welcome')}>
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h2 className="font-semibold">Claim Free Gift</h2>
                </div>
                <div className="px-4 py-6 space-y-4">
                    {loadingGifts ? (
                        <div className="text-center py-8">
                            <p className="text-gray-500">Loading available gifts...</p>
                        </div>
                    ) : redeemGifts.length === 0 ? (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                            <Gift className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-600">No gifts available at this time</p>
                        </div>
                    ) : (
                        <>
                            {/* Check if all gifts are fully claimed */}
                            {redeemGifts.every(gift => gift.total_quantity > 0 && gift.claimed_quantity >= gift.total_quantity) ? (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                                    <Gift className="w-16 h-16 text-yellow-500 mx-auto mb-3" />
                                    <h3 className="font-semibold text-lg text-yellow-900 mb-2">All Gifts Claimed</h3>
                                    <p className="text-sm text-yellow-700">
                                        All available gifts for this product have been claimed. Thank you for your interest!
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                                        <Gift className="w-12 h-12 text-green-600 mx-auto mb-2" />
                                        <p className="text-sm text-green-800 font-medium">You have {redeemGifts.length} free gift{redeemGifts.length > 1 ? 's' : ''} waiting!</p>
                                    </div>

                                    {/* Gift List */}
                                    {redeemGifts.map((gift) => {
                                        const remaining = gift.total_quantity > 0 ? gift.total_quantity - gift.claimed_quantity : null
                                        const isFullyClaimed = remaining !== null && remaining <= 0
                                        const isSelected = selectedGiftId === gift.id
                                        
                                        return (
                                            <div 
                                                key={gift.id} 
                                                onClick={() => !isFullyClaimed && setSelectedGiftId(gift.id)}
                                                className={`bg-white border-2 rounded-lg p-4 relative transition-all cursor-pointer
                                                    ${isFullyClaimed ? 'border-gray-300 opacity-60 cursor-not-allowed' : 
                                                      isSelected ? 'ring-2 ring-opacity-50' : 
                                                      'border-gray-200 hover:border-gray-300'}`}
                                                style={isSelected && !isFullyClaimed ? { borderColor: config.primary_color, '--tw-ring-color': config.primary_color } as React.CSSProperties : {}}
                                            >
                                                {isSelected && (
                                                    <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-1 z-10">
                                                        <CheckCircle2 className="w-4 h-4" />
                                                    </div>
                                                )}
                                                {gift.gift_image_url ? (
                                                    <div className="w-full h-48 rounded-lg overflow-hidden mb-3 bg-gray-50 flex items-center justify-center">
                                                        <Image
                                                            src={gift.gift_image_url}
                                                            alt={gift.gift_name}
                                                            width={400}
                                                            height={192}
                                                            className="w-full h-full object-contain"
                                                            unoptimized
                                                            priority
                                                            loading="eager"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="w-full h-48 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
                                                        <Gift className="w-20 h-20 text-gray-400" />
                                                    </div>
                                                )}
                                                <h3 className="font-semibold text-center">{gift.gift_name}</h3>
                                                {gift.gift_description && (
                                                    <p className="text-xs text-gray-600 text-center mt-1">{gift.gift_description}</p>
                                                )}
                                                {remaining !== null && (
                                                    <p className={`text-xs text-center mt-2 font-medium ${isFullyClaimed ? 'text-red-600' : 'text-green-600'}`}>
                                                        {isFullyClaimed ? 'Fully claimed' : `${remaining} available`}
                                                    </p>
                                                )}
                                                {remaining === null && (
                                                    <p className="text-xs text-gray-500 text-center mt-2">
                                                        Unlimited availability
                                                    </p>
                                                )}
                                            </div>
                                        )
                                    })}

                                    {/* Consumer Details Form */}
                                    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                                        <h4 className="font-semibold text-sm text-gray-700">Your Details</h4>
                                        <div className="space-y-2">
                                            <Label className="text-xs">Name *</Label>
                                            <Input
                                                value={customerName}
                                                onChange={(e) => setCustomerName(e.target.value)}
                                                placeholder="Enter your name"
                                                className="text-sm h-9"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs">Phone Number *</Label>
                                            <Input
                                                value={customerPhone}
                                                onChange={(e) => setCustomerPhone(e.target.value)}
                                                placeholder="Enter phone number"
                                                className="text-sm h-9"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs">Email (Optional)</Label>
                                            <Input
                                                type="email"
                                                value={customerEmail}
                                                onChange={(e) => setCustomerEmail(e.target.value)}
                                                placeholder="Enter email address"
                                                className="text-sm h-9"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleGiftRedeem}
                                        disabled={claimingGift || !selectedGiftId || !customerName || !customerPhone || redeemGifts.every(gift => gift.total_quantity > 0 && gift.claimed_quantity >= gift.total_quantity)}
                                        className="w-full py-3 px-4 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={{ backgroundColor: config.button_color }}
                                    >
                                        {claimingGift ? 'Claiming...' : 'Claim Selected Gift'}
                                    </button>

                                    <p className="text-xs text-gray-500 text-center">
                                        Show the redemption screen to shop staff to receive your gift
                                    </p>
                                </>
                            )}
                        </>
                    )}
                </div>
            </>
        )
    }

    function renderThankYouPage() {
        return (
            <>
                <div
                    className="px-4 py-6 text-white text-center"
                    style={{ backgroundColor: config.primary_color }}
                >
                    <CheckCircle2 className="w-16 h-16 mx-auto mb-4 opacity-90" />
                    <h1 className="text-xl font-bold">
                        {config.thank_you_message || 'Thank you for your participation!'}
                    </h1>
                </div>

                <div className="px-4 py-6 space-y-4">
                    {/* Summary */}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                        <h3 className="font-semibold text-sm text-gray-700">Your Activity Summary:</h3>
                        <div className="space-y-2">
                            {config.points_enabled && (
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-600">Points Collected</span>
                                    <Badge variant={pointsCollected ? "default" : "outline"}>
                                        {pointsCollected ? `✓ ${totalPoints} pts` : 'Not collected'}
                                    </Badge>
                                </div>
                            )}
                            {config.lucky_draw_enabled && (
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-600">Lucky Draw</span>
                                    <Badge variant={luckyDrawEntered ? "default" : "outline"}>
                                        {luckyDrawEntered ? '✓ Entered' : 'Not entered'}
                                    </Badge>
                                </div>
                            )}
                            {config.redemption_enabled && (
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-600">Free Gift</span>
                                    <Badge variant={giftRedeemed ? "default" : "outline"}>
                                        {giftRedeemed ? '✓ Claimed' : 'Not claimed'}
                                    </Badge>
                                </div>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            setCurrentPage('welcome')
                            // Reset states if needed
                        }}
                        className="w-full py-3 px-4 bg-white border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                    >
                        Back to Main Menu
                    </button>

                    <button
                        onClick={() => window.location.reload()}
                        className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
                    >
                        Close
                    </button>
                </div>
            </>
        )
    }

    function renderScratchCardGamePage() {
        const themeId = config.theme_config?.theme_id || 'modern'
        const titleText = config.theme_config?.title_text || config.lucky_draw_campaign_name || 'SCRATCH & WIN'

        // Render different layouts based on theme
        if (themeId === 'retro') {
            return (
                <div className="h-full flex flex-col relative overflow-hidden bg-green-500">
                    {/* Sunburst Background */}
                    <div className="absolute inset-0 bg-[repeating-conic-gradient(#22c55e_0deg_15deg,#4ade80_15deg_30deg)] opacity-100 animate-[spin_20s_linear_infinite]"></div>
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20"></div>
                    
                    {/* Header */}
                    <div className="relative z-10 flex items-center justify-between px-4 py-4">
                        <button onClick={() => setCurrentPage('welcome')} className="p-2 bg-white/90 rounded-full shadow-lg hover:scale-110 transition-transform text-green-700">
                            <ArrowLeft className="w-6 h-6" strokeWidth={3} />
                        </button>
                    </div>

                    <div className="relative z-10 flex-1 flex flex-col items-center px-4 pb-8 overflow-y-auto">
                        {/* Retro Title */}
                        <div className="mt-4 mb-8 relative transform -rotate-2 hover:rotate-0 transition-transform duration-300">
                            <div className="absolute inset-0 bg-red-700 rounded-2xl transform rotate-3 scale-105 border-4 border-white shadow-xl"></div>
                            <div className="relative bg-red-600 px-8 py-4 rounded-xl border-4 border-yellow-400 shadow-[0_10px_0_rgb(180,0,0)]">
                                <h1 className="text-4xl font-black text-yellow-300 drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)] uppercase tracking-wider text-center leading-none">
                                    {titleText}
                                </h1>
                                <div className="absolute -top-3 -right-3 text-yellow-400 animate-bounce">
                                    <Star className="w-8 h-8 fill-current" />
                                </div>
                                <div className="absolute -bottom-3 -left-3 text-yellow-400 animate-bounce delay-100">
                                    <Star className="w-6 h-6 fill-current" />
                                </div>
                            </div>
                        </div>

                        {/* Scratch Area Frame */}
                        <div className="w-full max-w-xs mx-auto relative z-20 mb-8">
                            <div className="bg-yellow-400 p-2 rounded-xl shadow-[0_0_20px_rgba(255,255,0,0.5)]">
                                <div className="bg-red-600 p-2 rounded-lg border-4 border-dashed border-white/50">
                                    <div className="bg-white rounded-md overflow-hidden relative aspect-[4/3]">
                                        {renderScratchArea('from-gray-300 via-gray-100 to-gray-300')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="w-full max-w-xs mx-auto text-center">
                            {scratchCardPlayed ? (
                                <Button className="w-full py-6 rounded-full text-xl font-black bg-blue-600 hover:bg-blue-500 border-b-4 border-blue-800 shadow-lg uppercase tracking-widest" onClick={() => setCurrentPage('welcome')}>
                                    Play Again
                                </Button>
                            ) : (
                                <div className="bg-white/90 backdrop-blur px-6 py-3 rounded-full shadow-lg inline-block transform hover:scale-105 transition-transform">
                                    <p className="text-green-800 font-bold text-sm uppercase tracking-wide">
                                        Scratch the card above!
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )
        }

        if (themeId === 'vip') {
            return (
                <div className="h-full flex flex-col bg-slate-950 relative overflow-hidden">
                    {/* Luxury Pattern */}
                    <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                    <div className="absolute inset-0 bg-gradient-to-b from-slate-900/50 via-transparent to-slate-900/80"></div>
                    
                    {/* Gold Border Frame */}
                    <div className="absolute inset-4 border border-yellow-600/30 rounded-[30px] pointer-events-none"></div>
                    <div className="absolute inset-5 border border-yellow-600/10 rounded-[26px] pointer-events-none"></div>

                    {/* Header */}
                    <div className="relative z-10 flex items-center justify-between px-6 py-6">
                        <button onClick={() => setCurrentPage('welcome')} className="text-yellow-500 hover:text-yellow-400 transition-colors">
                            <ArrowLeft className="w-6 h-6" />
                        </button>
                        <span className="text-[10px] font-serif tracking-[0.2em] text-yellow-600 uppercase">Exclusive Access</span>
                        <div className="w-6"></div>
                    </div>

                    <div className="relative z-10 flex-1 flex flex-col items-center px-6 pb-8 overflow-y-auto">
                        {/* Elegant Title */}
                        <div className="mt-8 mb-12 text-center">
                            <h1 className="text-3xl font-serif text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-700 drop-shadow-sm tracking-widest">
                                {titleText}
                            </h1>
                            <div className="h-[1px] w-24 mx-auto mt-4 bg-gradient-to-r from-transparent via-yellow-600 to-transparent"></div>
                        </div>

                        {/* Scratch Area */}
                        <div className="w-full max-w-xs mx-auto relative z-20 mb-12">
                            <div className="p-[1px] bg-gradient-to-br from-yellow-400 via-yellow-600 to-yellow-800 rounded-xl shadow-2xl">
                                <div className="bg-slate-900 p-4 rounded-xl">
                                    <div className="relative aspect-[4/3] rounded-lg overflow-hidden border border-yellow-900/50">
                                        {renderScratchArea('from-yellow-100 via-yellow-200 to-yellow-100', 'text-yellow-900')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="w-full max-w-xs mx-auto text-center">
                            {scratchCardPlayed ? (
                                <Button className="w-full py-6 bg-gradient-to-r from-yellow-600 to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-slate-950 font-serif tracking-widest uppercase shadow-lg border border-yellow-400/20" onClick={() => setCurrentPage('welcome')}>
                                    Play Again
                                </Button>
                            ) : (
                                <p className="text-yellow-500/60 font-serif italic text-sm">
                                    Reveal your exclusive reward
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )
        }

        if (themeId === 'cyber') {
            return (
                <div className="h-full flex flex-col bg-slate-900 relative overflow-hidden font-mono">
                    {/* Grid Background */}
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]"></div>
                    
                    {/* Header */}
                    <div className="relative z-10 flex items-center justify-between px-4 py-4">
                        <button onClick={() => setCurrentPage('welcome')} className="p-1 border border-cyan-500/50 text-cyan-400 hover:bg-cyan-950/50">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div className="px-2 py-0.5 border border-pink-500/50 bg-pink-950/30">
                            <span className="text-[10px] text-pink-400 uppercase tracking-widest">System.Game.Init</span>
                        </div>
                        <div className="w-7"></div>
                    </div>

                    <div className="relative z-10 flex-1 flex flex-col items-center px-4 pb-8 overflow-y-auto">
                        {/* Glitch Title */}
                        <div className="mt-8 mb-10 text-center relative">
                            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 drop-shadow-[0_0_10px_rgba(0,255,255,0.5)] tracking-tighter">
                                {titleText}
                            </h1>
                            <div className="absolute -inset-1 bg-cyan-500/20 blur-xl -z-10"></div>
                        </div>

                        {/* Scratch Area */}
                        <div className="w-full max-w-xs mx-auto relative z-20 mb-10">
                            <div className="relative">
                                {/* Corner Accents */}
                                <div className="absolute -top-2 -left-2 w-4 h-4 border-t-2 border-l-2 border-cyan-500"></div>
                                <div className="absolute -top-2 -right-2 w-4 h-4 border-t-2 border-r-2 border-cyan-500"></div>
                                <div className="absolute -bottom-2 -left-2 w-4 h-4 border-b-2 border-l-2 border-cyan-500"></div>
                                <div className="absolute -bottom-2 -right-2 w-4 h-4 border-b-2 border-r-2 border-cyan-500"></div>
                                
                                <div className="bg-slate-800/80 backdrop-blur border border-slate-700 p-1">
                                    <div className="relative aspect-[4/3] overflow-hidden">
                                        {renderScratchArea('from-slate-700 via-slate-600 to-slate-700', 'text-cyan-400', true)}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="w-full max-w-xs mx-auto text-center space-y-4">
                            {scratchCardPlayed ? (
                                <Button className="w-full py-6 bg-cyan-600 hover:bg-cyan-500 text-white font-bold tracking-widest uppercase shadow-[0_0_20px_rgba(6,182,212,0.5)] border border-cyan-400" onClick={() => setCurrentPage('welcome')}>
                                    Reboot Game
                                </Button>
                            ) : (
                                <div className="animate-pulse">
                                    <p className="text-cyan-400 text-xs uppercase tracking-[0.2em]">
                                        &gt; Initiate Scratch Sequence_
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )
        }

        // Default: Modern Gradient (Emerald)
        return (
            <div className="h-full flex flex-col bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-800 text-white">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-4">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-white hover:bg-white/20 rounded-full"
                        onClick={() => setCurrentPage('welcome')}
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div className="px-3 py-1 bg-black/20 rounded-full backdrop-blur-sm border border-white/10">
                        <span className="text-xs font-medium text-emerald-100">Scratch & Win</span>
                    </div>
                    <div className="w-9"></div>
                </div>

                <div className="flex-1 flex flex-col items-center px-4 pb-8 overflow-y-auto">
                    {/* Title Banner */}
                    <div className="mt-2 mb-6 text-center relative z-10">
                        <h1 className="text-3xl sm:text-4xl font-extrabold text-yellow-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] tracking-tight">
                            {titleText}
                        </h1>
                        <div className="mt-1 inline-block px-4 py-1 bg-gradient-to-r from-red-500 to-orange-500 rounded-full shadow-lg transform -rotate-2">
                            <p className="text-xs font-bold text-white uppercase tracking-widest">Daily Chance</p>
                        </div>
                    </div>



                    {/* Scratch Card Area */}
                    <div className="w-full max-w-xs mx-auto relative z-20 mb-8">
                        <div className="bg-white p-1 rounded-[2rem] shadow-2xl transform transition-all duration-500 hover:scale-[1.02]">
                            <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-[1.8rem] overflow-hidden relative aspect-[4/3]">
                                {renderScratchArea('from-gray-300 via-gray-200 to-gray-400')}
                            </div>
                        </div>
                    </div>

                    {/* Action Button / Claim Form */}
                    <div className="w-full max-w-xs mx-auto space-y-4 relative z-30">
                        {scratchCardPlayed ? (
                            claimSuccess ? (
                                <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 text-center space-y-4">
                                    <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center mx-auto">
                                        <CheckCircle2 className="w-8 h-8 text-white" />
                                    </div>
                                    <h3 className="text-white font-bold text-xl">Prize Claimed!</h3>
                                    <p className="text-emerald-100 text-sm">
                                        {scratchResult.reward?.type === 'points' 
                                            ? 'Points have been added to your account.' 
                                            : 'We have received your details. You will be contacted shortly.'}
                                    </p>
                                    <Button 
                                        className="w-full font-bold bg-white text-emerald-900 hover:bg-emerald-50"
                                        onClick={() => setCurrentPage('welcome')}
                                    >
                                        Back to Menu
                                    </Button>
                                </div>
                            ) : scratchResult?.result === 'win' ? (
                                <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 space-y-4">
                                    <h3 className="text-white font-bold text-center">Claim Your Prize</h3>
                                    
                                    {scratchResult.reward?.type === 'points' ? (
                                        <div className="space-y-3">
                                            <p className="text-xs text-emerald-100 text-center">
                                                Login with your Shop ID to claim points.
                                            </p>
                                            <div className="space-y-2">
                                                <Input 
                                                    placeholder="Shop ID" 
                                                    value={userId}
                                                    onChange={(e) => setUserId(e.target.value)}
                                                    className="bg-white/90 text-black placeholder:text-gray-500"
                                                />
                                                <Input 
                                                    type="password" 
                                                    placeholder="Password" 
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    className="bg-white/90 text-black placeholder:text-gray-500"
                                                />
                                            </div>
                                            <Button 
                                                className="w-full font-bold"
                                                style={{ backgroundColor: config.button_color }}
                                                onClick={handleClaimPrize}
                                                disabled={isClaiming}
                                            >
                                                {isClaiming ? 'Claiming...' : 'Login & Claim Points'}
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <p className="text-xs text-emerald-100 text-center">
                                                Enter your details to receive your prize.
                                            </p>
                                            <div className="space-y-2">
                                                <Input 
                                                    placeholder="Name" 
                                                    value={customerName}
                                                    onChange={(e) => setCustomerName(e.target.value)}
                                                    className="bg-white/90 text-black placeholder:text-gray-500"
                                                />
                                                <Input 
                                                    placeholder="Phone" 
                                                    value={customerPhone}
                                                    onChange={(e) => setCustomerPhone(e.target.value)}
                                                    className="bg-white/90 text-black placeholder:text-gray-500"
                                                />
                                                <Input 
                                                    placeholder="Email (Optional)" 
                                                    value={customerEmail}
                                                    onChange={(e) => setCustomerEmail(e.target.value)}
                                                    className="bg-white/90 text-black placeholder:text-gray-500"
                                                />
                                            </div>
                                            <Button 
                                                className="w-full font-bold"
                                                style={{ backgroundColor: config.button_color }}
                                                onClick={handleClaimPrize}
                                                disabled={isClaiming}
                                            >
                                                {isClaiming ? 'Claiming...' : 'Claim Prize'}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <Button 
                                    className="w-full py-6 rounded-xl text-lg font-bold shadow-xl hover:scale-[1.02] transition-transform active:scale-[0.98]"
                                    style={{ backgroundColor: config.button_color }}
                                    onClick={() => setCurrentPage('welcome')}
                                >
                                    Play Again
                                </Button>
                            )
                        ) : (
                            <div className="text-center">
                                <p className="text-emerald-100 text-sm font-medium opacity-90">
                                    Tap the silver card to reveal your prize!
                                </p>
                            </div>
                        )}
                        <p className="text-xs text-center text-emerald-200/60 mt-4">
                            One play per day. Terms & Conditions apply.
                        </p>
                    </div>
                </div>
            </div>
        )
    }

    // Helper to render the scratch area content to avoid duplication
    const renderScratchArea = (scratchGradient: string, textColor: string = 'text-gray-500/80', isCyber: boolean = false) => {
        const handlePlay = async () => {
            if (isGameLoading || scratchCardPlayed) return
            
            if (!isLive) {
                // Preview Mode: Simulate
                setIsGameLoading(true)
                setTimeout(() => {
                    const isWin = Math.random() > 0.3
                    setScratchResult({
                        result: isWin ? 'win' : 'no_prize',
                        reward: isWin ? { name: 'Mystery Prize', type: 'points', value: 100 } : null,
                        message: isWin ? 'You won a Mystery Prize!' : 'Better luck next time!'
                    })
                    setIsGameLoading(false)
                }, 1000)
                return
            }

            // Live Mode: Call API
            setIsGameLoading(true)
            setGameError(null)
            try {
                const res = await fetch('/api/scratch-card/play', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        journeyConfigId: config.id,
                        consumerPhone: consumerPhone || 'anonymous',
                        qrCode: qrCode
                    })
                })
                
                const data = await res.json()
                
                if (!res.ok) {
                    throw new Error(data.error || 'Failed to play')
                }
                
                setScratchResult({
                    result: data.status,
                    reward: data.reward,
                    message: data.message,
                    playId: data.play_id || data.id
                })
                
            } catch (err: any) {
                console.error(err)
                setGameError(err.message)
            } finally {
                setIsGameLoading(false)
            }
        }

        const handleScratchComplete = () => {
            setScratchCardPlayed(true)
        }

        return (
            <div className="relative w-full h-full">
                {/* Play Button Overlay */}
                {!scratchResult && !isGameLoading && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/10 backdrop-blur-[1px] rounded-xl">
                        <Button 
                            onClick={handlePlay}
                            className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg shadow-lg animate-bounce"
                        >
                            PLAY NOW
                        </Button>
                    </div>
                )}

                {/* Loading Overlay */}
                {isGameLoading && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/80 rounded-xl">
                        <div className="w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-sm font-medium text-gray-600">Loading...</span>
                    </div>
                )}

                {/* Error Overlay */}
                {gameError && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/90 rounded-xl p-4 text-center">
                        <XCircle className="w-8 h-8 text-red-500 mb-2" />
                        <p className="text-sm font-medium text-red-600 mb-2">{gameError}</p>
                        <Button size="sm" variant="outline" onClick={() => setGameError(null)}>Try Again</Button>
                    </div>
                )}

                <ScratchCanvas
                    isRevealed={scratchCardPlayed}
                    onScratchComplete={handleScratchComplete}
                    overlayColor="#d1d5db"
                    brushSize={40}
                    className={(!scratchResult && !isGameLoading) ? "pointer-events-none" : ""}
                >
                    <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-white relative select-none">
                        {/* Reward Content */}
                        {scratchResult ? (
                            <div className="animate-in zoom-in duration-500 flex flex-col items-center w-full">
                                {/* Reward Image */}
                                <div className="relative w-24 h-24 mb-2 flex-shrink-0">
                                    {scratchResult.reward?.type === 'product' && scratchResult.reward.image_url ? (
                                        <Image src={scratchResult.reward.image_url} alt="Reward" fill className="object-contain drop-shadow-md" />
                                    ) : scratchResult.reward?.type === 'points' ? (
                                        <div className="w-full h-full flex items-center justify-center bg-yellow-50 rounded-full">
                                            <Coins className="w-12 h-12 text-yellow-500" />
                                        </div>
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-full">
                                            <Gift className="w-12 h-12 text-gray-300" />
                                        </div>
                                    )}
                                </div>

                                {scratchResult.result === 'win' ? (
                                    <>
                                        <h3 className="text-lg font-bold text-gray-900 leading-tight mb-1">
                                            {scratchResult.reward?.type === 'product' ? scratchResult.reward.name : 'CONGRATS!'}
                                        </h3>
                                        <p className="text-xs font-medium text-gray-600 line-clamp-2">{scratchResult.message}</p>
                                        {scratchResult.reward?.type === 'points' && (
                                            <Badge variant="secondary" className="mt-1 bg-yellow-100 text-yellow-800">
                                                +{scratchResult.reward.value} Points
                                            </Badge>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <h3 className="text-lg font-bold text-gray-800 mb-1">Oh no!</h3>
                                        <p className="text-xs text-gray-600">{scratchResult.message}</p>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="text-gray-400 font-medium text-xs animate-pulse mt-1">
                                Prize hidden here...
                            </div>
                        )}
                    </div>
                </ScratchCanvas>
            </div>
        )
    }

    function renderCurrentPage() {
        switch (currentPage) {
            case 'welcome':
                return renderWelcomePage()
            case 'collect-points':
                return renderCollectPointsPage()
            case 'lucky-draw':
                return renderLuckyDrawPage()
            case 'redeem-gift':
                return renderRedeemGiftPage()
            case 'scratch-card-game':
                return renderScratchCardGamePage()
            case 'thank-you':
                return renderThankYouPage()
            default:
                return renderWelcomePage()
        }
    }

    // Full-screen mobile view (for actual mobile users scanning QR codes)
    if (fullScreen) {
        return (
            <div className="min-h-screen bg-gray-50 overflow-y-auto">
                {renderCurrentPage()}
            </div>
        )
    }

    // Desktop preview with phone frame mockup
    return (
        <Card className="will-change-transform">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Smartphone className="w-4 h-4" />
                    Interactive Mobile Preview
                </CardTitle>
                <p className="text-xs text-gray-600">Click buttons to experience the user journey</p>
            </CardHeader>
            <CardContent>
                {/* Mobile Frame */}
                <div className="relative mx-auto" style={{ width: '300px', height: '600px' }}>
                    {/* Phone Frame */}
                    <div className="absolute inset-0 border-8 border-gray-800 rounded-[40px] bg-white shadow-2xl overflow-hidden">
                        {/* Status Bar */}
                        <div className="h-6 bg-gray-800 flex items-center justify-between px-4 relative z-10">
                            <span className="text-white text-xs">9:41</span>
                            <div className="flex gap-1">
                                <div className="w-4 h-3 bg-white rounded-sm"></div>
                                <div className="w-1 h-3 bg-white rounded-sm"></div>
                            </div>
                        </div>

                        {/* Notch */}
                        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-32 h-6 bg-gray-800 rounded-b-3xl z-20"></div>

                        {/* App Content */}
                        <div className="h-full bg-gray-50 overflow-y-auto scroll-smooth pb-20" style={{ paddingTop: '10px' }}>
                            {renderCurrentPage()}
                        </div>

                        {/* Home Indicator */}
                        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gray-800 rounded-full"></div>
                    </div>
                </div>

                {/* Page Indicator */}
                <div className="mt-4 text-center">
                    <p className="text-xs text-gray-600">
                        Current Page: <span className="font-semibold capitalize">{currentPage.replace('-', ' ')}</span>
                    </p>
                </div>
            </CardContent>
        </Card>
    )
}
