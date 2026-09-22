// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import JourneyCardWithStats, { MetricCell } from './JourneyCardWithStats'

vi.mock('next/link', () => ({
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

afterEach(() => cleanup())

describe('MetricCell', () => {
    it.each([
        ['44,000', 44_000, 'text-[15px]'],
        ['60,500', 60_500, 'text-[15px]'],
        ['110,000', 110_000, 'text-[15px]'],
        ['999,999', 999_999, 'text-[15px]'],
        ['1,000,000', 1_000_000, 'text-[13px]'],
    ])('renders %s in full with an overflow-safe size', (text, value, size) => {
        render(<MetricCell label="Generated" value={value} tone="text-slate-950" />)
        const number = screen.getByText(text)
        expect(number.className).toContain(size)
        expect(number.className).toContain('tabular-nums')
        expect(number.className).toContain('whitespace-nowrap')
        expect(number.getAttribute('title')).toBe(text)
        // The cell can shrink inside its grid track instead of pushing into its neighbour.
        const cell = screen.getByTestId('journey-metric')
        expect(cell.className).toContain('min-w-0')
        expect(cell.className).toContain('overflow-hidden')
    })

    it('keeps small values at the prominent size', () => {
        render(<MetricCell label="Failed" value={0} tone="text-red-600" />)
        expect(screen.getByText('0').className).toContain('text-lg')
    })
})

describe('JourneyCardWithStats', () => {
    beforeEach(() => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                success: true,
                data: {
                    total_valid_links: 110_000,
                    links_scanned: 11_249,
                    lucky_draw_entries: 0,
                    redemptions: 0,
                    points_collected: 10_856,
                    failed_scans: 0,
                    last_scan_at: null,
                },
            }),
        })) as any
    })

    it('still loads per-order QR stats and shows full figures in the 2x2 metrics', async () => {
        render(
            <JourneyCardWithStats
                journey={{
                    id: 'j-1', name: 'Journey', is_active: false, is_default: false,
                    points_enabled: true, lucky_draw_enabled: false, redemption_enabled: false,
                    start_at: null, end_at: null,
                    order_info: { order_no: 'SO26000002', order_type: 'H2M', order_id: 'order-1' },
                }}
                onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}}
            />,
        )

        expect(global.fetch).toHaveBeenCalledWith('/api/journey/qr-stats?order_id=order-1')
        await waitFor(() => expect(screen.getByText('110,000')).toBeTruthy())
        expect(screen.getByText('11,249')).toBeTruthy()
        expect(screen.getByText('10,856')).toBeTruthy()
        expect(screen.getAllByTestId('journey-metric')).toHaveLength(4)
    })
})
