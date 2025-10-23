'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Smartphone, PartyPopper } from 'lucide-react'

interface MobilePreviewProps {
  journeyId?: string
}

export default function MobilePreview({ journeyId }: MobilePreviewProps) {
  if (!journeyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            Mobile Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Smartphone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-sm">
              Select a journey to preview
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          Mobile Preview
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Mobile Phone Frame */}
        <div className="relative mx-auto" style={{ width: '340px' }}>
          {/* Phone Frame */}
          <div className="relative bg-gray-900 rounded-[3rem] p-3 shadow-2xl">
            {/* Notch */}
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-40 h-7 bg-gray-900 rounded-b-3xl z-10"></div>
            
            {/* Screen */}
            <div className="relative bg-white rounded-[2.5rem] overflow-hidden" style={{ height: '600px' }}>
              {/* Status Bar */}
              <div className="bg-gray-900 h-12 flex items-center justify-between px-8 text-white text-xs">
                <span>9:41</span>
                <div className="flex gap-1">
                  <div className="w-4 h-4 bg-white rounded-sm"></div>
                  <div className="w-4 h-4 bg-white rounded-sm"></div>
                  <div className="w-4 h-4 bg-white rounded-sm"></div>
                </div>
              </div>

              {/* Content Area */}
              <div className="h-full bg-gradient-to-b from-blue-50 to-white p-6 overflow-y-auto">
                {/* Congratulations Screen */}
                <div className="text-center space-y-4">
                  <div className="text-6xl mb-4">
                    <PartyPopper className="w-16 h-16 text-purple-600 mx-auto" />
                  </div>
                  
                  <h1 className="text-2xl font-bold text-purple-600">
                    Congratulations!
                  </h1>
                  
                  <p className="text-gray-600">
                    You've purchased <strong>[Product Name]</strong>
                  </p>

                  {/* Product Image Placeholder */}
                  <div className="bg-gray-200 rounded-lg h-40 flex items-center justify-center text-gray-400">
                    Product Image
                  </div>

                  {/* Verification Section */}
                  <div className="bg-white rounded-lg shadow-sm p-4 space-y-2 text-left">
                    <h3 className="font-semibold text-gray-900">Verify Your Purchase</h3>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Order ID:</span>
                        <span className="font-medium">Sample Value</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Product:</span>
                        <span className="font-medium">Sample Value</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Purchase Date:</span>
                        <span className="font-medium">Sample Value</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 italic mt-2">
                      Verification data will appear here
                    </p>
                  </div>

                  {/* CTA Button */}
                  <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white py-6 text-lg rounded-xl">
                    Claim Your Rewards
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
