'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Smartphone, Coins, Star, Gift, CheckCircle2 } from 'lucide-react'

interface JourneyConfig {
    welcome_title: string
    welcome_message: string
    thank_you_message: string
    primary_color: string
    button_color: string
    points_enabled: boolean
    lucky_draw_enabled: boolean
    redemption_enabled: boolean
}

export default function JourneyMobilePreviewV2({ config }: { config: JourneyConfig }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Smartphone className="w-4 h-4" />
                    Live Mobile Preview
                </CardTitle>
            </CardHeader>
            <CardContent>
                {/* Mobile Frame */}
                <div className="relative mx-auto" style={{ width: '300px', height: '600px' }}>
                    {/* Phone Frame */}
                    <div className="absolute inset-0 border-8 border-gray-800 rounded-[40px] bg-white shadow-2xl overflow-hidden">
                        {/* Status Bar */}
                        <div className="h-6 bg-gray-800 flex items-center justify-between px-4">
                            <span className="text-white text-xs">9:41</span>
                            <div className="flex gap-1">
                                <div className="w-4 h-3 bg-white rounded-sm"></div>
                                <div className="w-1 h-3 bg-white rounded-sm"></div>
                            </div>
                        </div>

                        {/* Notch */}
                        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-32 h-6 bg-gray-800 rounded-b-3xl"></div>

                        {/* App Content */}
                        <div className="h-full bg-gray-50 overflow-y-auto pb-20" style={{ paddingTop: '10px' }}>
                            {/* Header with Primary Color */}
                            <div
                                className="px-4 py-6 text-white"
                                style={{ backgroundColor: config.primary_color }}
                            >
                                <h1 className="text-xl font-bold text-center">
                                    {config.welcome_title || 'Welcome!'}
                                </h1>
                                <p className="text-sm text-center mt-2 opacity-90">
                                    {config.welcome_message || 'Thank you for scanning our QR code!'}
                                </p>
                            </div>

                            {/* Features Section */}
                            <div className="px-4 py-4 space-y-3">
                                {/* Points */}
                                {config.points_enabled && (
                                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
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
                                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                                        </div>
                                        <button
                                            className="w-full mt-3 py-2 px-4 text-white text-sm font-medium rounded-lg transition-colors"
                                            style={{ backgroundColor: config.button_color }}
                                        >
                                            Collect Points
                                        </button>
                                    </div>
                                )}

                                {/* Lucky Draw */}
                                {config.lucky_draw_enabled && (
                                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
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
                                        </div>
                                        <button
                                            className="w-full mt-3 py-2 px-4 text-white text-sm font-medium rounded-lg transition-colors"
                                            style={{ backgroundColor: config.button_color }}
                                        >
                                            Enter Lucky Draw
                                        </button>
                                    </div>
                                )}

                                {/* Redemption */}
                                {config.redemption_enabled && (
                                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
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
                                        </div>
                                        <button
                                            className="w-full mt-3 py-2 px-4 text-white text-sm font-medium rounded-lg transition-colors"
                                            style={{ backgroundColor: config.button_color }}
                                        >
                                            Claim Your Gift
                                        </button>
                                    </div>
                                )}

                                {/* No Features Message */}
                                {!config.points_enabled && !config.lucky_draw_enabled && !config.redemption_enabled && (
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                                        <p className="text-sm text-yellow-700">
                                            No features enabled. Enable at least one feature to create a journey.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Thank You Message */}
                            {(config.points_enabled || config.lucky_draw_enabled || config.redemption_enabled) && (
                                <div className="px-4 py-4">
                                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                                        <p className="text-sm text-gray-700 text-center">
                                            {config.thank_you_message || 'Thank you for your participation!'}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Home Indicator */}
                        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gray-800 rounded-full"></div>
                    </div>
                </div>

                {/* Preview Info */}
                <div className="mt-4 space-y-2">
                    <div className="text-xs text-gray-600 text-center">
                        <p className="font-medium">Preview shows how consumers will see your journey</p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center">
                        {config.points_enabled && (
                            <Badge variant="outline" className="text-xs">
                                <Coins className="w-3 h-3 mr-1" />
                                Points
                            </Badge>
                        )}
                        {config.lucky_draw_enabled && (
                            <Badge variant="outline" className="text-xs">
                                <Star className="w-3 h-3 mr-1" />
                                Lucky Draw
                            </Badge>
                        )}
                        {config.redemption_enabled && (
                            <Badge variant="outline" className="text-xs">
                                <Gift className="w-3 h-3 mr-1" />
                                Redemption
                            </Badge>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
