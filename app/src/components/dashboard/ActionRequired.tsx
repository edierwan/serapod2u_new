'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  FileText, 
  Receipt, 
  CreditCard, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ChevronRight,
  FileCheck,
  Package
} from 'lucide-react'
import { canAcknowledgeDocument, getDocumentTypeLabel, type Document } from '@/lib/document-permissions'

interface PendingDocument {
  id: string
  doc_type: 'PO' | 'INVOICE' | 'PAYMENT' | 'RECEIPT'
  doc_no: string
  status: string
  created_at: string
  issued_by_org_id: string
  issued_to_org_id: string
  order: {
    id: string
    order_no: string
    order_type: string
    status: string
  }
  issued_by_org: {
    org_name: string
    org_code: string
  }
}

interface ApprovedH2MOrder {
  id: string
  order_no: string
  order_type: string
  status: string
  approved_at: string
  buyer_org: {
    org_name: string
    org_code: string
  }
}

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  is_active: boolean
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  }
  roles: {
    role_name: string
    role_level: number
  }
}

interface ActionRequiredProps {
  userProfile: UserProfile
  onViewDocument: (orderId: string, documentId: string) => void
}

export default function ActionRequired({ userProfile, onViewDocument }: ActionRequiredProps) {
  const [pendingDocs, setPendingDocs] = useState<PendingDocument[]>([])
  const [approvedH2MOrders, setApprovedH2MOrders] = useState<ApprovedH2MOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [requirePaymentProof, setRequirePaymentProof] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadPendingDocuments()
    loadOrgSettings()
    
    // Load approved H2M orders for distributors
    if (userProfile.organizations.org_type_code === 'DIST') {
      loadApprovedH2MOrders()
    }
  }, [userProfile.organization_id])

  async function loadOrgSettings() {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', userProfile.organization_id)
        .single()

      if (error) throw error

      // Check if require_payment_proof is set, default to true
      const requireProof = data?.settings?.require_payment_proof ?? true
      setRequirePaymentProof(requireProof)
    } catch (error) {
      console.error('Error loading organization settings:', error)
      // Default to true on error
      setRequirePaymentProof(true)
    }
  }

  async function loadApprovedH2MOrders() {
    try {
      // Get parent org (HQ) for this distributor
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('parent_org_id')
        .eq('id', userProfile.organization_id)
        .single()

      if (orgError || !orgData?.parent_org_id) return

      // Get approved H2M orders from parent HQ in last 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_no,
          order_type,
          status,
          approved_at,
          buyer_org:organizations!orders_buyer_org_id_fkey (
            org_name,
            org_code
          )
        `)
        .eq('order_type', 'H2M')
        .eq('status', 'approved')
        .eq('buyer_org_id', orgData.parent_org_id)
        .gte('approved_at', thirtyDaysAgo.toISOString())
        .order('approved_at', { ascending: false })
        .limit(5)

      if (error) throw error

      // Transform data
      const transformedOrders: ApprovedH2MOrder[] = (data || []).map((order: any) => ({
        id: order.id,
        order_no: order.order_no,
        order_type: order.order_type,
        status: order.status,
        approved_at: order.approved_at,
        buyer_org: Array.isArray(order.buyer_org) ? order.buyer_org[0] : order.buyer_org,
      }))

      setApprovedH2MOrders(transformedOrders)
    } catch (error) {
      console.error('Error loading approved H2M orders:', error)
    }
  }

  async function loadPendingDocuments() {
    try {
      setLoading(true)

      // Get pending documents where user's org should acknowledge
      const { data, error } = await supabase
        .from('documents')
        .select(`
          id,
          doc_type,
          doc_no,
          status,
          created_at,
          issued_by_org_id,
          issued_to_org_id,
          order:orders!inner (
            id,
            order_no,
            order_type,
            status
          ),
          issued_by_org:organizations!documents_issued_by_org_id_fkey (
            org_name,
            org_code
          )
        `)
        .eq('status', 'pending')
        .eq('issued_to_org_id', userProfile.organization_id)
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) throw error

      // Filter documents that user can actually acknowledge
      const filteredDocs = (data || []).filter((doc: any) => {
        return canAcknowledgeDocument(doc as unknown as Document, {
          organizationId: userProfile.organization_id,
          orgTypeCode: userProfile.organizations.org_type_code,
          roleLevel: userProfile.roles.role_level
        })
      })

      // Transform data to match PendingDocument interface
      const transformedDocs: PendingDocument[] = filteredDocs.map((doc: any) => ({
        id: doc.id,
        doc_type: doc.doc_type,
        doc_no: doc.doc_no,
        status: doc.status,
        created_at: doc.created_at,
        issued_by_org_id: doc.issued_by_org_id,
        issued_to_org_id: doc.issued_to_org_id,
        order: Array.isArray(doc.order) ? doc.order[0] : doc.order,
        issued_by_org: Array.isArray(doc.issued_by_org) ? doc.issued_by_org[0] : doc.issued_by_org,
      }))

      setPendingDocs(transformedDocs)
    } catch (error) {
      console.error('Error loading pending documents:', error)
    } finally {
      setLoading(false)
    }
  }

  function getDocumentIcon(docType: string) {
    switch (docType) {
      case 'PO':
        return <FileText className="w-5 h-5" />
      case 'INVOICE':
        return <FileCheck className="w-5 h-5" />
      case 'PAYMENT':
        return <CreditCard className="w-5 h-5" />
      case 'RECEIPT':
        return <Receipt className="w-5 h-5" />
      default:
        return <FileText className="w-5 h-5" />
    }
  }

  function getDocumentColor(docType: string) {
    switch (docType) {
      case 'PO':
        return 'text-blue-600 bg-blue-50'
      case 'INVOICE':
        return 'text-green-600 bg-green-50'
      case 'PAYMENT':
        return 'text-purple-600 bg-purple-50'
      case 'RECEIPT':
        return 'text-orange-600 bg-orange-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  function formatTimeAgo(dateString: string): string {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-600" />
            Action Required
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            Loading pending actions...
          </div>
        </CardContent>
      </Card>
    )
  }

  if (pendingDocs.length === 0 && approvedH2MOrders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Action Required
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3 opacity-50" />
            <p className="text-gray-600">No pending actions</p>
            <p className="text-sm text-gray-500 mt-1">All documents are up to date</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const totalActions = pendingDocs.length + approvedH2MOrders.length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-600" />
            Action Required
            <Badge variant="destructive" className="ml-2">
              {totalActions}
            </Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Approved H2M Orders for Distributors */}
        {approvedH2MOrders.map((order) => (
          <div
            key={`h2m-${order.id}`}
            className="flex items-start gap-4 p-4 border border-blue-200 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            {/* Icon */}
            <div className="p-2.5 rounded-lg bg-blue-600 text-white flex-shrink-0">
              <Package className="w-5 h-5" />
            </div>
            
            {/* Content */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Header Row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-blue-900">
                      H2M Order Approved - Ready to Order
                    </h4>
                    <Badge variant="outline" className="text-xs font-mono bg-white">
                      {order.order_no}
                    </Badge>
                  </div>
                </div>
                
                <Button
                  size="sm"
                  className="flex-shrink-0 bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    // Navigate to create order page
                    window.location.href = '/dashboard?view=create-order'
                  }}
                >
                  Create D2H Order
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>

              {/* Notification Banner */}
              <div className="w-full bg-white border border-blue-200 rounded-md px-3 py-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <span className="text-xs font-medium text-blue-900">
                    HQ has approved this order. You can now place a D2H order to purchase these products.
                  </span>
                </div>
              </div>
              
              {/* Details */}
              <div className="space-y-1">
                <p className="text-sm text-blue-700">
                  From: <span className="font-medium text-blue-900">{order.buyer_org.org_name}</span>
                </p>
                <p className="text-xs text-blue-600">
                  Order Type: {order.order_type} (HQ → Manufacturer)
                </p>
              </div>
              
              {/* Timestamp */}
              <div className="flex items-center gap-1.5 text-xs text-blue-600">
                <Clock className="w-3.5 h-3.5" />
                <span>Approved {formatTimeAgo(order.approved_at)}</span>
              </div>
            </div>
          </div>
        ))}

        {/* Pending Documents */}
        {pendingDocs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
          >
            {/* Icon */}
            <div className={`p-2.5 rounded-lg ${getDocumentColor(doc.doc_type)} flex-shrink-0`}>
              {getDocumentIcon(doc.doc_type)}
            </div>
            
            {/* Content */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Header Row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-gray-900">
                      {getDocumentTypeLabel(doc.doc_type as Document['doc_type'])}
                    </h4>
                    <Badge variant="outline" className="text-xs font-mono">
                      {doc.doc_no}
                    </Badge>
                  </div>
                </div>
                
                <Button
                  size="sm"
                  onClick={() => onViewDocument(doc.order.id, doc.id)}
                  className="flex-shrink-0"
                >
                  Review
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>

              {/* Payment Proof Warning - Full Width Banner with Link - Only show if required */}
              {doc.doc_type === 'INVOICE' && 
               userProfile.organizations.org_type_code === 'HQ' && 
               requirePaymentProof && (
                <button
                  onClick={() => onViewDocument(doc.order.id, doc.id)}
                  className="w-full bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-center justify-between gap-2 hover:bg-amber-100 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="text-xs font-medium text-amber-900">
                      Payment proof required before acknowledgment
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-amber-700 group-hover:text-amber-900">
                    <span className="font-medium">Click to upload</span>
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </button>
              )}
              
              {/* Details */}
              <div className="space-y-1">
                <p className="text-sm text-gray-600">
                  Order: <span className="font-medium text-gray-900">{doc.order.order_no}</span>
                </p>
                <p className="text-sm text-gray-500">
                  From: {doc.issued_by_org.org_name}
                </p>
              </div>
              
              {/* Timestamp */}
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatTimeAgo(doc.created_at)}</span>
              </div>
            </div>
          </div>
        ))}
        
        
        {pendingDocs.length >= 10 && (
          <div className="text-center pt-2">
            <Button variant="ghost" size="sm">
              View All Pending Actions
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
