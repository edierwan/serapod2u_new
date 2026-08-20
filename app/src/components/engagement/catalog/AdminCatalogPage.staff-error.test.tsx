// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Production regression (2026-08-20): /api/admin/shop-staff-performance returned 500
 * ("URI too long"), the loader swallowed it, and the tab rendered the friendly
 * "No shop staff found" empty state — so a broken endpoint looked like an empty dataset.
 */

vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({
        from: () => {
            const chain: any = {
                select: () => chain,
                eq: () => chain,
                order: () => chain,
                limit: async () => ({ data: [], error: null }),
                single: async () => ({ data: null, error: null }),
                maybeSingle: async () => ({ data: null, error: null }),
                then: (resolve: (value: any) => void) => resolve({ data: [], error: null }),
            }
            return chain
        },
    }),
}))

vi.mock('@/components/ui/tabs', async () => {
    const React = await import('react')
    const Ctx = React.createContext<any>({ value: '', onValueChange: () => { } })
    return {
        Tabs: ({ value, onValueChange, children }: any) =>
            React.createElement(Ctx.Provider, { value: { value, onValueChange } }, children),
        TabsList: ({ children }: any) => React.createElement('div', null, children),
        TabsTrigger: ({ value, children }: any) => {
            const ctx = React.useContext(Ctx)
            return React.createElement('button', { type: 'button', onClick: () => ctx.onValueChange(value) }, children)
        },
        TabsContent: ({ value, children }: any) => {
            const ctx = React.useContext(Ctx)
            return ctx.value === value ? React.createElement('div', null, children) : null
        },
    }
})

vi.mock('./UserPointsMonitor', () => ({
    UserPointsMonitor: ({ users, emptyTitle }: any) =>
        users.length === 0
            ? <div data-testid="monitor">{emptyTitle}</div>
            : <div data-testid="monitor">{users.length} rows</div>,
}))

vi.mock('./ShopPointsReport', () => ({ ShopPointsReport: () => <div /> }))
vi.mock('next/image', () => ({ __esModule: true, default: (props: any) => <img alt="" {...props} /> }))
vi.mock('next/link', () => ({ __esModule: true, default: ({ children }: any) => <a>{children}</a> }))

import { AdminCatalogPage } from './AdminCatalogPage'

const userProfile: any = {
    id: 'admin-1',
    organizations: { id: 'company-1', org_name: 'Serapod Technology Sdn Bhd' },
}

function openStaffTab() {
    fireEvent.click(screen.getByText('Shop Staff Performance'))
}

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe('Shop Staff Performance load failure', () => {
    it('shows the error banner instead of the empty state when the API fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: any) => {
            if (String(input).includes('/api/admin/shop-staff-performance')) {
                return new Response(JSON.stringify({ error: 'URI too long\n' }), { status: 500 })
            }
            return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
        }))

        render(<AdminCatalogPage userProfile={userProfile} />)
        openStaffTab()

        await waitFor(() => {
            expect(screen.getByText(/Shop staff performance failed to load/i)).toBeTruthy()
        })
        expect(screen.getByText(/URI too long/i)).toBeTruthy()
        expect(screen.queryByText('No shop staff found')).toBeNull()
    })

    it('shows rows and no banner when the API succeeds', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: any) => {
            if (String(input).includes('/api/admin/shop-staff-performance')) {
                return new Response(JSON.stringify({
                    success: true,
                    data: [{ user_id: 'cd669095', consumer_name: 'Sabaruddin Nordin', current_balance: 1132 }],
                }), { status: 200 })
            }
            return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
        }))

        render(<AdminCatalogPage userProfile={userProfile} />)
        openStaffTab()

        await waitFor(() => {
            expect(screen.getByTestId('monitor').textContent).toBe('1 rows')
        })
        expect(screen.queryByText(/Shop staff performance failed to load/i)).toBeNull()
    })
})
