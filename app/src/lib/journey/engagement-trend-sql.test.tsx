import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Contract checks on the (manually applied) trend RPC. No database is
// available to the test runner, so this pins the semantics that matter.
const migration = readFileSync(
    path.resolve(__dirname, '../../../../supabase/migrations/20260921130000_journey_engagement_trend.sql'),
    'utf8',
)
const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.get_journey_engagement_trend'))
const summaryRoute = readFileSync(
    path.resolve(__dirname, '../../app/api/journey/dashboard-summary/route.ts'),
    'utf8',
)
const code = (sql: string) => sql.replace(/--.*$/gm, '')

describe('get_journey_engagement_trend migration', () => {
    it('is SECURITY INVOKER and derives the organization from auth.uid(), not a parameter', () => {
        expect(fn).toMatch(/SECURITY INVOKER/)
        expect(fn).not.toMatch(/SECURITY DEFINER/)
        expect(fn).toMatch(/get_journey_engagement_trend\(\s*p_start_date date,\s*p_end_date date\s*\)/)
        expect(fn).toMatch(/u\.id = auth\.uid\(\)/)
        expect(fn).toMatch(/JOIN caller_org co ON co\.organization_id = jc\.org_id/)
        expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.get_journey_engagement_trend\(date, date\) FROM anon/)
    })

    it('includes every order linked to the org journeys and joins in SQL (no QR id lists, no row cap)', () => {
        expect(fn).toMatch(/FROM public\.journey_order_links jol/)
        expect(fn).toMatch(/JOIN journey_orders jo ON jo\.order_id = qc\.order_id/)
        expect(code(fn)).not.toMatch(/\bLIMIT\b/i)
        expect(code(fn)).not.toMatch(/\bIN\s*\(/i)
    })

    it('counts unique first-scanned QR codes, matching get_consumer_scan_stats unique_consumer_scans', () => {
        expect(fn).toMatch(/qc\.first_consumer_scan_at AT TIME ZONE 'Asia\/Kuala_Lumpur'\)::date/)
        expect(code(fn)).not.toMatch(/consumer_qr_scans/)
    })

    it('dates redemptions by qr_codes.redeemed_at, not the scan day', () => {
        expect(fn).toMatch(/qc\.is_redeemed = true/)
        expect(fn).toMatch(/qc\.redeemed_at AT TIME ZONE 'Asia\/Kuala_Lumpur'\)::date/)
    })

    it('uses Malaysia day boundaries for the selected window only', () => {
        expect(fn).toMatch(/p_start_date::timestamp AT TIME ZONE 'Asia\/Kuala_Lumpur'/)
        expect(fn).toMatch(/\(p_end_date \+ 1\)::timestamp AT TIME ZONE 'Asia\/Kuala_Lumpur'/)
        expect(fn).toMatch(/>= b\.start_ts/)
        expect(fn).toMatch(/< b\.end_ts/)
    })

    it('does not fabricate failed scans', () => {
        expect(fn).toMatch(/RETURNS TABLE\(day date, scans bigint, redeemed bigint\)/)
        expect(code(fn)).not.toMatch(/failed/i)
    })

    it('adds only the two missing composite partial indexes', () => {
        expect(migration).toMatch(/idx_qr_codes_order_first_consumer_scan[\s\S]*\(order_id, first_consumer_scan_at\)/)
        expect(migration).toMatch(/idx_qr_codes_order_redeemed_at[\s\S]*\(order_id, redeemed_at\)/)
        expect(migration.match(/CREATE INDEX/g)).toHaveLength(2)
    })
})

describe('dashboard-summary trend regression', () => {
    it('no longer depends on a 50,000 QR-code cap or the non-existent consumer_qr_scans.redeemed_at', () => {
        expect(summaryRoute).not.toMatch(/limit\(50000\)/)
        expect(summaryRoute).not.toMatch(/consumer_qr_scans/)
        expect(summaryRoute).not.toMatch(/redeemed_at/)
    })
})
