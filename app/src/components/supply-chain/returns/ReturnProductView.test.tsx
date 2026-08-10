/** @vitest-environment jsdom */

/**
 * Return Product listing — value formatting and unit wording.
 *
 * Renders the real view against stubbed `/api/returns*` responses so the
 * assertions cover what the table actually paints.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReturnProductView from './ReturnProductView'

vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({ from: () => ({ select: () => ({ data: [], error: null }) }) }),
}))

const CASES = [
    { id: 'c1', return_no: 'RET26-000009', status: 'return_completed', total_qty: 126, total_value: 1788, created_at: '2026-07-14T00:00:00Z', shop: { org_name: '24 Street Vapor' }, warehouse: { org_name: 'Serapod Warehouse Balakong' } },
    { id: 'c2', return_no: 'RET26-000008', status: 'return_completed', total_qty: 75, total_value: 1050, created_at: '2026-07-14T00:00:00Z', shop: { org_name: '24 Street Vapor' }, warehouse: { org_name: 'Serapod Warehouse Balakong' } },
    { id: 'c3', return_no: 'RET26-000006', status: 'return_draft', total_qty: 249, total_value: 3513, created_at: '2026-07-13T00:00:00Z', shop: { org_name: '24 Street Vapor' }, warehouse: { org_name: 'Serapod Warehouse Balakong' } },
    { id: 'c4', return_no: 'RET26-000002', status: 'return_draft', total_qty: 2, total_value: 28, created_at: '2026-07-12T00:00:00Z', shop: { org_name: '24 Street Vapor' }, warehouse: { org_name: 'Serapod Warehouse Balakong' } },
]

function stubApi() {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const body = url.includes('/api/returns/meta')
            ? { reasons: [], conditions: [], warehouses: [], categories: [], settings: {} }
            : { cases: CASES }
        return { ok: true, json: async () => body } as unknown as Response
    }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Return Product listing', () => {
    it('formats Value (RM) with a thousand separator and 2 decimals', async () => {
        stubApi()
        render(<ReturnProductView userProfile={{ id: 'u1', full_name: 'Tester' }} />)

        await waitFor(() => expect(screen.getByText('RET26-000009')).toBeTruthy())
        expect(screen.getByText('1,788.00')).toBeTruthy()
        expect(screen.getByText('1,050.00')).toBeTruthy()
        expect(screen.getByText('3,513.00')).toBeTruthy()
        // Sub-thousand values keep plain 2-decimal formatting.
        expect(screen.getByText('28.00')).toBeTruthy()
        // The unformatted values must be gone.
        expect(screen.queryByText('1788.00')).toBeNull()
        expect(screen.queryByText('3513.00')).toBeNull()
    })
})

describe('Return Product editor unit wording', () => {
    it('says Cases everywhere the quantity unit is described — never Box', async () => {
        stubApi()
        const user = userEvent.setup()
        render(<ReturnProductView userProfile={{ id: 'u1', full_name: 'Tester' }} />)

        await waitFor(() => expect(screen.getByText('RET26-000009')).toBeTruthy())
        await user.click(screen.getByRole('button', { name: /New Return/i }))

        await waitFor(() => expect(screen.getByText('Enter Quantity in Pcs or Cases')).toBeTruthy())
        expect(screen.getByText('Cases (4 Pcs)')).toBeTruthy()
        expect(screen.getByText(/1 Case = 4 Pcs for Cellera Hero and Cellera Zero/)).toBeTruthy()
        expect(screen.getByText(/Switch between Pcs and Cases mode/)).toBeTruthy()
        expect(screen.getByText('Total Qty (Cases)')).toBeTruthy()

        // No unit wording says "Box" any more. "S.Box" is an official product
        // line name and is allowed to stay.
        const body = document.body.textContent || ''
        const boxHits = body.match(/Box/gi) || []
        const productNameHits = body.match(/S\.Box/gi) || []
        expect(productNameHits.length).toBeGreaterThan(0) // guards against a vacuous match
        expect(boxHits.length).toBe(productNameHits.length)
    })
})
