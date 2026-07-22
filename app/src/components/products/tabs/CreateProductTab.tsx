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
    <Card className="sera-sc-panel overflow-hidden shadow-none">
      <CardContent className="p-12 text-center space-y-6">
        <h3 className="font-display text-lg font-semibold text-[var(--sera-ink)]">Create New Product</h3>
        <p className="text-[var(--sera-muted)] mb-6">
          After setting up master data (Categories, Brands, Groups, Sub-groups), you can create products here
        </p>

        <div className="rounded-2xl border border-[var(--sera-orange)]/20 bg-[var(--sera-orange)]/[0.06] p-8 space-y-4 text-left max-w-md mx-auto">
          <p className="text-sm text-[var(--sera-ink)]/80">✓ Master data setup form (Categories, Brands, Groups, Sub-groups)</p>
          <p className="text-sm text-[var(--sera-ink)]/80">✓ Product creation with variants</p>
          <p className="text-sm text-[var(--sera-ink)]/80">✓ Pricing configuration</p>
          <p className="text-sm text-[var(--sera-ink)]/80">✓ Integration with inventory</p>
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
