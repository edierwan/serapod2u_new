// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PeopleAccessPanel from './PeopleAccessPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const HQ = 'org-hq'
const assignment = (id: string, name: string, source: string, extra: any = {}) => ({
  id, status: 'active', source, effective_until: null, role: { id: `r-${id}`, name }, scopes: [{ scope: { display_name: 'Serapod HQ' } }], ...extra,
})
const data = {
  viewerId: 'viewer',
  organizations: [{ id: HQ, org_name: 'Serapod HQ' }],
  roles: [{ id: 'role-1', name: 'Order Approver', source: 'template', status: 'active' }],
  scopeDefinitions: [{ id: 'scope-hq', organization_id: HQ, scope_type: 'organization', display_name: 'Serapod HQ' }],
  people: [
    { id: 'u1', full_name: 'Jafar Admin', email: 'jafar@example.test', role_code: 'HQ', is_active: true,
      membership: [{ id: 'm1', organization_id: HQ, status: 'active', is_primary: true, assignments: [
        assignment('a1', 'Legacy HQ', 'derived'), assignment('a2', 'CRM User', 'backfill'),
        assignment('a3', 'Order Approver', 'manual', { effective_until: '2099-01-01T00:00:00Z' }),
      ] }] },
    { id: 'u2', full_name: 'Siti Staff', email: 'siti@example.test', role_code: 'USER', is_active: true,
      membership: [{ id: 'm2', organization_id: HQ, status: 'active', is_primary: true, assignments: [assignment('a4', 'Employee Self-Service', 'derived')] }] },
    { id: 'u3', full_name: 'Old Leaver', email: 'old@example.test', role_code: 'USER', is_active: false, membership: [] },
  ],
}

describe('People & Access', () => {
  it('lists people collapsed, with role counts and filter counts', () => {
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    const jafar = screen.getByRole('button', { name: /^Jafar Admin, 3 active roles, expand/ })
    expect(jafar.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('CRM User')).toBeNull()
    expect(screen.getByRole('button', { name: /^Everyone\s*3$/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^With granted roles\s*1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Temporary access\s*1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Inactive\s*1$/ })).toBeTruthy()
  })

  it('filters, searches and shows an empty state', async () => {
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^With granted roles\s*1$/ }))
    expect(screen.getByRole('button', { name: /^Jafar Admin/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Siti Staff/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Everyone\s*3$/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search people' }), 'siti')
    expect(screen.getAllByRole('listitem').length).toBe(1)
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search people' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search people' }), 'nobody')
    expect(screen.getByText(/No people match/)).toBeTruthy()
  })

  it('opens a person with granted roles first and lifecycle roles folded; revoke keeps its audited call', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('prompt', () => 'No longer approves orders')
    const onChanged = vi.fn()
    render(<PeopleAccessPanel data={data} onChanged={onChanged} />)
    await userEvent.click(screen.getByRole('button', { name: /^Jafar Admin/ }))
    expect(screen.getByText('Granted roles')).toBeTruthy()
    expect(screen.getAllByText('Order Approver').length).toBeGreaterThan(0)
    expect(screen.queryByText('CRM User')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Lifecycle roles, 2/ }))
    expect(screen.getAllByText('CRM User').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: /Revoke Order Approver/ }))
    expect(fetchMock).toHaveBeenCalledWith('/api/security-access/assignments', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'revoke', assignmentId: 'a3', reason: 'No longer approves orders' }),
    }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('keeps the grant form closed until asked for, and "Grant role" preselects the person', async () => {
    render(<PeopleAccessPanel data={data} onChanged={vi.fn()} />)
    expect(screen.queryByText('Business role')).toBeNull()
    const row = screen.getByRole('button', { name: /^Siti Staff/ }).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: /Grant role to Siti Staff/ }))
    expect(screen.getByText('Business role')).toBeTruthy()
    expect(screen.getAllByText('Siti Staff').length).toBeGreaterThan(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Business role')).toBeNull()
  })
})
