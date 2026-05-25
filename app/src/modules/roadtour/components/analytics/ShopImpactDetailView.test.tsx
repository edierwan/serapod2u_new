// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShopImpactDetailView } from './ShopImpactDetailView'
import { resolveShopImpactDisplay, resolveShopImpactParticipantDisplay } from '@/modules/roadtour/lib/analytics/shopImpactDetail'

let mockImpactDatasetResult: any

vi.mock('@/modules/roadtour/lib/analytics/useImpactDataset', () => ({
    useImpactDataset: () => mockImpactDatasetResult,
}))

vi.mock('./AnalyticsFilterBar', () => ({
    AnalyticsFilterBar: ({
        showStatus,
        statusValue,
        onStatusChange,
        showShopSearch,
        shopSearchValue,
        onShopSearchChange,
    }: any) => (
        <div>
            {showStatus && (
                <button type="button" onClick={() => onStatusChange(statusValue === 'all' ? 'no_response' : 'all')}>
                    Toggle Status
                </button>
            )}
            {showShopSearch && (
                <label>
                    Shop Search
                    <input value={shopSearchValue} onChange={(event) => onShopSearchChange(event.target.value)} />
                </label>
            )}
        </div>
    ),
}))

vi.mock('@/lib/roadtour/visit-region', () => ({
    getStateFlagPath: (stateName: string) => stateName === 'Penang' ? '/flags/penang.png' : null,
    buildVisitRegionDataset: () => [],
    getStateFromCapturedLocation: () => null,
}))

vi.mock('recharts', () => {
    const Wrapper = ({ children }: any) => <div>{children}</div>
    const Null = () => null
    return {
        ResponsiveContainer: Wrapper,
        BarChart: Wrapper,
        Bar: Null,
        XAxis: Null,
        YAxis: Null,
        CartesianGrid: Null,
        Tooltip: Null,
        LineChart: Wrapper,
        Line: Null,
    }
})

const userProfile = {
    organizations: {
        id: 'org-1',
    },
}

function buildRow(overrides: Partial<any> = {}) {
    return {
        visit_id: 'visit-1',
        visit_date: '2026-05-23',
        campaign_id: 'campaign-1',
        campaign_name: 'Roadtour 2026 Bob',
        account_manager_user_id: 'am-1',
        account_manager_name: 'Fitri',
        shop_id: 'shop-1',
        shop_name: 'Kloud Room (Seberang Perai Tengah)',
        shop_name_primary: 'Kloud Room',
        shop_branch_label: '(Seberang Perai Tengah)',
        shop_code: 'KL-001',
        shop_region: 'Penang',
        latest_participant_name: 'Nayli Nadhirah',
        latest_participant_phone: '+60145600453',
        participant_count: 1,
        before_scans: 0,
        after_scans: 26,
        scan_lift: 26,
        scan_lift_percent: null,
        status: 'newly_activated',
        days_since_visit: 2,
        last_scan_after_at: '2026-05-23T17:20:10Z',
        daily_before: [{ day: -1, count: 0 }],
        daily_after: [{ day: 1, count: 3 }],
        notes: null,
        ...overrides,
    }
}

describe('shop impact detail helpers', () => {
    it('prefers structured shop fields and keeps branch on a muted second row', () => {
        expect(resolveShopImpactDisplay({
            fullLabel: 'Kloud Room (Seberang Perai Tengah)',
            shopName: 'Kloud Room',
            branch: 'Seberang Perai Tengah',
            city: 'Seberang Perai Tengah',
            region: 'Penang',
        })).toEqual({
            primaryName: 'Kloud Room',
            branchLabel: '(Seberang Perai Tengah)',
        })
    })

    it('avoids splitting ambiguous shop names with parentheses when no location hint matches', () => {
        expect(resolveShopImpactDisplay({
            fullLabel: 'Brand (Lab)',
            shopName: 'Brand (Lab)',
            branch: null,
            city: 'Butterworth',
            region: 'Penang',
        })).toEqual({
            primaryName: 'Brand (Lab)',
            branchLabel: null,
        })
    })

    it('formats participant cells for single, missing, and multiple participants', () => {
        expect(resolveShopImpactParticipantDisplay({
            participantCount: 1,
            latestParticipantName: 'Nayli Nadhirah',
            latestParticipantPhone: '+60145600453',
        })).toEqual({
            primary: 'Nayli Nadhirah',
            secondary: '+60 14-560 0453',
            isPlaceholder: false,
        })

        expect(resolveShopImpactParticipantDisplay({
            participantCount: 0,
            latestParticipantName: null,
            latestParticipantPhone: null,
        })).toEqual({
            primary: '-',
            secondary: null,
            isPlaceholder: true,
        })

        expect(resolveShopImpactParticipantDisplay({
            participantCount: 3,
            latestParticipantName: 'Latest Person',
            latestParticipantPhone: '+60111222333',
        })).toEqual({
            primary: '3 participants',
            secondary: 'Latest: +60 11-122 2333',
            isPlaceholder: false,
        })
    })
})

describe('ShopImpactDetailView', () => {
    beforeEach(() => {
        mockImpactDatasetResult = {
            dataset: {
                visits: [
                    buildRow(),
                    buildRow({
                        visit_id: 'visit-2',
                        shop_id: 'shop-2',
                        shop_name: 'Brand (Lab)',
                        shop_name_primary: 'Brand (Lab)',
                        shop_branch_label: null,
                        shop_code: 'BR-002',
                        shop_region: 'Atlantis',
                        latest_participant_name: null,
                        latest_participant_phone: null,
                        participant_count: 0,
                        before_scans: 122,
                        after_scans: 0,
                        scan_lift: -122,
                        scan_lift_percent: -100,
                        status: 'no_response',
                        campaign_name: 'RoadTour 2026 Bulat',
                    }),
                ],
                summary: {
                    visited_shops: 2,
                    improved_shops: 0,
                    maintained_shops: 0,
                    dropped_shops: 1,
                    newly_activated_shops: 1,
                    no_response_shops: 1,
                    total_before_scans: 122,
                    total_after_scans: 26,
                    avg_scan_lift_percent: -100,
                    median_scan_lift_percent: -100,
                    visit_to_scan_conversion: 0.5,
                },
                campaigns: [],
                accountManagers: [],
                regions: [],
                windowDays: 7,
                dateFrom: '2026-05-19',
                dateTo: '2026-05-25',
                missingDataNote: null,
            },
            loading: false,
            filters: { windowDays: 7 },
            setFilters: vi.fn(),
        }
    })

    afterEach(() => {
        cleanup()
    })

    it('shows the refined table columns, split shop formatting, participant data, and region flag fallback', () => {
        render(<ShopImpactDetailView userProfile={userProfile} onViewChange={vi.fn()} />)

        const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())
        expect(headers).toEqual([
            'Shop',
            'Participant',
            'Region',
            'Campaign',
            'Visit Date',
            'Before 7D',
            'After 7D',
            'Lift %',
            'Last Scan After',
            'Status',
        ])
        expect(screen.queryByRole('columnheader', { name: 'AM' })).toBeNull()

        expect(screen.getByText('Kloud Room')).toBeTruthy()
        expect(screen.getByText('(Seberang Perai Tengah)').className).toContain('text-xs')
        expect(screen.getByText('Nayli Nadhirah')).toBeTruthy()
        expect(screen.getByText('+60 14-560 0453')).toBeTruthy()
        expect(screen.getByLabelText('Penang flag')).toBeTruthy()
        expect(screen.getByText('Atlantis')).toBeTruthy()

        const brandRow = screen.getByText('Brand (Lab)').closest('tr')
        expect(brandRow).toBeTruthy()
        expect(within(brandRow!).getByText('-')).toBeTruthy()
    })

    it('keeps shop search filtering and row selection working with the refined cells', async () => {
        const user = userEvent.setup()

        render(<ShopImpactDetailView userProfile={userProfile} onViewChange={vi.fn()} />)

        await user.type(screen.getByLabelText('Shop Search'), 'Kloud')
        expect(screen.getByText('Kloud Room')).toBeTruthy()
        expect(screen.queryByText('Brand (Lab)')).toBeNull()

        await user.clear(screen.getByLabelText('Shop Search'))
        await user.click(screen.getByText('Brand (Lab)'))

        expect(screen.queryByText('Select a shop')).toBeNull()
        expect(screen.getByText('Code: BR-002')).toBeTruthy()
        expect(screen.getByText('Participant: -')).toBeTruthy()
    })
})