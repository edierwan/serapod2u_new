import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  cancelledOpeningBalanceNextAction,
  formatOpeningBalanceDraftCreatedAt,
  formatOpeningBalanceDraftProgress,
  isCancelledOpeningBalanceHistory,
  isResumableOpeningBalanceDraft,
  resolveActiveOpeningBalanceDraft,
} from './opening-balance-active-draft'

const ACTIVE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CANCELLED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER_WH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const VAPE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PET = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

describe('Opening Balance active draft resolution', () => {
  it('treats draft without cutoff or with counting cutoff as resumable', () => {
    expect(isResumableOpeningBalanceDraft({
      status: 'draft',
      count_type: 'opening_balance_cutoff',
      cutoff_status: null,
    })).toBe(true)
    expect(isResumableOpeningBalanceDraft({
      status: 'draft',
      count_type: 'opening_balance_cutoff',
      cutoff_status: 'counting',
    })).toBe(true)
  })

  it('never treats cancelled or posted cutoffs as the active resumable draft', () => {
    expect(isResumableOpeningBalanceDraft({
      status: 'draft',
      count_type: 'opening_balance_cutoff',
      cutoff_status: 'cancelled',
    })).toBe(false)
    expect(isResumableOpeningBalanceDraft({
      status: 'draft',
      count_type: 'opening_balance_cutoff',
      cutoff_status: 'posted',
    })).toBe(false)
    expect(isResumableOpeningBalanceDraft({
      status: 'archived',
      count_type: 'opening_balance_cutoff',
      cutoff_status: 'cancelled',
    })).toBe(false)
  })

  it('resolves the active 0/112 draft instead of a cancelled sibling', () => {
    const active = resolveActiveOpeningBalanceDraft([
      {
        id: CANCELLED_ID,
        status: 'draft',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-1',
        product_category_id: VAPE,
        reference_name: 'OB-CANCELLED',
        created_at: '2026-07-30T10:00:00.000Z',
        updated_at: '2026-07-31T08:00:00.000Z',
        counted_count: 0,
        scope_count: 112,
        cutoff_status: 'cancelled',
      },
      {
        id: ACTIVE_ID,
        status: 'draft',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-1',
        product_category_id: VAPE,
        reference_name: 'OB-20260731',
        created_at: '2026-07-31T09:00:00.000Z',
        updated_at: '2026-07-31T09:05:00.000Z',
        counted_count: 0,
        scope_count: 112,
        cutoff_status: null,
      },
    ], 'wh-1', VAPE)

    expect(active?.id).toBe(ACTIVE_ID)
    expect(formatOpeningBalanceDraftProgress(active!)).toBe('0/112')
    expect(formatOpeningBalanceDraftCreatedAt(active!.created_at)).toContain('2026')
  })

  it('does not reuse a stale cancelled cutoff session across warehouse/category boundaries', () => {
    const drafts = [
      {
        id: CANCELLED_ID,
        status: 'archived',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-1',
        product_category_id: VAPE,
        cutoff_status: 'cancelled' as const,
        counted_count: 10,
        scope_count: 112,
      },
      {
        id: ACTIVE_ID,
        status: 'draft',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-1',
        product_category_id: PET,
        cutoff_status: null,
        counted_count: 0,
        scope_count: 40,
      },
      {
        id: OTHER_WH,
        status: 'draft',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-2',
        product_category_id: VAPE,
        cutoff_status: null,
        counted_count: 5,
        scope_count: 20,
      },
    ]

    expect(resolveActiveOpeningBalanceDraft(drafts, 'wh-1', VAPE)?.id).toBeUndefined()
    expect(resolveActiveOpeningBalanceDraft(drafts, 'wh-1', PET)?.id).toBe(ACTIVE_ID)
    expect(resolveActiveOpeningBalanceDraft(drafts, 'wh-2', VAPE)?.id).toBe(OTHER_WH)
    expect(isCancelledOpeningBalanceHistory(drafts[0])).toBe(true)
  })

  it('prefers a counting freeze over a plain draft when both somehow appear', () => {
    const active = resolveActiveOpeningBalanceDraft([
      {
        id: 'plain',
        status: 'draft',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-1',
        product_category_id: VAPE,
        updated_at: '2026-07-31T12:00:00.000Z',
        cutoff_status: null,
      },
      {
        id: 'counting',
        status: 'draft',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-1',
        product_category_id: VAPE,
        updated_at: '2026-07-31T11:00:00.000Z',
        cutoff_status: 'counting',
      },
    ], 'wh-1', VAPE)
    expect(active?.id).toBe('counting')
  })

  it('offers Return to Active Draft when one exists, otherwise Create New', () => {
    expect(cancelledOpeningBalanceNextAction(true)).toEqual({
      label: 'Return to Active Draft',
      kind: 'return_active',
    })
    expect(cancelledOpeningBalanceNextAction(false)).toEqual({
      label: 'Create New Opening Balance',
      kind: 'create_new',
    })
  })
})

describe('Cancel freeze archives linked draft session (SQL contract)', () => {
  const migration = fs.readFileSync(
    new URL(
      '../../../../supabase/migrations/20260731220000_inventory_cutoff_cancel_archives_draft_session.sql',
      import.meta.url,
    ),
    'utf8',
  )
  const verificationRequest = fs.readFileSync(
    new URL('../../app/api/inventory/stock-count/verification/request/route.ts', import.meta.url),
    'utf8',
  )
  const verifyRoute = fs.readFileSync(
    new URL('../../app/api/inventory/stock-count/verification/verify/route.ts', import.meta.url),
    'utf8',
  )

  it('is forward-only and does not mutate inventory/orders/QR business tables', () => {
    expect(migration).toContain('create or replace function public.cancel_inventory_opening_cutoff')
    expect(migration).not.toMatch(
      /\b(insert into|update|delete from)\s+public\.(product_inventory|stock_movements|orders|order_items|qr_)/i,
    )
  })

  it('archives the linked draft session and backfills stuck cancelled drafts', () => {
    expect(migration).toContain("status = 'archived'")
    expect(migration).toContain("count_type = 'opening_balance_cutoff'")
    expect(migration).toContain("c.status = 'cancelled'")
    expect(migration).toContain("and not exists")
    expect(migration).toContain("c.status in ('counting', 'posted')")
  })

  it('keeps cancelled cutoff linked for audit and does not reuse it', () => {
    expect(migration).toContain('session_archived')
    expect(migration).toContain("status = 'cancelled'")
    // Cancel marks counting -> cancelled; it must never revive a cancelled row.
    expect(migration).not.toMatch(/status\s*=\s*'counting'\s*,/)
    expect(migration).not.toMatch(/set\s+status\s*=\s*'counting'/i)
  })

  it('OTP request and posting reject non-counting Opening Balance cutoffs', () => {
    expect(verificationRequest).toContain("cutoff.status !== 'counting'")
    expect(verificationRequest).toContain('opening_balance_cutoff')
    expect(verifyRoute).toContain('verify_and_post_inventory_opening_cutoff')
  })
})
