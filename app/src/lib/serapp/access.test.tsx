import { describe, expect, it } from 'vitest'
import { getSerappAccessDecision, getSerappDefaultPath, resolvePortalHomePath } from './access'
import { summarizeSerappPasteCheck } from './paste-check-summary'
import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'

describe('getSerappAccessDecision', () => {
  it('allows distributor portal users', () => {
    expect(getSerappAccessDecision({
      accountScope: 'portal',
      orgTypeCode: 'DIST',
      organizationId: 'dist-1',
      roleLevel: 40,
    })).toMatchObject({ allowed: true, isDistributor: true })
  })

  it('allows HQ support for UAT', () => {
    expect(getSerappAccessDecision({
      accountScope: 'portal',
      orgTypeCode: 'HQ',
      organizationId: 'hq-1',
      roleLevel: 10,
    })).toMatchObject({ allowed: true, isHqSupport: true })
  })

  it('returns serapp chat path for distributors', () => {
    expect(getSerappDefaultPath(getSerappAccessDecision({
      accountScope: 'portal',
      orgTypeCode: 'DIST',
      organizationId: 'dist-1',
      roleLevel: 40,
    }))).toBe('/serapp/conversation')

    expect(getSerappDefaultPath(getSerappAccessDecision({
      accountScope: 'portal',
      orgTypeCode: 'HQ',
      organizationId: 'hq-1',
      roleLevel: 10,
    }))).toBeNull()
  })

  it('routes portal users to serapp or dashboard', () => {
    expect(resolvePortalHomePath({
      accountScope: 'portal',
      orgTypeCode: 'DIST',
      organizationId: 'dist-1',
      roleLevel: 40,
    })).toBe('/serapp/conversation')

    expect(resolvePortalHomePath({
      accountScope: 'portal',
      orgTypeCode: 'WH',
      organizationId: 'wh-1',
      roleLevel: 30,
    })).toBe('/dashboard')
  })

  it('blocks shop and non-portal accounts', () => {
    expect(getSerappAccessDecision({
      accountScope: 'portal',
      orgTypeCode: 'SHOP',
      organizationId: 'shop-1',
      roleLevel: 40,
    }).allowed).toBe(false)

    expect(getSerappAccessDecision({
      accountScope: 'storefront',
      orgTypeCode: 'DIST',
      organizationId: 'dist-1',
      roleLevel: 40,
    }).allowed).toBe(false)
  })
})

describe('summarizeSerappPasteCheck', () => {
  const base = {
    line: 1,
    sourceLine: 1,
    raw: 'x',
    name: 'x',
    normalizedName: 'X',
    quantity: 1,
    candidates: [],
  }

  it('returns Available when every product line is matched with stock', () => {
    const results = [
      { ...base, status: 'section_header', quantity: null, sectionProductLine: 'Cellera Hero' },
      { ...base, line: 2, status: 'matched', selectedVariantId: 'a', inventoryOutcome: 'matched' },
      { ...base, line: 3, status: 'alternative_match', selectedVariantId: 'b', inventoryOutcome: 'matched' },
    ] as PasteMatchResult[]

    expect(summarizeSerappPasteCheck(results)).toMatchObject({
      bucket: 'available',
      label: 'Available',
      sectionHeaders: 1,
      availableLines: 2,
    })
  })

  it('returns Partially Available when some lines lack stock', () => {
    const results = [
      { ...base, status: 'matched', selectedVariantId: 'a', inventoryOutcome: 'matched' },
      { ...base, line: 2, status: 'matched', selectedVariantId: 'b', inventoryOutcome: 'insufficient_stock' },
    ] as PasteMatchResult[]

    expect(summarizeSerappPasteCheck(results).bucket).toBe('partially_available')
  })

  it('returns Unmatched / Requires Review when headers need review or lines are unresolved', () => {
    const results = [
      { ...base, status: 'requires_review', quantity: 100, sectionProductLine: 'Cellera Hero' },
    ] as PasteMatchResult[]

    expect(summarizeSerappPasteCheck(results)).toMatchObject({
      bucket: 'unmatched_or_review',
      label: 'Unmatched / Requires Review',
    })
  })
})
