'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, GripVertical, Eye, EyeOff, Settings } from 'lucide-react'

interface JourneyPage {
  id: number
  name: string
  slug: string
  enabled: boolean
  sections: number
  buttons: number
}

interface JourneyPagesPanelProps {
  journeyId: string
}

export default function JourneyPagesPanel({ journeyId }: JourneyPagesPanelProps) {
  const [pages, setPages] = useState<JourneyPage[]>([
    { id: 1, name: 'Welcome Page', slug: 'welcome', enabled: true, sections: 1, buttons: 1 },
    { id: 2, name: 'User Registration', slug: 'registration', enabled: true, sections: 1, buttons: 1 },
    { id: 3, name: 'Rewards Overview', slug: 'rewards_overview', enabled: true, sections: 1, buttons: 2 },
    { id: 4, name: 'Lucky Draw Entry', slug: 'lucky_draw', enabled: true, sections: 1, buttons: 1 },
    { id: 5, name: 'Success Page', slug: 'success', enabled: true, sections: 1, buttons: 1 },
  ])

  const togglePageEnabled = (pageId: number) => {
    setPages(pages.map(p => p.id === pageId ? { ...p, enabled: !p.enabled } : p))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Journey Pages</CardTitle>
          <Button size="sm" variant="outline">
            <Plus className="w-4 h-4 mr-1" />
            Add Page
          </Button>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Total Pages: <span className="font-medium">{pages.length}</span> | 
          Enabled: <span className="font-medium text-green-600">{pages.filter(p => p.enabled).length}</span>
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {pages.map((page, index) => (
          <div
            key={page.id}
            className="flex items-center gap-3 p-3 rounded-lg border bg-white hover:shadow-sm transition-shadow"
          >
            <GripVertical className="w-4 h-4 text-gray-400 cursor-move" />
            
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-gray-500">{index + 1}</span>
                <h4 className="font-medium text-gray-900">{page.name}</h4>
                <Badge 
                  variant="outline" 
                  className={page.enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500'}
                >
                  {page.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <p className="text-xs text-gray-500">
                {page.slug} • {page.sections} sections • {page.buttons} buttons
              </p>
            </div>

            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => togglePageEnabled(page.id)}
                className="h-8 w-8 p-0"
              >
                {page.enabled ? (
                  <Eye className="w-4 h-4 text-green-600" />
                ) : (
                  <EyeOff className="w-4 h-4 text-gray-400" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
