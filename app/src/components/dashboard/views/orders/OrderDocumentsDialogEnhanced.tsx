'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, Download, Loader2, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DocumentWorkflowProgress from '@/components/documents/DocumentWorkflowProgress'
import AcknowledgeButton from '@/components/documents/AcknowledgeButton'
import PaymentProofUpload from '@/components/documents/PaymentProofUpload'
import ManufacturerDocumentUpload from '@/components/documents/ManufacturerDocumentUpload'
import { type Document } from '@/lib/document-permissions'

interface OrderDocumentsDialogEnhancedProps {
  orderId: string
  orderNo: string
  userProfile: {
    id: string
    organization_id: string
    role_code?: string | null
    signature_url?: string | null
    organizations: {
      org_type_code: string
    }
    roles: {
      role_level: number
    }
  }
  initialTab?: 'po' | 'invoice' | 'payment' | 'receipt' | 'depositInvoice' | 'depositPayment' | 'balanceRequest' | 'balancePayment'
  open: boolean
  onClose: () => void
}

export default function OrderDocumentsDialogEnhanced({
  orderId,
  orderNo,
  userProfile,
  initialTab,
  open,
  onClose
}: OrderDocumentsDialogEnhancedProps) {
  type DocumentTab = 'po' | 'invoice' | 'payment' | 'receipt' | 'depositInvoice' | 'depositPayment' | 'balanceRequest' | 'balancePayment'
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DocumentTab>(initialTab ?? 'po')
  const [documents, setDocuments] = useState<{
    po?: Document | null
    invoice?: Document | null
    payment?: Document | null
    receipt?: Document | null
    depositInvoice?: Document | null
    depositPayment?: Document | null
    balancePaymentRequest?: Document | null
    balancePayment?: Document | null
    depositReceipt?: Document | null
    finalReceipt?: Document | null
  }>({})
  const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null)
  const [balancePaymentProofUrl, setBalancePaymentProofUrl] = useState<string | null>(null)
  const [manufacturerDocUrl, setManufacturerDocUrl] = useState<string | null>(null)
  const [requiresPaymentProof, setRequiresPaymentProof] = useState(false)
  const [orderData, setOrderData] = useState<any>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [approvingBalanceRequest, setApprovingBalanceRequest] = useState(false)
  const [hasReviewedPaymentProof, setHasReviewedPaymentProof] = useState(false)
  const [hasReviewedBalanceProof, setHasReviewedBalanceProof] = useState(false)
  const [userSignatureUrl, setUserSignatureUrl] = useState<string | null>(userProfile.signature_url ?? null)
  const supabase = createClient()

  const userProfileWithSignature = useMemo(() => ({
    ...userProfile,
    signature_url: userSignatureUrl ?? null
  }), [userProfile, userSignatureUrl])

  const isHQAdmin = useMemo(() => {
    const roleCode = userProfile?.role_code
    const roleLevel = userProfile?.roles?.role_level ?? 0
    return roleCode === 'HQ_ADMIN' || roleCode === 'POWER_USER' || roleLevel >= 80 || userProfile?.organizations?.org_type_code === 'HQ'
  }, [userProfile])

  // Check if this order uses split payment (deposit + balance)
  const useSplitPayment = useMemo(() => {
    // Check if deposit percentage is greater than 0 and less than 100
    // payment_terms is a JSONB field with deposit_pct (decimal like 0.3 for 30%)
    const depositPct = orderData?.payment_terms?.deposit_pct ?? 0.5
    return depositPct > 0 && depositPct < 1
  }, [orderData])

  // Get deposit percentage for display
  const depositPercentage = useMemo(() => {
    // Convert decimal to percentage (0.3 -> 30, 0.5 -> 50, 0.7 -> 70)
    const depositPct = orderData?.payment_terms?.deposit_pct ?? 0.5
    return Math.round(depositPct * 100)
  }, [orderData])

  // Get balance percentage for display
  const balancePercentage = useMemo(() => {
    // Convert decimal to percentage (0.7 -> 70, 0.5 -> 50, 0.3 -> 30)
    const balancePct = orderData?.payment_terms?.balance_pct ?? 0.5
    return Math.round(balancePct * 100)
  }, [orderData])

  // For backwards compatibility, map to old variable name
  const is50_50Split = useSplitPayment

  const isDocumentTab = (value: string): value is DocumentTab =>
    value === 'po' || value === 'invoice' || value === 'payment' || value === 'receipt' ||
    value === 'depositInvoice' || value === 'depositPayment' || value === 'balanceRequest' || value === 'balancePayment'

  const handleTabChange = (value: string) => {
    if (isDocumentTab(value)) {
      setActiveTab(value)
    }
  }

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  useEffect(() => {
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  async function loadData() {
    try {
      setLoading(true)
      await Promise.all([
        loadDocuments(),
        loadOrderData(),
        checkPaymentProofRequirement(),
        refreshUserSignature()
      ])
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function refreshUserSignature() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('signature_url')
        .eq('id', userProfile.id)
        .single()

      if (error) throw error
      setUserSignatureUrl((data as any)?.signature_url ?? null)
    } catch (error) {
      console.error('Error loading user signature:', error)
    }
  }

  async function loadDocuments() {
    try {
  setPaymentProofUrl(null)
  setBalancePaymentProofUrl(null)
  setHasReviewedBalanceProof(false)
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
      const invoices: Document[] = []
      const payments: Document[] = []
      const receipts: Document[] = []
      
      data?.forEach((doc: any) => {
        const docType = doc.doc_type.toLowerCase()
        
        // Group invoices, payments, and receipts by creation order
        if (docType === 'invoice') {
          invoices.push(doc)
        } else if (docType === 'payment') {
          payments.push(doc)
        } else if (docType === 'receipt') {
          receipts.push(doc)
        } else if (docType === 'payment_request') {
          docs.balancePaymentRequest = doc
        } else {
          docs[docType] = doc
        }
      })

      // Sort by creation date
      invoices.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      payments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      receipts.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      // Assign deposit and balance documents
      if (invoices.length > 0) {
        docs.depositInvoice = invoices[0] // First invoice = deposit
        docs.invoice = invoices[invoices.length - 1] // Last invoice for backwards compatibility
      }

      if (payments.length > 0) {
        const balancePayments = payments.filter((payment: any) => {
          const payload = payment?.payload ?? {}
          if (payload && typeof payload === 'object') {
            const sourceRequestId = (payload as any).source_request_id ?? (payload as any)['source_request_id']
            return Boolean(sourceRequestId)
          }
          return false
        })

        const depositPayments = payments.filter((payment: any) => !balancePayments.includes(payment))

        if (depositPayments.length > 0) {
          docs.depositPayment = depositPayments[0]
        }

        if (balancePayments.length > 0) {
          docs.balancePayment = balancePayments[balancePayments.length - 1]
        }

        docs.payment = payments[payments.length - 1] // Last payment for backwards compatibility
      }

      // Assign receipts based on payment_percentage
      // Note: Receipts are created with dynamic percentages from payment_terms
      // - Deposit receipt: payment_percentage = Math.round(deposit_pct * 100) (e.g., 30, 50, 70)
      // - Final receipt: payment_percentage = 100
      if (receipts.length > 0) {
        const finalReceipt = receipts.find((r: any) => r.payment_percentage === 100)
        const depositReceipt = receipts.find((r: any) => r.payment_percentage < 100)
        
        if (depositReceipt) {
          docs.depositReceipt = depositReceipt
        }
        if (finalReceipt) {
          docs.finalReceipt = finalReceipt
        }
        // Backwards compatibility: Use last receipt as default
        docs.receipt = receipts[receipts.length - 1]
      }

      setDocuments(docs)

      // Check for manufacturer document if PO exists
      if (docs.po) {
        const { data: mfgFile } = await supabase
          .from('document_files')
          .select('file_url')
          .eq('document_id', docs.po.id)
          .eq('file_type', 'manufacturer_doc')
          .single()

        if (mfgFile) {
          setManufacturerDocUrl((mfgFile as any).file_url)
        }
      }

      // Check for payment proof if payment document exists
      let depositProofUrl: string | null = null

      if (docs.depositPayment) {
        const { data: depositFile, error: depositFileError } = await supabase
          .from('document_files')
          .select('file_url')
          .eq('document_id', docs.depositPayment.id)
          .maybeSingle()

        if (depositFileError) {
          console.error('Error loading deposit payment proof:', depositFileError)
        }

        if ((depositFile as any)?.file_url) {
          depositProofUrl = (depositFile as any).file_url
        }
      }

      if (docs.payment) {
        if (!depositProofUrl) {
          const { data: paymentFile, error: paymentFileError } = await supabase
            .from('document_files')
            .select('file_url')
            .eq('document_id', docs.payment.id)
            .maybeSingle()

          if (paymentFileError) {
            console.error('Error loading payment proof:', paymentFileError)
          }

          if ((paymentFile as any)?.file_url) {
            depositProofUrl = (paymentFile as any).file_url
          }
        }

        setHasReviewedPaymentProof(Boolean(docs.payment.acknowledged_at))
      } else {
        setHasReviewedPaymentProof(false)
      }

      setPaymentProofUrl(depositProofUrl)

      if (docs.balancePaymentRequest) {
        const { data: balanceFile, error: balanceFileError } = await supabase
          .from('document_files')
          .select('file_url')
          .eq('document_id', docs.balancePaymentRequest.id)
          .maybeSingle()

        if (balanceFileError) {
          console.error('Error loading balance payment evidence:', balanceFileError)
        }

        setBalancePaymentProofUrl((balanceFile as any)?.file_url ?? null)
      } else {
        setBalancePaymentProofUrl(null)
      }

      setHasReviewedBalanceProof(Boolean(docs.balancePayment?.acknowledged_at))
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
      const requireProof = (data as any)?.settings?.require_payment_proof ?? true
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
      console.log('handleDownload called with:', { documentId, docType, orderId, orderNo })
      
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
          apiType = 'payment'
          break
        case 'RECEIPT':
          apiType = 'receipt'
          break
        case 'PAYMENT_REQUEST':
          apiType = 'payment_request'
          break
        default:
          apiType = 'order'
      }

      const params = new URLSearchParams({
        orderId,
        type: apiType
      })

      if (documentId) {
        params.append('documentId', documentId)
      }

      const url = `/api/documents/generate?${params.toString()}`
      console.log('Fetching PDF from:', url)

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/pdf'
        },
        credentials: 'include'
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

  async function handleApproveBalancePaymentRequest(requestId: string) {
    if (!requestId) return

    if (!balancePaymentProofUrl) {
      toast({
        title: 'Final Document Required',
        description: 'Please upload the final 50% payment document before approving this request.',
        variant: 'destructive'
      })
      return
    }

    try {
      setApprovingBalanceRequest(true)

      const response = await fetch(`/api/documents/payment-request/${requestId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expired. Please sign in again and retry.')
        }

        if (response.status === 403) {
          throw new Error(data.error || 'You do not have permission to approve this request.')
        }

        throw new Error(data.error || 'Failed to approve balance payment request')
      }

      toast({
        title: 'Success',
        description: `Balance payment request approved. Payment document ${data.payment_doc_no} has been created.`
      })

      await loadData()
    } catch (error: any) {
      console.error('Error approving balance payment request:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to approve balance payment request',
        variant: 'destructive'
      })
    } finally {
      setApprovingBalanceRequest(false)
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

      // Mark payment proof as reviewed
      setHasReviewedPaymentProof(true)

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

  async function handleDownloadBalancePaymentProof() {
    if (!balancePaymentProofUrl) {
      toast({
        title: 'No Final Proof',
        description: 'The final payment document has not been uploaded yet.',
        variant: 'destructive'
      })
      return
    }

    setDownloading('balance-proof')
    try {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('order-documents')
        .download(balancePaymentProofUrl)

      if (downloadError) {
        console.error('🔍 Balance proof download error:', downloadError)
        throw new Error(downloadError.message || 'Failed to download final payment proof')
      }

      if (!fileData) {
        throw new Error('No file data received')
      }

      const fileName = balancePaymentProofUrl.split('/').pop() || `balance-payment-proof-${orderNo}.pdf`

      const blobUrl = window.URL.createObjectURL(fileData)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()

      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl)
        document.body.removeChild(a)
      }, 100)

      setHasReviewedBalanceProof(true)

      toast({
        title: 'Success',
        description: 'Final payment proof downloaded successfully'
      })
    } catch (error: any) {
      console.error('Error downloading final payment proof:', error)
      toast({
        title: 'Download Failed',
        description: error.message || 'Failed to download final payment proof. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setDownloading(null)
    }
  }

  async function handleDownloadCompletePackage() {
    if (!documents.finalReceipt) {
      toast({
        title: 'Package Unavailable',
        description: 'The final receipt has not been generated yet. Complete the balance payment acknowledgment first.',
        variant: 'destructive'
      })
      return
    }

    setDownloading('bundle')
    try {
      const response = await fetch(`/api/documents/order/${orderId}/bundle`, {
        method: 'GET'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || 'Failed to build combined document package')
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = `${orderNo}-complete-package.pdf`
      document.body.appendChild(anchor)
      anchor.click()

      setTimeout(() => {
        window.URL.revokeObjectURL(downloadUrl)
        document.body.removeChild(anchor)
      }, 100)

      toast({
        title: 'Download Ready',
        description: 'All order documents have been bundled into a single PDF.'
      })
    } catch (error: any) {
      console.error('Failed to download complete package:', error)
      toast({
        title: 'Download Failed',
        description: error.message || 'Unable to download the combined PDF. Please try again.',
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

  if (!open) return null

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
              onTabChange={handleTabChange}
              use50_50Split={is50_50Split}
              depositPercentage={depositPercentage}
            />

            {/* Document Tabs */}
            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
              {is50_50Split ? (
                // 50/50 Split Payment Tabs
                <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
                  <TabsTrigger value="po">
                    <span className="sm:hidden">PO</span>
                    <span className="hidden sm:inline">Purchase Order</span>
                  </TabsTrigger>
                  <TabsTrigger value="depositInvoice">
                    <span className="sm:hidden">Dep. Inv</span>
                    <span className="hidden sm:inline">Deposit Invoice</span>
                  </TabsTrigger>
                  <TabsTrigger value="depositPayment">
                    <span className="sm:hidden">Dep. Pay</span>
                    <span className="hidden sm:inline">Deposit Payment</span>
                  </TabsTrigger>
                  <TabsTrigger value="balanceRequest">
                    <span className="sm:hidden">Bal. Req</span>
                    <span className="hidden sm:inline">Balance Request</span>
                  </TabsTrigger>
                  <TabsTrigger value="balancePayment">
                    <span className="sm:hidden">Bal. Pay</span>
                    <span className="hidden sm:inline">Balance Payment</span>
                  </TabsTrigger>
                  <TabsTrigger value="receipt">Receipt</TabsTrigger>
                </TabsList>
              ) : (
                // Traditional 4-step Tabs
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="po">
                    <span className="sm:hidden">PO</span>
                    <span className="hidden sm:inline">Purchase Order</span>
                  </TabsTrigger>
                  <TabsTrigger value="invoice">Invoice</TabsTrigger>
                  <TabsTrigger value="payment">Payment</TabsTrigger>
                  <TabsTrigger value="receipt">Receipt</TabsTrigger>
                </TabsList>
              )}

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

                    {/* Show manufacturer document upload for seller (manufacturer) before acknowledgment */}
                    {documents.po.status === 'pending' && 
                     documents.po.issued_to_org_id === userProfile.organization_id && (
                      <ManufacturerDocumentUpload
                        documentId={documents.po.id}
                        orderId={orderId}
                        companyId={orderData?.company_id}
                        onUploadComplete={setManufacturerDocUrl}
                        existingFileUrl={manufacturerDocUrl}
                      />
                    )}

                    <AcknowledgeButton
                      document={documents.po as Document}
                      userProfile={userProfileWithSignature}
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

                    {/* Show manufacturer document if uploaded */}
                    {manufacturerDocUrl && (
                      <div className="space-y-3">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <p className="text-sm text-blue-800 font-medium mb-3">
                            📄 Proforma Invoice (PI) Available
                          </p>
                          <Button
                            onClick={async () => {
                              setDownloading('manufacturer-doc')
                              try {
                                const { data, error } = await supabase.storage
                                  .from('order-documents')
                                  .download(manufacturerDocUrl)

                                if (error) throw error

                                const url = URL.createObjectURL(data)
                                const a = document.createElement('a')
                                a.href = url
                                a.download = manufacturerDocUrl.split('/').pop() || 'proforma-invoice.pdf'
                                document.body.appendChild(a)
                                a.click()
                                document.body.removeChild(a)
                                URL.revokeObjectURL(url)

                                toast({
                                  title: 'Success',
                                  description: 'Proforma Invoice downloaded successfully'
                                })
                              } catch (error: any) {
                                console.error('Error downloading proforma invoice:', error)
                                toast({
                                  title: 'Download Failed',
                                  description: 'Failed to download Proforma Invoice',
                                  variant: 'destructive'
                                })
                              } finally {
                                setDownloading(null)
                              }
                            }}
                            disabled={downloading === 'manufacturer-doc'}
                            className="w-full bg-blue-600 hover:bg-blue-700"
                          >
                            {downloading === 'manufacturer-doc' ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Downloading...
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4 mr-2" />
                                Download Proforma Invoice (PI)
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

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
                      userProfile={userProfileWithSignature}
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
                        {!hasReviewedPaymentProof && documents.payment?.status === 'pending' && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-blue-800 font-medium">
                              📋 Please download and review the payment proof before acknowledging the payment
                            </p>
                          </div>
                        )}
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
                      userProfile={userProfileWithSignature}
                      onSuccess={loadData}
                      paymentProofUrl={paymentProofUrl}
                      hasReviewedPaymentProof={hasReviewedPaymentProof}
                    />
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Payment will be created after Invoice is acknowledged
                  </div>
                )}
              </TabsContent>

              {/* Deposit Invoice Tab (50/50 Split) */}
              <TabsContent value="depositInvoice" className="space-y-4">
                {documents.depositInvoice ? (
                  <div className="space-y-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h3 className="font-semibold text-green-900 mb-2">Deposit Invoice Details ({depositPercentage}%)</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-green-700">Document No:</span>{' '}
                          <span className="font-medium">{documents.depositInvoice.doc_no}</span>
                        </div>
                        <div>
                          <span className="text-green-700">Status:</span>{' '}
                          <span className="font-medium capitalize">{documents.depositInvoice.status}</span>
                        </div>
                        <div>
                          <span className="text-green-700">Created:</span>{' '}
                          <span>{formatDate(documents.depositInvoice.created_at)}</span>
                        </div>
                        {documents.depositInvoice.acknowledged_at && (
                          <div>
                            <span className="text-green-700">Acknowledged:</span>{' '}
                            <span>{formatDate(documents.depositInvoice.acknowledged_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        onClick={() => handleDownload(documents.depositInvoice!.id, 'INVOICE')}
                        disabled={downloading === documents.depositInvoice!.id}
                        className="flex-1"
                      >
                        {downloading === documents.depositInvoice!.id ? (
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

                    {requiresPaymentProof && documents.depositInvoice.status === 'pending' && (
                      <PaymentProofUpload
                        documentId={documents.depositInvoice.id}
                        orderId={orderId}
                        companyId={orderData?.company_id}
                        onUploadComplete={setPaymentProofUrl}
                        existingFileUrl={paymentProofUrl}
                      />
                    )}

                    <AcknowledgeButton
                      document={documents.depositInvoice}
                      userProfile={userProfileWithSignature}
                      onSuccess={loadData}
                      requiresPaymentProof={requiresPaymentProof}
                      paymentProofUrl={paymentProofUrl}
                    />
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Deposit Invoice will be created after Purchase Order is acknowledged
                  </div>
                )}
              </TabsContent>

              {/* Deposit Payment Tab (50/50 Split) */}
              <TabsContent value="depositPayment" className="space-y-4">
                {documents.depositPayment ? (
                  <div className="space-y-4">
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <h3 className="font-semibold text-purple-900 mb-2">Deposit Payment Details ({depositPercentage}%)</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-purple-700">Document No:</span>{' '}
                          <span className="font-medium">{documents.depositPayment.doc_no}</span>
                        </div>
                        <div>
                          <span className="text-purple-700">Status:</span>{' '}
                          <span className="font-medium capitalize">{documents.depositPayment.status}</span>
                        </div>
                        <div>
                          <span className="text-purple-700">Created:</span>{' '}
                          <span>{formatDate(documents.depositPayment.created_at)}</span>
                        </div>
                        {documents.depositPayment.acknowledged_at && (
                          <div>
                            <span className="text-purple-700">Acknowledged:</span>{' '}
                            <span>{formatDate(documents.depositPayment.acknowledged_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {paymentProofUrl && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-800 font-medium mb-3">
                          📎 Payment Proof Uploaded
                        </p>
                        <Button
                          onClick={async () => {
                            setDownloading('payment-proof')
                            try {
                              const { data, error } = await supabase.storage
                                .from('order-documents')
                                .download(paymentProofUrl)

                              if (error) throw error

                              const url = URL.createObjectURL(data)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = paymentProofUrl.split('/').pop() || 'payment-proof.pdf'
                              document.body.appendChild(a)
                              a.click()
                              document.body.removeChild(a)
                              URL.revokeObjectURL(url)

                              toast({
                                title: 'Success',
                                description: 'Payment proof downloaded successfully'
                              })
                            } catch (error: any) {
                              console.error('Error downloading payment proof:', error)
                              toast({
                                title: 'Download Failed',
                                description: 'Failed to download payment proof',
                                variant: 'destructive'
                              })
                            } finally {
                              setDownloading(null)
                            }
                          }}
                          disabled={downloading === 'payment-proof'}
                          className="w-full bg-blue-600 hover:bg-blue-700"
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
                    )}

                    <PaymentProofUpload
                      documentId={documents.depositPayment.id}
                      orderId={orderId}
                      companyId={orderData?.company_id}
                      onUploadComplete={setPaymentProofUrl}
                      existingFileUrl={paymentProofUrl}
                    />

                    <div className="flex gap-3">
                      <Button
                        onClick={() => handleDownload(documents.depositPayment!.id, 'PAYMENT')}
                        disabled={downloading === documents.depositPayment!.id}
                        className="flex-1"
                      >
                        {downloading === documents.depositPayment!.id ? (
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

                      <AcknowledgeButton
                        document={documents.depositPayment}
                        userProfile={userProfileWithSignature}
                        onSuccess={loadData}
                        requiresPaymentProof={requiresPaymentProof}
                        paymentProofUrl={paymentProofUrl}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Deposit Payment will be created after Deposit Invoice is acknowledged
                  </div>
                )}
              </TabsContent>

              {/* Balance Request Tab (50/50 Split) */}
              <TabsContent value="balanceRequest" className="space-y-4">
                {documents.balancePaymentRequest ? (
                  <div className="space-y-4">
                    <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                      <h3 className="font-semibold text-teal-900 mb-2">Balance Payment Request ({balancePercentage}%)</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-teal-700">Document No:</span>{' '}
                          <span className="font-medium">{documents.balancePaymentRequest.doc_no}</span>
                        </div>
                        <div>
                          <span className="text-teal-700">Status:</span>{' '}
                          <span className="font-medium capitalize">{documents.balancePaymentRequest.status}</span>
                        </div>
                        <div>
                          <span className="text-teal-700">Created:</span>{' '}
                          <span>{formatDate(documents.balancePaymentRequest.created_at)}</span>
                        </div>
                        {documents.balancePaymentRequest.acknowledged_at && (
                          <div>
                            <span className="text-teal-700">Approved:</span>{' '}
                            <span>{formatDate(documents.balancePaymentRequest.acknowledged_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm text-blue-900">
                        <strong>ℹ️ Auto-Generated:</strong> This balance payment request was automatically created when products were received at the warehouse.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <Button
                        onClick={() => handleDownload(documents.balancePaymentRequest!.id, 'PAYMENT_REQUEST')}
                        disabled={downloading === documents.balancePaymentRequest!.id}
                        className="w-full"
                      >
                        {downloading === documents.balancePaymentRequest!.id ? (
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

                      {documents.balancePaymentRequest.status === 'pending' && (
                        <PaymentProofUpload
                          documentId={documents.balancePaymentRequest.id}
                          orderId={orderId}
                          companyId={(documents.balancePaymentRequest as any)?.company_id ?? orderData?.company_id ?? ''}
                          onUploadComplete={setBalancePaymentProofUrl}
                          existingFileUrl={balancePaymentProofUrl}
                          variant="balance"
                        />
                      )}

                      {isHQAdmin && documents.balancePaymentRequest.status === 'pending' && (
                        <div className="space-y-2">
                          <Button
                            onClick={() => handleApproveBalancePaymentRequest(documents.balancePaymentRequest!.id)}
                            disabled={approvingBalanceRequest || !balancePaymentProofUrl}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            {approvingBalanceRequest ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Approving...
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                Approve Balance Payment Request
                              </>
                            )}
                          </Button>
                          <p className="text-xs text-gray-500 text-center">
                            This will create the balance PAYMENT document for Finance processing.
                          </p>
                          {!balancePaymentProofUrl && (
                            <p className="text-xs text-amber-600 text-center">
                              Attach the final payment document above before requesting approval.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Balance Payment Request will be auto-generated when products are received at warehouse
                  </div>
                )}
              </TabsContent>

              {/* Balance Payment Tab (50/50 Split) */}
              <TabsContent value="balancePayment" className="space-y-4">
                {documents.balancePayment ? (
                  <div className="space-y-4">
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                      <h3 className="font-semibold text-indigo-900 mb-2">Balance Payment Details ({balancePercentage}%)</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-indigo-700">Document No:</span>{' '}
                          <span className="font-medium">{documents.balancePayment.doc_no}</span>
                        </div>
                        <div>
                          <span className="text-indigo-700">Status:</span>{' '}
                          <span className="font-medium capitalize">{documents.balancePayment.status}</span>
                        </div>
                        <div>
                          <span className="text-indigo-700">Created:</span>{' '}
                          <span>{formatDate(documents.balancePayment.created_at)}</span>
                        </div>
                        {documents.balancePayment.acknowledged_at && (
                          <div>
                            <span className="text-indigo-700">Acknowledged:</span>{' '}
                            <span>{formatDate(documents.balancePayment.acknowledged_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {balancePaymentProofUrl ? (
                      <div className="space-y-3">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <p className="text-sm text-blue-900 font-medium">
                            📎 Final balance payment proof is attached. Please download and confirm before acknowledging.
                          </p>
                        </div>
                        <Button
                          onClick={handleDownloadBalancePaymentProof}
                          disabled={downloading === 'balance-proof'}
                          className="w-full bg-blue-600 hover:bg-blue-700"
                        >
                          {downloading === 'balance-proof' ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Downloading...
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4 mr-2" />
                              Download Final Payment Proof
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <p className="text-sm text-amber-900 font-medium">
                          Awaiting HQ to upload the final payment document. Contact the finance team if you cannot locate the proof.
                        </p>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <Button
                        onClick={() => handleDownload(documents.balancePayment!.id, 'PAYMENT')}
                        disabled={downloading === documents.balancePayment!.id}
                        className="flex-1"
                      >
                        {downloading === documents.balancePayment!.id ? (
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

                      <AcknowledgeButton
                        document={documents.balancePayment}
                        userProfile={userProfileWithSignature}
                        onSuccess={loadData}
                        paymentProofUrl={balancePaymentProofUrl}
                        hasReviewedPaymentProof={hasReviewedBalanceProof}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Balance Payment will be created after Balance Request is approved
                  </div>
                )}
              </TabsContent>

              {/* Receipt Tab - Shows deposit receipt (partial) or both receipts (complete) */}
              <TabsContent value="receipt" className="space-y-4">
                {documents.depositReceipt || documents.finalReceipt ? (
                  <div className="space-y-6">
                    {/* Deposit Receipt - Dynamic percentage based on payment_terms */}
                    {documents.depositReceipt && (
                      <div className="space-y-4">
                        <div className={`rounded-lg p-4 ${
                          documents.finalReceipt 
                            ? 'bg-emerald-50 border border-emerald-200' 
                            : 'bg-amber-50 border border-amber-200'
                        }`}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className={`font-semibold ${
                              documents.finalReceipt ? 'text-emerald-900' : 'text-amber-900'
                            }`}>
                              Deposit Receipt ({depositPercentage}%)
                            </h3>
                            <span className={`px-2 py-1 text-xs font-semibold rounded ${
                              documents.finalReceipt 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              DEPOSIT
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <span className={documents.finalReceipt ? 'text-emerald-700' : 'text-amber-700'}>Document No:</span>{' '}
                              <span className="font-medium">{documents.depositReceipt.doc_no}</span>
                            </div>
                            <div>
                              <span className={documents.finalReceipt ? 'text-emerald-700' : 'text-amber-700'}>Status:</span>{' '}
                              <span className="font-medium">{depositPercentage}% Payment Received</span>
                            </div>
                            <div>
                              <span className={documents.finalReceipt ? 'text-emerald-700' : 'text-amber-700'}>Created:</span>{' '}
                              <span>{formatDate(documents.depositReceipt.created_at)}</span>
                            </div>
                          </div>
                        </div>

                        <Button
                          onClick={() => handleDownload(documents.depositReceipt!.id, 'RECEIPT')}
                          disabled={downloading === documents.depositReceipt!.id}
                          className={`w-full ${
                            documents.finalReceipt 
                              ? 'bg-emerald-600 hover:bg-emerald-700' 
                              : 'bg-amber-600 hover:bg-amber-700'
                          }`}
                        >
                          {downloading === documents.depositReceipt!.id ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Downloading...
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4 mr-2" />
                              Download Deposit Receipt ({depositPercentage}%)
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Final/Balance Receipt - Shows balance percentage if deposit exists */}
                    {documents.finalReceipt && (
                      <div className="space-y-4">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="font-semibold text-emerald-900">
                              {documents.depositReceipt 
                                ? `Balance Receipt (${balancePercentage}%)` 
                                : 'Receipt (100%)'}
                            </h3>
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded">
                              {documents.depositReceipt ? 'BALANCE' : 'FINAL'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <span className="text-emerald-700">Document No:</span>{' '}
                              <span className="font-medium">{documents.finalReceipt.doc_no}</span>
                            </div>
                            <div>
                              <span className="text-emerald-700">Status:</span>{' '}
                              <span className="font-medium">100% Payment Completed</span>
                            </div>
                            <div>
                              <span className="text-emerald-700">Created:</span>{' '}
                              <span>{formatDate(documents.finalReceipt.created_at)}</span>
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
                          onClick={() => handleDownload(documents.finalReceipt!.id, 'RECEIPT')}
                          disabled={downloading === documents.finalReceipt!.id}
                          className="w-full bg-emerald-600 hover:bg-emerald-700"
                        >
                          {downloading === documents.finalReceipt!.id ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Downloading...
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4 mr-2" />
                              {documents.depositReceipt 
                                ? `Download Balance Receipt (${balancePercentage}%)` 
                                : 'Download Receipt (100%)'}
                            </>
                          )}
                        </Button>

                        <Button
                          onClick={handleDownloadCompletePackage}
                          disabled={downloading === 'bundle'}
                          className="w-full"
                          variant="outline"
                        >
                          {downloading === 'bundle' ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Bundling Documents...
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4 mr-2" />
                              Download All Documents (PO → Final Receipt)
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    {useSplitPayment 
                      ? `Receipts will be created after each payment acknowledgment: Deposit Receipt (${depositPercentage}%) → Balance Receipt (${balancePercentage}%)`
                      : 'Receipt will be created after Payment is acknowledged'}
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
