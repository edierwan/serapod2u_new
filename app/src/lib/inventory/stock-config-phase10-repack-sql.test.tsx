import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260718_stock_config_10_repack_to_20nb.sql'),
  'utf8',
)
const originalRepackMigration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260717_stock_config_03_ord_repack.sql'),
  'utf8',
)
const functionBody = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.repack_stock_v2'),
  migration.indexOf('COMMENT ON FUNCTION public.repack_stock_v2'),
)

describe('Phase 10 repack business rule', () => {
  it('permits only distinct 50OB or 50NB sources into same-variant active 20NB', () => {
    expect(functionBody).toContain("v_from_config.config_code = '50OB'")
    expect(functionBody).toContain("v_from_config.packaging = 'old_box'")
    expect(functionBody).toContain("v_from_config.config_code = '50NB'")
    expect(functionBody).toContain("v_from_config.packaging = 'new_box'")
    expect(functionBody).toContain("v_to_config.config_code <> '20NB'")
    expect(functionBody).toContain('v_to_config.volume_ml IS DISTINCT FROM 20')
    expect(functionBody).toContain("v_to_config.packaging IS DISTINCT FROM 'new_box'")
    expect(functionBody).toContain('p_from_config_id = p_to_config_id')
    expect(functionBody.match(/variant_id = p_variant_id/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects non-positive, over-available, and allocated quantities', () => {
    expect(functionBody).toContain('p_quantity IS NULL OR p_quantity <= 0')
    expect(functionBody).toContain('SELECT quantity_available')
    expect(functionBody).toContain('COALESCE(v_available, 0) < p_quantity')
  })

  it('posts an exact 1:1 pair with shared warehouse, request and RPK reference', () => {
    expect(functionBody).toContain("p_movement_type   => 'repack_out'")
    expect(functionBody).toContain('p_quantity_change => -p_quantity')
    expect(functionBody).toContain('p_stock_config_id => p_from_config_id')
    expect(functionBody).toContain("p_movement_type   => 'repack_in'")
    expect(functionBody).toContain('p_quantity_change => p_quantity')
    expect(functionBody).toContain('p_stock_config_id => p_to_config_id')
    expect(functionBody.match(/p_organization_id => p_warehouse_org_id/g)).toHaveLength(2)
    expect(functionBody.match(/p_reference_id    => p_request_id/g)).toHaveLength(2)
    expect(functionBody.match(/p_reference_no    => v_rpk_no/g)).toHaveLength(2)
    expect(functionBody).toContain("generate_display_doc_number(v_company_id, 'RPK')")
  })

  it('locks exact balances and leaves other flavours and warehouses outside its update scope', () => {
    expect(functionBody).toContain('pg_advisory_xact_lock')
    expect(functionBody).toContain('variant_id = p_variant_id')
    expect(functionBody).toContain('organization_id = p_warehouse_org_id')
    expect(functionBody).toContain('stock_config_id IN (p_from_config_id, p_to_config_id)')
    expect(functionBody).toContain('ORDER BY stock_config_id')
    expect(functionBody).toContain('FOR UPDATE')
  })

  it('rolls the outgoing movement back if incoming posting fails', () => {
    const outgoing = functionBody.indexOf("p_movement_type   => 'repack_out'")
    const incoming = functionBody.indexOf("p_movement_type   => 'repack_in'")
    expect(outgoing).toBeGreaterThan(0)
    expect(incoming).toBeGreaterThan(outgoing)
    expect(functionBody.slice(outgoing, incoming)).not.toMatch(/EXCEPTION|COMMIT/)
    expect(functionBody).not.toMatch(/EXCEPTION\s+WHEN/)
    expect(migration.trim().endsWith('COMMIT;')).toBe(true)
  })

  it('serializes idempotent replay and rejects request-id parameter conflicts', () => {
    const requestLock = functionBody.indexOf("'repack-request:' || p_request_id::text")
    const replayRead = functionBody.indexOf("reference_id = p_request_id")
    expect(requestLock).toBeGreaterThan(0)
    expect(replayRead).toBeGreaterThan(requestLock)
    expect(functionBody).toContain('v_existing_count <> 2')
    expect(functionBody).toContain("'idempotent_replay', true")
    expect(functionBody).toContain("'idempotent_replay', false")
    expect(functionBody).toContain('was already used for different parameters')
  })

  it('removes application access to the obsolete non-idempotent RPC', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.repack_stock(uuid, uuid, uuid, uuid, integer, text, uuid)',
    )
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role')
    expect(migration).toContain('repack_stock is obsolete; use repack_stock_v2')
  })

  it('does not alter ORD defaulting or configuration flags', () => {
    expect(originalRepackMigration).toContain('AND c.default_for_ord')
    expect(originalRepackMigration).toContain('p_stock_config_id => v_config_id')
    expect(migration).not.toMatch(/UPDATE\s+public\.inventory_stock_configurations/i)
    expect(migration).not.toContain('post_warehouse_receipt')
  })
})
