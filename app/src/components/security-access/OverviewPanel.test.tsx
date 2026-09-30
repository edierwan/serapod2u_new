// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OverviewPanel from './OverviewPanel'

afterEach(() => cleanup())

const modes = [
  { permission_key: 'finance.ledger.view', mode: 'NEW_ENFORCED', enforcementReady: true },
  { permission_key: 'finance.report.view_sensitive', mode: 'LEGACY_RETIRED', enforcementReady: true },
  { permission_key: 'customer.crm.view', mode: 'SHADOW', enforcementReady: true },
  { permission_key: 'inventory.stock_count.create', mode: 'SHADOW', enforcementReady: false },
]
const base = {
  schemaReady: true,
  metrics: { businessIdentities: 54, activeAssignments: 488, shadowMismatches: 2 },
  modes,
  decisions: [
    { occurred_at: '2026-09-29T10:00:00Z', permission_key: 'customer.crm.view', comparison: 'LEGACY_ALLOW_NEW_DENY' },
    { occurred_at: '2026-09-28T10:00:00Z', permission_key: 'finance.ledger.view', comparison: 'SCOPE_MISMATCH' },
    { occurred_at: '2026-09-27T10:00:00Z', permission_key: 'finance.ledger.view', comparison: 'MATCH_DENY' },
  ],
}

describe('Security & Access Overview', () => {
  it('shows the real metrics, the actual period and working links', async () => {
    const onNavigate = vi.fn()
    render(<OverviewPanel data={base} onNavigate={onNavigate} />)
    expect(screen.getByText('54')).toBeTruthy()
    expect(screen.getByText('488')).toBeTruthy()
    expect(screen.getByText('Active organization memberships')).toBeTruthy()
    expect(screen.getByText(/^Recorded /).textContent).not.toMatch(/24 hours/)

    await userEvent.click(screen.getByRole('button', { name: /View people/ }))
    expect(onNavigate).toHaveBeenLastCalledWith({ tab: 'people' })
    await userEvent.click(screen.getByRole('button', { name: /View assignments/ }))
    expect(onNavigate).toHaveBeenLastCalledWith({ tab: 'people' })
    const review = screen.getAllByRole('button', { name: /Review differences/ })
    await userEvent.click(review[0])
    expect(onNavigate).toHaveBeenLastCalledWith({ tab: 'audit', differencesOnly: true })
  })

  it('flags only differences on permissions still in Monitoring', () => {
    render(<OverviewPanel data={base} onNavigate={vi.fn()} />)
    const status = screen.getByRole('status')
    expect(within(status).getByText('Needs attention')).toBeTruthy()
    expect(status.textContent).toMatch(/1 access difference recorded.*for 1 permission still in Monitoring/)
  })

  it('stays quiet when differences are only on enforced permissions, and hides when there are none', () => {
    const enforcedOnly = { ...base, decisions: [base.decisions[1]] }
    const { unmount } = render(<OverviewPanel data={enforcedOnly} onNavigate={vi.fn()} />)
    expect(screen.queryByText('Needs attention')).toBeNull()
    expect(screen.getByText(/new model already decides/)).toBeTruthy()
    unmount()
    render(<OverviewPanel data={{ ...base, decisions: [], metrics: { ...base.metrics, shadowMismatches: 0 } }} onNavigate={vi.fn()} />)
    expect(screen.queryByText('Needs attention')).toBeNull()
    expect(screen.queryByText(/new model already decides/)).toBeNull()
    expect(screen.getByText('No differences recorded')).toBeTruthy()
  })

  it('renders a module table whose totals reconcile, collapsed until expanded', async () => {
    const onNavigate = vi.fn()
    render(<OverviewPanel data={base} onNavigate={onNavigate} />)
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    const finance = rows.find(r => within(r).queryByRole('rowheader', { name: /Finance/ }))!
    expect(within(finance).getAllByRole('cell').map(c => c.textContent)).toEqual(['1', '0', '1', 'View details for Finance'])
    const total = rows.find(r => within(r).queryByRole('rowheader', { name: /Total/ }))!
    expect(within(total).getAllByRole('cell').slice(0, 3).map(c => c.textContent)).toEqual(['1', '2', '1'])

    expect(screen.queryByText('finance.ledger.view')).toBeNull()
    const toggle = within(finance).getByRole('button', { name: /View details for Finance/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('finance.ledger.view')).toBeTruthy()
    expect(screen.getAllByText('Ready to enable').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: /Change mode for View Ledger/ }))
    expect(onNavigate).toHaveBeenLastCalledWith({ tab: 'roles', query: 'finance.ledger.view' })
  })

  it('expands with the keyboard', async () => {
    render(<OverviewPanel data={base} onNavigate={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: /View details for Stock Count/ })
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('inventory.stock_count.create')).toBeTruthy()
    expect(screen.getByText('Not marked ready')).toBeTruthy()
  })

  it('filters modules and shows a no-results state', async () => {
    render(<OverviewPanel data={base} onNavigate={vi.fn()} />)
    const search = screen.getByRole('textbox', { name: /Search modules/ })
    await userEvent.type(search, 'crm')
    expect(screen.getByRole('rowheader', { name: /Customer & Growth/ })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: /^Finance/ })).toBeNull()
    await userEvent.clear(search)
    await userEvent.type(search, 'nothing-matches')
    expect(screen.getByText(/No modules or permissions match/)).toBeTruthy()
  })

  it('shows every mode present, including ones outside the three rollout columns', () => {
    const withLegacy = { ...base, modes: [...modes, { permission_key: 'qr.batch.manage', mode: 'LEGACY_ENFORCED' }] }
    render(<OverviewPanel data={withLegacy} onNavigate={vi.fn()} />)
    expect(within(screen.getByRole('table')).getAllByText('Legacy Active').length).toBeGreaterThan(0)
  })

  it('shows an empty state when no permissions are registered', () => {
    render(<OverviewPanel data={{ schemaReady: false, metrics: {}, modes: [], decisions: [] }} onNavigate={vi.fn()} />)
    expect(screen.getByText(/No permissions are registered/)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBe(2)
  })
})
