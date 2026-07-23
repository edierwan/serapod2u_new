import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const verification = readFileSync(
  new URL('../../../../supabase/diagnostics/20260719_stock_config_production_consolidated_verification.sql', import.meta.url),
  'utf8',
)

const checkBlock = (checkName: string, nextCheckName: string) => verification.slice(
  verification.indexOf(`'${checkName}'`),
  verification.indexOf(`'${nextCheckName}'`, verification.indexOf(`'${checkName}'`) + checkName.length),
)

describe('consolidated production verification regressions', () => {
  it('discovers and validates the deployed 16-parameter record_stock_movement contract', () => {
    const contract = checkBlock('record_stock_movement_current_contract', 'authenticated_execute_grants')

    expect(verification).toContain('FROM pg_catalog.pg_proc p')
    expect(verification).toContain('p.pronargs=16')
    expect(verification).toContain('pg_get_function_identity_arguments(p.oid)')
    expect(verification).toContain('p_evidence_urls text[], p_stock_config_id uuid')
    expect(contract).toContain('valid_contract')
    expect(verification).not.toContain(
      'public.record_stock_movement(text,uuid,uuid,integer,numeric,text,text,text,uuid,text,uuid,uuid,uuid)',
    )
  })

  it('checks the physical-variance comment through obj_description and signed posting structure', () => {
    const variance = checkBlock(
      'physical_variance_above_and_below_legacy',
      'verification_posting_atomic_and_idempotent',
    )

    expect(verification).toContain("obj_description(classification_guard_oid,'pg_proc')")
    expect(variance).toContain('classification_guard_comment')
    expect(variance).toContain("position('requested_total >' IN classification_guard_def)=0")
    expect(variance).toContain("position('stock_count_classification_exceeds_legacy' IN classification_guard_def)=0")
    expect(variance).toContain("position('p_quantity_change => v_item.adjustment_quantity' IN classification_post_def)>0")
    expect(variance).toContain("position('adjustment_quantity > 0' IN classification_post_def)=0")
    expect(variance).toContain("position('adjustment_quantity < 0' IN classification_post_def)=0")
  })

  it('accepts posted plus consumed_at and validates locking, reuse rejection and guarded posting order', () => {
    const atomicity = checkBlock(
      'verification_posting_atomic_and_idempotent',
      'draft_archive_and_discard_safety',
    )

    expect(atomicity).toContain("v_request.status = ''posted'' OR v_request.consumed_at IS NOT NULL")
    expect(atomicity).toContain("status = ''posted'', verified_by = v_user_id, verified_at = now(), consumed_at = now()")
    expect(atomicity).toContain("WHERE id = v_session.id AND status = ''draft''")
    expect(atomicity).toContain("IF NOT FOUND THEN RAISE EXCEPTION ''stock_count_already_posted''")
    expect(atomicity).toContain('verification_code_already_used')
    expect(atomicity).toContain('PERFORM public.record_stock_movement')
    expect(atomicity).toContain("position('FOR UPDATE' IN upper(count_post_def))>0")
    expect(atomicity).toContain("position('FOR UPDATE' IN upper(classification_post_def))>0")
    expect(atomicity).not.toContain("status = ''used''")
  })

  it('remains a single SELECT-only result query with the required output columns', () => {
    expect(verification).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/im)
    expect(verification.match(/^SELECT section,check_name,status,details$/gm)).toHaveLength(1)
    expect(verification).toContain("'OVERALL','OVERALL_STATUS'")
  })
})
