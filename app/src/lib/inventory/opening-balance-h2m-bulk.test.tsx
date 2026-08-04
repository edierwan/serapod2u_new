import { describe, expect, it } from 'vitest'
import {
  H2M_BULK_MIGRATION,
  H2mBulkInvalidResponseError,
  categorizeH2mBulkError,
  describeH2mBulkRpcResponse,
  normalizeH2mBulkRpcResponse,
  parseH2mBulkSummary,
  serializeH2mBulkSummary,
} from './opening-balance-h2m-bulk'

const cutoffId = '10000000-0000-4000-8000-000000000001'
const categoryId = '20000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const itemId = '40000000-0000-4000-8000-000000000001'
const blockedItemId = '40000000-0000-4000-8000-000000000002'

const payload = {
  action: 'selected_incoming',
  cutoff_id: cutoffId,
  confirmation_fingerprint: 'scope-v2',
  product_category_id: categoryId,
  product_category_name: 'Vape',
  eligible_item_count: 1,
  affected_order_count: 1,
  resolved_item_count: 7,
  saved_incoming_count: 5,
  saved_not_incoming_count: 2,
  blocked_item_count: 1,
  eligible_order_ids: [orderId],
  eligible_item_ids: [itemId],
  blocked_item_ids: [blockedItemId],
}

describe('H2M canonical bulk response', () => {
  it('parses the real SQL JSONB snake_case contract and serializes it without camelCase drift', () => {
    const parsed = parseH2mBulkSummary(payload)
    expect(parsed).toMatchObject({
      action: 'selected_incoming',
      cutoffId,
      confirmationFingerprint: 'scope-v2',
      productCategoryName: 'Vape',
      eligibleItemCount: 1,
      affectedOrderCount: 1,
      savedIncomingCount: 5,
      blockedItemCount: 1,
      eligibleOrderIds: [orderId],
      eligibleItemIds: [itemId],
      blockedItemIds: [blockedItemId],
    })
    expect(serializeH2mBulkSummary(parsed)).toEqual(payload)
  })

  it('accepts a direct JSONB object and one unambiguous Supabase row wrapper only', () => {
    expect(normalizeH2mBulkRpcResponse(payload)).toBe(payload)
    expect(normalizeH2mBulkRpcResponse([payload])).toBe(payload)
    expect(parseH2mBulkSummary([payload]).cutoffId).toBe(cutoffId)
    expect(() => normalizeH2mBulkRpcResponse([])).toThrow('h2m_bulk_invalid_response')
    expect(() => normalizeH2mBulkRpcResponse([payload, payload])).toThrow(
      'h2m_bulk_invalid_response',
    )
    expect(() => parseH2mBulkSummary([{ payload }])).toThrow(
      'h2m_bulk_invalid_response',
    )
  })

  it('accepts valid zero counts, numeric strings and empty UUID arrays', () => {
    const empty = {
      ...payload,
      action: 'all_remaining_not_incoming',
      eligible_item_count: 0,
      affected_order_count: '0',
      resolved_item_count: '0',
      saved_incoming_count: 0,
      saved_not_incoming_count: '0',
      blocked_item_count: 0,
      eligible_order_ids: [],
      eligible_item_ids: [],
      blocked_item_ids: [],
    }
    expect(parseH2mBulkSummary(empty)).toMatchObject({
      eligibleItemCount: 0,
      affectedOrderCount: 0,
      resolvedItemCount: 0,
      savedIncomingCount: 0,
      savedNotIncomingCount: 0,
      blockedItemCount: 0,
      eligibleOrderIds: [],
      eligibleItemIds: [],
      blockedItemIds: [],
    })
  })

  it.each([
    ['cutoff_id', null],
    ['confirmation_fingerprint', null],
    ['eligible_item_count', null],
    ['eligible_item_count', undefined],
    ['eligible_order_ids', null],
    ['eligible_item_ids', undefined],
    ['blocked_item_ids', null],
  ])('fails closed when required %s is null or missing', (field, value) => {
    const malformed = { ...payload, [field]: value }
    expect(() => parseH2mBulkSummary(malformed)).toThrow('h2m_bulk_invalid_response')
  })

  it('rejects malformed, duplicate and count-mismatched UUID arrays safely', () => {
    expect(() => parseH2mBulkSummary({
      ...payload,
      eligible_item_ids: ['not-a-uuid'],
    })).toThrow('h2m_bulk_invalid_response')
    expect(() => parseH2mBulkSummary({
      ...payload,
      eligible_item_count: 2,
      eligible_item_ids: [itemId, itemId],
    })).toThrow('h2m_bulk_invalid_response')
    expect(() => parseH2mBulkSummary({
      ...payload,
      eligible_item_count: 0,
    })).toThrow('h2m_bulk_invalid_response')
  })

  it('identifies the exact rejected field and a safe actual description', () => {
    try {
      parseH2mBulkSummary({ ...payload, cutoff_id: null })
      throw new Error('expected parser failure')
    } catch (error) {
      expect(error).toBeInstanceOf(H2mBulkInvalidResponseError)
      expect((error as H2mBulkInvalidResponseError).details).toEqual({
        field: 'cutoff_id',
        expected: 'a non-empty string',
        actual: 'null',
      })
    }
    expect(describeH2mBulkRpcResponse([payload])).toEqual({
      responseType: 'array',
      topLevelKeys: Object.keys(payload).sort(),
    })
  })

  it('categorizes resolver, authorization, stale and generic errors precisely', () => {
    expect(categorizeH2mBulkError({
      code: 'PGRST202',
      message: 'Could not find the function in the schema cache',
    }, false).category).toBe('h2m_bulk_resolver_unavailable')
    expect(categorizeH2mBulkError({
      code: '42501',
      message: 'permission_denied',
    }, false).category).toBe('h2m_bulk_unauthorized')
    expect(categorizeH2mBulkError({
      code: 'P0001',
      message: 'inventory_cutoff_h2m_bulk_scope_changed',
    }, true).category).toBe('h2m_bulk_stale_confirmation')
    expect(categorizeH2mBulkError({
      code: 'P0001',
      message: 'some failure',
    }, false).category).toBe('h2m_bulk_preflight_failed')
    expect(H2M_BULK_MIGRATION).toBe(
      '20260731173000_inventory_cutoff_h2m_bulk_contract_targeting_fix.sql',
    )
  })
})
