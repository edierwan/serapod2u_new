import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STAGE2D_PERMISSIONS } from './stage2d-catalog'
import { ALL_ENFORCEMENT_READY_PERMISSIONS } from './readiness'

const migration = readFileSync(new URL('../../../../supabase/migrations/20260930100000_sa_stage2d_deferred_closure.sql', import.meta.url), 'utf8')

describe('Stage 2D catalogue', () => {
  it.each(STAGE2D_PERMISSIONS)('$key is seeded (SHADOW), granted by $role and backfilled by its legacy rule', ({ key, role }) => {
    expect(migration).toContain(`('${key}',`)
    expect(migration).toContain(`('${role}','${key}')`)
    expect(migration).toContain(`when '${role}'`)
    expect(ALL_ENFORCEMENT_READY_PERMISSIONS).toContain(key)
  })

  it('seeds exactly these thirteen keys and never enforces them', () => {
    expect(STAGE2D_PERMISSIONS).toHaveLength(13)
    expect(migration).not.toMatch(/'NEW_ENFORCED'\s*,\s*null/)
    expect(migration).toContain("select k, 'SHADOW', null")
  })
})
