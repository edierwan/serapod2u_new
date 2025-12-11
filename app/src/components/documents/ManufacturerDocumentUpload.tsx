'use client'

import UnifiedDocumentUpload from './UnifiedDocumentUpload'

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
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(existingFileUrl)
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
      <div className="space-y-3">
        {/* Success header */}
        <div className="bg-green-50 border-l-4 border-green-500 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <Check className="w-5 h-5 text-green-600 mt-0.5" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-green-900 mb-1">
                ✓ Proforma Invoice (PI) Uploaded Successfully
              </h4>
              <p className="text-sm text-green-800">
                Your Proforma Invoice has been attached and will be available for the buyer to download in the invoice flow. The buyer can review pricing, terms, and specifications before proceeding with payment.
              </p>
              <p className="text-xs text-green-700 mt-1">
                Need to update the PI? Click &quot;Replace&quot; to upload a revised Proforma Invoice.
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
              <p className="font-semibold text-green-900">Proforma Invoice (PI)</p>
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
              Upload Proforma Invoice (PI) - Required
            </h4>
            <p className="text-sm text-blue-800">
              Please upload your <strong>Proforma Invoice (PI)</strong> for this Purchase Order. The PI must include pricing details, payment terms, delivery terms, and product specifications before you can acknowledge this PO. This document will be shared with the buyer in the invoice flow.
            </p>
            <p className="text-xs text-blue-700 mt-2">
              💡 <strong>Note:</strong> The Proforma Invoice serves as a preliminary invoice outlining the commercial terms of the transaction.
            </p>
          </div>
        </div>
      </div>

      <UnifiedDocumentUpload
        label="Proforma Invoice (PI) Document"
        description="Accepted formats: PDF, JPG, PNG • Maximum file size: 10MB"
        onUpload={handleUpload}
        acceptedFileTypes={['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']}
        maxDocSizeMB={10}
      />
    </div>
  )
}
