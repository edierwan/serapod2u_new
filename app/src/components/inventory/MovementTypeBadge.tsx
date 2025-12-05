import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface MovementTypeBadgeProps {
  type: string
}

/**
 * Reusable neutral badge for movement types.
 * Always renders a neutral/secondary badge (light grey pill) and only changes the label text.
 * Matches existing Adj badge typography and padding exactly.
 */
export default function MovementTypeBadge({ type }: MovementTypeBadgeProps) {
  const labelMap: Record<string, { label: string; title: string }> = {
    'addition': { label: 'Add', title: 'Addition' },
    'adjustment': { label: 'Adj', title: 'Adjustment' },
    'transfer_out': { label: 'Xfer↑', title: 'Transfer Out' },
    'transfer_in': { label: 'Xfer↓', title: 'Transfer In' },
    'allocation': { label: 'Alloc', title: 'Allocated' },
    'deallocation': { label: 'Dealloc', title: 'Deallocated' },
    'order_fulfillment': { label: 'Order', title: 'Order Fulfillment' },
    'order_cancelled': { label: 'Cxl', title: 'Cancelled' },
    'manual_in': { label: 'M-In', title: 'Manual In' },
    'manual_out': { label: 'M-Out', title: 'Manual Out' },
    'scratch_game_out': { label: 'SG-', title: 'Scratch Game Out' },
    'scratch_game_in': { label: 'SG+', title: 'Scratch Game In' }
  }

  const resolved = labelMap[type] || { label: type, title: type }

  // NOTE: Always use a neutral / secondary badge style so all movement types look identical
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 font-medium cursor-default`}>{resolved.label}</Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{resolved.title}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
