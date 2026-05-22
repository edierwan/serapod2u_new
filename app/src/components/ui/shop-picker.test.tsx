// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShopPicker } from './shop-picker'

function ShopPickerHarness({
    onCreateRequest,
    onSelectSpy,
}: {
    onCreateRequest?: (shopName: string) => void
    onSelectSpy?: (shop: any, displayName: string) => void
}) {
    const [value, setValue] = useState('')

    return (
        <ShopPicker
            value={value}
            onSelect={(shop, displayName) => {
                setValue(displayName)
                onSelectSpy?.(shop, displayName)
            }}
            onCreateRequest={onCreateRequest}
        />
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
            expect(screen.getByText('My shop name is not found. Create new.')).toBeTruthy()
        })

        await user.click(screen.getByText('My shop name is not found. Create new.'))
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
})