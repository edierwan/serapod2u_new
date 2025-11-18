'use client'

import { useState, useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Upload, X, Building2 } from 'lucide-react'

// Image compression utility for organization logos
// Logos are displayed small (~100-150px), so we compress to ~5-10KB
const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height
        
        // Logo dimensions - small size for optimal storage
        const MAX_WIDTH = 200
        const MAX_HEIGHT = 200
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width)
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height)
            height = MAX_HEIGHT
          }
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)
        
        // Convert to JPEG with compression (quality 0.6 = 60%)
        // This targets ~5-10KB file size for logos
        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Create a new File object with compressed blob
              const compressedFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
                type: 'image/jpeg',
                lastModified: Date.now(),
              })
              console.log(`🏢 Logo compressed: ${(file.size / 1024).toFixed(2)}KB → ${(compressedFile.size / 1024).toFixed(2)}KB`)
              console.log(`✅ Logo optimized for storage (target: ~5-10KB)`)
              resolve(compressedFile)
            } else {
              reject(new Error('Canvas to Blob conversion failed'))
            }
          },
          'image/jpeg',
          0.6 // 60% quality = smaller file size, perfect for small logos
        )
      }
      img.onerror = () => reject(new Error('Image loading failed'))
    }
    reader.onerror = () => reject(new Error('File reading failed'))
  })
}

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

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      onLogoChange(null)
      return
    }

    // Check for AVIF format - not supported by Supabase Storage
    if (file.type === 'image/avif') {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      onLogoChange(null)
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      onLogoChange(null)
      return
    }

    try {
      // Compress the image before upload
      const compressedFile = await compressImage(file)
      
      // Create preview from compressed file
      const reader = new FileReader()
      reader.onloadend = () => {
        setLogoPreview(reader.result as string)
      }
      reader.readAsDataURL(compressedFile)
      
      onLogoChange(compressedFile)
    } catch (error) {
      console.error('Error compressing logo:', error)
      // If compression fails, use original file
      const reader = new FileReader()
      reader.onloadend = () => {
        setLogoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      onLogoChange(file)
    }
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
          {logoPreview ? (
            <AvatarImage 
              src={logoPreview} 
              alt="Organization logo"
              className="object-cover"
            />
          ) : (
            <AvatarFallback className="rounded-lg bg-gradient-to-br from-blue-100 to-blue-50 text-blue-600">
              <Building2 className="w-10 h-10" />
            </AvatarFallback>
          )}
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
              {logoPreview ? 'Change Logo' : 'Upload Logo'}
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
          <p className="text-xs text-blue-600">
            ✨ Images will be automatically compressed to ~5-10KB (200×200px JPEG) for optimal performance
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
