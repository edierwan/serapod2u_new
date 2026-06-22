// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateRoadtourEventDialog } from './CreateRoadtourEventDialog'

const categories = [
    { id: 'vape-id', category_code: 'VAPE', category_name: 'Vape', image_url: null, is_active: true, is_vape: true, sort_order: 1 },
    { id: 'electronic-id', category_code: 'ELECTRONIC', category_name: 'Electronic', image_url: null, is_active: true, is_vape: false, sort_order: 2 },
    { id: 'other-id', category_code: 'OTHER', category_name: 'Other', image_url: null, is_active: true, is_vape: false, sort_order: 3 },
]

const query: any = {
    select: () => query,
    order: () => query,
    then: (resolve: (result: any) => void) => resolve({ data: categories, error: null }),
}
const supabase = { from: vi.fn(() => query) } as any

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))
vi.mock('@/components/shared/SafeImage', () => ({ default: ({ alt }: { alt: string }) => <span>{alt} image</span> }))

describe('CreateRoadtourEventDialog product category', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ success: true, data: { id: 'event-id', name: 'RoadTour 2026', product_category_id: 'vape-id' } }),
        })) as any)
    })

    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
        vi.clearAllMocks()
    })

    it('loads master-data categories, defaults Vape, disables coming-soon choices, and saves the stable id', async () => {
        const user = userEvent.setup()
        render(
            <CreateRoadtourEventDialog
                open
                onOpenChange={vi.fn()}
                supabase={supabase}
                orgId="org-id"
                createdBy="user-id"
            />,
        )

        const vape = await screen.findByRole('button', { name: /Vape.*Available/i })
        const electronic = screen.getByRole('button', { name: /Electronic.*Coming soon/i })
        expect(vape.getAttribute('aria-pressed')).toBe('true')
        expect((electronic as HTMLButtonElement).disabled).toBe(true)
        expect(screen.getAllByText('Coming soon')).toHaveLength(2)

        await user.type(screen.getByPlaceholderText('e.g. RoadTour 2026'), 'RoadTour 2026')
        const dateInputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]')
        fireEvent.change(dateInputs[0], { target: { value: '2026-07-01' } })
        fireEvent.change(dateInputs[1], { target: { value: '2026-07-31' } })
        await user.click(screen.getByRole('button', { name: 'Create Event' }))

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
        const [, init] = (fetch as any).mock.calls[0]
        expect(JSON.parse(init.body)).toMatchObject({
            org_id: 'org-id',
            product_category_id: 'vape-id',
        })
        expect(supabase.from).toHaveBeenCalledWith('product_categories')
    })
})
