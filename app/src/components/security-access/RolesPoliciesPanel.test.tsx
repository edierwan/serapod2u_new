// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RolesPoliciesPanel from './RolesPoliciesPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const data = {
  modes: [
    { permission_key: 'finance.ledger.view', mode: 'NEW_ENFORCED' },
    { permission_key: 'inventory.stock_count.create', mode: 'SHADOW' },
  ],
  permissions: [
    { id: 'p1', permission_key: 'finance.ledger.view', description: 'View the general ledger', audit_sensitivity: 'ordinary' },
    { id: 'p2', permission_key: 'inventory.stock_count.create', description: 'Start a stock count', audit_sensitivity: 'security_sensitive' },
  ],
  roles: [
    { id: 'r1', name: 'Finance Viewer', role_key: 'finance-viewer', source: 'template', status: 'active', permissions: [{ permission: { permission_key: 'finance.ledger.view' } }] },
    { id: 'r2', name: 'Legacy HQ', role_key: 'legacy-hq', source: 'legacy', status: 'active', permissions: [] },
  ],
  scopeDefinitions: [{ id: 's1', scope_type: 'organization', display_name: 'Serapod HQ' }, { id: 's2', scope_type: 'warehouse', display_name: 'Main WH' }],
}
const governance = { readiness: [{ permission_key: 'finance.ledger.view', database_backstop: 'rls_gate', notes: 'wired' }], authorityPolicies: [] }

describe('Roles & Policies', () => {
  it('shows one section at a time, with counts', async () => {
    render(<RolesPoliciesPanel data={data} governance={governance} onChanged={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /^Migration modes\s*2$/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: /^Finance, 1 permission, expand/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: /^Business roles\s*2$/ }))
    expect(screen.queryByRole('button', { name: /^Finance, 1 permission/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Finance, 1 role, expand/ }))
    expect(screen.getByRole('button', { name: /^Finance Viewer, 1 permission/ })).toBeTruthy()
  })

  it('opens the tree at a permission when arriving from the Overview, and guards enforcement by readiness', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('prompt', () => 'Parity reviewed for a week')
    const onChanged = vi.fn()
    render(<RolesPoliciesPanel data={data} governance={governance} onChanged={onChanged} initialQuery="inventory.stock_count.create" />)
    const select = screen.getByRole('combobox', { name: /Change mode for Create Stock Count/ }) as HTMLSelectElement
    const enforce = Array.from(select.options).find(o => o.value === 'NEW_ENFORCED')!
    expect(enforce.disabled).toBe(true)
    expect(screen.getByText('Monitoring only')).toBeTruthy()
    await userEvent.selectOptions(select, 'LEGACY_ENFORCED')
    expect(fetchMock).toHaveBeenCalledWith('/api/security-access/modes', expect.objectContaining({
      body: JSON.stringify({ permissionKey: 'inventory.stock_count.create', mode: 'LEGACY_ENFORCED', reason: 'Parity reviewed for a week' }),
    }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('separates business roles from compatibility roles and folds their permissions', async () => {
    render(<RolesPoliciesPanel data={data} governance={governance} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: /Business roles/ }))
    expect(screen.queryByText('Legacy HQ')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Compatibility\s*1$/ }))
    // A role with no mapped permissions stays visible under Other / Unmapped.
    await userEvent.click(screen.getByRole('button', { name: /^Other \/ Unmapped, 1 role/ }))
    expect(screen.getByText('Legacy HQ')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Business roles\s*1$/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Finance, 1 role/ }))
    expect(screen.queryByText('View Ledger')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Finance Viewer/ }))
    expect(screen.getByText('View Ledger')).toBeTruthy()
    expect(screen.getByText(/Finance · General Ledger · 1/)).toBeTruthy()
  })

  it('keeps cross-module roles discoverable from each module filter', async () => {
    const roles = [...data.roles, { id: 'r3', name: 'Payroll Finance Approver', role_key: 'pfa', source: 'template', status: 'active',
      permissions: [{ permission: { permission_key: 'hr.payroll.approve' } }, { permission: { permission_key: 'finance.payment.approve' } }] }]
    render(<RolesPoliciesPanel data={{ ...data, roles }} governance={governance} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: /Business roles/ }))
    expect(screen.getByRole('button', { name: /^Shared \/ Cross-module, 1 role/ })).toBeTruthy()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'hr_payroll')
    expect(screen.getByText('Payroll Finance Approver')).toBeTruthy()
    expect(screen.queryByText('Finance Viewer')).toBeNull()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'finance')
    expect(screen.getByText('Payroll Finance Approver')).toBeTruthy()
    expect(screen.getByText('Finance Viewer')).toBeTruthy()
    expect(screen.getByText(/Showing 2 of 2 roles/)).toBeTruthy()
  })

  it('groups scopes by type and lists the catalogue with descriptions', async () => {
    render(<RolesPoliciesPanel data={data} governance={governance} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: /Scopes/ }))
    expect(screen.queryByText('Main WH')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^warehouse scopes, 1/ }))
    expect(screen.getByText('Main WH')).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: /Permission catalogue/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Supply Chain,/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Supply Chain: Stock Count/ }))
    expect(screen.getByText('Start a stock count')).toBeTruthy()
    expect(screen.getByText('Sensitive audit')).toBeTruthy()
  })
})
