/**
 * Counterparty resolution for order documents.
 *
 * A document has two parties: the ISSUER, shown in the letterhead, and the
 * COUNTERPARTY, shown in the block beneath it. The classic template used to
 * hardcode that block to `seller_org` under a literal "Supplier:" label, which
 * is only right for buyer-issued documents. On a seller-issued document (an
 * invoice, most visibly) the seller IS the issuer, so the block repeated the
 * letterhead org and never named the party the document was actually for.
 *
 * The counterparty is therefore always defined as the party the issuer is NOT,
 * and its label is derived from that organization's own `org_type_code` rather
 * than from the document type. A distributor reads as "Distributor:" wherever
 * it appears.
 */

/** `organizations.org_type_code` for a distributor. */
export const DISTRIBUTOR_ORG_TYPE_CODE = 'DIST'

/** The subset of organization master data a counterparty block renders. */
export interface CounterpartyOrganization {
  org_name?: string | null
  org_type_code?: string | null
  address?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country_code?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
}

/** Upper-case a title and flatten separators so `PURCHASE_ORDER` matches. */
function normalizeDocumentTitle(docTitle: string): string {
  return String(docTitle || '')
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when the BUYER raises the document, so the seller is the counterparty.
 *
 * Only two documents are buyer-issued: the Purchase Order and the Payment
 * Advice. Everything else in the order workflow — Sales Order, Delivery Order,
 * Invoice, Receipt, Balance Payment Request — is raised by the seller, so the
 * buyer is the counterparty.
 *
 * The previous predicate matched on a bare `ORDER` token, which swept up
 * `Sales Order` and `Delivery Order` and put the buyer in the letterhead on
 * both. On a distributor order that inverted the whole document: the
 * distributor appeared as the issuer and the block beneath it read
 * "Supplier: <the seller>", the opposite of the on-screen order detail. Matching
 * whole document kinds instead keeps `Balance Payment Request` seller-issued
 * while `Payment Advice` stays buyer-issued.
 */
export function isBuyerIssuedDocument(docTitle: string): boolean {
  const title = normalizeDocumentTitle(docTitle)
  if (!title) return false
  if (title.includes('PURCHASE ORDER') || title === 'PO') return true
  if (title.includes('PAYMENT ADVICE') || title === 'PAYMENT') return true
  return false
}

export function isDistributorOrganization(org?: CounterpartyOrganization | null): boolean {
  return String(org?.org_type_code || '').trim().toUpperCase() === DISTRIBUTOR_ORG_TYPE_CODE
}

/**
 * Generic role classification, with no document formatting attached: the name a
 * party should be called given what it is. A distributor is named as such
 * whichever side of the order it sits on; anything else keeps the caller's own
 * business label, so a document is free to say "Customer", "Supplier",
 * "Deliver To" or "Received From" as its own semantics require.
 *
 * This is the piece the on-screen order detail shares with the PDF templates —
 * the classification, not the layout.
 */
export function resolveCounterpartyRoleLabel(
  org: CounterpartyOrganization | null | undefined,
  fallbackLabel: string,
): string {
  return isDistributorOrganization(org) ? 'Distributor' : fallbackLabel
}

/**
 * The counterparty label as the PDF templates print it, colon included. The
 * fallback wording depends on which party the counterparty is.
 */
export function resolveCounterpartyLabel(
  org: CounterpartyOrganization | null | undefined,
  isBuyerIssuer: boolean,
): string {
  return `${resolveCounterpartyRoleLabel(org, isBuyerIssuer ? 'Supplier' : 'Customer')}:`
}

/**
 * Reject values that must never reach a document: blanks, and the raw
 * identifiers that leak through when an address column holds an unresolved
 * foreign key (`state` is selected as `state:state_id`) instead of a name.
 */
function cleanLine(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) return null
  return trimmed
}

/** Split a stored multi-line address field into clean individual lines. */
function expandLines(value: unknown): string[] {
  const cleaned = cleanLine(value)
  if (!cleaned) return []
  return cleaned
    .split(/[\n\r]+/)
    .map((line) => cleanLine(line))
    .filter((line): line is string => line !== null)
}

/**
 * A human-readable address block from the organization master data. Every field
 * is optional, so a sparsely filled organization yields fewer lines rather than
 * blank or "undefined" ones.
 */
export function buildCounterpartyAddressLines(org?: CounterpartyOrganization | null): string[] {
  if (!org) return []

  const lines: string[] = [...expandLines(org.address), ...expandLines(org.address_line2)]

  const cityPostal = [cleanLine(org.city), cleanLine(org.postal_code)].filter(Boolean).join(', ')
  const cityPostalLine = cleanLine(cityPostal)
  if (cityPostalLine) lines.push(cityPostalLine)

  const state = cleanLine(org.state)
  if (state) lines.push(state)

  return lines
}

/**
 * Contact lines for the counterparty block: the named person and how to reach
 * them. Prefixed so they stay distinguishable from address lines, and ordered
 * to match the detailed template's party columns so both templates read alike.
 */
export function buildCounterpartyContactLines(org?: CounterpartyOrganization | null): string[] {
  if (!org) return []

  const lines: string[] = []

  const contactName = cleanLine(org.contact_name)
  if (contactName) lines.push(`Attn: ${contactName}`)

  const contactEmail = cleanLine(org.contact_email)
  if (contactEmail) lines.push(`Email: ${contactEmail}`)

  const contactPhone = cleanLine(org.contact_phone)
  if (contactPhone) lines.push(`Tel: ${contactPhone}`)

  return lines
}

export interface ResolvedCounterparty {
  /** Label for the block, e.g. "Distributor:". */
  label: string
  /** Organization name, upper-cased for the block heading; null when unknown. */
  name: string | null
  /** Address lines followed by contact lines, all non-empty. */
  detailLines: string[]
  isDistributor: boolean
}

/**
 * Resolve the counterparty block for a document from the order's two parties.
 * `docTitle` is the same title the template puts in the letterhead, so the
 * block always names the opposite party.
 */
export function resolveCounterparty(
  orderData: {
    buyer_org?: CounterpartyOrganization | null
    seller_org?: CounterpartyOrganization | null
  },
  docTitle: string,
): ResolvedCounterparty {
  const isBuyerIssuer = isBuyerIssuedDocument(docTitle)
  const org = isBuyerIssuer ? orderData?.seller_org : orderData?.buyer_org

  const name = cleanLine(org?.org_name)

  return {
    label: resolveCounterpartyLabel(org, isBuyerIssuer),
    name: name ? name.toUpperCase() : null,
    detailLines: [...buildCounterpartyAddressLines(org), ...buildCounterpartyContactLines(org)],
    isDistributor: isDistributorOrganization(org),
  }
}

/**
 * Column heading for a party in the detailed template's PARTIES table. The
 * generic "BUYER (HQ)" heading is wrong when the buyer is a distributor.
 */
export function resolvePartyColumnHeading(
  org: CounterpartyOrganization | null | undefined,
  fallback: string,
): string {
  return resolveCounterpartyRoleLabel(org, fallback).toUpperCase()
}
