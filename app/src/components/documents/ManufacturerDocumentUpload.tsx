'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Upload, File, X, Check, Loader2, Download } from 'lucide-react'

interface ManufacturerDocumentUploadProps {
  documentId: string
  orderId: string
  companyId: string
  onUploadComplete: (fileUrl: string) => void
  existingFileUrl?: string | null
}

export default function ManufacturerDocumentUpload({
  documentId,
  orderId,
  companyId,
  onUploadComplete,
  existingFileUrl = null
}: ManufacturerDocumentUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(existingFileUrl)
  const currentFilePathRef = useRef<string | null>(existingFileUrl)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const supabase = createClient()

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Invalid File Type',
        description: 'Please upload PDF or image files only (PDF, JPG, PNG)',
        variant: 'destructive'
      })
      return
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024 // 10MB in bytes
    if (file.size > maxSize) {
      toast({
        title: 'File Too Large',
        description: 'Maximum file size is 10MB',
        variant: 'destructive'
      })
      return
    }

    setSelectedFile(file)
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    try {
      setUploading(true)
      const formData = new FormData()
      const existingPath = currentFilePathRef.current

      formData.append('documentId', documentId)
      if (companyId) {
        formData.append('companyId', companyId)
      }
      formData.append('replaceExisting', String(Boolean(existingPath)))
      if (existingPath) {
        formData.append('existingFileUrl', existingPath)
      }
      formData.append('fileName', selectedFile.name)
      formData.append('file', selectedFile)

      const response = await fetch('/api/documents/manufacturer-upload', {
        method: 'POST',
        body: formData
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result?.error || 'Failed to upload manufacturer document')
      }

      if (!result?.fileUrl) {
        throw new Error('Upload succeeded but file reference is missing')
      }

      setUploadedUrl(result.fileUrl)
      currentFilePathRef.current = result.fileUrl
      onUploadComplete(result.fileUrl)

      toast({
        title: existingPath ? 'Document Replaced Successfully' : 'Upload Successful',
        description: existingPath 
          ? 'Manufacturer document has been replaced with the new file'
          : 'Manufacturer document has been uploaded successfully'
      })

      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error: any) {
      console.error('Error uploading file:', error)
      toast({
        title: 'Upload Failed',
        description: error.message || 'Failed to upload manufacturer document',
        variant: 'destructive'
      })
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDownloadExisting = async () => {
    if (!uploadedUrl) return

    try {
      const { data, error } = await supabase.storage
        .from('order-documents')
        .download(uploadedUrl)

      if (error) throw error

      // Create blob URL and trigger download
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = uploadedUrl.split('/').pop() || 'manufacturer-document.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      console.error('Error downloading file:', error)
      toast({
        title: 'Download Failed',
        description: 'Failed to download manufacturer document',
        variant: 'destructive'
      })
    }
  }

  const handleReplaceFile = () => {
    setUploadedUrl(null)
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    toast({
      title: 'Ready to Replace',
      description: 'Please select a new manufacturer document file',
    })
  }

  if (uploadedUrl) {
    return (
      <div className="space-y-3">
        {/* Success header */}
        <div className="bg-green-50 border-l-4 border-green-500 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <Check className="w-5 h-5 text-green-600 mt-0.5" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-green-900 mb-1">
                ✓ Manufacturer Document Uploaded
              </h4>
              <p className="text-sm text-green-800">
                Your supporting document has been attached and will be available for download in the invoice flow.
              </p>
              <p className="text-xs text-green-700 mt-1">
                Need to change the file? Click &quot;Replace&quot; to upload a different document.
              </p>
            </div>
          </div>
        </div>

        <Card className="p-4 bg-green-50 border-2 border-green-200">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-green-900">Manufacturer Document</p>
              <p className="text-sm text-green-700 truncate">{uploadedUrl.split('/').pop()}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadExisting}
                className="border-green-300 hover:bg-green-100"
              >
                <Download className="w-4 h-4 mr-1" />
                Download
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReplaceFile}
                className="border-amber-300 hover:bg-amber-50 text-amber-700 hover:text-amber-800"
              >
                Replace
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Optional upload header */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-blue-900 mb-1">
              Upload Supporting Documents (Optional)
            </h4>
            <p className="text-sm text-blue-800">
              You can attach supporting documents such as test reports, certificates, or specifications before acknowledging this Purchase Order. These documents will be available in the invoice flow.
            </p>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Manufacturer Supporting Document
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Accepted formats: PDF, JPG, PNG • Maximum file size: 10MB
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleFileSelect}
        className="hidden"
      />

      {!selectedFile ? (
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-32 border-2 border-dashed hover:border-blue-400 hover:bg-blue-50"
        >
          <div className="text-center">
            <Upload className="w-10 h-10 mx-auto mb-2 text-blue-500" />
            <p className="text-sm font-medium text-gray-900">Click to upload document</p>
            <p className="text-xs text-gray-500 mt-1">or drag and drop your file here</p>
            <p className="text-xs text-gray-400 mt-2">PDF, JPG or PNG (max 10MB)</p>
          </div>
        </Button>
      ) : (
        <Card className="p-4 border-2 border-blue-200 bg-blue-50">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <File className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{selectedFile.name}</p>
              <p className="text-sm text-gray-600">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleUpload}
                disabled={uploading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  'Upload'
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemoveFile}
                disabled={uploading}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
