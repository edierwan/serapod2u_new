// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShopPicker } from './shop-picker'
import { getRegistrationShopSelectionError } from '@/lib/engagement/registration-link-selection'

function ShopPickerHarness({
    onCreateRequest,
    onSelectSpy,
    onBlurSpy,
}: {
    onCreateRequest?: (shopName: string) => void
    onSelectSpy?: (shop: any, displayName: string) => void
    onBlurSpy?: (value: string, hasSelection: boolean) => void
}) {
    const [value, setValue] = useState('')

    return (
        <ShopPicker
            value={value}
            onSelect={(shop, displayName) => {
                setValue(displayName)
                onSelectSpy?.(shop, displayName)
            }}
            onBlur={onBlurSpy}
            onCreateRequest={onCreateRequest}
        />
    )
}

function ValidatingShopPickerHarness() {
    const [value, setValue] = useState('')
    const [organizationId, setOrganizationId] = useState<string | null>(null)
    const [error, setError] = useState('')

    return (
        <>
            <ShopPicker
                value={value}
                onSelect={(shop, displayName) => {
                    setValue(displayName)
                    setOrganizationId(shop?.org_id || null)
                    setError(shop ? '' : error)
                }}
                onBlur={(nextValue, hasSelection) => {
                    setError(getRegistrationShopSelectionError(nextValue, hasSelection ? organizationId : null) || '')
                }}
            />
            {error && <p>{error}</p>}
            <button type="button">Next field</button>
        </>
    )
}

describe('ShopPicker', () => {
    beforeEach(() => {
        vi.useRealTimers()
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            const query = new URL(url, 'http://localhost').searchParams.get('q') || ''
            const trimmedQuery = query.trim().toLowerCase()

            if (trimmedQuery.includes('kedai maju')) {
                return {
                    json: async () => ({
                        success: true,
                        results: [{
                            org_id: 'shop-1',
                            org_name: 'Kedai Maju',
                            branch: 'HQ',
                            contact_name: 'Ali',
                            contact_phone: '0123456789',
                            state_name: 'Selangor',
                            display_label: 'Kedai Maju (HQ)',
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

    it('shows the create-new action when no shops match the search term', async () => {
        const user = userEvent.setup()
        const onCreateRequest = vi.fn()

        render(<ShopPickerHarness onCreateRequest={onCreateRequest} />)

        await user.type(screen.getByPlaceholderText('Search shop by name...'), 'Kedai Baru')

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })

        await waitFor(() => {
            expect(screen.getByText('Create New Shop')).toBeTruthy()
        })

        await user.click(screen.getByText('Create New Shop'))
        expect(onCreateRequest).toHaveBeenCalledWith('Kedai Baru')
    })

    it('clears the selected shop id when the chosen shop text is edited', async () => {
        const user = userEvent.setup()
        const onSelect = vi.fn()

        render(<ShopPickerHarness onSelectSpy={onSelect} />)

        const input = screen.getByPlaceholderText('Search shop by name...')

        await user.type(input, 'Kedai Maju')

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })

        await waitFor(() => {
            expect(screen.getByText('Kedai Maju')).toBeTruthy()
        })

        await user.click(screen.getByText('Kedai Maju'))

        expect(onSelect).toHaveBeenLastCalledWith(
            expect.objectContaining({ org_id: 'shop-1' }),
            'Kedai Maju (HQ)'
        )

        await user.type(input, ' X')

        expect(onSelect).toHaveBeenLastCalledWith(null, 'Kedai Maju (HQ)X')
    })

    it('reports blur for typed shop text without a selected shop', async () => {
        const user = userEvent.setup()
        const onBlur = vi.fn()

        render(
            <>
                <ShopPickerHarness onBlurSpy={onBlur} />
                <button type="button">Next field</button>
            </>
        )

        await user.type(screen.getByPlaceholderText('Search shop by name...'), 'kedai rawak')
        await user.click(screen.getByText('Next field'))

        expect(onBlur).toHaveBeenLastCalledWith('kedai rawak', false)
    })

    it('shows the inline invalid-shop error on blur and clears it after valid selection', async () => {
        const user = userEvent.setup()

        render(<ValidatingShopPickerHarness />)

        await user.type(screen.getByPlaceholderText('Search shop by name...'), 'kedai rawak')
        await user.click(screen.getByText('Next field'))

        expect(screen.getByText('Please select a valid shop from the list.')).toBeTruthy()

        await user.type(screen.getByPlaceholderText('Search shop by name...'), 'Kedai Maju')

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350))
        })

        await user.click(screen.getByText('Kedai Maju'))

        expect(screen.queryByText('Please select a valid shop from the list.')).toBeNull()
    })
})