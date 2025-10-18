'use client'

import { useState, useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Upload, X, Building2 } from 'lucide-react'

interface OrgLogoUploadProps {
  currentLogoUrl?: string | null
  orgName: string
  onLogoChange: (file: File | null) => void
  error?: string
}

export default function OrgLogoUpload({ 
  currentLogoUrl, 
  orgName, 
  onLogoChange,
  error 
}: OrgLogoUploadProps) {
  const [logoPreview, setLogoPreview] = useState<string | null>(currentLogoUrl || null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getInitials = (name: string) => {
    if (!name) return 'ORG'
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      onLogoChange(null)
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      onLogoChange(null)
      return
    }

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setLogoPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
    
    onLogoChange(file)
  }

  const resetLogoUpload = () => {
    setLogoPreview(currentLogoUrl || null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onLogoChange(null)
  }

  return (
    <div className="space-y-4">
      <Label>Organization Logo</Label>
      <div className="flex items-center gap-4">
        {/* Logo Preview */}
        <Avatar className="w-24 h-24 rounded-lg">
          <AvatarImage 
            src={logoPreview || undefined} 
            alt={`${orgName} logo`}
            className="object-cover"
          />
          <AvatarFallback className="rounded-lg bg-blue-100 text-blue-600 text-xl font-semibold">
            <Building2 className="w-10 h-10" />
          </AvatarFallback>
        </Avatar>

        {/* Upload Controls */}
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Logo
            </Button>
            {logoPreview && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetLogoUpload}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Recommended: Square image, max 5MB (JPG, PNG, GIF, WebP)
          </p>
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
        onChange={handleLogoChange}
        className="hidden"
      />
    </div>
  )
}
