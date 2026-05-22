import { describe, expect, it } from 'vitest'

import { resolveRegistrationLinkSelection } from './registration-link-resolution'

function createAdminMock({
  organization,
  referenceUser,
}: {
  organization?: any
  referenceUser?: any
}) {
  return {
    from: (table: string) => {
      if (table === 'organizations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: organization || null }),
            }),
          }),
        }
      }

      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: referenceUser || null }),
            }),
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

describe('resolveRegistrationLinkSelection', () => {
  it('rejects a shop selection when the text no longer matches the selected shop id', async () => {
    const result = await resolveRegistrationLinkSelection(createAdminMock({
      organization: {
        id: 'shop-1',
        org_name: 'Kedai Maju',
        branch: 'HQ',
        org_type_code: 'SHOP',
        is_active: true,
      },
    }), {
      organizationId: 'shop-1',
      shopName: 'Kedai Lain',
      referenceUserId: 'ref-1',
    })

    expect(result).toEqual({
      ok: false,
      field: 'shop',
      error: 'Please select a valid shop from the list.',
    })
  })

  it('rejects a reference selection when the submitted phone does not match the selected reference id', async () => {
    const result = await resolveRegistrationLinkSelection(createAdminMock({
      organization: {
        id: 'shop-1',
        org_name: 'Kedai Maju',
        branch: null,
        org_type_code: 'SHOP',
        is_active: true,
      },
      referenceUser: {
        id: 'ref-1',
        phone: '+60123456789',
        full_name: 'Ref One',
        call_name: null,
        can_be_reference: true,
        is_active: true,
      },
    }), {
      organizationId: 'shop-1',
      shopName: 'Kedai Maju',
      referenceUserId: 'ref-1',
      referralPhone: '+60199999999',
    })

    expect(result).toEqual({
      ok: false,
      field: 'reference',
      error: 'Please select a valid reference from the list.',
    })
  })

  it('returns canonical shop and reference data when both selections are valid', async () => {
    const result = await resolveRegistrationLinkSelection(createAdminMock({
      organization: {
        id: 'shop-1',
        org_name: 'Kedai Maju',
        branch: 'HQ',
        org_type_code: 'SHOP',
        is_active: true,
      },
      referenceUser: {
        id: 'ref-1',
        phone: '+60123456789',
        full_name: 'Ref One',
        call_name: 'Ref',
        can_be_reference: true,
        is_active: true,
      },
    }), {
      organizationId: 'shop-1',
      shopName: 'Kedai Maju (HQ)',
      referenceUserId: 'ref-1',
      referralPhone: '0123456789',
    })

    expect(result).toEqual({
      ok: true,
      organizationId: 'shop-1',
      organizationName: 'Kedai Maju',
      shopDisplayName: 'Kedai Maju (HQ)',
      referenceUserId: 'ref-1',
      referralPhone: '+60123456789',
      referenceDisplayName: 'Ref',
    })
  })
})