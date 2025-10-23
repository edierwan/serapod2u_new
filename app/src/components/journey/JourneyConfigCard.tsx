'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Edit, Copy, Trash2, CheckCircle2, Gift, Trophy, Coins } from 'lucide-react'

interface JourneyConfig {
  id: string
  name: string
  is_active: boolean
  is_default: boolean
  points_enabled: boolean
  lucky_draw_enabled: boolean
  redemption_enabled: boolean
  created_at: string
}

interface JourneyConfigCardProps {
  journey: JourneyConfig
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export default function JourneyConfigCard({
  journey,
  isSelected,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete
}: JourneyConfigCardProps) {
  const totalPages = 5 // This would come from actual pages data

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        isSelected ? 'ring-2 ring-blue-600 shadow-md' : ''
      } ${journey.is_active ? '' : 'opacity-60'}`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900">{journey.name}</h3>
              {journey.is_default && (
                <Badge variant="outline" className="text-xs">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Default
                </Badge>
              )}
            </div>
            <p className="text-xs text-gray-500">{totalPages} pages</p>
          </div>
          <Badge className={journey.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
            {journey.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        {/* Feature Toggles */}
        <div className="flex gap-2 mb-3">
          {journey.points_enabled && (
            <div className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
              <Coins className="w-3 h-3" />
              <span>Points</span>
            </div>
          )}
          {journey.lucky_draw_enabled && (
            <div className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded">
              <Trophy className="w-3 h-3" />
              <span>Lucky Draw</span>
            </div>
          )}
          {journey.redemption_enabled && (
            <div className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
              <Gift className="w-3 h-3" />
              <span>Redeem</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="flex-1 h-8"
          >
            <Edit className="w-3 h-3 mr-1" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            className="h-8"
          >
            <Copy className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
