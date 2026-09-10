import { describe, expect, it } from 'vitest'
import {
  canAcknowledgeOrderDocument,
  hasHqAcknowledgementAuthority,
  HQ_ACKNOWLEDGEMENT_ROLE_LEVELS,
  type AcknowledgementActor,
  type AcknowledgementDocument,
  type AcknowledgementOrder
} from './acknowledge-authorization'
import { canAcknowledgeDocument, type Document } from '@/lib/document-permissions'

const HQ_ORG = '11111111-1111-1111-1111-111111111111'
const MAXVAPER_ORG = '22222222-2222-2222-2222-222222222222'
const OTHER_DISTRIBUTOR_ORG = '33333333-3333-3333-3333-333333333333'
const MANUFACTURER_ORG = '44444444-4444-4444-4444-444444444444'
const SHOP_ORG = '55555555-5555-5555-5555-555555555555'

/** D2H order SO26000152: HQ sells to distributor MAXVAPER. */
const d2hOrder: AcknowledgementOrder = {
  order_type: 'D2H',
  buyer_org_id: MAXVAPER_ORG,
  seller_org_id: HQ_ORG
}

/** Every D2H document is issued BY HQ TO the distributor (orders_approve). */
const d2hDoc = (doc_type: string): AcknowledgementDocument => ({
  doc_type,
  status: 'pending',
  issued_by_org_id: HQ_ORG,
  issued_to_org_id: MAXVAPER_ORG
})

const hq = (roleLevel: number): AcknowledgementActor => ({
  organizationId: HQ_ORG,
  orgTypeCode: 'HQ',
  roleLevel
})
const distributor = (organizationId: string, roleLevel = 10): AcknowledgementActor => ({
  organizationId,
  orgTypeCode: 'DIST',
  roleLevel
})
const manufacturer = (roleLevel = 10): AcknowledgementActor => ({
  organizationId: MANUFACTURER_ORG,
  orgTypeCode: 'MFG',
  roleLevel
})
const shop = (organizationId = SHOP_ORG, roleLevel = 10): AcknowledgementActor => ({
  organizationId,
  orgTypeCode: 'SHOP',
  roleLevel
})

const allows = (actor: AcknowledgementActor, document: AcknowledgementDocument, order = d2hOrder) =>
  canAcknowledgeOrderDocument({ actor, document, order }).allowed

describe('HQ acknowledgement levels', () => {
  it('authorizes exactly levels 1, 10, 20 and 30', () => {
    expect([...HQ_ACKNOWLEDGEMENT_ROLE_LEVELS]).toEqual([1, 10, 20, 30])
  })

  it('matches levels by membership, not by numeric comparison', () => {
    // A level between the authorized ones must not inherit rights.
    expect(hasHqAcknowledgementAuthority(hq(25))).toBe(false)
    expect(hasHqAcknowledgementAuthority(hq(40))).toBe(false)
    expect(hasHqAcknowledgementAuthority(hq(50))).toBe(false)
  })

  it('requires the HQ organization as well as the level', () => {
    expect(hasHqAcknowledgementAuthority(distributor(MAXVAPER_ORG, 10))).toBe(false)
    expect(hasHqAcknowledgementAuthority(manufacturer(10))).toBe(false)
    expect(hasHqAcknowledgementAuthority(hq(10))).toBe(true)
  })
})

describe('Sales Order acknowledgement (D2H SO26000152 / MAXVAPER)', () => {
  const so = d2hDoc('SO')

  it('allows an HQ admin at level 10 to acknowledge any sales order', () => {
    expect(allows(hq(10), so)).toBe(true)
    expect(canAcknowledgeOrderDocument({ actor: hq(10), document: so, order: d2hOrder }).reason)
      .toBe('allowed_hq_authority')
  })

  it('allows a user in the distributor organization the SO is for', () => {
    expect(allows(distributor(MAXVAPER_ORG), so)).toBe(true)
  })

  it('denies a user from a different distributor', () => {
    const decision = canAcknowledgeOrderDocument({
      actor: distributor(OTHER_DISTRIBUTOR_ORG),
      document: so,
      order: d2hOrder
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('organization_not_party_to_document')
  })

  it('denies a manufacturer', () => {
    expect(allows(manufacturer(), so)).toBe(false)
  })

  it('denies a shop that is not the buyer on this order', () => {
    expect(allows(shop(), so)).toBe(false)
  })

  it('keeps the existing S2D rule: the buying shop acknowledges its own SO', () => {
    const s2dOrder: AcknowledgementOrder = {
      order_type: 'S2D',
      buyer_org_id: SHOP_ORG,
      seller_org_id: MAXVAPER_ORG
    }
    const s2dSo: AcknowledgementDocument = {
      doc_type: 'SO',
      status: 'pending',
      issued_by_org_id: MAXVAPER_ORG,
      issued_to_org_id: SHOP_ORG
    }
    expect(allows(shop(), s2dSo, s2dOrder)).toBe(true)
  })

  it('matches the distributor by organization id, not by the order buyer alone', () => {
    // Same order, but the document was issued to somebody else entirely.
    const misissued: AcknowledgementDocument = {
      doc_type: 'SO',
      status: 'pending',
      issued_by_org_id: HQ_ORG,
      issued_to_org_id: OTHER_DISTRIBUTOR_ORG
    }
    expect(allows(distributor(OTHER_DISTRIBUTOR_ORG), misissued)).toBe(true)
    expect(
      canAcknowledgeOrderDocument({
        actor: distributor(OTHER_DISTRIBUTOR_ORG),
        document: misissued,
        order: null
      }).allowed
    ).toBe(true)
  })

  it('denies an already acknowledged sales order', () => {
    const decision = canAcknowledgeOrderDocument({
      actor: hq(10),
      document: { ...so, status: 'acknowledged' },
      order: d2hOrder
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('not_pending')
  })
})

describe('Delivery Order acknowledgement', () => {
  const deliveryOrder = d2hDoc('DO')

  it.each(HQ_ACKNOWLEDGEMENT_ROLE_LEVELS)('allows HQ level %i', (level) => {
    expect(allows(hq(level), deliveryOrder)).toBe(true)
  })

  it.each([40, 50])('denies HQ level %i', (level) => {
    const decision = canAcknowledgeOrderDocument({
      actor: hq(level),
      document: deliveryOrder,
      order: d2hOrder
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('hq_role_level_not_authorized')
  })

  it('denies a distributor at level 10 that is not the issued-to organization', () => {
    expect(allows(distributor(OTHER_DISTRIBUTOR_ORG), deliveryOrder)).toBe(false)
  })

  it('denies a manufacturer at level 10', () => {
    expect(allows(manufacturer(10), deliveryOrder)).toBe(false)
  })

  it('keeps the delivery confirmation with the distributor the DO was issued to', () => {
    expect(allows(distributor(MAXVAPER_ORG), deliveryOrder)).toBe(true)
  })
})

describe('Invoice acknowledgement', () => {
  const invoice = d2hDoc('INVOICE')

  it.each(HQ_ACKNOWLEDGEMENT_ROLE_LEVELS)('allows HQ level %i', (level) => {
    expect(allows(hq(level), invoice)).toBe(true)
  })

  it.each([40, 50])('denies HQ level %i', (level) => {
    expect(allows(hq(level), invoice)).toBe(false)
  })

  it('denies HQ level 40 even when HQ is the organization the invoice was issued to', () => {
    // H2M shape: HQ is the buyer, so HQ is issued_to. The level gate still applies.
    const h2mInvoice: AcknowledgementDocument = {
      doc_type: 'INVOICE',
      status: 'pending',
      issued_by_org_id: MANUFACTURER_ORG,
      issued_to_org_id: HQ_ORG
    }
    const h2mOrder: AcknowledgementOrder = {
      order_type: 'H2M',
      buyer_org_id: HQ_ORG,
      seller_org_id: MANUFACTURER_ORG
    }
    expect(allows(hq(40), h2mInvoice, h2mOrder)).toBe(false)
    expect(allows(hq(30), h2mInvoice, h2mOrder)).toBe(true)
  })

  it('denies a distributor at level 10 from another organization', () => {
    expect(allows(distributor(OTHER_DISTRIBUTOR_ORG), invoice)).toBe(false)
  })

  it('denies a manufacturer at level 10', () => {
    expect(allows(manufacturer(10), invoice)).toBe(false)
  })

  it('keeps the payment-proof step with the distributor the invoice was issued to', () => {
    expect(allows(distributor(MAXVAPER_ORG), invoice)).toBe(true)
  })
})

describe('Untouched document rules', () => {
  const h2mPo: AcknowledgementDocument = {
    doc_type: 'PO',
    status: 'pending',
    issued_by_org_id: HQ_ORG,
    issued_to_org_id: MANUFACTURER_ORG
  }
  const h2mOrder: AcknowledgementOrder = {
    order_type: 'H2M',
    buyer_org_id: HQ_ORG,
    seller_org_id: MANUFACTURER_ORG
  }

  it('still lets only the manufacturer acknowledge a purchase order', () => {
    expect(allows(manufacturer(), h2mPo, h2mOrder)).toBe(true)
    expect(allows(hq(10), h2mPo, h2mOrder)).toBe(false)
    expect(allows(hq(1), h2mPo, h2mOrder)).toBe(false)
  })

  it('still treats receipts as terminal', () => {
    const receipt = d2hDoc('RECEIPT')
    const decision = canAcknowledgeOrderDocument({ actor: hq(10), document: receipt, order: d2hOrder })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('terminal_document')
  })

  it('keeps the legacy payment rule (issued-to org, or HQ at level <= 10)', () => {
    const payment: AcknowledgementDocument = {
      doc_type: 'PAYMENT',
      status: 'pending',
      issued_by_org_id: MAXVAPER_ORG,
      issued_to_org_id: HQ_ORG
    }
    expect(allows(hq(40), payment)).toBe(true) // HQ is issued_to
    expect(allows(distributor(MAXVAPER_ORG), payment)).toBe(false)
  })

  it('denies a user with no organization', () => {
    const decision = canAcknowledgeOrderDocument({
      actor: { organizationId: null, orgTypeCode: 'HQ', roleLevel: 10 },
      document: d2hDoc('SO'),
      order: d2hOrder
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('missing_organization')
  })
})

describe('canAcknowledgeDocument delegates to the shared helper', () => {
  const so = {
    id: 'doc-so',
    doc_type: 'SO',
    doc_no: 'ORD-DH-0826-52',
    display_doc_no: 'SO26000152',
    status: 'pending',
    issued_by_org_id: HQ_ORG,
    issued_to_org_id: MAXVAPER_ORG,
    created_at: '2026-08-26T02:29:34.782248+00:00'
  } as Document

  it('agrees with the shared helper for every actor in the matrix', () => {
    const actors: AcknowledgementActor[] = [
      hq(1), hq(10), hq(20), hq(30), hq(40), hq(50),
      distributor(MAXVAPER_ORG), distributor(OTHER_DISTRIBUTOR_ORG),
      manufacturer(), shop()
    ]

    for (const actor of actors) {
      expect(
        canAcknowledgeDocument(
          so,
          {
            organizationId: actor.organizationId as string,
            orgTypeCode: actor.orgTypeCode as string,
            roleLevel: actor.roleLevel as number
          },
          d2hOrder
        )
      ).toBe(canAcknowledgeOrderDocument({ actor, document: so, order: d2hOrder }).allowed)
    }
  })
})
