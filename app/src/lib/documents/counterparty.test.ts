import { describe, expect, it } from 'vitest'
import {
  DISTRIBUTOR_ORG_TYPE_CODE,
  buildCounterpartyAddressLines,
  buildCounterpartyContactLines,
  isBuyerIssuedDocument,
  isDistributorOrganization,
  resolveCounterparty,
  resolveCounterpartyLabel,
  resolveCounterpartyRoleLabel,
  resolvePartyColumnHeading,
} from './counterparty'

const DISTRIBUTOR = {
  org_name: 'Test App Distributor',
  org_type_code: 'DIST',
  address: '12 Jalan Perusahaan',
  address_line2: 'Taman Industri',
  city: 'Shah Alam',
  postal_code: '40150',
  state: 'Selangor',
  contact_name: 'Aisyah Rahman',
  contact_phone: '+60 12-345 6789',
  contact_email: 'ops@testappdist.example',
}

const HQ = {
  org_name: 'Serapod Technology Sdn Bhd',
  org_type_code: 'HQ',
  address: '1 Menara Serapod',
  city: 'Kuala Lumpur',
  postal_code: '50450',
}

describe('counterparty', () => {
  it('pins the distributor org type code to the value the rest of the app uses', () => {
    expect(DISTRIBUTOR_ORG_TYPE_CODE).toBe('DIST')
  })

  describe('isBuyerIssuedDocument', () => {
    // Only the Purchase Order and the Payment Advice are raised by the buyer.
    it.each(['Purchase Order', 'PURCHASE ORDER', 'PURCHASE_ORDER', 'PO', 'Payment Advice', 'PAYMENT'])(
      'treats %s as buyer-issued',
      (title) => {
        expect(isBuyerIssuedDocument(title)).toBe(true)
      },
    )

    // Everything else in the workflow is raised by the seller.
    it.each(['Sales Order', 'Delivery Order', 'Invoice', 'Receipt', 'Balance Payment Request', 'SO', 'DO'])(
      'treats %s as seller-issued',
      (title) => {
        expect(isBuyerIssuedDocument(title)).toBe(false)
      },
    )

    it('does not let a bare ORDER token capture Sales and Delivery Orders', () => {
      // The regression this replaced: an 'ORDER' substring match put the buyer
      // in the letterhead of every *Order document, inverting SO and DO.
      expect(isBuyerIssuedDocument('Sales Order')).toBe(false)
      expect(isBuyerIssuedDocument('Delivery Order')).toBe(false)
      expect(isBuyerIssuedDocument('Purchase Order')).toBe(true)
    })

    it('keeps Payment Advice and Balance Payment Request on opposite sides', () => {
      expect(isBuyerIssuedDocument('Payment Advice')).toBe(true)
      expect(isBuyerIssuedDocument('Balance Payment Request')).toBe(false)
    })

    it('is case-insensitive and survives a missing title', () => {
      expect(isBuyerIssuedDocument('invoice')).toBe(false)
      expect(isBuyerIssuedDocument('purchase order')).toBe(true)
      expect(isBuyerIssuedDocument('' as string)).toBe(false)
      expect(isBuyerIssuedDocument(undefined as unknown as string)).toBe(false)
    })
  })

  describe('isDistributorOrganization', () => {
    it('detects a distributor regardless of casing or padding', () => {
      expect(isDistributorOrganization({ org_type_code: 'DIST' })).toBe(true)
      expect(isDistributorOrganization({ org_type_code: ' dist ' })).toBe(true)
    })

    it('does not treat other org types or missing data as a distributor', () => {
      expect(isDistributorOrganization({ org_type_code: 'HQ' })).toBe(false)
      expect(isDistributorOrganization({})).toBe(false)
      expect(isDistributorOrganization(null)).toBe(false)
    })
  })

  describe('resolveCounterpartyLabel', () => {
    it('names a distributor as such on either side of the order', () => {
      expect(resolveCounterpartyLabel(DISTRIBUTOR, false)).toBe('Distributor:')
      expect(resolveCounterpartyLabel(DISTRIBUTOR, true)).toBe('Distributor:')
    })

    it('keeps the previous wording for non-distributors', () => {
      expect(resolveCounterpartyLabel(HQ, true)).toBe('Supplier:')
      expect(resolveCounterpartyLabel(HQ, false)).toBe('Customer:')
    })
  })

  describe('buildCounterpartyAddressLines', () => {
    it('formats the stored fields into a readable block', () => {
      expect(buildCounterpartyAddressLines(DISTRIBUTOR)).toEqual([
        '12 Jalan Perusahaan',
        'Taman Industri',
        'Shah Alam, 40150',
        'Selangor',
      ])
    })

    it('splits a multi-line address column into separate lines', () => {
      expect(buildCounterpartyAddressLines({ address: 'Unit 5\nBlock B\r\nLevel 3' })).toEqual([
        'Unit 5',
        'Block B',
        'Level 3',
      ])
    })

    it('degrades to fewer lines instead of blank or undefined ones', () => {
      expect(buildCounterpartyAddressLines({ org_name: 'Sparse Co' })).toEqual([])
      expect(buildCounterpartyAddressLines({ address: '   ', city: null, postal_code: undefined })).toEqual([])
      expect(buildCounterpartyAddressLines(null)).toEqual([])
    })

    it('drops an unresolved foreign key that leaks into an address field', () => {
      // `state` is selected as `state:state_id`, so it can arrive as a raw uuid.
      expect(
        buildCounterpartyAddressLines({
          city: 'Ipoh',
          state: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        }),
      ).toEqual(['Ipoh'])
    })

    it('emits only the city when the postal code is missing', () => {
      expect(buildCounterpartyAddressLines({ city: 'Penang' })).toEqual(['Penang'])
    })
  })

  describe('buildCounterpartyContactLines', () => {
    it('includes the contact name and number from master data', () => {
      expect(buildCounterpartyContactLines(DISTRIBUTOR)).toEqual([
        'Attn: Aisyah Rahman',
        'Email: ops@testappdist.example',
        'Tel: +60 12-345 6789',
      ])
    })

    it('omits whichever contact field is absent', () => {
      expect(buildCounterpartyContactLines({ contact_name: 'Solo Contact' })).toEqual(['Attn: Solo Contact'])
      expect(buildCounterpartyContactLines({ contact_phone: '03-1234' })).toEqual(['Tel: 03-1234'])
      expect(buildCounterpartyContactLines({ contact_email: 'a@b.co' })).toEqual(['Email: a@b.co'])
      expect(buildCounterpartyContactLines({})).toEqual([])
    })
  })

  describe('resolveCounterparty', () => {
    const order = { buyer_org: DISTRIBUTOR, seller_org: HQ }

    it('shows the distributor buyer on a seller-issued invoice', () => {
      const result = resolveCounterparty(order, 'INVOICE')

      expect(result.label).toBe('Distributor:')
      expect(result.name).toBe('TEST APP DISTRIBUTOR')
      expect(result.isDistributor).toBe(true)
      expect(result.detailLines).toEqual([
        '12 Jalan Perusahaan',
        'Taman Industri',
        'Shah Alam, 40150',
        'Selangor',
        'Attn: Aisyah Rahman',
        'Email: ops@testappdist.example',
        'Tel: +60 12-345 6789',
      ])
    })

    it('never repeats the letterhead organization on an invoice', () => {
      // The regression: the block used to be hardcoded to seller_org, which on
      // an invoice is the issuer already shown in the letterhead.
      const result = resolveCounterparty(order, 'INVOICE')
      expect(result.name).not.toBe('SERAPOD TECHNOLOGY SDN BHD')
    })

    it('shows the seller on a buyer-issued purchase order', () => {
      const result = resolveCounterparty(order, 'PURCHASE ORDER')

      expect(result.label).toBe('Supplier:')
      expect(result.name).toBe('SERAPOD TECHNOLOGY SDN BHD')
      expect(result.isDistributor).toBe(false)
    })

    it.each(['Sales Order', 'Delivery Order', 'Receipt', 'Balance Payment Request'])(
      'names the distributor buyer on the seller-issued %s',
      (title) => {
        const result = resolveCounterparty(order, title)

        expect(result.label).toBe('Distributor:')
        expect(result.name).toBe('TEST APP DISTRIBUTOR')
      },
    )

    it('still points a Payment Advice at the seller being paid', () => {
      const result = resolveCounterparty(order, 'Payment Advice')

      expect(result.label).toBe('Supplier:')
      expect(result.name).toBe('SERAPOD TECHNOLOGY SDN BHD')
    })

    it('labels a non-distributor buyer as the customer on an invoice', () => {
      const result = resolveCounterparty(
        { buyer_org: { org_name: 'Acme Retail', org_type_code: 'SHOP' }, seller_org: HQ },
        'INVOICE',
      )

      expect(result.label).toBe('Customer:')
      expect(result.name).toBe('ACME RETAIL')
    })

    it('survives an order with no counterparty organization attached', () => {
      const result = resolveCounterparty({ buyer_org: null, seller_org: HQ }, 'INVOICE')

      expect(result.name).toBeNull()
      expect(result.detailLines).toEqual([])
      expect(result.label).toBe('Customer:')
    })
  })

  describe('resolveCounterpartyRoleLabel', () => {
    it('names a distributor regardless of the caller-supplied wording', () => {
      expect(resolveCounterpartyRoleLabel(DISTRIBUTOR, 'Customer')).toBe('Distributor')
      expect(resolveCounterpartyRoleLabel(DISTRIBUTOR, 'Supplier')).toBe('Distributor')
      expect(resolveCounterpartyRoleLabel(DISTRIBUTOR, 'Deliver To')).toBe('Distributor')
    })

    it("keeps each document's own business wording for other org types", () => {
      // A manufacturer stays a supplier; a shop stays a customer.
      expect(resolveCounterpartyRoleLabel({ org_type_code: 'MFG' }, 'Supplier')).toBe('Supplier')
      expect(resolveCounterpartyRoleLabel({ org_type_code: 'SHOP' }, 'Customer')).toBe('Customer')
      expect(resolveCounterpartyRoleLabel({ org_type_code: 'HQ' }, 'Received From')).toBe('Received From')
      expect(resolveCounterpartyRoleLabel(null, 'Deliver To')).toBe('Deliver To')
    })

    it('carries no document formatting of its own', () => {
      expect(resolveCounterpartyRoleLabel(DISTRIBUTOR, 'Customer')).not.toContain(':')
    })
  })

  describe('resolvePartyColumnHeading', () => {
    it('replaces the generic heading for a distributor', () => {
      expect(resolvePartyColumnHeading(DISTRIBUTOR, 'BUYER (HQ)')).toBe('DISTRIBUTOR')
    })

    it('keeps the fallback heading for everyone else', () => {
      expect(resolvePartyColumnHeading(HQ, 'BUYER (HQ)')).toBe('BUYER (HQ)')
      expect(resolvePartyColumnHeading(null, 'SUPPLIER / MANUFACTURER')).toBe('SUPPLIER / MANUFACTURER')
    })
  })
})
