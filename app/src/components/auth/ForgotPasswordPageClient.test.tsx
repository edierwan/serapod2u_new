// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ForgotPasswordPageClient from './ForgotPasswordPageClient'

const searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
    useSearchParams: () => searchParams,
}))

vi.mock('next/link', () => ({
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...props}>{children}</a>
    ),
}))

vi.mock('@/components/auth/LoginProductStage3D', () => ({
    default: () => null,
}))

describe('ForgotPasswordPageClient', () => {
    beforeEach(() => {
        searchParams.delete('identifier')
        searchParams.delete('email')
    })

    afterEach(() => {
        cleanup()
    })

    it('labels the button as email code when the field contains an email', async () => {
        searchParams.set('identifier', 'serapp.dist1@dev.com')
        render(<ForgotPasswordPageClient branding={{ copyrightText: '© test' }} />)

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Send email code' })).toBeTruthy()
        })
        expect(screen.queryByRole('button', { name: 'Send SMS code' })).toBeNull()
        expect(screen.getByText(/Email gets an email code/)).toBeTruthy()
    })

    it('labels the button as SMS code when the field contains a phone number', async () => {
        const user = userEvent.setup()
        render(<ForgotPasswordPageClient branding={{ copyrightText: '© test' }} />)

        await user.type(screen.getByLabelText('Phone number / Email'), '01163739729')
        expect(screen.getByRole('button', { name: 'Send SMS code' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Send email code' })).toBeNull()
    })
})
