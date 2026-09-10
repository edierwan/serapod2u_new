/**
 * Document Permissions Utility
 * Handles role-based access control for document acknowledgments
 */

import {
  canAcknowledgeOrderDocument,
  type AcknowledgementOrder
} from '@/lib/documents/acknowledge-authorization'

export {
  canAcknowledgeOrderDocument,
  describeAcknowledgementDenial,
  HQ_ACKNOWLEDGEMENT_ROLE_LEVELS
} from '@/lib/documents/acknowledge-authorization'
export type {
  AcknowledgementActor,
  AcknowledgementDecision,
  AcknowledgementOrder
} from '@/lib/documents/acknowledge-authorization'

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
 * Determines if a user can acknowledge a specific document.
 *
 * Thin wrapper over the shared helper in
 * `@/lib/documents/acknowledge-authorization` so the buttons, the dialogs and
 * the acknowledge API route all evaluate exactly the same rules. Pass `order`
 * when it is available so the buyer organization can be matched on orders whose
 * document row was loaded without its org columns.
 */
export function canAcknowledgeDocument(
  document: Document,
  userPermissions: UserPermissions,
  order?: AcknowledgementOrder | null
): boolean {
  return canAcknowledgeOrderDocument({
    actor: {
      organizationId: userPermissions.organizationId,
      orgTypeCode: userPermissions.orgTypeCode,
      roleLevel: userPermissions.roleLevel
    },
    document,
    order
  }).allowed
}

/**
 * Get the organization that should acknowledge this document
 */
export function getAcknowledger(document: Document): 'buyer' | 'seller' | 'hq' | 'none' {
  switch (document.doc_type) {
    case 'PO':
      return 'seller' // Seller acknowledges PO
    case 'SO':
      return 'buyer' // Sales Order is issued to the buyer (distributor on D2H)
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
