'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Upload, X, Image as ImageIcon } from 'lucide-react'
import { compressProductImage, formatFileSize, type CompressionResult } from '@/lib/utils/imageCompression'
import { useToast } from '@/components/ui/use-toast'

interface ImageUploadProps {
  currentImageUrl?: string | null
  onImageSelect: (file: File) => void
  onImageRemove?: () => void
  label?: string
  maxWidth?: number
  maxHeight?: number
  quality?: number
  className?: string
}

export default function ImageUpload({
  currentImageUrl,
  onImageSelect,
  onImageRemove,
  label = 'Upload Image',
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.8,
  className = ''
}: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(currentImageUrl || null)
  const [compressionInfo, setCompressionInfo] = useState<CompressionResult | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid File',
        description: 'Please select an image file',
        variant: 'destructive'
      })
      return
    }

    // Validate file size (max 10MB before compression)
    const maxSizeInMB = 10
    if (file.size > maxSizeInMB * 1024 * 1024) {
      toast({
        title: 'File Too Large',
        description: `Please select an image smaller than ${maxSizeInMB}MB`,
        variant: 'destructive'
      })
      return
    }

    try {
      setIsCompressing(true)
      
      // Compress the image
      const result = await compressProductImage(file)
      setCompressionInfo(result)
      
      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreview(reader.result as string)
      }
      reader.readAsDataURL(result.file)
      
      // Call parent handler with compressed file
      onImageSelect(result.file)
      
      toast({
        title: 'Image Compressed',
        description: `Reduced from ${formatFileSize(result.originalSize)} to ${formatFileSize(result.compressedSize)} (${result.compressionRatio.toFixed(1)}% smaller)`,
        variant: 'default'
      })
    } catch (error) {
      console.error('Error compressing image:', error)
      toast({
        title: 'Compression Failed',
        description: 'Failed to compress image. Please try a different file.',
        variant: 'destructive'
      })
    } finally {
      setIsCompressing(false)
    }
  }

  const handleRemove = () => {
    setPreview(null)
    setCompressionInfo(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onImageRemove?.()
  }

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <label className="text-sm font-medium text-gray-700">{label}</label>
      
      <Card className="relative overflow-hidden border-2 border-dashed border-gray-300 hover:border-gray-400 transition-colors">
        <div className="aspect-square w-full max-w-md mx-auto">
          {preview ? (
            <div className="relative w-full h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Preview"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleClick}
                  className="bg-white/90 hover:bg-white"
                >
                  <Upload className="h-4 w-4 mr-1" />
                  Change
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={handleRemove}
                  className="bg-red-500/90 hover:bg-red-600"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {compressionInfo && (
                <div className="absolute bottom-2 left-2 right-2 bg-black/70 text-white text-xs rounded px-2 py-1">
                  <div className="flex justify-between">
                    <span>Compressed:</span>
                    <span className="font-medium">{formatFileSize(compressionInfo.compressedSize)}</span>
                  </div>
                  <div className="flex justify-between text-green-300">
                    <span>Saved:</span>
                    <span>{compressionInfo.compressionRatio.toFixed(1)}%</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleClick}
              disabled={isCompressing}
              className="w-full h-full flex flex-col items-center justify-center gap-3 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {isCompressing ? (
                <>
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900" />
                  <span className="text-sm">Compressing image...</span>
                </>
              ) : (
                <>
                  <ImageIcon className="h-12 w-12" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Click to upload image</p>
                    <p className="text-xs text-gray-400 mt-1">
                      PNG, JPG, GIF up to 10MB
                    </p>
                    <p className="text-xs text-gray-400">
                      (Image will be automatically compressed)
                    </p>
                  </div>
                </>
              )}
            </button>
          )}
        </div>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  )
}
