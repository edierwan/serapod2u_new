'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Palette } from 'lucide-react'

interface JourneyThemeEditorProps {
  journeyId: string
}

export default function JourneyThemeEditor({ journeyId }: JourneyThemeEditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme Settings</CardTitle>
        <p className="text-sm text-gray-500">Customize colors and branding</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Primary Color</Label>
            <div className="flex gap-2 mt-1">
              <Input type="color" value="#3B82F6" className="w-16 h-10" />
              <Input value="#3B82F6" className="flex-1" />
            </div>
          </div>
          <div>
            <Label>Secondary Color</Label>
            <div className="flex gap-2 mt-1">
              <Input type="color" value="#8B5CF6" className="w-16 h-10" />
              <Input value="#8B5CF6" className="flex-1" />
            </div>
          </div>
        </div>

        <Button className="w-full">
          <Palette className="w-4 h-4 mr-2" />
          Save Theme
        </Button>
      </CardContent>
    </Card>
  )
}
