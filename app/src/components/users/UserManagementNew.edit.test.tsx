// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import UserManagementNew from './UserManagementNew'
const mocks = vi.hoisted(() => ({ single: vi.fn(), eq: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/actions', () => ({ createUserWithAuth: vi.fn(), updateUserWithAuth: vi.fn() }))
vi.mock('@/lib/hooks/useSupabaseAuth', () => {
  const supabase = { from: () => ({ select: () => ({ eq: (...args: any[]) => { mocks.eq(...args); return { single: mocks.single, order: async () => ({ data: [] }) } } }) }) }
  return { useSupabaseAuth: () => ({ isReady: true, supabase }) }
})
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('./UserDialogNew', () => ({ default: ({ user, open }: any) => open ? <div role="dialog">Edit User {user.id}</div> : null }))
const id = '30000000-0000-4000-8000-000000000003'
const profile = { id: 'viewer', role_code: 'POWER_USER', organization_id: 'org', roles: { role_level: 20 } }
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)
it('loads the exact ID and opens the reused dialog without the management page', async () => {
  mocks.single.mockResolvedValue({ data: { id, roles: { role_level: 50 } }, error: null })
  render(<UserManagementNew userProfile={profile} editUserId={id} />)
  expect((await screen.findByRole('dialog')).textContent).toContain(id)
  expect(mocks.eq).toHaveBeenCalledWith('id', id)
  expect(screen.queryByText('User Management')).toBeNull()
})
it.each(['PGRST116', '42501', 'network'])('handles user fetch failure %s gracefully', async (code) => {
  mocks.single.mockResolvedValue({ data: null, error: { code } })
  const unavailable = vi.fn()
  render(<UserManagementNew userProfile={profile} editUserId={id} onEditUnavailable={unavailable} />)
  await waitFor(() => expect(unavailable).toHaveBeenCalledOnce())
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unable to open user' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
