/**
 * Shared acknowledgement authorization for order documents.
 *
 * One source of truth for "who may acknowledge this document", used by the
 * React buttons AND by the acknowledge API route, so the UI can never offer an
 * action the backend rejects (and can never hide one the backend allows).
 *
 * Role levels come from public.roles:
 *   1  SA          Super Admin
 *   10 HQ          HQ Admin
 *   20 POWER_USER  Power User
 *   30 MANAGER     Manager
 *   40 USER        User
 *   50 GUEST       Guest
 *
 * Levels are matched by membership, never by `<=`, so a new level slotted
 * between the existing ones cannot silently inherit acknowledgement rights.
 */

/** HQ role levels cleared to acknowledge SO / DO / Invoice. */
export const HQ_ACKNOWLEDGEMENT_ROLE_LEVELS: readonly number[] = [1, 10, 20, 30]

export const HQ_ORG_TYPE = 'HQ'
export const MANUFACTURER_ORG_TYPES: readonly string[] = ['MFG', 'MANU']

/**
 * Legacy HQ override retained for PAYMENT / PAYMENT_REQUEST. Those documents
 * are outside the scope of the SO/DO/Invoice rules and keep the behaviour they
 * had before the shared helper existed.
 */
const LEGACY_HQ_OVERRIDE_MAX_LEVEL = 10

export interface AcknowledgementActor {
  organizationId?: string | null
  orgTypeCode?: string | null
  roleLevel?: number | null
}

export interface AcknowledgementDocument {
  doc_type?: string | null
  status?: string | null
  issued_to_org_id?: string | null
  issued_by_org_id?: string | null
}

export interface AcknowledgementOrder {
  order_type?: string | null
  buyer_org_id?: string | null
  seller_org_id?: string | null
}

export type AcknowledgementReason =
  | 'allowed_hq_authority'
  | 'allowed_issued_to_org'
  | 'allowed_manufacturer'
  | 'missing_organization'
  | 'unknown_document_type'
  | 'terminal_document'
  | 'not_pending'
  | 'hq_role_level_not_authorized'
  | 'requires_manufacturer'
  | 'organization_not_party_to_document'

export interface AcknowledgementDecision {
  allowed: boolean
  reason: AcknowledgementReason
}

const normalizeCode = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

const sameOrg = (a: string | null | undefined, b: string | null | undefined): boolean =>
  typeof a === 'string' && a.length > 0 && typeof b === 'string' && b.length > 0 && a === b

export function isHqOrganization(actor: AcknowledgementActor): boolean {
  return normalizeCode(actor.orgTypeCode) === HQ_ORG_TYPE
}

export function isManufacturerOrganization(actor: AcknowledgementActor): boolean {
  return MANUFACTURER_ORG_TYPES.includes(normalizeCode(actor.orgTypeCode))
}

/** HQ organization AND an explicitly authorized role level. Both are required. */
export function hasHqAcknowledgementAuthority(actor: AcknowledgementActor): boolean {
  if (!isHqOrganization(actor)) return false
  return typeof actor.roleLevel === 'number' && HQ_ACKNOWLEDGEMENT_ROLE_LEVELS.includes(actor.roleLevel)
}

/**
 * The organization the document was issued to — the distributor on a D2H
 * SO/DO/Invoice, the shop on an S2D one, the manufacturer on an H2M PO.
 * Matched on organization id, never on name or display text.
 */
function isIssuedToOrganization(
  actor: AcknowledgementActor,
  document: AcknowledgementDocument,
  order?: AcknowledgementOrder | null
): boolean {
  if (sameOrg(actor.organizationId, document.issued_to_org_id)) return true
  // Fall back to the order's buyer when the document row was loaded without its
  // org columns; for D2H/S2D these are the same organization.
  const docType = normalizeCode(document.doc_type)
  if (order && (docType === 'SO' || docType === 'DO' || docType === 'INVOICE')) {
    return sameOrg(actor.organizationId, order.buyer_org_id)
  }
  return false
}

/**
 * Decide whether `actor` may acknowledge `document`.
 *
 * SO / DO / INVOICE
 *   - HQ organization: allowed only at role level 1, 10, 20 or 30.
 *     An HQ user at level 40/50 is denied even when HQ is the issued-to party.
 *   - Any other organization: allowed only when it is the organization the
 *     document was issued to (the distributor/shop on that specific order).
 * PO
 *   - Only the manufacturer the PO was issued to. HQ cannot override.
 * PAYMENT / PAYMENT_REQUEST
 *   - Unchanged legacy rule: the issued-to organization, or HQ at level <= 10.
 * RECEIPT
 *   - Terminal, never acknowledged.
 */
export function canAcknowledgeOrderDocument(input: {
  actor: AcknowledgementActor
  document: AcknowledgementDocument
  order?: AcknowledgementOrder | null
}): AcknowledgementDecision {
  const { actor, document, order } = input
  const docType = normalizeCode(document.doc_type)

  if (!actor.organizationId) {
    return { allowed: false, reason: 'missing_organization' }
  }

  if (docType === 'RECEIPT') {
    return { allowed: false, reason: 'terminal_document' }
  }

  // `status` is optional so callers holding a partial row can still ask the
  // organization question; when present it must be pending.
  if (typeof document.status === 'string' && document.status !== 'pending') {
    return { allowed: false, reason: 'not_pending' }
  }

  const issuedToActor = isIssuedToOrganization(actor, document, order)

  switch (docType) {
    case 'SO':
    case 'DO':
    case 'INVOICE': {
      if (isHqOrganization(actor)) {
        return hasHqAcknowledgementAuthority(actor)
          ? { allowed: true, reason: 'allowed_hq_authority' }
          : { allowed: false, reason: 'hq_role_level_not_authorized' }
      }
      return issuedToActor
        ? { allowed: true, reason: 'allowed_issued_to_org' }
        : { allowed: false, reason: 'organization_not_party_to_document' }
    }

    case 'PO': {
      if (!issuedToActor) {
        return { allowed: false, reason: 'organization_not_party_to_document' }
      }
      return isManufacturerOrganization(actor)
        ? { allowed: true, reason: 'allowed_manufacturer' }
        : { allowed: false, reason: 'requires_manufacturer' }
    }

    case 'PAYMENT':
    case 'PAYMENT_REQUEST': {
      if (issuedToActor) {
        return { allowed: true, reason: 'allowed_issued_to_org' }
      }
      const legacyHqOverride =
        isHqOrganization(actor) &&
        typeof actor.roleLevel === 'number' &&
        actor.roleLevel <= LEGACY_HQ_OVERRIDE_MAX_LEVEL
      return legacyHqOverride
        ? { allowed: true, reason: 'allowed_hq_authority' }
        : { allowed: false, reason: 'organization_not_party_to_document' }
    }

    default:
      return { allowed: false, reason: 'unknown_document_type' }
  }
}

/** Message shown to a denied user, and returned by the API route on a 403. */
export function describeAcknowledgementDenial(reason: AcknowledgementReason): string {
  switch (reason) {
    case 'not_pending':
      return 'This document has already been acknowledged.'
    case 'terminal_document':
      return 'Receipts are final and are not acknowledged.'
    case 'requires_manufacturer':
      return 'Only the manufacturing organization can acknowledge this purchase order.'
    case 'hq_role_level_not_authorized':
      return 'Your HQ access level is not permitted to acknowledge this document.'
    case 'missing_organization':
      return 'Your account is not linked to an organization.'
    case 'unknown_document_type':
      return 'This document type cannot be acknowledged.'
    default:
      return 'Your organization is not permitted to acknowledge this document.'
  }
}
