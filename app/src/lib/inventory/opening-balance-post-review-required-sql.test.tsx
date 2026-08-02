import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  new URL('../../../../supabase/migrations/20260801240000_opening_balance_post_allows_review_required.sql', import.meta.url),
  'utf8',
)

const fnBody = (name: string) => {
  const m = migration.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$function\\$;`, 'i'))
  return m?.[0] ?? ''
}
const bind = fnBody('bind_inventory_cutoff_verification_snapshot')
const scoped = fnBody('verify_and_post_inventory_opening_cutoff_scoped_legacy')

const requestRoute = fs.readFileSync(
  new URL('../../app/api/inventory/stock-count/verification/request/route.ts', import.meta.url),
  'utf8',
)

describe('Opening Balance posting allows Review Required (advisories do not block)', () => {
  it('is forward-only and reloads the schema', () => {
    expect(migration.trim().toLowerCase().startsWith('begin;')).toBe(true)
    expect(migration.trim().toLowerCase().endsWith('commit;')).toBe(true)
    expect(migration.toLowerCase()).toContain("notify pgrst, 'reload schema'")
  })

  it('OTP request route uses the same Blocked-only readiness gate as the SQL migration', () => {
    expect(requestRoute).toContain("readiness === 'Blocked'")
    expect(requestRoute).toContain("readiness === 'Ready' || readiness === 'Review Required'")
    expect(requestRoute).toContain('postableReadiness')
    expect(requestRoute).not.toContain("cutoffPreview?.readiness !== 'Ready'")
  })

  it('replaces BOTH backend readiness gates (OTP bind + final post)', () => {
    expect(bind).toMatch(/create or replace function public\.bind_inventory_cutoff_verification_snapshot/i)
    expect(scoped).toMatch(/create or replace function public\.verify_and_post_inventory_opening_cutoff_scoped_legacy/i)
    expect(bind).toMatch(/security definer/i)
    expect(scoped).toMatch(/security definer/i)
  })

  it('rejects posting ONLY on real blockers (readiness = Blocked), never on Review Required', () => {
    // The old strict gate (<> 'Ready') must be gone from both functions.
    expect(bind).not.toContain("<> 'Ready'")
    expect(scoped).not.toContain("<>'Ready'")
    expect(scoped).not.toContain("<> 'Ready'")
    // The new gate blocks only when the preview reports real blockers.
    expect(bind).toMatch(/v_preview->>'readiness'\s*=\s*'Blocked'\s*then/i)
    expect(scoped).toMatch(/v_preview->>'readiness'\s*=\s*'Blocked'\s*then/i)
    // A genuine blocker still raises inventory_cutoff_not_ready in both.
    expect(bind).toContain("raise exception 'inventory_cutoff_not_ready")
    expect(scoped).toContain("raise exception 'inventory_cutoff_not_ready")
  })

  it('preserves the rest of each function (signatures + core guards + posting)', () => {
    // Bind keeps its other independent guards and returns the snapshot hash.
    expect(bind).toContain('bind_inventory_cutoff_verification_snapshot(p_request_id uuid, p_cutoff_id uuid)')
    expect(bind).toContain("raise exception 'inventory_cutoff_not_active'")
    // The posting function keeps its signature and still performs the atomic post.
    expect(scoped).toContain('verify_and_post_inventory_opening_cutoff_scoped_legacy(p_request_id uuid, p_code_hash text)')
    expect(scoped).toMatch(/inventory_cutoff_preview\(v_cutoff\.id\)/)
    // Exactly one readiness gate remains per function (no duplicate/removed gate).
    expect((bind.match(/inventory_cutoff_not_ready/g) ?? [])).toHaveLength(1)
    expect((scoped.match(/inventory_cutoff_not_ready/g) ?? [])).toHaveLength(1)
  })
})
