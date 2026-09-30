import { describe, expect, it } from 'vitest'
import { aggregateRollout, filterModules, rolloutMode, summarizeDifferences } from './rollout'

const modes = [
  { permission_key: 'finance.ledger.view', mode: 'NEW_ENFORCED', enforcementReady: true },
  { permission_key: 'finance.module.view', mode: 'NEW_ENFORCED', enforcementReady: true },
  { permission_key: 'finance.report.view_sensitive', mode: 'LEGACY_RETIRED' },
  { permission_key: 'inventory.stock_count.create', mode: 'SHADOW' },
  { permission_key: 'inventory.stock_count.view', mode: 'NEW_ENFORCED', enforcementReady: true },
  { permission_key: 'hr.payroll.approve', mode: 'NEW_ENFORCED' },
  { permission_key: 'security.role.manage', mode: 'LEGACY_RETIRED' },
  { permission_key: 'customer.crm.view', mode: 'SHADOW' },
  { permission_key: 'qr.batch.manage', mode: 'LEGACY_ENFORCED' },
]

describe('aggregateRollout', () => {
  const rollout = aggregateRollout(modes)

  it('groups by the existing permission groups in the existing order', () => {
    expect(rollout.modules.map(m => m.name)).toEqual(
      ['Finance', 'HR & Payroll', 'Stock Count', 'QR & Traceability', 'Customer & Growth', 'Security Administration'])
  })

  it('module counts and totals reconcile with the source modes', () => {
    expect(rollout.total).toBe(modes.length)
    expect(rollout.modules.reduce((n, m) => n + m.total, 0)).toBe(modes.length)
    for (const m of rollout.modules) {
      expect(Object.values(m.counts).reduce((a, b) => a + b, 0)).toBe(m.total)
    }
    for (const mode of ['NEW_ENFORCED', 'SHADOW', 'LEGACY_RETIRED', 'LEGACY_ENFORCED']) {
      expect(rollout.totals[mode]).toBe(modes.filter(x => x.mode === mode).length)
    }
    expect(rollout.modules.find(m => m.name === 'Finance')!.counts).toEqual({ NEW_ENFORCED: 2, LEGACY_RETIRED: 1 })
  })

  it('never drops a mode: additional modes get their own column', () => {
    expect(rollout.columns).toEqual(['NEW_ENFORCED', 'SHADOW', 'LEGACY_RETIRED', 'LEGACY_ENFORCED'])
    expect(aggregateRollout(modes.filter(m => m.mode !== 'LEGACY_ENFORCED')).columns)
      .toEqual(['NEW_ENFORCED', 'SHADOW', 'LEGACY_RETIRED'])
    const odd = aggregateRollout([{ permission_key: 'finance.x.view', mode: 'SOMETHING_NEW' }])
    expect(odd.columns).toContain('SOMETHING_NEW')
    expect(odd.totals.SOMETHING_NEW).toBe(1)
  })

  it('keeps readiness separate from the current mode', () => {
    const stock = rollout.modules.find(m => m.name === 'Stock Count')!
    expect(stock.permissions.find(p => p.key === 'inventory.stock_count.create')).toMatchObject({ mode: 'SHADOW', enforcementReady: false })
    expect(stock.permissions.find(p => p.key === 'inventory.stock_count.view')).toMatchObject({ mode: 'NEW_ENFORCED', enforcementReady: true })
  })

  it('handles no modes', () => {
    expect(aggregateRollout([])).toEqual({ modules: [], columns: ['NEW_ENFORCED', 'SHADOW', 'LEGACY_RETIRED'], totals: {}, total: 0 })
  })
})

describe('filterModules', () => {
  const { modules } = aggregateRollout(modes)
  it('matches module names, permission names and technical keys, case-insensitively', () => {
    expect(filterModules(modules, 'fin').map(m => m.name)).toEqual(['Finance'])
    expect(filterModules(modules, 'approve payroll').map(m => m.name)).toEqual(['HR & Payroll'])
    expect(filterModules(modules, 'QR.BATCH').map(m => m.name)).toEqual(['QR & Traceability'])
  })
  it('returns everything for an empty query and nothing for no match', () => {
    expect(filterModules(modules, '  ')).toHaveLength(modules.length)
    expect(filterModules(modules, 'zzz')).toEqual([])
  })
})

describe('summarizeDifferences', () => {
  const decisions = [
    { occurred_at: '2026-09-29T10:00:00Z', permission_key: 'customer.crm.view', comparison: 'LEGACY_ALLOW_NEW_DENY' },
    { occurred_at: '2026-09-29T09:00:00Z', permission_key: 'customer.crm.view', comparison: 'LEGACY_ALLOW_NEW_DENY' },
    { occurred_at: '2026-09-28T09:00:00Z', permission_key: 'finance.ledger.view', comparison: 'SCOPE_MISMATCH' },
    { occurred_at: '2026-09-27T09:00:00Z', permission_key: 'finance.ledger.view', comparison: 'MATCH_DENY' },
  ]

  it('counts only real differences and reports the actual period of the sample', () => {
    const s = summarizeDifferences(decisions, modes, 100)
    expect(s.count).toBe(3)
    expect(s.from).toBe('2026-09-27T09:00:00Z')
    expect(s.to).toBe('2026-09-29T10:00:00Z')
    expect(s.sampleSize).toBe(4)
    expect(s.capped).toBe(false)
    expect(s.byPermission).toEqual({ 'customer.crm.view': 2, 'finance.ledger.view': 1 })
  })

  it('separates differences still awaiting review (Monitoring) from historical ones', () => {
    const s = summarizeDifferences(decisions, modes, 100)
    expect(s.pending).toBe(2)
    expect(s.pendingPermissions).toEqual(['customer.crm.view'])
    expect(s.historical).toBe(1)
  })

  it('flags a capped sample and handles an empty log', () => {
    expect(summarizeDifferences(decisions, modes, 4).capped).toBe(true)
    expect(summarizeDifferences([], modes, 100)).toMatchObject({ count: 0, from: null, to: null, pending: 0, capped: false })
  })

  it('uses the Overview wording without changing mode values', () => {
    expect(rolloutMode('SHADOW').label).toBe('Monitoring')
    expect(rolloutMode('NEW_ENFORCED').label).toBe('New Access Active')
    expect(rolloutMode('LEGACY_RETIRED').label).toBe('Legacy Retired')
  })
})
