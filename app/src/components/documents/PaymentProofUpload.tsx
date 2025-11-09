'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Upload, File, X, Check, Loader2 } from 'lucide-react'

type PaymentProofVariant = 'invoice' | 'balance'

const VARIANT_COPY: Record<PaymentProofVariant, {
  assetName: string
  stepTitle: string
  stepDescription: string
  fieldLabel: string
  fieldHint: string
  successHeader: string
  successDescription: string
  successCardTitle: string
  toastUploadDescription: string
  toastReplaceDescription: string
  toastDownloadFailed: string
  replacePrompt: string
  uploadCta: string
}> = {
  invoice: {
    assetName: 'payment proof',
    stepTitle: 'Step 1: Upload Payment Proof (Required)',
    stepDescription:
      'Before acknowledging this invoice, please attach proof of payment such as a bank transfer receipt or payment confirmation.',
    fieldLabel: 'Payment Proof Document',
    fieldHint: 'Accepted formats: PDF, JPG, PNG • Maximum file size: 5MB',
    successHeader: '✓ Step 1 Complete: Payment Proof Uploaded',
    successDescription: 'You can now proceed to acknowledge the invoice below.',
    successCardTitle: 'Payment Proof Uploaded',
    toastUploadDescription: 'Payment proof has been uploaded',
    toastReplaceDescription: 'Payment proof has been replaced with the new file',
    toastDownloadFailed: 'Failed to download payment proof',
    replacePrompt: 'Please select a new payment proof file',
    uploadCta: 'Click to upload payment proof'
  },
  balance: {
    assetName: 'final payment document',
    stepTitle: 'Step 1: Attach Final Payment Document (Required)',
    stepDescription:
      'Before HQ can approve this balance payment request, please upload the remittance advice or supporting document for the final 50% payment.',
    fieldLabel: 'Final Payment Document',
    fieldHint: 'Accepted formats: PDF, JPG, PNG • Maximum file size: 5MB',
    successHeader: '✓ Final Payment Document Attached',
    successDescription: 'HQ approvers can now approve the balance payment request.',
    successCardTitle: 'Final Payment Document Uploaded',
    toastUploadDescription: 'Final payment document has been uploaded',
    toastReplaceDescription: 'Final payment document has been replaced with the new file',
    toastDownloadFailed: 'Failed to download final payment document',
    replacePrompt: 'Please select a new final payment document',
    uploadCta: 'Click to upload final payment document'
  }
}

interface PaymentProofUploadProps {
  documentId: string
  orderId: string
  companyId: string
  onUploadComplete: (fileUrl: string) => void
  existingFileUrl?: string | null
  variant?: PaymentProofVariant
}

export default function PaymentProofUpload({
  documentId,
  orderId,
  companyId,
  onUploadComplete,
  existingFileUrl = null,
  variant = 'invoice'
}: PaymentProofUploadProps) {
  const copy = VARIANT_COPY[variant]
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(existingFileUrl)
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

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024 // 5MB in bytes
    if (file.size > maxSize) {
      toast({
        title: 'File Too Large',
        description: 'Maximum file size is 5MB',
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

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        throw new Error('User not authenticated')
      }

      // If replacing existing file, delete old file from storage and database
      if (existingFileUrl || uploadedUrl) {
        const oldFileUrl = existingFileUrl || uploadedUrl
        
        // Delete old file from storage
        const { error: deleteStorageError } = await supabase.storage
          .from('order-documents')
          .remove([oldFileUrl!])

        if (deleteStorageError) {
          console.warn('Warning: Could not delete old file from storage:', deleteStorageError)
          // Continue anyway - we'll replace the database record
        }

        // Delete old file record from database
        const { error: deleteDbError } = await supabase
          .from('document_files')
          .delete()
          .eq('document_id', documentId)

        if (deleteDbError) {
          console.warn('Warning: Could not delete old file record:', deleteDbError)
          // Continue anyway - insert will work if delete failed
        }
      }

      // Generate unique file name
      const fileExt = selectedFile.name.split('.').pop()
      const fileName = `payment-proof-${documentId}-${Date.now()}.${fileExt}`

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('order-documents')
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      const fileUrl = uploadData.path

      // Save file reference in document_files table
      const { error: dbError } = await supabase
        .from('document_files')
        .insert({
          document_id: documentId,
          file_url: fileUrl,
          file_name: selectedFile.name,
          file_size: selectedFile.size,
          mime_type: selectedFile.type,
          company_id: companyId,
          uploaded_by: user.id  // Add user ID
        } as any)

      if (dbError) throw dbError

      setUploadedUrl(fileUrl)
      onUploadComplete(fileUrl)

      toast({
        title: uploadedUrl || existingFileUrl ? 'File Replaced Successfully' : 'Upload Successful',
        description: uploadedUrl || existingFileUrl 
          ? copy.toastReplaceDescription
          : copy.toastUploadDescription
      })

      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error: any) {
      console.error('Error uploading file:', error)
      toast({
        title: 'Upload Failed',
        description: error.message || 'Failed to upload payment proof',
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
      a.download = uploadedUrl.split('/').pop() || 'payment-proof.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      console.error('Error downloading file:', error)
      toast({
        title: 'Download Failed',
        description: copy.toastDownloadFailed,
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
      description: copy.replacePrompt,
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
                {copy.successHeader}
              </h4>
              <p className="text-sm text-green-800">
                {copy.successDescription}
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
              <p className="font-semibold text-green-900">{copy.successCardTitle}</p>
              <p className="text-sm text-green-700 truncate">{uploadedUrl.split('/').pop()}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadExisting}
                className="border-green-300 hover:bg-green-100"
              >
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
      {/* Prominent header */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-blue-900 mb-1">
              {copy.stepTitle}
            </h4>
            <p className="text-sm text-blue-800">
              {copy.stepDescription}
            </p>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {copy.fieldLabel} <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500 mb-3">
          {copy.fieldHint}
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
            <p className="text-sm font-medium text-gray-900">{copy.uploadCta}</p>
            <p className="text-xs text-gray-500 mt-1">or drag and drop your file here</p>
            <p className="text-xs text-gray-400 mt-2">PDF, JPG or PNG (max 5MB)</p>
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
