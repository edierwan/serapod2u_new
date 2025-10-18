'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

interface CreateProductTabProps {
  userProfile: any
  onViewChange?: (view: string) => void
  onRefresh: () => void
}

export default function CreateProductTab({ userProfile, onViewChange, onRefresh }: CreateProductTabProps) {
  return (
    <Card>
      <CardContent className="p-12 text-center space-y-6">
        <h3 className="text-lg font-semibold text-gray-900">Create New Product</h3>
        <p className="text-gray-600 mb-6">After setting up master data (Categories, Brands, Groups, Sub-groups), you can create products here</p>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 space-y-4">
          <p className="text-sm text-gray-700">✓ Master data setup form (Categories, Brands, Groups, Sub-groups)</p>
          <p className="text-sm text-gray-700">✓ Product creation with variants</p>
          <p className="text-sm text-gray-700">✓ Pricing configuration</p>
          <p className="text-sm text-gray-700">✓ Integration with inventory</p>
        </div>

        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => onViewChange?.('products')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Products
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
