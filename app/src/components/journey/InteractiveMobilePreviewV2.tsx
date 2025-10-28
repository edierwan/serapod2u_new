'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Smartphone, Coins, Star, Gift, CheckCircle2, ArrowLeft, X } from 'lucide-react'

interface JourneyConfig {
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
}

type PageType = 'welcome' | 'collect-points' | 'lucky-draw' | 'redeem-gift' | 'thank-you'

export default function InteractiveMobilePreviewV2({ config }: { config: JourneyConfig }) {
    const [currentPage, setCurrentPage] = useState<PageType>('welcome')
    const [pointsCollected, setPointsCollected] = useState(false)
    const [luckyDrawEntered, setLuckyDrawEntered] = useState(false)
    const [giftRedeemed, setGiftRedeemed] = useState(false)

    // Form states
    const [userId, setUserId] = useState('')
    const [password, setPassword] = useState('')
    const [customerName, setCustomerName] = useState('')
    const [customerPhone, setCustomerPhone] = useState('')
    const [customerEmail, setCustomerEmail] = useState('')
    const [totalPoints, setTotalPoints] = useState(0)
    const [cumulativePoints, setCumulativePoints] = useState(0)

    function handleCollectPoints() {
        if (!userId || !password) {
            alert('Please enter User ID and Password')
            return
        }
        // Simulate points collection
        const earnedPoints = Math.floor(Math.random() * 50) + 50 // 50-100 points
        setTotalPoints(earnedPoints)
        setCumulativePoints(cumulativePoints + earnedPoints)
        setPointsCollected(true)
    }

    function handleLuckyDrawEntry() {
        if (!customerName || !customerPhone) {
            alert('Please enter Name and Phone')
            return
        }
        setLuckyDrawEntered(true)
    }

    function handleGiftRedeem() {
        setGiftRedeemed(true)
    }

    function renderWelcomePage() {
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
                                ) : config.product_image_source === 'custom' && config.custom_image_url ? (
                                    <div className="inline-block mb-2">
                                        <Image 
                                            src={config.custom_image_url} 
                                            alt="Product" 
                                            width={96}
                                            height={96}
                                            className="object-contain rounded-lg bg-white p-2"
                                        />
                                    </div>
                                ) : (
                                    <div className="inline-block mb-2">
                                        <div className="w-24 h-24 bg-white bg-opacity-30 rounded-lg flex items-center justify-center">
                                            <Gift className="w-12 h-12 text-white" />
                                        </div>
                                        <p className="text-xs mt-1 opacity-75">Product Variant Image</p>
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
                            onClick={() => setCurrentPage('collect-points')}
                            className="w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:border-blue-300 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="p-3 rounded-full"
                                    style={{ backgroundColor: `${config.primary_color}20` }}
                                >
                                    <Coins className="w-5 h-5" style={{ color: config.primary_color }} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-sm">Collect Points</h3>
                                    <p className="text-xs text-gray-600">Earn rewards with every scan</p>
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
                                    <Star className="w-5 h-5" style={{ color: config.primary_color }} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-sm">Lucky Draw</h3>
                                    <p className="text-xs text-gray-600">Try your luck and win prizes!</p>
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
                            onClick={() => setCurrentPage('redeem-gift')}
                            className="w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:border-green-300 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="p-3 rounded-full"
                                    style={{ backgroundColor: `${config.primary_color}20` }}
                                >
                                    <Gift className="w-5 h-5" style={{ color: config.primary_color }} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-sm">Claim Free Gift</h3>
                                    <p className="text-xs text-gray-600">Get your free gift at the shop</p>
                                </div>
                                {giftRedeemed && (
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
                                    <p className="text-sm text-gray-600">Total Cumulative Points</p>
                                    <p className="text-3xl font-bold text-blue-600">{cumulativePoints}</p>
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
                            <Label className="text-sm">User ID / Phone Number</Label>
                            <Input
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                placeholder="Enter your user ID"
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
                        className="w-full py-3 px-4 text-white font-medium rounded-lg"
                        style={{ backgroundColor: config.button_color }}
                    >
                        Collect Points
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

        return (
            <>
                <div className="flex items-center gap-3 px-4 py-3 border-b">
                    <button onClick={() => setCurrentPage('welcome')}>
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h2 className="font-semibold">Lucky Draw</h2>
                </div>
                <div className="px-4 py-6 space-y-4">
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
                        <Star className="w-12 h-12 text-purple-600 mx-auto mb-2" />
                        <p className="text-sm text-purple-800">Enter your details to participate</p>
                    </div>

                    <div className="space-y-4">
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

                            {/* Gift Image Placeholder */}
                            <div className="bg-white border-2 border-green-300 rounded-lg p-4 mb-4">
                                <div className="w-32 h-32 mx-auto bg-gray-100 rounded-lg flex items-center justify-center">
                                    <Gift className="w-16 h-16 text-gray-400" />
                                </div>
                                <p className="mt-3 font-semibold text-gray-800">Premium Gift Item</p>
                                <p className="text-xs text-gray-600 mt-1">Limited Time Offer</p>
                            </div>

                            <div className="bg-white border border-green-200 rounded p-3">
                                <p className="text-xs text-gray-600">Redemption Code</p>
                                <p className="text-lg font-mono font-bold text-gray-800">GFT-{Math.random().toString(36).substr(2, 6).toUpperCase()}</p>
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
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                        <Gift className="w-12 h-12 text-green-600 mx-auto mb-2" />
                        <p className="text-sm text-green-800 font-medium">You have a free gift waiting!</p>
                    </div>

                    {/* Gift Preview */}
                    <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                        <div className="w-full h-40 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
                            <Gift className="w-20 h-20 text-gray-400" />
                        </div>
                        <h3 className="font-semibold text-center">Premium Gift Item</h3>
                        <p className="text-xs text-gray-600 text-center mt-1">Click below to claim your gift</p>
                    </div>

                    <button
                        onClick={handleGiftRedeem}
                        className="w-full py-3 px-4 text-white font-medium rounded-lg"
                        style={{ backgroundColor: config.button_color }}
                    >
                        Claim Gift Now
                    </button>

                    <p className="text-xs text-gray-500 text-center">
                        Show the redemption screen to shop staff to receive your gift
                    </p>
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
            case 'thank-you':
                return renderThankYouPage()
            default:
                return renderWelcomePage()
        }
    }

    return (
        <Card>
            <CardHeader>
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
                        <div className="h-full bg-gray-50 overflow-y-auto pb-20" style={{ paddingTop: '10px' }}>
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
