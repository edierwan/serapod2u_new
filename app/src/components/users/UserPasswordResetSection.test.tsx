// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UserPasswordResetSection from './UserPasswordResetSection'

const toastMock = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }))

describe('UserPasswordResetSection', () => {
  beforeEach(() => {
    toastMock.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true }),
    })) as any)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows reset password only to role level 10', () => {
    const { rerender } = render(<UserPasswordResetSection targetUserId="target-1" targetUserName="Target User" targetUserEmail="target@example.com" currentUserRoleLevel={10} />)
    expect(screen.getByRole('button', { name: 'Reset Password' })).toBeTruthy()

    rerender(<UserPasswordResetSection targetUserId="target-1" targetUserName="Target User" targetUserEmail="target@example.com" currentUserRoleLevel={20} />)
    expect(screen.queryByRole('button', { name: 'Reset Password' })).toBeNull()
  })

  it('blocks password mismatch', async () => {
    const user = userEvent.setup()
    render(<UserPasswordResetSection targetUserId="target-1" targetUserName="Target User" targetUserEmail="target@example.com" currentUserRoleLevel={10} />)
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))
    await user.type(screen.getByLabelText('New Password'), 'new-password')
    await user.type(screen.getByLabelText('Confirm New Password'), 'different-password')

    expect(screen.getByText('Passwords do not match.')).toBeTruthy()
    expect((screen.getAllByRole('button', { name: 'Reset Password' }).at(-1) as HTMLButtonElement).disabled).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('renders one higher-layer portal and cancel preserves the Edit User form', async () => {
    const user = userEvent.setup()
    render(
      <div data-testid="edit-user-modal" className="fixed z-[100]">
        <label htmlFor="edit-user-name">Edit User Name</label>
        <input id="edit-user-name" defaultValue="Unsaved name" />
        <UserPasswordResetSection
          targetUserId="target-1"
          targetUserName="Target User"
          targetUserEmail="target@example.com"
          currentUserRoleLevel={10}
        />
      </div>,
    )

    await user.clear(screen.getByLabelText('Edit User Name'))
    await user.type(screen.getByLabelText('Edit User Name'), 'Changed but unsaved')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))

    const modal = screen.getByTestId('password-reset-modal')
    expect(modal.className).toContain('z-[120]')
    expect(screen.getByText(/Target User \(target@example.com\)/)).toBeTruthy()
    expect(document.querySelectorAll('.password-reset-overlay')).toHaveLength(1)
    expect(document.querySelector('.password-reset-overlay')?.className).toContain('z-[110]')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('password-reset-modal')).toBeNull()
    expect(screen.getByTestId('edit-user-modal')).toBeTruthy()
    expect((screen.getByLabelText('Edit User Name') as HTMLInputElement).value).toBe('Changed but unsaved')
    expect(document.querySelectorAll('.password-reset-overlay')).toHaveLength(0)
  })

  it('Escape closes only the reset modal', async () => {
    const user = userEvent.setup()
    render(
      <div data-testid="edit-user-modal">
        <UserPasswordResetSection targetUserId="target-1" targetUserName="Target User" targetUserEmail="target@example.com" currentUserRoleLevel={10} />
      </div>,
    )
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('password-reset-modal')).toBeNull()
    expect(screen.getByTestId('edit-user-modal')).toBeTruthy()
  })

  it('submits a valid reset without changing other user fields', async () => {
    const user = userEvent.setup()
    render(<UserPasswordResetSection targetUserId="target-1" targetUserName="Target User" targetUserEmail="target@example.com" currentUserRoleLevel={10} />)
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))
    await user.type(screen.getByLabelText('New Password'), 'new-password')
    await user.type(screen.getByLabelText('Confirm New Password'), 'new-password')
    await user.click(screen.getAllByRole('button', { name: 'Reset Password' }).at(-1)!)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const [, init] = (fetch as any).mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ user_id: 'target-1', new_password: 'new-password' })
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Password reset' }))
  })
})
