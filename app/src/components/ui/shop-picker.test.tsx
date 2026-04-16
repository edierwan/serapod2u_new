// @vitest-environment jsdom

import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShopPicker } from './shop-picker'

function ShopPickerHarness({ onCreateRequest }: { onCreateRequest: (shopName: string) => void }) {
    const [value, setValue] = useState('')

    return (
        <ShopPicker
            value={value}
            onSelect={(_, displayName) => setValue(displayName)}
            onCreateRequest={onCreateRequest}
        />
    )
}

describe('ShopPicker', () => {
    beforeEach(() => {
        vi.useRealTimers()
        vi.stubGlobal('fetch', vi.fn(async () => ({
            json: async () => ({ success: true, results: [] }),
        })) as any)
    })

    afterEach(() => {
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
})