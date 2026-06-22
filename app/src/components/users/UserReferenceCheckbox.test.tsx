// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReferenceCheckbox } from './UserDialogNew'

afterEach(cleanup)

describe('User Management Reference checkbox', () => {
  it('renders the original Reference field as a standard checkbox with RoadTour guidance', () => {
    render(<ReferenceCheckbox checked={false} onCheckedChange={() => undefined} />)

    expect((screen.getByRole('checkbox', { name: 'Reference' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('Allow this user to be selected as a Reference in RoadTour campaigns.')).toBeTruthy()
  })

  it('displays an existing checked value and reports changes', async () => {
    const onCheckedChange = vi.fn()
    render(<ReferenceCheckbox checked onCheckedChange={onCheckedChange} />)

    const checkbox = screen.getByRole('checkbox', { name: 'Reference' })
    expect((checkbox as HTMLInputElement).checked).toBe(true)

    await userEvent.click(checkbox)
    expect(onCheckedChange).toHaveBeenCalledWith(false)
  })
})
