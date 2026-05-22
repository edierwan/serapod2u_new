// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReferencePicker } from './reference-picker'
import { getRegistrationReferenceSelectionError } from '@/lib/engagement/registration-link-selection'

function ReferencePickerHarness({
    onSelectSpy,
    onBlurSpy,
}: {
    onSelectSpy?: (reference: any, value: string) => void
    onBlurSpy?: (value: string, hasSelection: boolean) => void
}) {
    const [value, setValue] = useState('')
    const [referenceUserId, setReferenceUserId] = useState<string | null>(null)

    return (
        <ReferencePicker
            value={value}
            referenceUserId={referenceUserId}
            onSelect={(reference, nextValue) => {
                setValue(nextValue)
                setReferenceUserId(reference?.user_id || null)
                onSelectSpy?.(reference, nextValue)
            }}
            onBlur={onBlurSpy}
        />
    )
}

function ValidatingReferencePickerHarness() {
    const [value, setValue] = useState('')
    const [referenceUserId, setReferenceUserId] = useState<string | null>(null)
    const [error, setError] = useState('')

    return (
        <>
            <ReferencePicker
                value={value}
                referenceUserId={referenceUserId}
                onSelect={(reference, nextValue) => {
                    setValue(nextValue)
                    setReferenceUserId(reference?.user_id || null)
                    setError(reference ? '' : error)
                }}
                onBlur={(nextValue, hasSelection) => {
                    setError(getRegistrationReferenceSelectionError(nextValue, hasSelection ? referenceUserId : null) || '')
                }}
            />
            {error && <p>{error}</p>}
            <button type="button">Next field</button>
        </>
    )
}

describe('ReferencePicker', () => {
    beforeEach(() => {
        vi.useRealTimers()
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            const query = new URL(url, 'http://localhost').searchParams.get('q') || ''
            const trimmedQuery = query.trim().toLowerCase()

            if (trimmedQuery.includes('ali')) {
                return {
                    json: async () => ({
                        success: true,
                        results: [{
                            user_id: 'ref-1',
                            full_name: 'Ali Reference',
                            phone: '+60123456789',
                            email: 'ali@example.com',
                            organization_name: 'Kedai Maju',
                        }],
                    }),
                }
            }

            return {
                json: async () => ({ success: true, results: [] }),
            }
        }) as any)
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    it('reports blur for typed reference text without a selected reference', async () => {
        const user = userEvent.setup()
        const onBlur = vi.fn()

        render(
            <>
                <ReferencePickerHarness onBlurSpy={onBlur} />
                <button type="button">Next field</button>
            </>
        )

        await user.type(screen.getByPlaceholderText('Search by name, phone, or email...'), 'gfdfg')
        await user.click(screen.getByText('Next field'))

        expect(onBlur).toHaveBeenLastCalledWith('gfdfg', false)
    })

    it('shows the inline invalid-reference error on blur and clears it after valid selection', async () => {
        const user = userEvent.setup()

        render(<ValidatingReferencePickerHarness />)

        await user.type(screen.getByPlaceholderText('Search by name, phone, or email...'), 'gfdfg')
        await user.click(screen.getByText('Next field'))

        expect(screen.getByText('Please select a valid reference from the list.')).toBeTruthy()

        await user.type(screen.getByPlaceholderText('Search by name, phone, or email...'), 'Ali')

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })

        await user.click(screen.getByText('Ali Reference'))

        expect(screen.queryByText('Please select a valid reference from the list.')).toBeNull()
    })

    it('keeps a selected reference state only after choosing a valid result', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()

        render(<ReferencePickerHarness onSelectSpy={onSelect} />)

        await user.type(screen.getByPlaceholderText('Search by name, phone, or email...'), 'Ali')

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })

        await waitFor(() => {
            expect(screen.getByText('Ali Reference')).toBeTruthy()
        })

        await user.click(screen.getByText('Ali Reference'))

        expect(onSelect).toHaveBeenLastCalledWith(
            expect.objectContaining({ user_id: 'ref-1' }),
            '+60123456789'
        )
        expect(screen.getByText('Ali Reference')).toBeTruthy()
        expect(screen.getByText('+60123456789')).toBeTruthy()
    })
})