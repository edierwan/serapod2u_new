import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FINAL_WAVE_CATALOG, compatGrants } from './catalog'
import { ENFORCEMENT_READY_PERMISSIONS } from './readiness'

const migrations = resolve(process.cwd(), '..', 'supabase', 'migrations')
const foundation = readFileSync(resolve(migrations, '20260928100000_sa_final_governance_foundation.sql'), 'utf8')
const retirement = readFileSync(resolve(migrations, '20260928130000_sa_final_legacy_retirement_support.sql'), 'utf8')

describe('Final Wave catalog ↔ migration lock-step', () => {
  it('seeds exactly the TypeScript catalog with the same sensitivity and compatibility rule', () => {
    const block = foundation.slice(foundation.indexOf('insert into sa_final_catalog values'), foundation.indexOf("('reporting.analytics.view'") + 400)
    const rows = [...block.matchAll(/^ \('([a-z_.]+)','[a-z_]+','[a-z_]+','[a-z_]+','(?:[^']|'')*','([a-z_]+)',(null|\d+),/gm)]
    const seeded = new Map(rows.map(r => [r[1], { sensitivity: r[2], max: r[3] === 'null' ? undefined : Number(r[3]) }]))
    expect([...seeded.keys()].sort()).toEqual(FINAL_WAVE_CATALOG.map(e => e.key).sort())
    for (const entry of FINAL_WAVE_CATALOG) {
      expect(seeded.get(entry.key), entry.key).toEqual({ sensitivity: entry.sensitivity, max: entry.compat.maxRoleLevel })
    }
  })

  it('registers exactly the enforcement-ready operations in the database', () => {
    const seg = retirement.slice(retirement.indexOf('insert into public.sa_enforcement_readiness'), retirement.indexOf('on conflict (permission_key) do update set route_wiring'))
    const keys = [...seg.matchAll(/^ \('([a-z_.]+)'/gm)].map(m => m[1]).sort()
    expect(keys).toEqual([...ENFORCEMENT_READY_PERMISSIONS].sort())
  })

  it('never grants own-record permissions through compatibility roles', () => {
    for (const entry of FINAL_WAVE_CATALOG.filter(e => e.employeeBaseline)) {
      expect(compatGrants(entry, { roleCode: 'SA', roleLevel: 1, permissions: [] })).toBe(false)
    }
  })

  it('keeps privileged security and destructive permissions Super-Admin-only in compatibility', () => {
    for (const entry of FINAL_WAVE_CATALOG.filter(e => e.key.startsWith('security.') || e.key === 'platform.data.destructive')) {
      expect(compatGrants(entry, { roleCode: 'HQ', roleLevel: 10, permissions: [] }), entry.key).toBe(false)
    }
  })

  it('does not change any migration mode to an enforced value in a migration', () => {
    for (const file of ['20260928100000_sa_final_governance_foundation.sql', '20260928110000_sa_final_finance_hr_lifecycle.sql',
      '20260928120000_sa_final_modules_supply_chain.sql', '20260928130000_sa_final_legacy_retirement_support.sql']) {
      const sql = readFileSync(resolve(migrations, file), 'utf8')
      expect(sql, file).not.toMatch(/update\s+public\.sa_migration_modes\s+set\s+mode\s*=\s*'(NEW_ENFORCED|LEGACY_RETIRED)'/i)
    }
  })
})
