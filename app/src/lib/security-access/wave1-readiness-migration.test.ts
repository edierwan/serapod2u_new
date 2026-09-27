import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '../supabase/migrations/20260927150000_sa_wave1_readiness.sql'), 'utf8')
const executable = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')

describe('S&A Wave 1 readiness migration contract', () => {
  it('never changes a migration mode', () => {
    expect(executable).not.toMatch(/(update|insert\s+into)\s+public\.sa_migration_modes/i)
    expect(executable).not.toMatch(/set\s+mode\s*=/i)
  })

  it('classifies explicitly with no default and protects pre-existing rows', () => {
    expect(executable).toContain("add column if not exists audit_class text not null default 'UNCLASSIFIED'")
    expect(executable).toContain('alter column audit_class drop default')
    expect(executable).toContain("raise exception 'authorization_decision_audit_class_required'")
  })

  it('marks ordinary permissions by explicit key list, not by prefix', () => {
    expect(executable).toMatch(/set audit_sensitivity = 'ordinary'\s+where permission_key in \(/)
    expect(executable).not.toMatch(/set audit_sensitivity = 'ordinary'[^;]*like/)
  })

  it('keeps append-only: UPDATE always rejected, DELETE only for aged ordinary shadow rows', () => {
    expect(executable).toMatch(/if tg_op = 'DELETE'\s+and current_setting\('sa\.decision_retention_purge', true\) = 'on'\s+and old\.audit_class = 'ORDINARY_SHADOW'/)
    expect(executable).toContain('before truncate on public.sa_authorization_decisions')
    expect(executable).toContain('revoke update, delete, truncate, references, trigger on table public.sa_authorization_decisions from service_role')
  })

  it('makes the purge service-only with a fixed search_path and bounded batch', () => {
    expect(executable).toContain('revoke all on function public.sa_purge_ordinary_shadow_decisions(integer) from public, anon, authenticated')
    expect(executable).toContain('grant execute on function public.sa_purge_ordinary_shadow_decisions(integer) to service_role')
    expect(executable).toMatch(/sa_purge_ordinary_shadow_decisions[\s\S]*?set search_path = pg_catalog, pg_temp/)
    expect(executable).not.toContain("set search_path = ''")
    expect(executable).toContain('least(greatest(coalesce(p_batch_limit, 5000), 1), 50000)')
  })

  it('adds the stock count verify backstop that is inert outside NEW_ENFORCED/LEGACY_RETIRED', () => {
    expect(executable).toContain("coalesce(v_mode, 'LEGACY_ENFORCED') not in ('NEW_ENFORCED','LEGACY_RETIRED')")
    expect(executable).toContain('before insert or update of status on public.stock_count_verification_requests')
    expect(executable).toContain("interval '120 seconds'")
  })
})
