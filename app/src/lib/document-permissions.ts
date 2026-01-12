/**
 * Document Permissions Utility
 * Handles role-based access control for document acknowledgments
 */

export interface Document {
  id: string
  doc_type: 'PO' | 'INVOICE' | 'PAYMENT' | 'RECEIPT' | 'PAYMENT_REQUEST' | 'SO' | 'DO'
  doc_no: string
  display_doc_no?: string | null
  status: 'pending' | 'acknowledged' | 'completed'
  issued_by_org_id: string
  issued_to_org_id: string
  created_at: string
  acknowledged_at?: string
  acknowledged_by?: string
}

/**
 * Get the display document number (new format) or fall back to legacy doc_no
 */
export function getDisplayDocNo(doc: Document | null | undefined): string {
  if (!doc) return ''
  return doc.display_doc_no || doc.doc_no || ''
}

export interface UserPermissions {
  organizationId: string
  orgTypeCode: string
  roleLevel: number
}

/**
 * Determines if a user can acknowledge a specific document
 * 
 * Rules:
 * - PO: ONLY Seller (Manufacturer) can acknowledge - HQ cannot override
 * - INVOICE: Buyer (HQ) acknowledges
 * - PAYMENT: Seller (Manufacturer) acknowledges
 * - RECEIPT: No acknowledgment needed (terminal state)
 * - HQ Admins can acknowledge INVOICE/PAYMENT but NOT PO
 */
export function canAcknowledgeDocument(
  document: Document,
  userPermissions: UserPermissions
): boolean {
  const { organizationId, orgTypeCode, roleLevel } = userPermissions

  const normalizedOrgType = orgTypeCode?.toUpperCase() ?? ''
  const isManufacturer = ['MFG', 'MANU'].includes(normalizedOrgType)
  const isHqAdminOverride = normalizedOrgType === 'HQ' && roleLevel <= 10

  // Receipt is terminal - no acknowledgment
  if (document.doc_type === 'RECEIPT') {
    return false
  }

  // Document must be pending
  if (document.status !== 'pending') {
    return false
  }

  // Check if user's organization is the one that should acknowledge
  const isAcknowledger = document.issued_to_org_id === organizationId

  // Special case: PO can ONLY be acknowledged by the manufacturer (seller/issued_to)
  // HQ cannot acknowledge PO even with admin privileges
  if (document.doc_type === 'PO') {
    // Only the manufacturer organization (issued_to) can acknowledge
    return isAcknowledger && isManufacturer
  }

  // For other document types (INVOICE, PAYMENT, PAYMENT_REQUEST), HQ Admin can override if needed
  if (isHqAdminOverride) {
    return true
  }

  return isAcknowledger
}

/**
 * Get the organization that should acknowledge this document
 */
export function getAcknowledger(document: Document): 'buyer' | 'seller' | 'hq' | 'none' {
  switch (document.doc_type) {
    case 'PO':
      return 'seller' // Seller acknowledges PO
    case 'SO':
      return 'none' // Sales Order is internal/confirmation, usually no ack needed or maybe buyer? Let's say none for now or buyer.
    case 'DO':
      return 'buyer' // Buyer acknowledges Delivery Order (Goods Received)
    case 'INVOICE':
      return 'buyer' // Buyer acknowledges Invoice
    case 'PAYMENT':
      return 'seller' // Seller acknowledges Payment
    case 'PAYMENT_REQUEST':
      return 'hq' // HQ Admin approves balance payment request
    case 'RECEIPT':
      return 'none' // Terminal state
    default:
      return 'none'
  }
}

/**
 * Get user-friendly status text
 */
export function getDocumentStatusText(document: Document): string {
  if (document.doc_type === 'RECEIPT') {
    return 'Completed'
  }

  switch (document.status) {
    case 'pending':
      return 'Awaiting Acknowledgment'
    case 'acknowledged':
      return 'Acknowledged'
    case 'completed':
      return 'Completed'
    default:
      return 'Unknown'
  }
}

/**
 * Get the next document type in the workflow
 */
export function getNextDocumentType(currentType: Document['doc_type']): Document['doc_type'] | null {
  switch (currentType) {
    case 'PO':
      return 'INVOICE'
    case 'INVOICE':
      return 'PAYMENT'
    case 'PAYMENT':
      return 'RECEIPT'
    case 'RECEIPT':
      return null // Terminal
    default:
      return null
  }
}

/**
 * Get document type display name
 */
export function getDocumentTypeLabel(docType: Document['doc_type']): string {
  switch (docType) {
    case 'PO':
      return 'Purchase Order'
    case 'INVOICE':
      return 'Invoice'
    case 'PAYMENT':
      return 'Payment'
    case 'PAYMENT_REQUEST':
      return 'Balance Payment Request'
    case 'RECEIPT':
      return 'Receipt'
    default:
      return docType
  }
}

/**
 * Get document type badge color
 */
export function getDocumentTypeBadgeColor(docType: Document['doc_type']): string {
  switch (docType) {
    case 'PO':
      return 'bg-purple-100 text-purple-700 border-purple-200'
    case 'INVOICE':
      return 'bg-indigo-100 text-indigo-700 border-indigo-200'
    case 'PAYMENT':
      return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'PAYMENT_REQUEST':
      return 'bg-orange-100 text-orange-700 border-orange-200'
    case 'RECEIPT':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

/**
 * Get document workflow progress percentage
 */
export function getWorkflowProgress(documents: {
  po?: Document | null
  invoice?: Document | null
  payment?: Document | null
  receipt?: Document | null
}): number {
  let completed = 0
  const total = 4

  if (documents.po?.status === 'acknowledged' || documents.invoice) completed++
  if (documents.invoice?.status === 'acknowledged' || documents.payment) completed++
  if (documents.payment?.status === 'acknowledged' || documents.receipt) completed++
  if (documents.receipt) completed++

  return (completed / total) * 100
}
