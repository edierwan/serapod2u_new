// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  USER_ORGANIZATION_TYPES,
  filterOrganizationsForType,
  organizationIdForType,
} from './UserDialogNew'

const organizations = [
  { id: 'hq-1', org_name: 'Serapod HQ', org_code: 'HQ01', org_type_code: 'HQ' },
  { id: 'mfg-1', org_name: 'Alpha Factory', org_code: 'MF01', org_type_code: 'MFG' },
  { id: 'mfg-2', org_name: 'Beta Manufacturing', org_code: 'MF02', org_type_code: 'MFG' },
  { id: 'dist-1', org_name: 'Main Distributor', org_code: 'DS01', org_type_code: 'DIST' },
  { id: 'shop-1', org_name: 'Retail Shop', org_code: 'SH01', org_type_code: 'SHOP' },
] as any

describe('User Management Manufacturer organization selection', () => {
  it('includes the Manufacturer card', () => {
    expect(USER_ORGANIZATION_TYPES).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'MFG', label: 'Manufacturer' }),
    ]))
  })

  it('lists and searches only Manufacturer organizations', () => {
    expect(filterOrganizationsForType(organizations, 'MFG').map(org => org.id)).toEqual(['mfg-1', 'mfg-2'])
    expect(filterOrganizationsForType(organizations, 'MFG', 'beta').map(org => org.id)).toEqual(['mfg-2'])
    expect(filterOrganizationsForType(organizations, 'MFG', 'HQ')).toEqual([])
  })

  it('clears an organization that is invalid after changing type', () => {
    expect(organizationIdForType(organizations, 'hq-1', 'MFG')).toBe('')
    expect(organizationIdForType(organizations, 'mfg-1', 'MFG')).toBe('mfg-1')
  })
})
