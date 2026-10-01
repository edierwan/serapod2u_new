// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import PeopleAccessPanel from './PeopleAccessPanel'

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as any
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const HQ = 'org-hq'
const DIST = 'org-dist'
const perms = (...keys: string[]) => keys.map(k => ({ permission: { permission_key: k } }))
const ROLES = [
  { id: 'r-legacy', name: 'Legacy HQ', source: 'legacy', status: 'active', permissions: perms('customer.crm.view', 'finance.ledger.view') },
  { id: 'r-crm', name: 'CRM User', source: 'template', status: 'active', permissions: perms('customer.crm.view') },
  { id: 'r-ess', name: 'Employee Self-Service', source: 'template', status: 'active', permissions: perms('hr.self_service.use') },
  { id: 'r-order', name: 'Order Approver', source: 'template', status: 'active', description: 'Approves orders', permissions: perms('supply_chain.order.approve') },
  { id: 'r-gl', name: 'GL Clerk', source: 'template', status: 'active', permissions: perms('finance.ledger.view', 'finance.module.view') },
  { id: 'r-pfa', name: 'Payroll Finance Approver', source: 'template', status: 'active', permissions: perms('hr.payroll.approve', 'finance.payment.approve') },
]
const role = (id: string) => { const r = ROLES.find(x => x.id === id)!; return { id: r.id, name: r.name, source: r.source } }
const assignment = (id: string, roleId: string, source: string, extra: any = {}) => ({
  id, status: 'active', source, effective_until: null, role: role(roleId), scopes: [{ scope: { display_name: 'Serapod HQ' } }], ...extra,
})
const data = {
  viewerId: 'viewer',
  organizations: [{ id: HQ, org_name: 'Serapod HQ' }, { id: DIST, org_name: 'North Distributor' }],
  roles: ROLES,
  scopeDefinitions: [
    { id: 'scope-hq', organization_id: HQ, scope_type: 'organization', display_name: 'Serapod HQ' },
    { id: 'scope-dist', organization_id: DIST, scope_type: 'organization', display_name: 'North Distributor' },
  ],
  people: [
    { id: 'u1', full_name: 'Jafar Admin', email: 'jafar@example.test', role_code: 'HQ', is_active: true,
      membership: [{ id: 'm1', organization_id: HQ, status: 'active', is_primary: true, assignments: [
        assignment('a1', 'r-legacy', 'derived'), assignment('a2', 'r-crm', 'backfill'), assignment('a5', 'r-ess', 'derived'),
        assignment('a3', 'r-order', 'manual', { effective_until: '2099-01-01T00:00:00Z' }),
      ] }] },
    { id: 'u2', full_name: 'Siti Staff', email: 'siti@example.test', role_code: 'USER', is_active: true,
      membership: [{ id: 'm2', organization_id: HQ, status: 'active', is_primary: true, assignments: [assignment('a4', 'r-ess', 'derived')] }] },
    { id: 'u3', full_name: 'Old Leaver', email: 'old@example.test', role_code: 'USER', is_active: false, membership: [] },
    { id: 'u4', full_name: 'Dina Dual', email: 'dina@example.test', role_code: 'USER', is_active: true, membership: [
      { id: 'm4a', organization_id: HQ, status: 'active', is_primary: true, assignments: [] },
      { id: 'm4b', organization_id: DIST, status: 'active', is_primary: false, membership_type: 'secondary', assignments: [] },
    ] },
    { id: 'u5', full_name: 'Suspended Sam', email: 'sam@example.test', role_code: 'USER', is_active: true,
      membership: [{ id: 'm5', organization_id: HQ, status: 'suspended', is_primary: true, assignments: [] }] },
    { id: 'viewer', full_name: 'Me Myself', email: 'me@example.test', role_code: 'SA', is_active: true,
      membership: [{ id: 'mv', organization_id: HQ, status: 'active', is_primary: true, assignments: [] }] },
  ],
}

const openGrantFor = async (name: string) => {
  const row = screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li')!
  await userEvent.click(within(row).getByRole('button', { name: new RegExp(`Grant role to ${name}`) }))
}

describe('People & Access', () => {
  it('lists people collapsed, with granted / automatic / legacy counts and filter counts', () => {
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    const jafar = screen.getByRole('button', { name: /^Jafar Admin, 4 active roles, expand/ })
    expect(jafar.getAttribute('aria-expanded')).toBe('false')
    const row = jafar.closest('li')!
    expect(within(row).getByText('1 granted')).toBeTruthy()
    expect(within(row).getByText('2 automatic')).toBeTruthy()
    expect(within(row).getByText('1 legacy')).toBeTruthy()
    expect(screen.queryByText('CRM User')).toBeNull()
    expect(screen.getByRole('button', { name: /^Everyone\s*6$/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^With granted roles\s*1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Temporary access\s*1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Inactive\s*1$/ })).toBeTruthy()
  })

  it('filters, searches and shows an empty state', async () => {
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^With granted roles\s*1$/ }))
    expect(screen.getByRole('button', { name: /^Jafar Admin/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Siti Staff/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Everyone\s*6$/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search people' }), 'siti')
    expect(screen.getAllByRole('button', { name: /active roles?, expand$/ }).length).toBe(1)
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search people' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search people' }), 'nobody')
    expect(screen.getByText(/No people match/)).toBeTruthy()
  })

  it('separates granted, automatic and legacy access, grouped by module', async () => {
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^Jafar Admin/ }))
    // Granted access is open, grouped by module.
    expect(screen.getByRole('button', { name: /^Granted access, 1, collapse/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Granted access: Supply Chain, 1 role, collapse/ })).toBeTruthy()
    expect(screen.getAllByText('Order Approver').length).toBeGreaterThan(0)
    // Automatic and legacy access start folded.
    const automatic = screen.getByRole('button', { name: /^Automatic access, 2, expand/ })
    expect(screen.queryByText('Employee Self-Service')).toBeNull()
    await userEvent.click(automatic)
    await userEvent.click(screen.getByRole('button', { name: /^Automatic access: HR & Payroll, 1 role, expand/ }))
    expect(screen.getAllByText('Employee Self-Service').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Managed by HR / User Management').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /^Automatic access: Customer & Growth, 1 role/ }))
    expect(screen.getByText('Set up from the legacy role during migration')).toBeTruthy()
    // The legacy compatibility role is in its own section, not mixed with automatic access.
    expect(screen.queryByText('Legacy HQ')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Legacy access, 1, expand/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Legacy access: Shared \/ Cross-module, 1 role/ }))
    expect(screen.getAllByText('Legacy HQ').length).toBeGreaterThan(0)
  })

  it('revoke keeps its audited call; automatic access explains the override first', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    const prompt = vi.fn(() => 'No longer approves orders')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('prompt', prompt)
    const onChanged = vi.fn()
    render(<PeopleAccessPanel data={data} onChanged={onChanged} />)
    await userEvent.click(screen.getByRole('button', { name: /^Jafar Admin/ }))
    await userEvent.click(screen.getByRole('button', { name: /Revoke Order Approver/ }))
    expect(fetchMock).toHaveBeenCalledWith('/api/security-access/assignments', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'revoke', assignmentId: 'a3', reason: 'No longer approves orders' }),
    }))
    expect(onChanged).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^Automatic access, 2/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Automatic access: HR & Payroll/ }))
    await userEvent.click(screen.getByRole('button', { name: /Revoke Employee Self-Service/ }))
    expect(prompt).toHaveBeenLastCalledWith(expect.stringMatching(/automatic access \(Managed by HR \/ User Management\).*will not be re-added/))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/security-access/assignments', expect.objectContaining({
      body: JSON.stringify({ action: 'revoke', assignmentId: 'a5', reason: 'No longer approves orders' }),
    }))
  })

  it('offers restore only for automatic access an administrator revoked', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('prompt', vi.fn(() => 'Revoked by mistake'))
    const onChanged = vi.fn()
    const restorable = {
      ...data,
      restorableAssignmentIds: ['a9'],
      people: data.people.map((p: any) => p.id !== 'u1' ? p : { ...p, membership: p.membership.map((m: any) => ({
        ...m, assignments: [...m.assignments,
          assignment('a9', 'r-legacy', 'manual', { status: 'revoked', role: { ...role('r-legacy'), id: 'r-legacy-2', name: 'Legacy Manager' } }),
          assignment('a8', 'r-gl', 'manual', { status: 'revoked' })],
      })) }),
    }
    render(<PeopleAccessPanel data={restorable} onChanged={onChanged} />)
    await userEvent.click(screen.getByRole('button', { name: /^Jafar Admin/ }))
    // The revoked manual grant is not restorable (grant it again instead).
    expect(screen.queryByRole('button', { name: /Restore GL Clerk/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Legacy access, 2, expand/ }))
    for (const group of screen.getAllByRole('button', { name: /^Legacy access: .*expand/ })) await userEvent.click(group)
    expect(screen.getByText('Automatic access revoked by an administrator')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Revoke Legacy Manager/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Restore Legacy Manager/ }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/security-access/assignments', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'restore', assignmentId: 'a9', reason: 'Revoked by mistake' }),
    }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('keeps the grant form closed until asked for; one membership is selected for you', async () => {
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    expect(screen.queryByText('Business role')).toBeNull()
    await openGrantFor('Siti Staff')
    expect(screen.getByText('Business role')).toBeTruthy()
    expect(screen.getByText(/Their only active membership — selected for you/)).toBeTruthy()
    const membership = screen.getByRole('combobox', { name: 'Membership organization' })
    expect(membership.textContent).toContain('Serapod HQ')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Business role')).toBeNull()
  })

  it('requires a choice with several memberships and explains when there are none', async () => {
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    await openGrantFor('Dina Dual')
    expect(screen.getByText(/2 active memberships — choose the one/)).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Membership organization' }).textContent).not.toContain('Serapod HQ')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    // A suspended membership is not eligible and nothing defaults to HQ.
    await userEvent.click(screen.getByRole('button', { name: 'Grant access' }))
    expect(screen.queryByRole('option', { name: /Me Myself/ })).toBeNull()
  })

  it('module only filters the role list and clears a role it no longer offers', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    await openGrantFor('Siti Staff')
    const moduleSelect = screen.getByRole('combobox', { name: 'Module filter' }) as HTMLSelectElement
    // Only modules that have grantable roles are offered; legacy roles are never grantable.
    expect(Array.from(moduleSelect.options).map(o => o.text)).toEqual(['All modules', 'Supply Chain', 'Customer & Growth', 'HR & Payroll', 'Finance', 'Shared / Cross-module'])
    await userEvent.selectOptions(moduleSelect, 'finance')
    const roleBox = screen.getByRole('combobox', { name: 'Business role' })
    await userEvent.click(roleBox)
    // Finance shows its own roles and the cross-module role that touches Finance.
    expect(screen.getByRole('option', { name: /GL Clerk/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /Payroll Finance Approver/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Order Approver/ })).toBeNull()
    await userEvent.click(screen.getByRole('option', { name: /GL Clerk/ }))
    expect(roleBox.textContent).toContain('GL Clerk')
    // Switching to a module without that role clears it, so a hidden role is never submitted.
    await userEvent.selectOptions(moduleSelect, 'supply_chain')
    expect(screen.getByRole('combobox', { name: 'Business role' }).textContent).not.toContain('GL Clerk')
    const submit = screen.getAllByRole('button', { name: 'Grant access' }).find(b => b.closest('section')?.textContent?.includes('Reason'))!
    expect((submit as HTMLButtonElement).disabled).toBe(true)
  })
})
