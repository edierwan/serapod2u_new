'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FileText } from 'lucide-react'

interface JourneyPageEditorProps {
  journeyId: string
}

export default function JourneyPageEditor({ journeyId }: JourneyPageEditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Page Editor</CardTitle>
        <p className="text-sm text-gray-500">Edit individual pages in the Page Editor tab</p>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Select a Page to Edit
          </h3>
          <p className="text-gray-500 text-sm mb-4">
            Choose a page from the Pages tab to customize its content
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
