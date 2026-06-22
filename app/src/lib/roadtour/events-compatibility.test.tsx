import { describe, expect, it, vi } from 'vitest'

import { resolveRoadtourExperience } from './experience-registry'
import { buildRoadtourRunMap, fetchRoadtourRuns, type RoadtourRun } from './events'

const legacyEvent = {
    id: 'legacy-event-id',
    org_id: 'org-id',
    name: 'Original RoadTour Event',
    description: null,
    start_date: '2026-05-01',
    end_date: '2026-06-30',
    status: 'active',
    duplicate_policy: 'one_participant_once_per_event',
    point_release_rule: 'immediate_after_roadtour_claim',
    required_product_qr_scans: null,
    product_qr_counting_period: null,
    unique_product_qr_only: true,
    active_reward_rule_version_id: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
}

function queryResult(result: any) {
    const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        then: (resolve: (value: any) => void) => resolve(result),
    }
    return query
}

describe('RoadTour legacy Event compatibility', () => {
    it('keeps an event queryable and its campaign link resolvable when product_category_id is absent', async () => {
        const categoryQuery = queryResult({
            data: null,
            error: { code: '42703', message: 'column roadtour_runs.product_category_id does not exist' },
        })
        const legacyQuery = queryResult({ data: [legacyEvent], error: null })
        const supabase = {
            from: vi.fn()
                .mockReturnValueOnce(categoryQuery)
                .mockReturnValueOnce(legacyQuery),
        } as any

        const events = await fetchRoadtourRuns(supabase, 'org-id')
        expect(events).toEqual([{ ...legacyEvent, product_category_id: null }])

        const campaign = { id: 'campaign-id', roadtour_run_id: 'legacy-event-id' }
        const resolvedEvent = buildRoadtourRunMap(events as RoadtourRun[]).get(campaign.roadtour_run_id)
        expect(resolvedEvent?.id).toBe('legacy-event-id')
        expect(resolvedEvent?.name).toBe('Original RoadTour Event')
        expect(resolveRoadtourExperience(null).key).toBe('vape')
        expect(supabase.from).toHaveBeenCalledTimes(2)
    })
})
