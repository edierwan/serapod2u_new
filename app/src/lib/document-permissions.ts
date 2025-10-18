/**
 * Document Permissions Utility
 * Handles role-based access control for document acknowledgments
 */

export interface Document {
  id: string
  doc_type: 'PO' | 'INVOICE' | 'PAYMENT' | 'RECEIPT'
  doc_no: string
  status: 'pending' | 'acknowledged' | 'completed'
  issued_by_org_id: string
  issued_to_org_id: string
  created_at: string
  acknowledged_at?: string
  acknowledged_by?: string
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
 * - HQ Admins (role_level ≤ 10) can acknowledge ANY document
 * - Power Users (role_level ≤ 20) in their org type can acknowledge
 * - PO: Seller (issued_to) acknowledges
 * - INVOICE: Buyer (issued_to) acknowledges
 * - PAYMENT: Seller (issued_to) acknowledges
 * - RECEIPT: No acknowledgment needed (terminal state)
 */
export function canAcknowledgeDocument(
  document: Document,
  userPermissions: UserPermissions
): boolean {
  const { organizationId, roleLevel } = userPermissions

  // HQ Admin override - can acknowledge anything
  if (roleLevel <= 10) {
    return true
  }

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

  return isAcknowledger
}

/**
 * Get the organization that should acknowledge this document
 */
export function getAcknowledger(document: Document): 'buyer' | 'seller' | 'none' {
  switch (document.doc_type) {
    case 'PO':
      return 'seller' // Seller acknowledges PO
    case 'INVOICE':
      return 'buyer' // Buyer acknowledges Invoice
    case 'PAYMENT':
      return 'seller' // Seller acknowledges Payment
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
    case 'RECEIPT':
      return 'Receipt'
    default:
      return docType
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
