import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration02 = readFileSync(new URL('../../../../supabase/migrations/20260715_stock_count_verification_02.sql', import.meta.url), 'utf8')
const migration03 = readFileSync(new URL('../../../../supabase/migrations/20260716_stock_count_verification_preflight_and_permissions_03.sql', import.meta.url), 'utf8')
const baseCostMigration = readFileSync(new URL('../../../../supabase/migrations/20260716_stock_count_base_cost_snapshot_05.sql', import.meta.url), 'utf8')
const classificationGrantMigration = readFileSync(new URL('../../../../supabase/migrations/20260719_stock_config_14_classification_post_grant.sql', import.meta.url), 'utf8')
const postingMigration = migration02

describe('Stock Count verification migrations', () => {
    it('keeps final verification locked and duplicate-post safe', () => {
        expect(migration02).toContain('WHERE id = p_request_id FOR UPDATE')
        expect(migration02).toContain("WHERE id = v_session.id AND status = 'draft'")
        expect(migration02).toContain("status = 'posted'")
    })

    it('backfills the event, existing organizations, and dedicated permission', () => {
        expect(migration03).toContain("'stock_count_posting_verification'")
        expect(migration03).toContain('FROM public.organizations o')
        expect(migration03).toContain("'post_stock_count'")
        expect(migration03).toContain('WHERE r.role_level IN (1, 10, 20, 30)')
    })

    it('forces the verification event to email-only without auto-enabling it', () => {
        expect(migration03).toContain("ARRAY['email']")
        expect(migration03).toMatch(/'stock_count_posting_verification',\s*false,\s*ARRAY\['email'\]/)
    })

    it('snapshots only Product Variant Base Cost before approval', () => {
        expect(baseCostMigration).toContain('SET unit_cost = pv.base_cost')
        expect(baseCostMigration).toContain('stock_count_base_cost_missing')
        expect(baseCostMigration).not.toContain('average_cost')
        expect(baseCostMigration).not.toMatch(/retail|distributor|promo/i)
    })

    it('protects the approved snapshot from future Base Cost changes', () => {
        expect(baseCostMigration).toContain("'unit_cost_snapshot', i.unit_cost")
        expect(baseCostMigration).toContain("'current_variant_base_cost', pv.base_cost")
        expect(postingMigration).toContain('v_current_snapshot := public.stock_count_snapshot_hash(v_session.id)')
        expect(postingMigration).toContain("'stock_count_snapshot_changed'")
    })

    it('passes the snapshot through record_stock_movement into immutable history', () => {
        expect(postingMigration).toContain('p_unit_cost => v_item.unit_cost')
        expect(postingMigration).toContain('adjustment_quantity, unit_cost')
    })

    it('grants classification posting to authenticated and rejects ordinary-path misuse', () => {
        expect(classificationGrantMigration).toContain(
            'GRANT EXECUTE ON FUNCTION public.verify_and_post_stock_classification(uuid, text) TO authenticated',
        )
        expect(classificationGrantMigration).toContain('verification_code_already_used')
        expect(classificationGrantMigration).toContain("v_session.count_type = 'initial_configuration_classification'")
        expect(classificationGrantMigration).toContain('stock_count_wrong_posting_function')
        expect(classificationGrantMigration).toContain("WHERE id = v_session.id AND status = 'draft'")
    })
})
