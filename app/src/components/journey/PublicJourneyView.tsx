'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  AlertCircle, 
  CheckCircle2, 
  Smartphone,
  Loader2,
  Shield,
  XCircle
} from 'lucide-react'
import InteractiveMobilePreviewV2 from './InteractiveMobilePreviewV2'

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

interface VerificationData {
  is_valid: boolean
  is_blocked: boolean
  journey_config?: JourneyConfig
  product_info?: {
    product_name?: string
    variant_name?: string
    brand_name?: string
  }
  order_info?: {
    order_no?: string
  }
  message?: string
}

interface PublicJourneyViewProps {
  code: string
  verificationResult: {
    success: boolean
    data?: VerificationData
    error?: string
  }
}

export default function PublicJourneyView({ 
  code, 
  verificationResult 
}: PublicJourneyViewProps) {
  const [isLoading, setIsLoading] = useState(false)

  // Handle invalid or blocked codes
  if (!verificationResult.success || verificationResult.error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <CardTitle className="text-red-900">Verification Failed</CardTitle>
                <p className="text-sm text-red-600 mt-1">Unable to verify this code</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-red-50 border border-red-200 p-4">
              <p className="text-sm text-red-800">
                <strong>Error:</strong> {verificationResult.error || 'Unknown error occurred'}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
              <p className="text-xs text-gray-600 font-mono break-all">
                Code: {code}
              </p>
            </div>
            <div className="text-center text-sm text-gray-600 space-y-2">
              <p>This could mean:</p>
              <ul className="text-left space-y-1 pl-6 list-disc">
                <li>The QR code is invalid or expired</li>
                <li>The code has been blocked</li>
                <li>Network connectivity issues</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const data = verificationResult.data

  // Handle blocked codes
  if (data?.is_blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-yellow-600" />
              </div>
              <div>
                <CardTitle className="text-yellow-900">Code Blocked</CardTitle>
                <p className="text-sm text-yellow-600 mt-1">This code has been blocked</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4">
              <p className="text-sm text-yellow-800">
                {data.message || 'This QR code has been flagged and blocked from use.'}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
              <p className="text-xs text-gray-600 font-mono break-all">
                Code: {code}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-600">
                Please contact support if you believe this is an error.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Handle invalid codes (not blocked, but not valid)
  if (!data?.is_valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-gray-600" />
              </div>
              <div>
                <CardTitle className="text-gray-900">Invalid Code</CardTitle>
                <p className="text-sm text-gray-600 mt-1">Code not recognized</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
              <p className="text-sm text-gray-700">
                The QR code you scanned is not recognized in our system.
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
              <p className="text-xs text-gray-600 font-mono break-all">
                Code: {code}
              </p>
            </div>
            <div className="text-center text-sm text-gray-600 space-y-2">
              <p>Possible reasons:</p>
              <ul className="text-left space-y-1 pl-6 list-disc">
                <li>QR code not yet activated</li>
                <li>Invalid or corrupted code</li>
                <li>Code from a different system</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Valid code - Show Journey Builder
  const defaultConfig: JourneyConfig = {
    welcome_title: 'Welcome!',
    welcome_message: 'Thank you for scanning this product',
    thank_you_message: 'Thank you for your participation!',
    primary_color: '#2563eb',
    button_color: '#3b82f6',
    points_enabled: true,
    lucky_draw_enabled: true,
    redemption_enabled: true,
    show_product_image: true,
    product_image_source: 'genuine_badge',
    genuine_badge_style: 'gold'
  }

  const journeyConfig = data.journey_config || defaultConfig

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header Banner */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <Shield className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Authentic Product Verified</h1>
                <p className="text-sm text-gray-600">
                  {data.product_info?.product_name || 'Product'} - {data.product_info?.variant_name || 'Verified'}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="hidden sm:flex bg-green-50 text-green-700 border-green-300">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Genuine
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Left: Product Info & Instructions */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-blue-600" />
                  Your Consumer Journey
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                  <h3 className="font-semibold text-blue-900 mb-2">
                    Welcome to an interactive experience!
                  </h3>
                  <p className="text-sm text-blue-700">
                    This QR code unlocks exclusive features designed just for you.
                    Explore the mobile preview to see what's available.
                  </p>
                </div>

                {/* Feature List */}
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">Available Features:</h4>
                  
                  {journeyConfig.points_enabled && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">
                        <CheckCircle2 className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-purple-900">Collect Points</p>
                        <p className="text-xs text-purple-700">
                          Earn rewards points for scanning authentic products
                        </p>
                      </div>
                    </div>
                  )}

                  {journeyConfig.lucky_draw_enabled && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-600 flex items-center justify-center">
                        <CheckCircle2 className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-yellow-900">Lucky Draw</p>
                        <p className="text-xs text-yellow-700">
                          Enter for a chance to win exciting prizes
                        </p>
                      </div>
                    </div>
                  )}

                  {journeyConfig.redemption_enabled && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                        <CheckCircle2 className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-green-900">Redeem Gifts</p>
                        <p className="text-xs text-green-700">
                          Exchange your points for exclusive rewards
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Product Details */}
                {data.product_info && (
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-2">
                    <h4 className="font-medium text-gray-900 mb-3">Product Details</h4>
                    {data.product_info.product_name && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Product:</span>
                        <span className="font-medium text-gray-900">{data.product_info.product_name}</span>
                      </div>
                    )}
                    {data.product_info.variant_name && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Variant:</span>
                        <span className="font-medium text-gray-900">{data.product_info.variant_name}</span>
                      </div>
                    )}
                    {data.product_info.brand_name && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Brand:</span>
                        <span className="font-medium text-gray-900">{data.product_info.brand_name}</span>
                      </div>
                    )}
                    {data.order_info?.order_no && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Order:</span>
                        <span className="font-mono text-xs text-gray-900">{data.order_info.order_no}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Code Display */}
                <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Scanned Code:</p>
                  <p className="text-xs text-gray-900 font-mono break-all">{code}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Mobile Preview */}
          <div className="lg:sticky lg:top-8">
            <Card className="overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5" />
                  Live Interactive Preview
                </CardTitle>
                <p className="text-sm text-blue-100 mt-1">
                  This is how consumers will experience your product journey
                </p>
              </CardHeader>
              <CardContent className="p-0 bg-gray-900">
                {/* Mobile Phone Frame */}
                <div className="flex justify-center py-8">
                  <div className="relative">
                    {/* Phone Frame */}
                    <div className="w-[375px] h-[667px] bg-white rounded-[3rem] shadow-2xl border-[14px] border-gray-800 overflow-hidden">
                      {/* Notch */}
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-40 h-6 bg-gray-800 rounded-b-3xl z-10" />
                      
                      {/* Screen Content */}
                      <div className="h-full overflow-y-auto scrollbar-hide">
                        <InteractiveMobilePreviewV2 config={journeyConfig} />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
