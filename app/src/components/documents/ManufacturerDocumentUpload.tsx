'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Check, Download } from 'lucide-react'
import UnifiedDocumentUpload from './UnifiedDocumentUpload'

interface ManufacturerDocumentUploadProps {
  documentId: string
  orderId: string
  companyId: string
  onUploadComplete: (fileUrl: string) => void
  existingFileUrl?: string | null
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function ManufacturerDocumentUpload({
  documentId,
  orderId,
  companyId,
  onUploadComplete,
  existingFileUrl = null
}: ManufacturerDocumentUploadProps) {
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(existingFileUrl)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const currentFilePathRef = useRef<string | null>(existingFileUrl)
  const { toast } = useToast()
  const supabase = createClient()

  const handleUpload = async (file: File) => {
    try {
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
      formData.append('fileName', file.name)
      formData.append('file', file)

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
      setFileSize(file.size)
      currentFilePathRef.current = result.fileUrl
      onUploadComplete(result.fileUrl)

      toast({
        title: existingPath ? 'Document Replaced Successfully' : 'Upload Successful',
        description: existingPath 
          ? 'Manufacturer document has been replaced with the new file'
          : 'Manufacturer document has been uploaded successfully'
      })

    } catch (error: any) {
      console.error('Error uploading file:', error)
      toast({
        title: 'Upload Failed',
        description: error.message || 'Failed to upload manufacturer document',
        variant: 'destructive'
      })
      throw error
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
    toast({
      title: 'Ready to Replace',
      description: 'Please select a new manufacturer document file',
    })
  }

  if (uploadedUrl) {
    return (
      <div className="space-y-2">
        {/* Success header */}
        <div className="bg-green-50 border-l-4 border-green-500 p-2.5">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0">
              <Check className="w-4 h-4 text-green-600 mt-0.5" />
            </div>
            <div className="flex-1">
              <h4 className="text-xs font-semibold text-green-900 mb-0.5">
                ✓ Proforma Invoice (PI) Uploaded Successfully
              </h4>
              <p className="text-[11px] text-green-800">
                Your Proforma Invoice has been attached and will be available for the buyer to download in the invoice flow.
              </p>
              <p className="text-[10px] text-green-700 mt-0.5">
                Need to update the PI? Click &quot;Replace&quot; to upload a revised Proforma Invoice.
              </p>
            </div>
          </div>
        </div>

        <Card className="p-2.5 bg-green-50 border-2 border-green-200">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0">
              <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center">
                <Check className="w-4 h-4 text-green-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-green-900">Proforma Invoice (PI)</p>
              <p className="text-[11px] text-green-700 truncate">
                {uploadedUrl.split('/').pop()}
                {fileSize && <span className="text-[10px] text-green-600 ml-1">({formatFileSize(fileSize)})</span>}
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadExisting}
                className="h-7 px-2 text-[10px] border-green-300 hover:bg-green-100"
              >
                <Download className="w-3 h-3 mr-1" />
                Download
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReplaceFile}
                className="h-7 px-2 text-[10px] border-amber-300 hover:bg-amber-50 text-amber-700 hover:text-amber-800"
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
    <div className="space-y-2">
      {/* Optional upload header */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0">
            <svg className="w-4 h-4 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-semibold text-blue-900 mb-0.5">
              Upload Proforma Invoice (PI) - Required
            </h4>
            <p className="text-[11px] text-blue-800">
              Please upload your <strong>Proforma Invoice (PI)</strong> for this Purchase Order. The PI must include pricing details, payment terms, and product specifications.
            </p>
            <p className="text-[10px] text-blue-700 mt-1">
              💡 The Proforma Invoice serves as a preliminary invoice outlining the commercial terms.
            </p>
          </div>
        </div>
      </div>

      <UnifiedDocumentUpload
        label="Proforma Invoice (PI) Document"
        description="PDF, JPG, PNG • Max 10MB"
        onUpload={handleUpload}
        acceptedFileTypes={['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']}
        maxDocSizeMB={10}
      />
    </div>
  )
}
