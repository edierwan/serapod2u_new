'use client'

import { useState, useEffect } from 'react'
import { X, Download, FileText, Printer } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { Document } from '@/types/order'

interface OrderDocumentsDialogProps {
  orderId: string
  orderNo: string
  onClose: () => void
}

type TabType = 'order' | 'purchase_order' | 'invoice' | 'receipt'

export default function OrderDocumentsDialog({
  orderId,
  orderNo,
  onClose
}: OrderDocumentsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>('order')
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [orderData, setOrderData] = useState<any>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    loadDocuments()
    loadOrderData()
  }, [orderId])

  const loadDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select(`
          *,
          issued_by_org:organizations!documents_issued_by_org_id_fkey(org_name),
          issued_to_org:organizations!documents_issued_to_org_id_fkey(org_name)
        `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: true })

      if (error) throw error
      setDocuments(data || [])
    } catch (error: any) {
      console.error('Error loading documents:', error)
      toast({
        title: "Error",
        description: "Failed to load documents",
        variant: "destructive"
      })
    }
  }

  const loadOrderData = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          buyer_org:organizations!orders_buyer_org_id_fkey(org_name, address, contact_phone, contact_email),
          seller_org:organizations!orders_seller_org_id_fkey(org_name, address, contact_phone, contact_email),
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
      toast({
        title: "Error",
        description: "Failed to load order data",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (type: TabType) => {
    setDownloading(type)
    try {
      const response = await fetch(`/api/documents/generate?orderId=${orderId}&type=${type}`)
      
      if (!response.ok) {
        throw new Error('Failed to generate document')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${orderNo}-${type}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: "Success",
        description: "Document downloaded successfully"
      })
    } catch (error: any) {
      console.error('Error downloading document:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to download document",
        variant: "destructive"
      })
    } finally {
      setDownloading(null)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not generated'
    return new Date(dateString).toLocaleDateString('en-MY', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: 'MYR'
    }).format(amount)
  }

  const tabs = [
    { id: 'order' as TabType, label: 'Order', icon: FileText },
    { id: 'purchase_order' as TabType, label: 'Purchase Order', icon: FileText },
    { id: 'invoice' as TabType, label: 'Invoice', icon: FileText },
    { id: 'receipt' as TabType, label: 'Receipt', icon: FileText }
  ]

  const renderOrderDocument = () => {
    if (!orderData) return <div>Loading...</div>

    const subtotal = orderData.order_items?.reduce((sum: number, item: any) => 
      sum + (item.line_total || 0), 0) || 0
    const tax = subtotal * 0.06 // 6% SST
    const grandTotal = subtotal + tax

    return (
      <div className="bg-white p-8">
        <div className="border-b pb-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">ORDER DOCUMENT</h1>
              <p className="text-gray-600">Official Order Record</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-gray-900">Order Number</p>
              <p className="text-2xl font-bold text-blue-600">{orderData.order_no}</p>
              <span className="inline-block mt-2 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
                {orderData.status}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded flex items-center justify-center mr-3">
                <span className="text-blue-600 font-bold">From</span>
              </div>
              <h3 className="font-semibold text-gray-700">From (Buyer)</h3>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="font-bold text-gray-900">{orderData.buyer_org?.org_name}</p>
              <p className="text-sm text-gray-600 mt-1">Company Type: HQ</p>
              {orderData.buyer_org?.address && (
                <p className="text-sm text-gray-600 mt-2">📍 {orderData.buyer_org.address}</p>
              )}
              {orderData.buyer_org?.contact_phone && (
                <p className="text-sm text-gray-600">📞 {orderData.buyer_org.contact_phone}</p>
              )}
              {orderData.buyer_org?.contact_email && (
                <p className="text-sm text-gray-600">✉️ {orderData.buyer_org.contact_email}</p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 bg-green-100 rounded flex items-center justify-center mr-3">
                <span className="text-green-600 font-bold">To</span>
              </div>
              <h3 className="font-semibold text-gray-700">To (Seller)</h3>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="font-bold text-gray-900">{orderData.seller_org?.org_name}</p>
              <p className="text-sm text-gray-600 mt-1">Company Type: MANUFACTURER</p>
              {orderData.seller_org?.address && (
                <p className="text-sm text-gray-600 mt-2">📍 {orderData.seller_org.address}</p>
              )}
              {orderData.seller_org?.contact_phone && (
                <p className="text-sm text-gray-600">📞 {orderData.seller_org.contact_phone}</p>
              )}
              {orderData.seller_org?.contact_email && (
                <p className="text-sm text-gray-600">✉️ {orderData.seller_org.contact_email}</p>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Order Date</p>
            <p className="font-semibold text-gray-900">📅 {formatDate(orderData.created_at)}</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Payment Terms</p>
            <p className="font-semibold text-gray-900">Net 30 Days</p>
          </div>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">Order Items</h3>
          <table className="w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Item</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Quantity</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Unit Price</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Total</th>
              </tr>
            </thead>
            <tbody>
              {orderData.order_items?.map((item: any, index: number) => (
                <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3 text-sm text-gray-900">{item.product?.product_name || 'Product1'}</td>
                  <td className="px-4 py-3 text-center text-sm text-gray-900">{item.qty.toFixed(2)} units</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-900">{formatCurrency(item.unit_price)}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">{formatCurrency(item.line_total || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-80">
            <div className="flex justify-between py-2 border-t">
              <span className="text-gray-700">Subtotal:</span>
              <span className="font-semibold text-gray-900">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-700">Tax (6% SST):</span>
              <span className="font-semibold text-gray-900">{formatCurrency(tax)}</span>
            </div>
            <div className="flex justify-between py-3 border-t-2 border-gray-300">
              <span className="text-lg font-bold text-gray-900">Grand Total:</span>
              <span className="text-lg font-bold text-blue-600">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderPurchaseOrder = () => {
    const poDoc = documents.find(d => d.doc_type === 'PO')
    
    return (
      <div className="bg-white p-8">
        <div className="text-center border-b pb-6 mb-6">
          <h1 className="text-3xl font-bold text-blue-600 mb-2">PURCHASE ORDER</h1>
          {poDoc ? (
            <div className="space-y-2">
              <p className="text-lg text-gray-700">PO Number: <span className="font-bold">{poDoc.doc_no}</span></p>
              <p className="text-sm text-gray-600">Generated: {formatDate(poDoc.created_at)}</p>
              <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                Status: {poDoc.status}
              </span>
            </div>
          ) : (
            <p className="text-gray-500 mt-2">Purchase Order not yet generated</p>
          )}
        </div>
        
        {poDoc ? renderOrderDocument() : (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Purchase Order will be generated after order approval</p>
          </div>
        )}
      </div>
    )
  }

  const renderInvoice = () => {
    const invoiceDoc = documents.find(d => d.doc_type === 'INVOICE')
    
    return (
      <div className="bg-white p-8">
        <div className="text-center border-b pb-6 mb-6">
          <h1 className="text-3xl font-bold text-green-600 mb-2">INVOICE</h1>
          {invoiceDoc ? (
            <div className="space-y-2">
              <p className="text-lg text-gray-700">Invoice Number: <span className="font-bold">{invoiceDoc.doc_no}</span></p>
              <p className="text-sm text-gray-600">Generated: {formatDate(invoiceDoc.created_at)}</p>
              {invoiceDoc.acknowledged_at && (
                <p className="text-sm text-green-600">Acknowledged: {formatDate(invoiceDoc.acknowledged_at)}</p>
              )}
              <span className="inline-block px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
                Status: {invoiceDoc.status}
              </span>
            </div>
          ) : (
            <p className="text-gray-500 mt-2">Invoice not yet generated</p>
          )}
        </div>
        
        {invoiceDoc ? renderOrderDocument() : (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Invoice will be generated after purchase order</p>
          </div>
        )}
      </div>
    )
  }

  const renderReceipt = () => {
    const receiptDoc = documents.find(d => d.doc_type === 'RECEIPT')
    
    return (
      <div className="bg-white p-8">
        <div className="text-center border-b pb-6 mb-6">
          <h1 className="text-3xl font-bold text-purple-600 mb-2">RECEIPT</h1>
          {receiptDoc ? (
            <div className="space-y-2">
              <p className="text-lg text-gray-700">Receipt Number: <span className="font-bold">{receiptDoc.doc_no}</span></p>
              <p className="text-sm text-gray-600">Generated: {formatDate(receiptDoc.created_at)}</p>
              <span className="inline-block px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-semibold">
                Status: {receiptDoc.status}
              </span>
            </div>
          ) : (
            <p className="text-gray-500 mt-2">Receipt not yet generated</p>
          )}
        </div>
        
        {receiptDoc ? renderOrderDocument() : (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Receipt will be generated after delivery</p>
          </div>
        )}
      </div>
    )
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'order':
        return renderOrderDocument()
      case 'purchase_order':
        return renderPurchaseOrder()
      case 'invoice':
        return renderInvoice()
      case 'receipt':
        return renderReceipt()
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Order Documents</h2>
            <p className="text-sm text-gray-500 mt-1">
              View and download all related documents for {orderNo}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => window.print()}
              variant="outline"
              size="sm"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 px-6 pt-4 border-b">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 font-semibold'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4 animate-pulse" />
                <p className="text-gray-600">Loading documents...</p>
              </div>
            </div>
          ) : (
            renderContent()
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-gray-50">
          <p className="text-sm text-gray-600">
            Document generated on {new Date().toLocaleDateString('en-MY')}
          </p>
          <Button
            onClick={() => handleDownload(activeTab)}
            disabled={downloading === activeTab}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Download className="w-4 h-4 mr-2" />
            {downloading === activeTab ? 'Downloading...' : 'Download Order PDF'}
          </Button>
        </div>
      </div>
    </div>
  )
}
