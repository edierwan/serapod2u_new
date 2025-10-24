'use client'

import { useState, useEffect } from 'react'
import { 
  ArrowLeft, 
  Package, 
  Clock, 
  CheckCircle2, 
  FileText, 
  CreditCard, 
  Truck, 
  Building2,
  Calendar,
  DollarSign
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import AvailableActionsCard from './AvailableActionsCard'
import OrderDocumentsDialogEnhanced from './OrderDocumentsDialogEnhanced'

interface OrderDetails {
  id: string
  order_no: string
  order_type: 'H2M' | 'D2H' | 'S2D'
  status: 'draft' | 'submitted' | 'approved' | 'closed'
  buyer_org_name: string
  seller_org_name: string
  total_items: number
  total_amount: number
  created_at: string
  approved_at: string | null
  approved_by_name: string | null
  created_by_name: string | null
  documents: {
    po_date: string | null
    po_created_by: string | null
    invoice_date: string | null
    invoice_created_by: string | null
    payment_date: string | null
    payment_created_by: string | null
    receipt_date: string | null
    receipt_created_by: string | null
  }
}

interface TrackOrderViewProps {
  userProfile: any
  onViewChange: (view: string) => void
}

export default function TrackOrderView({ userProfile, onViewChange }: TrackOrderViewProps) {
  const [loading, setLoading] = useState(true)
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null)
  const [showDocumentsDialog, setShowDocumentsDialog] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    loadOrderDetails()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Check if we should auto-open the documents dialog
    const selectedDocumentId = sessionStorage.getItem('selectedDocumentId')
    if (selectedDocumentId && orderDetails) {
      setShowDocumentsDialog(true)
      // Clear the flag after opening
      sessionStorage.removeItem('selectedDocumentId')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderDetails])

  const loadOrderDetails = async () => {
    try {
      setLoading(true)
      
      // Get order ID from sessionStorage
      const trackingOrderId = sessionStorage.getItem('trackingOrderId')
      
      if (!trackingOrderId) {
        toast({
          title: "Error",
          description: "No order selected for tracking",
          variant: "destructive"
        })
        onViewChange('orders')
        return
      }

      // Fetch order details with user information
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select(`
          id,
          order_no,
          order_type,
          status,
          created_at,
          approved_at,
          buyer_org_id,
          seller_org_id,
          created_by,
          approved_by
        `)
        .eq('id', trackingOrderId)
        .single()

      if (orderError) throw orderError

      // Fetch buyer org name
      const { data: buyerOrg } = await supabase
        .from('organizations')
        .select('org_name')
        .eq('id', order.buyer_org_id)
        .single()

      // Fetch seller org name
      const { data: sellerOrg } = await supabase
        .from('organizations')
        .select('org_name')
        .eq('id', order.seller_org_id)
        .single()

      // Fetch created by user
      const { data: createdByUser } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', order.created_by)
        .single()

      // Fetch approved by user
      let approvedByUser = null
      if (order.approved_by) {
        const { data } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', order.approved_by)
          .single()
        approvedByUser = data
      }

      // Fetch order items to calculate totals
      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('qty, line_total')
        .eq('order_id', trackingOrderId)

      if (itemsError) throw itemsError

      const totalItems = items?.reduce((sum, item) => sum + item.qty, 0) || 0
      const totalAmount = items?.reduce((sum, item) => sum + (item.line_total || 0), 0) || 0

      // Fetch documents timeline with creator info
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select(`
          doc_type, 
          acknowledged_at, 
          created_at,
          created_by,
          acknowledged_by
        `)
        .eq('order_id', trackingOrderId)
        .order('created_at', { ascending: true })

      if (docsError) throw docsError

      // Get user names for document creators
      const getUserName = async (userId: string | null) => {
        if (!userId) return null
        const { data } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', userId)
          .single()
        return data?.full_name || null
      }

      const poDoc = documents?.find(d => d.doc_type === 'PO')
      const invoiceDoc = documents?.find(d => d.doc_type === 'INVOICE')
      const paymentDoc = documents?.find(d => d.doc_type === 'PAYMENT')
      const receiptDoc = documents?.find(d => d.doc_type === 'RECEIPT')

      // Extract document dates and creators
      const docDates = {
        po_date: poDoc?.created_at || null,
        po_created_by: poDoc ? await getUserName(poDoc.created_by) : null,
        // Invoice shows as "sent" when created by seller, then updated when acknowledged by buyer
        invoice_date: invoiceDoc?.acknowledged_at || invoiceDoc?.created_at || null,
        invoice_created_by: invoiceDoc ? await getUserName(invoiceDoc.acknowledged_by || invoiceDoc.created_by) : null,
        payment_date: paymentDoc?.acknowledged_at || null,
        payment_created_by: paymentDoc ? await getUserName(paymentDoc.acknowledged_by) : null,
        receipt_date: receiptDoc?.created_at || null,
        receipt_created_by: receiptDoc ? await getUserName(receiptDoc.created_by) : null
      }

      setOrderDetails({
        id: order.id,
        order_no: order.order_no,
        order_type: order.order_type,
        status: order.status,
        buyer_org_name: buyerOrg?.org_name || 'Unknown',
        seller_org_name: sellerOrg?.org_name || 'Unknown',
        total_items: totalItems,
        total_amount: totalAmount,
        created_at: order.created_at,
        approved_at: order.approved_at,
        created_by_name: createdByUser?.full_name || 'Unknown',
        approved_by_name: approvedByUser?.full_name || null,
        documents: docDates
      })

    } catch (error: any) {
      console.error('Error loading order details:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to load order details",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-500'
      case 'submitted': return 'bg-blue-500'
      case 'approved': return 'bg-green-500'
      case 'closed': return 'bg-purple-500'
      default: return 'bg-gray-500'
    }
  }

  const getOrderTypeLabel = (type: string) => {
    switch (type) {
      case 'H2M': return 'HQ to Manufacturer'
      case 'D2H': return 'Distributor to HQ'
      case 'S2D': return 'Shop to Distributor'
      default: return type
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Pending'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return ''
    
    const now = new Date()
    const date = new Date(dateString)
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`
    if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}mo ago`
    return `${Math.floor(diffInSeconds / 31536000)}y ago`
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(amount)
  }

  // Timeline steps based on order workflow
  const getTimelineSteps = () => {
    if (!orderDetails) return []

    const steps = [
      {
        label: 'Order Created',
        icon: Package,
        completed: true,
        date: orderDetails.created_at,
        description: 'Order placed successfully',
        actionBy: orderDetails.created_by_name,
        bgColor: 'bg-green-50',
        iconColor: 'bg-green-100 text-green-600',
        borderColor: 'border-green-200'
      },
      {
        label: 'Awaiting Approval',
        icon: Clock,
        completed: orderDetails.status !== 'draft' && orderDetails.status !== 'submitted',
        date: orderDetails.status === 'submitted' ? orderDetails.created_at : null,
        description: orderDetails.status === 'draft' ? 'Order in draft' : 'Pending approval',
        actionBy: null,
        bgColor: 'bg-yellow-50',
        iconColor: 'bg-yellow-100 text-yellow-600',
        borderColor: 'border-yellow-200'
      },
      {
        label: 'Order Approved',
        icon: CheckCircle2,
        completed: orderDetails.status === 'approved' || orderDetails.status === 'closed',
        date: orderDetails.approved_at,
        description: 'Order approved by seller',
        actionBy: orderDetails.approved_by_name,
        bgColor: 'bg-blue-50',
        iconColor: 'bg-blue-100 text-blue-600',
        borderColor: 'border-blue-200'
      },
      {
        label: 'PO Generation',
        icon: FileText,
        completed: !!orderDetails.documents.po_date,
        date: orderDetails.documents.po_date,
        description: 'Purchase Order generated',
        actionBy: orderDetails.documents.po_created_by || 'System Auto-Generation',
        bgColor: 'bg-purple-50',
        iconColor: 'bg-purple-100 text-purple-600',
        borderColor: 'border-purple-200'
      },
      {
        label: 'Invoice Sent',
        icon: FileText,
        completed: !!orderDetails.documents.invoice_date,
        date: orderDetails.documents.invoice_date,
        description: 'Invoice acknowledged by buyer',
        actionBy: orderDetails.documents.invoice_created_by,
        bgColor: 'bg-indigo-50',
        iconColor: 'bg-indigo-100 text-indigo-600',
        borderColor: 'border-indigo-200'
      },
      {
        label: 'Payment',
        icon: CreditCard,
        completed: !!orderDetails.documents.payment_date,
        date: orderDetails.documents.payment_date,
        description: 'Payment processed',
        actionBy: orderDetails.documents.payment_created_by,
        bgColor: 'bg-amber-50',
        iconColor: 'bg-amber-100 text-amber-600',
        borderColor: 'border-amber-200'
      },
      {
        label: 'Delivery',
        icon: Truck,
        completed: !!orderDetails.documents.receipt_date,
        date: orderDetails.documents.receipt_date,
        description: 'Receipt acknowledged',
        actionBy: orderDetails.documents.receipt_created_by,
        bgColor: 'bg-teal-50',
        iconColor: 'bg-teal-100 text-teal-600',
        borderColor: 'border-teal-200'
      },
      {
        label: 'Completed',
        icon: CheckCircle2,
        completed: orderDetails.status === 'closed',
        date: orderDetails.documents.receipt_date,
        description: 'Order completed',
        actionBy: null,
        bgColor: 'bg-emerald-50',
        iconColor: 'bg-emerald-100 text-emerald-600',
        borderColor: 'border-emerald-200'
      }
    ]

    return steps
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">Loading order details...</p>
        </div>
      </div>
    )
  }

  if (!orderDetails) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">Order not found</p>
          <Button 
            onClick={() => onViewChange('orders')} 
            variant="outline" 
            className="mt-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Orders
          </Button>
        </div>
      </div>
    )
  }

  const timelineSteps = getTimelineSteps()
  const completedSteps = timelineSteps.filter(s => s.completed).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            onClick={() => onViewChange('orders')}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{orderDetails.order_no}</h2>
            <p className="text-sm text-gray-500">{getOrderTypeLabel(orderDetails.order_type)}</p>
          </div>
        </div>
        <Badge className={`${getStatusBadgeColor(orderDetails.status)} text-white`}>
          {orderDetails.status.toUpperCase()}
        </Badge>
      </div>

      {/* Order Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Order Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Buyer</p>
                <p className="font-semibold text-gray-900">{orderDetails.buyer_org_name}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Building2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Seller</p>
                <p className="font-semibold text-gray-900">{orderDetails.seller_org_name}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Package className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Items</p>
                <p className="font-semibold text-gray-900">{orderDetails.total_items} units</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Amount</p>
                <p className="font-semibold text-gray-900">{formatCurrency(orderDetails.total_amount)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Calendar className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Created Date</p>
                <p className="font-semibold text-gray-900">{formatDate(orderDetails.created_at)}</p>
              </div>
            </div>

            {orderDetails.approved_at && (
              <div className="flex items-start gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Approved Date</p>
                  <p className="font-semibold text-gray-900">{formatDate(orderDetails.approved_at)}</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Order Timeline */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Order Timeline</CardTitle>
            <div className="text-sm text-gray-500">
              {completedSteps} of {timelineSteps.length} steps completed
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Progress Bar */}
          <div className="mb-8">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(completedSteps / timelineSteps.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Timeline Steps */}
          <div className="space-y-4">
            {timelineSteps.map((step, index) => {
              const Icon = step.icon
              const isLast = index === timelineSteps.length - 1
              
              return (
                <div key={index} className="relative">
                  {/* Connecting Line */}
                  {!isLast && (
                    <div 
                      className={`absolute left-5 top-12 w-0.5 h-full ${
                        step.completed && timelineSteps[index + 1]?.completed
                          ? 'bg-gradient-to-b from-green-300 to-green-300'
                          : 'bg-gray-200'
                      }`}
                    />
                  )}
                  
                  {/* Timeline Item */}
                  <div className={`relative flex items-start gap-4 p-4 rounded-lg border-2 transition-all ${
                    step.completed 
                      ? `${step.bgColor} ${step.borderColor}` 
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    {/* Icon */}
                    <div className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-sm ${
                      step.completed 
                        ? step.iconColor
                        : 'bg-gray-200 text-gray-400'
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className={`font-semibold ${
                              step.completed ? 'text-gray-900' : 'text-gray-400'
                            }`}>
                              {step.label}
                            </h4>
                            {step.completed && step.date && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white border border-gray-200 text-gray-600">
                                <Clock className="w-3 h-3 mr-1" />
                                {formatTimeAgo(step.date)}
                              </span>
                            )}
                            {step.completed && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                Completed
                              </span>
                            )}
                          </div>
                          
                          <p className={`text-sm mb-2 ${
                            step.completed ? 'text-gray-600' : 'text-gray-400'
                          }`}>
                            {step.description}
                          </p>
                          
                          {/* Additional Info */}
                          <div className="flex flex-wrap items-center gap-4 text-sm">
                            {step.actionBy && step.completed && (
                              <div className="flex items-center gap-1.5 text-gray-600">
                                <span className="text-gray-500">by</span>
                                <span className="font-medium">{step.actionBy}</span>
                              </div>
                            )}
                            
                            {step.date && step.completed && (
                              <div className="flex items-center gap-1.5 text-gray-500">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>{formatDate(step.date)}</span>
                              </div>
                            )}
                            
                            {!step.completed && (
                              <span className="inline-flex items-center text-gray-400">
                                <Clock className="w-3.5 h-3.5 mr-1" />
                                Pending
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Available Actions */}
      <AvailableActionsCard
        orderId={orderDetails.id}
        orderNo={orderDetails.order_no}
        onViewDocuments={() => setShowDocumentsDialog(true)}
        onReportIssue={() => {
          toast({
            title: "Report Issue",
            description: "Issue reporting feature coming soon!"
          })
        }}
      />

      {/* Documents Dialog */}
      {showDocumentsDialog && (
        <OrderDocumentsDialogEnhanced
          orderId={orderDetails.id}
          orderNo={orderDetails.order_no}
          userProfile={userProfile}
          onClose={() => {
            setShowDocumentsDialog(false)
            // Reload order details to refresh timeline after any document changes
            loadOrderDetails()
          }}
        />
      )}
    </div>
  )
}
