import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateStockCountPreflight, type StockCountPreflightDependencies } from './stock-count-verification-preflight'
import { stockCountVerificationError } from './stock-count-verification-errors'
import { canExecuteInventoryCutoff, type CutoffReport } from './inventory-cutoff'
import { summarizeOpeningBalance } from './opening-balance-classification'

const repoFile = (path: string) => fs.readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
)

const requestRoute = repoFile('app/src/app/api/inventory/stock-count/verification/request/route.ts')
const verifyRoute = repoFile('app/src/app/api/inventory/stock-count/verification/verify/route.ts')
const cutoffSection = repoFile('app/src/components/inventory/InventoryOpeningCutoffSection.tsx')
const migration240 = repoFile('supabase/migrations/20260801240000_opening_balance_post_allows_review_required.sql')

/** Deterministic 112-config Opening Balance fixture totaling 296,450 units. */
function build112ConfigItems() {
  const items: Array<{
    stock_config_id: string
    variant_id: string
    physical_quantity: number
    adjustment_quantity: number
    unit_cost: number
    note: string
  }> = []
  // 110 configs × 2,650 = 291,500; last two configs carry the remainder to 296,450.
  for (let i = 0; i < 110; i += 1) {
    items.push({
      stock_config_id: `cfg-${i + 1}`,
      variant_id: `var-${(i % 40) + 1}`,
      physical_quantity: 2650,
      adjustment_quantity: i === 0 ? -10 : 0,
      unit_cost: 1,
      note: '',
    })
  }
  items.push({
    stock_config_id: 'cfg-111',
    variant_id: 'var-41',
    physical_quantity: 2475,
    adjustment_quantity: 0,
    unit_cost: 1,
    note: '',
  })
  items.push({
    stock_config_id: 'cfg-112',
    variant_id: 'var-42',
    physical_quantity: 2475,
    adjustment_quantity: 0,
    unit_cost: 1,
    note: '',
  })
  return items
}

function preflightDeps(overrides: Partial<StockCountPreflightDependencies> = {}): StockCountPreflightDependencies {
  const items = build112ConfigItems()
  return {
    loadAccessibleSession: async () => ({
      id: 'sess-5th',
      status: 'draft',
      count_type: 'opening_balance_cutoff',
      warehouse_organization_id: 'wh-1',
      notes: 'Testing for OTP',
      stock_count_session_items: items,
    }),
    loadActiveWarehouse: async () => ({ id: 'wh-1' }),
    loadVariantBaseCosts: async (ids) => ids.map(id => ({ id, base_cost: '1.00' })),
    loadClassificationLiveLegacy: async () => [],
    loadVariantLabels: async () => [],
    loadClassificationAllocationResolutions: async () => [],
    checkPermission: async () => ({ allowed: true, context: { organization_id: 'org-1' } }),
    loadEvent: async () => ({ event_code: 'stock_count_posting_verification', available_channels: ['email'] }),
    loadSetting: async () => ({
      enabled: true,
      channels_enabled: ['email'],
      recipient_config: {
        recipient_targets: { users: true },
        recipient_users: ['user-2'],
        manual_email_addresses: [],
      },
    }),
    loadUsers: async () => [{ id: 'user-2', email: 'approver@example.com' }],
    loadProvider: async () => ({
      provider_name: 'resend',
      config_public: { from_email: 'security@example.com' },
      config_encrypted: { api_key: 'encrypted' },
    }),
    ...overrides,
  }
}

describe('Opening Balance OTP accepts Review Required + counted session snapshot', () => {
  it('request route rejects ONLY Blocked readiness — never exact Ready-only', () => {
    expect(requestRoute).toContain("readiness === 'Blocked'")
    expect(requestRoute).toContain("readiness === 'Ready' || readiness === 'Review Required'")
    expect(requestRoute).toContain('postableReadiness')
    expect(requestRoute).not.toContain("cutoffPreview?.readiness !== 'Ready'")
    // Empty blockers[] must not collapse into the default counted-quantities message.
    expect(requestRoute).toContain('blockerList.length > 0')
    expect(requestRoute).toContain('Resolve all Opening Balance blockers before requesting verification.')
  })

  it('SQL bind/post migration matches the same Blocked-only gate', () => {
    expect(migration240).toMatch(/v_preview->>'readiness'\s*=\s*'Blocked'\s*then/i)
    expect(migration240).not.toContain("<> 'Ready'")
  })

  it('app gate, request route and verify RPC share the session/cutoff identifiers', () => {
    expect(canExecuteInventoryCutoff({
      readiness: 'Review Required',
      status: 'counting',
      freeze_active: true,
    } as CutoffReport, true)).toBe(true)
    expect(requestRoute).toContain("session.count_type === 'opening_balance_cutoff'")
    expect(requestRoute).toContain('.eq(\'stock_count_session_id\', sessionId)')
    expect(requestRoute).toContain('inventory_cutoff_preview')
    expect(verifyRoute).toContain('verify_and_post_inventory_opening_cutoff')
    expect(cutoffSection).toContain("JSON.stringify({ sessionId: activeCutoff.stock_count_session_id })")
    expect(cutoffSection).toContain('persistPostingNote')
  })

  it('112 valid counted configs totaling 296,450 are accepted by OTP preflight', async () => {
    const items = build112ConfigItems()
    expect(items).toHaveLength(112)
    expect(items.reduce((sum, item) => sum + item.physical_quantity, 0)).toBe(296_450)

    const result = await evaluateStockCountPreflight(preflightDeps(), 'user-1', 'sess-5th')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.totalVariantsCounted).toBe(112)
    expect(result.session.count_type).toBe('opening_balance_cutoff')
    expect(result.session.notes).toBe('Testing for OTP')
  })

  it('preview inventory summary uses the same physical_quantity source as OTP preflight', () => {
    const items = build112ConfigItems()
    const preview = {
      inventory: items.map(item => ({
        stock_config_id: item.stock_config_id,
        physical_quantity: item.physical_quantity,
        system_quantity: item.physical_quantity - item.adjustment_quantity,
        variance: item.adjustment_quantity,
      })),
      distributor_orders: [],
      manufacturer_incoming: [],
      warehouse_activity: [],
      blockers: [],
    }
    const summary = summarizeOpeningBalance(preview as any)
    expect(summary.physicalOpeningStock.countedRows).toBe(112)
    expect(summary.physicalOpeningStock.totalQuantity).toBe(296_450)
  })

  it('genuinely empty / null counted quantities remain rejected', async () => {
    const empty = await evaluateStockCountPreflight(preflightDeps({
      loadAccessibleSession: async () => ({
        id: 'sess-empty',
        status: 'draft',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-1',
        notes: 'Testing for OTP',
        stock_count_session_items: [],
      }),
    }), 'user-1', 'sess-empty')
    expect(empty).toEqual({ ok: false, code: 'invalid_count_data' })

    const nullOnly = await evaluateStockCountPreflight(preflightDeps({
      loadAccessibleSession: async () => ({
        id: 'sess-null',
        status: 'draft',
        count_type: 'opening_balance_cutoff',
        warehouse_organization_id: 'wh-1',
        notes: 'Testing for OTP',
        stock_count_session_items: [{
          stock_config_id: 'cfg-1',
          variant_id: 'var-1',
          physical_quantity: null,
          adjustment_quantity: null,
          unit_cost: 1,
          note: '',
        }],
      }),
    }), 'user-1', 'sess-null')
    expect(nullOnly).toEqual({ ok: false, code: 'invalid_count_data' })
  })

  it('Blocked readiness still rejects OTP at the request-route contract (counts alone are insufficient)', () => {
    // Counts may be valid while blockers remain — route must still refuse OTP.
    expect(canExecuteInventoryCutoff({
      readiness: 'Blocked',
      status: 'counting',
      freeze_active: true,
    } as CutoffReport, true)).toBe(false)
    expect(requestRoute).toContain("readiness === 'Blocked'")
  })

  it('empty blockers message for Review Required never becomes the default counted-quantities text', () => {
    // Reproduce the prior defect: '' || defaultMessage → misleading default.
    const withEmpty = stockCountVerificationError('invalid_count_data', { message: '' })
    expect(withEmpty.message).toBe('This Stock Count does not contain valid counted quantities.')
    // The route must therefore refuse to pass an empty blockers join as message.
    expect(requestRoute).toContain('blockerList.length > 0')
    expect(requestRoute).not.toMatch(/blockers\.join\(' '\)\s*\n?\s*:/)
  })

  it('UI preserves Posting Note and shows verification errors without claiming Ready to Post', () => {
    expect(cutoffSection).toContain('postingNoteDirtyRef')
    expect(cutoffSection).toContain('Verification unavailable')
    expect(cutoffSection).toContain('No blockers — OTP may be requested')
    expect(cutoffSection).toContain('verificationError')
    expect(cutoffSection).toContain('otpRequestInFlightRef')
  })
})
