import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
    findRoadtourGroupForView,
    getRoadtourBreadcrumb,
    isRoadtourViewId,
    legacyRoadtourViewRedirects,
    resolveRoadtourAdminPath,
    resolveRoadtourViewId,
    roadtourHrefForView,
    roadtourNavGroups,
} from './roadtourNav'

const APP_ROUTES = join(__dirname, '..', '..', 'app', 'roadtour')

function routeSource(...segments: string[]): string {
    return readFileSync(join(APP_ROUTES, ...segments, 'page.tsx'), 'utf8')
}

describe('RoadTour Reporting navigation', () => {
    const reporting = roadtourNavGroups.find((group) => group.id === 'rt-reporting')

    it('renames the Analytics section to RoadTour Reporting', () => {
        expect(reporting).toBeDefined()
        expect(reporting!.label).toBe('RoadTour Reporting')
        expect(roadtourNavGroups.some((group) => group.label === 'Analytics')).toBe(false)
    })

    it('exposes exactly the six approved reports, in order', () => {
        expect(reporting!.children.map((child) => child.label)).toEqual([
            'Monthly Overview',
            'AM Performance',
            'Shop Follow-Up',
            'Visit Log',
            'Monthly KPI Performance Report',
            'WhatsApp Monitoring',
        ])
    })

    it('does not keep the old report cards as separate menu items', () => {
        const labels = roadtourNavGroups.flatMap((group) => group.children.map((child) => child.label))
        for (const retired of [
            'Analytics Overview', 'Post-Visit Impact Report', 'Shop Impact Detail',
            'Account Manager Impact', 'Follow-Up Priority Queue', 'Visits',
        ]) {
            expect(labels).not.toContain(retired)
        }
    })

    it('keeps the shop drill-down reachable but out of the menu', () => {
        const labels = roadtourNavGroups.flatMap((group) => group.children.map((child) => child.id))
        expect(labels).not.toContain('roadtour-shop-drilldown')
        expect(isRoadtourViewId('roadtour-shop-drilldown')).toBe(true)
        expect(roadtourHrefForView('roadtour-shop-drilldown')).toBe('/roadtour/reporting/shops')
        expect(getRoadtourBreadcrumb('roadtour-shop-drilldown')).toEqual({
            group: 'RoadTour Reporting', item: 'Shop Impact Detail',
        })
    })

    it('breadcrumbs every report under the renamed section', () => {
        expect(getRoadtourBreadcrumb('roadtour-monthly-overview')).toEqual({
            group: 'RoadTour Reporting', item: 'Monthly Overview',
        })
        expect(getRoadtourBreadcrumb('roadtour-visits')).toEqual({
            group: 'RoadTour Reporting', item: 'Visit Log',
        })
    })
})

describe('legacy view ids', () => {
    it('maps every retired Analytics view onto its replacement', () => {
        expect(legacyRoadtourViewRedirects).toEqual({
            'roadtour-analytics': 'roadtour-monthly-overview',
            'roadtour-post-visit-impact': 'roadtour-monthly-overview',
            'roadtour-shop-impact': 'roadtour-shop-drilldown',
            'roadtour-am-impact': 'roadtour-am-performance',
            'roadtour-follow-up-priority': 'roadtour-shop-follow-up',
        })
    })

    it('never leaves a legacy id without a destination', () => {
        for (const [legacy, replacement] of Object.entries(legacyRoadtourViewRedirects)) {
            expect(isRoadtourViewId(legacy)).toBe(true)
            expect(resolveRoadtourViewId(legacy)).toBe(replacement)
            expect(roadtourHrefForView(legacy)).toBe(roadtourHrefForView(replacement))
            expect(roadtourHrefForView(legacy)).toBeTruthy()
            expect(findRoadtourGroupForView(legacy)?.label).toBe('RoadTour Reporting')
        }
    })

    it('leaves current view ids untouched', () => {
        expect(resolveRoadtourViewId('roadtour-monthly-overview')).toBe('roadtour-monthly-overview')
        expect(resolveRoadtourViewId('roadtour-monthly-kpi-report')).toBe('roadtour-monthly-kpi-report')
    })
})

describe('legacy routes redirect instead of breaking', () => {
    const redirects: Array<[string[], string]> = [
        [['analytics'], '/roadtour/reporting'],
        [['analytics', 'post-visit-impact'], '/roadtour/reporting'],
        [['analytics', 'shop-impact'], '/roadtour/reporting/shops'],
        [['analytics', 'am-impact'], '/roadtour/reporting/am-performance'],
        [['analytics', 'follow-up-priority'], '/roadtour/reporting/follow-up'],
    ]

    it.each(redirects)('redirects /roadtour/%s to its replacement', (segments, target) => {
        const source = routeSource(...(segments as string[]))
        expect(source).toContain("from 'next/navigation'")
        expect(source).toContain(`redirect('${target}')`)
    })
})

describe('protected reports are untouched', () => {
    it('keeps the Monthly KPI Performance Report on its own route and view', () => {
        expect(roadtourHrefForView('roadtour-monthly-kpi-report')).toBe('/roadtour/analytics/monthly-kpi')
        expect(resolveRoadtourAdminPath('analytics/monthly-kpi')).toBe('roadtour-monthly-kpi-report')
        const source = routeSource('analytics', 'monthly-kpi')
        expect(source).toContain('view="roadtour-monthly-kpi-report"')
        expect(source).not.toContain('redirect')
    })

    it('keeps WhatsApp Monitoring on its own route and view', () => {
        expect(roadtourHrefForView('roadtour-whatsapp')).toBe('/roadtour/whatsapp')
        expect(resolveRoadtourAdminPath('whatsapp')).toBe('roadtour-whatsapp')
        const source = routeSource('whatsapp')
        expect(source).toContain('view="roadtour-whatsapp"')
        expect(source).not.toContain('redirect')
    })
})

describe('new reporting routes', () => {
    it('addresses each report at a stable path', () => {
        expect(roadtourHrefForView('roadtour-monthly-overview')).toBe('/roadtour/reporting')
        expect(roadtourHrefForView('roadtour-am-performance')).toBe('/roadtour/reporting/am-performance')
        expect(roadtourHrefForView('roadtour-shop-follow-up')).toBe('/roadtour/reporting/follow-up')
        expect(roadtourHrefForView('roadtour-visits')).toBe('/roadtour/visits')
    })

    it('resolves those paths back to their view ids', () => {
        expect(resolveRoadtourAdminPath('reporting')).toBe('roadtour-monthly-overview')
        expect(resolveRoadtourAdminPath('reporting/am-performance')).toBe('roadtour-am-performance')
        expect(resolveRoadtourAdminPath('reporting/follow-up')).toBe('roadtour-shop-follow-up')
        expect(resolveRoadtourAdminPath('reporting/shops')).toBe('roadtour-shop-drilldown')
    })
})
