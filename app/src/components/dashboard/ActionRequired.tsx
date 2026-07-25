'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
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
  doc_type: 'PO' | 'INVOICE' | 'PAYMENT' | 'RECEIPT' | 'PAYMENT_REQUEST'
  doc_no: string
  display_doc_no?: string | null
  status: string
  created_at: string
  issued_by_org_id: string
  issued_to_org_id: string
  order: {
    id: string
    order_no: string
    display_doc_no?: string | null
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
  display_doc_no?: string | null
  order_type: string
  status: string
  approved_at: string
  buyer_org: {
    org_name: string
    org_code: string
  }
}

interface SubmittedOrder {
  id: string
  order_no: string
  display_doc_no?: string | null
  order_type: string
  status: string
  created_at: string
  buyer_org: {
    org_name: string
    org_code: string
  }
  seller_org: {
    org_name: string
    org_code: string
  }
  order_items: Array<{
    qty: number
    unit_price: number
  }>
}

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string | null
  is_active: boolean
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  } | null
  roles: {
    role_name: string
    role_level: number
  }
}

interface ActionRequiredProps {
  userProfile: UserProfile
  onViewDocument: (orderId: string, documentId: string, docType: PendingDocument['doc_type'], docNo?: string) => void
  onViewChange: (view: string) => void
}

export default function ActionRequired({ userProfile, onViewDocument, onViewChange }: ActionRequiredProps) {
  const [pendingDocs, setPendingDocs] = useState<PendingDocument[]>([])
  const [approvedH2MOrders, setApprovedH2MOrders] = useState<ApprovedH2MOrder[]>([])
  const [submittedOrders, setSubmittedOrders] = useState<SubmittedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [requirePaymentProof, setRequirePaymentProof] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadPendingDocuments()
    loadOrgSettings()
    loadSubmittedOrders()

    if (userProfile.organizations?.org_type_code === 'DIST') {
      loadApprovedH2MOrders()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile.organization_id])

  async function loadOrgSettings() {
    if (!userProfile.organization_id) return
    try {
      const { data, error } = (await supabase
        .from('organizations')
        .select('settings')
        .eq('id', userProfile.organization_id)
        .single()) as { data: any; error: any }

      if (error) throw error
      setRequirePaymentProof(data?.settings?.require_payment_proof ?? true)
    } catch (error) {
      console.error('Error loading organization settings:', error)
      setRequirePaymentProof(true)
    }
  }

  async function loadApprovedH2MOrders() {
    if (!userProfile.organization_id) return
    try {
      const { data: orgData, error: orgError } = (await supabase
        .from('organizations')
        .select('parent_org_id')
        .eq('id', userProfile.organization_id)
        .single()) as { data: any; error: any }

      if (orgError || !orgData?.parent_org_id) return

      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_no,
          display_doc_no,
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

      const transformedOrders: ApprovedH2MOrder[] = (data || []).map((order: any) => ({
        id: order.id,
        order_no: order.order_no,
        display_doc_no: order.display_doc_no,
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

  async function loadSubmittedOrders() {
    if (!userProfile.organization_id || !userProfile.organizations) return
    try {
      const canApprove = userProfile.roles.role_level <= 30
      if (!canApprove) return

      const userOrgType = userProfile.organizations.org_type_code

      const { data: companyData } = await supabase
        .rpc('get_company_id', { p_org_id: userProfile.organization_id } as any)

      const companyId = companyData || userProfile.organization_id

      let query = supabase
        .from('orders')
        .select(`
          id,
          order_no,
          display_doc_no,
          order_type,
          status,
          created_at,
          buyer_org:organizations!orders_buyer_org_id_fkey (
            org_name,
            org_code
          ),
          seller_org:organizations!orders_seller_org_id_fkey (
            org_name,
            org_code
          ),
          order_items (
            qty,
            unit_price
          )
        `)
        .eq('company_id', companyId)
        .eq('status', 'submitted')
        .order('created_at', { ascending: false })
        .limit(5)

      if (userOrgType === 'HQ') {
        query = query.in('order_type', ['H2M', 'D2H'])
      } else if (userOrgType === 'DIST') {
        query = query
          .eq('order_type', 'S2D')
          .eq('seller_org_id', userProfile.organization_id)
      } else {
        return
      }

      const { data, error } = await query
      if (error) throw error

      const transformedOrders: SubmittedOrder[] = (data || []).map((order: any) => ({
        id: order.id,
        order_no: order.order_no,
        display_doc_no: order.display_doc_no,
        order_type: order.order_type,
        status: order.status,
        created_at: order.created_at,
        buyer_org: Array.isArray(order.buyer_org) ? order.buyer_org[0] : order.buyer_org,
        seller_org: Array.isArray(order.seller_org) ? order.seller_org[0] : order.seller_org,
        order_items: order.order_items || [],
      }))

      setSubmittedOrders(transformedOrders)
    } catch (error) {
      console.error('Error loading submitted orders:', error)
    }
  }

  async function loadPendingDocuments() {
    if (!userProfile.organization_id || !userProfile.organizations) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)

      const { data, error } = await supabase
        .from('documents')
        .select(`
          id,
          doc_type,
          doc_no,
          display_doc_no,
          status,
          created_at,
          issued_by_org_id,
          issued_to_org_id,
          order:orders!inner (
            id,
            order_no,
            display_doc_no,
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

      const filteredDocs = (data || []).filter((doc: any) => {
        return canAcknowledgeDocument(doc as unknown as Document, {
          organizationId: userProfile.organization_id,
          orgTypeCode: userProfile.organizations!.org_type_code,
          roleLevel: userProfile.roles.role_level
        })
      })

      const transformedDocs: PendingDocument[] = filteredDocs.map((doc: any) => ({
        id: doc.id,
        doc_type: doc.doc_type,
        doc_no: doc.doc_no,
        display_doc_no: doc.display_doc_no,
        status: doc.status,
        created_at: doc.created_at,
        issued_by_org_id: doc.issued_by_org_id,
        issued_to_org_id: doc.issued_to_org_id,
        order: {
          ...((Array.isArray(doc.order) ? doc.order[0] : doc.order) || {}),
          display_doc_no: (Array.isArray(doc.order) ? doc.order[0] : doc.order)?.display_doc_no
        },
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
        return 'text-[var(--sera-ink)] bg-[var(--sera-ink)]/5'
      case 'INVOICE':
        return 'text-emerald-700 bg-emerald-50'
      case 'PAYMENT':
        return 'text-[var(--sera-orange-deep)] bg-[var(--sera-orange)]/10'
      case 'RECEIPT':
        return 'text-[var(--sera-orange)] bg-[var(--sera-orange)]/10'
      default:
        return 'text-[var(--sera-muted)] bg-[var(--sera-ink)]/5'
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
      <div className="sera-sc-panel overflow-hidden min-h-[280px]">
        <div className="sera-sc-panel__head">
          <div className="h-5 w-40 bg-[var(--sera-ink)]/5 rounded animate-pulse" />
        </div>
        <div className="sera-sc-panel__body space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-[var(--sera-ink)]/5 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (pendingDocs.length === 0 && approvedH2MOrders.length === 0 && submittedOrders.length === 0) {
    return (
      <div className="sera-sc-panel overflow-hidden h-full">
        <div className="sera-sc-panel__head">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-50">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="sera-sc-panel__title">Action Required</h3>
              <p className="text-xs text-[var(--sera-muted)]">Nothing pending right now</p>
            </div>
          </div>
        </div>
        <div className="text-center py-14 px-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7 text-emerald-500" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-[var(--sera-ink)]">All caught up</p>
          <p className="text-xs text-[var(--sera-muted)] mt-1 max-w-xs mx-auto">
            No documents or orders need your attention at the moment.
          </p>
        </div>
      </div>
    )
  }

  const totalActions = pendingDocs.length + approvedH2MOrders.length + submittedOrders.length

  return (
    <div className="sera-sc-panel overflow-hidden h-full">
      <div className="sera-sc-panel__head">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--sera-orange)]/10 shrink-0">
              <AlertCircle className="w-4.5 h-4.5 text-[var(--sera-orange)]" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h3 className="sera-sc-panel__title">Action Required</h3>
              <p className="text-xs text-[var(--sera-muted)] truncate">Items that need your attention</p>
            </div>
          </div>
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] rounded-full bg-[var(--sera-orange)] text-white text-[11px] font-bold px-1.5 shrink-0">
            {totalActions}
          </span>
        </div>
      </div>

      <div className="sera-sc-panel__body space-y-3 max-h-[640px] overflow-y-auto">
        {submittedOrders.map((order) => {
          const totalAmount = order.order_items.reduce((sum, item) => sum + (item.qty * item.unit_price), 0)
          const totalUnits = order.order_items.reduce((sum, item) => sum + item.qty, 0)

          return (
            <div key={`order-${order.id}`} className="sera-dashboard-action sera-dashboard-action--urgent pl-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[var(--sera-orange)] text-white flex items-center justify-center">
                    <Package className="w-4 h-4" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-[var(--sera-ink)] mb-1.5">
                      Order awaiting approval
                    </h4>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="sera-dashboard-tag">
                        {order.display_doc_no || order.order_no}
                      </span>
                      <span className="sera-dashboard-tag sera-dashboard-tag--type">
                        {order.order_type}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] text-[var(--sera-muted)] uppercase tracking-wider mb-0.5">Buyer</p>
                    <p className="font-medium text-[var(--sera-ink-soft)] truncate">{order.buyer_org.org_name}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--sera-muted)] uppercase tracking-wider mb-0.5">Seller</p>
                    <p className="font-medium text-[var(--sera-ink-soft)] truncate">{order.seller_org.org_name}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 text-[var(--sera-muted)]">
                    <span className="flex items-center gap-1">
                      <Package className="w-3 h-3" />
                      {totalUnits} units
                    </span>
                    <span className="font-medium text-[var(--sera-ink-soft)]">
                      RM {totalAmount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] text-[var(--sera-muted)]">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(order.created_at)}
                  </span>
                </div>

                <Button
                  size="sm"
                  className="w-full bg-[var(--sera-orange)] hover:bg-[var(--sera-orange-deep)] text-white text-xs h-9 rounded-lg shadow-none"
                  onClick={() => onViewChange('orders')}
                >
                  Review & Approve
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          )
        })}

        {approvedH2MOrders.map((order) => (
          <div key={`h2m-${order.id}`} className="sera-dashboard-action sera-dashboard-action--neutral">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[var(--sera-ink)] text-white flex items-center justify-center">
                  <Package className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-[var(--sera-ink)] mb-1.5">
                    H2M order approved
                  </h4>
                  <span className="sera-dashboard-tag">
                    {order.display_doc_no || order.order_no}
                  </span>
                </div>
              </div>

              <div className="border border-[var(--sera-line)] rounded-lg px-3 py-2 bg-white">
                <p className="text-[11px] text-[var(--sera-ink-soft)]">
                  HQ approved — you can now create a D2H order.
                </p>
              </div>

              <div className="text-xs space-y-1">
                <p className="text-[var(--sera-muted)]">
                  From: <span className="font-medium text-[var(--sera-ink-soft)]">{order.buyer_org.org_name}</span>
                </p>
                <div className="flex items-center justify-between">
                  <span className="sera-dashboard-tag sera-dashboard-tag--type">{order.order_type}</span>
                  <span className="flex items-center gap-1 text-[11px] text-[var(--sera-muted)]">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(order.approved_at)}
                  </span>
                </div>
              </div>

              <Button
                size="sm"
                className="w-full bg-[var(--sera-ink)] hover:bg-[var(--sera-ink-soft)] text-white text-xs h-9 rounded-lg"
                onClick={() => window.location.href = '/dashboard?view=create-order'}
              >
                Create D2H Order
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        ))}

        {pendingDocs.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:hidden">
              {pendingDocs.map((doc) => (
                <button
                  key={`mobile-${doc.id}`}
                  type="button"
                  onClick={() => onViewDocument(doc.order.id, doc.id, doc.doc_type, doc.display_doc_no || doc.doc_no)}
                  className="sera-dashboard-action p-3 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className={`inline-flex items-center justify-center rounded-lg ${getDocumentColor(doc.doc_type)} p-1.5`}>
                      {getDocumentIcon(doc.doc_type)}
                    </div>
                    <span className="sera-dashboard-tag text-[10px]">
                      {doc.display_doc_no || doc.doc_no}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-[var(--sera-ink)] truncate">
                    {getDocumentTypeLabel(doc.doc_type as Document['doc_type'])}
                  </p>
                  <p className="text-[11px] text-[var(--sera-muted)] truncate">
                    Order {doc.order.display_doc_no || doc.order.order_no}
                  </p>
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-[var(--sera-muted)]">
                    <Clock className="w-3 h-3" />
                    <span>{formatTimeAgo(doc.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="hidden sm:flex sm:flex-col sm:gap-2">
              {pendingDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="sera-dashboard-action flex items-center gap-4 p-4"
                >
                  <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${getDocumentColor(doc.doc_type)}`}>
                    {getDocumentIcon(doc.doc_type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-[var(--sera-ink)]">
                        {getDocumentTypeLabel(doc.doc_type as Document['doc_type'])}
                      </h4>
                      <span className="sera-dashboard-tag">
                        {doc.display_doc_no || doc.doc_no}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-[var(--sera-muted)] flex-wrap">
                      <span>Order <span className="text-[var(--sera-ink-soft)] font-medium">{doc.order.display_doc_no || doc.order.order_no}</span></span>
                      <span className="text-[var(--sera-line)]">&bull;</span>
                      <span>From {doc.issued_by_org.org_name}</span>
                      <span className="text-[var(--sera-line)]">&bull;</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTimeAgo(doc.created_at)}
                      </span>
                    </div>

                    {doc.doc_type === 'INVOICE' &&
                      userProfile.organizations?.org_type_code === 'HQ' &&
                      requirePaymentProof && (
                        <button
                          type="button"
                          onClick={() => onViewDocument(doc.order.id, doc.id, doc.doc_type, doc.display_doc_no || doc.doc_no)}
                          className="mt-2 w-full bg-[var(--sera-orange)]/8 border border-[var(--sera-orange)]/20 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-[var(--sera-orange)]/12 transition-colors group/inner"
                        >
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-3.5 h-3.5 text-[var(--sera-orange)]" />
                            <span className="text-[11px] font-medium text-[var(--sera-orange-deep)]">Payment proof required</span>
                          </div>
                          <span className="text-[11px] text-[var(--sera-orange)] font-medium group-hover/inner:text-[var(--sera-orange-deep)]">Upload →</span>
                        </button>
                      )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onViewDocument(doc.order.id, doc.id, doc.doc_type, doc.display_doc_no || doc.doc_no)}
                    className="flex-shrink-0 text-xs h-8 rounded-lg border-[var(--sera-line)] hover:bg-[var(--sera-ink)]/5"
                  >
                    Review
                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}

        {pendingDocs.length >= 10 && (
          <div className="text-center pt-3 border-t border-[var(--sera-line)]">
            <Button variant="ghost" size="sm" className="text-xs text-[var(--sera-muted)] hover:text-[var(--sera-ink)]">
              View all pending actions
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
