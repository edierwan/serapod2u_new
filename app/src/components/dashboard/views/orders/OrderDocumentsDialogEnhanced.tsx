'use client'

import { useState, useEffect } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DocumentWorkflowProgress from '@/components/documents/DocumentWorkflowProgress'
import AcknowledgeButton from '@/components/documents/AcknowledgeButton'
import PaymentProofUpload from '@/components/documents/PaymentProofUpload'
import { type Document } from '@/lib/document-permissions'

interface OrderDocumentsDialogEnhancedProps {
  orderId: string
  orderNo: string
  userProfile: {
    id: string
    organization_id: string
    organizations: {
      org_type_code: string
    }
    roles: {
      role_level: number
    }
  }
  onClose: () => void
}

export default function OrderDocumentsDialogEnhanced({
  orderId,
  orderNo,
  userProfile,
  onClose
}: OrderDocumentsDialogEnhancedProps) {
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('po')
  const [documents, setDocuments] = useState<{
    po?: Document | null
    invoice?: Document | null
    payment?: Document | null
    receipt?: Document | null
  }>({})
  const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null)
  const [requiresPaymentProof, setRequiresPaymentProof] = useState(false)
  const [orderData, setOrderData] = useState<any>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [orderId])

  async function loadData() {
    try {
      setLoading(true)
      await Promise.all([
        loadDocuments(),
        loadOrderData(),
        checkPaymentProofRequirement()
      ])
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadDocuments() {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select(`
          *,
          issued_by_org:organizations!documents_issued_by_org_id_fkey(org_name, org_code),
          issued_to_org:organizations!documents_issued_to_org_id_fkey(org_name, org_code),
          created_by_user:users!documents_created_by_fkey(full_name),
          acknowledged_by_user:users!documents_acknowledged_by_fkey(full_name)
        `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: true })

      if (error) throw error

      // Organize documents by type
      const docs: any = {}
      data?.forEach((doc: any) => {
        const docType = doc.doc_type.toLowerCase()
        docs[docType] = doc
      })

      setDocuments(docs)

      // Check for payment proof if payment document exists
      if (docs.payment) {
        const { data: paymentFile } = await supabase
          .from('document_files')
          .select('file_url')
          .eq('document_id', docs.payment.id)
          .single()

        if (paymentFile) {
          setPaymentProofUrl(paymentFile.file_url)
        }
      }
    } catch (error: any) {
      console.error('Error loading documents:', error)
      toast({
        title: 'Error',
        description: 'Failed to load documents',
        variant: 'destructive'
      })
    }
  }

  async function loadOrderData() {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          buyer_org:organizations!orders_buyer_org_id_fkey(
            org_name, 
            address, 
            contact_phone, 
            contact_email
          ),
          seller_org:organizations!orders_seller_org_id_fkey(
            org_name, 
            address, 
            contact_phone, 
            contact_email
          ),
          order_items(
            *,
            product:products(product_name, product_code),
            variant:product_variants(variant_name)
          )
        `)
        .eq('id', orderId)
        .single()

      if (error) throw error
      setOrderData(data)
    } catch (error: any) {
      console.error('Error loading order data:', error)
    }
  }

  async function checkPaymentProofRequirement() {
    try {
      // Check the user's organization settings for payment proof requirement
      const { data, error } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', userProfile.organization_id)
        .single()

      if (error) throw error

      // Check if require_payment_proof is set, default to true
      const requireProof = data?.settings?.require_payment_proof ?? true
      setRequiresPaymentProof(requireProof)
    } catch (error) {
      console.error('Error checking payment proof requirement:', error)
      // Default to true on error (safe default)
      setRequiresPaymentProof(true)
    }
  }

  async function handleDownload(documentId: string, docType: string) {
    setDownloading(documentId)
    try {
      // Map docType to API type parameter
      let apiType: string
      switch (docType.toUpperCase()) {
        case 'PO':
          apiType = 'purchase_order'
          break
        case 'INVOICE':
          apiType = 'invoice'
          break
        case 'PAYMENT':
          // Payment doesn't have its own PDF, use invoice or skip
          toast({
            title: 'Not Available',
            description: 'Payment document generation coming soon',
            variant: 'destructive'
          })
          setDownloading(null)
          return
        case 'RECEIPT':
          apiType = 'receipt'
          break
        default:
          apiType = 'order'
      }

      const url = `/api/documents/generate?orderId=${orderId}&type=${apiType}`
      console.log('Fetching PDF from:', url)

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/pdf',
        },
      })

      console.log('Response status:', response.status, response.statusText)

      if (!response.ok) {
        let errorMessage = 'Failed to generate document'
        try {
          const contentType = response.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage
          } else {
            const errorText = await response.text()
            errorMessage = errorText || errorMessage
          }
        } catch (e) {
          console.error('Error parsing error response:', e)
        }
        throw new Error(errorMessage)
      }

      const blob = await response.blob()
      console.log('PDF blob size:', blob.size)
      
      if (blob.size === 0) {
        throw new Error('Generated PDF is empty')
      }

      const blobUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${orderNo}-${docType}.pdf`
      document.body.appendChild(a)
      a.click()
      
      // Clean up
      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl)
        document.body.removeChild(a)
      }, 100)

      toast({
        title: 'Success',
        description: 'Document downloaded successfully'
      })
    } catch (error: any) {
      console.error('Error downloading document:', error)
      
      // Check if it's a network error
      if (error.message === 'Failed to fetch') {
        toast({
          title: 'Network Error',
          description: 'Unable to connect to server. Please check if the development server is running.',
          variant: 'destructive'
        })
      } else {
        toast({
          title: 'Download Failed',
          description: error.message || 'Failed to download document. Please try again.',
          variant: 'destructive'
        })
      }
    } finally {
      setDownloading(null)
    }
  }

  async function handleDownloadPaymentProof() {
    if (!paymentProofUrl) {
      toast({
        title: 'No Payment Proof',
        description: 'No payment proof file has been uploaded yet',
        variant: 'destructive'
      })
      return
    }

    setDownloading('payment-proof')
    try {
      console.log('🔍 Downloading payment proof from:', paymentProofUrl)
      
      // Download the file from Supabase Storage using the download method
      // This works for both public and private buckets
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('order-documents')
        .download(paymentProofUrl)

      if (downloadError) {
        console.error('🔍 Download error:', downloadError)
        throw new Error(downloadError.message || 'Failed to download payment proof')
      }

      if (!fileData) {
        throw new Error('No file data received')
      }

      console.log('🔍 Downloaded blob size:', fileData.size, 'type:', fileData.type)
      
      // Extract filename from URL or create a default one
      const fileName = paymentProofUrl.split('/').pop() || `payment-proof-${orderNo}.pdf`
      
      // Create download link
      const blobUrl = window.URL.createObjectURL(fileData)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      
      // Clean up
      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl)
        document.body.removeChild(a)
      }, 100)

      toast({
        title: 'Success',
        description: 'Payment proof downloaded successfully'
      })
    } catch (error: any) {
      console.error('Error downloading payment proof:', error)
      toast({
        title: 'Download Failed',
        description: error.message || 'Failed to download payment proof. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setDownloading(null)
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-MY', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: 'MYR'
    }).format(amount)
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
        <div className="bg-white rounded-lg p-8">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
          <p className="mt-4 text-gray-600">Loading documents...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
      <div className="min-h-screen px-4 py-8">
        <div className="max-w-6xl mx-auto bg-white rounded-lg shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Order Documents</h2>
              <p className="text-gray-600 mt-1">Order No: {orderNo}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Workflow Progress */}
            <DocumentWorkflowProgress 
              documents={documents as any} 
              onTabChange={setActiveTab}
            />

            {/* Document Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="po">Purchase Order</TabsTrigger>
                <TabsTrigger value="invoice">Invoice</TabsTrigger>
                <TabsTrigger value="payment">Payment</TabsTrigger>
                <TabsTrigger value="receipt">Receipt</TabsTrigger>
              </TabsList>

              {/* PO Tab */}
              <TabsContent value="po" className="space-y-4">
                {documents.po ? (
                  <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h3 className="font-semibold text-blue-900 mb-2">Purchase Order Details</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-blue-700">Document No:</span>{' '}
                          <span className="font-medium">{documents.po.doc_no}</span>
                        </div>
                        <div>
                          <span className="text-blue-700">Status:</span>{' '}
                          <span className="font-medium capitalize">{documents.po.status}</span>
                        </div>
                        <div>
                          <span className="text-blue-700">Created:</span>{' '}
                          <span>{formatDate(documents.po.created_at)}</span>
                        </div>
                        {documents.po.acknowledged_at && (
                          <div>
                            <span className="text-blue-700">Acknowledged:</span>{' '}
                            <span>{formatDate(documents.po.acknowledged_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        onClick={() => handleDownload(documents.po!.id, 'PO')}
                        disabled={downloading === documents.po!.id}
                        className="flex-1"
                      >
                        {downloading === documents.po!.id ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Downloading...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4 mr-2" />
                            Download PDF
                          </>
                        )}
                      </Button>
                    </div>

                    <AcknowledgeButton
                      document={documents.po as Document}
                      userProfile={userProfile}
                      onSuccess={loadData}
                    />
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Purchase Order not yet created
                  </div>
                )}
              </TabsContent>

              {/* Invoice Tab */}
              <TabsContent value="invoice" className="space-y-4">
                {documents.invoice ? (
                  <div className="space-y-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h3 className="font-semibold text-green-900 mb-2">Invoice Details</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-green-700">Document No:</span>{' '}
                          <span className="font-medium">{documents.invoice.doc_no}</span>
                        </div>
                        <div>
                          <span className="text-green-700">Status:</span>{' '}
                          <span className="font-medium capitalize">{documents.invoice.status}</span>
                        </div>
                        <div>
                          <span className="text-green-700">Created:</span>{' '}
                          <span>{formatDate(documents.invoice.created_at)}</span>
                        </div>
                        {documents.invoice.acknowledged_at && (
                          <div>
                            <span className="text-green-700">Acknowledged:</span>{' '}
                            <span>{formatDate(documents.invoice.acknowledged_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <Button
                      onClick={() => handleDownload(documents.invoice!.id, 'INVOICE')}
                      disabled={downloading === documents.invoice!.id}
                      className="w-full"
                    >
                      {downloading === documents.invoice!.id ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Downloading...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          Download PDF
                        </>
                      )}
                    </Button>

                    {requiresPaymentProof && documents.invoice.status === 'pending' && (
                      <PaymentProofUpload
                        documentId={documents.invoice.id}
                        orderId={orderId}
                        companyId={orderData?.company_id}
                        onUploadComplete={setPaymentProofUrl}
                        existingFileUrl={paymentProofUrl}
                      />
                    )}

                    <AcknowledgeButton
                      document={documents.invoice as Document}
                      userProfile={userProfile}
                      onSuccess={loadData}
                      requiresPaymentProof={requiresPaymentProof}
                      paymentProofUrl={paymentProofUrl}
                    />
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Invoice will be created after PO is acknowledged
                  </div>
                )}
              </TabsContent>

              {/* Payment Tab */}
              <TabsContent value="payment" className="space-y-4">
                {documents.payment ? (
                  <div className="space-y-4">
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <h3 className="font-semibold text-purple-900 mb-2">Payment Details</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-purple-700">Document No:</span>{' '}
                          <span className="font-medium">{documents.payment.doc_no}</span>
                        </div>
                        <div>
                          <span className="text-purple-700">Status:</span>{' '}
                          <span className="font-medium capitalize">{documents.payment.status}</span>
                        </div>
                        <div>
                          <span className="text-purple-700">Created:</span>{' '}
                          <span>{formatDate(documents.payment.created_at)}</span>
                        </div>
                        {documents.payment.acknowledged_at && (
                          <div>
                            <span className="text-purple-700">Acknowledged:</span>{' '}
                            <span>{formatDate(documents.payment.acknowledged_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {paymentProofUrl && (
                      <div className="space-y-3">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                          <p className="text-sm text-green-800 font-medium mb-3">
                            ✓ Payment proof uploaded and attached to this payment
                          </p>
                          <Button
                            onClick={handleDownloadPaymentProof}
                            disabled={downloading === 'payment-proof'}
                            className="w-full bg-green-600 hover:bg-green-700"
                          >
                            {downloading === 'payment-proof' ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Downloading...
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4 mr-2" />
                                Download Payment Proof
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    <AcknowledgeButton
                      document={documents.payment as Document}
                      userProfile={userProfile}
                      onSuccess={loadData}
                    />
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Payment will be created after Invoice is acknowledged
                  </div>
                )}
              </TabsContent>

              {/* Receipt Tab */}
              <TabsContent value="receipt" className="space-y-4">
                {documents.receipt ? (
                  <div className="space-y-4">
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                      <h3 className="font-semibold text-orange-900 mb-2">Receipt Details</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-orange-700">Document No:</span>{' '}
                          <span className="font-medium">{documents.receipt.doc_no}</span>
                        </div>
                        <div>
                          <span className="text-orange-700">Status:</span>{' '}
                          <span className="font-medium">Completed</span>
                        </div>
                        <div>
                          <span className="text-orange-700">Created:</span>{' '}
                          <span>{formatDate(documents.receipt.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <p className="text-green-800 font-medium">✓ Order Completed</p>
                      <p className="text-sm text-green-700 mt-1">
                        This order has been successfully completed and closed.
                      </p>
                    </div>

                    <Button
                      onClick={() => handleDownload(documents.receipt!.id, 'RECEIPT')}
                      disabled={downloading === documents.receipt!.id}
                      className="w-full"
                    >
                      {downloading === documents.receipt!.id ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Downloading...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          Download PDF
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Receipt will be created after Payment is acknowledged
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  )
}
