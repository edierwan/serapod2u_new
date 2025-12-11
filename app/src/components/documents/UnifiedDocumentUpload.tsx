'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Upload, File as FileIcon, X, Check, Loader2, Image as ImageIcon, Download, RefreshCw } from 'lucide-react'
import { compressImage, formatFileSize, type CompressionResult } from '@/utils/image-compression'

interface UnifiedDocumentUploadProps {
  label?: string
  description?: string
  existingFileUrl?: string | null
  onUpload: (file: File) => Promise<void>
  onDownload?: () => void
  acceptedFileTypes?: string[] // e.g. ['application/pdf', 'image/jpeg']
  maxDocSizeMB?: number
}

export default function UnifiedDocumentUpload({
  label = 'Upload Document / Image',
  description = 'PDF/DOCX max 5MB. Images will be auto-compressed.',
  existingFileUrl,
  onUpload,
  onDownload,
  acceptedFileTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp', 'image/jpg'],
  maxDocSizeMB = 5
}: UnifiedDocumentUploadProps) {
  const [isCompressing, setIsCompressing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [compressionStats, setCompressionStats] = useState<CompressionResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate type
    if (acceptedFileTypes.length > 0 && !acceptedFileTypes.includes(file.type)) {
      toast({
        title: 'Invalid File Type',
        description: 'Please upload a supported file type.',
        variant: 'destructive'
      })
      return
    }

    // Handle Document vs Image
    if (file.type.startsWith('image/')) {
      // Image: Compress
      try {
        setIsCompressing(true)
        const result = await compressImage(file)
        setCompressionStats(result)
        setSelectedFile(result.file)
      } catch (error) {
        console.error('Compression error:', error)
        toast({
          title: 'Compression Failed',
          description: 'Could not compress image. Please try another file.',
          variant: 'destructive'
        })
      } finally {
        setIsCompressing(false)
      }
    } else {
      // Document: Check size
      const maxSize = maxDocSizeMB * 1024 * 1024
      if (file.size > maxSize) {
        toast({
          title: 'File Too Large',
          description: `Document must be smaller than ${maxDocSizeMB}MB`,
          variant: 'destructive'
        })
        return
      }
      
      setCompressionStats(null)
      setSelectedFile(file)
    }
  }

  const handleUploadClick = async () => {
    if (!selectedFile) return

    try {
      setIsUploading(true)
      await onUpload(selectedFile)
      // Reset selection after successful upload
      setSelectedFile(null)
      setCompressionStats(null)
    } catch (error) {
      console.error('Upload error:', error)
      // Toast is likely handled by parent or we can add one here
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveSelection = () => {
    setSelectedFile(null)
    setCompressionStats(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // View State: File Uploaded
  if (existingFileUrl && !selectedFile) {
    const fileName = existingFileUrl.split('/').pop() || 'Document'
    const isImage = fileName.match(/\.(jpg|jpeg|png|webp)$/i)

    return (
      <div className="space-y-3">
        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-md">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <Check className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-green-900 mb-1">Upload Complete</h4>
              <div className="flex items-center gap-2 text-sm text-green-700 mb-2">
                {isImage ? <ImageIcon className="w-4 h-4" /> : <FileIcon className="w-4 h-4" />}
                <span className="truncate font-medium">{fileName}</span>
              </div>
              <div className="flex gap-2 mt-3">
                {onDownload && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onDownload}
                    className="h-8 border-green-200 hover:bg-green-100 text-green-700"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 border-green-200 hover:bg-green-100 text-green-700"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Replace
                </Button>
              </div>
            </div>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedFileTypes.join(',')}
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    )
  }

  // Upload State
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
        <p className="text-xs text-gray-500">
          {description}
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedFileTypes.join(',')}
        onChange={handleFileSelect}
        className="hidden"
      />

      {!selectedFile ? (
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isCompressing}
          className="w-full h-32 border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50 transition-all"
        >
          <div className="flex flex-col items-center justify-center text-center p-4">
            {isCompressing ? (
              <>
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
                <p className="text-sm font-medium text-blue-600">Compressing image...</p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-400 mb-2" />
                <p className="text-sm font-medium text-gray-900">Click to select file</p>
                <p className="text-xs text-gray-500 mt-1">
                  Supports PDF, DOCX, JPG, PNG
                </p>
              </>
            )}
          </div>
        </Button>
      ) : (
        <Card className="p-4 border-blue-200 bg-blue-50/50">
          <div className="space-y-4">
            {/* File Info */}
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  {selectedFile.type.startsWith('image/') ? (
                    <ImageIcon className="w-5 h-5 text-blue-600" />
                  ) : (
                    <FileIcon className="w-5 h-5 text-blue-600" />
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {selectedFile.name}
                </p>
                
                {/* Compression Stats */}
                {compressionStats && compressionStats.reductionPercentage > 0 ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs">
                    <span className="text-gray-500 line-through">
                      {formatFileSize(compressionStats.originalSize)}
                    </span>
                    <span className="text-green-600 font-medium">
                      {formatFileSize(compressionStats.compressedSize)}
                    </span>
                    <span className="text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">
                      -{compressionStats.reductionPercentage}%
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">
                    {formatFileSize(selectedFile.size)}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemoveSelection}
                className="text-gray-400 hover:text-red-500"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Upload Action */}
            <Button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload File
                </>
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
